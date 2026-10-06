package main

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// ---- helpers

func newYoutubeTestService(t *testing.T) *service {
	t.Helper()
	svc := newTestService(t, "")
	svc.youtubePath = filepath.Join(t.TempDir(), "youtube.json")
	svc.youtubeAPIBase = "https://youtube.test/v3"
	svc.youtubeAuthURL = "https://oauth2.test/token"
	return svc
}

func signedInYoutubeService(t *testing.T) *service {
	t.Helper()
	svc := newYoutubeTestService(t)
	svc.youtubeAuth = youtubeAuthState{
		AccessToken:  "at-live",
		RefreshToken: "rt-live",
		ExpiresAt:    time.Now().Add(time.Hour).UnixMilli(),
	}
	return svc
}

func youtubeResponse(request *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}
}

// youtubeRouter answers by path, records the URL and form of the last request, and can capture the
// Authorization header so a test can assert on the request rather than only on the result.
type youtubeRecorder struct {
	url        string
	form       url.Values
	authHeader string
}

func routeYoutube(t *testing.T, svc *service, routes map[string]string, recorder *youtubeRecorder) {
	t.Helper()
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if recorder != nil {
			recorder.url = request.URL.String()
			recorder.authHeader = request.Header.Get("Authorization")
			if request.Body != nil {
				body, _ := io.ReadAll(request.Body)
				recorder.form, _ = url.ParseQuery(string(body))
			}
		}
		if body, ok := routes[request.URL.Path]; ok {
			return youtubeResponse(request, http.StatusOK, body), nil
		}
		t.Errorf("unexpected path %s", request.URL.Path)
		return youtubeResponse(request, http.StatusNotFound, `{"error":{"code":404}}`), nil
	})}
}

// ---- ISO 8601 durations

func TestParseISO8601Duration(t *testing.T) {
	cases := []struct {
		input string
		want  int64
		ok    bool
	}{
		// The shapes YouTube actually sends.
		{"PT45S", 45_000, true},
		{"PT4M13S", 253_000, true},
		{"PT1H2M3S", 3_723_000, true},
		{"PT1H", 3_600_000, true},
		{"PT2M", 120_000, true},
		// A live stream reports zero. That is the API saying so, not a parse failure, and a caller
		// that cannot tell the two apart will either show 0:00 or hide the track.
		{"PT0S", 0, true},
		// Days are not something YouTube sends, but the format allows them and a duration that spans
		// one has to come out right rather than losing a day.
		{"P1DT2H", 93_600_000, true},
		{"P1D", 86_400_000, true},
		// A fractional part, which ISO 8601 permits. Truncated, not refused: dropping a track's length
		// over half a second is worse than losing the half second.
		{"PT4M13.5S", 253_000, true},
		// Not understood, and reported as such rather than as zero.
		{"", 0, false},
		{"P", 0, false},
		{"garbage", 0, false},
		{"4M13S", 0, false},
		{"PT", 0, false},
		{"PT1X", 0, false},
		// Units out of order means the string is not the format, and guessing at it would produce a
		// plausible wrong number.
		{"PT3S4M", 0, false},
		{"P1Y2M3DT1H", 0, false},
		{"PT-5S", 0, false},
	}

	for _, testCase := range cases {
		got, ok := parseISO8601Duration(testCase.input)
		if ok != testCase.ok || got != testCase.want {
			t.Errorf("parseISO8601Duration(%q) = (%d, %v), want (%d, %v)", testCase.input, got, ok, testCase.want, testCase.ok)
		}
	}
}

// ---- auth

