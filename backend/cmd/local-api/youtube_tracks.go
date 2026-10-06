package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// YouTube identifiers are opaque strings, and like Spotify's they are not turned into numbers here.
// Every track carries nativeId and source; the numeric id the domain needs is handed out by the
// frontend's serviceIdentity, which cannot collide.
//
// One thing is named differently on purpose: pagination here is a pageToken, not a next URL. YouTube's
// continuation is an opaque token that only means anything together with the request that produced
// it, so calling it nextHref would be a lie. It is nextPageToken, and the frontend passes it straight
// back.

// youtubeMusicCategoryID is the Data API's Music category. Music videos sit in it, and it is what the
// plan means by "filter: music".
const youtubeMusicCategoryID = "10"

// The API caps a page at 50, and the liked-videos list at 1000 in total regardless of paging.
const (
	youtubePageSize     = 50
	youtubeLikedCeiling = 1000
)

type youtubeThumbnailWire struct {
	URL    string `json:"url"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type youtubeSnippetWire struct {
	Title        string                          `json:"title"`
	ChannelTitle string                          `json:"channelTitle"`
	ChannelID    string                          `json:"channelId"`
	CategoryID   string                          `json:"categoryId"`
	PublishedAt  string                          `json:"publishedAt"`
	Thumbnails   map[string]youtubeThumbnailWire `json:"thumbnails"`
	// A playlist entry's snippet names the video here rather than in a field of its own, and this is
	// the only place its id appears.
	ResourceID struct {
		VideoID string `json:"videoId"`
	} `json:"resourceId"`
}

type youtubeContentDetailsWire struct {
	Duration string `json:"duration"`
}

type youtubeStatisticsWire struct {
	ViewCount string `json:"viewCount"`
}

type youtubeVideoWire struct {
	ID             string                    `json:"id"`
	Snippet        youtubeSnippetWire        `json:"snippet"`
	ContentDetails youtubeContentDetailsWire `json:"contentDetails"`
	Statistics     youtubeStatisticsWire     `json:"statistics"`
}

type youtubePageInfoWire struct {
	TotalResults   int `json:"totalResults"`
	ResultsPerPage int `json:"resultsPerPage"`
}

type youtubeVideoListWire struct {
	Items         []youtubeVideoWire  `json:"items"`
	NextPageToken string              `json:"nextPageToken"`
	PageInfo      youtubePageInfoWire `json:"pageInfo"`
}

type youtubePlaylistSnippetWire struct {
	Title        string                          `json:"title"`
	Description  string                          `json:"description"`
	Thumbnails   map[string]youtubeThumbnailWire `json:"thumbnails"`
	ChannelTitle string                          `json:"channelTitle"`
}

type youtubePlaylistWire struct {
	ID      string                     `json:"id"`
	Snippet youtubePlaylistSnippetWire `json:"snippet"`
}

type youtubePlaylistListWire struct {
	Items         []youtubePlaylistWire `json:"items"`
	NextPageToken string                `json:"nextPageToken"`
}

type youtubePlaylistItemWire struct {
	ID      string             `json:"id"`
	Snippet youtubeSnippetWire `json:"snippet"`
}

type youtubePlaylistItemListWire struct {
	Items         []youtubePlaylistItemWire `json:"items"`
	NextPageToken string                    `json:"nextPageToken"`
}

type youtubeSearchItemWire struct {
	ID      youtubeSearchIdWire `json:"id"`
	Snippet youtubeSnippetWire  `json:"snippet"`
}

type youtubeSearchIdWire struct {
	Kind    string `json:"kind"`
	VideoID string `json:"videoId"`
}

type youtubeSearchListWire struct {
	Items         []youtubeSearchItemWire `json:"items"`
	NextPageToken string                  `json:"nextPageToken"`
}

// ---- internal shapes

type youtubeTrack struct {
	NativeID   string `json:"nativeId"`
	Source     string `json:"source"`
	URN        string `json:"urn"`
	Title      string `json:"title"`
	Permalink  string `json:"permalink,omitempty"`
	ArtworkURL string `json:"artwork_url,omitempty"`
	DurationMs int64  `json:"duration_ms"`
	ViewCount  int64  `json:"view_count,omitempty"`
	CategoryID string `json:"category_id,omitempty"`
	Artist     string `json:"artist"`
	Published  string `json:"published_at,omitempty"`
}

type youtubeTrackPage struct {
	Tracks        []youtubeTrack `json:"tracks"`
	NextPageToken string         `json:"nextPageToken,omitempty"`
	// Set when the liked-videos ceiling has been reached, so the UI can say the list is capped rather
	// than looking like the end of the library.
	Capped bool `json:"capped,omitempty"`
}

type youtubePlaylist struct {
	NativeID    string `json:"nativeId"`
	Source      string `json:"source"`
	URN         string `json:"urn"`
	Title       string `json:"title"`
	Permalink   string `json:"permalink,omitempty"`
	ArtworkURL  string `json:"artwork_url,omitempty"`
	Description string `json:"description,omitempty"`
	TrackCount  int    `json:"trackCount"`
	Artist      string `json:"artist"`
}

type youtubePlaylistPage struct {
	Playlists     []youtubePlaylist `json:"playlists"`
	NextPageToken string            `json:"nextPageToken,omitempty"`
}

type youtubePageParams struct {
	PageToken string `json:"pageToken,omitempty"`
	Limit     int    `json:"limit,omitempty"`
	MusicOnly bool   `json:"musicOnly,omitempty"`
}

type youtubePlaylistTracksParams struct {
	ID        string `json:"id"`
	PageToken string `json:"pageToken,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}

type youtubeSearchParams struct {
	Query     string `json:"query"`
	PageToken string `json:"pageToken,omitempty"`
	Limit     int    `json:"limit,omitempty"`
}

type youtubeIdParams struct {
	ID string `json:"id"`
}

// ---- methods

// RPCYoutubeTracksMine lists the videos the signed-in user has liked.
//
// Liked videos come from videos.list with myRating=like, which needs an authorized request; there is
// no playlist endpoint for them. Two consequences are handled here rather than left to surprise the
// caller. The API caps the result at 1000 no matter how it is paged, so reaching the end is reported
// as capped instead of looking like the whole library. And it returns every liked video, not just
// music, because videos.list has no category filter — the music pass is local, and it is opt-out
// because a liked video miscategorised as music is better shown than hidden.
func (s *service) RPCYoutubeTracksMine(params youtubePageParams) (youtubeTrackPage, error) {
	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubeTrackPage{}, err
	}
	values := url.Values{
		"part":       {"snippet,contentDetails,statistics"},
		"maxResults": {strconv.Itoa(youtubeLimit(params.Limit, youtubePageSize))},
	}
	// The filter only belongs on the first page: it is what selects the list, and YouTube rejects a
	// continuation that repeats it. A continuation carries a pageToken and nothing else of substance.
	if params.PageToken != "" {
		values.Set("pageToken", params.PageToken)
	} else {
		values.Set("myRating", "like")
	}
	endpoint := s.youtubeURL("/videos", values)

	var wire youtubeVideoListWire
	if err := s.youtubeGet(token, endpoint, "понравившиеся видео YouTube", &wire); err != nil {
		return youtubeTrackPage{}, err
	}

	page := youtubeTrackPage{NextPageToken: wire.NextPageToken, Tracks: []youtubeTrack{}}
	for _, item := range wire.Items {
		if params.MusicOnly && !isMusicTrack(item) {
			continue
		}
		page.Tracks = append(page.Tracks, mapYoutubeTrack(item))
	}

	// The API states the total it holds and separately states that only the most recent 1000 can be
	// paged. Reading the total is the only way to tell "that is everything" from "there is more than
	// you can see", and the difference matters: without it a truncated library looks complete.
	page.Capped = wire.PageInfo.TotalResults > youtubeLikedCeiling
	return page, nil
}

