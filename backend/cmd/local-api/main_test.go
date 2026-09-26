package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
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

type testRoundTripper func(*http.Request) (*http.Response, error)

func (roundTrip testRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return roundTrip(request)
}

func TestDecodeMixedSelectionPlaylist(t *testing.T) {
	item := json.RawMessage(`{"type":"system-playlist","playlist":{"id":42,"urn":"soundcloud:playlists:42","title":"SoundCloud Weekly","artwork_url":"https://i1.sndcdn.com/playlists-test-large.jpg","track_count":25,"user":{"username":"SoundCloud"}}}`)
	playlist, ok := decodeMixedSelectionPlaylist(item)
	if !ok {
		t.Fatal("expected system-playlist item to decode")
	}
	if playlist.ID != "42" || playlist.URN != "soundcloud:playlists:42" || playlist.Title != "SoundCloud Weekly" || playlist.TrackCount != 25 || playlist.User.Username != "SoundCloud" {
		t.Fatalf("unexpected playlist card: %#v", playlist)
	}
	if !strings.Contains(playlist.ArtworkURL, "t500x500") {
		t.Fatalf("playlist artwork was not normalized: %q", playlist.ArtworkURL)
	}
	if _, ok := decodeMixedSelectionTrack(item); ok {
		t.Fatal("system-playlist item must not be exposed as a track")
	}
}

func TestIsMadeForYouSelection(t *testing.T) {
	for _, test := range []struct {
		id, title string
		want      bool
	}{
		{id: "discovery-mix", want: true},
		{id: "personalized-playlists", want: true},
		{title: "Made for you", want: true},
		{title: "Специально для вас", want: true},
		{title: "Recently played", want: false},
	} {
		if got := isMadeForYouSelection(test.id, test.title); got != test.want {
			t.Errorf("isMadeForYouSelection(%q, %q) = %v, want %v", test.id, test.title, got, test.want)
		}
	}
}

func TestMixedSelectionsIncludesPlaylistsAndOAuthToken(t *testing.T) {
	svc := newTestService(t, "")
	svc.auth.Token = "mixed-token"
	svc.settings.ClientID = "test-client-id"
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.Path != "/mixed-selections" {
			t.Errorf("request path = %q, want /mixed-selections", request.URL.Path)
		}
		if request.URL.Query().Get("client_id") != "test-client-id" {
			t.Errorf("client_id = %q", request.URL.Query().Get("client_id"))
		}
		if request.URL.Query().Get("oauth_token") != "mixed-token" {
			t.Errorf("oauth_token = %q", request.URL.Query().Get("oauth_token"))
		}
		if request.Header.Get("Authorization") != "OAuth mixed-token" {
			t.Errorf("Authorization = %q", request.Header.Get("Authorization"))
		}
		body := `{"collection":[{"id":"personalized-discovery","title":"Made for you","items":[{"type":"system-playlist","playlist":{"id":42,"urn":"soundcloud:playlists:42","title":"SoundCloud Weekly","track_count":25,"user":{"username":"SoundCloud"}}},{"type":"playlist","playlist":{"id":43,"urn":"soundcloud:playlists:43","title":"Daily Drops","track_count":12,"user":{"username":"SoundCloud"}}},{"type":"track","track":{"id":7,"urn":"soundcloud:tracks:7","title":"Recommended track","duration":1000,"user":{"username":"Artist"}}}]}]}`
		return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}

	selections, err := svc.RPCMixedSelections(emptyParams{})
	if err != nil {
		t.Fatalf("mixed.selections: %v", err)
	}
	if len(selections) != 1 {
		t.Fatalf("selection count = %d, want 1", len(selections))
	}
	selection := selections[0]
	if !selection.MadeForYou || selection.Title != "Made for you" {
		t.Fatalf("unexpected personalized selection: %#v", selection)
	}
	if len(selection.Playlists) != 2 || selection.Playlists[0].Title != "SoundCloud Weekly" || selection.Playlists[1].Title != "Daily Drops" {
		t.Fatalf("unexpected personalized playlists: %#v", selection.Playlists)
	}
	if len(selection.Tracks) != 1 || selection.Tracks[0].Title != "Recommended track" {
		t.Fatalf("unexpected selection tracks: %#v", selection.Tracks)
	}
}

func TestBackgroundImageValidation(t *testing.T) {
	validJPEG := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xff, 0xd8, 0xff, 0xd9})
	for _, test := range []struct {
		name  string
		value string
		valid bool
	}{
		{name: "empty image clears background", value: "", valid: true},
		{name: "jpeg data url", value: validJPEG, valid: true},
		{name: "unsupported mime type", value: "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte{0xff, 0xd8, 0xff}), valid: false},
		{name: "invalid jpeg signature", value: "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte("not jpeg")), valid: false},
		{name: "oversized image", value: "data:image/jpeg;base64," + strings.Repeat("A", 700_000), valid: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := validBackgroundImage(test.value); got != test.valid {
				t.Fatalf("validBackgroundImage() = %v, want %v", got, test.valid)
			}
		})
	}
}

