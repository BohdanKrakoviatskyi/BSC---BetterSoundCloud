package localapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
