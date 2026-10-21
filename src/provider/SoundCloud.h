#pragma once

#include "library/CollectionModels.h"
#include "library/SongListModel.h"
#include "playback/Lyrics.h"
#include "spotify/SpotifyTypes.h"

#include <QHash>
#include <QNetworkAccessManager>
#include <QObject>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

#include <QCoroTask>

class QQmlEngine;
class QJSEngine;

namespace resonance {

class ErrorCenter;
class Settings;
class SidecarClient;

struct SoundCloudArtistProfile {
    Q_GADGET
    QML_VALUE_TYPE(soundCloudArtistProfile)
    Q_PROPERTY(QString id MEMBER id FINAL)
    Q_PROPERTY(QString username MEMBER username FINAL)
    Q_PROPERTY(QString fullName MEMBER fullName FINAL)
    Q_PROPERTY(QUrl permalink MEMBER permalink FINAL)
    Q_PROPERTY(QUrl avatarUrl MEMBER avatarUrl FINAL)
    Q_PROPERTY(QUrl bannerUrl MEMBER bannerUrl FINAL)
    Q_PROPERTY(QString description MEMBER description FINAL)
    Q_PROPERTY(QString city MEMBER city FINAL)
    Q_PROPERTY(QString country MEMBER country FINAL)
    Q_PROPERTY(qint64 followersCount MEMBER followersCount FINAL)
    Q_PROPERTY(qint64 followingsCount MEMBER followingsCount FINAL)
    Q_PROPERTY(qint64 trackCount MEMBER trackCount FINAL)
    Q_PROPERTY(qint64 likesCount MEMBER likesCount FINAL)
    Q_PROPERTY(bool verified MEMBER verified FINAL)
    Q_PROPERTY(bool valid READ isValid FINAL)

public:
    QString id;
    QString username;
    QString fullName;
    QUrl permalink;
    QUrl avatarUrl;
    QUrl bannerUrl;
    QString description;
    QString city;
    QString country;
    qint64 followersCount = 0;
    qint64 followingsCount = 0;
    qint64 trackCount = 0;
    qint64 likesCount = 0;
    bool verified = false;

    bool isValid() const { return !id.isEmpty(); }
    bool operator==(const SoundCloudArtistProfile &) const = default;
};

struct SoundCloudTrackDetails {
    Q_GADGET
    QML_VALUE_TYPE(soundCloudTrackDetails)
    Q_PROPERTY(QString id MEMBER id FINAL)
    Q_PROPERTY(QString urn MEMBER urn FINAL)
    Q_PROPERTY(QString title MEMBER title FINAL)
    Q_PROPERTY(QUrl permalink MEMBER permalink FINAL)
    Q_PROPERTY(QUrl artworkUrl MEMBER artworkUrl FINAL)
    Q_PROPERTY(QString description MEMBER description FINAL)
    Q_PROPERTY(QString genre MEMBER genre FINAL)
    Q_PROPERTY(QString tagList MEMBER tagList FINAL)
    Q_PROPERTY(int durationMs MEMBER durationMs FINAL)
    Q_PROPERTY(qint64 playbackCount MEMBER playbackCount FINAL)
    Q_PROPERTY(qint64 likesCount MEMBER likesCount FINAL)
    Q_PROPERTY(qint64 repostsCount MEMBER repostsCount FINAL)
    Q_PROPERTY(qint64 commentCount MEMBER commentCount FINAL)
    Q_PROPERTY(QString createdAt MEMBER createdAt FINAL)
    Q_PROPERTY(QString displayDate MEMBER displayDate FINAL)
    Q_PROPERTY(QUrl waveformUrl MEMBER waveformUrl FINAL)
    Q_PROPERTY(QString artistId MEMBER artistId FINAL)
    Q_PROPERTY(QString artistName MEMBER artistName FINAL)
    Q_PROPERTY(QUrl artistAvatar MEMBER artistAvatar FINAL)
    Q_PROPERTY(qint64 artistFollowers MEMBER artistFollowers FINAL)
    Q_PROPERTY(bool valid READ isValid FINAL)

public:
    QString id;
    QString urn;
    QString title;
    QUrl permalink;
    QUrl artworkUrl;
    QString description;
    QString genre;
    QString tagList;
    int durationMs = 0;
    qint64 playbackCount = 0;
    qint64 likesCount = 0;
    qint64 repostsCount = 0;
    qint64 commentCount = 0;
    QString createdAt;
    QString displayDate;
    QUrl waveformUrl;
    QString artistId;
    QString artistName;
    QUrl artistAvatar;
    qint64 artistFollowers = 0;

