package main

import "testing"

func TestParseYtDlpSearchResultsMapsEntriesToPlayableTracks(t *testing.T) {
	results, err := parseYtDlpSearchResults([]byte(`{
		"_type":"playlist",
		"entries":[
			{"id":"cswfR85D7jM","title":"Love Me Not","channel":"Ravyn Lenae","duration":219,"thumbnail":"https://i.ytimg.com/vi/cswfR85D7jM/hqdefault.jpg"},
			{"id":"NB7WuqWzDhw","title":"Lyrics","uploader":"R&BHype","duration":214}
		]
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("got %d results, want 2", len(results))
	}
	if results[0].NativeID != "cswfR85D7jM" || results[0].Artist != "Ravyn Lenae" || results[0].DurationMs != 219000 {
		t.Fatalf("unexpected first result: %#v", results[0])
	}
	if results[1].Artist != "R&BHype" || results[1].ArtworkURL == "" {
		t.Fatalf("missing uploader or fallback thumbnail: %#v", results[1])
	}
}

func TestYtDlpAudioURLRequiresHTTPSGoogleVideoHost(t *testing.T) {
	if !validYtDlpAudioURL("https://rr2---sn.googlevideo.com/videoplayback?sig=secret") {
		t.Fatal("expected googlevideo URL to be allowed")
	}
	for _, value := range []string{
		"http://rr2---sn.googlevideo.com/videoplayback",
		"https://example.com/audio",
		"https://googlevideo.com.evil.example/audio",
	} {
		if validYtDlpAudioURL(value) {
			t.Errorf("unexpectedly accepted URL %q", value)
		}
	}
}

func TestYtDlpVideoIDValidation(t *testing.T) {
	if !validYouTubeVideoID("cswfR85D7jM") {
		t.Fatal("expected valid video id")
	}
	for _, value := range []string{"", "bad", "https://example.com", "cswfR85D7jM?x=1"} {
		if validYouTubeVideoID(value) {
			t.Errorf("unexpectedly accepted video id %q", value)
		}
	}
}
