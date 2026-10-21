#pragma once

#include <QJsonObject>
#include <QList>
#include <QMetaType>
#include <QString>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

namespace resonance {

struct Artist {
    Q_GADGET
    QML_VALUE_TYPE(artist)
    Q_PROPERTY(QString id MEMBER id FINAL)
    Q_PROPERTY(QString name MEMBER name FINAL)
    Q_PROPERTY(QUrl artworkUrl MEMBER artworkUrl FINAL)
    Q_PROPERTY(QString uri MEMBER uri FINAL)
    Q_PROPERTY(bool valid READ isValid FINAL)
    Q_PROPERTY(QString source MEMBER source FINAL)
    Q_PROPERTY(bool isSoundCloud READ isSoundCloud FINAL)

public:
    QString id;
    QString name;
    QUrl artworkUrl;
    QString uri;
    QString source = QStringLiteral("spotify");

    bool isValid() const { return !id.isEmpty(); }
    bool isSoundCloud() const { return source == QLatin1StringView("soundcloud") || uri.startsWith(QLatin1StringView("soundcloud:")); }
    bool operator==(const Artist &) const = default;

    QJsonObject toJson() const;
    static Artist fromJson(const QJsonObject &object);
};

struct Album {
    Q_GADGET
    QML_VALUE_TYPE(album)
    Q_PROPERTY(QString id MEMBER id FINAL)
    Q_PROPERTY(QString name MEMBER name FINAL)
    Q_PROPERTY(QString artists MEMBER artists FINAL)
    Q_PROPERTY(QUrl artworkUrl MEMBER artworkUrl FINAL)
    Q_PROPERTY(QString releaseDate MEMBER releaseDate FINAL)
    Q_PROPERTY(int songCount MEMBER songCount FINAL)
    Q_PROPERTY(QString uri MEMBER uri FINAL)
    Q_PROPERTY(bool valid READ isValid FINAL)

public:
    QString id;
    QString name;
    QString artists;
    QUrl artworkUrl;
    QString releaseDate;
    int songCount = 0;
    QString uri;

    bool isValid() const { return !id.isEmpty(); }
    bool operator==(const Album &) const = default;
};

/// one occurrence of a track. two songs with the same uri are still different
/// songs to the queue, the way the swift app gives each a fresh uuid.
struct Song {
    Q_GADGET
    QML_VALUE_TYPE(song)
    Q_PROPERTY(quint64 instanceId MEMBER instanceId FINAL)
    Q_PROPERTY(QString name MEMBER name FINAL)
    Q_PROPERTY(QString artists MEMBER artists FINAL)
    Q_PROPERTY(QString albumName MEMBER albumName FINAL)
    Q_PROPERTY(QUrl artworkUrl MEMBER artworkUrl FINAL)
    Q_PROPERTY(QString uri MEMBER uri FINAL)
    Q_PROPERTY(int durationMs MEMBER durationMs FINAL)
    Q_PROPERTY(bool isExplicit MEMBER isExplicit FINAL)
    Q_PROPERTY(QString albumId MEMBER albumId FINAL)
    Q_PROPERTY(QString albumUri MEMBER albumUri FINAL)
    Q_PROPERTY(bool valid READ isValid FINAL)
    /// a music file of the person's own (LocalLibrary), not a spotify track:
    /// nothing spotify knows can be done with it
    Q_PROPERTY(bool isLocalFile READ isLocalFile FINAL)
    Q_PROPERTY(bool isSoundCloud READ isSoundCloud FINAL)
    /// which service it comes from: "spotify", "soundcloud", or "local". the
    /// uri stays the single identity the whole app passes around, and this is
    /// what says who can answer for it
    Q_PROPERTY(QString source MEMBER source FINAL)
    /// the service's own id: spotify's base62, soundcloud's numeric id
    Q_PROPERTY(QString nativeId MEMBER nativeId FINAL)
    /// where the service's own client opens it, for a link out of the app
    Q_PROPERTY(QUrl permalink MEMBER permalink FINAL)

public:
    Song();

    quint64 instanceId = 0;
    QString name;
    QString artists;
    QString albumName;
    QUrl artworkUrl;
    QString uri;
    /// 0 when spotify did not say
    int durationMs = 0;
    bool isExplicit = false;
    QString albumId;
    QString albumUri;
    QList<Artist> artistItems;
    QString source = QStringLiteral("spotify");
    QString nativeId;
    QUrl permalink;