func TestYoutubeAuthExchangeSendsCredentialsInTheBody(t *testing.T) {
	svc := signedInYoutubeService(t)
	svc.youtubeAuth = youtubeAuthState{}

	// Only the token request is recorded. An exchange finishes with a profile lookup that legitimately
	// carries a bearer token, so a recorder keeping the last request would say nothing about how the
	// credentials were sent вЂ” which is the whole point of this test.
	var tokenAuthHeader string
	var tokenForm url.Values
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		switch {
		case strings.Contains(request.URL.Host, "oauth2.test"):
			tokenAuthHeader = request.Header.Get("Authorization")
			body, _ := io.ReadAll(request.Body)
			tokenForm, _ = url.ParseQuery(string(body))
			return youtubeResponse(request, http.StatusOK,
				`{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"scope":"https://www.googleapis.com/auth/youtube.readonly"}`), nil
		case strings.Contains(request.URL.Path, "userinfo"):
			return youtubeResponse(request, http.StatusOK,
				`{"id":"google-user","email":"u@example.com","name":"A Person","picture":"https://pic"}`), nil
		}
		return youtubeResponse(request, http.StatusNotFound, `{}`), nil
	})}

	status, err := svc.RPCYoutubeAuthExchange(youtubeExchangeParams{
		Code: "the-code", ClientID: "cid", ClientSecret: "secret", RedirectURI: "http://localhost:8889/callback",
	})
	if err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if !status.Authorized || status.Profile == nil || status.Profile.ID != "google-user" {
		t.Fatalf("unexpected status: %#v", status)
	}

	// The one real difference from Spotify: Google wants the credentials in the form body, and a
	// request that puts them in an Authorization header is refused with invalid_client.
	if tokenAuthHeader != "" {
		t.Errorf("token request sent Authorization %q, want none: Google reads the credentials from the body", tokenAuthHeader)
	}
	if tokenForm.Get("client_id") != "cid" || tokenForm.Get("client_secret") != "secret" {
		t.Errorf("credentials not in the form: %v", tokenForm)
	}
	if tokenForm.Get("grant_type") != "authorization_code" || tokenForm.Get("code") != "the-code" {
		t.Errorf("unexpected form: %v", tokenForm)
	}

	// redirect_uri is accepted on the signature and must not be forwarded. A Desktop app client has no
	// registered redirect URIs, and sending one is what produces redirect_uri_mismatch.
	if tokenForm.Has("redirect_uri") {
		t.Errorf("redirect_uri was forwarded as %q; a desktop client must not send it", tokenForm.Get("redirect_uri"))
	}

	if svc.youtubeAuth.RefreshToken != "rt-1" {
		t.Errorf("refresh token not stored: %#v", svc.youtubeAuth)
	}
	data, err := os.ReadFile(svc.youtubePath)
	if err != nil {
		t.Fatalf("token file not written: %v", err)
	}
	if !strings.Contains(string(data), "rt-1") {
		t.Errorf("token file missing the refresh token: %s", data)
	}
}
func TestYoutubeAuthRefreshNeedsNoCredentials(t *testing.T) {
	// Unlike Spotify, Google's refresh grant is authorized by the refresh token alone. That is the
	// difference that makes a remembered session recoverable without the user, so it is asserted: a
	// signature demanding client credentials here would make restarts fail where they need not.
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	routeYoutube(t, svc, map[string]string{"/token": `{"access_token":"at-new","expires_in":3600}`}, recorder)

	status, err := svc.RPCYoutubeAuthRefresh(emptyParams{})
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if !status.Authorized || svc.youtubeAuth.AccessToken != "at-new" {
		t.Fatalf("token not replaced: %#v", status)
	}
	// A refresh response omits refresh_token, meaning keep using the old one. Losing it would send the
	// user back through a consent screen every hour.
	if svc.youtubeAuth.RefreshToken != "rt-live" {
		t.Errorf("refresh token lost: %q", svc.youtubeAuth.RefreshToken)
	}
	if recorder.form.Get("grant_type") != "refresh_token" || recorder.form.Get("refresh_token") != "rt-live" {
		t.Errorf("unexpected form: %v", recorder.form)
	}
}

func TestYoutubeAuthExchangeRejectsIncompleteInput(t *testing.T) {
	svc := newYoutubeTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("no request should be made: %s", request.URL)
		return youtubeResponse(request, http.StatusBadRequest, `{}`), nil
	})}

	if _, err := svc.RPCYoutubeAuthExchange(youtubeExchangeParams{ClientID: "c", ClientSecret: "s"}); err == nil {
		t.Error("expected an error when the code is missing")
	}
	if _, err := svc.RPCYoutubeAuthExchange(youtubeExchangeParams{Code: "c", ClientSecret: "s"}); err == nil {
		t.Error("expected an error when the client id is missing")
	}
	if _, err := svc.RPCYoutubeAuthRefresh(emptyParams{}); err == nil {
		t.Error("expected an error when nothing is stored")
	}
}

