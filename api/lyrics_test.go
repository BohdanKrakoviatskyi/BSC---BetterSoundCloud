package main

import (
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestScoreLRCLibMatchesReuploadByExactTitleAndDuration(t *testing.T) {
	query := lyricsQuery{Title: "Love Me Not", Artist: "Маргарита Попова", Duration: 206}
	candidate := lrclibRecord{TrackName: "Love Me Not", ArtistName: "Ravyn Lenae", Duration: 203, SyncedLyrics: "[00:00]Line"}

	if _, ok := scoreLRCLibRecord(query, candidate, true); !ok {
		t.Fatal("expected an exact title and close duration to match despite a different uploader artist")
	}
}

func TestFindLyricsByVariantsFallsBackToTitleWithoutUploaderArtist(t *testing.T) {
	sawTitleOnly := false
	svc := &service{httpClient: &http.Client{Transport: lyricsRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		artist := request.URL.Query().Get("artist_name")
		if artist == "" {
			sawTitleOnly = true
			return lyricsResponse(`[{"trackName":"Love Me Not","artistName":"Ravyn Lenae","duration":203,"syncedLyrics":"[00:00.00]Line one\n[00:04.00]Line two"}]`), nil
		}
		return lyricsResponse(`[]`), nil
	})}}
	var logs []string
	lyrics, found := svc.findLyricsByVariants(trackLyricsParams{TrackID: 7, Title: "Love Me Not", Artist: "Маргарита Попова", DurationMs: 206000}, &logs)

	if !sawTitleOnly || !found || len(lyrics.Lines) != 2 {
		t.Fatalf("expected title-only lyrics match, got sawTitleOnly=%t found=%t lines=%d", sawTitleOnly, found, len(lyrics.Lines))
	}
}

type lyricsRoundTripFunc func(*http.Request) (*http.Response, error)

func (f lyricsRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func lyricsResponse(body string) *http.Response {
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func TestScoreLRCLibStillRejectsUnrelatedDurationForShortTitle(t *testing.T) {
	query := lyricsQuery{Title: "Love Me Not", Artist: "unknown uploader", Duration: 206}
	candidate := lrclibRecord{TrackName: "Love Me Not", ArtistName: "Unknown Artist", Duration: 90, SyncedLyrics: "[00:00]Line"}

	if _, ok := scoreLRCLibRecord(query, candidate, true); ok {
		t.Fatal("expected a same-title candidate with a substantially different duration to be rejected")
	}
}
