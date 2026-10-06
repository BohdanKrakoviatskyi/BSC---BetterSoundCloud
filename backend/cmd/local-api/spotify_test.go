package main

import (
	"encoding/base64"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// newSpotifyTestService builds a service whose Spotify endpoints point at a stub, so the exchange
// and refresh can be exercised without the network and without a real Spotify app.
func newSpotifyTestService(t *testing.T) *service {
	t.Helper()
	svc := newTestService(t, "")
	svc.spotifyPath = filepath.Join(t.TempDir(), "spotify.json")
	svc.spotifyAPIBase = "https://api.spotify.test"
	svc.spotifyAuthURL = "https://accounts.spotify.test/api/token"
	return svc
}

func spotifyJSONResponse(request *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}
}

// stubSpotifyAuth answers the token endpoint and the profile endpoint, and records what it was sent
// so the tests can assert on the request rather than only on the result.
func stubSpotifyAuth(t *testing.T, tokenBody string, tokenStatus int) (*int, *url.Values) {
	t.Helper()
	tokenCalls := 0
	lastForm := url.Values{}
	svc := newSpotifyTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(request.URL.Host, "accounts.spotify.test"):
			tokenCalls++
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Errorf("read token body: %v", err)
			}
			lastForm, _ = url.ParseQuery(string(body))
			return spotifyJSONResponse(request, tokenStatus, tokenBody), nil
		case strings.Contains(request.URL.Host, "api.spotify.test"):
			return spotifyJSONResponse(request, http.StatusOK, `{"id":"spotify-user","display_name":"Test User","email":"test@example.com","product":"premium"}`), nil
		}
		t.Errorf("unexpected request: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}
	return &tokenCalls, &lastForm
}

func TestSpotifyAuthExchangeStoresTokensAndProfile(t *testing.T) {
	_, _ = stubSpotifyAuth(t, `{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"scope":"user-library-read"}`, http.StatusOK)

	svc := newSpotifyTestService(t)
	svc.spotifyAPIBase = "https://api.spotify.test"
	svc.spotifyAuthURL = "https://accounts.spotify.test/api/token"
	var basic string
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(request.URL.Host, "accounts.spotify.test"):
			basic = request.Header.Get("Authorization")
			return spotifyJSONResponse(request, http.StatusOK, `{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600}`), nil
		case strings.Contains(request.URL.Host, "api.spotify.test"):
			if got := request.Header.Get("Authorization"); got != "Bearer at-1" {
				t.Errorf("profile request used %q, want %q", got, "Bearer at-1")
			}
			return spotifyJSONResponse(request, http.StatusOK, `{"id":"spotify-user","display_name":"Test User","email":"test@example.com","product":"premium"}`), nil
		}
		return spotifyJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	status, err := svc.RPCSpotifyAuthExchange(spotifyExchangeParams{
		Code: "the-code", ClientID: "cid", ClientSecret: "secret", RedirectURI: "http://localhost:8888/callback",
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if !status.Authorized {
		t.Fatal("expected the exchange to report authorized")
	}
	if status.Profile == nil || status.Profile.ID != "spotify-user" || status.Profile.Product != "premium" {
		t.Fatalf("profile was not read: %#v", status.Profile)
	}
	if svc.spotifyAuth.AccessToken != "at-1" || svc.spotifyAuth.RefreshToken != "rt-1" {
		t.Fatalf("tokens were not stored: %#v", svc.spotifyAuth)
	}

	// Spotify wants the credentials in HTTP Basic, not in the form body.
	want := "Basic " + base64.StdEncoding.EncodeToString([]byte("cid:secret"))
	if basic != want {
		t.Errorf("authorization header = %q, want %q", basic, want)
	}

	// And it must land on disk, not only in memory.
	data, err := os.ReadFile(svc.spotifyPath)
	if err != nil {
		t.Fatalf("token file was not written: %v", err)
	}
	if !strings.Contains(string(data), "rt-1") {
		t.Errorf("token file does not hold the refresh token: %s", data)
	}
}

func TestSpotifyAuthExchangeRejectsIncompleteInput(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("no request should be made: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusBadRequest, `{}`), nil
	})}

	if _, err := svc.RPCSpotifyAuthExchange(spotifyExchangeParams{ClientID: "cid", ClientSecret: "s"}); err == nil {
		t.Error("expected an error when the code is missing")
	}
	if _, err := svc.RPCSpotifyAuthExchange(spotifyExchangeParams{Code: "c", ClientSecret: "s"}); err == nil {
		t.Error("expected an error when the client id is missing")
	}
}

func TestSpotifyAuthExchangeSurfacesSpotifyError(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.spotifyAuthURL = "https://accounts.spotify.test/api/token"
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		return spotifyJSONResponse(request, http.StatusBadRequest,
			`{"error":"invalid_grant","error_description":"Invalid authorization code"}`), nil
	})}

	_, err := svc.RPCSpotifyAuthExchange(spotifyExchangeParams{Code: "stale", ClientID: "cid", ClientSecret: "s"})
	if err == nil {
		t.Fatal("expected an error")
	}
	// The reason has to survive, or the settings panel cannot tell the user anything useful.
	if !strings.Contains(err.Error(), "invalid_grant") || !strings.Contains(err.Error(), "Invalid authorization code") {
		t.Errorf("error lost Spotify's reason: %v", err)
	}
}