func TestYoutubeAuthSurfacesGoogleError(t *testing.T) {
	svc := newYoutubeTestService(t)
	routeYoutube(t, svc, map[string]string{}, nil)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		return youtubeResponse(request, http.StatusBadRequest,
			`{"error":"invalid_grant","error_description":"Bad Request"}`), nil
	})}

	_, err := svc.RPCYoutubeAuthExchange(youtubeExchangeParams{Code: "stale", ClientID: "c", ClientSecret: "s"})
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "invalid_grant") {
		t.Errorf("error lost Google's reason: %v", err)
	}
}

func TestYoutubeAuthSurfacesDataAPIStyleError(t *testing.T) {
	// The Data API does not use the OAuth error shape, it nests a message under error. Both are read,
	// because "quotaExceeded" and "accessNotConfigured" need completely different responses.
	svc := signedInYoutubeService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		return youtubeResponse(request, http.StatusForbidden, `{"error":{"code":403,"message":"Daily Limit Exceeded","status":"RESOURCE_EXHAUSTED","errors":[{"reason":"quotaExceeded","message":"Daily Limit Exceeded"}]}}`), nil
	})}

	_, err := svc.RPCYoutubeTracksMine(youtubePageParams{})
	if err == nil {
		t.Fatal("expected an error")
	}
	if !strings.Contains(err.Error(), "Daily Limit Exceeded") || !strings.Contains(err.Error(), "quotaExceeded") {
		t.Errorf("error lost the Data API message: %v", err)
	}
}

func TestYoutubeAuthStatusAndLogout(t *testing.T) {
	svc := newYoutubeTestService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("status and logout must not touch the network: %s", request.URL)
		return youtubeResponse(request, http.StatusBadRequest, `{}`), nil
	})}

	if status, err := svc.RPCYoutubeAuthStatus(emptyParams{}); err != nil || status.Authorized {
		t.Fatalf("expected signed out: %#v %v", status, err)
	}
	svc.youtubeAuth = youtubeAuthState{AccessToken: "at", RefreshToken: "rt", ID: "u", ExpiresAt: 42}
	if err := svc.saveYoutubeAuth(svc.youtubeAuth); err != nil {
		t.Fatalf("save: %v", err)
	}

	status, err := svc.RPCYoutubeAuthStatus(emptyParams{})
	if err != nil || !status.Authorized || status.Profile == nil || status.Profile.ID != "u" || status.ExpiresAt != 42 {
		t.Fatalf("unexpected status: %#v %v", status, err)
	}

	if _, err := svc.RPCYoutubeAuthLogout(emptyParams{}); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if status, _ := svc.RPCYoutubeAuthStatus(emptyParams{}); status.Authorized {
		t.Error("logout left the service authorized")
	}
	if _, err := os.Stat(svc.youtubePath); !os.IsNotExist(err) {
		t.Errorf("logout left the token file: %v", err)
	}
	// Twice is fine; the settings panel can be reopened.
	if _, err := svc.RPCYoutubeAuthLogout(emptyParams{}); err != nil {
		t.Errorf("second logout failed: %v", err)
	}
}

func TestYoutubeAuthSurvivesUnreadableProfile(t *testing.T) {
	svc := signedInYoutubeService(t)
	svc.youtubeAuth = youtubeAuthState{}
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if strings.Contains(request.URL.Host, "oauth2.test") {
			return youtubeResponse(request, http.StatusOK, `{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600}`), nil
		}
		return youtubeResponse(request, http.StatusForbidden, `{"error":{"message":"nope"}}`), nil
	})}

	status, err := svc.RPCYoutubeAuthExchange(youtubeExchangeParams{Code: "c", ClientID: "cid", ClientSecret: "s"})
	if err != nil {
		t.Fatalf("exchange failed because the profile lookup failed: %v", err)
	}
	if !status.Authorized {
		t.Fatal("expected authorized despite the profile failure")
	}
}

