use crate::{
    MusicProvider, ProviderArtist, ProviderError, ProviderPage, ProviderPlaylist, ProviderStream,
    ProviderTrack,
};
use async_trait::async_trait;
use reqwest::{Client, RequestBuilder, StatusCode, Url};
use serde_json::Value;
use std::time::Duration;

const API_ROOT: &str = "https://api-v2.soundcloud.com/";

#[derive(Clone)]
pub struct SoundCloudProvider {
    client: Client,
    client_id: String,
    access_token: String,
    api_root: Url,
}

impl SoundCloudProvider {
    pub fn new(
        client_id: impl Into<String>,
        access_token: impl Into<String>,
    ) -> Result<Self, ProviderError> {
        Self::with_api_root(client_id, access_token, API_ROOT)
    }

    pub fn with_api_root(
        client_id: impl Into<String>,
        access_token: impl Into<String>,
        api_root: &str,
    ) -> Result<Self, ProviderError> {
        let client_id = client_id.into().trim().to_owned();
        let access_token = access_token.into().trim().to_owned();
        if client_id.is_empty() || access_token.is_empty() {
            return Err(ProviderError::InvalidData(
                "SoundCloud client id and access token are required".into(),
            ));
        }
        let api_root = Url::parse(api_root)
            .map_err(|error| ProviderError::InvalidData(format!("invalid API URL: {error}")))?;
        let client = Client::builder()
            .user_agent("Resonance/0.2.6")
            .timeout(Duration::from_secs(45))
            .build()?;
        Ok(Self {
            client,
            client_id,
            access_token,
            api_root,
        })
    }

    pub fn track_from_json(value: Value) -> Result<ProviderTrack, ProviderError> {
        let id = text(value.get("id"))
            .filter(|id| !id.is_empty())
            .ok_or_else(|| ProviderError::InvalidData("SoundCloud track id is missing".into()))?;
        let urn = first_text(&value, &["trackUrn", "urn"])
            .filter(|urn| !urn.is_empty())
            .unwrap_or_else(|| format!("soundcloud:tracks:{id}"));
        let user = value.get("user").unwrap_or(&Value::Null);
        let artist_name = first_text(user, &["username", "fullName"]).unwrap_or_default();
        let artist_id = text(user.get("id")).filter(|id| !id.is_empty());
        let artwork = first_text(&value, &["artworkUrl", "artwork_url"])
            .or_else(|| first_text(user, &["avatarUrl", "avatar_url"]));
        Ok(ProviderTrack {
            provider: "soundcloud".into(),
            id,
            uri: urn,
            title: first_text(&value, &["title"])
                .unwrap_or_default()
                .trim()
                .to_owned(),
            permalink: first_text(&value, &["permalinkUrl", "permalink_url"]),
            artwork_url: artwork.map(upsize_artwork),
            duration_ms: number(&value, &["duration"]),
            artist_id,
            artist_name,
            playback_count: number(&value, &["playbackCount", "playback_count"]),
            likes_count: number(&value, &["likesCount", "likes_count"]),
        })
    }

    fn request(&self, url: Url) -> RequestBuilder {
        let mut url = url;
        if !url.query_pairs().any(|(key, _)| key == "client_id") {
            url.query_pairs_mut()
                .append_pair("client_id", &self.client_id);
        }
        self.client
            .get(url)
            .header("Authorization", format!("OAuth {}", self.access_token))
    }

    fn endpoint(&self, path: &str) -> Result<Url, ProviderError> {
        self.api_root.join(path).map_err(|error| {
            ProviderError::InvalidData(format!("invalid SoundCloud endpoint: {error}"))
        })
    }

    async fn get(&self, url: Url) -> Result<Value, ProviderError> {
        let response = self.request(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            return Err(http_error(
                status,
                response.text().await.unwrap_or_default(),
            ));
        }
        Ok(response.json().await?)
    }

    async fn page<T>(
        &self,
        path: &str,
        next: Option<&str>,
        map: impl Fn(Value) -> Result<T, ProviderError>,
    ) -> Result<ProviderPage<T>, ProviderError> {
        let url = match next {
            Some(next) => self.pagination_url(next)?,
            None => self.endpoint(path)?,
        };
        let payload = self.get(url).await?;
        let collection = payload.get("collection").unwrap_or(&payload);
        let values = collection.as_array().ok_or_else(|| {
            ProviderError::InvalidData("SoundCloud collection was not an array".into())
        })?;
        let items = values
            .iter()
            .cloned()
            .map(map)
            .collect::<Result<Vec<_>, _>>()?;
        let next = text(payload.get("next_href")).or_else(|| text(payload.get("nextHref")));
        Ok(ProviderPage { items, next })
    }

