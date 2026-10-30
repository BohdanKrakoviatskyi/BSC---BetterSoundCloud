#pragma once

#include "library/CollectionModels.h"
#include "library/SongListModel.h"
#include "playback/Lyrics.h"
#include "provider/SoundCloud.h"
#include "spotify/SpotifyTypes.h"

#include <QNetworkAccessManager>
#include <QObject>
#include <QTcpServer>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

#include <QCoroTask>

class QQmlEngine;
class QJSEngine;
class QTcpSocket;

namespace resonance {

class ErrorCenter;
class Settings;
class SidecarClient;

struct YouTubeDiscoverRow {
    Q_GADGET
    QML_VALUE_TYPE(youTubeDiscoverRow)
    Q_PROPERTY(QString id MEMBER id FINAL)
    Q_PROPERTY(QString title MEMBER title FINAL)
    Q_PROPERTY(QString description MEMBER description FINAL)
    Q_PROPERTY(QList<resonance::Song> tracks MEMBER tracks FINAL)

public:
    QString id;
    QString title;
    QString description;
    QList<Song> tracks;

    bool operator==(const YouTubeDiscoverRow &) const = default;
};

class YouTubeMusic : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(YouTubeMusic)
    QML_SINGLETON

    Q_PROPERTY(bool connected READ connected NOTIFY accountChanged FINAL)
    Q_PROPERTY(QString userName READ userName NOTIFY accountChanged FINAL)
    Q_PROPERTY(QString userId READ userId NOTIFY accountChanged FINAL)
    Q_PROPERTY(QString userEmail READ userEmail NOTIFY accountChanged FINAL)
    Q_PROPERTY(QUrl avatarUrl READ avatarUrl NOTIFY accountChanged FINAL)
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged FINAL)
    Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusMessageChanged FINAL)
    Q_PROPERTY(bool browserLoginActive READ browserLoginActive NOTIFY browserLoginActiveChanged FINAL)
    Q_PROPERTY(QUrl authorizationUrl READ authorizationUrl NOTIFY browserLoginActiveChanged FINAL)
    Q_PROPERTY(QString clientId READ clientId WRITE setClientId NOTIFY clientIdChanged FINAL)
    Q_PROPERTY(QString clientSecret READ clientSecret WRITE setClientSecret NOTIFY clientSecretChanged FINAL)
    Q_PROPERTY(bool bundledConfigured READ bundledConfigured CONSTANT FINAL)
    Q_PROPERTY(bool available READ available NOTIFY availableChanged FINAL)

    Q_PROPERTY(resonance::SoundCloudArtistProfile currentArtist READ currentArtist NOTIFY currentArtistChanged FINAL)
    Q_PROPERTY(resonance::SongListModel *artistTracks READ artistTracks CONSTANT FINAL)
    Q_PROPERTY(resonance::PlaylistListModel *artistPlaylists READ artistPlaylists CONSTANT FINAL)
    Q_PROPERTY(bool loadingArtist READ loadingArtist NOTIFY loadingArtistChanged FINAL)

    Q_PROPERTY(bool hasMoreArtistTracks READ hasMoreArtistTracks NOTIFY hasMoreArtistTracksChanged FINAL)
    Q_PROPERTY(bool loadingMoreArtistTracks READ loadingMoreArtistTracks NOTIFY loadingMoreArtistTracksChanged FINAL)
    Q_PROPERTY(bool hasMoreLikedSongs READ hasMoreLikedSongs NOTIFY hasMoreLikedSongsChanged FINAL)
    Q_PROPERTY(bool loadingMoreLikes READ loadingMoreLikes NOTIFY loadingMoreLikesChanged FINAL)

    Q_PROPERTY(resonance::SoundCloudTrackDetails currentTrackDetails READ currentTrackDetails NOTIFY currentTrackDetailsChanged FINAL)
    Q_PROPERTY(resonance::SongListModel *relatedTracks READ relatedTracks CONSTANT FINAL)
    Q_PROPERTY(bool loadingTrackDetails READ loadingTrackDetails NOTIFY loadingTrackDetailsChanged FINAL)

    Q_PROPERTY(QList<resonance::YouTubeDiscoverRow> discoverRows READ discoverRows NOTIFY discoverRowsChanged FINAL)
    Q_PROPERTY(bool loadingDiscover READ loadingDiscover NOTIFY loadingDiscoverChanged FINAL)