// RPCYoutubeSearchTracks searches for music videos.
//
// The search endpoint costs a hundred calls a day, which is the single biggest limit on this service,
// and it does not return durations: a search item carries only an id and a snippet. Durations are
// fetched in one follow-up videos.list for the ids that came back, rather than one call per track.
//
// search.list caps pages at 50 and costs the same whatever maxResults says, so the page size is not
// something to tune.
func (s *service) RPCYoutubeSearchTracks(params youtubeSearchParams) (youtubeTrackPage, error) {
	query := strings.TrimSpace(params.Query)
	if query == "" {
		return youtubeTrackPage{}, errors.New("пустой поисковый запрос YouTube")
	}
	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubeTrackPage{}, err
	}

	values := url.Values{
		"part":            {"snippet"},
		"type":            {"video"},
		"q":               {query},
		"maxResults":      {strconv.Itoa(youtubeLimit(params.Limit, 20))},
		"videoCategoryId": {youtubeMusicCategoryID},
		"videoEmbeddable": {"true"},
	}
	if params.PageToken != "" {
		values.Set("pageToken", params.PageToken)
	}

	var wire youtubeSearchListWire
	if err := s.youtubeGet(token, s.youtubeURL("/search", values), "поиск YouTube", &wire); err != nil {
		return youtubeTrackPage{}, err
	}

	ids := make([]string, 0, len(wire.Items))
	snippets := make(map[string]youtubeSnippetWire, len(wire.Items))
	for _, item := range wire.Items {
		// type=video should make this unnecessary, but the documentation warns that a non-default
		// order can let other kinds through, and a playlist result has no videoId at all.
		if item.ID.Kind != "" && item.ID.Kind != "youtube#video" {
			continue
		}
		if item.ID.VideoID == "" {
			continue
		}
		ids = append(ids, item.ID.VideoID)
		snippets[item.ID.VideoID] = item.Snippet
	}

	page := youtubeTrackPage{NextPageToken: wire.NextPageToken}
	if len(ids) == 0 {
		page.Tracks = []youtubeTrack{}
		return page, nil
	}

	durations, err := s.youtubeDurations(token, ids)
	if err != nil {
		// A search that found results but could not read their lengths is still a useful search. The
		// tracks come back with an unknown duration rather than the whole query failing.
		durations = nil
	}
	for _, id := range ids {
		page.Tracks = append(page.Tracks, mapYoutubeSearchTrack(id, snippets[id], durations[id]))
	}
	return page, nil
}

