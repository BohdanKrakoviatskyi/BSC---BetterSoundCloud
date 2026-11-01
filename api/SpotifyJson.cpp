#include "spotify/SpotifyJson.h"

#include <QStringList>

#include <cstdlib>
#include <limits>

namespace resonance::json {

namespace {

QString string(const QJsonObject &object, const char *key)
{
    return object.value(QLatin1StringView(key)).toString();
}

QString joinedNames(const QJsonArray &artists)
{
    QStringList names;
    for (const QJsonValue &value : artists) {
        names.append(value.toObject().value(QStringLiteral("name")).toString());
    }
    return names.join(QStringLiteral(", "));
}

} // namespace

QUrl preferredArtworkUrl(const QJsonArray &images, int preferredWidth)
{
    QUrl best;
    int bestDistance = std::numeric_limits<int>::max();
    for (const QJsonValue &value : images) {
        const QJsonObject image = value.toObject();
        const QUrl url(image.value(QStringLiteral("url")).toString());
        if (!url.isValid() || url.isEmpty()) {
            continue;
        }
        const QJsonValue width = image.value(QStringLiteral("width"));
        const int distance = std::abs((width.isDouble() ? width.toInt() : preferredWidth) - preferredWidth);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = url;
        }
    }
    return best;
}

Profile profile(const QJsonObject &user)
{
    const QString name = string(user, "display_name");
    return {
        string(user, "id"),
        name.isEmpty() ? QStringLiteral("Spotify User") : name,
        preferredArtworkUrl(user.value(QStringLiteral("images")).toArray(), 192),
    };
}

Playlist playlist(const QJsonObject &object)
{
    Playlist result;
    result.id = string(object, "id");
    result.name = string(object, "name");
    result.description = string(object, "description");
    const QJsonObject items = object.value(QStringLiteral("items")).toObject();
    const QJsonObject tracks = object.value(QStringLiteral("tracks")).toObject();
    result.songCount = items.contains(QStringLiteral("total"))
        ? items.value(QStringLiteral("total")).toInt()
        : tracks.value(QStringLiteral("total")).toInt();
    result.artworkUrl = preferredArtworkUrl(object.value(QStringLiteral("images")).toArray(), 640);
    const QJsonObject owner = object.value(QStringLiteral("owner")).toObject();
    result.ownerId = string(owner, "id");
    result.ownerName = string(owner, "display_name");
    result.isPublic = object.value(QStringLiteral("public")).toBool();
    result.isCollaborative = object.value(QStringLiteral("collaborative")).toBool();
    result.uri = string(object, "uri");
    if (result.uri.isEmpty()) {
        result.uri = QStringLiteral("spotify:playlist:") + result.id;
    }
    return result;
}

std::optional<Album> album(const QJsonObject &object)
{
    const QString id = string(object, "id");
    const QString uri = string(object, "uri");
    if (id.isEmpty() || uri.isEmpty()) {
        return std::nullopt;
    }
    Album result;
    result.id = id;
    result.name = string(object, "name");
    result.artists = joinedNames(object.value(QStringLiteral("artists")).toArray());
    result.artworkUrl = preferredArtworkUrl(object.value(QStringLiteral("images")).toArray(), 640);
    result.releaseDate = string(object, "release_date");
    result.songCount = object.value(QStringLiteral("total_tracks")).toInt();
    result.uri = uri;
    return result;
}

std::optional<Artist> artist(const QJsonObject &object)
{
    const QString id = string(object, "id");
    const QString uri = string(object, "uri");
    if (id.isEmpty() || uri.isEmpty()) {
        return std::nullopt;
    }
    return Artist {
        id,
        string(object, "name"),
        preferredArtworkUrl(object.value(QStringLiteral("images")).toArray(), 640),
        uri,
    };
}

std::optional<Song> track(const QJsonObject &object, const Album &fallbackAlbum)
{
    const QString type = string(object, "type");
    const QString uri = string(object, "uri");
    if ((!type.isEmpty() && type != QLatin1StringView("track"))
        || !uri.startsWith(QLatin1StringView("spotify:track:"))) {
        return std::nullopt;
    }

    const QJsonObject albumObject = object.value(QStringLiteral("album")).toObject();
    const std::optional<Album> trackAlbum = album(albumObject);
    const Album resolvedAlbum = trackAlbum.value_or(fallbackAlbum);
    const QJsonArray artistArray = object.value(QStringLiteral("artists")).toArray();

    Song song;
    song.name = string(object, "name");
    song.artists = joinedNames(artistArray);
    song.albumName = resolvedAlbum.name;
    song.artworkUrl = preferredArtworkUrl(albumObject.value(QStringLiteral("images")).toArray(), 640);
    if (song.artworkUrl.isEmpty()) {
        song.artworkUrl = resolvedAlbum.artworkUrl;
    }
    song.uri = uri;
    song.durationMs = object.value(QStringLiteral("duration_ms")).toInt();
    song.isExplicit = object.value(QStringLiteral("explicit")).toBool();
    song.albumId = resolvedAlbum.id;
    song.albumUri = resolvedAlbum.uri;
    for (const QJsonValue &value : artistArray) {
        if (const auto parsed = artist(value.toObject())) {
            song.artistItems.append(*parsed);
        }
    }
    return song;
}

std::optional<Song> wrappedTrack(const QJsonObject &entry)
{
    const QJsonValue item = entry.value(QStringLiteral("item"));
    if (item.isObject()) {
        return track(item.toObject());
    }
    const QJsonValue legacy = entry.value(QStringLiteral("track"));
    return legacy.isObject() ? track(legacy.toObject()) : std::nullopt;
}

} // namespace resonance::json