func TestBackgroundSettingsPersistAndValidateBlur(t *testing.T) {
	svc := newTestService(t, "")
	image := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xff, 0xd8, 0xff, 0xd9})
	blur := 13

	updated, err := svc.RPCSettingsUpdate(settingsPatch{BackgroundImage: &image, BackgroundBlur: &blur})
	if err != nil {
		t.Fatalf("update background settings: %v", err)
	}
	if updated.BackgroundImage != image || updated.BackgroundBlur != blur {
		t.Fatalf("unexpected updated settings: %#v", updated)
	}

	reloaded := &service{settingsPath: svc.settingsPath, settings: defaultSettings()}
	if err := reloaded.loadSettings(); err != nil {
		t.Fatalf("reload settings: %v", err)
	}
	if reloaded.settings.BackgroundImage != image || reloaded.settings.BackgroundBlur != blur {
		t.Fatalf("background settings did not persist: %#v", reloaded.settings)
	}

	for _, invalidBlur := range []int{-1, 25} {
		if _, err := svc.RPCSettingsUpdate(settingsPatch{BackgroundBlur: &invalidBlur}); err == nil {
			t.Errorf("expected blur %d to be rejected", invalidBlur)
		}
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

func TestTrackLikeUsesSoundCloudV2Endpoints(t *testing.T) {
	for _, test := range []struct {
		name                 string
		liked                bool
		wantMethod           string
		dataDomeCookie       string
		wantCookieHeader     string
		wantDataDomeClientID string
	}{
		{name: "like", liked: true, wantMethod: http.MethodPut},
		{name: "unlike", liked: false, wantMethod: http.MethodDelete},
		{name: "like after captcha", liked: true, wantMethod: http.MethodPut, dataDomeCookie: "verified-cookie", wantCookieHeader: "datadome=verified-cookie", wantDataDomeClientID: "verified-cookie"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/users/1323227109/track_likes/2391534675" {
					t.Errorf("request path = %q", r.URL.Path)
				}
				if r.Method != test.wantMethod {
					t.Errorf("request method = %q, want %q", r.Method, test.wantMethod)
				}
				if r.URL.Query().Get("client_id") != "test-client-id" {
					t.Errorf("client_id = %q", r.URL.Query().Get("client_id"))
				}
				if r.Header.Get("Authorization") != "OAuth test-token" {
					t.Errorf("unexpected authorization header")
				}
				if r.Header.Get("Cookie") != test.wantCookieHeader {
					t.Errorf("Cookie header = %q, want %q", r.Header.Get("Cookie"), test.wantCookieHeader)
				}
				if r.Header.Get("X-Datadome-ClientId") != test.wantDataDomeClientID {
					t.Errorf("X-Datadome-ClientId header = %q, want %q", r.Header.Get("X-Datadome-ClientId"), test.wantDataDomeClientID)
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			svc := newTestService(t, server.URL)
			svc.auth.Token = "test-token"
			svc.auth.Profile.ID = 1323227109
			svc.settings.ClientID = "test-client-id"
			params := trackLikeParams{TrackID: 2391534675, TrackURN: "soundcloud:tracks:2391534675", DataDomeCookie: test.dataDomeCookie}
			var result trackLikeResult
			var err error
			if test.liked {
				result, err = svc.RPCTrackLike(params)
			} else {
				result, err = svc.RPCTrackUnlike(params)
			}
			if err != nil {
				t.Fatalf("track-like request failed: %v", err)
			}
			if result.Liked != test.liked || result.CaptchaURL != "" {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func TestTrackLikeReturnsCaptchaURLFromForbiddenResponse(t *testing.T) {
	const captchaURL = "https://geo.captcha-delivery.com/captcha/?challenge=test"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("request method = %q, want PUT", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"url":"` + captchaURL + `"}`))
	}))
	defer server.Close()

	svc := newTestService(t, server.URL)
	svc.auth.Token = "test-token"
	svc.auth.Profile.ID = 1323227109
	svc.settings.ClientID = "test-client-id"
	result, err := svc.RPCTrackLike(trackLikeParams{TrackID: 2391534675})
	if err != nil {
		t.Fatalf("captcha response should be returned to the UI: %v", err)
	}
	if result.Liked || result.CaptchaURL != captchaURL {
		t.Fatalf("result = %#v, want captcha URL and no like", result)
	}
}
