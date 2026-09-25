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
	"time"
)

type trackDetailsParams struct {
	TrackID int64 `json:"trackId"`
}
type searchTracksParams struct {
	Query string `json:"query"`
}

type relatedTracksParams struct {
	TrackID int64 `json:"trackId"`
}

type mixedSelection struct {
	ID          string                  `json:"id"`
	Title       string                  `json:"title"`
	Description string                  `json:"description,omitempty"`
	Tracks      []soundcloudSearchTrack `json:"tracks"`
}

type soundcloudSearchTrack struct {
	ID           int64  `json:"id"`
	URN          string `json:"urn"`
	Title        string `json:"title"`
	PermalinkURL string `json:"permalinkUrl"`
	ArtworkURL   string `json:"artworkUrl"`
	Duration     int64  `json:"duration"`
	User         struct {
		Username  string `json:"username"`
		AvatarURL string `json:"avatarUrl"`
	} `json:"user"`
}

type soundcloudSearchTrackSource struct {
	ID           int64  `json:"id"`
	URN          string `json:"urn"`
	Title        string `json:"title"`
	PermalinkURL string `json:"permalink_url"`
	ArtworkURL   string `json:"artwork_url"`
	Duration     int64  `json:"duration"`
	User         struct {
		Username  string `json:"username"`
		AvatarURL string `json:"avatar_url"`
	} `json:"user"`
}

type soundcloudTrackDetails struct {
	ID            int64  `json:"id"`
	URN           string `json:"urn"`
	Title         string `json:"title"`
	PermalinkURL  string `json:"permalinkUrl"`
	ArtworkURL    string `json:"artworkUrl"`
	Description   string `json:"description"`
	Genre         string `json:"genre"`
	TagList       string `json:"tagList"`
	Duration      int64  `json:"duration"`
	PlaybackCount int64  `json:"playbackCount"`
	LikesCount    int64  `json:"likesCount"`
	RepostsCount  int64  `json:"repostsCount"`
	CommentCount  int64  `json:"commentCount"`
	CreatedAt     string `json:"createdAt"`
	DisplayDate   string `json:"displayDate"`
	WaveformURL   string `json:"waveformUrl"`
	User          struct {
		Username       string `json:"username"`
		AvatarURL      string `json:"avatarUrl"`
		PermalinkURL   string `json:"permalinkUrl"`
		FollowersCount int64  `json:"followersCount"`
	} `json:"user"`
}

func (s *service) RPCTrackDetails(params trackDetailsParams) (soundcloudTrackDetails, error) {
	if s.auth.Token == "" {
		return soundcloudTrackDetails{}, errors.New("сначала подключите аккаунт SoundCloud")
	}
	if params.TrackID <= 0 {
		return soundcloudTrackDetails{}, errors.New("некорректный ID трека")
	}
	startedAt := time.Now()
	endpoint, err := s.soundcloudV2URL("/tracks/"+strconv.FormatInt(params.TrackID, 10), nil)
	if err != nil {
		return soundcloudTrackDetails{}, fmt.Errorf("не удалось сформировать запрос деталей трека: %w", err)
	}
	var track struct {
		ID            int64  `json:"id"`
		URN           string `json:"urn"`
		Title         string `json:"title"`
		PermalinkURL  string `json:"permalink_url"`
		ArtworkURL    string `json:"artwork_url"`
		Description   string `json:"description"`
		Genre         string `json:"genre"`
		TagList       string `json:"tag_list"`
		Duration      int64  `json:"duration"`
		PlaybackCount int64  `json:"playback_count"`
		LikesCount    int64  `json:"likes_count"`
		RepostsCount  int64  `json:"reposts_count"`
		CommentCount  int64  `json:"comment_count"`
		CreatedAt     string `json:"created_at"`
		DisplayDate   string `json:"display_date"`
		WaveformURL   string `json:"waveform_url"`
		User          struct {
			Username       string `json:"username"`
			AvatarURL      string `json:"avatar_url"`
			PermalinkURL   string `json:"permalink_url"`
			FollowersCount int64  `json:"followers_count"`
		} `json:"user"`
	}
	log.Printf("track.details stage=request track_id=%d", params.TrackID)
	if err := s.getSoundCloudJSON(endpoint, &track); err != nil {
		log.Printf("track.details stage=failed track_id=%d elapsed_ms=%d error=%q", params.TrackID, time.Since(startedAt).Milliseconds(), err.Error())
		return soundcloudTrackDetails{}, fmt.Errorf("не удалось загрузить информацию о треке из SoundCloud: %w", err)
	}
	artwork := track.ArtworkURL
	if artwork != "" {
		artwork = strings.Replace(artwork, "-large.", "-t500x500.", 1)
		artwork = strings.Replace(artwork, "/large/", "/t500x500/", 1)
	}
	result := soundcloudTrackDetails{
		ID: track.ID, URN: track.URN, Title: track.Title, PermalinkURL: track.PermalinkURL,
		ArtworkURL: artwork, Description: track.Description, Genre: track.Genre, TagList: track.TagList,
		Duration: track.Duration, PlaybackCount: track.PlaybackCount, LikesCount: track.LikesCount,
		RepostsCount: track.RepostsCount, CommentCount: track.CommentCount, CreatedAt: track.CreatedAt,
		DisplayDate: track.DisplayDate, WaveformURL: track.WaveformURL,
	}
	result.User.Username = track.User.Username
	result.User.AvatarURL = track.User.AvatarURL
	result.User.PermalinkURL = track.User.PermalinkURL
	result.User.FollowersCount = track.User.FollowersCount
	log.Printf("track.details stage=complete track_id=%d elapsed_ms=%d", params.TrackID, time.Since(startedAt).Milliseconds())
	return result, nil
}

