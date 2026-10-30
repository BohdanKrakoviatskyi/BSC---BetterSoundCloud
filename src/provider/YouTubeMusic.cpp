#include "provider/YouTubeMusic.h"

#include "app/AppController.h"
#include "app/ErrorCenter.h"
#include "app/Paths.h"
#include "app/Settings.h"
#include "core/Async.h"
#include "library/LibraryStore.h"
#include "provider/SidecarClient.h"
#include "spotify/SpotifyError.h"

#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QHostAddress>
#include <QJSEngine>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLoggingCategory>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QProcess>
#include <QRegularExpression>
#include <QStandardPaths>
#include <QTcpSocket>
#include <QUrlQuery>

#include <QCoroNetworkReply>
#include <QCoroProcess>

#include <utility>

Q_LOGGING_CATEGORY(lcYouTube, "resonance.youtube")

namespace resonance {

namespace {

YouTubeMusic *s_instance = nullptr;

// the app's own OAuth credentials, injected by cmake from the gitignored
// cmake/YoutubeOAuth.local.cmake. both stay empty in a clone that has no such
// file, and effectiveCredentials() then reports that the login needs
// credentials from Settings or the BSC_YOUTUBE_* environment variables
#ifndef RESONANCE_YOUTUBE_CLIENT_ID
#define RESONANCE_YOUTUBE_CLIENT_ID ""
#endif
#ifndef RESONANCE_YOUTUBE_CLIENT_SECRET
#define RESONANCE_YOUTUBE_CLIENT_SECRET ""
#endif
constexpr auto kYouTubeAuthorizeUrl = "https://accounts.google.com/o/oauth2/v2/auth";
constexpr auto kYouTubeScopes =
    "https://www.googleapis.com/auth/youtube.readonly "
    "https://www.googleapis.com/auth/youtube.force-ssl "
    "openid email profile";

const QByteArray kCallbackHtml =
    "<!doctype html><meta charset=utf-8><title>Resonance — YouTube Music</title>"
    "<style>body{font:16px system-ui,sans-serif;background:#141313;color:#e6e1e1;"
    "display:grid;place-items:center;height:100vh;margin:0;text-align:center}"
    ".box{padding:32px;border-radius:18px;background:#1f1d1d}</style>"
    "<div class=box><h2>YouTube Music подключён!</h2>"
    "<p>Вы можете закрыть эту вкладку и вернуться в Resonance.</p></div>";

QByteArray httpResponse(int status, const QByteArray &reason, const QByteArray &body)
{
    return "HTTP/1.1 " + QByteArray::number(status) + ' ' + reason + "\r\n"
        "Content-Type: text/html; charset=utf-8\r\n"
        "Content-Length: " + QByteArray::number(body.size()) + "\r\n"
        "Connection: close\r\n\r\n" + body;
}

bool isYouTubeRedirect(const QUrl &url)
{
    const QString host = url.host().toLower();
    const bool hostMatches = (host == QLatin1StringView("localhost") || host == QLatin1StringView("127.0.0.1"));
    return hostMatches && url.port() == YouTubeMusic::kRedirectPort && url.path() == QLatin1StringView("/callback");
}

QString videoIdFromSong(const Song &song)
{
    if (!song.nativeId.trimmed().isEmpty()) {
        return song.nativeId.trimmed();
    }
    if (song.uri.startsWith(QLatin1StringView("youtube:video:"))) {
        return song.uri.mid(14).trimmed();
    }
    return {};
}

QString playlistIdFromPlaylist(const Playlist &playlist)
{
    if (!playlist.id.trimmed().isEmpty()) {
        QString id = playlist.id.trimmed();
        if (id.startsWith(QLatin1StringView("youtube:playlist:"))) {
            return id.mid(17);
        }
        return id;
    }
    if (playlist.uri.startsWith(QLatin1StringView("youtube:playlist:"))) {
        return playlist.uri.mid(17).trimmed();
    }
    return {};
}

QString findCachedAudioFile(const QString &cacheDir, const QString &videoId)
{
    QDir dir(cacheDir);
    if (!dir.exists()) {
        return {};
    }
    const QString prefix = videoId + u'.';
    const QFileInfoList entries = dir.entryInfoList(QDir::Files);
    QString fallback;
    for (const QFileInfo &info : entries) {
        const QString name = info.fileName();
        if (!name.startsWith(prefix) || name.endsWith(QLatin1StringView(".part")) || info.size() <= 1024) {
            continue;
        }
        const QString ext = info.suffix().toLower();
        if (ext == QLatin1StringView("m4a") || ext == QLatin1StringView("mp4")) {
            return info.absoluteFilePath();
        }
        if (ext == QLatin1StringView("mp3") || ext == QLatin1StringView("webm") || ext == QLatin1StringView("opus")) {
            fallback = info.absoluteFilePath();
        }
    }
    return fallback;
}

} // namespace

QUrl YouTubeMusic::redirectUri()
{
    return QUrl(QStringLiteral("http://localhost:%1/callback").arg(kRedirectPort));
}

YouTubeMusic::YouTubeMusic(SidecarClient *sidecar, Settings *settings, QNetworkAccessManager *network,
                           ErrorCenter *errors, QObject *parent)
    : QObject(parent)
    , m_sidecar(sidecar)
    , m_settings(settings)
    , m_network(network)
    , m_errors(errors)
    , m_artistTracks(new SongListModel(this))
    , m_artistPlaylists(new PlaylistListModel(this))
    , m_relatedTracks(new SongListModel(this))
{
    s_instance = this;
    connect(&m_server, &QTcpServer::newConnection, this, &YouTubeMusic::acceptConnection);
    if (m_settings != nullptr) {
        connect(m_settings, &Settings::youtubeClientIdChanged, this, &YouTubeMusic::clientIdChanged);
        connect(m_settings, &Settings::youtubeClientSecretChanged, this, &YouTubeMusic::clientSecretChanged);
    }
    QDir().mkpath(streamCacheDirectory());
}

YouTubeMusic::~YouTubeMusic()
{
    stopServer();
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

YouTubeMusic *YouTubeMusic::instance()
{
    return s_instance;
}

YouTubeMusic *YouTubeMusic::create(QQmlEngine *, QJSEngine *)
{
    if (s_instance != nullptr) {
        QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    }
    return s_instance;
}

QString YouTubeMusic::clientId() const
{
    return m_settings != nullptr ? m_settings->youtubeClientId() : QString();
}

void YouTubeMusic::setClientId(const QString &value)
{
    if (m_settings != nullptr) {
        m_settings->setYoutubeClientId(value.trimmed());
    }
}

QString YouTubeMusic::clientSecret() const
{
    return m_settings != nullptr ? m_settings->youtubeClientSecret() : QString();
}

void YouTubeMusic::setClientSecret(const QString &value)
{
    if (m_settings != nullptr) {
        m_settings->setYoutubeClientSecret(value.trimmed());
    }
}

bool YouTubeMusic::available() const
{
    return m_sidecar != nullptr && !m_sidecar->binaryPath().isEmpty();
}

QPair<QString, QString> YouTubeMusic::effectiveCredentials() const
{
    const QString customId = clientId().trimmed();
    const QString customSecret = clientSecret().trimmed();
    if (!customId.isEmpty() && !customSecret.isEmpty()) {
        return { customId, customSecret };
    }
    const QString envId = qEnvironmentVariable("BSC_YOUTUBE_CLIENT_ID").trimmed();
    const QString envSecret = qEnvironmentVariable("BSC_YOUTUBE_CLIENT_SECRET").trimmed();
    if (!envId.isEmpty() && !envSecret.isEmpty()) {
        return { envId, envSecret };
    }
    return { QString::fromLatin1(RESONANCE_YOUTUBE_CLIENT_ID),
             QString::fromLatin1(RESONANCE_YOUTUBE_CLIENT_SECRET) };
}

QString YouTubeMusic::streamCacheDirectory() const
{
    return paths::cacheDirectory() + QStringLiteral("/youtube-audio");
}

void YouTubeMusic::setBusy(bool value)
{
    if (m_busy == value) {
        return;
    }
    m_busy = value;
    emit busyChanged();
}

void YouTubeMusic::setStatusMessage(const QString &message)
{
    if (m_statusMessage == message) {
        return;
    }
    m_statusMessage = message;
    emit statusMessageChanged();
}

void YouTubeMusic::clearStatusMessage()
{
    setStatusMessage(QString());
}

void YouTubeMusic::report(const QString &message)
{
    if (m_errors != nullptr) {
        m_errors->show(message);
    }
}

void YouTubeMusic::loginWithBrowser(const QString &customClientId, const QString &customClientSecret)
{
    if (!available()) {
        setStatusMessage(QStringLiteral("This build has no YouTube Music sidecar service."));
        return;
    }

    const QString trimmedId = customClientId.trimmed();
    const QString trimmedSecret = customClientSecret.trimmed();
    if (!trimmedId.isEmpty() && !trimmedSecret.isEmpty()) {
        setClientId(trimmedId);
        setClientSecret(trimmedSecret);
    }

    const auto [cid, csecret] = effectiveCredentials();
    if (cid.isEmpty() || csecret.isEmpty()) {
        setStatusMessage(QStringLiteral("Enter your Google OAuth Client ID and Client Secret."));
        return;
    }

    m_pendingClientId = cid;
    m_pendingClientSecret = csecret;
    clearStatusMessage();

    stopServer();
    if (!m_server.listen(QHostAddress::Any, kRedirectPort)) {
        if (!m_server.listen(QHostAddress::LocalHost, kRedirectPort)) {
            setStatusMessage(QStringLiteral("Resonance needs port %1 for the YouTube Music login, but %2.")
                                 .arg(kRedirectPort)
                                 .arg(m_server.errorString().toLower()));
            return;
        }
    }

    QUrl authUrl(QString::fromLatin1(kYouTubeAuthorizeUrl));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("client_id"), cid);
    query.addQueryItem(QStringLiteral("response_type"), QStringLiteral("code"));
    query.addQueryItem(QStringLiteral("redirect_uri"), redirectUri().toString());
    query.addQueryItem(QStringLiteral("scope"), QString::fromLatin1(kYouTubeScopes));
    query.addQueryItem(QStringLiteral("access_type"), QStringLiteral("offline"));
    query.addQueryItem(QStringLiteral("prompt"), QStringLiteral("consent"));
    query.addQueryItem(QStringLiteral("include_granted_scopes"), QStringLiteral("true"));
    authUrl.setQuery(query);

    m_authorizationUrl = authUrl;
    m_browserLoginActive = true;
    emit browserLoginActiveChanged();
    QDesktopServices::openUrl(authUrl);
}

void YouTubeMusic::reopenLoginPage()
{
    if (m_authorizationUrl.isValid()) {
        QDesktopServices::openUrl(m_authorizationUrl);
    }
}

void YouTubeMusic::cancelBrowserLogin()
{
    stopServer();
    if (!m_browserLoginActive) {
        return;
    }
    m_browserLoginActive = false;
    m_authorizationUrl = QUrl();
    emit browserLoginActiveChanged();
}

void YouTubeMusic::stopServer()
{
    if (m_server.isListening()) {
        m_server.close();
    }
}

void YouTubeMusic::acceptConnection()
{
    while (QTcpSocket *socket = m_server.nextPendingConnection()) {
        connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
        connect(socket, &QTcpSocket::readyRead, this, [this, socket] { handleSocket(socket); });
    }
}

void YouTubeMusic::handleSocket(QTcpSocket *socket)
{
    if (!socket->canReadLine()) {
        if (socket->bytesAvailable() > 8192) {
            socket->abort();
        }
        return;
    }
    const QList<QByteArray> requestLine = socket->readLine().trimmed().split(' ');
    QUrl url;
    if (requestLine.size() >= 2 && requestLine[0] == "GET") {
        url = QUrl(QStringLiteral("http://localhost:%1").arg(kRedirectPort) + QString::fromLatin1(requestLine[1]));
    }
    if (!isYouTubeRedirect(url)) {
        socket->write(httpResponse(404, "Not Found", QByteArray()));
        socket->disconnectFromHost();
        return;
    }
    socket->write(httpResponse(200, "OK", kCallbackHtml));
    socket->disconnectFromHost();
    handleRedirectUrl(url);
}

void YouTubeMusic::handleRedirectUrl(const QUrl &url)
{
    if (!isYouTubeRedirect(url)) {
        return;
    }

    stopServer();
    if (m_browserLoginActive) {
        m_browserLoginActive = false;
        m_authorizationUrl = QUrl();
        emit browserLoginActiveChanged();
    }

    const QUrlQuery query(url);
    if (query.hasQueryItem(QStringLiteral("error"))) {
        const QString errDesc = query.queryItemValue(QStringLiteral("error_description"), QUrl::FullyDecoded);
        const QString errCode = query.queryItemValue(QStringLiteral("error"), QUrl::FullyDecoded);
        setStatusMessage(QStringLiteral("Google sign-in declined: %1").arg(errDesc.isEmpty() ? errCode : errDesc));
        return;
    }

    const QString code = query.queryItemValue(QStringLiteral("code"), QUrl::FullyDecoded).trimmed();
    if (code.isEmpty()) {
        setStatusMessage(QStringLiteral("Google did not return an authorization code."));
        return;
    }

    const auto [fallbackId, fallbackSecret] = effectiveCredentials();
    const QString cid = m_pendingClientId.isEmpty() ? fallbackId : m_pendingClientId;
    const QString csecret = m_pendingClientSecret.isEmpty() ? fallbackSecret : m_pendingClientSecret;

    const quint64 generation = ++m_connectGeneration;
    setBusy(true);
    setStatusMessage(QStringLiteral("Connecting YouTube Music…"));
    if (auto *app = AppController::instance()) {
        emit app->raiseRequested();
    }
    detach(runExchangeCode(code, cid, csecret, generation));
}

QCoro::Task<> YouTubeMusic::runExchangeCode(QString code, QString clientId, QString clientSecret, quint64 generation)
{
    if (m_sidecar == nullptr) {
        setBusy(false);
        setStatusMessage(QStringLiteral("YouTube Music sidecar is not available."));
        co_return;
    }

    const QJsonObject params {
        { QStringLiteral("code"), code },
        { QStringLiteral("clientId"), clientId },
        { QStringLiteral("clientSecret"), clientSecret },
        { QStringLiteral("redirectUri"), redirectUri().toString() },
    };

    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("youtube.auth.exchange"), params);
    if (generation != m_connectGeneration) {
        co_return;
    }
    setBusy(false);
    if (!response.ok()) {
        setStatusMessage(response.error);
        report(response.error);
        co_return;
    }