// RPCYoutubeTrackDetails reads one video.
func (s *service) RPCYoutubeTrackDetails(params youtubeIdParams) (youtubeTrack, error) {
	id := strings.TrimSpace(params.ID)
	if id == "" {
		return youtubeTrack{}, errors.New("не передан id видео YouTube")
	}
	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubeTrack{}, err
	}
	values := url.Values{
		"part": {"snippet,contentDetails,statistics"},
		"id":   {id},
	}
	var wire youtubeVideoListWire
	if err := s.youtubeGet(token, s.youtubeURL("/videos", values), "видео YouTube", &wire); err != nil {
		return youtubeTrack{}, err
	}
	if len(wire.Items) == 0 {
		return youtubeTrack{}, fmt.Errorf("видео YouTube %s не найдено или недоступно", id)
	}
	return mapYoutubeTrack(wire.Items[0]), nil
}

// RPCYoutubePlaylistsMine lists the user's playlists.
func (s *service) RPCYoutubePlaylistsMine(params youtubePageParams) (youtubePlaylistPage, error) {
	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubePlaylistPage{}, err
	}
	values := url.Values{
		"part":       {"snippet"},
		"maxResults": {strconv.Itoa(youtubeLimit(params.Limit, youtubePageSize))},
	}
	if params.PageToken != "" {
		values.Set("pageToken", params.PageToken)
	} else {
		values.Set("mine", "true")
	}
	endpoint := s.youtubeURL("/playlists", values)

	var wire youtubePlaylistListWire
	if err := s.youtubeGet(token, endpoint, "плейлисты YouTube", &wire); err != nil {
		return youtubePlaylistPage{}, err
	}
	page := youtubePlaylistPage{NextPageToken: wire.NextPageToken, Playlists: []youtubePlaylist{}}
	for _, item := range wire.Items {
		page.Playlists = append(page.Playlists, mapYoutubePlaylist(item))
	}
	return page, nil
}

