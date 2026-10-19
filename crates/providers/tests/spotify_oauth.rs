use providers::spotify::PendingSpotifyAuthorization;

#[test]
fn builds_a_pkce_authorization_url_and_accepts_its_bound_callback() {
    let pending = PendingSpotifyAuthorization::new("client-id", &["streaming"]).unwrap();
    let auth = pending.authorization_url().unwrap();
    assert_eq!(auth.scheme(), "https");
    assert_eq!(auth.host_str(), Some("accounts.spotify.com"));
    let query: std::collections::HashMap<_, _> = auth.query_pairs().into_owned().collect();
    assert_eq!(
        query.get("client_id").map(String::as_str),
        Some("client-id")
    );
    assert_eq!(
        query.get("code_challenge_method").map(String::as_str),
        Some("S256")
    );
    assert_eq!(query.get("scope").map(String::as_str), Some("streaming"));
    let state = query.get("state").unwrap();
    let callback = format!("http://127.0.0.1:8898/login?code=abc&state={state}");
    let code = pending.complete_callback(&callback).unwrap();
    assert_eq!(code.code, "abc");
    assert!(!code.verifier.is_empty());
}

#[test]
fn rejects_spoofed_or_unbound_spotify_callbacks() {
    let pending = PendingSpotifyAuthorization::new("client-id", &["user-read-private"]).unwrap();
    assert!(
        pending
            .complete_callback("http://localhost:8898/login?code=x&state=y")
            .is_err()
    );
    let pending = PendingSpotifyAuthorization::new("client-id", &["user-read-private"]).unwrap();
    assert!(
        pending
            .complete_callback("http://127.0.0.1:8898/other?code=x&state=y")
            .is_err()
    );
    let pending = PendingSpotifyAuthorization::new("client-id", &["user-read-private"]).unwrap();
    assert!(
        pending
            .complete_callback("http://127.0.0.1:8898/login?code=x&state=y")
            .is_err()
    );
}
