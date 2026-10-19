use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "app.resonance.desktop";

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
pub enum CredentialAccount {
    SpotifyPlayback,
    SpotifyLibrary,
    SoundCloud,
}

impl CredentialAccount {
    fn key(self) -> &'static str {
        match self {
            Self::SpotifyPlayback => "spotify-playback-v1",
            Self::SpotifyLibrary => "spotify-library-v1",
            Self::SoundCloud => "soundcloud-v1",
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentials {
    pub client_id: String,
    pub refresh_token: String,
    pub playback_login: String,
    pub access_token: String,
    pub access_token_expires_at_unix: Option<u64>,
    pub authorization_version: u32,
}

pub trait CredentialStore: Send + Sync {
    fn load(
        &self,
        account: CredentialAccount,
    ) -> Result<Option<StoredCredentials>, CredentialStoreError>;
    fn save(
        &self,
        account: CredentialAccount,
        credentials: &StoredCredentials,
    ) -> Result<(), CredentialStoreError>;
    fn remove(&self, account: CredentialAccount) -> Result<(), CredentialStoreError>;
    fn remove_all(&self) -> Result<(), CredentialStoreError> {
        for account in [
            CredentialAccount::SpotifyPlayback,
            CredentialAccount::SpotifyLibrary,
            CredentialAccount::SoundCloud,
        ] {
            self.remove(account)?;
        }
        Ok(())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CredentialStoreError {
    #[error("could not access the operating system credential store")]
    Keyring,
    #[error("saved credential data is damaged")]
    Damaged,
    #[error("credential store lock was poisoned")]
    Poisoned,
}

#[derive(Default)]
pub struct KeyringCredentialStore;

impl KeyringCredentialStore {
    fn entry(account: CredentialAccount) -> Result<keyring::Entry, CredentialStoreError> {
        keyring::Entry::new(KEYRING_SERVICE, account.key())
            .map_err(|_| CredentialStoreError::Keyring)
    }
}

impl CredentialStore for KeyringCredentialStore {
    fn load(
        &self,
        account: CredentialAccount,
    ) -> Result<Option<StoredCredentials>, CredentialStoreError> {
        let entry = Self::entry(account)?;
        let value = match entry.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(CredentialStoreError::Keyring),
        };
        let credentials =
            serde_json::from_str(&value).map_err(|_| CredentialStoreError::Damaged)?;
        Ok(Some(credentials))
    }

    fn save(
        &self,
        account: CredentialAccount,
        credentials: &StoredCredentials,
    ) -> Result<(), CredentialStoreError> {
        let value =
            serde_json::to_string(credentials).map_err(|_| CredentialStoreError::Damaged)?;
        Self::entry(account)?
            .set_password(&value)
            .map_err(|_| CredentialStoreError::Keyring)
    }

    fn remove(&self, account: CredentialAccount) -> Result<(), CredentialStoreError> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(CredentialStoreError::Keyring),
        }
    }
}

#[derive(Default)]
pub struct MemoryCredentialStore {
    values: Mutex<HashMap<CredentialAccount, StoredCredentials>>,
}

impl CredentialStore for MemoryCredentialStore {
    fn load(
        &self,
        account: CredentialAccount,
    ) -> Result<Option<StoredCredentials>, CredentialStoreError> {
        Ok(self
            .values
            .lock()
            .map_err(|_| CredentialStoreError::Poisoned)?
            .get(&account)
            .cloned())
    }

    fn save(
        &self,
        account: CredentialAccount,
        credentials: &StoredCredentials,
    ) -> Result<(), CredentialStoreError> {
        self.values
            .lock()
            .map_err(|_| CredentialStoreError::Poisoned)?
            .insert(account, credentials.clone());
        Ok(())
    }

    fn remove(&self, account: CredentialAccount) -> Result<(), CredentialStoreError> {
        self.values
            .lock()
            .map_err(|_| CredentialStoreError::Poisoned)?
            .remove(&account);
        Ok(())
    }
}
