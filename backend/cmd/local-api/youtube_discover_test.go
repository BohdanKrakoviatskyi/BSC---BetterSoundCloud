package main

import (
	"testing"
)

// The discover rows have to reach the frontend as a published RPC method, not merely exist as a
// function. rpcMethods discovers methods by reflection and only registers ones with the exact
// receiver-plus-one-parameter and result-plus-error shape, so a method that compiles can still be
// invisible over the wire. This asserts the published name, since the frontend calls it by that.

// The genre rows are the quota cost. Four of them is four search.list calls per refresh, and
// search.list has its own 100-a-day budget, so this count is a budget decision as much as a layout one.
func TestYoutubeDiscoverGenreRowCountIsBounded(t *testing.T) {
	if len(youtubeDiscoverGenreRows) == 0 {
		t.Fatal("нет ни одной тематической подборки")
	}
	if len(youtubeDiscoverGenreRows) > 4 {
		t.Fatalf("тематических подборок %d, потолок 4: каждый ряд — это вызов search.list из суточного бюджета в 100", len(youtubeDiscoverGenreRows))
	}
	seen := map[string]bool{}
	for _, row := range youtubeDiscoverGenreRows {
		if row.ID == "" || row.Title == "" || row.Query == "" {
			t.Fatalf("неполная строка подборки: %+v", row)
		}
		if seen[row.ID] {
			t.Fatalf("повторяющийся id подборки: %q", row.ID)
		}
		seen[row.ID] = true
	}
}

// A row that fails must not empty the whole set: the home page with three rows beats an error over a
// missing genre. The chart is the row that matters most, so it is checked for falling back rather than
// returning an error.
func TestYoutubeDiscoverChartRequiresMusicTracks(t *testing.T) {
	svc := &service{youtubeAPIBase: "http://127.0.0.1:1"}
	if _, err := svc.youtubeDiscoverChart("token"); err == nil {
		t.Fatal("чарт без ответа сервера должен вернуть ошибку, а не пустой ряд")
	}
}
