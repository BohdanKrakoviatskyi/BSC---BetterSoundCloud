pub mod soundcloud;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderArtist {
    pub provider: String,
    pub id: String,
    pub uri: String,
    pub name: String,
    pub permalink: Option<String>,
    pub artwork_url: Option<String>,
    pub description: Option<String>,
    pub followers: u64,
    pub track_count: u64,
    pub likes_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTrack {
    pub provider: String,
    pub id: String,
    pub uri: String,
    pub title: String,
    pub permalink: Option<String>,
    pub artwork_url: Option<String>,
    pub duration_ms: u64,
    pub artist_id: Option<String>,
    pub artist_name: String,
    pub playback_count: u64,
    pub likes_count: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPlaylist {
    pub provider: String,
    pub id: String,
    pub uri: String,
    pub title: String,
    pub permalink: Option<String>,
    pub artwork_url: Option<String>,
    pub track_count: u64,
    pub owner_name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderPage<T> {
    pub items: Vec<T>,
    pub next: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("provider request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("provider rejected the request ({status}): {message}")]
    Http { status: u16, message: String },
    #[error("provider returned invalid data: {0}")]
    InvalidData(String),
}

#[async_trait]
pub trait MusicProvider: Send + Sync {
    fn id(&self) -> &'static str;
    async fn search_tracks(&self, query: &str) -> Result<Vec<ProviderTrack>, ProviderError>;
    async fn artist(&self, id: &str) -> Result<ProviderArtist, ProviderError>;
    async fn artist_tracks(
        &self,
        id: &str,
        next: Option<&str>,
    ) -> Result<ProviderPage<ProviderTrack>, ProviderError>;
    async fn artist_likes(
        &self,
        id: &str,
        next: Option<&str>,
    ) -> Result<ProviderPage<ProviderTrack>, ProviderError>;
    async fn playlists(
        &self,
        user_id: Option<&str>,
    ) -> Result<Vec<ProviderPlaylist>, ProviderError>;
    async fn playlist_tracks(
        &self,
        playlist_urn: &str,
    ) -> Result<Vec<ProviderTrack>, ProviderError>;
    async fn track(&self, id: &str) -> Result<ProviderTrack, ProviderError>;
    async fn related_tracks(&self, id: &str) -> Result<Vec<ProviderTrack>, ProviderError>;
}
