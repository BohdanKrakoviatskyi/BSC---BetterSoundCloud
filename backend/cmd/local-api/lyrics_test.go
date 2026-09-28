package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
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
	if result.IsSynced || len(result.Lines) != 2 || result.Lines[0].Text != "first" || result.Lines[1].Text != "second" {
		t.Fatalf("plain lyric fallback failed: %#v", result)
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