    fn pagination_url(&self, next: &str) -> Result<Url, ProviderError> {
        let url = Url::parse(next).map_err(|error| {
            ProviderError::InvalidData(format!("invalid SoundCloud pagination URL: {error}"))
        })?;
        if url.scheme() != self.api_root.scheme()
            || url.host_str() != self.api_root.host_str()
            || url.port_or_known_default() != self.api_root.port_or_known_default()
            || url.username() != ""
            || url.password().is_some()
        {
            return Err(ProviderError::InvalidData(
                "SoundCloud pagination URL changed origin".into(),
            ));
        }
        Ok(url)
    }
}

#[async_trait]
impl MusicProvider for SoundCloudProvider {
    fn id(&self) -> &'static str {
        "soundcloud"
    }

    async fn search_tracks(&self, query: &str) -> Result<Vec<ProviderTrack>, ProviderError> {
        let mut url = self.endpoint("search/tracks")?;
        url.query_pairs_mut()
            .append_pair("q", query.trim())
            .append_pair("limit", "20");
        Ok(self.page_url(url, ProviderTrack::from_json).await?.items)
    }

    async fn artist(&self, id: &str) -> Result<ProviderArtist, ProviderError> {
        let url = self.endpoint(&format!("users/{}", encode_segment(id)))?;
        let value = self.get(url).await?;
        let id = text(value.get("id"))
            .ok_or_else(|| ProviderError::InvalidData("SoundCloud artist id is missing".into()))?;
        let avatar = first_text(&value, &["avatarUrl", "avatar_url"]);
        Ok(ProviderArtist {
            provider: "soundcloud".into(),
            uri: format!("soundcloud:users:{id}"),
            id,
            name: first_text(&value, &["fullName", "full_name", "username"]).unwrap_or_default(),
            permalink: first_text(&value, &["permalinkUrl", "permalink_url"]),
            artwork_url: avatar.map(upsize_artwork),
            description: text(value.get("description")),
            followers: number(&value, &["followersCount", "followers_count"]),
            track_count: number(&value, &["trackCount", "track_count"]),
            likes_count: number(&value, &["likesCount", "likes_count"]),
        })
    }

    async fn artist_tracks(
        &self,
        id: &str,
        next: Option<&str>,
    ) -> Result<ProviderPage<ProviderTrack>, ProviderError> {
        let path = format!("users/{}/tracks?limit=20", encode_segment(id));
        self.page(&path, next, ProviderTrack::from_json).await
    }

    async fn artist_likes(
        &self,
        id: &str,
        next: Option<&str>,
    ) -> Result<ProviderPage<ProviderTrack>, ProviderError> {
        let path = format!("users/{}/likes?limit=20", encode_segment(id));
        self.page(&path, next, ProviderTrack::from_json).await
    }

    async fn playlists(
        &self,
        user_id: Option<&str>,
    ) -> Result<Vec<ProviderPlaylist>, ProviderError> {
        let path = match user_id {
            Some(id) => format!(
                "users/{}/playlists_without_albums?limit=20",
                encode_segment(id)
            ),
            None => "playlists".to_owned(),
        };
        let payload = self.get(self.endpoint(&path)?).await?;
        let array = payload
            .as_array()
            .or_else(|| payload.get("collection").and_then(Value::as_array))
            .ok_or_else(|| {
                ProviderError::InvalidData("SoundCloud playlists were not an array".into())
            })?;
        array.iter().cloned().map(playlist_from_json).collect()
    }

    async fn playlist_tracks(
        &self,
        playlist_urn: &str,
    ) -> Result<Vec<ProviderTrack>, ProviderError> {
        let id = playlist_urn
            .rsplit(':')
            .next()
            .filter(|part| !part.is_empty())
            .unwrap_or(playlist_urn);
        let payload = self
            .get(self.endpoint(&format!("playlists/{}", encode_segment(id)))?)
            .await?;
        let tracks = payload
            .get("tracks")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                ProviderError::InvalidData("SoundCloud playlist tracks were missing".into())
            })?;
        tracks
            .iter()
            .cloned()
            .map(ProviderTrack::from_json)
            .collect()
    }

    async fn track(&self, id: &str) -> Result<ProviderTrack, ProviderError> {
        ProviderTrack::from_json(
            self.get(self.endpoint(&format!("tracks/{}", encode_segment(id)))?)
                .await?,
        )
    }

    async fn related_tracks(&self, id: &str) -> Result<Vec<ProviderTrack>, ProviderError> {
        let mut url = self.endpoint(&format!("tracks/{}/related", encode_segment(id)))?;
        url.query_pairs_mut().append_pair("limit", "15");
        Ok(self.page_url(url, ProviderTrack::from_json).await?.items)
    }

    async fn resolve_stream(&self, id: &str) -> Result<ProviderStream, ProviderError> {
        let payload = self
            .get(self.endpoint(&format!("tracks/{}/streams", encode_segment(id)))?)
            .await?;
        stream_from_json(payload)
    }
}