    applyStatus(response.result);
    const QString name = m_userName.isEmpty() ? QStringLiteral("YouTube User") : m_userName;
    setStatusMessage(QStringLiteral("YouTube Music connected as %1").arg(name));
    loadDiscover();
}

void YouTubeMusic::applyStatus(const QJsonObject &status)
{
    const bool authorized = status.value(QStringLiteral("authorized")).toBool();
    const QJsonObject profile = status.value(QStringLiteral("profile")).toObject();
    QString name = profile.value(QStringLiteral("name")).toString();
    const QString email = profile.value(QStringLiteral("email")).toString();
    const QString id = profile.value(QStringLiteral("id")).toString();
    if (name.isEmpty()) {
        name = !email.isEmpty() ? email : id;
    }
    const QUrl avatar(profile.value(QStringLiteral("picture")).toString());

    if (m_connected == authorized && m_userName == name && m_userId == id && m_userEmail == email && m_avatarUrl == avatar) {
        return;
    }
    m_connected = authorized;
    m_userName = authorized ? name : QString();
    m_userId = authorized ? id : QString();
    m_userEmail = authorized ? email : QString();
    m_avatarUrl = authorized ? avatar : QUrl();
    emit accountChanged();
}

void YouTubeMusic::refreshStatus()
{
    detach(refreshStatusTask());
}

