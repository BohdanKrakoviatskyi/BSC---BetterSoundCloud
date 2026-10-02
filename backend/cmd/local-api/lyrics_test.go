package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func lyricsJSONResponse(request *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}
}

func TestTrackLyricsCanonicalizesReuploadAndPreservesLRC(t *testing.T) {
	deezerPayload := `{"data":[{"title":"Pixelated Kisses","duration":210,"artist":{"name":"Joji"}}]}`
	lrcPayload := `{"trackName":"PIXELATED KISSES","artistName":"Joji","duration":210.0,"syncedLyrics":"[00:01.1]first line\n[00:02.01][00:03.001]second line"}`
	svc := newTestService(t, "")
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		switch {
		case request.URL.Host == "api.deezer.com":
			return lyricsJSONResponse(request, http.StatusOK, deezerPayload), nil
		case request.URL.Host == "lrclib.net" && request.URL.Path == "/api/get":
			if request.URL.Query().Get("artist_name") != "Joji" {
				t.Errorf("LRCLIB canonical artist = %q, want Joji", request.URL.Query().Get("artist_name"))
			}
			return lyricsJSONResponse(request, http.StatusOK, lrcPayload), nil
		default:
			t.Errorf("unexpected lyrics request: %s", request.URL)
			return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
		}
	})}

	result, err := svc.RPCTrackLyrics(trackLyricsParams{
		TrackID: 9, Title: "PIXELATED KISSES - JOJI [SLIGHTLY 0.5x SLOWED + BASS BOOSTED]", Artist: "Pure_Editz", DurationMs: 120_000,
	})
	if err != nil {
		t.Fatalf("RPCTrackLyrics: %v", err)
	}
	if !result.IsSynced || len(result.Lines) != 3 {
		t.Fatalf("expected 3 synchronized lyric lines, got %#v", result)
	}
	if result.Lines[0].StartMs != 1100 || result.Lines[1].StartMs != 2010 || result.Lines[2].StartMs != 3001 {
		t.Fatalf("LRC timestamps were not preserved: %#v", result.Lines)
	}
}

func TestTrackLyricsRejectsWrongShortTitleCandidate(t *testing.T) {
	var getArtist string
	svc := newTestService(t, "")
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "api.deezer.com" {
			return lyricsJSONResponse(request, http.StatusOK, `{"data":[
				{"title":"Crush","duration":190,"artist":{"name":"Ben Mazue"}},
				{"title":"Crush","duration":146,"artist":{"name":"2hollis"}}
			]}`), nil
		}
		if request.URL.Host == "lrclib.net" && request.URL.Path == "/api/get" {
			getArtist = request.URL.Query().Get("artist_name")
			return lyricsJSONResponse(request, http.StatusOK, `{"trackName":"Crush","artistName":"2hollis","syncedLyrics":"[00:01.00]right track"}`), nil
		}
		t.Errorf("unexpected request: %s", request.URL)
		return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	result, err := svc.RPCTrackLyrics(trackLyricsParams{TrackID: 10, Title: "Crush", Artist: "2hollis"})
	if err != nil {
		t.Fatalf("RPCTrackLyrics: %v", err)
	}
	if getArtist != "2hollis" || !result.IsSynced || len(result.Lines) != 1 || result.Lines[0].Text != "right track" {
		t.Fatalf("wrong short-title candidate was selected: artist=%q result=%#v", getArtist, result)
	}
}