impl ProviderTrack {
    fn from_json(value: Value) -> Result<Self, ProviderError> {
        SoundCloudProvider::track_from_json(value)
    }
}

impl SoundCloudProvider {
    async fn page_url<T>(
        &self,
        url: Url,
        map: impl Fn(Value) -> Result<T, ProviderError>,
    ) -> Result<ProviderPage<T>, ProviderError> {
        let payload = self.get(url).await?;
        let values = payload
            .as_array()
            .or_else(|| payload.get("collection").and_then(Value::as_array))
            .ok_or_else(|| {
                ProviderError::InvalidData("SoundCloud collection was not an array".into())
            })?;
        let items = values
            .iter()
            .cloned()
            .map(map)
            .collect::<Result<Vec<_>, _>>()?;
        let next = text(payload.get("next_href")).or_else(|| text(payload.get("nextHref")));
        Ok(ProviderPage { items, next })
    }
}

fn playlist_from_json(value: Value) -> Result<ProviderPlaylist, ProviderError> {
    let id = text(value.get("id"))
        .filter(|id| !id.is_empty())
        .ok_or_else(|| ProviderError::InvalidData("SoundCloud playlist id is missing".into()))?;
    let uri = first_text(&value, &["urn"])
        .filter(|uri| !uri.is_empty())
        .unwrap_or_else(|| format!("soundcloud:playlists:{id}"));
    Ok(ProviderPlaylist {
        provider: "soundcloud".into(),
        id,
        uri,
        title: first_text(&value, &["title"]).unwrap_or_default(),
        permalink: first_text(&value, &["permalinkUrl", "permalink_url"]),
        artwork_url: first_text(&value, &["artworkUrl", "artwork_url"]).map(upsize_artwork),
        track_count: number(&value, &["trackCount", "track_count"]),
        owner_name: value
            .get("user")
            .and_then(|user| first_text(user, &["username"]))
            .unwrap_or_default(),
    })
}

fn stream_from_json(value: Value) -> Result<ProviderStream, ProviderError> {
    let mut choices = Vec::new();
    for key in ["http_mp3_128_url", "http_aac_160_url"] {
        if let Some(url) = text(value.get(key)) {
            choices.push(ProviderStream {
                url,
                hls: false,
                preview: false,
                quality: Some("progressive".into()),
            });
        }
    }
    for key in ["hls_mp3_128_url", "hls_aac_160_url"] {
        if let Some(url) = text(value.get(key)) {
            choices.push(ProviderStream {
                url,
                hls: true,
                preview: false,
                quality: Some("hls".into()),
            });
        }
    }
    for key in ["preview_mp3_128_url", "preview_url"] {
        if let Some(url) = text(value.get(key)) {
            choices.push(ProviderStream {
                url,
                hls: false,
                preview: true,
                quality: Some("preview".into()),
            });
        }
    }
    if let Some(url) = text(value.get("url")) {
        choices.push(ProviderStream {
            url,
            hls: value.get("hls").and_then(Value::as_bool).unwrap_or(false),
            preview: value
                .get("preview")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            quality: text(value.get("quality")),
        });
    }
    if let Some(alternatives) = value.get("alternatives").and_then(Value::as_array) {
        for alternative in alternatives {
            if let Some(url) = text(alternative.get("url")) {
                choices.push(ProviderStream {
                    url,
                    hls: alternative
                        .get("hls")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    preview: alternative
                        .get("preview")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    quality: text(alternative.get("quality")),
                });
            }
        }
    }
    choices
        .iter()
        .find(|choice| !choice.url.is_empty() && !choice.hls && !choice.preview)
        .or_else(|| {
            choices
                .iter()
                .find(|choice| !choice.url.is_empty() && choice.hls)
        })
        .or_else(|| choices.iter().find(|choice| !choice.url.is_empty()))
        .cloned()
        .ok_or_else(|| ProviderError::InvalidData("SoundCloud returned no playable stream".into()))
}

