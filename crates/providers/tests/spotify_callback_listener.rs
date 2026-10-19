use providers::spotify::{PendingSpotifyAuthorization, bind_callback_listener, wait_for_callback};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

async fn request_callback(port: u16, state: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let target = format!("/login?code=one-time&state={state}");
    stream
        .write_all(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
        .await
        .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8_lossy(&response).into_owned()
}

#[tokio::test]
async fn loopback_listener_ignores_invalid_state_before_accepting_valid_callback() {
    let listener = bind_callback_listener(0).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let redirect = format!("http://127.0.0.1:{port}/login");
    let pending =
        PendingSpotifyAuthorization::with_redirect_uri("client", &["streaming"], &redirect)
            .unwrap();
    let auth_url = pending.authorization_url().unwrap();
    let state = auth_url
        .query_pairs()
        .find(|(key, _)| key == "state")
        .unwrap()
        .1
        .into_owned();
    let task = tokio::spawn(wait_for_callback(listener, pending));

    let invalid = request_callback(port, "forged-state").await;
    assert!(invalid.starts_with("HTTP/1.1 400"));
    let valid = request_callback(port, &state).await;
    assert!(valid.starts_with("HTTP/1.1 200"));
    let code = task.await.unwrap().unwrap();
    assert_eq!(code.code, "one-time");
}

#[tokio::test]
async fn loopback_listener_rejects_non_login_routes() {
    let listener = bind_callback_listener(0).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let redirect = format!("http://127.0.0.1:{port}/login");
    let pending =
        PendingSpotifyAuthorization::with_redirect_uri("client", &["streaming"], &redirect)
            .unwrap();
    let task = tokio::spawn(wait_for_callback(listener, pending));
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    stream
        .write_all(b"GET /other HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .await
        .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 404"));
    task.abort();
}
