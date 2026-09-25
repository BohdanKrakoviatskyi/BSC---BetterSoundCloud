package localapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/url"
	"strconv"
	"strings"
)

type playlistTracksParams struct {
	PlaylistURN string `json:"playlistUrn"`
}
type soundcloudPlaylistCard struct {
	ID           string `json:"id"`
	URN          string `json:"urn"`
	Title        string `json:"title"`
	PermalinkURL string `json:"permalinkUrl"`
	ArtworkURL   string `json:"artworkUrl"`
	TrackCount   int64  `json:"trackCount"`
	User         struct {
		Username string `json:"username"`
	} `json:"user"`
}

type soundcloudPlaylistSource struct {
	ID           int64             `json:"id"`
	URN          string            `json:"urn"`
	Title        string            `json:"title"`
	PermalinkURL string            `json:"permalink_url"`
	ArtworkURL   string            `json:"artwork_url"`
	TrackCount   int64             `json:"track_count"`
	Tracks       []soundcloudTrack `json:"tracks,omitempty"`
	Public       *bool             `json:"public"`
	IsAlbum      bool              `json:"is_album"`
	User         struct {
		Username string `json:"username"`
	} `json:"user"`
}

type soundcloudPlaylistCollectionItem struct {
	soundcloudPlaylistSource
	Playlist *soundcloudPlaylistSource `json:"playlist"`
}

func (s *service) RPCPlaylistsMine(_ emptyParams) ([]soundcloudPlaylistCard, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	userID := s.auth.Profile.ID
	if userID <= 0 {
		return nil, errors.New("SoundCloud не вернул ID аккаунта для загрузки плейлистов")
	}
	var lastErr error
	for _, base := range s.apiBases() {
		paths := []string{fmt.Sprintf("/users/%d/playlists", userID)}
		if base == webAPIBase {
			paths = append([]string{fmt.Sprintf("/users/%d/playlists/liked_and_owned", userID)}, paths...)
		}
		if base == officialAPIBase {
			paths = append([]string{"/me/playlists"}, paths...)
		}
		for _, path := range paths {
			endpoint, err := url.Parse(strings.TrimRight(base, "/") + path)
			if err != nil {
				lastErr = err
				continue
			}
			query := endpoint.Query()
			query.Set("limit", "200")
			query.Set("linked_partitioning", "true")

			query.Set("client_id", s.settings.ClientID)
			endpoint.RawQuery = query.Encode()
			playlists, err := s.fetchPlaylistsFrom(base, endpoint.String())
			if err == nil {
				return playlists, nil
			}
			lastErr = err
			log.Printf("playlists.mine stage=fallback host=%s path=%s error=%q", hostForLog(base), path, err.Error())
		}
	}
	if lastErr == nil {
		lastErr = errors.New("SoundCloud API не вернул список плейлистов")
	}
	return nil, fmt.Errorf("не удалось загрузить плейлисты SoundCloud: %w", lastErr)
}

func (s *service) RPCPlaylistTracks(params playlistTracksParams) ([]soundcloudTrackCard, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	playlistURN := strings.TrimSpace(params.PlaylistURN)
	if playlistURN == "" {
		return nil, errors.New("у плейлиста отсутствует идентификатор SoundCloud")
	}
	playlistID := strings.TrimPrefix(playlistURN, "soundcloud:playlists:")
	if playlistID == playlistURN {
		playlistID = playlistURN
	}
	var lastErr error
	for _, base := range s.apiBases() {
		endpoint, err := url.Parse(strings.TrimRight(base, "/") + "/playlists/" + url.PathEscape(playlistID))
		if err != nil {
			lastErr = err
			continue
		}
		query := endpoint.Query()
		query.Set("representation", "full")
		query.Set("limit", "500")
		query.Set("client_id", s.settings.ClientID)
		endpoint.RawQuery = query.Encode()
		tracks, err := s.fetchPlaylistTracksFrom(base, endpoint.String())
		if err == nil {
			return tracks, nil
		}
		lastErr = err
		log.Printf("playlist.tracks stage=fallback host=%s error=%q", hostForLog(base), err.Error())
	}
	if lastErr == nil {
		lastErr = errors.New("SoundCloud API не вернул треки плейлиста")
	}
	return nil, fmt.Errorf("не удалось загрузить треки плейлиста: %w", lastErr)
}