// ---- reading

const twoLikedWire = `{
	"items": [
		{"id":"vid1","snippet":{"title":"Song One","channelTitle":"Artist One","categoryId":"10","publishedAt":"2024-01-02T03:04:05Z","thumbnails":{"high":{"url":"https://i.ytimg.com/hi","width":480,"height":360},"maxres":{"url":"https://i.ytimg.com/max","width":1280,"height":720},"default":{"url":"https://i.ytimg.com/lo","width":120,"height":90}}},
		 "contentDetails":{"duration":"PT4M13S"},"statistics":{"viewCount":"1234567"}},
		{"id":"vid2","snippet":{"title":"A Lecture","channelTitle":"Some University","categoryId":"27","publishedAt":"2023-05-06T07:08:09Z","thumbnails":{"default":{"url":"https://i.ytimg.com/lo2","width":120,"height":90}}},
		 "contentDetails":{"duration":"PT1H2M3S"}}
	],
	"nextPageToken": "page-2",
	"pageInfo": {"totalResults": 1500, "resultsPerPage": 50}
}`

func TestYoutubeTracksMineReadsLikes(t *testing.T) {
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	routeYoutube(t, svc, map[string]string{"/v3/videos": twoLikedWire}, recorder)

	page, err := svc.RPCYoutubeTracksMine(youtubePageParams{})
	if err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if len(page.Tracks) != 2 {
		t.Fatalf("got %d tracks, want 2", len(page.Tracks))
	}

	first := page.Tracks[0]
	if first.NativeID != "vid1" || first.Source != "youtube-music" || first.URN != "youtube:video:vid1" {
		t.Errorf("unexpected identity: %#v", first)
	}
	if first.DurationMs != 253_000 {
		t.Errorf("duration = %d, want 253000", first.DurationMs)
	}
	if first.Artist != "Artist One" || first.Title != "Song One" {
		t.Errorf("unexpected track: %#v", first)
	}
	if first.ViewCount != 1_234_567 {
		t.Errorf("viewCount = %d", first.ViewCount)
	}
	// maxres is not always present, so the largest available image is chosen rather than a fixed key.
	if first.ArtworkURL != "https://i.ytimg.com/max" {
		t.Errorf("artwork = %q, want the largest", first.ArtworkURL)
	}
	if first.Permalink != "https://www.youtube.com/watch?v=vid1" {
		t.Errorf("permalink = %q", first.Permalink)
	}
	if page.NextPageToken != "page-2" {
		t.Errorf("nextPageToken = %q", page.NextPageToken)
	}

	parsed, _ := url.Parse(recorder.url)
	if parsed.Query().Get("myRating") != "like" {
		t.Errorf("myRating = %q; there is no playlist endpoint for liked videos", parsed.Query().Get("myRating"))
	}
	if !strings.Contains(parsed.Query().Get("part"), "contentDetails") {
		t.Errorf("part = %q, needs contentDetails for the duration", parsed.Query().Get("part"))
	}
}

func TestYoutubeTracksMineReportsTheThousandCeiling(t *testing.T) {
	// The API holds more than it will page through. Without this the library looks complete at 1000
	// and the user has no idea anything is missing.
	svc := signedInYoutubeService(t)
	routeYoutube(t, svc, map[string]string{"/v3/videos": twoLikedWire}, nil)

	page, err := svc.RPCYoutubeTracksMine(youtubePageParams{})
	if err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if !page.Capped {
		t.Error("totalResults is 1500, which is past the 1000 ceiling, and capped was not reported")
	}
}

func TestYoutubeTracksMineDoesNotReportCappedBelowTheCeiling(t *testing.T) {
	svc := signedInYoutubeService(t)
	routeYoutube(t, svc, map[string]string{"/v3/videos": `{"items":[],"pageInfo":{"totalResults":12}}`}, nil)

	page, err := svc.RPCYoutubeTracksMine(youtubePageParams{})
	if err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if page.Capped {
		t.Error("12 results is well under the ceiling and must not be reported as capped")
	}
}

