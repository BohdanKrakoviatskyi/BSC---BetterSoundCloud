use providers::{ProviderTrack, soundcloud::SoundCloudProvider};

#[test]
fn maps_soundcloud_track_cards_to_provider_tracks() {
    let track: ProviderTrack = SoundCloudProvider::track_from_json(serde_json::json!({
        "id": 123,
        "urn": "soundcloud:tracks:123",
        "title": "  Night Drive  ",
        "duration": 215000,
        "permalinkUrl": "https://soundcloud.com/example/night-drive",
        "artworkUrl": "https://i1.sndcdn.com/artworks-abc-large.jpg",
        "user": {"id": 8, "username": "Artist", "avatarUrl": "https://i1.sndcdn.com/avatars-u-large.jpg"}
    })).unwrap();

    assert_eq!(track.provider, "soundcloud");
    assert_eq!(track.id, "123");
    assert_eq!(track.uri, "soundcloud:tracks:123");
    assert_eq!(track.title, "Night Drive");
    assert_eq!(track.duration_ms, 215000);
    assert_eq!(track.artist_name, "Artist");
    assert_eq!(
        track.artwork_url.as_deref(),
        Some("https://i1.sndcdn.com/artworks-abc-t500x500.jpg")
    );
}

#[test]
fn rejects_soundcloud_track_cards_without_stable_identity() {
    let err =
        SoundCloudProvider::track_from_json(serde_json::json!({"title":"No id"})).unwrap_err();
    assert!(err.to_string().contains("track id"));
}
