#pragma once

#include <QString>

namespace resonance::paths {

/// $XDG_DATA_HOME/Resonance, created on first use: what the app keeps of the
/// person's, such as their local playlists.
QString dataDirectory();
/// $XDG_CACHE_HOME/Resonance, for artwork and other things safe to delete.
QString cacheDirectory();

} // namespace resonance::paths