func TestYoutubeTracksMineFiltersToMusic(t *testing.T) {
	// videos.list has no category filter, so the music pass happens here. A liked video wrongly
	// categorised shows up rather than disappearing, which is the safer of the two failures.
	svc := signedInYoutubeService(t)
	routeYoutube(t, svc, map[string]string{"/v3/videos": twoLikedWire}, nil)

	page, err := svc.RPCYoutubeTracksMine(youtubePageParams{MusicOnly: true})
	if err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].NativeID != "vid1" {
		t.Fatalf("expected only the music video: %#v", page.Tracks)
	}
}

func TestYoutubeTracksMineFollowsPageToken(t *testing.T) {
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	routeYoutube(t, svc, map[string]string{"/v3/videos": `{"items":[]}`}, recorder)

	if _, err := svc.RPCYoutubeTracksMine(youtubePageParams{PageToken: "page-2"}); err != nil {
		t.Fatalf("tracks.mine: %v", err)
	}
	// YouTube's continuation is a token, not a URL, so the first page must not be rebuilt instead.
	if !strings.Contains(recorder.url, "pageToken=page-2") {
		t.Errorf("request = %q, want the given page token", recorder.url)
	}
	if strings.Contains(recorder.url, "myRating") {
		t.Errorf("request = %q, a continuation must not repeat the filter", recorder.url)
	}
}

func TestYoutubeReadMethodsRefuseWhenSignedOutOrExpired(t *testing.T) {
	signedOut := newYoutubeTestService(t)
	signedOut.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("signed out, nothing should be sent: %s", request.URL)
		return youtubeResponse(request, http.StatusUnauthorized, `{}`), nil
	})}
	if _, err := signedOut.RPCYoutubeTracksMine(youtubePageParams{}); err == nil {
		t.Error("tracks.mine")
	}
	if _, err := signedOut.RPCYoutubeSearchTracks(youtubeSearchParams{Query: "x"}); err == nil {
		t.Error("search.tracks")
	}
	if _, err := signedOut.RPCYoutubeTrackDetails(youtubeIdParams{ID: "x"}); err == nil {
		t.Error("track.details")
	}
	if _, err := signedOut.RPCYoutubePlaylistsMine(youtubePageParams{}); err == nil {
		t.Error("playlists.mine")
	}
	if _, err := signedOut.RPCYoutubePlaylistTracks(youtubePlaylistTracksParams{ID: "x"}); err == nil {
		t.Error("playlist.tracks")
	}
	if _, err := signedOut.RPCYoutubeUserProfile(emptyParams{}); err == nil {
		t.Error("user.profile")
	}

	expired := newYoutubeTestService(t)
	expired.youtubeAuth = youtubeAuthState{AccessToken: "stale", RefreshToken: "rt", ExpiresAt: time.Now().Add(-time.Minute).UnixMilli()}
	expired.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("an expired token must not be sent: %s", request.URL)
		return youtubeResponse(request, http.StatusUnauthorized, `{}`), nil
	})}
	_, err := expired.RPCYoutubeTracksMine(youtubePageParams{})
	if err == nil {
		t.Fatal("expected an error for an expired token")
	}
	// The message has to point at refresh rather than at signing in, because unlike Spotify this one
	// is recoverable without the user.
	if !strings.Contains(err.Error(), "refresh") {
		t.Errorf("error = %v, want it to say a refresh will do", err)
	}
}

