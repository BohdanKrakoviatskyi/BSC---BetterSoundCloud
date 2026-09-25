package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func newTestService(t *testing.T, apiBase string) *service {
	t.Helper()
	dir := t.TempDir()
	return &service{
		settingsPath: filepath.Join(dir, "settings.json"),
		settings:     defaultSettings(),
		authPath:     filepath.Join(dir, "auth.json"),
		apiBase:      apiBase,
		httpClient:   &http.Client{Timeout: 5 * time.Second},
	}
}

func soundCloudStub(t *testing.T, wantToken string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/me" {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "OAuth "+wantToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":              1323227109,
			"username":        "Max",
			"full_name":       "Максим Райский",
			"permalink_url":   "https://soundcloud.com/maksim-rajskij",
			"avatar_url":      "https://i1.sndcdn.com/avatars-test-large.jpg",
			"followers_count": 3,
			"likes_count":     45,
		})
	}))
}

func TestAuthLoginStoresTokenAndHidesIt(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)

	result, err := svc.call("auth.login", json.RawMessage(`{"token":" valid-token "}`))
	if err != nil {
		t.Fatalf("auth.login: %v", err)
	}
	status, ok := result.(authStatus)
	if !ok || !status.Authorized || status.Profile == nil {
		t.Fatalf("unexpected login result: %#v", result)
	}
	if status.Profile.Username != "Max" || status.Profile.LikesCount != 45 {
		t.Fatalf("unexpected profile: %#v", status.Profile)
	}
	if !strings.Contains(status.Profile.AvatarURL, "-t500x500.") {
		t.Fatalf("avatar should use the largest size, got %q", status.Profile.AvatarURL)
	}

	stored, err := os.ReadFile(svc.authPath)
	if err != nil {
		t.Fatalf("auth file: %v", err)
	}
	if !strings.Contains(string(stored), "valid-token") {
		t.Fatalf("auth file should contain the token")
	}
	info, err := os.Stat(svc.authPath)
	if err != nil {
		t.Fatalf("auth file stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("auth file permissions = %o, want 600", info.Mode().Perm())
	}

	// Renderer не должен получать сам токен — только признак входа и профиль.
	statusResult, err := svc.call("auth.status", nil)
	if err != nil {
		t.Fatalf("auth.status: %v", err)
	}
	payload, err := json.Marshal(statusResult)
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	if strings.Contains(string(payload), "valid-token") {
		t.Fatalf("auth.status leaks the token: %s", payload)
	}
}

func TestAuthLoginRejectsInvalidToken(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)

	_, err := svc.call("auth.login", json.RawMessage(`{"token":"wrong-token"}`))
	if !errors.Is(err, errTokenRejected) {
		t.Fatalf("err = %v, want errTokenRejected", err)
	}
	if _, statErr := os.Stat(svc.authPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("auth file must not be created for rejected token")
	}
	status, err := svc.call("auth.status", nil)
	if err != nil {
		t.Fatalf("auth.status: %v", err)
	}
	if status.(authStatus).Authorized {
		t.Fatalf("service must stay unauthorized")
	}
}

func TestAuthLoginRequiresToken(t *testing.T) {
	svc := newTestService(t, officialAPIBase)
	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"   "}`)); err == nil {
		t.Fatalf("expected an error for an empty token")
	}
}

func TestAuthRefreshClearsRejectedToken(t *testing.T) {
	reject := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reject {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 1, "username": "Max"})
	}))
	defer server.Close()
	svc := newTestService(t, server.URL)

	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"session-token"}`)); err != nil {
		t.Fatalf("auth.login: %v", err)
	}
	reject = true
	result, err := svc.call("auth.refresh", nil)
	if err != nil {
		t.Fatalf("auth.refresh: %v", err)
	}
	if result.(authStatus).Authorized {
		t.Fatalf("rejected token must log the user out")
	}
	if _, statErr := os.Stat(svc.authPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("auth file must be removed after rejected refresh")
	}
}

