package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Discover rows for the home page on YouTube Music.
//
// YouTube has no equivalent of SoundCloud's /mixed-selections: the Data API has no endpoint that
// recommends anything to a particular person. What it does have is charts and search, so a row here is
// either the regional music chart or a themed search. Neither is personal, and pretending otherwise
// would be a lie the section heading already avoids — the rows are named for what they are.
//
// Quota is the reason this is built the way it is. Per Google's quota table, videos.list costs one
// unit out of the shared 10,000 a day, while search.list draws from a separate bucket of 100 calls a
// day. Four themed rows on every launch would spend that bucket in 25 launches. So the whole set is
// written to disk and reused for youtubeDiscoverTTL, which turns the cost into four calls every six
// hours rather than four per launch. The chart row is cheap and is always refetched with the set, so
// there is no reason to special-case it.

// youtubeDiscoverRegion is the chart's region. The API has no notion of the user's own country from
// this scope, so it is a constant rather than a guess at a profile field that does not exist here.
const youtubeDiscoverRegion = "RU"

// youtubeDiscoverTTL is how long a cached set is served before it is refetched.
const youtubeDiscoverTTL = 6 * time.Hour

// youtubeDiscoverRowSize is how many tracks each row carries. A carousel is full well before this,
// and a longer row costs the same quota as a short one.
const youtubeDiscoverRowSize = 20

// youtubeDiscoverTopicID is the Data API's Music topic. Combined with videoCategoryId it narrows a
// search to music videos, which is what keeps a themed row from filling up with song-less uploads.
const youtubeDiscoverTopicID = "10"

// youtubeDiscoverGenreRow is one themed row. The query is what the user reads as the row's meaning, so
// it is written as a phrase a person would type rather than as a tag.
type youtubeDiscoverGenreRow struct {
	ID    string
	Title string
	Query string
}

// The themed rows. Four is a deliberate ceiling, not a taste call: each one is a search.list call, and
// the daily bucket is 100. Six rows would halve how long a set lasts before it has to be refetched.
var youtubeDiscoverGenreRows = []youtubeDiscoverGenreRow{
	{ID: "ru", Title: "Русский рэп", Query: "русский рэп трек"},
	{ID: "rock", Title: "Рок", Query: "рок музыка"},
	{ID: "pop", Title: "Поп", Query: "поп хиты"},
	{ID: "electronic", Title: "Электроника", Query: "electronic music"},
}

// youtubeTrackCollection mirrors the frontend's TrackCollection, which is the same shape SoundCloud's
// mixed selections arrive in. MadeForYou is left false everywhere here on purpose: nothing YouTube
// returns is personal, and the section uses that flag to decide what it may claim about itself.
type youtubeTrackCollection struct {
	ID          string         `json:"id"`
	Title       string         `json:"title"`
	Description string         `json:"description,omitempty"`
	Tracks      []youtubeTrack `json:"tracks"`
	MadeForYou  bool           `json:"madeForYou,omitempty"`
}

type youtubeDiscoverCache struct {
	FetchedAt time.Time                `json:"fetchedAt"`
	Rows      []youtubeTrackCollection `json:"rows"`
}

// RPCYoutubeDiscover builds the home page rows for YouTube Music.
//
// Cached on disk. A failure inside one row is contained: that row comes back empty and the others
// still load, because a home page with three rows is worth more than an error page over one missing
// genre.
func (s *service) RPCYoutubeDiscover(_ emptyParams) ([]youtubeTrackCollection, error) {
	if cached, ok := s.youtubeDiscoverFromCache(); ok {
		return cached, nil
	}

	token, err := s.youtubeAccessToken()
	if err != nil {
		return nil, err
	}

	rows := make([]youtubeTrackCollection, 0, len(youtubeDiscoverGenreRows)+1)

	if chart, err := s.youtubeDiscoverChart(token); err != nil {
		log.Printf("youtube.discover stage=chart_failed error=%q", err.Error())
	} else {
		rows = append(rows, chart)
	}

	for _, genre := range youtubeDiscoverGenreRows {
		row, err := s.youtubeDiscoverGenre(token, genre)
		if err != nil {
			log.Printf("youtube.discover stage=genre_failed id=%q error=%q", genre.ID, err.Error())
			continue
		}
		rows = append(rows, row)
	}

	if len(rows) == 0 {
		return nil, errors.New("YouTube не вернул ни одной подборки")
	}

	s.youtubeDiscoverWriteCache(rows)
	return rows, nil
}

