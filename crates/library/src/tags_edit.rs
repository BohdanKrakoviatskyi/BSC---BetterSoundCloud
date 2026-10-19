use lofty::{
    config::WriteOptions,
    file::{AudioFile, FileType, TaggedFileExt},
    picture::{MimeType, Picture, PictureType},
    probe::Probe,
    tag::{Accessor, ItemKey, Tag, TagType},
};
use serde::Deserialize;
use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TagEdits {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub date: Option<String>,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub remove_artwork: bool,
}

/// Apply only supplied fields; an empty supplied value clears that field.
/// The original remains intact if the encoded replacement cannot be written.
pub fn write_local_tags(
    path: &Path,
    edits: &TagEdits,
    artwork: Option<&[u8]>,
) -> Result<(), String> {
    let mut file = Probe::open(path)
        .and_then(|probe| probe.read())
        .map_err(|error| format!("could not read the tags of {}: {error}", path.display()))?;
    let file_type = file.file_type();
    let mut kinds: Vec<TagType> = file.tags().iter().map(Tag::tag_type).collect();
    kinds.push(file.primary_tag_type());
    if file_type == FileType::Wav {
        kinds.push(TagType::RiffInfo);
    }
    kinds.retain(|kind| file_type.tag_support(*kind).is_writable());
    kinds.dedup();
    if kinds.is_empty() {
        return Err(format!("{} cannot hold tags", path.display()));
    }
    for kind in kinds {
        let mut tag = file.remove(kind).unwrap_or_else(|| Tag::new(kind));
        apply_edits(&mut tag, edits, artwork);
        file.insert_tag(tag);
    }

    let id = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
    let temp = temporary_path(path, id);
    let result = (|| {
        fs::copy(path, &temp)
            .map_err(|error| format!("could not copy {}: {error}", path.display()))?;
        file.save_to_path(&temp, WriteOptions::default())
            .map_err(|error| format!("could not write the tags of {}: {error}", path.display()))?;
        replace_file(&temp, path)
            .map_err(|error| format!("could not replace {}: {error}", path.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn apply_edits(tag: &mut Tag, edits: &TagEdits, artwork: Option<&[u8]>) {
    fn text(value: &Option<String>) -> Option<Option<String>> {
        value.as_ref().map(|value| {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_owned())
        })
    }
    macro_rules! standard_text {
        ($field:ident, $set:ident, $remove:ident) => {
            if let Some(value) = text(&edits.$field) {
                match value {
                    Some(value) => tag.$set(value),
                    None => tag.$remove(),
                }
            }
        };
    }
    standard_text!(title, set_title, remove_title);
    standard_text!(artist, set_artist, remove_artist);
    standard_text!(album, set_album, remove_album);
    standard_text!(genre, set_genre, remove_genre);
    for (key, value) in [
        (ItemKey::AlbumArtist, &edits.album_artist),
        (ItemKey::RecordingDate, &edits.date),
    ] {
        if let Some(value) = text(value) {
            tag.remove_key(key);
            if let Some(value) = value {
                tag.insert_text(key, value);
            }
        }
    }
    for (value, is_track) in [(&edits.track_number, true), (&edits.disc_number, false)] {
        if let Some(value) = text(value) {
            let number = value.as_deref().and_then(leading_number);
            if is_track {
                if let Some(number) = number {
                    tag.set_track(number);
                } else {
                    tag.remove_track();
                }
            } else if let Some(number) = number {
                tag.set_disk(number);
            } else {
                tag.remove_disk();
            }
        }
    }
    if edits.remove_artwork {
        while tag.picture_count() > 0 {
            tag.remove_picture(0);
        }
    }
    if let Some(bytes) = artwork.filter(|bytes| !bytes.is_empty()) {
        tag.remove_picture_type(PictureType::CoverFront);
        let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            MimeType::Png
        } else {
            MimeType::Jpeg
        };
        tag.push_picture(
            Picture::unchecked(bytes.to_vec())
                .pic_type(PictureType::CoverFront)
                .mime_type(mime)
                .build(),
        );
    }
}

fn leading_number(value: &str) -> Option<u32> {
    let digits: String = value
        .trim()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok().filter(|number| *number > 0)
}

fn temporary_path(path: &Path, id: u64) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!(
        ".{name}.{}.{}.tags-partial",
        std::process::id(),
        id
    ))
}

fn replace_file(temp: &Path, path: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        let backup = temp.with_extension("tags-backup");
        fs::rename(path, &backup)?;
        match fs::rename(temp, path) {
            Ok(()) => fs::remove_file(backup),
            Err(error) => {
                let _ = fs::rename(backup, path);
                Err(error)
            }
        }
    }
    #[cfg(not(windows))]
    {
        fs::rename(temp, path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{read_local_tags, read_local_tags_with_artwork};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "resonance-tag-edit-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn tagged_wav(path: &Path) {
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 44_100,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec).unwrap();
        for _ in 0..4410 {
            writer.write_sample(0i16).unwrap();
        }
        writer.finalize().unwrap();
    }

    #[test]
    fn writes_supplied_fields_clears_empty_fields_and_replaces_or_removes_cover() {
        let dir = temp_dir();
        let path = dir.join("track.wav");
        tagged_wav(&path);
        let edits = TagEdits {
            title: Some(" New title ".into()),
            artist: Some("Artist".into()),
            album: Some("Album".into()),
            track_number: Some("03/12".into()),
            ..TagEdits::default()
        };
        write_local_tags(&path, &edits, Some(&[0xff, 0xd8, 0xff, 0xe0, 1, 2])).unwrap();
        let tags = read_local_tags(&path).unwrap();
        assert_eq!(tags.title.as_deref(), Some("New title"));
        assert_eq!(tags.artist.as_deref(), Some("Artist"));
        assert_eq!(tags.album.as_deref(), Some("Album"));
        assert_eq!(tags.track_number, Some(3));
        let tagged = Probe::open(&path).unwrap().read().unwrap();
        assert!(tagged.tags().iter().any(|tag| tag.picture_count() > 0));
        let extracted = read_local_tags_with_artwork(&path, &dir.join("artwork")).unwrap();
        let cover_path = extracted
            .artwork_path
            .expect("embedded artwork is extracted");
        assert_eq!(
            fs::read(cover_path).unwrap(),
            [0xff, 0xd8, 0xff, 0xe0, 1, 2]
        );
        write_local_tags(
            &path,
            &TagEdits {
                title: Some(String::new()),
                remove_artwork: true,
                ..TagEdits::default()
            },
            None,
        )
        .unwrap();
        let tags = read_local_tags(&path).unwrap();
        assert_eq!(tags.title, None);
        assert_eq!(tags.artist.as_deref(), Some("Artist"));
        assert!(tags.artwork_path.is_none());
        let tagged = Probe::open(&path).unwrap().read().unwrap();
        assert!(tagged.tags().iter().all(|tag| tag.picture_count() == 0));
        fs::write(dir.join("Cover.jpg"), b"folder cover").unwrap();
        let folder_tags = read_local_tags_with_artwork(&path, &dir.join("artwork")).unwrap();
        assert_eq!(
            fs::read(folder_tags.artwork_path.unwrap()).unwrap(),
            b"folder cover"
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