// RPCYoutubePlaylistTracks reads one page of a playlist's items.
//
// playlistItems returns each item with its own snippet, so a duration is present and no follow-up
// call is needed — unlike search, where the same information is not in the response.
func (s *service) RPCYoutubePlaylistTracks(params youtubePlaylistTracksParams) (youtubeTrackPage, error) {
	id := strings.TrimSpace(params.ID)
	if id == "" {
		return youtubeTrackPage{}, errors.New("не передан id плейлиста YouTube")
	}
	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubeTrackPage{}, err
	}
	values := url.Values{
		"part":       {"snippet"},
		"playlistId": {id},
		"maxResults": {strconv.Itoa(youtubeLimit(params.Limit, youtubePageSize))},
	}
	if params.PageToken != "" {
		values.Set("pageToken", params.PageToken)
	}

	var wire youtubePlaylistItemListWire
	if err := s.youtubeGet(token, s.youtubeURL("/playlistItems", values), "треки плейлиста YouTube", &wire); err != nil {
		return youtubeTrackPage{}, err
	}

	page := youtubeTrackPage{NextPageToken: wire.NextPageToken, Tracks: []youtubeTrack{}}
	for _, item := range wire.Items {
		page.Tracks = append(page.Tracks, mapYoutubePlaylistItem(item))
	}
	return page, nil
}

// RPCYoutubeUserProfile returns the signed-in Google account.
func (s *service) RPCYoutubeUserProfile(_ emptyParams) (youtubeAuthProfile, error) {
	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubeAuthProfile{}, err
	}
	profile, err := s.youtubeUserInfo(token)
	if err != nil {
		return youtubeAuthProfile{}, err
	}
	return youtubeAuthProfile{
		ID:      profile.ID,
		Email:   profile.Email,
		Name:    profile.Name,
		Picture: profile.Picture,
	}, nil
}

// ---- helpers

func (s *service) youtubeAccessToken() (string, error) {
	token := strings.TrimSpace(s.youtubeAuth.AccessToken)
	if token == "" {
		return "", errors.New("YouTube Music не авторизован")
	}
	if s.youtubeAuth.ExpiresAt > 0 && time.Now().UnixMilli() >= s.youtubeAuth.ExpiresAt {
		// Unlike Spotify, this one is recoverable without the user: Google's refresh grant needs only
		// the refresh token, which is stored. So the caller is told to refresh rather than to sign in.
		return "", errors.New("срок действия токена YouTube истёк, нужен refresh")
	}
	return token, nil
}

