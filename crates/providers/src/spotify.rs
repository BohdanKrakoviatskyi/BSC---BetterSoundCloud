use crate::ProviderError;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;
use url::Url;
use zeroize::Zeroizing;

const REDIRECT_URI: &str = "http://127.0.0.1:8898/login";

pub struct PendingSpotifyAuthorization {
    client_id: String,
    verifier: Zeroizing<String>,
    state: String,
    challenge: String,
    scopes: String,
}

pub struct AuthorizationCode {
    pub code: String,
    pub verifier: Zeroizing<String>,
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
            ("redirect_uri", REDIRECT_URI),
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
        let client_id = client_id.trim();
        if client_id.is_empty() {
            return Err(ProviderError::OAuth("Spotify client ID is required".into()));
        }
        let verifier = random_url_safe(32)?;
        let state = random_url_safe(24)?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        Ok(Self {
            client_id: client_id.to_owned(),
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
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("scope", &self.scopes)
            .append_pair("code_challenge_method", "S256")
            .append_pair("code_challenge", &self.challenge)
            .append_pair("state", &self.state);
        Ok(url)
    }

    pub fn complete_callback(self, callback: &str) -> Result<AuthorizationCode, ProviderError> {
        let callback = Url::parse(callback)
            .map_err(|error| ProviderError::OAuth(format!("invalid callback URL: {error}")))?;
        if callback.scheme() != "http"
            || callback.host_str() != Some("127.0.0.1")
            || callback.port_or_known_default() != Some(8898)
            || callback.path() != "/login"
            || !callback.username().is_empty()
            || callback.password().is_some()
            || callback.fragment().is_some()
        {
            return Err(ProviderError::OAuth(
                "Spotify returned an invalid authorization callback".into(),
            ));
        }
        let query = callback.query_pairs().collect::<Vec<_>>();
        if let Some((_, error)) = query.iter().find(|(key, _)| key == "error") {
            return Err(ProviderError::OAuth(format!(
                "authorization was denied: {error}"
            )));
        }
        let states = query
            .iter()
            .filter(|(key, _)| key == "state")
            .collect::<Vec<_>>();
        let codes = query
            .iter()
            .filter(|(key, _)| key == "code")
            .collect::<Vec<_>>();
        let state = (states.len() == 1).then(|| states[0].1.as_ref());
        let code = (codes.len() == 1).then(|| codes[0].1.as_ref());
        if state != Some(self.state.as_str()) || code.is_none_or(str::is_empty) {
            return Err(ProviderError::OAuth(
                "Spotify returned an invalid authorization response".into(),
            ));
        }
        Ok(AuthorizationCode {
            code: code.unwrap_or_default().to_owned(),
            verifier: self.verifier,
        })
    }
}

fn random_url_safe(byte_count: usize) -> Result<String, ProviderError> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes).map_err(|error| {
        ProviderError::OAuth(format!("secure random generator failed: {error}"))
    })?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