    bool isValid() const { return !id.isEmpty(); }
    bool operator==(const SoundCloudTrackDetails &) const = default;
};

/// soundcloud, through the go sidecar the SoundCloud app also runs.
/// the app connects with two things the person pastes in: its own client id,
/// which signs a stream url, and the access token of their session, which the
/// sidecar keeps (and verifies against /me) rather than the app.
class SoundCloud : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(SoundCloud)
    QML_SINGLETON

    /// the sidecar says a session is in place
    Q_PROPERTY(bool connected READ connected NOTIFY accountChanged FINAL)
    Q_PROPERTY(QString userName READ userName NOTIFY accountChanged FINAL)
    Q_PROPERTY(QString userId READ userId NOTIFY accountChanged FINAL)
    Q_PROPERTY(QUrl avatarUrl READ avatarUrl NOTIFY accountChanged FINAL)
    /// a request of ours is in flight: the connect form shows a spinner
    Q_PROPERTY(bool busy READ busy NOTIFY busyChanged FINAL)
    /// the last thing that happened, for the connect form to show: an error
    /// from soundcloud, or that the account is connected
    Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusMessageChanged FINAL)
    /// the app's own soundcloud client id, kept in the app's settings
    Q_PROPERTY(QString clientId READ clientId WRITE setClientId NOTIFY clientIdChanged FINAL)
    /// whether this build has the sidecar at all
    Q_PROPERTY(bool available READ available NOTIFY availableChanged FINAL)

    // Artist Profile and related models
    Q_PROPERTY(resonance::SoundCloudArtistProfile currentArtist READ currentArtist NOTIFY currentArtistChanged FINAL)
    Q_PROPERTY(resonance::SongListModel *artistTracks READ artistTracks CONSTANT FINAL)
    Q_PROPERTY(resonance::SongListModel *artistLikes READ artistLikes CONSTANT FINAL)
    Q_PROPERTY(resonance::PlaylistListModel *artistPlaylists READ artistPlaylists CONSTANT FINAL)
    Q_PROPERTY(bool loadingArtist READ loadingArtist NOTIFY loadingArtistChanged FINAL)


    // Tracks and likes pagination
    Q_PROPERTY(bool hasMoreArtistTracks READ hasMoreArtistTracks NOTIFY hasMoreArtistTracksChanged FINAL)
    Q_PROPERTY(bool loadingMoreArtistTracks READ loadingMoreArtistTracks NOTIFY loadingMoreArtistTracksChanged FINAL)
    Q_PROPERTY(bool hasMoreLikedSongs READ hasMoreLikedSongs NOTIFY hasMoreLikedSongsChanged FINAL)
    Q_PROPERTY(bool loadingMoreLikes READ loadingMoreLikes NOTIFY loadingMoreLikesChanged FINAL)
    Q_PROPERTY(bool hasMoreArtistLikes READ hasMoreArtistLikes NOTIFY hasMoreArtistLikesChanged FINAL)
    Q_PROPERTY(bool loadingMoreArtistLikes READ loadingMoreArtistLikes NOTIFY loadingMoreArtistLikesChanged FINAL)

    // Track details and related tracks
    Q_PROPERTY(resonance::SoundCloudTrackDetails currentTrackDetails READ currentTrackDetails NOTIFY currentTrackDetailsChanged FINAL)
    Q_PROPERTY(resonance::SongListModel *relatedTracks READ relatedTracks CONSTANT FINAL)
    Q_PROPERTY(bool loadingTrackDetails READ loadingTrackDetails NOTIFY loadingTrackDetailsChanged FINAL)


