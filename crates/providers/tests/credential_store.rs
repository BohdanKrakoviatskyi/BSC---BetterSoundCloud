use providers::credentials::{
    CredentialAccount, CredentialStore, MemoryCredentialStore, StoredCredentials,
};

fn sample(token: &str) -> StoredCredentials {
    StoredCredentials {
        client_id: "desktop-client".into(),
        refresh_token: "rotating-refresh".into(),
        playback_login: "librespot-login".into(),
        access_token: token.into(),
        access_token_expires_at_unix: Some(1_900_000_000),
        authorization_version: 2,
    }
}

#[test]
fn credential_accounts_are_isolated_and_removable() {
    let store = MemoryCredentialStore::default();
    assert!(
        store
            .load(CredentialAccount::SpotifyPlayback)
            .unwrap()
            .is_none()
    );
    store
        .save(
            CredentialAccount::SpotifyPlayback,
            &sample("playback-token"),
        )
        .unwrap();
    store
        .save(CredentialAccount::SpotifyLibrary, &sample("library-token"))
        .unwrap();
    assert_eq!(
        store
            .load(CredentialAccount::SpotifyPlayback)
            .unwrap()
            .unwrap()
            .access_token,
        "playback-token"
    );
    assert_eq!(
        store
            .load(CredentialAccount::SpotifyLibrary)
            .unwrap()
            .unwrap()
            .access_token,
        "library-token"
    );
    store.remove(CredentialAccount::SpotifyPlayback).unwrap();
    assert!(
        store
            .load(CredentialAccount::SpotifyPlayback)
            .unwrap()
            .is_none()
    );
    assert!(
        store
            .load(CredentialAccount::SpotifyLibrary)
            .unwrap()
            .is_some()
    );
}
