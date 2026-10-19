use providers::spotify::{SpotifyWebApi, spotify_playlist_from_json, spotify_track_from_json};
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

#[test]
fn spotify_track_parser_maps_album_artists_and_identity() {
    let track = spotify_track_from_json(json!({
        "type": "track",
        "id": "track-id",
        "uri": "spotify:track:track-id",
        "name": "Song",
        "duration_ms": 201000,
        "artists": [{"id": "artist-id", "name": "Artist"}],
        "album": {"name": "Album", "images": [{"url": "https://img/640", "width": 640}]}
    }))
    .unwrap();

    assert_eq!(track.provider, "spotify");
    assert_eq!(track.id, "track-id");
    assert_eq!(track.artist_name, "Artist");
    assert_eq!(track.artwork_url.as_deref(), Some("https://img/640"));
    assert_eq!(track.duration_ms, 201000);
}

#[test]
fn spotify_playlist_parser_uses_items_total_and_owner() {
    let playlist = spotify_playlist_from_json(json!({
        "id": "playlist-id",
        "uri": "spotify:playlist:playlist-id",
        "name": "Mix",
        "items": {"total": 17},
        "owner": {"display_name": "Listener"},
        "images": [{"url": "https://img/640", "width": 640}]
    }))
    .unwrap();

    assert_eq!(playlist.provider, "spotify");
    assert_eq!(playlist.track_count, 17);
    assert_eq!(playlist.owner_name, "Listener");
    assert_eq!(playlist.artwork_url.as_deref(), Some("https://img/640"));
}

#[test]
fn spotify_track_parser_rejects_non_track_and_missing_identity() {
    assert!(spotify_track_from_json(json!({"type": "episode", "id": "x"})).is_none());
    assert!(spotify_track_from_json(json!({"type": "track", "name": "No ID"})).is_none());
}

#[tokio::test]
async fn spotify_web_api_lists_playlists_with_bearer_auth() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 4096];
        let count = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..count]).to_string();
        let body = r#"{"items":[{"id":"playlist-id","name":"Mix","items":{"total":2},"owner":{"display_name":"Listener"}}],"next":null}"#;
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        request
    });
    let api = SpotifyWebApi::with_api_root(&format!("http://{address}/")).unwrap();
    let playlists = api.playlists("access-token").await.unwrap();
    let request = server.join().unwrap();

    assert!(request.starts_with("GET /v1/me/playlists?limit=50 "));
    assert!(
        request
            .to_ascii_lowercase()
            .contains("authorization: bearer access-token")
    );
    assert_eq!(playlists.len(), 1);
    assert_eq!(playlists[0].title, "Mix");
    assert_eq!(playlists[0].track_count, 2);
}
