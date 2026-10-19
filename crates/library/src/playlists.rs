use crate::{LocalTags, Song, read_local_tags_with_artwork};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;

const VERSION: u32 = 1;
static NEXT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
pub enum PlaylistError {
    #[error("playlist storage failed: {0}")]
    Io(#[from] io::Error),
    #[error("playlist data is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("playlist does not exist")]
    Missing,
    #[error("playlist name cannot be empty")]
    EmptyName,
    #[error("playlist artwork must be a JPEG or PNG smaller than 20 MiB")]
    InvalidArtwork,
    #[error("track is not owned by a local playlist")]
    MissingTrack,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaylist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub artwork_path: Option<PathBuf>,
    pub songs: Vec<Song>,
    #[serde(default)]
    origins: HashMap<String, SourceCopy>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct SourceCopy {
    size: u64,
    modified_ns: u128,
    path: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    playlists: Vec<LocalPlaylist>,
}

#[derive(Deserialize)]
struct LegacyEnvelope {
    version: u32,
    #[serde(default)]
    playlists: Vec<LegacyPlaylist>,
}

#[derive(Deserialize)]
struct LegacyPlaylist {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    cover: String,
    #[serde(default)]
    songs: Vec<String>,
}

pub struct LocalPlaylistStore {
    data_path: PathBuf,
    tracks_dir: PathBuf,
    artwork_dir: PathBuf,
    playlists: Vec<LocalPlaylist>,
}

impl LocalPlaylistStore {
    pub fn open(data_path: impl Into<PathBuf>) -> Result<Self, PlaylistError> {
        let data_path = data_path.into();
        let tracks_dir = data_path.with_file_name("local-playlist-tracks");
        let artwork_dir = data_path.with_file_name("local-playlist-covers");
        let mut store = Self {
            data_path,
            tracks_dir,
            artwork_dir,
            playlists: Vec::new(),
        };
        match fs::read(&store.data_path) {
            Ok(bytes) if is_legacy_envelope(&bytes) => {
                if let Ok(envelope) = serde_json::from_slice::<LegacyEnvelope>(&bytes)
                    && envelope.version == VERSION
                {
                    store.playlists = migrate_legacy_playlists(
                        envelope.playlists,
                        &store.tracks_dir,
                        &store.artwork_dir,
                        &store.data_path.with_file_name("local-artwork"),
                    )?;
                    store.persist()?;
                    store.collect_unheld()?;
                }
            }
            Ok(bytes) => {
                store.playlists = serde_json::from_slice::<Envelope>(&bytes)
                    .ok()
                    .filter(|envelope| envelope.version == VERSION)
                    .map(|envelope| envelope.playlists)
                    .unwrap_or_default();
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(store)
    }

    pub fn playlists(&self) -> &[LocalPlaylist] {
        &self.playlists
    }

    pub fn song_path_for_uri(&self, uri: &str) -> Option<PathBuf> {
        let root = fs::canonicalize(&self.tracks_dir).ok()?;
        let song = self
            .playlists
            .iter()
            .flat_map(|playlist| &playlist.songs)
            .find(|song| song.uri == uri)?;
        let path = fs::canonicalize(&song.path).ok()?;
        (path.is_file() && path.starts_with(root)).then_some(path)
    }

    pub fn refresh_song_tags(&mut self, uri: &str, tags: LocalTags) -> Result<(), PlaylistError> {
        let path = self
            .song_path_for_uri(uri)
            .ok_or(PlaylistError::MissingTrack)?;
        let previous = self.playlists.clone();
        let refreshed = Song::from_tags(&path, tags);
        for song in self
            .playlists
            .iter_mut()
            .flat_map(|playlist| &mut playlist.songs)
        {
            if song.uri == uri {
                let instance_id = song.instance_id;
                *song = refreshed.clone();
                song.instance_id = instance_id;
            }
        }
        if let Err(error) = self.persist() {
            self.playlists = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn create(
        &mut self,
        name: &str,
        description: &str,
        songs: &[Song],
    ) -> Result<&LocalPlaylist, PlaylistError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(PlaylistError::EmptyName);
        }
        let id = new_id();
        let mut playlist = LocalPlaylist {
            id: id.clone(),
            name: name.to_owned(),
            description: description.trim().to_owned(),
            artwork_path: None,
            songs: Vec::new(),
            origins: HashMap::new(),
        };
        for song in songs {
            if let Err(error) = append_song(&self.tracks_dir, &mut playlist, song) {
                let _ = self.collect_unheld();
                return Err(error);
            }
        }
        self.playlists.insert(0, playlist);
        if let Err(error) = self.persist() {
            self.playlists.remove(0);
            let _ = self.collect_unheld();
            return Err(error);
        }
        Ok(&self.playlists[0])
    }

    pub fn update(
        &mut self,
        id: &str,
        name: &str,
        description: &str,
        artwork: Option<&[u8]>,
    ) -> Result<(), PlaylistError> {
        if name.trim().is_empty() {
            return Err(PlaylistError::EmptyName);
        }
        let new_cover = artwork
            .map(|bytes| write_artwork(&self.artwork_dir, bytes))
            .transpose()?;
        let previous = self.find_mut(id)?.clone();
        let playlist = self.find_mut(id)?;
        playlist.name = name.trim().to_owned();
        playlist.description = description.trim().to_owned();
        if let Some(cover) = &new_cover {
            playlist.artwork_path = Some(cover.clone());
        }
        if let Err(error) = self.persist() {
            if let Some(playlist) = self.playlists.iter_mut().find(|playlist| playlist.id == id) {
                *playlist = previous.clone();
            }
            if let Some(cover) = new_cover {
                let _ = fs::remove_file(cover);
            }
            return Err(error);
        }
        if let (Some(old_cover), Some(new_cover)) = (previous.artwork_path, new_cover)
            && old_cover != new_cover
            && self.stored_artwork_path(&old_cover)
        {
            let _ = fs::remove_file(old_cover);
        }
        Ok(())
    }

    pub fn add_songs(&mut self, id: &str, songs: &[Song]) -> Result<usize, PlaylistError> {
        let tracks_dir = self.tracks_dir.clone();
        let index = self
            .playlists
            .iter()
            .position(|playlist| playlist.id == id)
            .ok_or(PlaylistError::Missing)?;
        let previous = self.playlists[index].clone();
        let playlist = &mut self.playlists[index];
        for song in songs {
            if let Err(error) = append_song(&tracks_dir, playlist, song) {
                self.playlists[index] = previous;
                let _ = self.collect_unheld();
                return Err(error);
            }
        }
        let count = songs.len();
        if let Err(error) = self.persist() {
            self.playlists[index] = previous;
            let _ = self.collect_unheld();
            return Err(error);
        }
        Ok(count)
    }

    pub fn remove_uri(&mut self, id: &str, uri: &str) -> Result<usize, PlaylistError> {
        let playlist = self.find_mut(id)?;
        let before = playlist.songs.len();
        playlist.songs.retain(|song| song.uri != uri);
        let removed = before - playlist.songs.len();
        if removed > 0 {
            self.persist()?;
            self.collect_unheld()?;
        }
        Ok(removed)
    }

    pub fn reorder(&mut self, id: &str, uris: &[String]) -> Result<(), PlaylistError> {
        let playlist = self.find_mut(id)?;
        let mut used = vec![false; playlist.songs.len()];
        let mut reordered = Vec::with_capacity(playlist.songs.len());
        for uri in uris {
            if let Some((index, song)) = playlist
                .songs
                .iter()
                .enumerate()
                .find(|(index, song)| !used[*index] && song.uri == *uri)
            {
                used[index] = true;
                reordered.push(song.clone());
            }
        }
        reordered.extend(
            playlist
                .songs
                .iter()
                .enumerate()
                .filter(|(index, _)| !used[*index])
                .map(|(_, song)| song.clone()),
        );
        playlist.songs = reordered;
        self.persist()
    }

    pub fn delete(&mut self, id: &str) -> Result<bool, PlaylistError> {
        let before = self.playlists.len();
        self.playlists.retain(|playlist| playlist.id != id);
        if before == self.playlists.len() {
            return Ok(false);
        }
        self.persist()?;
        self.collect_unheld()?;
        Ok(true)
    }

    fn find_mut(&mut self, id: &str) -> Result<&mut LocalPlaylist, PlaylistError> {
        self.playlists
            .iter_mut()
            .find(|playlist| playlist.id == id)
            .ok_or(PlaylistError::Missing)
    }

    fn stored_artwork_path(&self, path: &Path) -> bool {
        let Ok(directory) = fs::canonicalize(&self.artwork_dir) else {
            return false;
        };
        let Ok(path) = fs::canonicalize(path) else {
            return false;
        };
        path.starts_with(directory)
    }

    fn persist(&self) -> Result<(), PlaylistError> {
        let bytes = serde_json::to_vec_pretty(&Envelope {
            version: VERSION,
            playlists: self.playlists.clone(),
        })?;
        atomic_write(&self.data_path, &bytes)?;
        Ok(())
    }

    fn collect_unheld(&self) -> Result<(), PlaylistError> {
        let held: HashSet<PathBuf> =
            self.playlists
                .iter()
                .flat_map(|playlist| {
                    playlist.songs.iter().map(|song| {
                        fs::canonicalize(&song.path).unwrap_or_else(|_| song.path.clone())
                    })
                })
                .collect();
        if !self.tracks_dir.exists() {
            return self.collect_unheld_artwork();
        }
        for playlist_entry in fs::read_dir(&self.tracks_dir)? {
            let playlist_entry = playlist_entry?;
            if !playlist_entry.file_type()?.is_dir() {
                continue;
            }
            let playlist_folder = playlist_entry.path();
            for copy_entry in fs::read_dir(&playlist_folder)? {
                let copy_entry = copy_entry?;
                if !copy_entry.file_type()?.is_dir() {
                    continue;
                }
                let copy_folder = fs::canonicalize(copy_entry.path())?;
                let is_held = held.iter().any(|path| path.starts_with(&copy_folder));
                if !is_held {
                    fs::remove_dir_all(copy_entry.path())?;
                }
            }
            if fs::read_dir(&playlist_folder)?.next().is_none() {
                fs::remove_dir(playlist_folder)?;
            }
        }
        self.collect_unheld_artwork()?;
        Ok(())
    }

    fn collect_unheld_artwork(&self) -> Result<(), PlaylistError> {
        if !self.artwork_dir.exists() {
            return Ok(());
        }
        let Ok(artwork_directory) = fs::canonicalize(&self.artwork_dir) else {
            return Ok(());
        };
        let held: HashSet<PathBuf> = self
            .playlists
            .iter()
            .filter_map(|playlist| playlist.artwork_path.as_ref())
            .filter_map(|path| fs::canonicalize(path).ok())
            .filter(|path| path.starts_with(&artwork_directory))
            .collect();
        for entry in fs::read_dir(&self.artwork_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let path = fs::canonicalize(entry.path())?;
            if !held.contains(&path) {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
}

fn is_legacy_envelope(bytes: &[u8]) -> bool {
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) else {
        return false;
    };
    value.get("copies").is_some()
        || value
            .get("playlists")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|playlists| {
                playlists
                    .iter()
                    .any(|playlist| playlist.get("cover").is_some())
            })
}

fn migrate_legacy_playlists(
    legacy_playlists: Vec<LegacyPlaylist>,
    tracks_dir: &Path,
    artwork_dir: &Path,
    track_artwork_dir: &Path,
) -> Result<Vec<LocalPlaylist>, PlaylistError> {
    let mut migrated = Vec::new();
    let mut ids = HashSet::new();
    for legacy in legacy_playlists {
        if !legacy.id.starts_with("local:")
            || legacy.name.trim().is_empty()
            || !ids.insert(legacy.id.clone())
        {
            continue;
        }
        let mut playlist = LocalPlaylist {
            id: legacy.id,
            name: legacy.name.trim().to_owned(),
            description: legacy.description.trim().to_owned(),
            artwork_path: None,
            songs: Vec::new(),
            origins: HashMap::new(),
        };
        for uri in legacy.songs {
            let Some(path) = local_path_from_uri(&uri) else {
                continue;
            };
            let mut song = Song::from_tags(
                &path,
                read_local_tags_with_artwork(&path, track_artwork_dir).unwrap_or_default(),
            );
            if path.is_file() {
                append_song(tracks_dir, &mut playlist, &song)?;
            } else {
                song.uri = uri;
                song.instance_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
                playlist.songs.push(song);
            }
        }
        if let Some(cover_name) = Path::new(&legacy.cover).file_name()
            && cover_name.to_string_lossy() == legacy.cover
        {
            let old_cover = artwork_dir.join(cover_name);
            if let Ok(bytes) = fs::read(old_cover)
                && let Ok(cover) = write_artwork(artwork_dir, &bytes)
            {
                playlist.artwork_path = Some(cover);
            }
        }
        migrated.push(playlist);
    }
    Ok(migrated)
}

fn local_path_from_uri(uri: &str) -> Option<PathBuf> {
    let path = PathBuf::from(uri);
    if path.is_absolute() {
        return Some(path);
    }
    let url = url::Url::parse(uri).ok()?;
    (url.scheme() == "file")
        .then(|| url.to_file_path().ok())
        .flatten()
}

fn write_artwork(directory: &Path, bytes: &[u8]) -> Result<PathBuf, PlaylistError> {
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(PlaylistError::InvalidArtwork);
    }
    let extension = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "jpg"
    } else {
        return Err(PlaylistError::InvalidArtwork);
    };
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let path = directory.join(format!("cover-{sequence:x}.{extension}"));
    atomic_write(&path, bytes)?;
    Ok(path)
}

fn append_song(
    tracks_dir: &Path,
    playlist: &mut LocalPlaylist,
    song: &Song,
) -> Result<(), PlaylistError> {
    if !song.path.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!("{} is unavailable", song.path.display()),
        )
        .into());
    }
    let source = fs::canonicalize(&song.path)?;
    let key = source.to_string_lossy().into_owned();
    let metadata = fs::metadata(&source)?;
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    if let Some(origin) = playlist.origins.get(&key)
        && origin.size == metadata.len()
        && origin.modified_ns == modified_ns
        && origin.path.is_file()
        && let Some(mut reused) = playlist
            .songs
            .iter()
            .find(|item| item.path == origin.path)
            .cloned()
    {
        reused.instance_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        playlist.songs.push(reused);
        return Ok(());
    }
    let kept = copy_song(tracks_dir, &playlist.id, song, &source)?;
    playlist.origins.insert(
        key,
        SourceCopy {
            size: metadata.len(),
            modified_ns,
            path: kept.path.clone(),
        },
    );
    playlist.songs.push(kept);
    Ok(())
}