public:
    SoundCloud(SidecarClient *sidecar, Settings *settings, QNetworkAccessManager *network,
               ErrorCenter *errors, QObject *parent = nullptr);
    ~SoundCloud() override;

    static SoundCloud *instance();
    static SoundCloud *create(QQmlEngine *, QJSEngine *);

    bool connected() const { return m_connected; }
    QString userName() const { return m_userName; }
    QString userId() const { return m_userId; }
    QUrl avatarUrl() const { return m_avatarUrl; }
    bool busy() const { return m_busy; }
    QString statusMessage() const { return m_statusMessage; }
    QString clientId() const;
    void setClientId(const QString &value);
    bool available() const;

    SoundCloudArtistProfile currentArtist() const { return m_currentArtist; }
    SongListModel *artistTracks() const { return m_artistTracks; }
    SongListModel *artistLikes() const { return m_artistLikes; }
    PlaylistListModel *artistPlaylists() const { return m_artistPlaylists; }
    bool loadingArtist() const { return m_loadingArtist; }


    SoundCloudTrackDetails currentTrackDetails() const { return m_currentTrackDetails; }
    SongListModel *relatedTracks() const { return m_relatedTracks; }
    bool loadingTrackDetails() const { return m_loadingTrackDetails; }


    /// connects with the two things that are pasted in: the client id goes to
    /// the sidecar's settings, the token is verified against /me and kept
    /// there. both are needed, and the client id is remembered by the app.
    Q_INVOKABLE void connectAccount(const QString &clientId, const QString &token);
    /// asks the sidecar what it has, without spending anything
    Q_INVOKABLE void refreshStatus();
    Q_INVOKABLE void logOut();
    /// what the connect form clears before showing a new outcome
    Q_INVOKABLE void clearStatusMessage();

    bool hasMoreLikedSongs() const { return m_hasMoreLikedSongs; }
    bool loadingMoreLikes() const { return m_loadingMoreLikes; }
    bool hasMoreArtistLikes() const { return m_hasMoreArtistLikes; }
    bool loadingMoreArtistLikes() const { return m_loadingMoreArtistLikes; }
    bool hasMoreArtistTracks() const { return m_hasMoreArtistTracks; }
    bool loadingMoreArtistTracks() const { return m_loadingMoreArtistTracks; }

    Q_INVOKABLE void loadMoreLikedSongs();
    Q_INVOKABLE void loadMoreArtistLikes();
    Q_INVOKABLE void loadMoreArtistTracks();

    Q_INVOKABLE void openArtist(const QString &userIdOrUsername);
    Q_INVOKABLE void openArtistFromSong(const resonance::Song &song);
    Q_INVOKABLE void openTrackDetails(const resonance::Song &song);

    /// the person's liked tracks, newest first
    QCoro::Task<QList<Song>> likedSongs();
    /// the person's own playlists, and the ones soundcloud made for them
    QCoro::Task<QList<Playlist>> playlists();
    QCoro::Task<QList<Song>> playlistSongs(const Playlist &playlist);
    QCoro::Task<QList<Song>> searchSongs(QString query);

    QCoro::Task<Artist> artistFromSong(const Song &song);
    QCoro::Task<SoundCloudArtistProfile> fetchUserProfile(qint64 userId);
    QCoro::Task<SoundCloudTrackDetails> fetchTrackDetails(qint64 trackId);
    QCoro::Task<QList<Song>> fetchUserTracks(qint64 userId);
    QCoro::Task<QList<Song>> fetchUserLikes(qint64 userId);
    QCoro::Task<QList<Playlist>> fetchUserPlaylists(qint64 userId);
    QCoro::Task<QList<Song>> fetchRelatedTracks(qint64 trackId);

    /// the stream, fetched into the cache, as a path the core can play. throws
    /// SpotifyError with the sidecar's own message when it cannot be had:
    /// a track that is only a preview, one that is not streamable at all
    QCoro::Task<QString> streamPath(const Song &song);

    /// lyrics for the track through the sidecar (Deezer + LRCLIB matching, same as Resonance)
    QCoro::Task<std::optional<Lyrics>> lyrics(const Song &song);

