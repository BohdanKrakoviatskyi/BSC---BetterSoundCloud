//! Persistent local music indexing and playlist data for Resonance.

mod local;
mod model;
mod playlists;
mod tags_edit;

pub use local::{
    LocalLibrary, LocalLibraryError, LocalScan, LocalSource, is_music_file, read_local_tags,
};
pub use model::{LocalTags, Song};
pub use playlists::{LocalPlaylist, LocalPlaylistStore, PlaylistError};
pub use tags_edit::{TagEdits, write_local_tags};