func TestAuthLogoutClearsState(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)

	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"valid-token"}`)); err != nil {
		t.Fatalf("auth.login: %v", err)
	}
	result, err := svc.call("auth.logout", nil)
	if err != nil {
		t.Fatalf("auth.logout: %v", err)
	}
	if result.(authStatus).Authorized {
		t.Fatalf("logout must clear the session")
	}
	if _, statErr := os.Stat(svc.authPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("auth file must be removed after logout")
	}
}

func TestSoundCloudLiveProfile(t *testing.T) {
	token := strings.TrimSpace(os.Getenv("BSC_TEST_TOKEN"))
	if token == "" {
		t.Skip("BSC_TEST_TOKEN не задан — живой тест SoundCloud пропущен (npm run test:go:live)")
	}

	svc := newTestService(t, apiBase())
	payload, err := json.Marshal(map[string]string{"token": token})
	if err != nil {
		t.Fatalf("marshal token: %v", err)
	}
	result, err := svc.call("auth.login", payload)
	if err != nil {
		t.Fatalf("живой auth.login: %v", err)
	}
	status, ok := result.(authStatus)
	if !ok || !status.Authorized || status.Profile == nil {
		t.Fatalf("неожиданный ответ: %#v", result)
	}
	if status.Profile.ID == 0 || status.Profile.Username == "" {
		t.Fatalf("SoundCloud вернул неполный профиль: %#v", status.Profile)
	}
	t.Logf("подключено: %s (@%s), лайков: %d, аватар: %s",
		status.Profile.FullName, status.Profile.Username, status.Profile.LikesCount, status.Profile.AvatarURL)

	// Профиль должен восстанавливаться из auth.json после перезапуска sidecar.
	restarted := newTestService(t, apiBase())
	restarted.authPath = svc.authPath
	if err := restarted.loadAuth(); err != nil {
		t.Fatalf("loadAuth: %v", err)
	}
	restored := restarted.authStatus()
	if !restored.Authorized || restored.Profile == nil || restored.Profile.ID != status.Profile.ID {
		t.Fatalf("сессия не восстановилась: %#v", restored)
	}
}

func TestAuthStateSurvivesRestart(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)
	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"valid-token"}`)); err != nil {
		t.Fatalf("auth.login: %v", err)
	}

	restarted := newTestService(t, server.URL)
	restarted.authPath = svc.authPath
	if err := restarted.loadAuth(); err != nil {
		t.Fatalf("loadAuth: %v", err)
	}
	status := restarted.authStatus()
	if !status.Authorized || status.Profile == nil || status.Profile.Username != "Max" {
		t.Fatalf("session should survive restart: %#v", status)
	}
}