func TestYoutubeSearchTracksFiltersToMusicAndFetchesDurations(t *testing.T) {
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	// The search call, then the follow-up that reads the durations: search returns only ids and
	// snippets, so a duration has to be fetched or reported as unknown.
	routeYoutube(t, svc, map[string]string{
		"/v3/search": `{"items":[
			{"id":{"kind":"youtube#video","videoId":"vid1"},"snippet":{"title":"Song One","channelTitle":"Artist One","categoryId":"10"}},
			{"id":{"kind":"youtube#video","videoId":"vid2"},"snippet":{"title":"Song Two","channelTitle":"Artist Two","categoryId":"10"}},
			{"id":{"kind":"youtube#playlist","playlistId":"pl1"},"snippet":{"title":"Not a video"}}
		],"nextPageToken":"s-page-2"}`,
		"/v3/videos": `{"items":[{"id":"vid1","contentDetails":{"duration":"PT3M"}},{"id":"vid2","contentDetails":{"duration":"PT5M30S"}}]}`,
	}, recorder)

	page, err := svc.RPCYoutubeSearchTracks(youtubeSearchParams{Query: "daft punk"})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	// The playlist result is dropped: it has no videoId, and mapping it would produce a track with an
	// empty id that collides with every other such row.
	if len(page.Tracks) != 2 {
		t.Fatalf("got %d tracks, want 2: %#v", len(page.Tracks), page.Tracks)
	}
	if page.Tracks[0].DurationMs != 180_000 || page.Tracks[1].DurationMs != 330_000 {
		t.Errorf("durations not read: %#v", page.Tracks)
	}
	if page.NextPageToken != "s-page-2" {
		t.Errorf("nextPageToken = %q", page.NextPageToken)
	}
}

func TestYoutubeSearchTracksSendsTheMusicCategory(t *testing.T) {
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	// videos.list answers 404 for the duration follow-up here, which is the second case below.
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		// Only the search request is recorded. The duration follow-up goes out afterwards, and letting
		// it overwrite the recorder would have this assert on that one's query string instead.
		if request.URL.Path == "/v3/search" {
			recorder.url = request.URL.String()
		}
		if request.URL.Path != "/v3/search" {
			return youtubeResponse(request, http.StatusNotFound, `{}`), nil
		}
		return youtubeResponse(request, http.StatusOK,
			`{"items":[{"id":{"kind":"youtube#video","videoId":"v1"},"snippet":{"title":"T"}}]}`), nil
	})}

	// A search that found something but could not read its length is still a useful search, so the
	// tracks come back with an unknown duration rather than the whole query failing.
	page, err := svc.RPCYoutubeSearchTracks(youtubeSearchParams{Query: "q"})
	if err != nil {
		t.Fatalf("search failed because the duration lookup failed: %v", err)
	}
	if len(page.Tracks) != 1 || page.Tracks[0].NativeID != "v1" {
		t.Fatalf("unexpected tracks: %#v", page.Tracks)
	}
	if page.Tracks[0].DurationMs != 0 {
		t.Errorf("duration = %d, want 0 for an unknown length", page.Tracks[0].DurationMs)
	}

	parsed, _ := url.Parse(recorder.url)
	if parsed.Query().Get("type") != "video" {
		t.Errorf("type = %q", parsed.Query().Get("type"))
	}
	if parsed.Query().Get("videoCategoryId") != "10" {
		t.Errorf("videoCategoryId = %q, want the Music category", parsed.Query().Get("videoCategoryId"))
	}
}

func TestYoutubeSearchTracksRejectsEmptyQuery(t *testing.T) {
	svc := signedInYoutubeService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("an empty query must not be sent: %s", request.URL)
		return youtubeResponse(request, http.StatusOK, `{}`), nil
	})}
	if _, err := svc.RPCYoutubeSearchTracks(youtubeSearchParams{Query: "  "}); err == nil {
		t.Fatal("expected an error for an empty query")
	}
}

func TestYoutubePlaylistTracksReadsResourceID(t *testing.T) {
	// A playlist entry's snippet names the video under resourceId. Reading the wrong field gives every
	// entry an empty id, which makes a whole playlist look like one track repeated.
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	routeYoutube(t, svc, map[string]string{"/v3/playlistItems": `{"items":[
		{"snippet":{"title":"One","channelTitle":"A","categoryId":"10","resourceId":{"videoId":"v1"},"thumbnails":{"default":{"url":"u","width":120,"height":90}}}},
		{"snippet":{"title":"Two","channelTitle":"A","categoryId":"10","resourceId":{"videoId":"v2"},"thumbnails":{"default":{"url":"u","width":120,"height":90}}}}
	],"nextPageToken":null}`}, recorder)

	page, err := svc.RPCYoutubePlaylistTracks(youtubePlaylistTracksParams{ID: "PL1"})
	if err != nil {
		t.Fatalf("playlist.tracks: %v", err)
	}
	if len(page.Tracks) != 2 || page.Tracks[0].NativeID != "v1" || page.Tracks[1].NativeID != "v2" {
		t.Fatalf("unexpected tracks: %#v", page.Tracks)
	}
	if page.Tracks[0].URN != "youtube:video:v1" {
		t.Errorf("urn = %q", page.Tracks[0].URN)
	}
	parsed, _ := url.Parse(recorder.url)
	if parsed.Query().Get("playlistId") != "PL1" {
		t.Errorf("playlistId = %q", parsed.Query().Get("playlistId"))
	}
}

