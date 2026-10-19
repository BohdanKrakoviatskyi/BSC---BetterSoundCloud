use crate::{LocalTags, Song};
use lofty::{
    file::{AudioFile, TaggedFileExt},
    probe::Probe,
};
use serde::{Deserialize, Serialize};
use std::{
    cmp::Ordering,
    collections::hash_map::DefaultHasher,
    collections::{HashMap, HashSet},
    fs::{self, File},
    hash::{Hash, Hasher},
    io::{self, Write},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use thiserror::Error;
use walkdir::WalkDir;

const CACHE_VERSION: u32 = 1;
const MUSIC_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "ogg", "oga", "m4a", "mp4", "aac", "alac", "wav", "aif", "aiff",
];

#[derive(Debug, Error)]
pub enum LocalLibraryError {
    #[error("could not access local library: {0}")]
    Io(#[from] io::Error),
    #[error("could not read local library cache: {0}")]
    Cache(#[from] serde_json::Error),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalSource(PathBuf);

impl LocalSource {
    pub fn new(path: impl AsRef<Path>) -> io::Result<Self> {
        let path = fs::canonicalize(path)?;
        if !path.is_file() && !path.is_dir() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "source must be a file or directory",
            ));
        }
        if path.is_file() && !is_music_file(&path) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "source is not a supported music file",
            ));
        }
        Ok(Self(path))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LocalScan {
    pub songs: Vec<Song>,
    pub sources: Vec<LocalSource>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CachedEntry {
    size: u64,
    modified_ns: u128,
    tags: LocalTags,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct CacheEnvelope {
    version: u32,
    #[serde(default)]
    files: HashMap<PathBuf, CachedEntry>,
}

pub struct LocalLibrary {
    cache_path: PathBuf,
    sources: Vec<LocalSource>,
    entries: HashMap<PathBuf, CachedEntry>,
    songs: Vec<Song>,
}

impl LocalLibrary {
    pub fn open(cache_path: impl Into<PathBuf>) -> Result<Self, LocalLibraryError> {
        let cache_path = cache_path.into();
        let entries = match fs::read(&cache_path) {
            Ok(bytes) => serde_json::from_slice::<CacheEnvelope>(&bytes)
                .ok()
                .filter(|cache| cache.version == CACHE_VERSION)
                .map(|cache| cache.files)
                .unwrap_or_default(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            cache_path,
            sources: Vec::new(),
            entries,
            songs: Vec::new(),
        })
    }

    pub fn sources(&self) -> &[LocalSource] {
        &self.sources
    }

    pub fn songs(&self) -> &[Song] {
        &self.songs
    }

    pub fn restore_sources<I, P>(&mut self, paths: I) -> Result<usize, LocalLibraryError>
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        let added = self.add_sources(paths);
        self.persist_sources()?;
        Ok(added)
    }

    pub fn add_sources_persisted<I, P>(&mut self, paths: I) -> Result<usize, LocalLibraryError>
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        let added = self.add_sources(paths);
        self.persist_sources()?;
        Ok(added)
    }

    pub fn persist_sources(&self) -> Result<(), LocalLibraryError> {
        let serialized: Vec<&Path> = self.sources.iter().map(LocalSource::path).collect();
        atomic_write(
            &self.cache_path.with_file_name("local-sources.json"),
            &serde_json::to_vec(&serialized)?,
        )?;
        Ok(())
    }

    pub fn load_persisted_sources(&mut self) -> Result<usize, LocalLibraryError> {
        let path = self.cache_path.with_file_name("local-sources.json");
        let paths: Vec<PathBuf> = match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(self.add_sources(paths))
    }

    pub fn set_sources<I, P>(&mut self, paths: I) -> usize
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        self.sources.clear();
        self.add_sources(paths)
    }

    pub fn cached_songs(&self) -> Vec<Song> {
        let mut songs: Vec<_> = self
            .entries
            .iter()
            .filter(|(_, entry)| !entry.tags.is_empty())
            .map(|(path, entry)| Song::from_tags(path, entry.tags.clone()))
            .collect();
        sort_songs(&mut songs);
        songs
    }

    pub fn add_sources<I, P>(&mut self, paths: I) -> usize
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        let mut sources = self.sources.clone();
        let mut added = 0;
        for path in paths {
            let Ok(source) = LocalSource::new(path) else {
                continue;
            };
            if sources
                .iter()
                .any(|existing| is_within(source.path(), existing.path()))
            {
                continue;
            }
            if source.path().is_dir() {
                sources.retain(|existing| !is_within(existing.path(), source.path()));
            }
            sources.push(source);
            added += 1;
        }
        self.sources = sources;
        added
    }

    pub fn remove_source(&mut self, path: impl AsRef<Path>) -> bool {
        let Ok(path) = fs::canonicalize(path) else {
            return false;
        };
        let old_len = self.sources.len();
        self.sources.retain(|source| source.path() != path);
        let removed = self.sources.len() != old_len;
        if removed {
            self.songs.retain(|song| !is_within(&song.path, &path));
        }
        removed
    }

    /// Scan the current sources. `read_tags` is called only for changed files;
    /// its error is cached as empty tags so unchanged unreadable files are not retried.
    pub fn rescan<F>(&mut self, mut read_tags: F) -> Result<&[Song], LocalLibraryError>
    where
        F: FnMut(&Path) -> Result<LocalTags, String>,
    {
        let files = collect_files(&self.sources);
        let mut entries = HashMap::with_capacity(files.len());
        let mut songs = Vec::new();
        for path in files {
            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => continue,
            };
            let modified_ns = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_nanos())
                .unwrap_or_default();
            let size = metadata.len();
            let tags = match self.entries.get(&path) {
                Some(entry) if entry.size == size && entry.modified_ns == modified_ns => {
                    entry.tags.clone()
                }
                _ => read_tags(&path).unwrap_or_default(),
            };
            songs.push(Song::from_tags(&path, tags.clone()));
            entries.insert(
                path,
                CachedEntry {
                    size,
                    modified_ns,
                    tags,
                },
            );
        }
        let old: HashMap<&str, &Song> = self
            .songs
            .iter()
            .map(|song| (song.uri.as_str(), song))
            .collect();
        for song in &mut songs {
            if let Some(previous) = old.get(song.uri.as_str())
                && previous.name == song.name
                && previous.artists == song.artists
                && previous.album_name == song.album_name
                && previous.artwork_path == song.artwork_path
                && previous.duration_ms == song.duration_ms
            {
                song.instance_id = previous.instance_id;
            } else {
                song.instance_id = stable_instance_id(&song.uri);
            }
        }
        sort_songs(&mut songs);
        self.write_cache(&entries)?;
        self.entries = entries;
        self.songs = songs;
        Ok(&self.songs)
    }

    pub fn rescan_with_lofty(&mut self) -> Result<&[Song], LocalLibraryError> {
        self.rescan(read_local_tags)
    }

    fn write_cache(
        &self,
        entries: &HashMap<PathBuf, CachedEntry>,
    ) -> Result<(), LocalLibraryError> {
        let bytes = serde_json::to_vec(&CacheEnvelope {
            version: CACHE_VERSION,
            files: entries.clone(),
        })?;
        atomic_write(&self.cache_path, &bytes)?;
        Ok(())
    }
}

