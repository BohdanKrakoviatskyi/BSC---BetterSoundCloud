package localapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

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