public:
    static constexpr quint16 kRedirectPort = 8889;
    static QUrl redirectUri();

    YouTubeMusic(SidecarClient *sidecar, Settings *settings, QNetworkAccessManager *network,
                 ErrorCenter *errors, QObject *parent = nullptr);
    ~YouTubeMusic() override;

    static YouTubeMusic *instance();
    static YouTubeMusic *create(QQmlEngine *, QJSEngine *);

    bool connected() const { return m_connected; }
    QString userName() const { return m_userName; }
    QString userId() const { return m_userId; }
    QString userEmail() const { return m_userEmail; }
    QUrl avatarUrl() const { return m_avatarUrl; }
    bool busy() const { return m_busy; }
    QString statusMessage() const { return m_statusMessage; }
    bool browserLoginActive() const { return m_browserLoginActive; }
    QUrl authorizationUrl() const { return m_authorizationUrl; }
    QString clientId() const;
    void setClientId(const QString &value);
    QString clientSecret() const;
    void setClientSecret(const QString &value);
    bool bundledConfigured() const { return true; }
    bool available() const;

    SoundCloudArtistProfile currentArtist() const { return m_currentArtist; }
    SongListModel *artistTracks() const { return m_artistTracks; }
    PlaylistListModel *artistPlaylists() const { return m_artistPlaylists; }
    bool loadingArtist() const { return m_loadingArtist; }

    SoundCloudTrackDetails currentTrackDetails() const { return m_currentTrackDetails; }
    SongListModel *relatedTracks() const { return m_relatedTracks; }
    bool loadingTrackDetails() const { return m_loadingTrackDetails; }

    QList<YouTubeDiscoverRow> discoverRows() const { return m_discoverRows; }
    bool loadingDiscover() const { return m_loadingDiscover; }

    bool hasMoreLikedSongs() const { return m_hasMoreLikedSongs; }
    bool loadingMoreLikes() const { return m_loadingMoreLikes; }
    bool hasMoreArtistTracks() const { return m_hasMoreArtistTracks; }
    bool loadingMoreArtistTracks() const { return m_loadingMoreArtistTracks; }

    Q_INVOKABLE void loginWithBrowser(const QString &customClientId = {}, const QString &customClientSecret = {});
    Q_INVOKABLE void reopenLoginPage();
    Q_INVOKABLE void cancelBrowserLogin();
    Q_INVOKABLE void handleRedirectUrl(const QUrl &url);
    Q_INVOKABLE void refreshStatus();
    Q_INVOKABLE void logOut();
    Q_INVOKABLE void clearStatusMessage();

    Q_INVOKABLE void loadMoreLikedSongs();
    Q_INVOKABLE void loadMoreArtistTracks();
    Q_INVOKABLE void loadDiscover();

    Q_INVOKABLE void openArtist(const QString &channelId);
    Q_INVOKABLE void openArtistFromSong(const resonance::Song &song);
    Q_INVOKABLE void openTrackDetails(const resonance::Song &song);

    QCoro::Task<QList<Song>> likedSongs();
    QCoro::Task<QList<Playlist>> playlists();
    QCoro::Task<QList<Song>> playlistSongs(const Playlist &playlist);
    QCoro::Task<QList<Song>> searchSongs(QString query);
    QCoro::Task<bool> rateTrack(const Song &song, bool like);

    QCoro::Task<Artist> artistFromSong(const Song &song);
    QCoro::Task<SoundCloudArtistProfile> fetchArtistProfile(QString channelId);
    QCoro::Task<SoundCloudTrackDetails> fetchTrackDetails(QString videoId);
    QCoro::Task<QList<Song>> fetchArtistTracks(QString channelId);
    QCoro::Task<QList<Playlist>> fetchArtistPlaylists(QString channelId);
    QCoro::Task<QList<Song>> fetchRelatedTracks(QString queryTitle);

    QCoro::Task<QString> streamPath(const Song &song);
    QCoro::Task<std::optional<Lyrics>> lyrics(const Song &song);