QCoro::Task<> YouTubeMusic::refreshStatusTask()
{
    if (m_sidecar == nullptr) {
        co_return;
    }
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("youtube.auth.status"));
    if (response.ok() && response.result.value(QStringLiteral("authorized")).toBool()) {
        applyStatus(response.result);
        loadDiscover();
        co_return;
    }

    // Try refreshing with stored/bundled credentials in case an expired session is on disk
    const auto [cid, csecret] = effectiveCredentials();
    if (!cid.isEmpty() && !csecret.isEmpty()) {
        SidecarClient::Response refreshed = co_await m_sidecar->call(
            QStringLiteral("youtube.auth.refresh"),
            { { QStringLiteral("clientId"), cid }, { QStringLiteral("clientSecret"), csecret } });
        if (refreshed.ok() && refreshed.result.value(QStringLiteral("authorized")).toBool()) {
            applyStatus(refreshed.result);
            loadDiscover();
            co_return;
        }
    }

    if (response.ok()) {
        applyStatus(response.result);
    }
}

QCoro::Task<bool> YouTubeMusic::ensureFreshSession()
{
    if (m_sidecar == nullptr) {
        co_return false;
    }
    const auto [cid, csecret] = effectiveCredentials();
    if (cid.isEmpty() || csecret.isEmpty()) {
        co_return false;
    }
    SidecarClient::Response refreshed = co_await m_sidecar->call(
        QStringLiteral("youtube.auth.refresh"),
        { { QStringLiteral("clientId"), cid }, { QStringLiteral("clientSecret"), csecret } });
    if (refreshed.ok() && refreshed.result.value(QStringLiteral("authorized")).toBool()) {
        applyStatus(refreshed.result);
        co_return true;
    }
    co_return false;
}

