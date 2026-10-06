package main

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// A service that is signed in, with the Spotify endpoints pointed at a stub.
func signedInSpotifyService(t *testing.T) *service {
	t.Helper()
	svc := newSpotifyTestService(t)
	svc.spotifyAuth = spotifyAuthState{
		AccessToken:  "at-live",
		RefreshToken: "rt-live",
		// Comfortably in the future, so the expiry guard stays out of the way of the other tests.
		ExpiresAt: time.Now().Add(time.Hour).UnixMilli(),
	}
	return svc
}

// router answers requests by path and records the last one, so a test can assert on the URL that
// actually went out rather than on a URL it hopes was built.
func spotifyRouter(t *testing.T, svc *service, routes map[string]string, lastURL *string) {
	t.Helper()
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		*lastURL = request.URL.String()
		if got := request.Header.Get("Authorization"); got != "Bearer at-live" {
			t.Errorf("request used %q, want %q", got, "Bearer at-live")
		}
		if body, ok := routes[request.URL.Path]; ok {
			return spotifyJSONResponse(request, http.StatusOK, body), nil
		}
		t.Errorf("unexpected path %s", request.URL.Path)
		return spotifyJSONResponse(request, http.StatusNotFound, `{"error":{"status":404}}`), nil
	})}
}

const twoTrackWire = `{
	"items": [
		{"track": {
			"id": "4cOdK2wGLETKBW3PvgPWqT",
			"name": "Track One",
			"uri": "spotify:track:4cOdK2wGLETKBW3PvgPWqT",
			"duration_ms": 213000,
			"popularity": 71,
			"preview_url": "https://p.scdn.co/mp3-preview/one",
			"external_urls": {"spotify": "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"},
			"artists": [{"id": "artist-1", "name": "First Artist"}, {"id": "artist-2", "name": "Second Artist"}],
			"album": {"id": "album-1", "name": "The Album", "images": [
				{"url": "https://i.scdn.co/image/small", "width": 64},
				{"url": "https://i.scdn.co/image/large", "width": 640}
			]}
		}},
		{"track": {
			"id": "0eGsygTp906u18L0Oimnem",
			"name": "Track Two",
			"uri": "spotify:track:0eGsygTp906u18L0Oimnem",
			"duration_ms": 1000,
			"artists": [{"id": "artist-3", "name": "Third Artist"}],
			"album": {"id": "album-2", "name": "Other", "images": []}
		}}
	],
	"next": "https://api.spotify.test/v1/me/tracks?offset=50",
	"total": 120
}`

func TestSpotifyTracksMineMapsAndKeepsNextPage(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/me/tracks": twoTrackWire}, &lastURL)

	page, err := svc.RPCSpotifyTracksMine(spotifyPageParams{})
	if err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if len(page.Tracks) != 2 {
		t.Fatalf("got %d tracks, want 2: %#v", len(page.Tracks), page.Tracks)
	}
	first := page.Tracks[0]
	if first.NativeID != "4cOdK2wGLETKBW3PvgPWqT" {
		t.Errorf("native id = %q", first.NativeID)
	}
	if first.Source != "spotify" {
		t.Errorf("source = %q, want spotify: without it the track is indistinguishable from SoundCloud", first.Source)
	}
	if first.URN != "spotify:track:4cOdK2wGLETKBW3PvgPWqT" {
		t.Errorf("urn = %q", first.URN)
	}
	if first.Title != "Track One" || first.DurationMs != 213000 || first.Popularity != 71 {
		t.Errorf("unexpected track: %#v", first)
	}
	if len(first.Artists) != 2 || first.Artists[0].Name != "First Artist" {
		t.Errorf("artists = %#v", first.Artists)
	}
	// Spotify hands back several sizes and the largest is the one worth showing; picking the first
	// would put a 64px image in the sidebar.
	if first.ArtworkURL != "https://i.scdn.co/image/large" {
		t.Errorf("artwork = %q, want the 640px one", first.ArtworkURL)
	}
	if first.Permalink != "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT" {
		t.Errorf("permalink = %q", first.Permalink)
	}
	if page.NextHref != "https://api.spotify.test/v1/me/tracks?offset=50" {
		t.Errorf("nextHref = %q, the caller needs it to load page two", page.NextHref)
	}
	// No id given means the first page, which is an offset of zero and not an offset of nothing.
	if !strings.Contains(lastURL, "offset=0") {
		t.Errorf("first page request = %q", lastURL)
	}
}