signals:
    void accountChanged();
    void busyChanged();
    void statusMessageChanged();
    void clientIdChanged();
    void availableChanged();

    void currentArtistChanged();
    void loadingArtistChanged();


    void hasMoreLikedSongsChanged();
    void loadingMoreLikesChanged();
    void hasMoreArtistLikesChanged();
    void loadingMoreArtistLikesChanged();
    void hasMoreArtistTracksChanged();
    void loadingMoreArtistTracksChanged();

    void currentTrackDetailsChanged();
    void loadingTrackDetailsChanged();


private:
    QCoro::Task<QJsonObject> call(QString method, QJsonObject params = {});
    /// a playlist's tracks, or its cards: both come back as track cards
    static QList<Song> songsFromCards(const QJsonArray &cards);
    static Song songFromCard(const QJsonObject &card);
    void applyStatus(const QJsonObject &status);
    void setBusy(bool value);
    void setStatusMessage(const QString &message);
    void report(const QString &message);
    QString streamCacheDirectory() const;
    QCoro::Task<> runConnect(QString clientId, QString token, quint64 generation);
    QCoro::Task<> refreshStatusTask();
    QCoro::Task<> logOutTask();
    QCoro::Task<> loadMoreLikedSongsTask();
    QCoro::Task<> loadMoreArtistLikesTask();
    QCoro::Task<> loadMoreArtistTracksTask();
    QCoro::Task<> openArtistFromSongTask(Song song);
    void pruneStreamCache(const QString &keeping);
    /// download and cache an HLS stream by fetching the M3U8 and every segment
    QCoro::Task<QString> downloadHlsStream(const QString &m3u8Url, const QString &uri);
    /// download and cache a plain progressive stream
    QCoro::Task<QString> downloadProgressiveStream(const QString &url, const QString &uri,
                                                   bool preview);

    QCoro::Task<> loadArtistData(qint64 userId, quint64 generation);
    QCoro::Task<> loadTrackDetailsData(Song song, quint64 generation);

    SidecarClient *m_sidecar = nullptr;
    Settings *m_settings = nullptr;
    QNetworkAccessManager *m_network = nullptr;
    ErrorCenter *m_errors = nullptr;

    bool m_connected = false;
    QString m_userName;
    QString m_userId;
    QUrl m_avatarUrl;
    bool m_busy = false;
    QString m_statusMessage;
    quint64 m_connectGeneration = 0;

    SoundCloudArtistProfile m_currentArtist;
    SongListModel *m_artistTracks = nullptr;
    SongListModel *m_artistLikes = nullptr;
    PlaylistListModel *m_artistPlaylists = nullptr;
    bool m_loadingArtist = false;

    quint64 m_artistGeneration = 0;
    qint64 m_artistTracksUserId = 0;
    QString m_artistTracksNextHref;
    bool m_hasMoreArtistTracks = false;
    bool m_loadingMoreArtistTracks = false;
    qint64 m_artistLikesUserId = 0;
    QString m_artistLikesNextHref;
    bool m_hasMoreArtistLikes = false;
    bool m_loadingMoreArtistLikes = false;

    QString m_likedSongsNextHref;
    bool m_hasMoreLikedSongs = false;
    bool m_loadingMoreLikes = false;

    SoundCloudTrackDetails m_currentTrackDetails;
    SongListModel *m_relatedTracks = nullptr;
    bool m_loadingTrackDetails = false;

    quint64 m_trackDetailsGeneration = 0;
};

} // namespace resonance