func TestPlaylistTracksHydrateStubsInOriginalOrder(t *testing.T) {
	var chunkSizes []int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "OAuth playlist-token" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}

		switch r.URL.Path {
		case "/playlists/42":
			if r.URL.Query().Get("limit") != "500" {
				t.Errorf("playlist limit = %q, want 500", r.URL.Query().Get("limit"))
			}
			stubs := make([]map[string]any, 55)
			for index := range stubs {
				stub := map[string]any{"id": index + 1}
				if index < 5 {
					stub["title"] = "Partial track " + strconv.Itoa(index+1)
				}
				stubs[index] = stub
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tracks": stubs})
		case "/tracks":
			ids := strings.Split(r.URL.Query().Get("ids"), ",")
			chunkSizes = append(chunkSizes, len(ids))
			tracks := make([]map[string]any, 0, len(ids))
			for index := len(ids) - 1; index >= 0; index-- {
				id, err := strconv.Atoi(ids[index])
				if err != nil {
					t.Errorf("invalid track ID %q: %v", ids[index], err)
					continue
				}
				if id == 17 {
					continue
				}
				tracks = append(tracks, map[string]any{
					"id": id, "title": "Hydrated track " + strconv.Itoa(id),
					"duration": id * 1000, "artwork_url": "https://sndcdn.com/large/cover.jpg",
				})
			}
			_ = json.NewEncoder(w).Encode(tracks)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(t, server.URL)
	svc.auth.Token = "playlist-token"
	tracks, err := svc.RPCPlaylistTracks(playlistTracksParams{PlaylistURN: "soundcloud:playlists:42"})
	if err != nil {
		t.Fatalf("playlist.tracks: %v", err)
	}
	if len(chunkSizes) != 2 || chunkSizes[0] != 50 || chunkSizes[1] != 5 {
		t.Fatalf("chunk sizes = %v, want [50 5]", chunkSizes)
	}
	if len(tracks) != 54 {
		t.Fatalf("loaded %d tracks, want 54 (missing track 17 should be skipped)", len(tracks))
	}

	wantID := 1
	for _, track := range tracks {
		if wantID == 17 {
			wantID++
		}
		if track.ID != int64(wantID) {
			t.Fatalf("track order has ID %d, want %d", track.ID, wantID)
		}
		if track.Title != "Hydrated track "+strconv.Itoa(wantID) {
			t.Fatalf("track %d was not hydrated: title = %q", wantID, track.Title)
		}
		if track.Duration != int64(wantID*1000) {
			t.Fatalf("track %d duration = %d, want %d", wantID, track.Duration, wantID*1000)
		}
		wantID++
	}
}

func TestPlaylistsFallbackToFirstTrackArtwork(t *testing.T) {
	playlistDetailRequests := 0
	trackHydrationRequests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "OAuth playlist-token" {
			http.Error(w, "missing auth", http.StatusUnauthorized)
			return
		}

		switch r.URL.Path {
		case "/users/7/playlists":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"collection": []any{
					map[string]any{"id": 42, "title": "Fallback from API", "track_count": 1},
					map[string]any{
						"id": 43, "title": "Fallback from embedded track", "track_count": 1,
						"tracks": []any{map[string]any{"id": 123, "artwork_url": "https://sndcdn.com/embedded-large.jpg"}},
					},
				},
			})
		case "/playlists/42":
			playlistDetailRequests++
			if r.URL.Query().Get("limit") != "5" {
				t.Errorf("first-track limit = %q, want 5", r.URL.Query().Get("limit"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"tracks": []any{map[string]any{"id": 99}}})
		case "/tracks":
			trackHydrationRequests++
			if r.URL.Query().Get("ids") != "99" {
				t.Errorf("track IDs = %q, want 99", r.URL.Query().Get("ids"))
			}
			_ = json.NewEncoder(w).Encode([]any{map[string]any{
				"id": 99, "title": "First track", "artwork_url": "https://sndcdn.com/first-large.jpg",
			}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	svc := newTestService(t, server.URL)
	svc.auth.Token = "playlist-token"
	playlists, err := svc.fetchPlaylistsFrom(server.URL, server.URL+"/users/7/playlists?limit=200")
	if err != nil {
		t.Fatalf("fetch playlists: %v", err)
	}
	if len(playlists) != 2 {
		t.Fatalf("loaded %d playlists, want 2", len(playlists))
	}
	if playlists[0].ArtworkURL != "https://sndcdn.com/first-t500x500.jpg" {
		t.Fatalf("first playlist artwork = %q", playlists[0].ArtworkURL)
	}
	if playlists[1].ArtworkURL != "https://sndcdn.com/embedded-t500x500.jpg" {
		t.Fatalf("embedded fallback artwork = %q", playlists[1].ArtworkURL)
	}
	if playlistDetailRequests != 1 || trackHydrationRequests != 1 {
		t.Fatalf("fallback requests = playlist:%d tracks:%d, want 1 each", playlistDetailRequests, trackHydrationRequests)
	}
}

func TestPlaybackHistorySurvivesRestart(t *testing.T) {
	historyPath := filepath.Join(t.TempDir(), "history.json")
	svc := newTestService(t, officialAPIBase)
	svc.historyPath = historyPath

	track := soundcloudTrackCard{ID: 42, TrackURN: "soundcloud:tracks:42", Title: "Recently played", Duration: 125_000}
	payload, err := json.Marshal(historyTrackParams{Track: track})
	if err != nil {
		t.Fatalf("marshal track: %v", err)
	}
	if _, err := svc.call("history.record", payload); err != nil {
		t.Fatalf("history.record: %v", err)
	}

	restarted := newTestService(t, officialAPIBase)
	restarted.historyPath = historyPath
	if err := restarted.loadHistory(); err != nil {
		t.Fatalf("loadHistory after restart: %v", err)
	}
	loaded, err := restarted.RPCHistoryList(emptyParams{})
	if err != nil {
		t.Fatalf("history.list after restart: %v", err)
	}
	if len(loaded) != 1 || loaded[0].ID != track.ID || loaded[0].Title != track.Title {
		t.Fatalf("restored history = %#v, want the recently played track", loaded)
	}
}