fn http_error(status: StatusCode, body: String) -> ProviderError {
    let message = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|json| first_text(&json, &["message", "error_description", "error"]))
        .unwrap_or_else(|| body.chars().take(500).collect());
    ProviderError::Http {
        status: status.as_u16(),
        message,
    }
}

fn text(value: Option<&Value>) -> Option<String> {
    match value? {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn first_text(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| text(value.get(*key)))
}

fn number(value: &Value, keys: &[&str]) -> u64 {
    keys.iter()
        .find_map(|key| {
            value
                .get(*key)
                .and_then(|v| v.as_u64().or_else(|| v.as_f64().map(|n| n.max(0.0) as u64)))
        })
        .unwrap_or(0)
}

fn upsize_artwork(url: String) -> String {
    url.replace("-large.", "-t500x500.")
}

fn encode_segment(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_provider_card_shapes_from_the_legacy_client() {
        let track = SoundCloudProvider::track_from_json(serde_json::json!({
            "id": 123,
            "urn": "soundcloud:tracks:123",
            "title": "  Night Drive  ",
            "duration": 215000,
            "artworkUrl": "https://i1.sndcdn.com/artworks-abc-large.jpg",
            "user": {"id": 8, "username": "Artist"}
        }))
        .unwrap();
        assert_eq!(track.uri, "soundcloud:tracks:123");
        assert_eq!(track.title, "Night Drive");
        assert_eq!(track.artist_name, "Artist");
        assert_eq!(
            track.artwork_url.as_deref(),
            Some("https://i1.sndcdn.com/artworks-abc-t500x500.jpg")
        );
    }

    #[test]
    fn rejects_cards_without_a_stable_id() {
        assert!(
            SoundCloudProvider::track_from_json(serde_json::json!({"title":"x"}))
                .unwrap_err()
                .to_string()
                .contains("track id")
        );
    }

    #[test]
    fn accepts_numeric_ids_and_v2_snake_case_fields() {
        let track = SoundCloudProvider::track_from_json(serde_json::json!({
            "id": 11, "track_urn": "soundcloud:tracks:urn:11", "artwork_url": "cover",
            "playback_count": 12, "likes_count": 3, "user": {"username":"A"}
        }))
        .unwrap();
        assert_eq!(track.id, "11");
        assert_eq!(track.playback_count, 12);
        assert_eq!(track.likes_count, 3);
    }

    #[test]
    fn rejects_pagination_urls_that_could_receive_the_access_token() {
        let provider =
            SoundCloudProvider::with_api_root("id", "secret", "https://api.soundcloud.test/")
                .unwrap();
        let error = provider
            .pagination_url("https://attacker.invalid/collect")
            .unwrap_err();
        assert!(error.to_string().contains("changed origin"));
        assert!(
            provider
                .pagination_url("https://api.soundcloud.test/users/1/likes?offset=20")
                .is_ok()
        );
    }

    #[test]
    fn prefers_progressive_audio_then_hls_and_preview() {
        let stream = stream_from_json(serde_json::json!({
            "hls_mp3_128_url": "https://cdn.test/hls",
            "http_mp3_128_url": "https://cdn.test/progressive"
        }))
        .unwrap();
        assert_eq!(stream.url, "https://cdn.test/progressive");
        assert!(!stream.hls);

        let hls = stream_from_json(serde_json::json!({"hls_mp3_128_url":"https://cdn.test/hls"}))
            .unwrap();
        assert!(hls.hls);
        let preview =
            stream_from_json(serde_json::json!({"preview_mp3_128_url":"https://cdn.test/preview"}))
                .unwrap();
        assert!(preview.preview);
        assert!(
            stream_from_json(serde_json::json!({}))
                .unwrap_err()
                .to_string()
                .contains("no playable stream")
        );
    }
}