QCoro::Task<QJsonObject> YouTubeMusic::callWithRefresh(QString method, QJsonObject params)
{
    if (m_sidecar == nullptr) {
        co_return QJsonObject { { QStringLiteral("error"), QStringLiteral("YouTube Music sidecar is not running.") } };
    }
    SidecarClient::Response response = co_await m_sidecar->call(method, params);
    if (!response.ok() && response.error.contains(QLatin1StringView("refresh"), Qt::CaseInsensitive)) {
        if (co_await ensureFreshSession()) {
            response = co_await m_sidecar->call(method, params);
        }
    }
    if (!response.ok()) {
        qCDebug(lcYouTube) << method << "failed:" << response.error;
        co_return QJsonObject { { QStringLiteral("error"), response.error } };
    }
    if (response.resultValue.isArray()) {
        co_return QJsonObject { { QStringLiteral("items"), response.resultValue.toArray() } };
    }
    co_return response.result;
}

void YouTubeMusic::logOut()
{
    ++m_connectGeneration;
    setBusy(true);
    detach(logOutTask());
}

QCoro::Task<> YouTubeMusic::logOutTask()
{
    if (m_sidecar != nullptr) {
        co_await m_sidecar->call(QStringLiteral("youtube.auth.logout"));
    }
    setBusy(false);
    applyStatus({});
    m_discoverRows.clear();
    emit discoverRowsChanged();
    setStatusMessage(QStringLiteral("YouTube Music disconnected."));
}

Song YouTubeMusic::songFromTrack(const QJsonObject &track)
{
    Song song;
    song.source = QStringLiteral("youtube-music");
    song.nativeId = track.value(QStringLiteral("nativeId")).toString().trimmed();
    song.uri = track.value(QStringLiteral("urn")).toString().trimmed();
    if (song.uri.isEmpty() && !song.nativeId.isEmpty()) {
        song.uri = QStringLiteral("youtube:video:") + song.nativeId;
    }
    song.name = track.value(QStringLiteral("title")).toString();
    song.artists = track.value(QStringLiteral("artist")).toString();
    song.artworkUrl = QUrl(track.value(QStringLiteral("artworkUrl")).toString());
    song.permalink = QUrl(track.value(QStringLiteral("permalink")).toString());
    if (song.permalink.isEmpty() && !song.nativeId.isEmpty()) {
        song.permalink = QUrl(QStringLiteral("https://www.youtube.com/watch?v=") + song.nativeId);
    }
    song.durationMs = int(track.value(QStringLiteral("durationMs")).toDouble());

    const QString channelId = track.value(QStringLiteral("channelId")).toString().trimmed();
    if (!channelId.isEmpty() || !song.artists.isEmpty()) {
        Artist artist;
        artist.id = channelId;
        artist.name = song.artists;
        artist.source = QStringLiteral("youtube-music");
        artist.uri = channelId.isEmpty() ? QString() : (QStringLiteral("youtube:channel:") + channelId);
        song.artistItems = { artist };
    }
    return song;
}

QList<Song> YouTubeMusic::songsFromTracks(const QJsonArray &tracks)
{
    QList<Song> songs;
    songs.reserve(tracks.size());
    for (const QJsonValue &value : tracks) {
        const Song song = songFromTrack(value.toObject());
        if (song.isValid()) {
            songs.append(song);
        }
    }
    return songs;
}

