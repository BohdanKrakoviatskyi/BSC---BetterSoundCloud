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

// Spotify identifiers are opaque strings. This file deliberately does not turn them into numbers:
// the domain Track still has a numeric id that a great deal of code keys on, and a hash would
// collide, which would mean liking the wrong track and playing the wrong queue entry. So every
// track carries nativeId and source, and identity is compared on that pair rather than on a
// synthesised integer. Sorting that out in the UI is step 1.5, where the comparison helpers live.

type spotifyArtist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type spotifyAlbum struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Images []spotifyImage `json:"images"`
}

type spotifyImage struct {
	URL string `json:"url"`
	// Spotify sizes images by width; the largest one is the one worth showing.
	Width int `json:"width"`
}

type spotifyTrack struct {
	NativeID   string          `json:"nativeId"`
	Source     string          `json:"source"`
	URN        string          `json:"urn"`
	Title      string          `json:"title"`
	Permalink  string          `json:"permalink,omitempty"`
	ArtworkURL string          `json:"artwork_url,omitempty"`
	DurationMs int64           `json:"duration_ms"`
	Popularity int             `json:"popularity,omitempty"`
	PreviewURL string          `json:"preview_url,omitempty"`
	Artists    []spotifyArtist `json:"artists"`
	Album      spotifyAlbum    `json:"album"`
}

// spotifyTrackPage mirrors the pagination shape the rest of the backend already uses: the next page
// arrives as an opaque href to hand straight back.
type spotifyTrackPage struct {
	Tracks   []spotifyTrack `json:"tracks"`
	NextHref string         `json:"nextHref,omitempty"`
}

type spotifyPlaylist struct {
	NativeID   string         `json:"nativeId"`
	Source     string         `json:"source"`
	URN        string         `json:"urn"`
	Title      string         `json:"title"`
	Permalink  string         `json:"permalink,omitempty"`
	ArtworkURL string         `json:"artwork_url,omitempty"`
	TrackCount int            `json:"trackCount"`
	Artist     string         `json:"artist"`
	Tracks     []spotifyTrack `json:"tracks,omitempty"`
}

type spotifyPlaylistPage struct {
	Playlists []spotifyPlaylist `json:"playlists"`
	NextHref  string            `json:"nextHref,omitempty"`
}

type spotifySearchParams struct {
	Query string `json:"query"`
	Limit int    `json:"limit,omitempty"`
}