func (s *service) RPCSearchTracks(params searchTracksParams) ([]soundcloudSearchTrack, error) {
	query := strings.TrimSpace(params.Query)
	if query == "" {
		return []soundcloudSearchTrack{}, nil
	}
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	values := url.Values{}
	values.Set("q", query)
	values.Set("limit", "5")
	endpoint, err := s.soundcloudV2URL("/search/tracks", values)
	if err != nil {
		return nil, fmt.Errorf("не удалось сформировать запрос поиска: %w", err)
	}
	var response struct {
		Collection []struct {
			ID           int64  `json:"id"`
			URN          string `json:"urn"`
			Title        string `json:"title"`
			PermalinkURL string `json:"permalink_url"`
			ArtworkURL   string `json:"artwork_url"`
			Duration     int64  `json:"duration"`
			User         struct {
				Username  string `json:"username"`
				AvatarURL string `json:"avatar_url"`
			} `json:"user"`
		} `json:"collection"`
	}
	startedAt := time.Now()
	log.Printf("tracks.search stage=request query=%q limit=5", query)
	if err := s.getSoundCloudJSON(endpoint, &response); err != nil {
		log.Printf("tracks.search stage=failed elapsed_ms=%d error=%q", time.Since(startedAt).Milliseconds(), err.Error())
		return nil, fmt.Errorf("поиск SoundCloud не выполнен: %w", err)
	}
	results := make([]soundcloudSearchTrack, 0, len(response.Collection))
	for _, item := range response.Collection {
		artwork := item.ArtworkURL
		if artwork == "" {
			artwork = item.User.AvatarURL
		}
		if artwork != "" {
			artwork = strings.Replace(artwork, "-large.", "-t300x300.", 1)
		}
		trackURN := item.URN
		if trackURN == "" {
			trackURN = fmt.Sprintf("soundcloud:tracks:%d", item.ID)
		}
		result := soundcloudSearchTrack{ID: item.ID, URN: trackURN, Title: item.Title, PermalinkURL: item.PermalinkURL, ArtworkURL: artwork, Duration: item.Duration}
		result.User.Username = item.User.Username
		result.User.AvatarURL = item.User.AvatarURL
		results = append(results, result)
	}
	log.Printf("tracks.search stage=complete count=%d elapsed_ms=%d", len(results), time.Since(startedAt).Milliseconds())
	return results, nil
}

func (s *service) RPCTrackRelated(params relatedTracksParams) ([]soundcloudSearchTrack, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	if params.TrackID <= 0 {
		return nil, errors.New("некорректный ID трека")
	}
	query := url.Values{}
	query.Set("limit", "10")
	endpoint, err := s.soundcloudV2URL("/tracks/"+strconv.FormatInt(params.TrackID, 10)+"/related", query)
	if err != nil {
		return nil, fmt.Errorf("не удалось сформировать запрос похожих треков: %w", err)
	}
	var response struct {
		Collection []struct {
			ID           int64  `json:"id"`
			URN          string `json:"urn"`
			Title        string `json:"title"`
			PermalinkURL string `json:"permalink_url"`
			ArtworkURL   string `json:"artwork_url"`
			Duration     int64  `json:"duration"`
			User         struct {
				Username  string `json:"username"`
				AvatarURL string `json:"avatar_url"`
			} `json:"user"`
		} `json:"collection"`
	}
	startedAt := time.Now()
	log.Printf("track.related stage=request track_id=%d limit=10", params.TrackID)
	if err := s.getSoundCloudJSON(endpoint, &response); err != nil {
		log.Printf("track.related stage=failed track_id=%d elapsed_ms=%d error=%q", params.TrackID, time.Since(startedAt).Milliseconds(), err.Error())
		return nil, fmt.Errorf("не удалось загрузить похожие треки: %w", err)
	}
	results := make([]soundcloudSearchTrack, 0, len(response.Collection))
	for _, item := range response.Collection {
		track := normalizeSearchTrack(item.ID, item.URN, item.Title, item.PermalinkURL, item.ArtworkURL, item.User.AvatarURL, item.Duration, item.User.Username)
		results = append(results, track)
	}
	log.Printf("track.related stage=complete track_id=%d count=%d elapsed_ms=%d", params.TrackID, len(results), time.Since(startedAt).Milliseconds())
	return results, nil
}

