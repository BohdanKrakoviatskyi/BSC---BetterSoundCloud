use crate::ProviderError;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::{Instant, timeout, timeout_at};
use url::Url;
use zeroize::Zeroizing;

const REDIRECT_URI: &str = "http://127.0.0.1:8898/login";

pub struct PendingSpotifyAuthorization {
    client_id: String,
    redirect_uri: Url,
    verifier: Zeroizing<String>,
    state: String,
    challenge: String,
    scopes: String,
}

pub struct AuthorizationCode {
    pub code: String,
    pub verifier: Zeroizing<String>,
    pub redirect_uri: String,
}

#[derive(Clone, PartialEq, Eq)]
pub struct SpotifyToken {
    pub access_token: String,
    /// Refresh tokens may rotate; absent means the session must retain its old one.
    pub refresh_token: Option<String>,
    pub expires_in_seconds: u64,
    pub scope: Option<String>,
}

#[derive(Clone)]
pub struct SpotifyOAuth {
    client: Client,
    token_endpoint: Url,
}

impl SpotifyOAuth {
    pub fn new() -> Result<Self, ProviderError> {
        Self::with_token_endpoint("https://accounts.spotify.com/api/token")
    }

    pub fn with_token_endpoint(endpoint: &str) -> Result<Self, ProviderError> {
        let token_endpoint = Url::parse(endpoint).map_err(|error| {
            ProviderError::OAuth(format!("invalid Spotify token endpoint: {error}"))
        })?;
        if !matches!(token_endpoint.scheme(), "https" | "http")
            || token_endpoint.host_str().is_none()
        {
            return Err(ProviderError::OAuth(
                "Spotify token endpoint must be an absolute HTTP URL".into(),
            ));
        }
        let client = Client::builder()
            .user_agent("Resonance/0.2.6")
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            client,
            token_endpoint,
        })
    }

    pub async fn exchange_code(
        &self,
        client_id: &str,
        code: &AuthorizationCode,
    ) -> Result<SpotifyToken, ProviderError> {
        self.request_token(&[
            ("client_id", client_id),
            ("grant_type", "authorization_code"),
            ("code", &code.code),
            ("redirect_uri", &code.redirect_uri),
            ("code_verifier", &code.verifier),
        ])
        .await
    }

    pub async fn refresh_access_token(
        &self,
        client_id: &str,
        refresh_token: &str,
    ) -> Result<SpotifyToken, ProviderError> {
        self.request_token(&[
            ("client_id", client_id),
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
        ])
        .await
    }

    async fn request_token(&self, form: &[(&str, &str)]) -> Result<SpotifyToken, ProviderError> {
        let response = self
            .client
            .post(self.token_endpoint.clone())
            .form(form)
            .send()
            .await?;
        let status = response.status();
        let body = response.bytes().await?;
        parse_token_response(status, &body)
    }
}

