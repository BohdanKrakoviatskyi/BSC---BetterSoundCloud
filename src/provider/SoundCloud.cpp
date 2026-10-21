#include "provider/SoundCloud.h"

#include "app/ErrorCenter.h"
#include "app/Paths.h"
#include "app/Settings.h"
#include "core/Async.h"
#include "library/LibraryStore.h"
#include "provider/SidecarClient.h"
#include "provider/SoundCloudBrowserLogin.h"
#include "spotify/SpotifyError.h"

#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJSEngine>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLoggingCategory>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTimer>


#include <utility>

#include <QCoroNetworkReply>

Q_LOGGING_CATEGORY(lcSoundCloud, "resonance.soundcloud")

namespace resonance {

namespace {

SoundCloud *s_instance = nullptr;

/// the sidecar paginates likes twenty at a time; five pages is a library page
/// worth showing without making the person wait for the whole of it
constexpr int kLikedSongsMaxPages = 5;
constexpr int kLikedSongsPageSize = 20;
/// a stream that never ends is a stream to give up on
constexpr int kStreamTransferTimeoutMs = 60'000;

/// soundcloud serves artwork in named sizes, and -large is the small one
QUrl upsizedArtwork(const QUrl &url)
{
    if (url.isEmpty()) {
        return url;
    }
    QString text = url.toString();
    text.replace(QLatin1StringView("-large."), QLatin1StringView("-t500x500."));
    return QUrl(text);
}

QString numericId(const QJsonValue &value)
{
    if (value.isDouble()) {
        return QString::number(qint64(value.toDouble()));
    }
    return value.toString();
}

/// what a fetched stream is kept under: the track, not the cdn link, which
/// expires and changes every time it is asked for
QString streamCacheKey(const QString &uri)
{
    return QString::fromLatin1(
        QCryptographicHash::hash(uri.toUtf8(), QCryptographicHash::Sha1).toHex().left(32));
}

/// normalizes downloaded audio container and stream data into a clean, seekable audio file
bool normalizeAudio(const QString &inputPath, const QString &outputPath)
{
    QString ffmpeg = QStandardPaths::findExecutable(QStringLiteral("ffmpeg"));
    if (ffmpeg.isEmpty()) {
        for (const QString &candidate : {
            QStringLiteral("/opt/homebrew/bin/ffmpeg"),
            QStringLiteral("/usr/local/bin/ffmpeg"),
            QStringLiteral("/usr/bin/ffmpeg")
        }) {
            if (QFileInfo::exists(candidate)) {
                ffmpeg = candidate;
                break;
            }
        }
    }
    if (ffmpeg.isEmpty()) {
        return false;
    }

    QFile::remove(outputPath);

    // fast path: remux with stream copy
    QProcess process;
    process.start(ffmpeg, {
        QStringLiteral("-y"),
        QStringLiteral("-v"), QStringLiteral("error"),
        QStringLiteral("-i"), inputPath,
        QStringLiteral("-c"), QStringLiteral("copy"),
        outputPath
    });
    if (process.waitForFinished(15'000) && process.exitCode() == 0) {
        if (QFileInfo(outputPath).size() > 0) {
            return true;
        }
    }

    // fallback: transcode if copy fails
    QFile::remove(outputPath);
    QProcess transcode;
    const bool isM4a = outputPath.endsWith(QLatin1StringView(".m4a"));
    const QStringList args = isM4a
        ? QStringList{ QStringLiteral("-y"), QStringLiteral("-v"), QStringLiteral("error"),
                       QStringLiteral("-i"), inputPath, QStringLiteral("-c:a"), QStringLiteral("aac"),
                       QStringLiteral("-b:a"), QStringLiteral("192k"), outputPath }
        : QStringList{ QStringLiteral("-y"), QStringLiteral("-v"), QStringLiteral("error"),
                       QStringLiteral("-i"), inputPath, QStringLiteral("-c:a"), QStringLiteral("libmp3lame"),
                       QStringLiteral("-b:a"), QStringLiteral("192k"), outputPath };
    transcode.start(ffmpeg, args);
    if (transcode.waitForFinished(30'000) && transcode.exitCode() == 0) {
        if (QFileInfo(outputPath).size() > 0) {
            return true;
        }
    }

    return false;
}

} // namespace

SoundCloud::SoundCloud(SidecarClient *sidecar, Settings *settings, QNetworkAccessManager *network,
                       ErrorCenter *errors, QObject *parent)
    : QObject(parent)
    , m_sidecar(sidecar)
    , m_settings(settings)
    , m_network(network)
    , m_errors(errors)
    , m_artistTracks(new SongListModel(this))
    , m_artistLikes(new SongListModel(this))
    , m_artistPlaylists(new PlaylistListModel(this))
    , m_relatedTracks(new SongListModel(this))
{
    s_instance = this;
    if (m_sidecar != nullptr) {
        // the sidecar logs its own work to stderr; it is the only place the
        // reason for a failed request is spelled out
        connect(m_sidecar, &SidecarClient::diagnostic, this, [](const QString &line) {
            qCDebug(lcSoundCloud).noquote() << line;
        });
    }
    // the browser sign-in hands over the two things connectAccount asks for
    m_browserLogin = new SoundCloudBrowserLogin(this);
    connect(m_browserLogin, &SoundCloudBrowserLogin::activeChanged, this,
            &SoundCloud::browserLoginActiveChanged);
    connect(m_browserLogin, &SoundCloudBrowserLogin::captured, this, [this](const QString &clientId,
                                                                           const QString &token) {
        connectAccount(clientId, token);
    });
    connect(m_browserLogin, &SoundCloudBrowserLogin::failed, this, [this](const QString &message) {
        setStatusMessage(message);
    });
    if (m_settings != nullptr) {
        connect(m_settings, &Settings::soundcloudClientIdChanged, this, &SoundCloud::clientIdChanged);
    }
    QDir().mkpath(streamCacheDirectory());
}

SoundCloud::~SoundCloud()
{
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

SoundCloud *SoundCloud::instance()
{
    return s_instance;
}

SoundCloud *SoundCloud::create(QQmlEngine *, QJSEngine *)
{
    if (s_instance != nullptr) {
        QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    }
    return s_instance;
}

QString SoundCloud::clientId() const
{
    return m_settings != nullptr ? m_settings->soundcloudClientId() : QString();
}

void SoundCloud::setClientId(const QString &value)
{
    if (m_settings != nullptr) {
        m_settings->setSoundcloudClientId(value);
    }
}

bool SoundCloud::available() const
{
    return m_sidecar != nullptr && !m_sidecar->binaryPath().isEmpty();
}

QString SoundCloud::streamCacheDirectory() const
{
    return paths::cacheDirectory() + QStringLiteral("/soundcloud");
}

void SoundCloud::setBusy(bool value)
{
    if (m_busy == value) {
        return;
    }
    m_busy = value;
    emit busyChanged();
}

void SoundCloud::setStatusMessage(const QString &message)
{
    if (m_statusMessage == message) {
        return;
    }
    m_statusMessage = message;
    emit statusMessageChanged();
}

void SoundCloud::clearStatusMessage()
{
    setStatusMessage(QString());
}

void SoundCloud::report(const QString &message)
{
    if (m_errors != nullptr) {
        m_errors->show(message);
    }
}

QCoro::Task<QJsonObject> SoundCloud::call(QString method, QJsonObject params)
{
    if (m_sidecar == nullptr) {
        co_return QJsonObject {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(method, params);
    if (!response.ok()) {
        qCDebug(lcSoundCloud) << method << "failed:" << response.error;
        co_return QJsonObject { { QStringLiteral("error"), response.error } };
    }
    co_return response.result;
}

void SoundCloud::applyStatus(const QJsonObject &status)
{
    const bool authorized = status.value(QStringLiteral("authorized")).toBool();
    const QJsonObject profile = status.value(QStringLiteral("profile")).toObject();
    const QString name = profile.value(QStringLiteral("fullName")).toString().isEmpty()
        ? profile.value(QStringLiteral("username")).toString()
        : profile.value(QStringLiteral("fullName")).toString();
    const QString id = numericId(profile.value(QStringLiteral("id")));
    const QUrl avatar = upsizedArtwork(QUrl(profile.value(QStringLiteral("avatarUrl")).toString()));

    if (m_connected == authorized && m_userName == name && m_userId == id && m_avatarUrl == avatar) {
        return;
    }
    m_connected = authorized;
    m_userName = authorized ? name : QString();
    m_userId = authorized ? id : QString();
    m_avatarUrl = authorized ? avatar : QUrl();
    emit accountChanged();
}

void SoundCloud::refreshStatus()
{
    detach(refreshStatusTask());
}

/// Capturing coroutine lambdas keep their captures in the closure, which dies
/// as soon as detach receives the task and before this sidecar request resumes.
QCoro::Task<> SoundCloud::refreshStatusTask()
{
    const QJsonObject status = co_await call(QStringLiteral("auth.status"));
    if (!status.contains(QStringLiteral("error"))) {
        applyStatus(status);
    }
    if (m_settings != nullptr && m_settings->soundcloudClientId().isEmpty()) {
        const QJsonObject settingsResp = co_await call(QStringLiteral("settings.get"));
        const QString id = settingsResp.value(QStringLiteral("clientId")).toString();
        if (!id.isEmpty()) {
            m_settings->setSoundcloudClientId(id);
            emit clientIdChanged();
        }
    }
}

QCoro::Task<> SoundCloud::runConnect(QString clientId, QString token, quint64 generation)
{
    // the client id is what signs a stream url, so it goes first: without one
    // the account would connect and then play nothing
    const QJsonObject updated = co_await call(QStringLiteral("settings.update"),
                                              { { QStringLiteral("clientId"), clientId } });
    if (generation != m_connectGeneration) {
        co_return;
    }
    if (updated.contains(QStringLiteral("error"))) {
        setBusy(false);
        m_browserLogin->cancel();
        setStatusMessage(updated.value(QStringLiteral("error")).toString());
        co_return;
    }

    const QJsonObject login = co_await call(QStringLiteral("auth.login"),
                                            { { QStringLiteral("token"), token } });
    if (generation != m_connectGeneration) {
        co_return;
    }
    // one way or another the connect is over, and the sign-in window can go
    m_browserLogin->cancel();
    setBusy(false);
    if (login.contains(QStringLiteral("error"))) {
        setStatusMessage(login.value(QStringLiteral("error")).toString());
        co_return;
    }
    applyStatus(login);
    const QJsonObject profile = login.value(QStringLiteral("profile")).toObject();
    setStatusMessage(QStringLiteral("SoundCloud connected as %1")
                         .arg(profile.value(QStringLiteral("username")).toString()));
}

void SoundCloud::connectAccount(const QString &clientId, const QString &token)
{
    const QString id = clientId.trimmed();
    const QString accessToken = token.trimmed();
    if (!available()) {
        setStatusMessage(QStringLiteral("This build has no SoundCloud service."));
        return;
    }
    if (id.isEmpty() || accessToken.isEmpty()) {
        setStatusMessage(QStringLiteral("Paste the SoundCloud client id and access token."));
        return;
    }
    setClientId(id);
    const quint64 generation = ++m_connectGeneration;
    setStatusMessage(QString());
    setBusy(true);
    detach(runConnect(id, accessToken, generation));
}

void SoundCloud::loginWithBrowser()
{
    if (m_browserLogin == nullptr || m_browserLogin->active()) {
        return;
    }
    clearStatusMessage();
    m_browserLogin->start();
}

void SoundCloud::cancelBrowserLogin()
{
    if (m_browserLogin != nullptr && m_browserLogin->active()) {
        m_browserLogin->cancel();
    }
}

bool SoundCloud::browserLoginActive() const
{
    return m_browserLogin != nullptr && m_browserLogin->active();
}

void SoundCloud::logOut()
{
    ++m_connectGeneration;
    setBusy(true);
    detach(logOutTask());
}

QCoro::Task<> SoundCloud::logOutTask()
{
    const QJsonObject status = co_await call(QStringLiteral("auth.logout"));
    setBusy(false);
    applyStatus(status.contains(QStringLiteral("error")) ? QJsonObject {} : status);
    setStatusMessage(QStringLiteral("SoundCloud disconnected."));
}

Song SoundCloud::songFromCard(const QJsonObject &card)
{
    Song song;
    song.source = QStringLiteral("soundcloud");
    song.nativeId = numericId(card.value(QStringLiteral("id")));
    // playlist and track cards spell the urn one way, search cards another
    song.uri = card.value(QStringLiteral("trackUrn")).toString();
    if (song.uri.isEmpty()) {
        song.uri = card.value(QStringLiteral("urn")).toString();
    }
    if (song.uri.isEmpty() && !song.nativeId.isEmpty()) {
        song.uri = QStringLiteral("soundcloud:tracks:") + song.nativeId;
    }
    song.name = card.value(QStringLiteral("title")).toString();
    const QJsonObject user = card.value(QStringLiteral("user")).toObject();
    song.artists = user.value(QStringLiteral("username")).toString();
    const QString userId = numericId(user.value(QStringLiteral("id")));
    if (!userId.isEmpty()) {
        Artist artist;
        artist.id = userId;
        artist.name = song.artists;
        artist.artworkUrl = upsizedArtwork(QUrl(user.value(QStringLiteral("avatarUrl")).toString()));
        artist.source = QStringLiteral("soundcloud");
        artist.uri = QStringLiteral("soundcloud:users:") + userId;
        song.artistItems = { artist };
    }
    QUrl artwork = upsizedArtwork(QUrl(card.value(QStringLiteral("artworkUrl")).toString()));
    if (artwork.isEmpty()) {
        artwork = upsizedArtwork(QUrl(user.value(QStringLiteral("avatarUrl")).toString()));
    }
    song.artworkUrl = artwork;
    song.permalink = QUrl(card.value(QStringLiteral("permalinkUrl")).toString());
    // soundcloud counts a track's length in milliseconds, as the app does
    song.durationMs = int(card.value(QStringLiteral("duration")).toDouble());
    return song;
}

QList<Song> SoundCloud::songsFromCards(const QJsonArray &cards)
{
    QList<Song> songs;
    songs.reserve(cards.size());
    for (const QJsonValue &value : cards) {
        const Song song = songFromCard(value.toObject());
        if (song.isValid()) {
            songs.append(song);
        }
    }
    return songs;
}

QCoro::Task<QList<Song>> SoundCloud::likedSongs()
{
    if (!m_connected || m_userId.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    m_likedSongsNextHref.clear();
    m_hasMoreLikedSongs = false;
    emit hasMoreLikedSongsChanged();

    QJsonObject params {
        { QStringLiteral("userId"), m_userId.toLongLong() },
        { QStringLiteral("limit"), 20 },
    };
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.likes"), params);
    if (!response.ok()) {
        report(response.error);
        co_return QList<Song> {};
    }
    const QJsonObject obj = response.result;
    const QList<Song> songs = songsFromCards(obj.value(QStringLiteral("tracks")).toArray());
    m_likedSongsNextHref = obj.value(QStringLiteral("nextHref")).toString();
    m_hasMoreLikedSongs = !m_likedSongsNextHref.isEmpty();
    emit hasMoreLikedSongsChanged();
    co_return songs;
}

void SoundCloud::loadMoreLikedSongs()
{
    if (m_loadingMoreLikes || !m_hasMoreLikedSongs || m_likedSongsNextHref.isEmpty() || m_sidecar == nullptr) {
        return;
    }
    detach(loadMoreLikedSongsTask());
}

QCoro::Task<> SoundCloud::loadMoreLikedSongsTask()
{
    m_loadingMoreLikes = true;
    emit loadingMoreLikesChanged();

    QJsonObject params {
        { QStringLiteral("userId"), m_userId.toLongLong() },
        { QStringLiteral("limit"), 20 },
        { QStringLiteral("next"), m_likedSongsNextHref },
    };
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.likes"), params);
    if (response.ok()) {
        const QJsonObject obj = response.result;
        const QList<Song> newSongs = songsFromCards(obj.value(QStringLiteral("tracks")).toArray());
        m_likedSongsNextHref = obj.value(QStringLiteral("nextHref")).toString();
        m_hasMoreLikedSongs = !m_likedSongsNextHref.isEmpty();
        emit hasMoreLikedSongsChanged();

        if (!newSongs.isEmpty() && LibraryStore::instance() != nullptr) {
            LibraryStore::instance()->savedSongs()->appendSongs(newSongs);
            for (const Song &s : newSongs) {
                LibraryStore::instance()->recordSavedUri(s.uri);
            }
        }
    }
    m_loadingMoreLikes = false;
    emit loadingMoreLikesChanged();
}

QCoro::Task<QList<Playlist>> SoundCloud::playlists()
{
    if (!m_connected || m_sidecar == nullptr) {
        co_return QList<Playlist> {};
    }
    // Use m_sidecar->call() directly: the backend returns a JSON array from
    // playlists.mine, but the helper call() only fills response.result for
    // objects; an array lands in response.resultValue instead.
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("playlists.mine"));
    if (!response.ok()) {
        report(response.error);
        co_return QList<Playlist> {};
    }
    QJsonArray cards;
    if (response.resultValue.isArray()) {
        cards = response.resultValue.toArray();
    } else if (response.result.contains(QStringLiteral("playlists"))) {
        cards = response.result.value(QStringLiteral("playlists")).toArray();
    }

    QList<Playlist> playlists;
    playlists.reserve(cards.size());
    for (const QJsonValue &value : cards) {
        const QJsonObject card = value.toObject();
        Playlist playlist;
        playlist.source = QStringLiteral("soundcloud");
        playlist.id = numericId(card.value(QStringLiteral("id")));
        playlist.uri = card.value(QStringLiteral("urn")).toString();
        if (playlist.uri.isEmpty() && !playlist.id.isEmpty()) {
            playlist.uri = QStringLiteral("soundcloud:playlists:") + playlist.id;
        }
        playlist.name = card.value(QStringLiteral("title")).toString();
        playlist.artworkUrl = upsizedArtwork(QUrl(card.value(QStringLiteral("artworkUrl")).toString()));
        playlist.songCount = int(card.value(QStringLiteral("trackCount")).toDouble());
        playlist.ownerName = card.value(QStringLiteral("user")).toObject().value(QStringLiteral("username")).toString();
        if (playlist.isValid()) {
            playlists.append(playlist);
        }
    }
    co_return playlists;
}

QCoro::Task<QList<Song>> SoundCloud::playlistSongs(const Playlist &playlist)
{
    QString uri = playlist.uri;
    if (uri.isEmpty() && !playlist.id.isEmpty()) {
        uri = QStringLiteral("soundcloud:playlists:") + playlist.id;
    }
    if (!m_connected || uri.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("playlist.tracks"),
                                                               { { QStringLiteral("playlistUrn"), uri } });
    if (!response.ok()) {
        report(response.error);
        co_return QList<Song> {};
    }
    QJsonArray cards;
    if (response.resultValue.isArray()) {
        cards = response.resultValue.toArray();
    } else if (response.result.contains(QStringLiteral("tracks"))) {
        cards = response.result.value(QStringLiteral("tracks")).toArray();
    }
    co_return songsFromCards(cards);
}

QCoro::Task<QList<Song>> SoundCloud::searchSongs(QString query)
{
    const QString trimmed = query.trimmed();
    if (!m_connected || trimmed.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("search.tracks"),
                                                               { { QStringLiteral("query"), trimmed } });
    if (!response.ok()) {
        report(response.error);
        co_return QList<Song> {};
    }
    QJsonArray cards;
    if (response.resultValue.isArray()) {
        cards = response.resultValue.toArray();
    } else if (response.result.contains(QStringLiteral("tracks"))) {
        cards = response.result.value(QStringLiteral("tracks")).toArray();
    }
    co_return songsFromCards(cards);
}

void SoundCloud::pruneStreamCache(const QString &keeping)
{
    const qint64 limit = qint64(m_settings != nullptr ? m_settings->songCacheMegabytes() : 1000) * 1000 * 1000;
    QDir directory(streamCacheDirectory());
    const QFileInfoList entries = directory.entryInfoList(QDir::Files, QDir::Time);
    qint64 total = 0;
    for (const QFileInfo &entry : entries) {
        total += entry.size();
    }
    // oldest first, which is how entryInfoList sorted them
    for (const QFileInfo &entry : entries) {
        if (total <= limit) {
            break;
        }
        if (entry.absoluteFilePath() == keeping) {
            continue;
        }
        const qint64 size = entry.size();
        if (QFile::remove(entry.absoluteFilePath())) {
            total -= size;
        }
    }
}

QCoro::Task<QString> SoundCloud::streamPath(const Song &song)
{
    if (m_sidecar == nullptr) {
        throw SpotifyError(SpotifyError::Kind::Core,
                           QStringLiteral("This build has no SoundCloud service."));
    }
    if (!m_connected) {
        throw SpotifyError(SpotifyError::Kind::Unauthorized,
                           QStringLiteral("Connect your SoundCloud account to play this track."));
    }

    const QJsonObject stream = co_await call(QStringLiteral("track.stream"),
                                             { { QStringLiteral("trackUrn"), song.uri } });
    if (stream.contains(QStringLiteral("error"))) {
        throw SpotifyError(SpotifyError::Kind::RequestFailed,
                           stream.value(QStringLiteral("error")).toString());
    }

    // two-pass: prefer progressive (plain file the core decodes); fall back to
    // the hls stream when a track has no progressive alternative at all
    struct StreamOption {
        QString url;
        bool hls = false;
        bool preview = false;
    };
    StreamOption best;
    const auto consider = [&](const QJsonObject &option) {
        const QString u = option.value(QStringLiteral("url")).toString();
        if (u.isEmpty()) {
            return;
        }
        const bool h = option.value(QStringLiteral("hls")).toBool();
        const bool p = option.value(QStringLiteral("preview")).toBool();
        if (best.url.isEmpty()) {
            best = { u, h, p };
        } else if (best.hls && !h) {
            // upgrade: replace an hls candidate with a progressive one
            best = { u, h, p };
        }
    };
    consider(stream);
    for (const QJsonValue &v : stream.value(QStringLiteral("alternatives")).toArray()) {
        consider(v.toObject());
    }
    if (best.url.isEmpty()) {
        throw SpotifyError(SpotifyError::Kind::RequestFailed,
                           QStringLiteral("SoundCloud returned no playable stream for this track."));
    }

    if (best.hls) {
        qCDebug(lcSoundCloud) << "playing hls stream for" << song.uri;
        co_return co_await downloadHlsStream(best.url, song.uri);
    }
    co_return co_await downloadProgressiveStream(best.url, song.uri, best.preview);
}

QCoro::Task<QString> SoundCloud::downloadProgressiveStream(const QString &url,
                                                            const QString &uri,
                                                            bool preview)
{
    if (preview) {
        qCDebug(lcSoundCloud) << "playing the soundcloud preview of" << uri;
    }

    const QString directory = streamCacheDirectory();
    const QString path = directory + '/' + streamCacheKey(uri) + QStringLiteral(".mp3");
    if (QFileInfo fi(path); fi.exists() && fi.size() > 0) {
        co_return path;
    }

    QNetworkRequest request((QUrl(url)));
    request.setHeader(QNetworkRequest::UserAgentHeader, QByteArrayLiteral("Resonance"));
    request.setTransferTimeout(kStreamTransferTimeoutMs);
    std::unique_ptr<QNetworkReply> reply(m_network->get(request));
    co_await qCoro(reply.get()).waitForFinished();
    if (reply->error() != QNetworkReply::NoError) {
        throw SpotifyError::requestFailed(reply->errorString());
    }
    const QByteArray audio = reply->readAll();
    if (audio.isEmpty()) {
        throw SpotifyError(SpotifyError::Kind::RequestFailed,
                           QStringLiteral("SoundCloud returned an empty stream."));
    }

    const QString partial = path + QStringLiteral(".part");
    QFile file(partial);
    if (!file.open(QIODevice::WriteOnly)) {
        throw SpotifyError(SpotifyError::Kind::Core,
                           QStringLiteral("Could not write the SoundCloud stream to the cache."));
    }
    file.write(audio);
    file.close();

    QFile::remove(path);
    if (normalizeAudio(partial, path)) {
        QFile::remove(partial);
    } else if (!QFile::rename(partial, path)) {
        QFile::remove(partial);
        throw SpotifyError(SpotifyError::Kind::Core,
                           QStringLiteral("Could not keep the SoundCloud stream in the cache."));
    }
    pruneStreamCache(path);
    co_return path;
}

QCoro::Task<QString> SoundCloud::downloadHlsStream(const QString &m3u8Url, const QString &uri)
{
    const QString directory = streamCacheDirectory();

    // ── step 1: fetch the M3U8 playlist ──────────────────────────────────────
    QNetworkRequest req((QUrl(m3u8Url)));
    req.setHeader(QNetworkRequest::UserAgentHeader, QByteArrayLiteral("Resonance"));
    req.setTransferTimeout(30'000);
    std::unique_ptr<QNetworkReply> m3u8Reply(m_network->get(req));
    co_await qCoro(m3u8Reply.get()).waitForFinished();
    if (m3u8Reply->error() != QNetworkReply::NoError) {
        throw SpotifyError::requestFailed(
            QStringLiteral("HLS M3U8 fetch failed: ") + m3u8Reply->errorString());
    }
    const QString m3u8 = QString::fromUtf8(m3u8Reply->readAll());

    // ── step 2: parse init segment (EXT-X-MAP) and segment URLs ──────────────
    QString initSegmentUrl;
    QStringList segments;
    const QUrl base(m3u8Url);
    static const QRegularExpression mapRegex(QStringLiteral(R"(#EXT-X-MAP:URI=["']?([^"']+)["']?)"));

    for (const QStringView line : QStringView(m3u8).split(u'\n')) {
        const QStringView trimmed = line.trimmed();
        if (trimmed.isEmpty()) {
            continue;
        }
        if (trimmed.startsWith(QLatin1StringView("#EXT-X-MAP:"))) {
            const auto match = mapRegex.match(trimmed.toString());
            if (match.hasMatch()) {
                initSegmentUrl = base.resolved(QUrl(match.captured(1))).toString();
            }
            continue;
        }
        if (trimmed.startsWith(u'#')) {
            continue;
        }
        const QUrl segUrl = base.resolved(QUrl(trimmed.toString()));
        segments.append(segUrl.toString());
    }
    if (segments.isEmpty()) {
        throw SpotifyError(SpotifyError::Kind::RequestFailed,
                           QStringLiteral("HLS playlist contained no segments."));
    }

    const bool isMp4 = !initSegmentUrl.isEmpty()
        || segments.first().contains(QLatin1StringView(".m4s"))
        || segments.first().contains(QLatin1StringView(".mp4"));
    const QString ext = isMp4 ? QStringLiteral(".m4a") : QStringLiteral(".mp3");
    const QString path = directory + '/' + streamCacheKey(uri) + ext;
    if (QFileInfo fi(path); fi.exists() && fi.size() > 1024) {
        co_return path;
    }

    qCDebug(lcSoundCloud) << "HLS: downloading"
                          << (initSegmentUrl.isEmpty() ? 0 : 1) << "init +"
                          << segments.size() << "segments for" << uri;

    // ── step 3: download init segment and every media segment ────────────────
    const QString partial = path + QStringLiteral(".part");
    QFile file(partial);
    if (!file.open(QIODevice::WriteOnly)) {
        throw SpotifyError(SpotifyError::Kind::Core,
                           QStringLiteral("Could not create HLS cache file."));
    }

    if (!initSegmentUrl.isEmpty()) {
        QNetworkRequest initReq((QUrl(initSegmentUrl)));
        initReq.setHeader(QNetworkRequest::UserAgentHeader, QByteArrayLiteral("Resonance"));
        initReq.setTransferTimeout(20'000);
        std::unique_ptr<QNetworkReply> initReply(m_network->get(initReq));
        co_await qCoro(initReply.get()).waitForFinished();
        if (initReply->error() != QNetworkReply::NoError) {
            file.close();
            QFile::remove(partial);
            throw SpotifyError::requestFailed(
                QStringLiteral("HLS init segment fetch failed: ") + initReply->errorString());
        }
        file.write(initReply->readAll());
    }

    for (const QString &segmentUrl : std::as_const(segments)) {
        QNetworkRequest segReq((QUrl(segmentUrl)));
        segReq.setHeader(QNetworkRequest::UserAgentHeader, QByteArrayLiteral("Resonance"));
        segReq.setTransferTimeout(20'000);
        std::unique_ptr<QNetworkReply> segReply(m_network->get(segReq));
        co_await qCoro(segReply.get()).waitForFinished();
        if (segReply->error() != QNetworkReply::NoError) {
            file.close();
            QFile::remove(partial);
            throw SpotifyError::requestFailed(
                QStringLiteral("HLS segment fetch failed: ") + segReply->errorString());
        }
        file.write(segReply->readAll());
    }
    file.close();

    // ── step 4: normalize audio container & metadata ────────────────────────
    QFile::remove(path);
    if (normalizeAudio(partial, path)) {
        QFile::remove(partial);
    } else if (!QFile::rename(partial, path)) {
        QFile::remove(partial);
        throw SpotifyError(SpotifyError::Kind::Core,
                           QStringLiteral("Could not keep the HLS stream in the cache."));
    }
    pruneStreamCache(path);
    co_return path;
}

QCoro::Task<std::optional<Lyrics>> SoundCloud::lyrics(const Song &song)
{
    if (m_sidecar == nullptr) {
        co_return std::nullopt;
    }

    qint64 trackId = song.nativeId.toLongLong();
    if (trackId <= 0) {
        static const QRegularExpression digits(QStringLiteral(R"(\d+)"));
        const auto match = digits.match(song.uri);
        if (match.hasMatch()) {
            trackId = match.captured(0).toLongLong();
        }
    }
    if (trackId <= 0) {
        trackId = qint64(qHash(song.uri));
        if (trackId < 0) {
            trackId = -trackId;
        }
        if (trackId == 0) {
            trackId = 1;
        }
    }

    const QJsonObject params {
        { QStringLiteral("trackId"), trackId },
        { QStringLiteral("title"), song.name },
        { QStringLiteral("artist"), song.artists },
        { QStringLiteral("durationMs"), song.durationMs },
    };

    const QJsonObject response = co_await call(QStringLiteral("track.lyrics"), params);
    if (response.isEmpty() || response.contains(QStringLiteral("error"))) {
        co_return std::nullopt;
    }

    co_return Lyrics::fromSidecarJson(response);
}

QCoro::Task<SoundCloudArtistProfile> SoundCloud::fetchUserProfile(qint64 userId)
{
    if (!m_connected || userId <= 0 || m_sidecar == nullptr) {
        co_return SoundCloudArtistProfile {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.profile"),
                                                               { { QStringLiteral("userId"), userId } });
    if (!response.ok()) {
        qCWarning(lcSoundCloud) << "user.profile failed:" << response.error;
        co_return SoundCloudArtistProfile {};
    }
    const QJsonObject obj = response.result;
    SoundCloudArtistProfile profile;
    profile.id = numericId(obj.value(QStringLiteral("id")));
    profile.username = obj.value(QStringLiteral("username")).toString();
    profile.fullName = obj.value(QStringLiteral("fullName")).toString();
    profile.permalink = QUrl(obj.value(QStringLiteral("permalinkUrl")).toString());
    profile.avatarUrl = upsizedArtwork(QUrl(obj.value(QStringLiteral("avatarUrl")).toString()));
    profile.bannerUrl = QUrl(obj.value(QStringLiteral("bannerUrl")).toString());
    profile.description = obj.value(QStringLiteral("description")).toString();
    profile.city = obj.value(QStringLiteral("city")).toString();
    profile.country = obj.value(QStringLiteral("country")).toString();
    profile.followersCount = qint64(obj.value(QStringLiteral("followersCount")).toDouble());
    profile.followingsCount = qint64(obj.value(QStringLiteral("followingsCount")).toDouble());
    profile.trackCount = qint64(obj.value(QStringLiteral("trackCount")).toDouble());
    profile.likesCount = qint64(obj.value(QStringLiteral("likesCount")).toDouble());
    profile.verified = obj.value(QStringLiteral("verified")).toBool();
    co_return profile;
}

QCoro::Task<QList<Song>> SoundCloud::fetchUserTracks(qint64 userId)
{
    if (!m_connected || userId <= 0 || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    m_artistTracksUserId = userId;
    m_artistTracksNextHref.clear();
    m_hasMoreArtistTracks = false;
    emit hasMoreArtistTracksChanged();

    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.tracks"),
                                                               { { QStringLiteral("userId"), userId },
                                                                 { QStringLiteral("paginated"), true },
                                                                 { QStringLiteral("limit"), 20 } });
    if (!response.ok()) {
        qCWarning(lcSoundCloud) << "user.tracks failed:" << response.error;
        co_return QList<Song> {};
    }
    QJsonArray cards;
    if (response.resultValue.isArray()) {
        cards = response.resultValue.toArray();
    } else if (response.result.contains(QStringLiteral("tracks"))) {
        const QJsonObject obj = response.result;
        cards = obj.value(QStringLiteral("tracks")).toArray();
        m_artistTracksNextHref = obj.value(QStringLiteral("nextHref")).toString();
        m_hasMoreArtistTracks = !m_artistTracksNextHref.isEmpty();
        emit hasMoreArtistTracksChanged();
    }
    co_return songsFromCards(cards);
}

QCoro::Task<QList<Playlist>> SoundCloud::fetchUserPlaylists(qint64 userId)
{
    if (!m_connected || userId <= 0 || m_sidecar == nullptr) {
        co_return QList<Playlist> {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.playlists"),
                                                               { { QStringLiteral("userId"), userId } });
    if (!response.ok()) {
        qCWarning(lcSoundCloud) << "user.playlists failed:" << response.error;
        co_return QList<Playlist> {};
    }
    QJsonArray cards;
    if (response.resultValue.isArray()) {
        cards = response.resultValue.toArray();
    } else if (response.result.contains(QStringLiteral("playlists"))) {
        cards = response.result.value(QStringLiteral("playlists")).toArray();
    }
    QList<Playlist> playlists;
    playlists.reserve(cards.size());
    for (const QJsonValue &value : cards) {
        const QJsonObject card = value.toObject();
        Playlist playlist;
        playlist.source = QStringLiteral("soundcloud");
        playlist.id = numericId(card.value(QStringLiteral("id")));
        playlist.uri = card.value(QStringLiteral("urn")).toString();
        if (playlist.uri.isEmpty() && !playlist.id.isEmpty()) {
            playlist.uri = QStringLiteral("soundcloud:playlists:") + playlist.id;
        }
        playlist.name = card.value(QStringLiteral("title")).toString();
        playlist.artworkUrl = upsizedArtwork(QUrl(card.value(QStringLiteral("artworkUrl")).toString()));
        playlist.songCount = int(card.value(QStringLiteral("trackCount")).toDouble());
        playlist.ownerName = card.value(QStringLiteral("user")).toObject().value(QStringLiteral("username")).toString();
        if (playlist.isValid()) {
            playlists.append(playlist);
        }
    }
    co_return playlists;
}

QCoro::Task<QList<Song>> SoundCloud::fetchUserLikes(qint64 userId)
{
    if (!m_connected || userId <= 0 || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    m_artistLikesUserId = userId;
    m_artistLikesNextHref.clear();
    m_hasMoreArtistLikes = false;
    emit hasMoreArtistLikesChanged();

    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.likes"),
                                                               { { QStringLiteral("userId"), userId },
                                                                 { QStringLiteral("limit"), 20 } });
    if (!response.ok()) {
        qCWarning(lcSoundCloud) << "user.likes failed:" << response.error;
        co_return QList<Song> {};
    }
    const QJsonObject obj = response.result;
    const QJsonArray cards = obj.value(QStringLiteral("tracks")).toArray();
    m_artistLikesNextHref = obj.value(QStringLiteral("nextHref")).toString();
    m_hasMoreArtistLikes = !m_artistLikesNextHref.isEmpty();
    emit hasMoreArtistLikesChanged();
    co_return songsFromCards(cards);
}

void SoundCloud::loadMoreArtistLikes()
{
    if (m_loadingMoreArtistLikes || !m_hasMoreArtistLikes || m_artistLikesNextHref.isEmpty() || m_sidecar == nullptr || m_artistLikesUserId <= 0) {
        return;
    }
    detach(loadMoreArtistLikesTask());
}

QCoro::Task<> SoundCloud::loadMoreArtistLikesTask()
{
    m_loadingMoreArtistLikes = true;
    emit loadingMoreArtistLikesChanged();

    QJsonObject params {
        { QStringLiteral("userId"), m_artistLikesUserId },
        { QStringLiteral("limit"), 20 },
        { QStringLiteral("next"), m_artistLikesNextHref },
    };
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.likes"), params);
    if (response.ok()) {
        const QJsonObject obj = response.result;
        const QList<Song> newSongs = songsFromCards(obj.value(QStringLiteral("tracks")).toArray());
        m_artistLikesNextHref = obj.value(QStringLiteral("nextHref")).toString();
        m_hasMoreArtistLikes = !m_artistLikesNextHref.isEmpty();
        emit hasMoreArtistLikesChanged();

        if (!newSongs.isEmpty()) {
            m_artistLikes->appendSongs(newSongs);
        }
    }
    m_loadingMoreArtistLikes = false;
    emit loadingMoreArtistLikesChanged();
}

void SoundCloud::loadMoreArtistTracks()
{
    if (m_loadingMoreArtistTracks || !m_hasMoreArtistTracks || m_artistTracksNextHref.isEmpty() || m_sidecar == nullptr || m_artistTracksUserId <= 0) {
        return;
    }
    detach(loadMoreArtistTracksTask());
}

QCoro::Task<> SoundCloud::loadMoreArtistTracksTask()
{
    m_loadingMoreArtistTracks = true;
    emit loadingMoreArtistTracksChanged();

    QJsonObject params {
        { QStringLiteral("userId"), m_artistTracksUserId },
        { QStringLiteral("paginated"), true },
        { QStringLiteral("limit"), 20 },
        { QStringLiteral("next"), m_artistTracksNextHref },
    };
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("user.tracks"), params);
    if (response.ok()) {
        const QJsonObject obj = response.result;
        const QList<Song> newSongs = songsFromCards(obj.value(QStringLiteral("tracks")).toArray());
        m_artistTracksNextHref = obj.value(QStringLiteral("nextHref")).toString();
        m_hasMoreArtistTracks = !m_artistTracksNextHref.isEmpty();
        emit hasMoreArtistTracksChanged();

        if (!newSongs.isEmpty()) {
            m_artistTracks->appendSongs(newSongs);
        }
    }
    m_loadingMoreArtistTracks = false;
    emit loadingMoreArtistTracksChanged();
}

QCoro::Task<SoundCloudTrackDetails> SoundCloud::fetchTrackDetails(qint64 trackId)
{
    if (!m_connected || trackId <= 0 || m_sidecar == nullptr) {
        co_return SoundCloudTrackDetails {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("track.details"),
                                                               { { QStringLiteral("trackId"), trackId } });
    if (!response.ok()) {
        qCWarning(lcSoundCloud) << "track.details failed:" << response.error;
        co_return SoundCloudTrackDetails {};
    }
    const QJsonObject obj = response.result;
    SoundCloudTrackDetails details;
    details.id = numericId(obj.value(QStringLiteral("id")));
    details.urn = obj.value(QStringLiteral("urn")).toString();
    details.title = obj.value(QStringLiteral("title")).toString();
    details.permalink = QUrl(obj.value(QStringLiteral("permalinkUrl")).toString());
    details.artworkUrl = upsizedArtwork(QUrl(obj.value(QStringLiteral("artworkUrl")).toString()));
    details.description = obj.value(QStringLiteral("description")).toString();
    details.genre = obj.value(QStringLiteral("genre")).toString();
    details.tagList = obj.value(QStringLiteral("tagList")).toString();
    details.durationMs = int(obj.value(QStringLiteral("duration")).toDouble());
    details.playbackCount = qint64(obj.value(QStringLiteral("playbackCount")).toDouble());
    details.likesCount = qint64(obj.value(QStringLiteral("likesCount")).toDouble());
    details.repostsCount = qint64(obj.value(QStringLiteral("repostsCount")).toDouble());
    details.commentCount = qint64(obj.value(QStringLiteral("commentCount")).toDouble());
    details.createdAt = obj.value(QStringLiteral("createdAt")).toString();
    details.displayDate = obj.value(QStringLiteral("displayDate")).toString();
    details.waveformUrl = QUrl(obj.value(QStringLiteral("waveformUrl")).toString());

    const QJsonObject user = obj.value(QStringLiteral("user")).toObject();
    details.artistId = numericId(user.value(QStringLiteral("id")));
    details.artistName = user.value(QStringLiteral("username")).toString();
    details.artistAvatar = upsizedArtwork(QUrl(user.value(QStringLiteral("avatarUrl")).toString()));
    details.artistFollowers = qint64(user.value(QStringLiteral("followersCount")).toDouble());
    co_return details;
}

QCoro::Task<QList<Song>> SoundCloud::fetchRelatedTracks(qint64 trackId)
{
    if (!m_connected || trackId <= 0 || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("track.related"),
                                                               { { QStringLiteral("trackId"), trackId } });
    if (!response.ok()) {
        qCWarning(lcSoundCloud) << "track.related failed:" << response.error;
        co_return QList<Song> {};
    }
    QJsonArray cards;
    if (response.resultValue.isArray()) {
        cards = response.resultValue.toArray();
    } else if (response.result.contains(QStringLiteral("tracks"))) {
        cards = response.result.value(QStringLiteral("tracks")).toArray();
    }
    co_return songsFromCards(cards);
}

QCoro::Task<Artist> SoundCloud::artistFromSong(const Song &song)
{
    if (!song.artistItems.isEmpty() && song.artistItems.first().isValid()) {
        co_return song.artistItems.first();
    }
    qint64 trackId = song.nativeId.toLongLong();
    if (trackId <= 0 && song.uri.startsWith(QLatin1StringView("soundcloud:tracks:"))) {
        trackId = QStringView(song.uri).mid(18).toLongLong();
    }
    if (trackId > 0) {
        SoundCloudTrackDetails details = co_await fetchTrackDetails(trackId);
        if (!details.artistId.isEmpty()) {
            Artist artist;
            artist.id = details.artistId;
            artist.name = details.artistName.isEmpty() ? song.artists : details.artistName;
            artist.artworkUrl = details.artistAvatar;
            artist.source = QStringLiteral("soundcloud");
            artist.uri = QStringLiteral("soundcloud:users:") + details.artistId;
            co_return artist;
        }
    }
    Artist fallback;
    fallback.name = song.artists;
    fallback.source = QStringLiteral("soundcloud");
    co_return fallback;
}

QCoro::Task<> SoundCloud::loadArtistData(qint64 userId, quint64 generation)
{
    m_loadingArtist = true;
    emit loadingArtistChanged();

    m_artistTracks->clear();
    m_artistLikes->clear();
    m_artistPlaylists->setItems({});

    SoundCloudArtistProfile profile = co_await fetchUserProfile(userId);
    if (generation != m_artistGeneration) co_return;
    m_currentArtist = profile;
    emit currentArtistChanged();

    QList<Song> tracks = co_await fetchUserTracks(userId);
    if (generation != m_artistGeneration) co_return;
    m_artistTracks->setSongs(tracks);

    QList<Playlist> playlists = co_await fetchUserPlaylists(userId);
    if (generation != m_artistGeneration) co_return;
    m_artistPlaylists->setItems(playlists);

    QList<Song> likes = co_await fetchUserLikes(userId);
    if (generation != m_artistGeneration) co_return;
    m_artistLikes->setSongs(likes);

    m_loadingArtist = false;
    emit loadingArtistChanged();
}

QCoro::Task<> SoundCloud::loadTrackDetailsData(Song song, quint64 generation)
{
    m_loadingTrackDetails = true;
    emit loadingTrackDetailsChanged();

    m_relatedTracks->clear();

    qint64 trackId = song.nativeId.toLongLong();
    if (trackId <= 0 && song.uri.startsWith(QLatin1StringView("soundcloud:tracks:"))) {
        trackId = QStringView(song.uri).mid(18).toLongLong();
    }
    if (trackId <= 0) {
        m_loadingTrackDetails = false;
        emit loadingTrackDetailsChanged();
        co_return;
    }

    SoundCloudTrackDetails details = co_await fetchTrackDetails(trackId);
    if (generation != m_trackDetailsGeneration) co_return;
    if (!details.isValid()) {
        details.id = QString::number(trackId);
        details.title = song.name;
        details.artworkUrl = song.artworkUrl;
        details.artistName = song.artists;
        details.durationMs = song.durationMs;
    }
    m_currentTrackDetails = details;
    emit currentTrackDetailsChanged();

    QList<Song> related = co_await fetchRelatedTracks(trackId);
    if (generation != m_trackDetailsGeneration) co_return;
    m_relatedTracks->setSongs(related);

    m_loadingTrackDetails = false;
    emit loadingTrackDetailsChanged();
}

void SoundCloud::openArtist(const QString &userIdOrUsername)
{
    qint64 userId = userIdOrUsername.toLongLong();
    if (userId > 0) {
        detach(loadArtistData(userId, ++m_artistGeneration));
    }
}

void SoundCloud::openArtistFromSong(const resonance::Song &song)
{
    detach(openArtistFromSongTask(song));
}

QCoro::Task<> SoundCloud::openArtistFromSongTask(Song song)
{
    Artist artist = co_await artistFromSong(song);
    if (artist.isValid()) {
        openArtist(artist.id);
    }
}

void SoundCloud::openTrackDetails(const resonance::Song &song)
{
    detach(loadTrackDetailsData(song, ++m_trackDetailsGeneration));
}

} // namespace resonance
