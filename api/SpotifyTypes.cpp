#include "spotify/SpotifyTypes.h"

#include <QJsonArray>

#include <atomic>

namespace resonance {

namespace {

quint64 nextInstanceId()
{
    static std::atomic<quint64> counter {0};
    return ++counter;
}

} // namespace

QJsonObject Artist::toJson() const
{
    QJsonObject obj {
        {QStringLiteral("id"), id},
        {QStringLiteral("name"), name},
        {QStringLiteral("artworkURL"), artworkUrl.toString()},
        {QStringLiteral("uri"), uri},
    };
    if (!source.isEmpty() && source != QLatin1StringView("spotify")) {
        obj.insert(QStringLiteral("source"), source);
    }
    return obj;
}

Artist Artist::fromJson(const QJsonObject &object)
{
    Artist artist {
        object.value(QStringLiteral("id")).toString(),
        object.value(QStringLiteral("name")).toString(),
        QUrl(object.value(QStringLiteral("artworkURL")).toString()),
        object.value(QStringLiteral("uri")).toString(),
    };
    const QString src = object.value(QStringLiteral("source")).toString();
    if (!src.isEmpty()) {
        artist.source = src;
    }
    return artist;
}

Song::Song()
    : instanceId(nextInstanceId())
{
}

QString Song::spotifyId() const
{
    const qsizetype colon = uri.lastIndexOf(u':');
    return colon < 0 ? uri : uri.mid(colon + 1);
}

Album Song::albumDestination() const
{
    if (albumId.isEmpty() || albumName.isEmpty()) {
        return {};
    }
    Album album;
    album.id = albumId;
    album.name = albumName;
    album.artists = artists;
    album.artworkUrl = artworkUrl;
    album.uri = albumUri.isEmpty() ? QStringLiteral("spotify:album:") + albumId : albumUri;
    return album;
}

Song Song::freshInstance() const
{
    Song copy = *this;
    copy.instanceId = nextInstanceId();
    return copy;
}

QJsonObject Song::toJson() const
{
    QJsonArray artistArray;
    for (const Artist &artist : artistItems) {
        artistArray.append(artist.toJson());
    }
    QJsonObject object {
        {QStringLiteral("name"), name},
        {QStringLiteral("artists"), artists},
        {QStringLiteral("uri"), uri},
        {QStringLiteral("isExplicit"), isExplicit},
    };
    if (!albumName.isEmpty()) object.insert(QStringLiteral("albumName"), albumName);
    if (artworkUrl.isValid()) object.insert(QStringLiteral("artworkURL"), artworkUrl.toString());
    if (durationMs > 0) object.insert(QStringLiteral("durationMs"), durationMs);
    if (!albumId.isEmpty()) object.insert(QStringLiteral("albumID"), albumId);
    if (!albumUri.isEmpty()) object.insert(QStringLiteral("albumURI"), albumUri);
    if (!artistArray.isEmpty()) object.insert(QStringLiteral("artistItems"), artistArray);
    if (!source.isEmpty() && source != QLatin1StringView("spotify")) {
        object.insert(QStringLiteral("source"), source);
    }
    if (!nativeId.isEmpty()) object.insert(QStringLiteral("nativeId"), nativeId);
    if (permalink.isValid()) object.insert(QStringLiteral("permalink"), permalink.toString());
    return object;
}

Song Song::fromJson(const QJsonObject &object)
{
    Song song;
    song.name = object.value(QStringLiteral("name")).toString();
    song.artists = object.value(QStringLiteral("artists")).toString();
    song.albumName = object.value(QStringLiteral("albumName")).toString();
    song.artworkUrl = QUrl(object.value(QStringLiteral("artworkURL")).toString());
    song.uri = object.value(QStringLiteral("uri")).toString();
    song.durationMs = object.value(QStringLiteral("durationMs")).toInt();
    song.isExplicit = object.value(QStringLiteral("isExplicit")).toBool();
    song.albumId = object.value(QStringLiteral("albumID")).toString();
    song.albumUri = object.value(QStringLiteral("albumURI")).toString();
    const QString source = object.value(QStringLiteral("source")).toString();
    if (!source.isEmpty()) {
        song.source = source;
    }
    song.nativeId = object.value(QStringLiteral("nativeId")).toString();
    song.permalink = QUrl(object.value(QStringLiteral("permalink")).toString());
    for (const QJsonValue &value : object.value(QStringLiteral("artistItems")).toArray()) {
        const Artist artist = Artist::fromJson(value.toObject());
        if (artist.isValid()) {
            song.artistItems.append(artist);
        }
    }
    return song;
}

} // namespace resonance
