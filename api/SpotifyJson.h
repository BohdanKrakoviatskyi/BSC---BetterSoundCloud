#pragma once

#include "spotify/SpotifyTypes.h"

#include <QJsonArray>
#include <QJsonObject>
#include <optional>

/// spotify web api objects to resonance's own, as SpotifyWebAPI.swift maps them.
/// an entry spotify returns malformed is skipped rather than failing the page.
namespace resonance::json {

QUrl preferredArtworkUrl(const QJsonArray &images, int preferredWidth = 640);
Profile profile(const QJsonObject &user);
Playlist playlist(const QJsonObject &object);
std::optional<Album> album(const QJsonObject &object);
std::optional<Artist> artist(const QJsonObject &object);
/// only real tracks: episodes and local files come back as nullopt
std::optional<Song> track(const QJsonObject &object, const Album &fallbackAlbum = {});
/// the "item" of a playlist, saved-track or history entry, or its older "track"
std::optional<Song> wrappedTrack(const QJsonObject &entry);

} // namespace resonance::json