func (s *service) RPCMixedSelections(_ emptyParams) ([]mixedSelection, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	endpoint, err := s.soundcloudV2URL("/mixed-selections", nil)
	if err != nil {
		return nil, fmt.Errorf("не удалось сформировать запрос подборок: %w", err)
	}
	var response struct {
		Collection []struct {
			ID          string          `json:"id"`
			Title       string          `json:"title"`
			Description string          `json:"description"`
			Items       json.RawMessage `json:"items"`
		} `json:"collection"`
	}
	startedAt := time.Now()
	log.Printf("mixed-selections stage=request")
	if err := s.getSoundCloudJSON(endpoint, &response); err != nil {
		log.Printf("mixed-selections stage=failed elapsed_ms=%d error=%q", time.Since(startedAt).Milliseconds(), err.Error())
		return nil, fmt.Errorf("не удалось загрузить подборки SoundCloud: %w", err)
	}
	selections := make([]mixedSelection, 0, len(response.Collection))
	for index, item := range response.Collection {
		itemPayloads := mixedSelectionItemPayloads(item.Items)
		selection := mixedSelection{ID: item.ID, Title: item.Title, Description: item.Description, Tracks: make([]soundcloudSearchTrack, 0, len(itemPayloads))}
		seenTrackIDs := make(map[int64]struct{}, len(itemPayloads))
		if selection.ID == "" {
			selection.ID = fmt.Sprintf("selection-%d", index)
		}
		for _, raw := range itemPayloads {
			candidate, ok := decodeMixedSelectionTrack(raw)
			if !ok {
				continue
			}
			if _, exists := seenTrackIDs[candidate.ID]; exists {
				continue
			}
			seenTrackIDs[candidate.ID] = struct{}{}
			selection.Tracks = append(selection.Tracks, normalizeSearchTrack(candidate.ID, candidate.URN, candidate.Title, candidate.PermalinkURL, candidate.ArtworkURL, candidate.User.AvatarURL, candidate.Duration, candidate.User.Username))
		}
		if selection.Title != "" && len(selection.Tracks) > 0 {
			selections = append(selections, selection)
		}
	}
	log.Printf("mixed-selections stage=complete count=%d elapsed_ms=%d", len(selections), time.Since(startedAt).Milliseconds())
	return selections, nil
}

func mixedSelectionItemPayloads(raw json.RawMessage) []json.RawMessage {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil
	}
	if trimmed[0] == '[' {
		var items []json.RawMessage
		if json.Unmarshal(trimmed, &items) == nil {
			return items
		}
		return nil
	}
	if trimmed[0] != '{' {
		return nil
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(trimmed, &object) != nil {
		return nil
	}
	for _, key := range []string{"collection", "items", "tracks", "data"} {
		if nested, ok := object[key]; ok {
			if items := mixedSelectionItemPayloads(nested); len(items) > 0 {
				return items
			}
		}
	}
	return nil
}

func decodeMixedSelectionTrack(raw json.RawMessage) (soundcloudSearchTrackSource, bool) {
	var source soundcloudSearchTrackSource
	if json.Unmarshal(raw, &source) == nil && source.ID > 0 && source.Title != "" {
		return source, true
	}
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil {
		return soundcloudSearchTrackSource{}, false
	}
	for _, key := range []string{"track", "item", "resource", "data"} {
		if nested, ok := object[key]; ok {
			if source, valid := decodeMixedSelectionTrack(nested); valid {
				return source, true
			}
		}
	}
	return soundcloudSearchTrackSource{}, false
}

func normalizeSearchTrack(id int64, urn, title, permalinkURL, artworkURL, avatarURL string, duration int64, username string) soundcloudSearchTrack {
	if artworkURL == "" {
		artworkURL = avatarURL
	}
	if artworkURL != "" {
		artworkURL = strings.Replace(artworkURL, "-large.", "-t300x300.", 1)
	}
	if urn == "" {
		urn = fmt.Sprintf("soundcloud:tracks:%d", id)
	}
	track := soundcloudSearchTrack{ID: id, URN: urn, Title: title, PermalinkURL: permalinkURL, ArtworkURL: artworkURL, Duration: duration}
	track.User.Username = username
	return track
}