pub fn is_music_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MUSIC_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
        })
}

pub fn read_local_tags(path: &Path) -> Result<LocalTags, String> {
    let tagged = Probe::open(path)
        .and_then(|probe| probe.read())
        .map_err(|error| format!("could not read tags for {}: {error}", path.display()))?;
    let duration_ms = tagged
        .properties()
        .duration()
        .as_millis()
        .min(u64::MAX as u128) as u64;
    let mut tags = tagged
        .primary_tag()
        .map(|tag| LocalTags::from(tag.clone()))
        .or_else(|| tagged.first_tag().map(|tag| LocalTags::from(tag.clone())))
        .unwrap_or_default();
    tags.duration_ms = duration_ms;
    Ok(tags)
}

fn stable_instance_id(uri: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    uri.hash(&mut hasher);
    hasher.finish()
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().unwrap_or(Path::new("."));
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension(format!("{}.partial", std::process::id()));
    let result = (|| {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn collect_files(sources: &[LocalSource]) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    for source in sources {
        if source.path().is_file() {
            if is_music_file(source.path()) && seen.insert(source.path().to_path_buf()) {
                files.push(source.path().to_path_buf());
            }
            continue;
        }
        for entry in WalkDir::new(source.path())
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                if entry.depth() == 0 {
                    return true;
                }
                !entry.file_name().to_string_lossy().starts_with('.')
            })
            .flatten()
        {
            if entry.file_type().is_file() && is_music_file(entry.path()) {
                let path = entry.path().to_path_buf();
                if seen.insert(path.clone()) {
                    files.push(path);
                }
            }
        }
    }
    files
}