func TestSpotifyAuthRefreshKeepsRefreshTokenWhenNotReturned(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.spotifyAuth = spotifyAuthState{AccessToken: "old", RefreshToken: "rt-keep", ExpiresAt: 1}
	svc.spotifyAuthURL = "https://accounts.spotify.test/api/token"
	var form url.Values
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		body, _ := io.ReadAll(request.Body)
		form, _ = url.ParseQuery(string(body))
		// A refresh response commonly omits refresh_token, meaning "keep using the old one".
		return spotifyJSONResponse(request, http.StatusOK, `{"access_token":"at-new","expires_in":3600}`), nil
	})}

	status, err := svc.RPCSpotifyAuthRefresh(spotifyRefreshParams{ClientID: "cid", ClientSecret: "s"})
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if !status.Authorized {
		t.Fatal("refresh did not report authorized")
	}
	if svc.spotifyAuth.AccessToken != "at-new" {
		t.Fatalf("access token was not replaced: %#v", svc.spotifyAuth)
	}
	if svc.spotifyAuth.RefreshToken != "rt-keep" {
		t.Errorf("refresh token was lost: %q", svc.spotifyAuth.RefreshToken)
	}
	if form.Get("grant_type") != "refresh_token" || form.Get("refresh_token") != "rt-keep" {
		t.Errorf("unexpected refresh form: %v", form)
	}
}

func TestSpotifyAuthRefreshWithoutStoredToken(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("no request should be made: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusBadRequest, `{}`), nil
	})}
	if _, err := svc.RPCSpotifyAuthRefresh(spotifyRefreshParams{ClientID: "c", ClientSecret: "s"}); err == nil {
		t.Fatal("expected an error when nothing is stored")
	}
}

func TestSpotifyAuthStatusAndLogout(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("status and logout must not touch the network: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusBadRequest, `{}`), nil
	})}

	if status, err := svc.RPCSpotifyAuthStatus(); err != nil || status.Authorized {
		t.Fatalf("expected signed out on a fresh service: %#v %v", status, err)
	}

	svc.spotifyAuth = spotifyAuthState{AccessToken: "at", RefreshToken: "rt", ID: "u", ExpiresAt: 42}
	if err := svc.saveSpotifyAuth(svc.spotifyAuth); err != nil {
		t.Fatalf("save: %v", err)
	}

	status, err := svc.RPCSpotifyAuthStatus()
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	if !status.Authorized || status.Profile == nil || status.Profile.ID != "u" {
		t.Fatalf("status lost the session: %#v", status)
	}
	if status.ExpiresAt != 42 {
		t.Errorf("status did not report the expiry: %d", status.ExpiresAt)
	}

	if _, err := svc.RPCSpotifyAuthLogout(); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if status, _ := svc.RPCSpotifyAuthStatus(); status.Authorized {
		t.Error("logout left the service authorized")
	}
	if _, err := os.Stat(svc.spotifyPath); !os.IsNotExist(err) {
		t.Errorf("logout left the token file behind: %v", err)
	}

	// Signing out twice must be fine; the panel can be closed and reopened.
	if _, err := svc.RPCSpotifyAuthLogout(); err != nil {
		t.Errorf("second logout failed: %v", err)
	}
}

func TestSpotifyAuthExchangeSurvivesUnreadableProfile(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.spotifyAuthURL = "https://accounts.spotify.test/api/token"
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if strings.Contains(request.URL.Host, "accounts.spotify.test") {
			return spotifyJSONResponse(request, http.StatusOK, `{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600}`), nil
		}
		return spotifyJSONResponse(request, http.StatusInternalServerError, `{"error":"server_error"}`), nil
	})}

	// The token is valid; a failing profile lookup must not turn that into a failed sign-in.
	status, err := svc.RPCSpotifyAuthExchange(spotifyExchangeParams{Code: "c", ClientID: "cid", ClientSecret: "s"})
	if err != nil {
		t.Fatalf("exchange failed because the profile lookup failed: %v", err)
	}
	if !status.Authorized {
		t.Fatal("expected authorized despite the profile failure")
	}
}

func TestSpotifyTokenFileIsWrittenAsASecret(t *testing.T) {
	if runtime.GOOS == "windows" {
		// Windows has no POSIX bits and Go's Chmod does not restrict access there, so this can only
		// ever fail. The same reason TestAuthLoginStoresTokenAndHidesIt skips its own check.
		t.Skip("POSIX modes do not exist on Windows")
	}
	svc := newSpotifyTestService(t)
	if err := svc.saveSpotifyAuth(spotifyAuthState{AccessToken: "a", RefreshToken: "r"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	info, err := os.Stat(svc.spotifyPath)
	if err != nil {
		t.Fatalf("stat: %v", err)
	}
	if got := info.Mode().Perm(); got != 0o600 {
		t.Errorf("token file permissions = %o, want 600", got)
	}
}
