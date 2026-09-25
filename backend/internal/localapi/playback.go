package localapi

import (
	"errors"
	"fmt"
	"log"
	"net/url"
	"strings"
)

const (
	// Public SoundCloud client ID, не OAuth-токен пользователя.
	soundcloudClientID = "3uJIGBRwdofKn6QKzONvDxUM1Vs4bTv9"
)

type trackStreamParams struct {
	TrackURN string `json:"trackUrn"`
}

type trackStreamResult struct {
	URL          string              `json:"url"`
	Preview      bool                `json:"preview"`
	HLS          bool                `json:"hls"`
	Quality      string              `json:"quality"`
	Alternatives []trackStreamOption `json:"alternatives,omitempty"`
}

type trackStreamOption struct {
	URL     string `json:"url"`
	Preview bool   `json:"preview"`
	HLS     bool   `json:"hls"`
	Quality string `json:"quality"`
}

func (s *service) RPCTrackStream(params trackStreamParams) (trackStreamResult, error) {
	if s.auth.Token == "" {
		return trackStreamResult{}, errors.New("сначала подключите аккаунт SoundCloud")
	}
	trackURN := strings.TrimSpace(params.TrackURN)
	if trackURN == "" {
		return trackStreamResult{}, errors.New("у трека отсутствует URN")
	}
	endpoint, err := s.soundcloudV2URL("/tracks/"+url.PathEscape(trackURN), nil)
	if err != nil {
		return trackStreamResult{}, fmt.Errorf("не удалось сформировать запрос метаданных трека: %w", err)
	}
	var track struct {
		Media struct {
			Transcodings []soundcloudStreamTranscoding `json:"transcodings"`
		} `json:"media"`
		PreviewMP3URL string `json:"preview_mp3_128_url"`
	}
	if err := s.getSoundCloudJSON(endpoint, &track); err != nil {
		return trackStreamResult{}, fmt.Errorf("не удалось получить потоки трека из SoundCloud: %w", err)
	}
	choices := trackTranscodingChoices(track.Media.Transcodings, track.PreviewMP3URL)
	if len(choices) == 0 {
		log.Printf("track.stream stage=unavailable track_urn=%q transcoding_count=%d", trackURN, len(track.Media.Transcodings))
		return trackStreamResult{}, errors.New("SoundCloud не предоставил для этого трека AAC HLS-поток или превью")
	}
	var lastErr error
	resolvedChoices := make([]trackStreamOption, 0, len(choices))
	hasUnsupportedDRM := false
	for index, choice := range choices {
		if strings.Contains(choice.Protocol, "encrypted-hls") {
			// SoundCloud's encrypted HLS playlists require FairPlay/Widevine/PlayReady
			// DRM. The custom HTML audio + hls.js player has no DRM license flow.
			hasUnsupportedDRM = true
			log.Printf("track.stream stage=unsupported_drm track_urn=%q protocol=%q quality=%q", trackURN, choice.Protocol, choice.Quality)
			continue
		}
		resolvedURL, err := s.resolveTrackTranscoding(choice.URL)
		if err != nil {
			lastErr = err
			log.Printf("track.stream stage=fallback track_urn=%q attempt=%d/%d protocol=%q quality=%q error=%q", trackURN, index+1, len(choices), choice.Protocol, choice.Quality, err.Error())
			continue
		}
		parsedStream, err := url.Parse(resolvedURL)
		if err != nil || parsedStream.Scheme != "https" || !isSoundCloudMediaHost(parsedStream.Hostname()) {
			lastErr = errors.New("SoundCloud не вернул корректную CDN-ссылку аудиопотока")
			log.Printf("track.stream stage=fallback track_urn=%q attempt=%d/%d protocol=%q quality=%q error=%q", trackURN, index+1, len(choices), choice.Protocol, choice.Quality, lastErr.Error())
			continue
		}
		log.Printf("track.stream stage=complete preview=%t hls=%t quality=%q protocol=%q", choice.Preview, choice.HLS, choice.Quality, choice.Protocol)
		resolvedChoices = append(resolvedChoices, trackStreamOption{URL: resolvedURL, Preview: choice.Preview, HLS: choice.HLS, Quality: choice.Quality})
	}
	if len(resolvedChoices) > 0 {
		if len(resolvedChoices) > 4 {
			resolvedChoices = resolvedChoices[:4]
		}
		primary := resolvedChoices[0]
		return trackStreamResult{URL: primary.URL, Preview: primary.Preview, HLS: primary.HLS, Quality: primary.Quality, Alternatives: resolvedChoices[1:]}, nil
	}
	if hasUnsupportedDRM {
		return trackStreamResult{}, errors.New("этот трек доступен только в DRM-защищённом потоке SoundCloud, который текущий плеер не поддерживает")
	}
	return trackStreamResult{}, fmt.Errorf("не удалось получить ни один доступный поток SoundCloud: %w", lastErr)
}

func (s *service) resolveTrackTranscoding(transcodingURL string) (string, error) {
	parsedTranscoding, err := url.Parse(transcodingURL)
	if err != nil || parsedTranscoding.Scheme != "https" {
		return "", errors.New("SoundCloud вернул некорректную ссылку транскодирования")
	}
	if strings.EqualFold(parsedTranscoding.Hostname(), "api-v2.soundcloud.com") {
		endpoint, err := s.soundcloudV2URLFromAbsolute(transcodingURL)
		if err != nil {
			return "", fmt.Errorf("SoundCloud вернул некорректную ссылку транскодирования: %w", err)
		}
		var resolved struct {
			URL string `json:"url"`
		}
		if err := s.getSoundCloudJSON(endpoint, &resolved); err != nil {
			return "", fmt.Errorf("не удалось получить CDN-ссылку SoundCloud: %w", err)
		}
		return resolved.URL, nil
	}
	if isSoundCloudMediaHost(parsedTranscoding.Hostname()) {
		// Preview/HLS URLs can already point directly at the media CDN.
		return transcodingURL, nil
	}
	return "", errors.New("SoundCloud вернул ссылку потока с неизвестного домена")
}