type spotifyPageParams struct {
	Next  string `json:"next,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

type spotifyIdParams struct {
	ID string `json:"id"`
}

type spotifyRecommendParams struct {
	SeedTrackIDs []string `json:"seedTrackIds"`
	SeedArtists  []string `json:"seedArtists"`
	Limit        int      `json:"limit,omitempty"`
}

// The wire shapes Spotify actually returns. Kept separate from the internal one above so the two can
// move independently, and so a missing field does not silently become a zero we then report as fact.
type spotifyTrackWire struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	URI          string            `json:"uri"`
	DurationMs   int64             `json:"duration_ms"`
	Popularity   int               `json:"popularity"`
	PreviewURL   string            `json:"preview_url"`
	ExternalURLs map[string]string `json:"external_urls"`
	Artists      []spotifyArtist   `json:"artists"`
	Album        spotifyAlbum      `json:"album"`
}

type spotifySavedTrackWire struct {
	Track spotifyTrackWire `json:"track"`
}

type spotifyPlaylistWire struct {
	ID           string                `json:"id"`
	Name         string                `json:"name"`
	URI          string                `json:"uri"`
	Images       []spotifyImage        `json:"images"`
	Tracks       spotifyTracksPageWire `json:"tracks"`
	ExternalURLs map[string]string     `json:"external_urls"`
	Owner        struct {
		DisplayName string `json:"display_name"`
	} `json:"owner"`
}

type spotifyTracksPageWire struct {
	Items []struct {
		Track *spotifyTrackWire `json:"track"`
	} `json:"items"`
	Next  string `json:"next"`
	Total int    `json:"total"`
}

type spotifyPlainTracksPageWire struct {
	Items []spotifyTrackWire `json:"items"`
	Next  string             `json:"next"`
	Total int                `json:"total"`
}

type spotifySearchWire struct {
	Tracks struct {
		Items []spotifyTrackWire `json:"items"`
		Next  string             `json:"next"`
		Total int                `json:"total"`
	} `json:"tracks"`
}

type spotifyPlaylistsWire struct {
	Items []spotifyPlaylistWire `json:"items"`
	Next  string                `json:"next"`
	Total int                   `json:"total"`
}

const spotifyPageSize = 50

// RPCSpotifyTracksMine lists the signed-in user's saved tracks.
func (s *service) RPCSpotifyTracksMine(params spotifyPageParams) (spotifyTrackPage, error) {
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyTrackPage{}, err
	}
	endpoint := params.Next
	if endpoint == "" {
		endpoint = s.spotifyURL("/v1/me/tracks", url.Values{
			"limit":  {strconv.Itoa(spotifyLimit(params.Limit, spotifyPageSize))},
			"offset": {"0"},
		})
	}
	var wire spotifyTracksPageWire
	if err := s.spotifyGet(token, endpoint, "сохранённые треки Spotify", &wire); err != nil {
		return spotifyTrackPage{}, err
	}

	page := spotifyTrackPage{Tracks: make([]spotifyTrack, 0, len(wire.Items)), NextHref: wire.Next}
	for _, item := range wire.Items {
		if item.Track == nil {
			continue
		}
		page.Tracks = append(page.Tracks, mapSpotifyTrack(*item.Track))
	}
	return page, nil
}

// RPCSpotifySearchTracks searches the Spotify catalogue.
func (s *service) RPCSpotifySearchTracks(params spotifySearchParams) (spotifyTrackPage, error) {
	query := strings.TrimSpace(params.Query)
	if query == "" {
		return spotifyTrackPage{}, errors.New("пустой поисковый запрос Spotify")
	}
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyTrackPage{}, err
	}
	endpoint := s.spotifyURL("/v1/search", url.Values{
		"type":  {"track"},
		"q":     {query},
		"limit": {strconv.Itoa(spotifyLimit(params.Limit, 20))},
	})
	var wire spotifySearchWire
	if err := s.spotifyGet(token, endpoint, "поиск Spotify", &wire); err != nil {
		return spotifyTrackPage{}, err
	}

	page := spotifyTrackPage{Tracks: make([]spotifyTrack, 0, len(wire.Tracks.Items)), NextHref: wire.Tracks.Next}
	for _, item := range wire.Tracks.Items {
		page.Tracks = append(page.Tracks, mapSpotifyTrack(item))
	}
	return page, nil
}

// RPCSpotifyTrackDetails reads one track.
func (s *service) RPCSpotifyTrackDetails(params spotifyIdParams) (spotifyTrack, error) {
	id := strings.TrimSpace(params.ID)
	if id == "" {
		return spotifyTrack{}, errors.New("не передан id трека Spotify")
	}
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyTrack{}, err
	}
	var wire spotifyTrackWire
	endpoint := s.spotifyURL("/v1/tracks/"+url.PathEscape(id), nil)
	if err := s.spotifyGet(token, endpoint, "трек Spotify", &wire); err != nil {
		return spotifyTrack{}, err
	}
	return mapSpotifyTrack(wire), nil
}

// RPCSpotifyPlaylistsMine lists the user's playlists.
func (s *service) RPCSpotifyPlaylistsMine(params spotifyPageParams) (spotifyPlaylistPage, error) {
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyPlaylistPage{}, err
	}
	endpoint := params.Next
	if endpoint == "" {
		endpoint = s.spotifyURL("/v1/me/playlists", url.Values{
			"limit":  {strconv.Itoa(spotifyLimit(params.Limit, spotifyPageSize))},
			"offset": {"0"},
		})
	}
	var wire spotifyPlaylistsWire
	if err := s.spotifyGet(token, endpoint, "плейлисты Spotify", &wire); err != nil {
		return spotifyPlaylistPage{}, err
	}
	page := spotifyPlaylistPage{Playlists: make([]spotifyPlaylist, 0, len(wire.Items)), NextHref: wire.Next}
	for _, item := range wire.Items {
		page.Playlists = append(page.Playlists, mapSpotifyPlaylist(item))
	}
	return page, nil
}

// RPCSpotifyPlaylistTracks reads one page of a playlist's tracks.
func (s *service) RPCSpotifyPlaylistTracks(params spotifyPlaylistTracksParams) (spotifyTrackPage, error) {
	id := strings.TrimSpace(params.ID)
	if id == "" {
		return spotifyTrackPage{}, errors.New("не передан id плейлиста Spotify")
	}
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyTrackPage{}, err
	}
	endpoint := params.Next
	if endpoint == "" {
		endpoint = s.spotifyURL("/v1/playlists/"+url.PathEscape(id)+"/tracks", url.Values{
			"limit": {strconv.Itoa(spotifyLimit(params.Limit, spotifyPageSize))},
		})
	}
	var wire spotifyPlainTracksPageWire
	if err := s.spotifyGet(token, endpoint, "треки плейлиста Spotify", &wire); err != nil {
		return spotifyTrackPage{}, err
	}
	page := spotifyTrackPage{Tracks: make([]spotifyTrack, 0, len(wire.Items)), NextHref: wire.Next}
	for _, item := range wire.Items {
		page.Tracks = append(page.Tracks, mapSpotifyTrack(item))
	}
	return page, nil
}

type spotifyPlaylistTracksParams struct {
	ID    string `json:"id"`
	Next  string `json:"next,omitempty"`
	Limit int    `json:"limit,omitempty"`
}

// RPCSpotifyTrackSave adds a track to the user's library.
func (s *service) RPCSpotifyTrackSave(params spotifyIdParams) (spotifyIdResult, error) {
	return s.spotifyLibraryWrite(http.MethodPut, params.ID)
}

// RPCSpotifyTrackUnsave removes a track from the user's library.
func (s *service) RPCSpotifyTrackUnsave(params spotifyIdParams) (spotifyIdResult, error) {
	return s.spotifyLibraryWrite(http.MethodDelete, params.ID)
}

type spotifyIdResult struct {
	ID    string `json:"id"`
	Saved bool   `json:"saved"`
}

func (s *service) spotifyLibraryWrite(method, id string) (spotifyIdResult, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return spotifyIdResult{}, errors.New("не передан id трека Spotify")
	}
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyIdResult{}, err
	}
	// Spotify takes ids as query parameters, and returns 204 on success with no body.
	endpoint := s.spotifyURL("/v1/me/tracks", url.Values{"ids": {id}})
	req, err := http.NewRequest(method, endpoint, nil)
	if err != nil {
		return spotifyIdResult{}, fmt.Errorf("не удалось сформировать запрос Spotify: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if _, err := s.spotifyJSON(req, "библиотека Spotify"); err != nil {
		return spotifyIdResult{}, err
	}
	return spotifyIdResult{ID: id, Saved: method == http.MethodPut}, nil
}

// RPCSpotifyRecommendations reads recommendations seeded by tracks or artists.
//
// Spotify requires at least one seed, and it will not accept a seed the caller has no access to, so
// an empty request is refused here rather than turned into a confusing 400 from the API.
func (s *service) RPCSpotifyRecommendations(params spotifyRecommendParams) (spotifyTrackPage, error) {
	seeds := make([]string, 0, len(params.SeedTrackIDs))
	for _, id := range params.SeedTrackIDs {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			seeds = append(seeds, trimmed)
		}
	}
	artists := make([]string, 0, len(params.SeedArtists))
	for _, id := range params.SeedArtists {
		if trimmed := strings.TrimSpace(id); trimmed != "" {
			artists = append(artists, trimmed)
		}
	}
	if len(seeds) == 0 && len(artists) == 0 {
		return spotifyTrackPage{}, errors.New("для рекомендаций Spotify нужен хотя бы один seed")
	}

	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyTrackPage{}, err
	}
	values := url.Values{
		"limit": {strconv.Itoa(spotifyLimit(params.Limit, 20))},
	}
	if len(seeds) > 0 {
		values.Set("seed_tracks", strings.Join(seeds, ","))
	}
	if len(artists) > 0 {
		values.Set("seed_artists", strings.Join(artists, ","))
	}
	var wire spotifySearchWire
	if err := s.spotifyGet(token, s.spotifyURL("/v1/recommendations", values), "рекомендации Spotify", &wire); err != nil {
		return spotifyTrackPage{}, err
	}
	page := spotifyTrackPage{Tracks: make([]spotifyTrack, 0, len(wire.Tracks.Items)), NextHref: wire.Tracks.Next}
	for _, item := range wire.Tracks.Items {
		page.Tracks = append(page.Tracks, mapSpotifyTrack(item))
	}
	return page, nil
}

// RPCSpotifyUserProfile returns the signed-in user.
func (s *service) RPCSpotifyUserProfile(_ emptyParams) (spotifyAuthProfile, error) {
	token, err := s.spotifyAccessToken()
	if err != nil {
		return spotifyAuthProfile{}, err
	}
	profile, err := s.spotifyMe(token)
	if err != nil {
		return spotifyAuthProfile{}, err
	}
	return spotifyAuthProfile{
		ID:          profile.ID,
		DisplayName: profile.DisplayName,
		Email:       profile.Email,
		Product:     profile.Product,
	}, nil
}

// ---- helpers

// spotifyAccessToken reports the stored token, refusing early once it has expired. A 401 from the
// API says nothing about what to do next; an expired token does.
func (s *service) spotifyAccessToken() (string, error) {
	token := strings.TrimSpace(s.spotifyAuth.AccessToken)
	if token == "" {
		return "", errors.New("Spotify не авторизован")
	}
	if s.spotifyAuth.ExpiresAt > 0 && time.Now().UnixMilli() >= s.spotifyAuth.ExpiresAt {
		return "", errors.New("срок действия токена Spotify истёк, нужен повторный вход")
	}
	return token, nil
}

func (s *service) spotifyGet(token, endpoint, what string, target any) error {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("не удалось сформировать запрос %s: %w", what, err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	body, err := s.spotifyJSON(req, what)
	if err != nil {
		return err
	}
	if err := body.decode(target); err != nil {
		return fmt.Errorf("не удалось разобрать ответ %s: %w", what, err)
	}
	return nil
}

func (s *service) spotifyURL(path string, values url.Values) string {
	base := s.spotifyAPIBase
	if base == "" {
		base = spotifyDefaultAPIBase
	}
	endpoint := strings.TrimRight(base, "/") + path
	if len(values) > 0 {
		endpoint += "?" + values.Encode()
	}
	return endpoint
}

func mapSpotifyTrack(wire spotifyTrackWire) spotifyTrack {
	track := spotifyTrack{
		NativeID:   wire.ID,
		Source:     "spotify",
		Title:      wire.Name,
		DurationMs: wire.DurationMs,
		Popularity: wire.Popularity,
		PreviewURL: wire.PreviewURL,
		Artists:    wire.Artists,
		Album:      wire.Album,
	}
	if wire.URI != "" {
		track.URN = wire.URI
	} else if wire.ID != "" {
		track.URN = "spotify:track:" + wire.ID
	}
	if link := wire.ExternalURLs["spotify"]; link != "" {
		track.Permalink = link
	}
	// Spotify orders album images smallest first, but do not rely on it: pick the widest present.
	best := spotifyImage{}
	for _, image := range wire.Album.Images {
		if image.URL == "" {
			continue
		}
		if best.URL == "" || image.Width > best.Width {
			best = image
		}
	}
	track.ArtworkURL = best.URL
	return track
}

func mapSpotifyPlaylist(wire spotifyPlaylistWire) spotifyPlaylist {
	playlist := spotifyPlaylist{
		NativeID:   wire.ID,
		Source:     "spotify",
		Title:      wire.Name,
		TrackCount: wire.Tracks.Total,
		Artist:     wire.Owner.DisplayName,
	}
	if wire.URI != "" {
		playlist.URN = wire.URI
	} else if wire.ID != "" {
		playlist.URN = "spotify:playlist:" + wire.ID
	}
	if link := wire.ExternalURLs["spotify"]; link != "" {
		playlist.Permalink = link
	}
	best := spotifyImage{}
	for _, image := range wire.Images {
		if image.URL == "" {
			continue
		}
		if best.URL == "" || image.Width > best.Width {
			best = image
		}
	}
	playlist.ArtworkURL = best.URL
	return playlist
}

func spotifyLimit(requested, fallback int) int {
	if requested <= 0 {
		return fallback
	}
	// Spotify rejects a limit above 50 for these endpoints, and the error it returns is opaque.
	if requested > spotifyPageSize {
		return spotifyPageSize
	}
	return requested
}