func (s *service) fetchPlaylistTracksFrom(base, endpoint string) ([]soundcloudTrackCard, error) {
	baseURL, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		return nil, err
	}
	playlistURL, err := url.Parse(endpoint)
	if err != nil || playlistURL.Scheme != baseURL.Scheme || !strings.EqualFold(playlistURL.Host, baseURL.Host) {
		return nil, errors.New("SoundCloud вернул некорректный URL плейлиста")
	}
	query := playlistURL.Query()
	query.Set("client_id", s.settings.ClientID)
	playlistURL.RawQuery = query.Encode()

	var payload struct {
		Collection []soundcloudTrack `json:"collection"`
		Tracks     []soundcloudTrack `json:"tracks"`
	}
	if err := s.getSoundCloudJSONLimit(playlistURL.String(), &payload, 16<<20); err != nil {
		return nil, err
	}
	playlistTracks := payload.Tracks
	if playlistTracks == nil {
		playlistTracks = payload.Collection
	}
	return s.hydratePlaylistTracks(base, playlistTracks)
}

func (s *service) hydratePlaylistTracks(base string, playlistTracks []soundcloudTrack) ([]soundcloudTrackCard, error) {
	trackIDs := make([]int64, 0, len(playlistTracks))
	seenIDs := make(map[int64]struct{}, len(playlistTracks))
	for _, track := range playlistTracks {
		if track.ID <= 0 {
			continue
		}
		if _, seen := seenIDs[track.ID]; seen {
			continue
		}
		seenIDs[track.ID] = struct{}{}
		trackIDs = append(trackIDs, track.ID)
	}

	tracksByID := make(map[int64]soundcloudTrack, len(trackIDs))
	for start := 0; start < len(trackIDs); start += 50 {
		end := min(start+50, len(trackIDs))
		fullTracks, err := s.fetchTracksByIDs(base, trackIDs[start:end])
		if err != nil {
			return nil, fmt.Errorf("не удалось дозагрузить треки плейлиста (пакет %d): %w", start/50+1, err)
		}
		for _, track := range fullTracks {
			if track.ID > 0 && track.Title != "" {
				tracksByID[track.ID] = track
			}
		}
	}

	ordered := make([]soundcloudTrackCard, 0, len(playlistTracks))
	for _, original := range playlistTracks {
		if original.ID <= 0 {
			continue
		}
		track, found := tracksByID[original.ID]
		if !found {
			if strings.TrimSpace(original.Title) == "" {
				continue
			}
			track = original
		}
		if track.Title == "" {
			continue
		}
		trackURN := track.URN
		if trackURN == "" {
			trackURN = fmt.Sprintf("soundcloud:tracks:%d", track.ID)
		}
		artwork := normalizeArtworkURL(track.ArtworkURL)
		card := soundcloudTrackCard{ID: track.ID, TrackURN: trackURN, Title: track.Title, PermalinkURL: track.PermalinkURL, ArtworkURL: artwork, Duration: track.Duration, PlaybackCount: track.PlaybackCount, LikesCount: track.LikesCount}
		card.User.Username = track.User.Username
		ordered = append(ordered, card)
	}
	return ordered, nil
}

func (s *service) fetchTracksByIDs(base string, trackIDs []int64) ([]soundcloudTrack, error) {
	if len(trackIDs) == 0 {
		return []soundcloudTrack{}, nil
	}
	baseURL, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil || baseURL.Host == "" {
		return nil, errors.New("некорректный адрес SoundCloud API")
	}

	endpoint := &url.URL{
		Scheme: baseURL.Scheme,
		Host:   baseURL.Host,
		Path:   strings.TrimRight(baseURL.Path, "/") + "/tracks",
	}
	query := endpoint.Query()
	ids := make([]string, len(trackIDs))
	for index, id := range trackIDs {
		ids[index] = strconv.FormatInt(id, 10)
	}
	query.Set("ids", strings.Join(ids, ","))
	query.Set("client_id", s.settings.ClientID)
	endpoint.RawQuery = query.Encode()

	var response json.RawMessage
	if err := s.getSoundCloudJSONLimit(endpoint.String(), &response, 16<<20); err != nil {
		return nil, err
	}
	trimmed := bytes.TrimSpace(response)
	var tracks []soundcloudTrack
	switch {
	case len(trimmed) > 0 && trimmed[0] == '[':
		if err := json.Unmarshal(trimmed, &tracks); err != nil {
			return nil, fmt.Errorf("не удалось разобрать список треков SoundCloud: %w", err)
		}
	case len(trimmed) > 0 && trimmed[0] == '{':
		var payload struct {
			Collection []soundcloudTrack `json:"collection"`
			Tracks     []soundcloudTrack `json:"tracks"`
		}
		if err := json.Unmarshal(trimmed, &payload); err != nil {
			return nil, fmt.Errorf("не удалось разобрать список треков SoundCloud: %w", err)
		}
		tracks = payload.Collection
		if tracks == nil {
			tracks = payload.Tracks
		}
	default:
		return nil, errors.New("SoundCloud вернул пустой или некорректный список треков")
	}
	return tracks, nil
}

