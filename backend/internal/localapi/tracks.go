package localapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
)

type soundcloudTrack struct {
	ID            int64  `json:"id"`
	URN           string `json:"urn"`
	Title         string `json:"title"`
	PermalinkURL  string `json:"permalink_url"`
	ArtworkURL    string `json:"artwork_url"`
	Duration      int64  `json:"duration"`
	PlaybackCount int64  `json:"playback_count"`
	LikesCount    int64  `json:"likes_count"`
	User          struct {
		Username string `json:"username"`
	} `json:"user"`
}

type soundcloudLike struct {
	Track *soundcloudTrack `json:"track"`
}

type soundcloudTrackCard struct {
	ID            int64  `json:"id"`
	TrackURN      string `json:"trackUrn"`
	Title         string `json:"title"`
	PermalinkURL  string `json:"permalinkUrl,omitempty"`
	ArtworkURL    string `json:"artworkUrl,omitempty"`
	Duration      int64  `json:"duration"`
	PlaybackCount int64  `json:"playbackCount,omitempty"`
	LikesCount    int64  `json:"likesCount,omitempty"`
	User          struct {
		Username string `json:"username"`
	} `json:"user"`
}

func (s *service) RPCTracksMine(_ emptyParams) ([]soundcloudTrackCard, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	return s.fetchMyTracks(s.auth.Token, s.auth.Profile.ID)
}
func (s *service) fetchMyTracks(token string, userID int64) ([]soundcloudTrackCard, error) {
	var lastErr error
	if userID == 0 {
		log.Printf("tracks.mine stage=profile error=missing_user_id")
		return nil, errors.New("SoundCloud не вернул ID аккаунта для загрузки треков")
	}
	log.Printf("tracks.mine stage=start user_id=%d", userID)
	// The Python entrypoint displays get_user_likes(), not get_user_tracks().
	// Match its endpoint and query so the desktop shows the same library items.
	for _, base := range []string{webAPIBase, officialAPIBase} {
		endpoint := fmt.Sprintf("%s/users/%d/likes?limit=200&linked_partitioning=true", strings.TrimRight(base, "/"), userID)
		log.Printf("tracks.mine stage=request host=%s path=/users/%d/likes", hostForLog(base), userID)
		pageURL := endpoint
		seenPageURLs := make(map[string]bool)
		likes := make([]soundcloudLike, 0)
		pageCount := 0
		failed := false
		for pageURL != "" {
			if pageCount >= 250 {
				lastErr = errors.New("SoundCloud вернул слишком много страниц лайков (лимит 250)")
				failed = true
				break
			}
			parsedPage, err := url.Parse(pageURL)
			parsedBase, baseErr := url.Parse(base)
			if err != nil || baseErr != nil || parsedPage.Scheme != "https" || parsedPage.Host != parsedBase.Host {
				lastErr = errors.New("SoundCloud вернул некорректную ссылку следующей страницы")
				failed = true
				break
			}
			if seenPageURLs[pageURL] {
				lastErr = errors.New("SoundCloud вернул повторяющуюся ссылку страницы лайков")
				failed = true
				break
			}
			seenPageURLs[pageURL] = true
			pageCount++
			req, err := http.NewRequest(http.MethodGet, pageURL, nil)
			if err != nil {
				lastErr = err
				failed = true
				break
			}
			req.Header.Set("Authorization", "OAuth "+token)
			req.Header.Set("Accept", "application/json")
			req.Header.Set("User-Agent", userAgent)
			if base == webAPIBase {
				req.Header.Set("Origin", "https://soundcloud.com")
				req.Header.Set("Referer", "https://soundcloud.com/")
			}
			resp, err := s.httpClient.Do(req)
			if err != nil {
				lastErr = fmt.Errorf("SoundCloud недоступен, проверьте подключение к интернету: %w", err)
				log.Printf("tracks.mine stage=response host=%s page=%d error=%q", hostForLog(base), pageCount, err.Error())
				failed = true
				break
			}
			log.Printf("tracks.mine stage=response host=%s page=%d status=%d content_type=%q", hostForLog(base), pageCount, resp.StatusCode, resp.Header.Get("Content-Type"))
			if resp.StatusCode != http.StatusOK {
				resp.Body.Close()
				lastErr = fmt.Errorf("SoundCloud вернул HTTP %d при загрузке страницы лайков %d", resp.StatusCode, pageCount)
				log.Printf("tracks.mine stage=http_error host=%s page=%d status=%d", hostForLog(base), pageCount, resp.StatusCode)
				failed = true
				break
			}
			data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
			resp.Body.Close()
			if err != nil {
				lastErr = fmt.Errorf("не удалось прочитать страницу лайков: %w", err)
				log.Printf("tracks.mine stage=body_read page=%d error=%q", pageCount, err.Error())
				failed = true
				break
			}
			var payload struct {
				Collection []soundcloudLike `json:"collection"`
				NextHref   string           `json:"next_href"`
			}
			if err := json.Unmarshal(data, &payload); err != nil {
				lastErr = fmt.Errorf("не удалось разобрать страницу лайков: %w", err)
				log.Printf("tracks.mine stage=parse page=%d error=%q", pageCount, err.Error())
				failed = true
				break
			}
			likes = append(likes, payload.Collection...)
			log.Printf("tracks.mine stage=parse page=%d count=%d total=%d has_next=%t", pageCount, len(payload.Collection), len(likes), payload.NextHref != "")
			pageURL = payload.NextHref
		}
		if failed {
			continue
		}
		log.Printf("tracks.mine stage=parse shape=collection count=%d pages=%d", len(likes), pageCount)
		result := make([]soundcloudTrackCard, 0, len(likes))
		seenTrackIDs := make(map[int64]struct{}, len(likes))
		for _, like := range likes {
			if like.Track == nil {
				continue
			}
			track := *like.Track
			if _, exists := seenTrackIDs[track.ID]; exists {
				continue
			}
			seenTrackIDs[track.ID] = struct{}{}
			artwork := track.ArtworkURL
			if strings.Contains(artwork, "-large.") {
				artwork = strings.Replace(artwork, "-large.", "-t500x500.", 1)
			}
			trackURN := track.URN
			if trackURN == "" {
				trackURN = fmt.Sprintf("soundcloud:tracks:%d", track.ID)
			}
			item := soundcloudTrackCard{ID: track.ID, TrackURN: trackURN, Title: track.Title, PermalinkURL: track.PermalinkURL, ArtworkURL: artwork, Duration: track.Duration, PlaybackCount: track.PlaybackCount, LikesCount: track.LikesCount}
			item.User.Username = track.User.Username
			result = append(result, item)
		}
		log.Printf("tracks.mine stage=complete count=%d", len(result))
		return result, nil
	}
	if lastErr == nil {
		lastErr = errors.New("не удалось загрузить треки SoundCloud")
	}
	log.Printf("tracks.mine stage=failed error=%q", lastErr.Error())
	return nil, lastErr
}
