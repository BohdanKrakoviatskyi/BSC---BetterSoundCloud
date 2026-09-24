package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strconv"
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
	URL     string `json:"url"`
	Preview bool   `json:"preview"`
	HLS     bool   `json:"hls"`
	Quality string `json:"quality"`
}

type soundcloudStreamTranscoding struct {
	URL    string `json:"url"`
	Preset string `json:"preset"`
	Format struct {
		Protocol string `json:"protocol"`
		MimeType string `json:"mime_type"`
	} `json:"format"`
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
		return trackStreamResult{URL: resolvedURL, Preview: choice.Preview, HLS: choice.HLS, Quality: choice.Quality}, nil
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

func isSoundCloudMediaHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return strings.HasSuffix(host, ".sndcdn.com") || strings.HasSuffix(host, ".soundcloud.cloud")
}

type trackTranscodingChoice struct {
	URL      string
	Protocol string
	Preview  bool
	HLS      bool
	Quality  string
	Bitrate  int
}

func trackTranscodingChoices(transcodings []soundcloudStreamTranscoding, previewURL string) []trackTranscodingChoice {
	var aacHLS, otherHLS, progressive, previews []trackTranscodingChoice
	for _, transcoding := range transcodings {
		if strings.TrimSpace(transcoding.URL) == "" {
			continue
		}
		protocol := strings.ToLower(strings.TrimSpace(transcoding.Format.Protocol))
		preset := strings.ToLower(transcoding.Preset)
		mimeType := strings.ToLower(transcoding.Format.MimeType)
		isHLS := strings.Contains(protocol, "hls")
		isAAC := strings.Contains(preset+" "+mimeType+" "+strings.ToLower(transcoding.URL), "aac")
		choice := trackTranscodingChoice{URL: transcoding.URL, Protocol: protocol, HLS: isHLS}
		switch {
		case isHLS && isAAC:
			bitrate := aacBitrateKbps(transcoding)
			choice.Bitrate = bitrate
			choice.Quality = "AAC HLS"
			if bitrate > 0 {
				choice.Quality = fmt.Sprintf("AAC %d kbps", bitrate)
			}
			aacHLS = append(aacHLS, choice)
		case isHLS:
			choice.Quality = transcoding.Preset
			otherHLS = append(otherHLS, choice)
		case protocol == "progressive":
			choice.Quality = "Progressive"
			progressive = append(progressive, choice)
		case strings.Contains(preset, "preview"):
			choice.Preview = true
			choice.Quality = "Превью"
			previews = append(previews, choice)
		}
	}

	sort.SliceStable(aacHLS, func(i, j int) bool {
		return aacHLS[i].Bitrate > aacHLS[j].Bitrate
	})
	choices := append(aacHLS, otherHLS...)
	choices = append(choices, progressive...)
	choices = append(choices, previews...)
	if previewURL != "" {
		choices = append(choices, trackTranscodingChoice{
			URL: previewURL, Protocol: "preview", Preview: true,
			HLS: strings.Contains(strings.ToLower(previewURL), ".m3u8"), Quality: "Превью MP3",
		})
	}
	return choices
}

func aacBitrateKbps(transcoding soundcloudStreamTranscoding) int {
	value := strings.ToLower(transcoding.Preset + " " + transcoding.URL)
	start := strings.Index(value, "aac_")
	if start < 0 {
		return 0
	}
	digits := value[start+4:]
	length := 0
	for length < len(digits) && digits[length] >= '0' && digits[length] <= '9' {
		length++
	}
	if length == 0 {
		return 0
	}
	bitrate, err := strconv.Atoi(digits[:length])
	if err != nil {
		return 0
	}
	return bitrate
}

func (s *service) soundcloudV2URL(path string, query url.Values) (string, error) {
	endpoint, err := url.Parse(strings.TrimRight(webAPIBase, "/") + path)
	if err != nil {
		return "", err
	}
	values := endpoint.Query()
	for key, entries := range query {
		for _, entry := range entries {
			values.Add(key, entry)
		}
	}
	values.Set("client_id", s.settings.ClientID)
	endpoint.RawQuery = values.Encode()
	return endpoint.String(), nil
}

func (s *service) soundcloudV2URLFromAbsolute(rawURL string) (string, error) {
	endpoint, err := url.Parse(rawURL)
	if err != nil || endpoint.Scheme != "https" || !strings.EqualFold(endpoint.Hostname(), "api-v2.soundcloud.com") {
		return "", errors.New("ожидался HTTPS URL api-v2.soundcloud.com")
	}
	query := endpoint.Query()
	query.Set("client_id", s.settings.ClientID)
	endpoint.RawQuery = query.Encode()
	return endpoint.String(), nil
}

func (s *service) getSoundCloudJSON(endpoint string, destination any) error {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "OAuth "+s.auth.Token)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Origin", "https://soundcloud.com")
	req.Header.Set("Referer", "https://soundcloud.com/")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		log.Printf("track.stream stage=transport_error error=%q", err.Error())
		return fmt.Errorf("сетевая ошибка: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("track.stream stage=api_response host=%s status=%d content_type=%q", hostForLog(webAPIBase), resp.StatusCode, resp.Header.Get("Content-Type"))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("SoundCloud API v2 вернул HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(destination); err != nil {
		return fmt.Errorf("ошибка чтения JSON: %w", err)
	}
	return nil
}