fn copy_song(
    tracks_dir: &Path,
    id: &str,
    song: &Song,
    source: &Path,
) -> Result<Song, PlaylistError> {
    let safe_id: String = id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '_'
            }
        })
        .take(80)
        .collect();
    let folder = tracks_dir
        .join(safe_id)
        .join(format!("{:x}", NEXT_ID.fetch_add(1, Ordering::Relaxed)));
    fs::create_dir_all(&folder)?;
    let target = folder.join(source.file_name().unwrap_or_default());
    fs::copy(source, &target)?;
    copy_companion(source, &target, "lrc")?;
    for stem in ["cover", "folder", "front", "album", "albumart", "artwork"] {
        for extension in ["jpg", "jpeg", "png", "webp"] {
            let companion = source
                .parent()
                .unwrap_or(Path::new("."))
                .join(format!("{stem}.{extension}"));
            if companion.is_file() {
                fs::copy(
                    &companion,
                    folder.join(companion.file_name().unwrap_or_default()),
                )?;
            }
        }
    }
    let mut tags = song.tags.clone();
    if let Some(art) = tags.artwork_path.as_ref().filter(|path| path.is_file()) {
        let art_target = folder.join(format!(
            "artwork.{}",
            art.extension().unwrap_or_default().to_string_lossy()
        ));
        fs::copy(art, &art_target)?;
        tags.artwork_path = Some(art_target);
    }
    let mut kept = Song::from_tags(&target, tags);
    kept.instance_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    Ok(kept)
}

