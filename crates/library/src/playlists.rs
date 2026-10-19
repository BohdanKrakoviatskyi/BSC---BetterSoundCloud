use crate::Song;
use serde::{Deserialize, Serialize};
use std::{
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPlaylist {
    pub id: String,
    pub name: String,
    pub description: String,
    pub artwork_path: Option<PathBuf>,
    pub songs: Vec<Song>,
}

#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    playlists: Vec<LocalPlaylist>,
}

pub struct LocalPlaylistStore {
    data_path: PathBuf,
    tracks_dir: PathBuf,
    playlists: Vec<LocalPlaylist>,
}

impl LocalPlaylistStore {
    pub fn open(data_path: impl Into<PathBuf>) -> Result<Self, PlaylistError> {
        let data_path = data_path.into();
        let tracks_dir = data_path.with_file_name("local-playlist-tracks");
        let playlists = match fs::read(&data_path) {
            Ok(bytes) => serde_json::from_slice::<Envelope>(&bytes)
                .ok()
                .filter(|envelope| envelope.version == VERSION)
                .map(|envelope| envelope.playlists)
                .unwrap_or_default(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self {
            data_path,
            tracks_dir,
            playlists,
        })
    }

    pub fn playlists(&self) -> &[LocalPlaylist] {
        &self.playlists
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
        };
        for song in songs {
            playlist.songs.push(self.copy_song(&id, song)?);
        }
        self.playlists.insert(0, playlist);
        self.persist()?;
        Ok(&self.playlists[0])
    }

    pub fn update(&mut self, id: &str, name: &str, description: &str) -> Result<(), PlaylistError> {
        if name.trim().is_empty() {
            return Err(PlaylistError::EmptyName);
        }
        let playlist = self.find_mut(id)?;
        playlist.name = name.trim().to_owned();
        playlist.description = description.trim().to_owned();
        self.persist()
    }

    pub fn add_songs(&mut self, id: &str, songs: &[Song]) -> Result<usize, PlaylistError> {
        let mut copied = Vec::new();
        for song in songs {
            copied.push(self.copy_song(id, song)?);
        }
        let count = copied.len();
        self.find_mut(id)?.songs.extend(copied);
        self.persist()?;
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

    fn copy_song(&self, id: &str, song: &Song) -> Result<Song, PlaylistError> {
        if !song.path.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{} is unavailable", song.path.display()),
            )
            .into());
        }
        let source = fs::canonicalize(&song.path)?;
        let safe_id = id.replace(':', "_");
        let folder = self.tracks_dir.join(safe_id);
        fs::create_dir_all(&folder)?;
        let mut target = folder.join(source.file_name().unwrap_or_default());
        if target.exists() {
            let stem = source.file_stem().unwrap_or_default().to_string_lossy();
            let ext = source
                .extension()
                .map(|value| format!(".{}", value.to_string_lossy()))
                .unwrap_or_default();
            let index = fs::read_dir(&folder)?.count();
            target = folder.join(format!("{stem}-{index}{ext}"));
        }
        fs::copy(&source, &target)?;
        copy_companion(&source, &target, "lrc")?;
        copy_companion(&source, &target, "jpg")?;
        copy_companion(&source, &target, "jpeg")?;
        copy_companion(&source, &target, "png")?;
        let mut tags = song.tags.clone();
        if let Some(art) = tags.artwork_path.as_ref().filter(|path| path.is_file()) {
            let art_target = target
                .with_extension("cover")
                .with_extension(art.extension().unwrap_or_default());
            fs::copy(art, &art_target)?;
            tags.artwork_path = Some(art_target.clone());
        }
        let mut kept = Song::from_tags(&target, tags);
        kept.instance_id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        Ok(kept)
    }

    fn find_mut(&mut self, id: &str) -> Result<&mut LocalPlaylist, PlaylistError> {
        self.playlists
            .iter_mut()
            .find(|playlist| playlist.id == id)
            .ok_or(PlaylistError::Missing)
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
            return Ok(());
        }
        for entry in fs::read_dir(&self.tracks_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_dir() {
                let folder = fs::canonicalize(entry.path())?;
                let is_held = held.iter().any(|path| path.starts_with(&folder));
                if !is_held {
                    fs::remove_dir_all(entry.path())?;
                }
            }
        }
        Ok(())
    }
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
    fs::write(&temporary, bytes)?;
    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(temporary, path)
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
            assert_ne!(playlist.songs[0].path, playlist.songs[2].path);
            assert_ne!(playlist.songs[0].instance_id, playlist.songs[2].instance_id);
            assert!(playlist.songs[0].path.with_extension("lrc").exists());
            copied_uri = playlist.songs[0].uri.clone();
            store
                .reorder(&id, &[playlist.songs[1].uri.clone(), copied_uri.clone()])
                .unwrap();
            assert_eq!(store.playlists()[0].songs[0].name, "Two");
            assert_eq!(store.remove_uri(&id, &copied_uri).unwrap(), 1);
            assert!(!one_path.with_file_name("nope").exists());
        }
        let mut reopened = LocalPlaylistStore::open(&data).unwrap();
        assert_eq!(reopened.playlists()[0].songs.len(), 2);
        let remaining = reopened.playlists()[0].songs[0].path.clone();
        assert!(remaining.exists());
        assert!(reopened.delete(&id).unwrap());
        assert!(!remaining.exists());
        assert!(reopened.playlists().is_empty());
    }
}