func (s *service) fetchPlaylistsFrom(base, endpoint string) ([]soundcloudPlaylistCard, error) {
	baseURL, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil {
		return nil, err
	}
	playlists := make([]soundcloudPlaylistCard, 0)
	seenPages := make(map[string]bool)
	for page := 0; endpoint != ""; page++ {
		if page >= 100 {
			return nil, errors.New("SoundCloud вернул слишком много страниц плейлистов (лимит 100)")
		}
		parsed, parseErr := url.Parse(endpoint)
		if parseErr != nil || parsed.Scheme != baseURL.Scheme || !strings.EqualFold(parsed.Host, baseURL.Host) {
			return nil, errors.New("SoundCloud вернул некорректную ссылку страницы плейлистов")
		}
		if seenPages[endpoint] {
			return nil, errors.New("SoundCloud вернул повторяющуюся ссылку страницы плейлистов")
		}
		seenPages[endpoint] = true
		query := parsed.Query()
		query.Set("client_id", s.settings.ClientID)
		parsed.RawQuery = query.Encode()
		endpoint = parsed.String()
		var payload struct {
			Collection []soundcloudPlaylistCollectionItem `json:"collection"`
			NextHref   string                             `json:"next_href"`
		}
		if err := s.getSoundCloudJSONLimit(endpoint, &payload, 16<<20); err != nil {
			return nil, err
		}
		for _, item := range payload.Collection {
			source := item.soundcloudPlaylistSource
			if item.Playlist != nil {
				source = *item.Playlist
			}
			playlistURN := source.URN
			if playlistURN == "" && source.ID > 0 {
				playlistURN = fmt.Sprintf("soundcloud:playlists:%d", source.ID)
			}
			playlistID := playlistURN
			if source.ID > 0 {
				playlistID = strconv.FormatInt(source.ID, 10)
			}
			if playlistID == "" || source.Title == "" {
				continue
			}
			artwork := normalizeArtworkURL(source.ArtworkURL)
			if artwork == "" && len(source.Tracks) > 0 {
				artwork = normalizeArtworkURL(source.Tracks[0].ArtworkURL)
			}
			if artwork == "" && source.ID > 0 {
				fallback, fallbackErr := s.fetchFirstPlaylistTrackArtwork(base, source.ID)
				if fallbackErr != nil {
					log.Printf("playlists.mine stage=cover_fallback playlist_id=%d error=%q", source.ID, fallbackErr.Error())
				} else {
					artwork = fallback
				}
			}
			playlist := soundcloudPlaylistCard{ID: playlistID, URN: playlistURN, Title: source.Title, PermalinkURL: source.PermalinkURL, ArtworkURL: artwork, TrackCount: source.TrackCount}
			playlist.User.Username = source.User.Username
			playlists = append(playlists, playlist)
		}
		endpoint = payload.NextHref
	}
	return playlists, nil
}

func normalizeArtworkURL(artwork string) string {
	artwork = strings.Replace(artwork, "-large.", "-t500x500.", 1)
	return strings.Replace(artwork, "/large/", "/t500x500/", 1)
}

func (s *service) fetchFirstPlaylistTrackArtwork(base string, playlistID int64) (string, error) {
	baseURL, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil || baseURL.Host == "" || playlistID <= 0 {
		return "", errors.New("некорректный адрес или ID плейлиста")
	}

	endpoint := &url.URL{
		Scheme: baseURL.Scheme,
		Host:   baseURL.Host,
		Path:   strings.TrimRight(baseURL.Path, "/") + "/playlists/" + strconv.FormatInt(playlistID, 10),
	}
	query := endpoint.Query()
	query.Set("representation", "full")
	query.Set("limit", "5")
	query.Set("client_id", s.settings.ClientID)
	endpoint.RawQuery = query.Encode()

	var payload struct {
		Tracks     []soundcloudTrack `json:"tracks"`
		Collection []soundcloudTrack `json:"collection"`
	}
	if err := s.getSoundCloudJSONLimit(endpoint.String(), &payload, 16<<20); err != nil {
		return "", err
	}
	playlistTracks := payload.Tracks
	if playlistTracks == nil {
		playlistTracks = payload.Collection
	}
	if len(playlistTracks) == 0 {
		return "", nil
	}

	first := playlistTracks[0]
	if artwork := normalizeArtworkURL(first.ArtworkURL); artwork != "" {
		return artwork, nil
	}
	if first.ID <= 0 {
		return "", nil
	}

	tracks, err := s.fetchTracksByIDs(base, []int64{first.ID})
	if err != nil {
		return "", err
	}
	for _, track := range tracks {
		if track.ID == first.ID {
			return normalizeArtworkURL(track.ArtworkURL), nil
		}
	}
	return "", nil
}
