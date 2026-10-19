use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub date: Option<String>,
    pub genre: Option<String>,
    pub duration_ms: u64,
    pub artwork_path: Option<PathBuf>,
}

impl LocalTags {
    pub fn is_empty(&self) -> bool {
        self.title.as_deref().is_none_or(str::is_empty)
            && self.artist.as_deref().is_none_or(str::is_empty)
            && self.album.as_deref().is_none_or(str::is_empty)
            && self.album_artist.as_deref().is_none_or(str::is_empty)
            && self.track_number.is_none()
            && self.disc_number.is_none()
            && self.date.as_deref().is_none_or(str::is_empty)
            && self.genre.as_deref().is_none_or(str::is_empty)
            && self.duration_ms == 0
            && self.artwork_path.is_none()
    }
}

impl From<lofty::tag::Tag> for LocalTags {
    fn from(tag: lofty::tag::Tag) -> Self {
        use lofty::tag::Accessor;
        let text = |value: Option<std::borrow::Cow<'_, str>>| {
            value
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        };
        Self {
            title: text(tag.title()),
            artist: text(tag.artist()),
            album: text(tag.album()),
            album_artist: tag
                .get_string(lofty::tag::ItemKey::AlbumArtist)
                .and_then(|value| {
                    let value = value.trim();
                    (!value.is_empty()).then(|| value.to_owned())
                }),
            track_number: tag.track(),
            disc_number: tag.disk(),
            date: tag
                .get_string(lofty::tag::ItemKey::RecordingDate)
                .and_then(|value| {
                    let value = value.trim();
                    (!value.is_empty()).then(|| value.to_owned())
                }),
            genre: text(tag.genre()),
            duration_ms: 0,
            artwork_path: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Song {
    pub instance_id: u64,
    pub uri: String,
    pub path: PathBuf,
    pub name: String,
    pub artists: String,
    pub album_name: String,
    pub duration_ms: u64,
    pub artwork_path: Option<PathBuf>,
    pub tags: LocalTags,
}

impl Song {
    pub fn from_tags(path: &Path, tags: LocalTags) -> Self {
        let path = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let name = non_empty(tags.title.as_deref())
            .map(str::to_owned)
            .or_else(|| {
                path.file_stem()
                    .map(|value| value.to_string_lossy().into_owned())
            })
            .unwrap_or_default();
        let artists = non_empty(tags.artist.as_deref())
            .or_else(|| non_empty(tags.album_artist.as_deref()))
            .unwrap_or("Unknown Artist")
            .to_owned();
        let album_name = non_empty(tags.album.as_deref())
            .map(str::to_owned)
            .or_else(|| {
                path.parent()
                    .and_then(Path::file_name)
                    .map(|value| value.to_string_lossy().into_owned())
            })
            .unwrap_or_default();
        let uri = url::Url::from_file_path(&path)
            .map(|url| url.to_string())
            .unwrap_or_else(|_| path.to_string_lossy().into_owned());
        Self {
            instance_id: 0,
            uri,
            path,
            name,
            artists,
            album_name,
            duration_ms: tags.duration_ms,
            artwork_path: tags.artwork_path.clone(),
            tags,
        }
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}