    bool isValid() const { return !uri.isEmpty(); }
    /// its uri is the file's own url, file:///...
    bool isLocalFile() const { return uri.startsWith(QLatin1StringView("file:")); }
    QString localPath() const { return isLocalFile() ? QUrl(uri).toLocalFile() : QString(); }
    /// a soundcloud track: its stream is fetched by id before it can play
    bool isSoundCloud() const { return source == QLatin1StringView("soundcloud"); }
    /// a spotify track, which librespot plays from its uri
    bool isSpotify() const { return source == QLatin1StringView("spotify"); }
    /// the service's id, whatever it is
    QString serviceId() const { return nativeId.isEmpty() ? spotifyId() : nativeId; }
    /// the same occurrence, not merely the same track
    bool isSameInstance(const Song &other) const { return instanceId == other.instanceId; }
    bool operator==(const Song &other) const { return instanceId == other.instanceId; }

    /// the base62 id at the end of the uri
    QString spotifyId() const;
    /// the album to open from this song, when spotify told us enough
    Album albumDestination() const;
    Artist primaryArtist() const { return artistItems.isEmpty() ? Artist {} : artistItems.first(); }
    /// a copy that counts as a new occurrence
    Song freshInstance() const;

    QJsonObject toJson() const;
    static Song fromJson(const QJsonObject &object);
};

struct Playlist {
    Q_GADGET
    QML_VALUE_TYPE(playlist)
    Q_PROPERTY(QString id MEMBER id FINAL)
    Q_PROPERTY(QString name MEMBER name FINAL)
    Q_PROPERTY(QString description MEMBER description FINAL)
    Q_PROPERTY(int songCount MEMBER songCount FINAL)
    Q_PROPERTY(QUrl artworkUrl MEMBER artworkUrl FINAL)
    Q_PROPERTY(QString ownerId MEMBER ownerId FINAL)
    Q_PROPERTY(QString ownerName MEMBER ownerName FINAL)
    Q_PROPERTY(QString ownerDisplayName READ ownerDisplayName FINAL)
    Q_PROPERTY(bool isPublic MEMBER isPublic FINAL)
    Q_PROPERTY(bool isCollaborative MEMBER isCollaborative FINAL)
    Q_PROPERTY(QString uri MEMBER uri FINAL)
    Q_PROPERTY(bool valid READ isValid FINAL)
    /// made on this computer from files of the person's own (LocalLibrary),
    /// not a spotify playlist
    Q_PROPERTY(bool isLocal READ isLocal FINAL)
    Q_PROPERTY(bool isSoundCloud READ isSoundCloud FINAL)
    /// whose playlist it is: "spotify" or "soundcloud"
    Q_PROPERTY(QString source MEMBER source FINAL)

public:
    QString id;
    QString name;
    QString description;
    int songCount = 0;
    QUrl artworkUrl;
    QString ownerId;
    QString ownerName;
    bool isPublic = false;
    bool isCollaborative = false;
    QString uri;
    QString source = QStringLiteral("spotify");

    bool isValid() const { return !id.isEmpty(); }
    bool isLocal() const { return id.startsWith(QLatin1StringView("local:")); }
    /// one the soundcloud sidecar reads: only plain listing and playing
    bool isSoundCloud() const { return source == QLatin1StringView("soundcloud"); }
    bool operator==(const Playlist &) const = default;
    QString ownerDisplayName() const
    {
        if (!ownerName.isEmpty()) {
            return ownerName;
        }
        return isSoundCloud() ? QStringLiteral("SoundCloud") : QStringLiteral("Spotify");
    }
    bool canModify(const QString &currentUserId) const
    {
        return isCollaborative || (!currentUserId.isEmpty() && ownerId == currentUserId);
    }
};

struct Profile {
    QString id;
    QString displayName;
    QUrl artworkUrl;

    bool isValid() const { return !id.isEmpty(); }
};

struct SearchResults {
    QList<Song> songs;
    QList<Album> albums;
    QList<Artist> artists;
    QList<Playlist> playlists;

    bool isEmpty() const { return songs.isEmpty() && albums.isEmpty() && artists.isEmpty() && playlists.isEmpty(); }
};

} // namespace resonance

Q_DECLARE_METATYPE(resonance::Song)
Q_DECLARE_METATYPE(resonance::Playlist)
Q_DECLARE_METATYPE(resonance::Album)
Q_DECLARE_METATYPE(resonance::Artist)