func TestSpotifyTracksMineFollowsGivenNextHref(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/me/tracks": `{"items":[]}`}, &lastURL)

	if _, err := svc.RPCSpotifyTracksMine(spotifyPageParams{Next: "https://api.spotify.test/v1/me/tracks?offset=50"}); err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if !strings.Contains(lastURL, "offset=50") {
		t.Errorf("request = %q, want the given nextHref to be used verbatim", lastURL)
	}
}

func TestSpotifyTracksMineSkipsRemovedEntries(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	// A track the user removed leaves a null in the list. Turning that into an empty track would put
	// a blank row in the library that cannot be played and cannot be removed again.
	spotifyRouter(t, svc, map[string]string{"/v1/me/tracks": `{"items":[
		{"track": null},
		{"track": {"id": "abc", "name": "Real", "album": {"images": []}}}
	]}`}, &lastURL)

	page, err := svc.RPCSpotifyTracksMine(spotifyPageParams{})
	if err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].Title != "Real" {
		t.Fatalf("expected the null entry to be dropped: %#v", page.Tracks)
	}
}

func TestSpotifyTracksMineRefusesExpiredToken(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.spotifyAuth = spotifyAuthState{AccessToken: "at-stale", ExpiresAt: time.Now().Add(-time.Minute).UnixMilli()}
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("an expired token must not be sent: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusUnauthorized, `{}`), nil
	})}

	_, err := svc.RPCSpotifyTracksMine(spotifyPageParams{})
	if err == nil {
		t.Fatal("expected an error for an expired token")
	}
	if !strings.Contains(err.Error(), "истёк") {
		t.Errorf("error = %v, want it to say the token expired so the caller knows to refresh", err)
	}
}

func TestSpotifyReadMethodsRefuseWhenSignedOut(t *testing.T) {
	svc := newSpotifyTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("signed out, nothing should be sent: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusUnauthorized, `{}`), nil
	})}

	if _, err := svc.RPCSpotifyTracksMine(spotifyPageParams{}); err == nil {
		t.Error("tracks.mine")
	}
	if _, err := svc.RPCSpotifySearchTracks(spotifySearchParams{Query: "x"}); err == nil {
		t.Error("search.tracks")
	}
	if _, err := svc.RPCSpotifyTrackDetails(spotifyIdParams{ID: "x"}); err == nil {
		t.Error("track.details")
	}
	if _, err := svc.RPCSpotifyPlaylistsMine(spotifyPageParams{}); err == nil {
		t.Error("playlists.mine")
	}
	if _, err := svc.RPCSpotifyPlaylistTracks(spotifyPlaylistTracksParams{ID: "x"}); err == nil {
		t.Error("playlist.tracks")
	}
	if _, err := svc.RPCSpotifyRecommendations(spotifyRecommendParams{SeedTrackIDs: []string{"x"}}); err == nil {
		t.Error("recommendations")
	}
	if _, err := svc.RPCSpotifyTrackSave(spotifyIdParams{ID: "x"}); err == nil {
		t.Error("track.save")
	}
	if _, err := svc.RPCSpotifyTrackUnsave(spotifyIdParams{ID: "x"}); err == nil {
		t.Error("track.unsave")
	}
	if _, err := svc.RPCSpotifyUserProfile(emptyParams{}); err == nil {
		t.Error("user.profile")
	}
}

func TestSpotifySearchTracksSendsTypeAndQuery(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/search": `{"tracks":{"items":[{"id":"s1","name":"Hit","album":{"images":[]}}],"next":"","total":1}}`}, &lastURL)

	page, err := svc.RPCSpotifySearchTracks(spotifySearchParams{Query: "daft punk"})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].NativeID != "s1" {
		t.Fatalf("unexpected results: %#v", page.Tracks)
	}
	parsed, err := url.Parse(lastURL)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	// type=track is what makes this a track search rather than a mixed one; without it Spotify
	// answers with albums and artists and the list would be nonsense.
	if parsed.Query().Get("type") != "track" {
		t.Errorf("type = %q", parsed.Query().Get("type"))
	}
	if parsed.Query().Get("q") != "daft punk" {
		t.Errorf("q = %q", parsed.Query().Get("q"))
	}
}

func TestSpotifySearchTracksRejectsEmptyQuery(t *testing.T) {
	svc := signedInSpotifyService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("an empty query must not be sent: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusOK, `{}`), nil
	})}
	if _, err := svc.RPCSpotifySearchTracks(spotifySearchParams{Query: "   "}); err == nil {
		t.Fatal("expected an error for an empty query")
	}
}

func TestSpotifySearchTracksEncodesTheQuery(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/search": `{"tracks":{"items":[]}}`}, &lastURL)

	if _, err := svc.RPCSpotifySearchTracks(spotifySearchParams{Query: "a&b=c #1"}); err != nil {
		t.Fatalf("search: %v", err)
	}
	parsed, _ := url.Parse(lastURL)
	if got := parsed.Query().Get("q"); got != "a&b=c #1" {
		t.Errorf("q = %q, want the whole string back", got)
	}
}