func (s *service) youtubeGet(token, endpoint, what string, target any) error {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("не удалось сформировать запрос %s: %w", what, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	body, err := s.youtubeJSON(req, what)
	if err != nil {
		return err
	}
	if err := body.decode(target); err != nil {
		return fmt.Errorf("не удалось разобрать ответ %s: %w", what, err)
	}
	return nil
}

// youtubeDurations reads the lengths of several videos in one call.
//
// videos.list takes up to 50 comma-separated ids, and doing it per track would burn quota to build a
// list that is mostly correct.
func (s *service) youtubeDurations(token string, ids []string) (map[string]int64, error) {
	durations := make(map[string]int64, len(ids))
	for start := 0; start < len(ids); start += youtubePageSize {
		end := start + youtubePageSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[start:end]
		values := url.Values{
			"part": {"contentDetails"},
			"id":   {strings.Join(batch, ",")},
		}
		var wire youtubeVideoListWire
		if err := s.youtubeGet(token, s.youtubeURL("/videos", values), "длительности YouTube", &wire); err != nil {
			return durations, err
		}
		for _, item := range wire.Items {
			if ms, ok := parseISO8601Duration(item.ContentDetails.Duration); ok {
				durations[item.ID] = ms
			}
		}
	}
	return durations, nil
}

func (s *service) youtubeURL(path string, values url.Values) string {
	base := s.youtubeAPIBase
	if base == "" {
		base = youtubeDefaultAPIBase
	}
	endpoint := strings.TrimRight(base, "/") + path
	if len(values) > 0 {
		endpoint += "?" + values.Encode()
	}
	return endpoint
}

func isMusicTrack(wire youtubeVideoWire) bool {
	return wire.Snippet.CategoryID == youtubeMusicCategoryID
}

func mapYoutubeTrack(wire youtubeVideoWire) youtubeTrack {
	track := youtubeTrack{
		NativeID:   wire.ID,
		Source:     "youtube-music",
		Title:      wire.Snippet.Title,
		ArtworkURL: bestYoutubeThumbnail(wire.Snippet.Thumbnails),
		DurationMs: 0,
		CategoryID: wire.Snippet.CategoryID,
		Artist:     wire.Snippet.ChannelTitle,
		Published:  wire.Snippet.PublishedAt,
		ViewCount:  parseInt64(wire.Statistics.ViewCount),
	}
	if ms, ok := parseISO8601Duration(wire.ContentDetails.Duration); ok {
		track.DurationMs = ms
	}
	if wire.ID != "" {
		track.URN = "youtube:video:" + wire.ID
		track.Permalink = "https://www.youtube.com/watch?v=" + wire.ID
	}
	return track
}

func mapYoutubeSearchTrack(id string, snippet youtubeSnippetWire, durationMs int64) youtubeTrack {
	track := youtubeTrack{
		NativeID:   id,
		Source:     "youtube-music",
		Title:      snippet.Title,
		ArtworkURL: bestYoutubeThumbnail(snippet.Thumbnails),
		DurationMs: durationMs,
		CategoryID: snippet.CategoryID,
		Artist:     snippet.ChannelTitle,
		Published:  snippet.PublishedAt,
	}
	if id != "" {
		track.URN = "youtube:video:" + id
		track.Permalink = "https://www.youtube.com/watch?v=" + id
	}
	return track
}

func mapYoutubePlaylistItem(wire youtubePlaylistItemWire) youtubeTrack {
	track := youtubeTrack{
		Source:     "youtube-music",
		Title:      wire.Snippet.Title,
		ArtworkURL: bestYoutubeThumbnail(wire.Snippet.Thumbnails),
		CategoryID: wire.Snippet.CategoryID,
		Artist:     wire.Snippet.ChannelTitle,
		Published:  wire.Snippet.PublishedAt,
	}
	// The video id lives under resourceId, so this is the only place a playlist entry can be given
	// one. Reading the wrong field yields an empty id, which would make every entry in a playlist look
	// like the same track.
	if id := strings.TrimSpace(wire.Snippet.ResourceID.VideoID); id != "" {
		track.NativeID = id
		track.URN = "youtube:video:" + id
		track.Permalink = "https://www.youtube.com/watch?v=" + id
	}
	return track
}

func mapYoutubePlaylist(wire youtubePlaylistWire) youtubePlaylist {
	playlist := youtubePlaylist{
		NativeID:    wire.ID,
		Source:      "youtube-music",
		Title:       wire.Snippet.Title,
		Description: wire.Snippet.Description,
		ArtworkURL:  bestYoutubeThumbnail(wire.Snippet.Thumbnails),
		Artist:      wire.Snippet.ChannelTitle,
	}
	if wire.ID != "" {
		playlist.URN = "youtube:playlist:" + wire.ID
		playlist.Permalink = "https://www.youtube.com/playlist?list=" + wire.ID
	}
	return playlist
}

// bestYoutubeThumbnail picks the largest available image.
//
// The map is keyed by name — default, medium, high, standard, maxres — and maxres is absent for most
// videos, so the largest present one is chosen by pixel area rather than by guessing a key order.
func bestYoutubeThumbnail(thumbnails map[string]youtubeThumbnailWire) string {
	best := ""
	bestArea := -1
	for _, thumbnail := range thumbnails {
		if thumbnail.URL == "" {
			continue
		}
		area := thumbnail.Width * thumbnail.Height
		if area > bestArea {
			best = thumbnail.URL
			bestArea = area
		}
	}
	return best
}

func youtubeLimit(requested, fallback int) int {
	if requested <= 0 {
		return fallback
	}
	if requested > youtubePageSize {
		return youtubePageSize
	}
	return requested
}

func parseInt64(value string) int64 {
	if value == "" {
		return 0
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

// parseISO8601Duration converts YouTube's duration into milliseconds.
//
// The format is P[nD]T[nH][nM][nS]. Unparseable input returns false rather than zero-as-fact: a live
// stream reports PT0S and a malformed one reports nothing useful, and the caller decides what to do.
// A duration of zero with ok true means the API really did say PT0S.
func parseISO8601Duration(value string) (int64, bool) {
	raw := strings.TrimSpace(value)
	if raw == "" || !strings.HasPrefix(raw, "P") {
		return 0, false
	}

	// The date and time parts are separated by T, and only the time part has H, M and S. Everything
	// after T is matched as a sequence of number+unit pairs rather than by fixed position, because
	// YouTube omits the hours when there are none and the days are never present in practice.
	//
	// A duration may also be date-only, with no T at all, which is valid and must not be thrown away.
	timeIndex := strings.Index(raw, "T")
	var datePart, timePart string
	switch {
	case timeIndex < 0:
		// Date-only, such as P1D.
		datePart = raw[1:]
	default:
		datePart = raw[1:timeIndex]
		timePart = raw[timeIndex+1:]
	}

	// "P" or "PT" with nothing in it says nothing at all. Reporting it as a zero would claim the API
	// described an empty track, which is a different statement from failing to understand it.
	if datePart == "" && timePart == "" {
		return 0, false
	}

	var total int64
	if datePart != "" {
		days, ok := readDurationUnit(datePart, 'D')
		if !ok {
			// Present but not understood, which is different from absent.
			return 0, false
		}
		total += days * 24 * 60 * 60 * 1000
		if strings.Trim(strings.TrimSuffix(datePart, "D"), "0123456789") != "" {
			return 0, false
		}
	}

	remaining := timePart
	for _, unit := range []struct {
		suffix byte
		size   int64
	}{
		{'H', 60 * 60 * 1000},
		{'M', 60 * 1000},
		{'S', 1000},
	} {
		value, rest, ok := readDurationPair(remaining, unit.suffix)
		if !ok {
			continue
		}
		total += value * unit.size
		remaining = rest
	}

	if remaining != "" {
		return 0, false
	}
	return total, true
}

// readDurationPair pulls a number followed by suffix off the front of value.
func readDurationPair(value string, suffix byte) (int64, string, bool) {
	position := strings.IndexByte(value, suffix)
	if position <= 0 {
		return 0, value, false
	}
	digits := value[:position]
	// ISO 8601 allows a fractional part; YouTube does not send one, and truncating is the sane reading
	// of a value that is not there rather than a reason to throw the whole duration away.
	if dot := strings.IndexByte(digits, '.'); dot >= 0 {
		digits = digits[:dot]
	}
	number, err := strconv.ParseInt(digits, 10, 64)
	if err != nil || number < 0 {
		return 0, value, false
	}
	return number, value[position+1:], true
}

func readDurationUnit(value string, suffix byte) (int64, bool) {
	number, _, ok := readDurationPair(value, suffix)
	return number, ok
}