func TestTrackLyricsFallsBackToPlainLRCLibText(t *testing.T) {
	svc := newTestService(t, "")
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "api.deezer.com" {
			return lyricsJSONResponse(request, http.StatusOK, `{"data":[]}`), nil
		}
		if request.URL.Host == "lrclib.net" && request.URL.Path == "/api/search" {
			query := request.URL.Query()
			if query.Get("track_name") == "Unique Song Title" && query.Get("artist_name") == "Real Artist" {
				return lyricsJSONResponse(request, http.StatusOK, `[{"trackName":"Unique Song Title","artistName":"Real Artist","duration":146.0,"plainLyrics":"first\n\nsecond"}]`), nil
			}
			return lyricsJSONResponse(request, http.StatusOK, `[]`), nil
		}
		t.Errorf("unexpected request: %s", request.URL)
		return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	result, err := svc.RPCTrackLyrics(trackLyricsParams{TrackID: 11, Title: "Unique Song Title", Artist: "Real Artist"})
	if err != nil {
		t.Fatalf("RPCTrackLyrics: %v", err)
	}
	// Plain text has no timestamps, so they are synthesised and the result is reported as
	// synced; the sidebar follows playback off these. Duration 146.0 puts the intro gap at 14600ms
	// and the step at 65700ms, giving 14600 and 80300.
	if !result.IsSynced || len(result.Lines) != 2 || result.Lines[0].Text != "first" || result.Lines[1].Text != "second" {
		t.Fatalf("plain lyric fallback failed: %#v", result)
	}
	if result.Lines[0].StartMs != 14600 || result.Lines[1].StartMs != 80300 {
		t.Fatalf("synthetic timings are wrong: got %d and %d, want 14600 and 80300", result.Lines[0].StartMs, result.Lines[1].StartMs)
	}
}

func TestTrackLyricsReportsProviderMissesInResponse(t *testing.T) {
	svc := newTestService(t, "")
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		if request.URL.Host == "api.deezer.com" {
			return lyricsJSONResponse(request, http.StatusOK, `{"data":[]}`), nil
		}
		if request.URL.Host == "lrclib.net" && request.URL.Path == "/api/search" {
			return lyricsJSONResponse(request, http.StatusOK, `[]`), nil
		}
		return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	result, err := svc.RPCTrackLyrics(trackLyricsParams{TrackID: 12, Title: "No Such Song", Artist: "Unknown Artist"})
	if err != nil {
		t.Fatalf("RPCTrackLyrics: %v", err)
	}
	if len(result.Lines) != 0 || len(result.Logs) == 0 {
		t.Fatalf("expected a miss with diagnostic logs, got %#v", result)
	}
	if !strings.Contains(strings.Join(result.Logs, "\n"), "Текст не найден") {
		t.Fatalf("miss reason is absent from logs: %#v", result.Logs)
	}
}

// A repeated lookup for the same track must not touch the network again. The existing tests each
// call RPCTrackLyrics once on a fresh service, so they pass whether the cache works or not.
func TestTrackLyricsServesRepeatedLookupsFromCache(t *testing.T) {
	svc := newTestService(t, "")
	requests := 0
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Host == "api.deezer.com" {
			return lyricsJSONResponse(request, http.StatusOK, `{"data":[]}`), nil
		}
		if request.URL.Host == "lrclib.net" && request.URL.Path == "/api/search" {
			query := request.URL.Query()
			if query.Get("track_name") == "Cached Song" && query.Get("artist_name") == "Cache Artist" {
				return lyricsJSONResponse(request, http.StatusOK, `[{"trackName":"Cached Song","artistName":"Cache Artist","duration":146.0,"plainLyrics":"one\n\ntwo"}]`), nil
			}
			return lyricsJSONResponse(request, http.StatusOK, `[]`), nil
		}
		t.Errorf("unexpected request: %s", request.URL)
		return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	params := trackLyricsParams{TrackID: 21, Title: "Cached Song", Artist: "Cache Artist"}
	first, err := svc.RPCTrackLyrics(params)
	if err != nil {
		t.Fatalf("first RPCTrackLyrics: %v", err)
	}
	if len(first.Lines) != 2 {
		t.Fatalf("expected the plain text to be returned, got %#v", first)
	}
	afterFirst := requests
	if afterFirst == 0 {
		t.Fatal("the first lookup made no request at all, so the fixture proves nothing")
	}

	second, err := svc.RPCTrackLyrics(params)
	if err != nil {
		t.Fatalf("second RPCTrackLyrics: %v", err)
	}
	if requests != afterFirst {
		t.Fatalf("second lookup made %d more requests, want 0", requests-afterFirst)
	}
	if len(second.Lines) != 2 || second.Lines[0].Text != first.Lines[0].Text || second.Lines[1].Text != first.Lines[1].Text {
		t.Fatalf("cached lines differ from the first response: %#v", second.Lines)
	}
	if second.Lines[0].StartMs != first.Lines[0].StartMs || second.Lines[1].StartMs != first.Lines[1].StartMs {
		t.Fatalf("cached timings were lost: %#v", second.Lines)
	}
}