fn copy_companion(source: &Path, target: &Path, extension: &str) -> Result<(), PlaylistError> {
    let source = source.with_extension(extension);
    if source.is_file() {
        fs::copy(source, target.with_extension(extension))?;
    }
    Ok(())
}

fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let sequence = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let temporary = path.with_extension(format!("{}.{}.tmp", std::process::id(), sequence));
    if let Err(error) = fs::write(&temporary, bytes) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if !path.exists() {
        return fs::rename(temporary, path);
    }
    let backup = path.with_extension(format!("{}.{}.bak", std::process::id(), sequence));
    if let Err(error) = fs::rename(path, &backup) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::rename(&backup, path);
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

fn new_id() -> String {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "local:{time:x}-{:x}",
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalTags;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "resonance-playlists-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn song(path: &Path, name: &str) -> Song {
        fs::write(path, name.as_bytes()).unwrap();
        Song::from_tags(
            path,
            LocalTags {
                title: Some(name.to_owned()),
                ..LocalTags::default()
            },
        )
    }

    #[test]
    fn playlist_copies_tracks_and_companions_persists_order_and_collects_on_delete() {
        let dir = TempDir::new();
        let one_path = dir.0.join("One.wav");
        let two_path = dir.0.join("Two.wav");
        let one = song(&one_path, "One");
        let two = song(&two_path, "Two");
        fs::write(dir.0.join("One.lrc"), "[00:01.00]one").unwrap();
        let data = dir.0.join("local-playlists.json");
        let id;
        let copied_uri;
        {
            let mut store = LocalPlaylistStore::open(&data).unwrap();
            id = store
                .create(
                    " Night ",
                    " drive ",
                    &[one.clone(), two.clone(), one.clone()],
                )
                .unwrap()
                .id
                .clone();
            let playlist = &store.playlists()[0];
            assert_eq!(playlist.name, "Night");
            assert_eq!(playlist.songs.len(), 3);
            assert_ne!(playlist.songs[0].uri, one.uri);
            assert_eq!(playlist.songs[0].path, playlist.songs[2].path);
            assert_ne!(playlist.songs[0].instance_id, playlist.songs[2].instance_id);
            assert!(playlist.songs[0].path.with_extension("lrc").exists());
            copied_uri = playlist.songs[0].uri.clone();
            let second_uri = playlist.songs[1].uri.clone();
            let occurrence_ids_differ =
                playlist.songs[0].instance_id != playlist.songs[2].instance_id;
            assert!(occurrence_ids_differ);
            store
                .reorder(&id, &[second_uri, copied_uri.clone()])
                .unwrap();
            assert_eq!(store.playlists()[0].songs[0].name, "Two");
            assert_eq!(store.remove_uri(&id, &copied_uri).unwrap(), 2);
            assert!(!one_path.with_file_name("nope").exists());
        }
        let mut reopened = LocalPlaylistStore::open(&data).unwrap();
        assert_eq!(reopened.playlists()[0].songs.len(), 1);
        let remaining = reopened.playlists()[0].songs[0].path.clone();
        assert!(remaining.exists());
        assert!(reopened.delete(&id).unwrap());
        assert!(!remaining.exists());
        assert!(reopened.playlists().is_empty());
    }

    #[test]
    fn readding_changed_source_replaces_copy_and_collects_stale_copy() {
        let dir = TempDir::new();
        let source_path = dir.0.join("Track.wav");
        let source = song(&source_path, "Version one");
        let data = dir.0.join("local-playlists.json");
        let mut store = LocalPlaylistStore::open(&data).unwrap();
        let id = store
            .create("Mix", "", std::slice::from_ref(&source))
            .unwrap()
            .id
            .clone();
        let old_copy = store.playlists()[0].songs[0].path.clone();
        assert!(old_copy.is_file());

        fs::write(&source_path, b"Version two is longer").unwrap();
        let changed = Song::from_tags(
            &source_path,
            LocalTags {
                title: Some("Version two".into()),
                ..LocalTags::default()
            },
        );
        store.add_songs(&id, &[changed]).unwrap();

        let playlist = &store.playlists()[0];
        assert_eq!(playlist.songs.len(), 2);
        assert_eq!(playlist.songs[0].path, old_copy);
        assert_ne!(playlist.songs[1].path, old_copy);
        assert_eq!(playlist.songs[1].name, "Version two");
        assert!(old_copy.is_file());

        let old_uri = playlist.songs[0].uri.clone();
        store.remove_uri(&id, &old_uri).unwrap();
        assert!(!old_copy.exists());
        assert!(store.playlists()[0].songs[0].path.is_file());

        let reopened = LocalPlaylistStore::open(&data).unwrap();
        assert_eq!(reopened.playlists()[0].songs[0].name, "Version two");
    }

    #[test]
    fn failed_playlist_create_and_add_leave_no_partial_state_or_copies() {
        let dir = TempDir::new();
        let existing = song(&dir.0.join("Existing.wav"), "Existing");
        let missing = Song::from_tags(
            &dir.0.join("missing.wav"),
            LocalTags {
                title: Some("Missing".into()),
                ..LocalTags::default()
            },
        );
        let data = dir.0.join("local-playlists.json");
        let mut store = LocalPlaylistStore::open(&data).unwrap();

        assert!(
            store
                .create("Broken", "", &[existing.clone(), missing.clone()])
                .is_err()
        );
        assert!(store.playlists().is_empty());
        let failed_create_copies = dir.0.join("local-playlist-tracks");
        assert!(
            fs::read_dir(&failed_create_copies)
                .unwrap()
                .next()
                .is_none()
        );

        let id = store
            .create("Working", "", std::slice::from_ref(&existing))
            .unwrap()
            .id
            .clone();
        let original_uri = store.playlists()[0].songs[0].uri.clone();
        assert!(store.add_songs(&id, &[existing, missing]).is_err());
        assert_eq!(store.playlists()[0].songs.len(), 1);
        assert_eq!(store.playlists()[0].songs[0].uri, original_uri);

        let track_copies = dir.0.join("local-playlist-tracks");
        let playlist_folder = track_copies.join(id.replace(':', "_"));
        let entries: Vec<_> = fs::read_dir(playlist_folder)
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(entries.len(), 1);
        let reopened = LocalPlaylistStore::open(&data).unwrap();
        assert_eq!(reopened.playlists()[0].songs.len(), 1);
    }

    #[test]
    fn playlist_owned_copy_remains_playable_after_source_is_deleted() {
        let dir = TempDir::new();
        let source_path = dir.0.join("Original.wav");
        let source = song(&source_path, "Survivor");
        let data = dir.0.join("local-playlists.json");
        let mut store = LocalPlaylistStore::open(&data).unwrap();
        store
            .create("Saved mix", "", std::slice::from_ref(&source))
            .unwrap();
        let copied = store.playlists()[0].songs[0].path.clone();
        assert_ne!(copied, source_path);

        fs::remove_file(source_path).unwrap();
        let reopened = LocalPlaylistStore::open(&data).unwrap();
        let saved_song = &reopened.playlists()[0].songs[0];
        assert_eq!(saved_song.name, "Survivor");
        assert_eq!(saved_song.path, copied);
        assert!(saved_song.path.is_file());
        assert!(reopened.song_path_for_uri(&saved_song.uri).is_some());
    }

    #[test]
    fn playlist_update_persists_metadata_and_replaces_its_owned_cover() {
        let dir = TempDir::new();
        let data = dir.0.join("local-playlists.json");
        let mut store = LocalPlaylistStore::open(&data).unwrap();
        let id = store
            .create("Old", "old description", &[])
            .unwrap()
            .id
            .clone();

        store
            .update(
                &id,
                "New",
                "new description",
                Some(b"\x89PNG\r\n\x1a\nfirst"),
            )
            .unwrap();
        let first_cover = store.playlists()[0].artwork_path.clone().unwrap();
        assert!(first_cover.starts_with(dir.0.join("local-playlist-covers")));
        assert_eq!(fs::read(&first_cover).unwrap(), b"\x89PNG\r\n\x1a\nfirst");

        store
            .update(&id, "New", "updated description", None)
            .unwrap();
        assert_eq!(
            store.playlists()[0].artwork_path.as_ref(),
            Some(&first_cover)
        );

        store
            .update(
                &id,
                "Renamed",
                "latest description",
                Some(b"\xff\xd8\xffsecond"),
            )
            .unwrap();
        let second_cover = store.playlists()[0].artwork_path.clone().unwrap();
        assert_ne!(first_cover, second_cover);
        assert!(!first_cover.exists());
        assert_eq!(fs::read(&second_cover).unwrap(), b"\xff\xd8\xffsecond");

        let mut reopened = LocalPlaylistStore::open(&data).unwrap();
        let playlist = &reopened.playlists()[0];
        assert_eq!(playlist.name, "Renamed");
        assert_eq!(playlist.description, "latest description");
        assert_eq!(playlist.artwork_path.as_ref(), Some(&second_cover));
        assert!(reopened.delete(&id).unwrap());
        assert!(!second_cover.exists());
    }

    #[test]
    fn playlist_update_rejects_invalid_cover_without_changing_metadata() {
        let dir = TempDir::new();
        let data = dir.0.join("local-playlists.json");
        let mut store = LocalPlaylistStore::open(&data).unwrap();
        let id = store.create("Old", "description", &[]).unwrap().id.clone();

        assert!(
            store
                .update(&id, "New", "changed", Some(b"not an image"))
                .is_err()
        );
        assert_eq!(store.playlists()[0].name, "Old");
        assert_eq!(store.playlists()[0].description, "description");
        assert_eq!(store.playlists()[0].artwork_path, None);
    }

    #[test]
    fn opening_legacy_playlist_store_migrates_tracks_and_cover_in_order() {
        let dir = TempDir::new();
        let data = dir.0.join("local-playlists.json");
        let old_tracks = dir.0.join("legacy-source");
        fs::create_dir_all(&old_tracks).unwrap();
        let track = old_tracks.join("One.wav");
        fs::write(&track, b"legacy audio bytes").unwrap();
        fs::write(old_tracks.join("One.lrc"), "[00:01.00]legacy lyric").unwrap();
        let uri = url::Url::from_file_path(&track).unwrap().to_string();
        let missing = dir.0.join("missing.wav");
        let missing_uri = url::Url::from_file_path(missing).unwrap().to_string();
        let legacy_cover_dir = dir.0.join("local-playlist-covers");
        fs::create_dir_all(&legacy_cover_dir).unwrap();
        fs::write(
            legacy_cover_dir.join("old-cover.jpg"),
            b"\xff\xd8\xfflegacy cover",
        )
        .unwrap();
        let old_json = serde_json::json!({
            "version": 1,
            "playlists": [{
                "id": "local:legacy-one",
                "name": "Old mix",
                "description": "kept from the old app",
                "cover": "old-cover.jpg",
                "songs": [uri, uri, missing_uri]
            }],
            "copies": []
        });
        fs::write(&data, serde_json::to_vec(&old_json).unwrap()).unwrap();

        let store = LocalPlaylistStore::open(&data).unwrap();
        let playlist = &store.playlists()[0];
        assert_eq!(playlist.id, "local:legacy-one");
        assert_eq!(playlist.name, "Old mix");
        assert_eq!(playlist.description, "kept from the old app");
        assert_eq!(playlist.songs.len(), 3);
        assert_eq!(playlist.songs[0].path, playlist.songs[1].path);
        assert_ne!(playlist.songs[0].instance_id, playlist.songs[1].instance_id);
        assert!(playlist.songs[0].path.is_file());
        assert!(playlist.songs[0].path.with_extension("lrc").is_file());
        assert_eq!(playlist.songs[2].uri, missing_uri);
        let cover = playlist.artwork_path.as_ref().unwrap();
        assert_eq!(fs::read(cover).unwrap(), b"\xff\xd8\xfflegacy cover");

        let reopened = LocalPlaylistStore::open(&data).unwrap();
        assert_eq!(reopened.playlists(), store.playlists());
        let migrated_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&data).unwrap()).unwrap();
        assert!(migrated_json["playlists"][0]["songs"][0].is_object());
    }

    #[test]
    fn refreshing_playlist_copy_tags_updates_every_occurrence_and_survives_reopen() {
        let dir = TempDir::new();
        let source = song(&dir.0.join("Track.wav"), "Before");
        let data = dir.0.join("local-playlists.json");
        let mut store = LocalPlaylistStore::open(&data).unwrap();
        store.create("Mix", "", &[source.clone(), source]).unwrap();
        let uri = store.playlists()[0].songs[0].uri.clone();
        let identities: Vec<_> = store.playlists()[0]
            .songs
            .iter()
            .map(|song| song.instance_id)
            .collect();

        store
            .refresh_song_tags(
                &uri,
                LocalTags {
                    title: Some("After".into()),
                    ..LocalTags::default()
                },
            )
            .unwrap();

        let playlist = &store.playlists()[0];
        assert_eq!(
            playlist
                .songs
                .iter()
                .map(|song| song.name.as_str())
                .collect::<Vec<_>>(),
            ["After", "After"]
        );
        assert_eq!(
            playlist
                .songs
                .iter()
                .map(|song| song.instance_id)
                .collect::<Vec<_>>(),
            identities
        );
        assert!(store.song_path_for_uri(&uri).is_some());
        let reopened = LocalPlaylistStore::open(&data).unwrap();
        assert_eq!(reopened.playlists()[0].songs[0].name, "After");
    }
}