func TestYoutubePlaylistsMine(t *testing.T) {
	svc := signedInYoutubeService(t)
	recorder := &youtubeRecorder{}
	routeYoutube(t, svc, map[string]string{"/v3/playlists": `{"items":[{
		"id":"PL1","snippet":{"title":"Road Trip","description":"for driving","channelTitle":"Me",
		"thumbnails":{"medium":{"url":"https://m","width":320,"height":180},"maxres":{"url":"https://x","width":1280,"height":720}}}
	}],"nextPageToken":null}`}, recorder)

	page, err := svc.RPCYoutubePlaylistsMine(youtubePageParams{})
	if err != nil {
		t.Fatalf("playlists.mine: %v", err)
	}
	if len(page.Playlists) != 1 {
		t.Fatalf("got %d playlists", len(page.Playlists))
	}
	got := page.Playlists[0]
	if got.NativeID != "PL1" || got.Source != "youtube-music" || got.Title != "Road Trip" {
		t.Errorf("unexpected playlist: %#v", got)
	}
	if got.ArtworkURL != "https://x" || got.Description != "for driving" {
		t.Errorf("unexpected playlist fields: %#v", got)
	}
	parsed, _ := url.Parse(recorder.url)
	if parsed.Query().Get("mine") != "true" {
		t.Errorf("mine = %q", parsed.Query().Get("mine"))
	}
}

func TestYoutubeTrackDetailsNotFound(t *testing.T) {
	svc := signedInYoutubeService(t)
	routeYoutube(t, svc, map[string]string{"/v3/videos": `{"items":[]}`}, nil)

	// An empty result is a missing or private video, and returning a zero-valued track would put a
	// blank row in the list.
	_, err := svc.RPCYoutubeTrackDetails(youtubeIdParams{ID: "gone"})
	if err == nil {
		t.Fatal("expected an error for an empty result")
	}
	if !strings.Contains(err.Error(), "gone") {
		t.Errorf("error = %v, want it to name the id", err)
	}
}

func TestYoutubeTrackDetailsRejectsEmptyID(t *testing.T) {
	svc := signedInYoutubeService(t)
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		t.Errorf("nothing should be sent: %s", request.URL)
		return youtubeResponse(request, http.StatusOK, `{}`), nil
	})}
	if _, err := svc.RPCYoutubeTrackDetails(youtubeIdParams{ID: "  "}); err == nil {
		t.Fatal("expected an error for an empty id")
	}
	if _, err := svc.RPCYoutubePlaylistTracks(youtubePlaylistTracksParams{ID: ""}); err == nil {
		t.Fatal("expected an error for an empty playlist id")
	}
}

func TestBestYoutubeThumbnailPicksByArea(t *testing.T) {
	cases := []struct {
		name  string
		input map[string]youtubeThumbnailWire
		want  string
	}{
		{"maxres is the largest", map[string]youtubeThumbnailWire{
			"default": {URL: "lo", Width: 120, Height: 90},
			"maxres":  {URL: "hi", Width: 1280, Height: 720},
		}, "hi"},
		// maxres is missing for most videos, so the fallback has to be whichever is left.
		{"falls back when maxres is absent", map[string]youtubeThumbnailWire{
			"default": {URL: "lo", Width: 120, Height: 90},
			"high":    {URL: "mid", Width: 480, Height: 360},
		}, "mid"},
		{"a single entry", map[string]youtubeThumbnailWire{"default": {URL: "only", Width: 120, Height: 90}}, "only"},
		{"nothing at all", map[string]youtubeThumbnailWire{}, ""},
		{"an empty url is not an image", map[string]youtubeThumbnailWire{
			"default": {URL: "", Width: 900, Height: 900},
			"high":    {URL: "real", Width: 480, Height: 360},
		}, "real"},
	}

	for _, testCase := range cases {
		if got := bestYoutubeThumbnail(testCase.input); got != testCase.want {
			t.Errorf("%s: got %q, want %q", testCase.name, got, testCase.want)
		}
	}
}