signals:
    void accountChanged();
    void busyChanged();
    void statusMessageChanged();
    void clientIdChanged();
    void clientSecretChanged();
    void availableChanged();
    void browserLoginActiveChanged();

    void currentArtistChanged();
    void loadingArtistChanged();

    void hasMoreLikedSongsChanged();
    void loadingMoreLikesChanged();
    void hasMoreArtistTracksChanged();
    void loadingMoreArtistTracksChanged();

    void currentTrackDetailsChanged();
    void loadingTrackDetailsChanged();

    void discoverRowsChanged();
    void loadingDiscoverChanged();

private:
    void acceptConnection();
    void handleSocket(QTcpSocket *socket);
    void stopServer();
    QPair<QString, QString> effectiveCredentials() const;

    QCoro::Task<QJsonObject> callWithRefresh(QString method, QJsonObject params = {});
    QCoro::Task<bool> ensureFreshSession();
    static QList<Song> songsFromTracks(const QJsonArray &tracks);
    static Song songFromTrack(const QJsonObject &track);
    void applyStatus(const QJsonObject &status);
    void setBusy(bool value);
    void setStatusMessage(const QString &message);
    void report(const QString &message);
    QString streamCacheDirectory() const;
    void pruneStreamCache(const QString &keeping);
    QString findYtDlpBinary() const;
    QCoro::Task<QString> downloadWithYtDlp(QString videoId);
    QCoro::Task<QString> downloadDirectInnertube(QString videoId);

    QCoro::Task<> runExchangeCode(QString code, QString clientId, QString clientSecret, quint64 generation);
    QCoro::Task<> refreshStatusTask();
    QCoro::Task<> logOutTask();
    QCoro::Task<> loadMoreLikedSongsTask();
    QCoro::Task<> loadMoreArtistTracksTask();
    QCoro::Task<> loadDiscoverTask();
    QCoro::Task<> openArtistFromSongTask(Song song);
    QCoro::Task<> loadArtistData(QString channelId, quint64 generation);
    QCoro::Task<> loadTrackDetailsData(Song song, quint64 generation);

    SidecarClient *m_sidecar = nullptr;
    Settings *m_settings = nullptr;
    QNetworkAccessManager *m_network = nullptr;
    ErrorCenter *m_errors = nullptr;
    QTcpServer m_server;

    bool m_connected = false;
    QString m_userName;
    QString m_userId;
    QString m_userEmail;
    QUrl m_avatarUrl;
    bool m_busy = false;
    QString m_statusMessage;
    bool m_browserLoginActive = false;
    QUrl m_authorizationUrl;
    QString m_pendingClientId;
    QString m_pendingClientSecret;
    quint64 m_connectGeneration = 0;

    SoundCloudArtistProfile m_currentArtist;
    SongListModel *m_artistTracks = nullptr;
    PlaylistListModel *m_artistPlaylists = nullptr;
    bool m_loadingArtist = false;

    quint64 m_artistGeneration = 0;
    QString m_artistTracksChannelId;
    QString m_artistTracksNextPageToken;
    bool m_hasMoreArtistTracks = false;
    bool m_loadingMoreArtistTracks = false;

    QString m_likedSongsNextPageToken;
    bool m_hasMoreLikedSongs = false;
    bool m_loadingMoreLikes = false;

    SoundCloudTrackDetails m_currentTrackDetails;
    SongListModel *m_relatedTracks = nullptr;
    bool m_loadingTrackDetails = false;
    quint64 m_trackDetailsGeneration = 0;

    QList<YouTubeDiscoverRow> m_discoverRows;
    bool m_loadingDiscover = false;
};

} // namespace resonance
