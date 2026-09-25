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

const (
	officialAPIBase = "https://api.soundcloud.com"
	// webAPIBase — Web API v2, который принимает токены веб-сессии SoundCloud.
	webAPIBase = "https://api-v2.soundcloud.com"
	userAgent  = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
)

func hostForLog(base string) string {
	if strings.HasPrefix(base, "https://") {
		return strings.TrimPrefix(base, "https://")
	}
	return base
}

// apiBases перечисляет хосты SoundCloud в порядке проверки. Токены веб-сессии
// SoundCloud обслуживает api-v2, а OAuth-токены зарегистрированных приложений —
// официальный api.soundcloud.com, поэтому пробуем оба.
func (s *service) apiBases() []string {
	base := strings.TrimRight(strings.TrimSpace(s.apiBase), "/")
	if base != "" && base != officialAPIBase {
		return []string{base}
	}
	return []string{webAPIBase, officialAPIBase}
}
func isSoundCloudMediaHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return strings.HasSuffix(host, ".sndcdn.com") || strings.HasSuffix(host, ".soundcloud.cloud")
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
	return s.getSoundCloudJSONLimit(endpoint, destination, 2<<20)
}

func (s *service) getSoundCloudJSONLimit(endpoint string, destination any, maxBytes int64) error {
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
	parsedEndpoint, _ := url.Parse(endpoint)
	endpointHost := "unknown"
	if parsedEndpoint != nil {
		endpointHost = parsedEndpoint.Host
	}
	log.Printf("soundcloud.api stage=response host=%s status=%d content_type=%q", endpointHost, resp.StatusCode, resp.Header.Get("Content-Type"))
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		detail := strings.TrimSpace(string(body))
		if detail != "" {
			return fmt.Errorf("SoundCloud API вернул HTTP %d: %s", resp.StatusCode, detail)
		}
		return fmt.Errorf("SoundCloud API вернул HTTP %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBytes)).Decode(destination); err != nil {
		return fmt.Errorf("ошибка чтения JSON: %w", err)
	}
	return nil
}