QCoro::Task<QList<Song>> YouTubeMusic::likedSongs()
{
    if (!m_connected || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    m_likedSongsNextPageToken.clear();
    m_hasMoreLikedSongs = false;
    emit hasMoreLikedSongsChanged();

    const QJsonObject params {
        { QStringLiteral("limit"), 50 },
        { QStringLiteral("musicOnly"), true },
    };
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.tracks.mine"), params);
    if (obj.contains(QStringLiteral("error"))) {
        report(obj.value(QStringLiteral("error")).toString());
        co_return QList<Song> {};
    }
    const QList<Song> songs = songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
    m_likedSongsNextPageToken = obj.value(QStringLiteral("nextPageToken")).toString();
    m_hasMoreLikedSongs = !m_likedSongsNextPageToken.isEmpty();
    emit hasMoreLikedSongsChanged();
    co_return songs;
}

void YouTubeMusic::loadMoreLikedSongs()
{
    if (m_loadingMoreLikes || !m_hasMoreLikedSongs || m_likedSongsNextPageToken.isEmpty() || m_sidecar == nullptr) {
        return;
    }
    detach(loadMoreLikedSongsTask());
}

QCoro::Task<> YouTubeMusic::loadMoreLikedSongsTask()
{
    m_loadingMoreLikes = true;
    emit loadingMoreLikesChanged();

    const QJsonObject params {
        { QStringLiteral("pageToken"), m_likedSongsNextPageToken },
        { QStringLiteral("limit"), 50 },
        { QStringLiteral("musicOnly"), true },
    };
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.tracks.mine"), params);
    if (!obj.contains(QStringLiteral("error"))) {
        const QList<Song> newSongs = songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
        m_likedSongsNextPageToken = obj.value(QStringLiteral("nextPageToken")).toString();
        m_hasMoreLikedSongs = !m_likedSongsNextPageToken.isEmpty();
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

QCoro::Task<QList<Playlist>> YouTubeMusic::playlists()
{
    if (!m_connected || m_sidecar == nullptr) {
        co_return QList<Playlist> {};
    }
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.playlists.mine"),
                                                     { { QStringLiteral("limit"), 50 } });
    if (obj.contains(QStringLiteral("error"))) {
        report(obj.value(QStringLiteral("error")).toString());
        co_return QList<Playlist> {};
    }
    const QJsonArray items = obj.value(QStringLiteral("playlists")).toArray();
    QList<Playlist> result;
    result.reserve(items.size());
    for (const QJsonValue &val : items) {
        const QJsonObject card = val.toObject();
        Playlist playlist;
        playlist.source = QStringLiteral("youtube-music");
        playlist.id = card.value(QStringLiteral("nativeId")).toString();
        playlist.uri = card.value(QStringLiteral("urn")).toString();
        if (playlist.uri.isEmpty() && !playlist.id.isEmpty()) {
            playlist.uri = QStringLiteral("youtube:playlist:") + playlist.id;
        }
        playlist.name = card.value(QStringLiteral("title")).toString();
        playlist.description = card.value(QStringLiteral("description")).toString();
        playlist.artworkUrl = QUrl(card.value(QStringLiteral("artworkUrl")).toString());
        playlist.permalink = QUrl(card.value(QStringLiteral("permalink")).toString());
        playlist.songCount = card.value(QStringLiteral("trackCount")).toInt();
        playlist.ownerName = card.value(QStringLiteral("artist")).toString();
        if (playlist.isValid()) {
            result.append(playlist);
        }
    }
    co_return result;
}

QCoro::Task<QList<Song>> YouTubeMusic::playlistSongs(const Playlist &playlist)
{
    const QString id = playlistIdFromPlaylist(playlist);
    if (!m_connected || id.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.playlist.tracks"),
                                                     { { QStringLiteral("id"), id }, { QStringLiteral("limit"), 50 } });
    if (obj.contains(QStringLiteral("error"))) {
        report(obj.value(QStringLiteral("error")).toString());
        co_return QList<Song> {};
    }
    co_return songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
}

QCoro::Task<QList<Song>> YouTubeMusic::searchSongs(QString query)
{
    const QString trimmed = query.trimmed();
    if (!m_connected || trimmed.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.search.tracks"),
                                                     { { QStringLiteral("query"), trimmed }, { QStringLiteral("limit"), 20 } });
    if (obj.contains(QStringLiteral("error"))) {
        report(obj.value(QStringLiteral("error")).toString());
        co_return QList<Song> {};
    }
    co_return songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
}

QCoro::Task<bool> YouTubeMusic::rateTrack(const Song &song, bool like)
{
    const QString videoId = videoIdFromSong(song);
    if (!m_connected || videoId.isEmpty() || m_sidecar == nullptr) {
        co_return false;
    }
    const QJsonObject obj = co_await callWithRefresh(
        QStringLiteral("youtube.rate.track"),
        { { QStringLiteral("id"), videoId }, { QStringLiteral("rating"), like ? QStringLiteral("like") : QStringLiteral("none") } });
    if (obj.contains(QStringLiteral("error"))) {
        report(obj.value(QStringLiteral("error")).toString());
        co_return false;
    }
    co_return true;
}

void YouTubeMusic::loadDiscover()
{
    if (!m_connected || m_loadingDiscover || m_sidecar == nullptr) {
        return;
    }
    detach(loadDiscoverTask());
}

QCoro::Task<> YouTubeMusic::loadDiscoverTask()
{
    m_loadingDiscover = true;
    emit loadingDiscoverChanged();

    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.discover"));
    if (!obj.contains(QStringLiteral("error"))) {
        const QJsonArray rowsArr = obj.value(QStringLiteral("items")).toArray();
        QList<YouTubeDiscoverRow> rows;
        rows.reserve(rowsArr.size());
        for (const QJsonValue &val : rowsArr) {
            const QJsonObject rowObj = val.toObject();
            YouTubeDiscoverRow row;
            row.id = rowObj.value(QStringLiteral("id")).toString();
            row.title = rowObj.value(QStringLiteral("title")).toString();
            row.description = rowObj.value(QStringLiteral("description")).toString();
            row.tracks = songsFromTracks(rowObj.value(QStringLiteral("tracks")).toArray());
            if (!row.tracks.isEmpty()) {
                rows.append(row);
            }
        }
        m_discoverRows = rows;
        emit discoverRowsChanged();
    }

    m_loadingDiscover = false;
    emit loadingDiscoverChanged();
}

QCoro::Task<SoundCloudArtistProfile> YouTubeMusic::fetchArtistProfile(QString channelId)
{
    if (!m_connected || channelId.isEmpty() || m_sidecar == nullptr) {
        co_return SoundCloudArtistProfile {};
    }
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.artist.profile"),
                                                     { { QStringLiteral("id"), channelId } });
    if (obj.contains(QStringLiteral("error"))) {
        co_return SoundCloudArtistProfile {};
    }
    SoundCloudArtistProfile profile;
    profile.id = obj.value(QStringLiteral("channelId")).toString();
    profile.username = obj.value(QStringLiteral("title")).toString();
    profile.fullName = profile.username;
    profile.permalink = QUrl(QStringLiteral("https://www.youtube.com/channel/") + profile.id);
    profile.avatarUrl = QUrl(obj.value(QStringLiteral("avatarUrl")).toString());
    profile.bannerUrl = QUrl(obj.value(QStringLiteral("bannerUrl")).toString());
    profile.description = obj.value(QStringLiteral("description")).toString();
    profile.followersCount = qint64(obj.value(QStringLiteral("subscriberCount")).toDouble());
    profile.trackCount = qint64(obj.value(QStringLiteral("videoCount")).toDouble());
    co_return profile;
}

QCoro::Task<QList<Song>> YouTubeMusic::fetchArtistTracks(QString channelId)
{
    if (!m_connected || channelId.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    m_artistTracksChannelId = channelId;
    m_artistTracksNextPageToken.clear();
    m_hasMoreArtistTracks = false;
    emit hasMoreArtistTracksChanged();

    const QJsonObject obj = co_await callWithRefresh(
        QStringLiteral("youtube.artist.tracks"),
        { { QStringLiteral("id"), channelId }, { QStringLiteral("limit"), 25 } });
    if (obj.contains(QStringLiteral("error"))) {
        co_return QList<Song> {};
    }
    m_artistTracksNextPageToken = obj.value(QStringLiteral("nextPageToken")).toString();
    m_hasMoreArtistTracks = !m_artistTracksNextPageToken.isEmpty();
    emit hasMoreArtistTracksChanged();
    co_return songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
}

void YouTubeMusic::loadMoreArtistTracks()
{
    if (m_loadingMoreArtistTracks || !m_hasMoreArtistTracks || m_artistTracksNextPageToken.isEmpty()
        || m_artistTracksChannelId.isEmpty() || m_sidecar == nullptr) {
        return;
    }
    detach(loadMoreArtistTracksTask());
}

QCoro::Task<> YouTubeMusic::loadMoreArtistTracksTask()
{
    m_loadingMoreArtistTracks = true;
    emit loadingMoreArtistTracksChanged();

    const QJsonObject obj = co_await callWithRefresh(
        QStringLiteral("youtube.artist.tracks"),
        { { QStringLiteral("id"), m_artistTracksChannelId },
          { QStringLiteral("pageToken"), m_artistTracksNextPageToken },
          { QStringLiteral("limit"), 25 } });
    if (!obj.contains(QStringLiteral("error"))) {
        const QList<Song> newSongs = songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
        m_artistTracksNextPageToken = obj.value(QStringLiteral("nextPageToken")).toString();
        m_hasMoreArtistTracks = !m_artistTracksNextPageToken.isEmpty();
        emit hasMoreArtistTracksChanged();

        if (!newSongs.isEmpty()) {
            m_artistTracks->appendSongs(newSongs);
        }
    }

    m_loadingMoreArtistTracks = false;
    emit loadingMoreArtistTracksChanged();
}

QCoro::Task<QList<Playlist>> YouTubeMusic::fetchArtistPlaylists(QString channelId)
{
    if (!m_connected || channelId.isEmpty() || m_sidecar == nullptr) {
        co_return QList<Playlist> {};
    }
    const QJsonObject obj = co_await callWithRefresh(
        QStringLiteral("youtube.artist.playlists"),
        { { QStringLiteral("id"), channelId }, { QStringLiteral("limit"), 25 } });
    if (obj.contains(QStringLiteral("error"))) {
        co_return QList<Playlist> {};
    }
    const QJsonArray items = obj.value(QStringLiteral("playlists")).toArray();
    QList<Playlist> result;
    result.reserve(items.size());
    for (const QJsonValue &val : items) {
        const QJsonObject card = val.toObject();
        Playlist playlist;
        playlist.source = QStringLiteral("youtube-music");
        playlist.id = card.value(QStringLiteral("nativeId")).toString();
        playlist.uri = card.value(QStringLiteral("urn")).toString();
        if (playlist.uri.isEmpty() && !playlist.id.isEmpty()) {
            playlist.uri = QStringLiteral("youtube:playlist:") + playlist.id;
        }
        playlist.name = card.value(QStringLiteral("title")).toString();
        playlist.artworkUrl = QUrl(card.value(QStringLiteral("artworkUrl")).toString());
        playlist.permalink = QUrl(card.value(QStringLiteral("permalink")).toString());
        playlist.songCount = card.value(QStringLiteral("trackCount")).toInt();
        playlist.ownerName = card.value(QStringLiteral("artist")).toString();
        if (playlist.isValid()) {
            result.append(playlist);
        }
    }
    co_return result;
}

QCoro::Task<SoundCloudTrackDetails> YouTubeMusic::fetchTrackDetails(QString videoId)
{
    if (!m_connected || videoId.isEmpty() || m_sidecar == nullptr) {
        co_return SoundCloudTrackDetails {};
    }
    const QJsonObject obj = co_await callWithRefresh(QStringLiteral("youtube.track.details"),
                                                     { { QStringLiteral("id"), videoId } });
    if (obj.contains(QStringLiteral("error"))) {
        co_return SoundCloudTrackDetails {};
    }
    SoundCloudTrackDetails details;
    details.id = obj.value(QStringLiteral("nativeId")).toString();
    details.urn = obj.value(QStringLiteral("urn")).toString();
    details.title = obj.value(QStringLiteral("title")).toString();
    details.permalink = QUrl(obj.value(QStringLiteral("permalink")).toString());
    details.artworkUrl = QUrl(obj.value(QStringLiteral("artworkUrl")).toString());
    details.durationMs = int(obj.value(QStringLiteral("durationMs")).toDouble());
    details.playbackCount = qint64(obj.value(QStringLiteral("viewCount")).toDouble());
    details.likesCount = qint64(obj.value(QStringLiteral("likeCount")).toDouble());
    details.createdAt = obj.value(QStringLiteral("publishedAt")).toString();
    details.displayDate = details.createdAt.left(10);
    details.artistId = obj.value(QStringLiteral("channelId")).toString();
    details.artistName = obj.value(QStringLiteral("artist")).toString();
    details.artistFollowers = qint64(obj.value(QStringLiteral("subscriberCount")).toDouble());
    co_return details;
}

QCoro::Task<QList<Song>> YouTubeMusic::fetchRelatedTracks(QString queryTitle)
{
    if (!m_connected || queryTitle.trimmed().isEmpty() || m_sidecar == nullptr) {
        co_return QList<Song> {};
    }
    const QJsonObject obj = co_await callWithRefresh(
        QStringLiteral("youtube.search.tracks"),
        { { QStringLiteral("query"), queryTitle.trimmed() }, { QStringLiteral("limit"), 10 } });
    if (obj.contains(QStringLiteral("error"))) {
        co_return QList<Song> {};
    }
    co_return songsFromTracks(obj.value(QStringLiteral("tracks")).toArray());
}

QCoro::Task<Artist> YouTubeMusic::artistFromSong(const Song &song)
{
    if (!song.artistItems.isEmpty() && song.artistItems.first().isValid()) {
        co_return song.artistItems.first();
    }
    const QString videoId = videoIdFromSong(song);
    if (!videoId.isEmpty()) {
        SoundCloudTrackDetails details = co_await fetchTrackDetails(videoId);
        if (!details.artistId.isEmpty()) {
            Artist artist;
            artist.id = details.artistId;
            artist.name = details.artistName.isEmpty() ? song.artists : details.artistName;
            artist.source = QStringLiteral("youtube-music");
            artist.uri = QStringLiteral("youtube:channel:") + details.artistId;
            co_return artist;
        }
    }
    Artist fallback;
    fallback.name = song.artists;
    fallback.source = QStringLiteral("youtube-music");
    co_return fallback;
}

void YouTubeMusic::openArtist(const QString &channelId)
{
    if (!channelId.trimmed().isEmpty()) {
        detach(loadArtistData(channelId.trimmed(), ++m_artistGeneration));
    }
}

void YouTubeMusic::openArtistFromSong(const resonance::Song &song)
{
    detach(openArtistFromSongTask(song));
}

QCoro::Task<> YouTubeMusic::openArtistFromSongTask(Song song)
{
    Artist artist = co_await artistFromSong(song);
    if (artist.isValid()) {
        openArtist(artist.id);
    }
}

void YouTubeMusic::openTrackDetails(const resonance::Song &song)
{
    detach(loadTrackDetailsData(song, ++m_trackDetailsGeneration));
}

QCoro::Task<> YouTubeMusic::loadArtistData(QString channelId, quint64 generation)
{
    m_loadingArtist = true;
    emit loadingArtistChanged();

    m_artistTracks->clear();
    m_artistPlaylists->setItems({});

    SoundCloudArtistProfile profile = co_await fetchArtistProfile(channelId);
    if (generation != m_artistGeneration) co_return;
    m_currentArtist = profile;
    emit currentArtistChanged();

    QList<Song> tracks = co_await fetchArtistTracks(channelId);
    if (generation != m_artistGeneration) co_return;
    m_artistTracks->setSongs(tracks);

    QList<Playlist> playlists = co_await fetchArtistPlaylists(channelId);
    if (generation != m_artistGeneration) co_return;
    m_artistPlaylists->setItems(playlists);

    m_loadingArtist = false;
    emit loadingArtistChanged();
}

QCoro::Task<> YouTubeMusic::loadTrackDetailsData(Song song, quint64 generation)
{
    m_loadingTrackDetails = true;
    emit loadingTrackDetailsChanged();

    m_relatedTracks->clear();

    const QString videoId = videoIdFromSong(song);
    if (videoId.isEmpty()) {
        m_loadingTrackDetails = false;
        emit loadingTrackDetailsChanged();
        co_return;
    }

    SoundCloudTrackDetails details = co_await fetchTrackDetails(videoId);
    if (generation != m_trackDetailsGeneration) co_return;
    if (!details.isValid()) {
        details.id = videoId;
        details.title = song.name;
        details.artworkUrl = song.artworkUrl;
        details.artistName = song.artists;
        details.durationMs = song.durationMs;
    }
    m_currentTrackDetails = details;
    emit currentTrackDetailsChanged();

    const QString relatedQuery = !details.artistName.isEmpty()
        ? (details.artistName + u' ' + details.title)
        : details.title;
    QList<Song> related = co_await fetchRelatedTracks(relatedQuery);
    if (generation != m_trackDetailsGeneration) co_return;
    related.removeIf([&](const Song &s) { return videoIdFromSong(s) == videoId; });
    m_relatedTracks->setSongs(related);

    m_loadingTrackDetails = false;
    emit loadingTrackDetailsChanged();
}

QString YouTubeMusic::findYtDlpBinary() const
{
    const QDir exeDir(QCoreApplication::applicationDirPath());
    const QStringList candidates {
#ifdef Q_OS_WIN
        exeDir.filePath(QStringLiteral("yt-dlp.exe")),
        QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + QStringLiteral("/Resonance/yt-dlp.exe"),
#else
        exeDir.filePath(QStringLiteral("yt-dlp")),
        exeDir.filePath(QStringLiteral("../Resources/yt-dlp")),
#endif
        QStandardPaths::findExecutable(QStringLiteral("yt-dlp")),
    };
    for (const QString &candidate : candidates) {
        if (!candidate.isEmpty() && QFileInfo(candidate).isExecutable()) {
            return QDir::cleanPath(candidate);
        }
    }
    return {};
}

void YouTubeMusic::pruneStreamCache(const QString &keeping)
{
    const qint64 limit = qint64(m_settings != nullptr ? m_settings->songCacheMegabytes() : 1000) * 1000 * 1000;
    QDir directory(streamCacheDirectory());
    const QFileInfoList entries = directory.entryInfoList(QDir::Files, QDir::Time);
    qint64 total = 0;
    for (const QFileInfo &entry : entries) {
        total += entry.size();
    }
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

QCoro::Task<QString> YouTubeMusic::streamPath(const Song &song)
{
    const QString videoId = videoIdFromSong(song);
    if (videoId.isEmpty()) {
        throw SpotifyError(SpotifyError::Kind::RequestFailed,
                           QStringLiteral("This YouTube Music track has no video ID."));
    }

    const QString cacheDir = streamCacheDirectory();
    QDir().mkpath(cacheDir);
    if (const QString cached = findCachedAudioFile(cacheDir, videoId); !cached.isEmpty()) {
        co_return cached;
    }

    // Primary path: yt-dlp sidecar
    if (!findYtDlpBinary().isEmpty()) {
        try {
            const QString downloaded = co_await downloadWithYtDlp(videoId);
            if (!downloaded.isEmpty()) {
                pruneStreamCache(downloaded);
                co_return downloaded;
            }
        } catch (const SpotifyError &err) {
            qCWarning(lcYouTube) << "yt-dlp failed for" << videoId << ":" << err.message();
        }
    }

    // Fallback path: direct Innertube player API resolution
    const QString direct = co_await downloadDirectInnertube(videoId);
    pruneStreamCache(direct);
    co_return direct;
}

QCoro::Task<QString> YouTubeMusic::downloadWithYtDlp(QString videoId)
{
    const QString ytdlp = findYtDlpBinary();
    if (ytdlp.isEmpty()) {
        throw SpotifyError(SpotifyError::Kind::Core, QStringLiteral("yt-dlp is not available."));
    }

    const QString cacheDir = streamCacheDirectory();
    const QString outputTemplate = cacheDir + '/' + videoId + QStringLiteral(".%(ext)s");
    const QString watchUrl = QStringLiteral("https://www.youtube.com/watch?v=") + videoId;

    QProcess process;
    process.setProgram(ytdlp);
    process.setArguments({
        QStringLiteral("--no-playlist"),
        QStringLiteral("--no-warnings"),
        QStringLiteral("--no-overwrites"),
        QStringLiteral("--socket-timeout"), QStringLiteral("15"),
        QStringLiteral("--retries"), QStringLiteral("2"),
        QStringLiteral("-f"), QStringLiteral("bestaudio[ext=m4a]/bestaudio"),
        QStringLiteral("-o"), outputTemplate,
        watchUrl
    });

    co_await qCoro(process).start();
    const bool finished = co_await qCoro(process).waitForFinished(std::chrono::seconds(180));
    if (!finished || process.exitCode() != 0) {
        const QString errText = QString::fromUtf8(process.readAllStandardError()).trimmed();
        const QString firstLine = errText.section(u'\n', 0, 0).trimmed();
        throw SpotifyError::requestFailed(
            firstLine.isEmpty() ? QStringLiteral("Could not download YouTube audio.") : firstLine);
    }

    const QString result = findCachedAudioFile(cacheDir, videoId);
    if (result.isEmpty()) {
        throw SpotifyError::requestFailed(QStringLiteral("yt-dlp did not produce an audio file."));
    }
    co_return result;
}

QCoro::Task<QString> YouTubeMusic::downloadDirectInnertube(QString videoId)
{
    const QString cacheDir = streamCacheDirectory();
    QNetworkRequest playerReq(QUrl(QStringLiteral("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")));
    playerReq.setHeader(QNetworkRequest::ContentTypeHeader, QByteArrayLiteral("application/json"));
    playerReq.setHeader(QNetworkRequest::UserAgentHeader,
                        QByteArrayLiteral("com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"));
    playerReq.setTransferTimeout(20'000);

    const QJsonObject payload {
        { QStringLiteral("videoId"), videoId },
        { QStringLiteral("contentCheckOk"), true },
        { QStringLiteral("racyCheckOk"), true },
        { QStringLiteral("context"), QJsonObject {
            { QStringLiteral("client"), QJsonObject {
                { QStringLiteral("clientName"), QStringLiteral("IOS") },
                { QStringLiteral("clientVersion"), QStringLiteral("19.29.1") },
                { QStringLiteral("deviceMake"), QStringLiteral("Apple") },
                { QStringLiteral("deviceModel"), QStringLiteral("iPhone16,2") },
                { QStringLiteral("osName"), QStringLiteral("iPhone") },
                { QStringLiteral("osVersion"), QStringLiteral("17.5.1.21F90") },
                { QStringLiteral("hl"), QStringLiteral("en") },
                { QStringLiteral("gl"), QStringLiteral("US") },
            } }
        } }
    };

    std::unique_ptr<QNetworkReply> reply(m_network->post(playerReq, QJsonDocument(payload).toJson(QJsonDocument::Compact)));
    co_await qCoro(reply.get()).waitForFinished();
    if (reply->error() != QNetworkReply::NoError) {
        throw SpotifyError::requestFailed(reply->errorString());
    }

    const QJsonObject root = QJsonDocument::fromJson(reply->readAll()).object();
    const QJsonArray formats = root.value(QStringLiteral("streamingData")).toObject()
                                   .value(QStringLiteral("adaptiveFormats")).toArray();

    QString bestUrl;
    int bestBitrate = 0;
    QString bestExt = QStringLiteral("m4a");

    for (const QJsonValue &val : formats) {
        const QJsonObject fmt = val.toObject();
        const QString mime = fmt.value(QStringLiteral("mimeType")).toString();
        const QString url = fmt.value(QStringLiteral("url")).toString();
        if (!mime.startsWith(QLatin1StringView("audio/")) || url.isEmpty()) {
            continue;
        }
        const int bitrate = fmt.value(QStringLiteral("bitrate")).toInt();
        const bool isMp4 = mime.contains(QLatin1StringView("mp4"));
        if (bestUrl.isEmpty() || (isMp4 && bestExt != QLatin1StringView("m4a")) || bitrate > bestBitrate) {
            bestUrl = url;
            bestBitrate = bitrate;
            bestExt = isMp4 ? QStringLiteral("m4a") : QStringLiteral("webm");
        }
    }

    if (bestUrl.isEmpty()) {
        throw SpotifyError::requestFailed(QStringLiteral("YouTube did not return a playable audio stream."));
    }

    QNetworkRequest audioReq((QUrl(bestUrl)));
    audioReq.setHeader(QNetworkRequest::UserAgentHeader,
                       QByteArrayLiteral("com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"));
    audioReq.setTransferTimeout(60'000);
    std::unique_ptr<QNetworkReply> audioReply(m_network->get(audioReq));
    co_await qCoro(audioReply.get()).waitForFinished();
    if (audioReply->error() != QNetworkReply::NoError) {
        throw SpotifyError::requestFailed(audioReply->errorString());
    }

    const QByteArray bytes = audioReply->readAll();
    if (bytes.isEmpty()) {
        throw SpotifyError::requestFailed(QStringLiteral("YouTube returned an empty audio stream."));
    }

    const QString path = cacheDir + '/' + videoId + u'.' + bestExt;
    const QString partial = path + QStringLiteral(".part");
    QFile file(partial);
    if (!file.open(QIODevice::WriteOnly)) {
        throw SpotifyError(SpotifyError::Kind::Core, QStringLiteral("Could not write YouTube audio cache."));
    }
    file.write(bytes);
    file.close();
    QFile::remove(path);
    QFile::rename(partial, path);
    co_return path;
}

QCoro::Task<std::optional<Lyrics>> YouTubeMusic::lyrics(const Song &song)
{
    if (m_sidecar == nullptr) {
        co_return std::nullopt;
    }
    qint64 trackId = qint64(qHash(song.uri));
    if (trackId < 0) trackId = -trackId;
    if (trackId == 0) trackId = 1;

    const QJsonObject params {
        { QStringLiteral("trackId"), trackId },
        { QStringLiteral("title"), song.name },
        { QStringLiteral("artist"), song.artists },
        { QStringLiteral("durationMs"), song.durationMs },
    };
    SidecarClient::Response response = co_await m_sidecar->call(QStringLiteral("track.lyrics"), params);
    if (!response.ok() || response.result.isEmpty()) {
        co_return std::nullopt;
    }
    co_return Lyrics::fromSidecarJson(response.result);
}

} // namespace resonance