fn parse_token_response(status: StatusCode, body: &[u8]) -> Result<SpotifyToken, ProviderError> {
    let value: Value = serde_json::from_slice(body).map_err(|error| {
        ProviderError::OAuth(format!("Spotify returned unreadable token data: {error}"))
    })?;
    if !status.is_success() {
        if status == StatusCode::BAD_REQUEST
            && value.get("error").and_then(Value::as_str) == Some("invalid_grant")
        {
            return Err(ProviderError::LoginRevoked);
        }
        let message = value
            .get("error_description")
            .or_else(|| value.get("error"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
        return Err(ProviderError::OAuth(format!(
            "token request failed: {message}"
        )));
    }
    let access_token = value
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| ProviderError::OAuth("token response contained no access token".into()))?
        .to_owned();
    let expires_in_seconds = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .filter(|seconds| *seconds > 0)
        .ok_or_else(|| ProviderError::OAuth("token response contained no valid expiry".into()))?;
    Ok(SpotifyToken {
        access_token,
        refresh_token: value
            .get("refresh_token")
            .and_then(Value::as_str)
            .filter(|token| !token.is_empty())
            .map(str::to_owned),
        expires_in_seconds,
        scope: value
            .get("scope")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

impl PendingSpotifyAuthorization {
    pub fn new(client_id: &str, scopes: &[&str]) -> Result<Self, ProviderError> {
        Self::with_redirect_uri(client_id, scopes, REDIRECT_URI)
    }

    pub fn with_redirect_uri(
        client_id: &str,
        scopes: &[&str],
        redirect_uri: &str,
    ) -> Result<Self, ProviderError> {
        let client_id = client_id.trim();
        if client_id.is_empty() {
            return Err(ProviderError::OAuth("Spotify client ID is required".into()));
        }
        let redirect_uri = Url::parse(redirect_uri)
            .map_err(|error| ProviderError::OAuth(format!("invalid redirect URL: {error}")))?;
        if redirect_uri.scheme() != "http"
            || redirect_uri.host_str() != Some("127.0.0.1")
            || redirect_uri.port().is_none()
            || redirect_uri.path() != "/login"
            || !redirect_uri.username().is_empty()
            || redirect_uri.password().is_some()
            || redirect_uri.query().is_some()
            || redirect_uri.fragment().is_some()
        {
            return Err(ProviderError::OAuth(
                "Spotify redirect must use the loopback /login callback".into(),
            ));
        }
        let verifier = random_url_safe(32)?;
        let state = random_url_safe(24)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Ok(Self {
            client_id: client_id.to_owned(),
            redirect_uri,
            verifier: Zeroizing::new(verifier),
            state,
            challenge,
            scopes: scopes.join(" "),
        })
    }

    pub fn authorization_url(&self) -> Result<Url, ProviderError> {
        let mut url = Url::parse("https://accounts.spotify.com/authorize")
            .map_err(|error| ProviderError::OAuth(format!("invalid authorization URL: {error}")))?;
        url.query_pairs_mut()
            .append_pair("client_id", &self.client_id)
            .append_pair("response_type", "code")
            .append_pair("redirect_uri", self.redirect_uri.as_str())
            .append_pair("scope", &self.scopes)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &self.challenge)
            .append_pair("state", &self.state);
        Ok(url)
    }

    pub fn complete_callback(self, callback: &str) -> Result<AuthorizationCode, ProviderError> {
        let callback = Url::parse(callback)
            .map_err(|error| ProviderError::OAuth(format!("invalid callback URL: {error}")))?;
        let code = self.callback_code(&callback)?;
        let Some(code) = code else {
            let error = callback
                .query_pairs()
                .find(|(key, _)| key == "error")
                .map(|(_, value)| value.into_owned())
                .unwrap_or_else(|| "unknown error".into());
            return Err(ProviderError::OAuth(format!(
                "authorization was denied: {error}"
            )));
        };
        Ok(AuthorizationCode {
            code,
            verifier: self.verifier,
            redirect_uri: self.redirect_uri.to_string(),
        })
    }

    fn accepts_callback(&self, callback: &str) -> bool {
        Url::parse(callback).is_ok_and(|url| self.callback_code(&url).is_ok())
    }

    fn callback_code(&self, callback: &Url) -> Result<Option<String>, ProviderError> {
        if callback.scheme() != self.redirect_uri.scheme()
            || callback.host_str() != self.redirect_uri.host_str()
            || callback.port_or_known_default() != self.redirect_uri.port_or_known_default()
            || callback.path() != self.redirect_uri.path()
            || !callback.username().is_empty()
            || callback.password().is_some()
            || callback.fragment().is_some()
        {
            return Err(ProviderError::OAuth(
                "Spotify returned an invalid authorization callback".into(),
            ));
        }
        let query = callback.query_pairs().collect::<Vec<_>>();
        let states = query
            .iter()
            .filter(|(key, _)| key == "state")
            .collect::<Vec<_>>();
        let codes = query
            .iter()
            .filter(|(key, _)| key == "code")
            .collect::<Vec<_>>();
        let errors = query
            .iter()
            .filter(|(key, _)| key == "error")
            .collect::<Vec<_>>();
        if states.len() != 1 || states[0].1 != self.state {
            return Err(ProviderError::OAuth(
                "Spotify returned an invalid authorization state".into(),
            ));
        }
        match (codes.as_slice(), errors.as_slice()) {
            ([(_, code)], []) if !code.is_empty() => Ok(Some(code.to_string())),
            ([], [(_, error)]) if !error.is_empty() => Ok(None),
            _ => Err(ProviderError::OAuth(
                "Spotify returned an invalid authorization response".into(),
            )),
        }
    }
}

pub async fn bind_callback_listener(port: u16) -> Result<TcpListener, ProviderError> {
    TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| {
            ProviderError::OAuth(format!("could not listen for Spotify login: {error}"))
        })
}

pub async fn wait_for_callback(
    listener: TcpListener,
    pending: PendingSpotifyAuthorization,
) -> Result<AuthorizationCode, ProviderError> {
    let redirect = pending.redirect_uri.clone();
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        let (mut stream, peer) = timeout_at(deadline, listener.accept())
            .await
            .map_err(|_| ProviderError::OAuth("Spotify login callback timed out".into()))?
            .map_err(|error| {
                ProviderError::OAuth(format!("could not accept Spotify callback: {error}"))
            })?;
        if !peer.ip().is_loopback() {
            write_callback_response(
                &mut stream,
                403,
                "Only local Spotify callbacks are accepted.",
            )
            .await;
            continue;
        }
        let request_line =
            match timeout(Duration::from_secs(5), read_request_line(&mut stream)).await {
                Ok(Ok(line)) => line,
                _ => {
                    write_callback_response(&mut stream, 400, "Invalid Spotify callback request.")
                        .await;
                    continue;
                }
            };
        let mut pieces = request_line.split_whitespace();
        if pieces.next() != Some("GET") {
            write_callback_response(&mut stream, 405, "Only GET is accepted.").await;
            continue;
        }
        let Some(target) = pieces.next() else {
            write_callback_response(&mut stream, 400, "Invalid Spotify callback request.").await;
            continue;
        };
        let Ok(callback) = redirect.join(target) else {
            write_callback_response(&mut stream, 400, "Invalid Spotify callback URL.").await;
            continue;
        };
        let callback = callback.to_string();
        if !pending.accepts_callback(&callback) {
            let status = if callback.contains("/login") {
                400
            } else {
                404
            };
            write_callback_response(
                &mut stream,
                status,
                "Spotify callback did not match this login.",
            )
            .await;
            continue;
        }
        let result = pending.complete_callback(&callback);
        let body = if result.is_ok() {
            "Spotify sign-in completed. You can return to Resonance."
        } else {
            "Spotify sign-in was denied. You can return to Resonance."
        };
        write_callback_response(&mut stream, 200, body).await;
        return result;
    }
}

async fn read_request_line(stream: &mut TcpStream) -> Result<String, std::io::Error> {
    let mut bytes = Vec::with_capacity(128);
    let mut byte = [0_u8; 1];
    while bytes.len() < 8192 {
        if stream.read(&mut byte).await? == 0 {
            break;
        }
        bytes.push(byte[0]);
        if byte[0] == b'\n' {
            break;
        }
    }
    String::from_utf8(bytes)
        .map(|line| line.trim().to_owned())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))
}

async fn write_callback_response(stream: &mut TcpStream, status: u16, message: &str) {
    let body =
        format!("<!doctype html><meta charset=utf-8><title>Resonance</title><p>{message}</p>");
    let response = format!(
        "HTTP/1.1 {status} Response\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn random_url_safe(byte_count: usize) -> Result<String, ProviderError> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes).map_err(|error| {
        ProviderError::OAuth(format!("secure random generator failed: {error}"))
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