// A cached miss must expire. Otherwise a track whose text was missing, or whose first lookup failed
// while reporting a miss, stays empty for the rest of the session with nothing to retry it.
func TestTrackLyricsRetriesAMissAfterItExpires(t *testing.T) {
	svc := newTestService(t, "")
	requests := 0
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Host == "api.deezer.com" {
			return lyricsJSONResponse(request, http.StatusOK, `{"data":[]}`), nil
		}
		if request.URL.Host == "lrclib.net" {
			return lyricsJSONResponse(request, http.StatusOK, `[]`), nil
		}
		t.Errorf("unexpected request: %s", request.URL)
		return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	params := trackLyricsParams{TrackID: 31, Title: "Never Found", Artist: "Nobody"}
	first, err := svc.RPCTrackLyrics(params)
	if err != nil {
		t.Fatalf("first RPCTrackLyrics: %v", err)
	}
	if len(first.Lines) != 0 {
		t.Fatalf("expected a miss, got %#v", first.Lines)
	}
	afterFirst := requests

	// Still inside the window: the miss is served without another request.
	if _, err := svc.RPCTrackLyrics(params); err != nil {
		t.Fatalf("cached RPCTrackLyrics: %v", err)
	}
	if requests != afterFirst {
		t.Fatalf("a fresh miss was not served from cache: %d extra requests", requests-afterFirst)
	}

	// Move the entry past the five minute window.
	svc.lyricsMu.Lock()
	entry, ok := svc.lyricsCache[params.TrackID]
	if !ok {
		svc.lyricsMu.Unlock()
		t.Fatal("the miss was not cached at all")
	}
	entry.cachedAt = time.Now().Add(-6 * time.Minute)
	svc.lyricsCache[params.TrackID] = entry
	svc.lyricsMu.Unlock()

	if _, err := svc.RPCTrackLyrics(params); err != nil {
		t.Fatalf("RPCTrackLyrics after expiry: %v", err)
	}
	if requests == afterFirst {
		t.Fatal("an expired miss was served from cache; it must be looked up again")
	}
}

// Found lyrics have no expiry, so ageing the entry must not change anything.
func TestTrackLyricsKeepsFoundLyricsForTheSession(t *testing.T) {
	svc := newTestService(t, "")
	requests := 0
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		requests++
		if request.URL.Host == "api.deezer.com" {
			return lyricsJSONResponse(request, http.StatusOK, `{"data":[]}`), nil
		}
		if request.URL.Host == "lrclib.net" && request.URL.Path == "/api/search" {
			query := request.URL.Query()
			if query.Get("track_name") == "Sticky Song" && query.Get("artist_name") == "Sticky Artist" {
				return lyricsJSONResponse(request, http.StatusOK, `[{"trackName":"Sticky Song","artistName":"Sticky Artist","duration":146.0,"plainLyrics":"one\n\ntwo"}]`), nil
			}
			return lyricsJSONResponse(request, http.StatusOK, `[]`), nil
		}
		t.Errorf("unexpected request: %s", request.URL)
		return lyricsJSONResponse(request, http.StatusNotFound, `{}`), nil
	})}

	params := trackLyricsParams{TrackID: 32, Title: "Sticky Song", Artist: "Sticky Artist"}
	if _, err := svc.RPCTrackLyrics(params); err != nil {
		t.Fatalf("first RPCTrackLyrics: %v", err)
	}
	afterFirst := requests

	svc.lyricsMu.Lock()
	entry, ok := svc.lyricsCache[params.TrackID]
	if !ok {
		svc.lyricsMu.Unlock()
		t.Fatal("the result was not cached")
	}
	// Far past any TTL: a track with text must survive it.
	entry.cachedAt = time.Now().Add(-24 * time.Hour)
	svc.lyricsCache[params.TrackID] = entry
	svc.lyricsMu.Unlock()

	result, err := svc.RPCTrackLyrics(params)
	if err != nil {
		t.Fatalf("aged RPCTrackLyrics: %v", err)
	}
	if requests != afterFirst {
		t.Fatalf("found lyrics were looked up again: %d extra requests", requests-afterFirst)
	}
	if len(result.Lines) != 2 {
		t.Fatalf("aged lookup returned no lyrics: %#v", result)
	}
}
