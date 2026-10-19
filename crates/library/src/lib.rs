//! Persistent local music indexing and playlist data for Resonance.

mod local;
mod model;

pub use local::{
    LocalLibrary, LocalLibraryError, LocalScan, LocalSource, is_music_file, read_local_tags,
};
pub use model::{LocalTags, Song};