// youtubeDiscoverChart is the regional music chart. videos.list with chart=mostPopular is the only
// part of this that does not draw on the 100-a-day search bucket.
func (s *service) youtubeDiscoverChart(token string) (youtubeTrackCollection, error) {
	values := url.Values{
		"part":            {"snippet,contentDetails,statistics"},
		"chart":           {"mostPopular"},
		"videoCategoryId": {youtubeMusicCategoryID},
		"regionCode":      {youtubeDiscoverRegion},
		"maxResults":      {strconv.Itoa(youtubeDiscoverRowSize)},
	}

	var wire youtubeVideoListWire
	if err := s.youtubeGet(token, s.youtubeURL("/videos", values), "музыкальный чарт YouTube", &wire); err != nil {
		return youtubeTrackCollection{}, err
	}

	tracks := make([]youtubeTrack, 0, len(wire.Items))
	for _, item := range wire.Items {
		// The chart is requested for the Music category, but the category filter is a preference on the
		// request rather than a guarantee, and a chart row full of vlogs would be worse than none.
		if !isMusicTrack(item) {
			continue
		}
		tracks = append(tracks, mapYoutubeTrack(item))
	}
	if len(tracks) == 0 {
		return youtubeTrackCollection{}, errors.New("музыкальный чарт YouTube пуст")
	}

	return youtubeTrackCollection{
		ID:          "chart",
		Title:       "Популярное",
		Description: "Музыкальный чарт YouTube, " + youtubeDiscoverRegion,
		Tracks:      tracks,
	}, nil
}

// youtubeDiscoverGenre is one themed row. Ordered by view count so the row is recognisable as a
// selection rather than the first thing the search engine felt like returning.
func (s *service) youtubeDiscoverGenre(token string, genre youtubeDiscoverGenreRow) (youtubeTrackCollection, error) {
	values := url.Values{
		"part":            {"snippet"},
		"type":            {"video"},
		"q":               {genre.Query},
		"order":           {"viewCount"},
		"videoCategoryId": {youtubeMusicCategoryID},
		"topicId":         {youtubeDiscoverTopicID},
		"videoEmbeddable": {"true"},
		"maxResults":      {strconv.Itoa(youtubeDiscoverRowSize)},
	}

	var wire youtubeSearchListWire
	if err := s.youtubeGet(token, s.youtubeURL("/search", values), "подборка YouTube", &wire); err != nil {
		return youtubeTrackCollection{}, err
	}

	ids := make([]string, 0, len(wire.Items))
	snippets := make(map[string]youtubeSnippetWire, len(wire.Items))
	for _, item := range wire.Items {
		if item.ID.Kind != "" && item.ID.Kind != "youtube#video" {
			continue
		}
		if item.ID.VideoID == "" {
			continue
		}
		ids = append(ids, item.ID.VideoID)
		snippets[item.ID.VideoID] = item.Snippet
	}
	if len(ids) == 0 {
		return youtubeTrackCollection{}, errors.New("подборка YouTube пуста")
	}

	// One videos.list for the whole row's durations rather than one per track. Missing lengths leave
	// the durations unknown, which the player already handles, so a failure here is not fatal.
	metas, err := s.youtubeVideoMeta(token, ids)
	if err != nil {
		log.Printf("youtube.discover stage=durations_failed id=%q error=%q", genre.ID, err.Error())
		metas = nil
	}

	tracks := make([]youtubeTrack, 0, len(ids))
	for _, id := range ids {
		tracks = append(tracks, mapYoutubeSearchTrack(id, snippets[id], metas[id].DurationMs))
	}

	return youtubeTrackCollection{
		ID:          "genre:" + genre.ID,
		Title:       genre.Title,
		Description: "Подборка YouTube Music: " + genre.Title,
		Tracks:      tracks,
	}, nil
}

// ---- cache

// youtubeDiscoverFromCache serves a set younger than the TTL. A missing file, an unreadable one or a
// malformed one all read as a miss rather than an error: a corrupt cache should cost a refetch, not
// break the home page.
func (s *service) youtubeDiscoverFromCache() ([]youtubeTrackCollection, bool) {
	if s.youtubeDiscoverPath == "" {
		return nil, false
	}
	data, err := os.ReadFile(s.youtubeDiscoverPath)
	if err != nil {
		return nil, false
	}
	var cache youtubeDiscoverCache
	if err := json.Unmarshal(data, &cache); err != nil {
		log.Printf("youtube.discover stage=cache_unreadable error=%q", err.Error())
		return nil, false
	}
	if len(cache.Rows) == 0 {
		return nil, false
	}
	age := time.Since(cache.FetchedAt)
	if age < 0 || age > youtubeDiscoverTTL {
		return nil, false
	}
	log.Printf("youtube.discover stage=cache_hit age=%s rows=%d", age.Round(time.Minute), len(cache.Rows))
	return cache.Rows, true
}

func (s *service) youtubeDiscoverWriteCache(rows []youtubeTrackCollection) {
	if s.youtubeDiscoverPath == "" {
		return
	}
	payload, err := json.Marshal(youtubeDiscoverCache{FetchedAt: time.Now(), Rows: rows})
	if err != nil {
		log.Printf("youtube.discover stage=cache_write_failed error=%q", err.Error())
		return
	}
	if err := os.WriteFile(s.youtubeDiscoverPath, payload, 0o600); err != nil {
		log.Printf("youtube.discover stage=cache_write_failed error=%q", err.Error())
	}
}

// youtubeDiscoverClearCache drops the stored set. Called when the YouTube session ends, so the next
// sign-in does not show rows that were fetched with the previous account's quota.
func (s *service) youtubeDiscoverClearCache() {
	if s.youtubeDiscoverPath == "" {
		return
	}
	if err := os.Remove(s.youtubeDiscoverPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("youtube.discover stage=cache_clear_failed error=%q", err.Error())
	}
}

var _ = strings.TrimSpace
