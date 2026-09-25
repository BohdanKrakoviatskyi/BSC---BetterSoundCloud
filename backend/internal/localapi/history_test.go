package localapi

import (
	"encoding/json"
	"path/filepath"
	"testing"
)

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