fn is_within(path: &Path, parent: &Path) -> bool {
    path == parent || path.starts_with(parent)
}

fn sort_songs(songs: &mut [Song]) {
    songs.sort_by(|left, right| {
        natural_cmp(album_artist(left), album_artist(right))
            .then_with(|| natural_cmp(&left.album_name, &right.album_name))
            .then_with(|| left.tags.disc_number.cmp(&right.tags.disc_number))
            .then_with(|| left.tags.track_number.cmp(&right.tags.track_number))
            .then_with(|| natural_cmp(&left.path.to_string_lossy(), &right.path.to_string_lossy()))
    });
}

fn album_artist(song: &Song) -> &str {
    song.tags.album_artist.as_deref().unwrap_or(&song.artists)
}

fn natural_cmp(left: &str, right: &str) -> Ordering {
    let mut left = left.chars().flat_map(char::to_lowercase).peekable();
    let mut right = right.chars().flat_map(char::to_lowercase).peekable();
    loop {
        match (left.peek(), right.peek()) {
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let a_digits: String = left.by_ref().take_while(|c| c.is_ascii_digit()).collect();
                let b_digits: String = right.by_ref().take_while(|c| c.is_ascii_digit()).collect();
                let a_value = a_digits.trim_start_matches('0');
                let b_value = b_digits.trim_start_matches('0');
                let order = a_value
                    .len()
                    .cmp(&b_value.len())
                    .then_with(|| a_value.cmp(b_value));
                if order != Ordering::Equal {
                    return order;
                }
                let order = a_digits.len().cmp(&b_digits.len());
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(_), Some(_)) => {
                let order = left.next().cmp(&right.next());
                if order != Ordering::Equal {
                    return order;
                }
            }
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "resonance-library-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn put(path: &Path, bytes: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, bytes).unwrap();
    }

    fn tags(title: &str, album: &str, track: u32) -> LocalTags {
        LocalTags {
            title: Some(title.into()),
            artist: Some("Sade".into()),
            album: Some(album.into()),
            album_artist: Some("Sade".into()),
            track_number: Some(track),
            duration_ms: 500,
            ..LocalTags::default()
        }
    }

    #[test]
    fn sources_deduplicate_and_parent_folders_replace_nested_sources() {
        let temp = TempDir::new();
        let parent = temp.path().join("Music");
        let nested = parent.join("Album");
        put(&nested.join("01.wav"), b"fixture");
        put(&parent.join("notes.txt"), b"ignored");
        let mut library = LocalLibrary::open(temp.path().join("cache.json")).unwrap();
        assert_eq!(library.add_sources([nested.clone()]), 1);
        assert_eq!(library.add_sources([nested.join("01.wav")]), 0);
        assert_eq!(library.add_sources([parent.clone()]), 1);
        assert_eq!(library.sources().len(), 1);
        assert_eq!(
            library.sources()[0].path(),
            fs::canonicalize(parent).unwrap()
        );
        assert!(LocalSource::new(temp.path().join("missing.wav")).is_err());
        assert!(LocalSource::new(temp.path().join("bad.txt")).is_err());
    }

    #[test]
    fn scan_skips_hidden_and_unsupported_files_and_naturally_sorts_tracks() {
        let temp = TempDir::new();
        let music = temp.path().join("Music");
        put(&music.join("Album/10.wav"), b"ten");
        put(&music.join("Album/2.WAV"), b"two");
        put(&music.join(".hidden/01.wav"), b"hidden");
        put(&music.join("Album/notes.txt"), b"ignored");
        let mut library = LocalLibrary::open(temp.path().join("cache.json")).unwrap();
        assert_eq!(library.add_sources([music]), 1);
        let songs = library
            .rescan(|path| {
                Ok(if path.file_name().unwrap() == "10.wav" {
                    tags("Track 10", "Album 2", 10)
                } else {
                    tags("Track 2", "Album 2", 2)
                })
            })
            .unwrap();
        assert_eq!(songs.len(), 2);
        assert_eq!(songs[0].name, "Track 2");
        assert_eq!(songs[1].name, "Track 10");
        assert_eq!(songs[0].duration_ms, 500);
    }

    #[test]
    fn scanned_untagged_audio_still_appears_with_legacy_fallbacks() {
        let temp = TempDir::new();
        let music = temp.path().join("Music/Album");
        put(&music.join("01 [HQ].wav"), b"untagged audio");
        let mut library = LocalLibrary::open(temp.path().join("cache.json")).unwrap();
        library.add_sources([music.parent().unwrap()]);
        let songs = library.rescan(|_| Ok(LocalTags::default())).unwrap();
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].name, "01 [HQ]");
        assert_eq!(songs[0].artists, "Unknown Artist");
        assert_eq!(songs[0].album_name, "Album");
    }

    #[test]
    fn sources_persist_and_stable_songs_keep_their_instance_id() {
        let temp = TempDir::new();
        let music = temp.path().join("Music");
        put(&music.join("one.wav"), b"fixture");
        let cache = temp.path().join("cache.json");
        let mut library = LocalLibrary::open(&cache).unwrap();
        library.restore_sources([&music]).unwrap();
        library.rescan(|_| Ok(tags("One", "Album", 1))).unwrap();
        let instance = library.songs()[0].instance_id;
        library
            .rescan(|_| panic!("unchanged file must reuse tags"))
            .unwrap();
        assert_eq!(library.songs()[0].instance_id, instance);
        let mut reopened = LocalLibrary::open(&cache).unwrap();
        assert_eq!(reopened.load_persisted_sources().unwrap(), 1);
        assert_eq!(reopened.sources().len(), 1);
    }

    #[test]
    fn changed_files_reread_tags_unchanged_and_failed_tags_are_cached() {
        let temp = TempDir::new();
        let music = temp.path().join("Music");
        let song_path = music.join("one.wav");
        let broken_path = music.join("broken.flac");
        put(&song_path, b"one");
        put(&broken_path, b"bad");
        let mut library = LocalLibrary::open(temp.path().join("cache.json")).unwrap();
        library.add_sources([music]);
        let calls = Arc::new(AtomicUsize::new(0));
        let count = Arc::clone(&calls);
        library
            .rescan(move |path| {
                count.fetch_add(1, Ordering::Relaxed);
                if path.ends_with("broken.flac") {
                    Err("invalid audio".into())
                } else {
                    Ok(tags("One", "Album", 1))
                }
            })
            .unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        let count = Arc::clone(&calls);
        library
            .rescan(move |_| {
                count.fetch_add(1, Ordering::Relaxed);
                Ok(LocalTags::default())
            })
            .unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        put(&song_path, b"one changed");
        let count = Arc::clone(&calls);
        library
            .rescan(move |_| {
                count.fetch_add(1, Ordering::Relaxed);
                Ok(tags("Updated", "Album", 1))
            })
            .unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 3);
        assert_eq!(library.songs()[0].name, "Updated");
    }

    #[test]
    fn cache_is_available_immediately_and_corrupt_cache_is_ignored() {
        let temp = TempDir::new();
        let music = temp.path().join("Music");
        let song_path = music.join("one.wav");
        put(&song_path, b"fixture");
        let cache = temp.path().join("cache.json");
        let mut library = LocalLibrary::open(&cache).unwrap();
        library.add_sources([music.clone()]);
        library.rescan(|_| Ok(tags("Cached", "Album", 1))).unwrap();
        let reopened = LocalLibrary::open(&cache).unwrap();
        assert_eq!(reopened.cached_songs().len(), 1);
        put(&cache, b"not json");
        assert!(
            LocalLibrary::open(&cache)
                .unwrap()
                .cached_songs()
                .is_empty()
        );
    }

    #[test]
    fn song_fallbacks_match_legacy_local_files() {
        let temp = TempDir::new();
        let path = temp.path().join("Album/song [HQ].wav");
        put(&path, b"fixture");
        let song = Song::from_tags(&path, LocalTags::default());
        assert_eq!(song.name, "song [HQ]");
        assert_eq!(song.artists, "Unknown Artist");
        assert_eq!(song.album_name, "Album");
        assert!(song.uri.starts_with("file:"));
    }
}