func TestYoutubeDurationsBatchesIds(t *testing.T) {
	// videos.list takes up to 50 ids at a time. Doing it per track would burn quota to build a list
	// that is mostly correct.
	svc := signedInYoutubeService(t)
	var requests int
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		requests++
		parsed, _ := url.Parse(request.URL.String())
		ids := strings.Split(parsed.Query().Get("id"), ",")
		if len(ids) > 50 {
			t.Errorf("batch of %d ids, want at most 50", len(ids))
		}
		var items []string
		for _, id := range ids {
			items = append(items, `{"id":"`+id+`","contentDetails":{"duration":"PT1M"}}`)
		}
		return youtubeResponse(request, http.StatusOK, `{"items":[`+strings.Join(items, ",")+`]}`), nil
	})}

	ids := make([]string, 120)
	for i := range ids {
		ids[i] = "v" + strconv.Itoa(i)
	}
	durations, err := svc.youtubeDurations("token", ids)
	if err != nil {
		t.Fatalf("durations: %v", err)
	}
	if len(durations) != 120 {
		t.Errorf("got %d durations, want 120", len(durations))
	}
	if requests != 3 {
		t.Errorf("made %d requests for 120 ids, want 3 batches of at most 50", requests)
	}
}

// ---- the wire contract

func TestYoutubeRPCMethodNamesAreTheContract(t *testing.T) {
	methods := rpcMethods()
	for _, name := range []string{
		"youtube.auth.exchange",
		"youtube.auth.refresh",
		"youtube.auth.status",
		"youtube.auth.logout",
		"youtube.tracks.mine",
		"youtube.playlists.mine",
		"youtube.playlist.tracks",
		"youtube.track.details",
		"youtube.search.tracks",
		"youtube.user.profile",
	} {
		if _, ok := methods[name]; !ok {
			t.Errorf("RPC method %q is not registered", name)
		}
	}
}

func TestSpotifyMethodNamesSurvivedYouTube(t *testing.T) {
	// The two services sit in the same dispatcher, so adding one must leave the other's names alone.
	methods := rpcMethods()
	for _, name := range []string{
		"spotify.auth.exchange",
		"spotify.tracks.mine",
		"spotify.track.save",
		"spotify.recommendations",
	} {
		if _, ok := methods[name]; !ok {
			t.Errorf("Spotify method %q disappeared", name)
		}
	}
}

func TestServiceTokensAreIndependentFiles(t *testing.T) {
	// Signing out of one must not touch another. They are separate services with separate lifetimes
	// and separate grants, and a shared file would make one logout end two sessions.
	svc := newYoutubeTestService(t)
	svc.spotifyPath = filepath.Join(t.TempDir(), "spotify.json")
	svc.spotifyAuth = spotifyAuthState{AccessToken: "sc-token", RefreshToken: "sc-refresh"}

	if err := svc.saveYoutubeAuth(youtubeAuthState{AccessToken: "yt-token", RefreshToken: "yt-refresh"}); err != nil {
		t.Fatalf("save: %v", err)
	}
	if _, err := svc.RPCYoutubeAuthLogout(emptyParams{}); err != nil {
		t.Fatalf("logout: %v", err)
	}
	if svc.spotifyAuth.AccessToken != "sc-token" {
		t.Errorf("signing out of YouTube cleared the SoundCloud token: %#v", svc.spotifyAuth)
	}
	if _, err := os.Stat(svc.spotifyPath); err != nil && !os.IsNotExist(err) {
		t.Errorf("SoundCloud token file disturbed: %v", err)
	}
}