func TestSpotifyPlaylistsMineMaps(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/me/playlists": `{"items":[{
		"id": "37i9dQZF1DX",
		"name": "Discover Weekly",
		"uri": "spotify:playlist:37i9dQZF1DX",
		"images": [{"url": "https://i.scdn.co/image/pl-small", "width": 64}, {"url": "https://i.scdn.co/image/pl-big", "width": 300}],
		"tracks": {"total": 30},
		"external_urls": {"spotify": "https://open.spotify.com/playlist/37i9dQZF1DX"},
		"owner": {"display_name": "Maxim"}
	}],"next": null}`}, &lastURL)

	page, err := svc.RPCSpotifyPlaylistsMine(spotifyPageParams{})
	if err != nil {
		t.Fatalf("playlists: %v", err)
	}
	if len(page.Playlists) != 1 {
		t.Fatalf("got %d playlists", len(page.Playlists))
	}
	got := page.Playlists[0]
	if got.NativeID != "37i9dQZF1DX" || got.Source != "spotify" || got.Title != "Discover Weekly" {
		t.Errorf("unexpected playlist: %#v", got)
	}
	if got.TrackCount != 30 {
		t.Errorf("trackCount = %d, want 30", got.TrackCount)
	}
	if got.Artist != "Maxim" {
		t.Errorf("artist = %q", got.Artist)
	}
	if got.ArtworkURL != "https://i.scdn.co/image/pl-big" {
		t.Errorf("artwork = %q, want the 300px one", got.ArtworkURL)
	}
}

func TestSpotifyPlaylistTracksUsesPlainItems(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/playlists/pl1/tracks": `{"items":[
		{"id": "t1","name": "One","album":{"images":[]}},
		{"id": "t2","name": "Two","album":{"images":[]}}
	],"next": null,"total": 2}`}, &lastURL)

	page, err := svc.RPCSpotifyPlaylistTracks(spotifyPlaylistTracksParams{ID: "pl1"})
	if err != nil {
		t.Fatalf("playlist.tracks: %v", err)
	}
	// A playlist's tracks come back as bare tracks, not wrapped in a "track" object the way saved
	// tracks do. Reading them with the saved-tracks shape yields zero rows and an empty playlist.
	if len(page.Tracks) != 2 || page.Tracks[0].NativeID != "t1" {
		t.Fatalf("unexpected tracks: %#v", page.Tracks)
	}
	if !strings.Contains(lastURL, "/v1/playlists/pl1/tracks") {
		t.Errorf("request = %q", lastURL)
	}
}

func TestSpotifyPlaylistTracksEscapesTheID(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/playlists/a b/tracks": `{"items":[]}`}, &lastURL)

	if _, err := svc.RPCSpotifyPlaylistTracks(spotifyPlaylistTracksParams{ID: "a b"}); err != nil {
		t.Fatalf("playlist.tracks: %v", err)
	}
	if strings.Contains(lastURL, "a b") {
		t.Errorf("request = %q, the id must be escaped", lastURL)
	}
}

func TestSpotifyTrackSaveAndUnsaveUseTheRightVerb(t *testing.T) {
	for _, testCase := range []struct {
		name       string
		call       func(*service) (spotifyIdResult, error)
		wantMethod string
		wantSaved  bool
	}{
		{"save", func(s *service) (spotifyIdResult, error) { return s.RPCSpotifyTrackSave(spotifyIdParams{ID: "t1"}) }, http.MethodPut, true},
		{"unsave", func(s *service) (spotifyIdResult, error) { return s.RPCSpotifyTrackUnsave(spotifyIdParams{ID: "t1"}) }, http.MethodDelete, false},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			svc := signedInSpotifyService(t)
			svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
				if request.Method != testCase.wantMethod {
					t.Errorf("method = %s, want %s", request.Method, testCase.wantMethod)
				}
				if request.URL.Path != "/v1/me/tracks" {
					t.Errorf("path = %s", request.URL.Path)
				}
				if got := request.URL.Query().Get("ids"); got != "t1" {
					t.Errorf("ids = %q, Spotify takes the track ids as a query parameter", got)
				}
				// Spotify answers a library write with 204 and no body.
				return &http.Response{StatusCode: http.StatusNoContent, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("")), Request: request}, nil
			})}

			result, err := testCase.call(svc)
			if err != nil {
				t.Fatalf("%s: %v", testCase.name, err)
			}
			if result.ID != "t1" || result.Saved != testCase.wantSaved {
				t.Errorf("result = %#v", result)
			}
		})
	}
}

func TestSpotifyRecommendationsNeedsASeed(t *testing.T) {
	svc := signedInSpotifyService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("Spotify requires a seed, so nothing should be sent: %s", request.URL)
		return spotifyJSONResponse(request, http.StatusBadRequest, `{}`), nil
	})}

	if _, err := svc.RPCSpotifyRecommendations(spotifyRecommendParams{}); err == nil {
		t.Fatal("expected an error with no seeds")
	}
	if _, err := svc.RPCSpotifyRecommendations(spotifyRecommendParams{SeedTrackIDs: []string{"  "}}); err == nil {
		t.Fatal("expected an error when the only seed is blank")
	}
}

func TestSpotifyRecommendationsJoinsSeeds(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/recommendations": `{"tracks":{"items":[{"id":"r1","name":"Rec","album":{"images":[]}}]}}`}, &lastURL)

	page, err := svc.RPCSpotifyRecommendations(spotifyRecommendParams{
		SeedTrackIDs: []string{"t1", " ", "t2"},
		SeedArtists:  []string{"a1"},
		Limit:        5,
	})
	if err != nil {
		t.Fatalf("recommendations: %v", err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].NativeID != "r1" {
		t.Fatalf("unexpected tracks: %#v", page.Tracks)
	}
	parsed, _ := url.Parse(lastURL)
	if got := parsed.Query().Get("seed_tracks"); got != "t1,t2" {
		t.Errorf("seed_tracks = %q, want the blank seed dropped", got)
	}
	if got := parsed.Query().Get("seed_artists"); got != "a1" {
		t.Errorf("seed_artists = %q", got)
	}
	if got := parsed.Query().Get("limit"); got != "5" {
		t.Errorf("limit = %q", got)
	}
}

func TestSpotifyLimitIsCapped(t *testing.T) {
	if got := spotifyLimit(0, 20); got != 20 {
		t.Errorf("unset limit = %d, want the fallback", got)
	}
	if got := spotifyLimit(-5, 20); got != 20 {
		t.Errorf("negative limit = %d, want the fallback", got)
	}
	if got := spotifyLimit(500, 20); got != 50 {
		t.Errorf("oversized limit = %d, want it capped at Spotify's maximum", got)
	}
}

func TestSpotifyUserProfile(t *testing.T) {
	svc := signedInSpotifyService(t)
	var lastURL string
	spotifyRouter(t, svc, map[string]string{"/v1/me": `{"id":"spotify-user","display_name":"Test User","email":"t@example.com","product":"premium"}`}, &lastURL)

	profile, err := svc.RPCSpotifyUserProfile(emptyParams{})
	if err != nil {
		t.Fatalf("user.profile: %v", err)
	}
	if profile.ID != "spotify-user" || profile.DisplayName != "Test User" || profile.Product != "premium" {
		t.Errorf("profile = %#v", profile)
	}
}

// The bridge and the adapter are written against these exact strings. If the naming rule ever stops
// producing them, this fails at build time rather than as an unexplained "method not found" from the
// frontend.
func TestSpotifyRPCMethodNamesAreTheContract(t *testing.T) {
	methods := rpcMethods()
	for _, name := range []string{
		"spotify.auth.exchange",
		"spotify.auth.refresh",
		"spotify.auth.status",
		"spotify.auth.logout",
		"spotify.tracks.mine",
		"spotify.playlists.mine",
		"spotify.playlist.tracks",
		"spotify.track.details",
		"spotify.search.tracks",
		"spotify.user.profile",
		"spotify.recommendations",
		"spotify.track.save",
		"spotify.track.unsave",
	} {
		if _, ok := methods[name]; !ok {
			t.Errorf("RPC method %q is not registered", name)
		}
	}
}

func TestSoundCloudRPCNamesDidNotShift(t *testing.T) {
	// Adding the Spotify methods must not disturb the names the existing frontend already calls.
	methods := rpcMethods()
	for _, name := range []string{
		"app.info",
		"auth.login",
		"auth.logout",
		"auth.refresh",
		"auth.status",
		"settings.get",
		"settings.update",
		"tracks.mine",
		"track.stream",
		"track.like",
		"track.unlike",
		"track.details",
		"track.lyrics",
		"track.related",
		"search.tracks",
		"playlist.tracks",
		"playlists.mine",
		"user.profile",
		"user.likes",
		"user.playlists",
		"user.tracks",
		"user.followers",
		"user.followings",
	} {
		if _, ok := methods[name]; !ok {
			t.Errorf("existing RPC method %q disappeared", name)
		}
	}
}
