use providers::{ProviderError, spotify::SpotifyOAuth};
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

fn response_server(
    status: u16,
    payload: &'static str,
) -> (
    String,
    std::sync::mpsc::Receiver<String>,
    thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 4096];
        let mut expected = None;
        loop {
            let count = stream.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..count]);
            let text = String::from_utf8_lossy(&request);
            if let Some(end) = text.find("\r\n\r\n") {
                expected = text[..end]
                    .lines()
                    .find_map(|line| {
                        let (key, value) = line.split_once(':')?;
                        key.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .map(|length| end + 4 + length);
            }
            if expected.is_some_and(|length| request.len() >= length) {
                break;
            }
        }
        let _ = sender.send(String::from_utf8_lossy(&request).into_owned());
        let body = payload.as_bytes();
        write!(stream, "HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).unwrap();
        stream.write_all(body).unwrap();
    });
    (format!("http://{address}/token"), receiver, server)
}

#[tokio::test]
async fn spotify_refresh_posts_pkce_client_fields_and_parses_rotation() {
    let (endpoint, request, server) = response_server(
        200,
        r#"{"access_token":"access","refresh_token":"rotated","expires_in":3600,"scope":"user-read-private"}"#,
    );
    let oauth = SpotifyOAuth::with_token_endpoint(&endpoint).unwrap();
    let token = oauth
        .refresh_access_token("client", "old-refresh")
        .await
        .unwrap();
    let request = request.recv().unwrap();
    server.join().unwrap();
    assert!(request.starts_with("POST /token "));
    assert!(request.contains("client_id=client"));
    assert!(request.contains("refresh_token=old-refresh"));
    assert_eq!(token.access_token, "access");
    assert_eq!(token.refresh_token.as_deref(), Some("rotated"));
    assert_eq!(token.expires_in_seconds, 3600);
}

#[tokio::test]
async fn spotify_invalid_grant_marks_the_login_as_revoked() {
    let (endpoint, _request, server) = response_server(400, r#"{"error":"invalid_grant"}"#);
    let oauth = SpotifyOAuth::with_token_endpoint(&endpoint).unwrap();
    let error = match oauth.refresh_access_token("client", "old-refresh").await {
        Ok(_) => panic!("invalid_grant unexpectedly returned a token"),
        Err(error) => error,
    };
    server.join().unwrap();
    assert!(matches!(error, ProviderError::LoginRevoked));
}
