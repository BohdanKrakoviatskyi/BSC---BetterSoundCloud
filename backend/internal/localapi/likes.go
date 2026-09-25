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
	"time"
)

type trackLikeParams struct {
	TrackID        int64  `json:"trackId"`
	TrackURN       string `json:"trackUrn"`
	DataDomeCookie string `json:"datadomeCookie,omitempty"`
}

type trackLikeResult struct {
	Liked      bool   `json:"liked"`
	CaptchaURL string `json:"captchaUrl,omitempty"`
}

type captchaChallengeError struct {
	URL string
}

func (e *captchaChallengeError) Error() string {
	return "SoundCloud требует пройти проверку перед изменением лайка"
}
func (s *service) RPCTrackLike(params trackLikeParams) (trackLikeResult, error) {
	return trackLikeResponse(s.setTrackLiked(params.TrackID, params.TrackURN, true, params.DataDomeCookie), true)
}

func (s *service) RPCTrackUnlike(params trackLikeParams) (trackLikeResult, error) {
	return trackLikeResponse(s.setTrackLiked(params.TrackID, params.TrackURN, false, params.DataDomeCookie), false)
}

func trackLikeResponse(err error, requestedLiked bool) (trackLikeResult, error) {
	if err == nil {
		return trackLikeResult{Liked: requestedLiked}, nil
	}
	var challenge *captchaChallengeError
	if errors.As(err, &challenge) {
		return trackLikeResult{Liked: !requestedLiked, CaptchaURL: challenge.URL}, nil
	}
	return trackLikeResult{}, err
}

func (s *service) setTrackLiked(trackID int64, trackURN string, liked bool, dataDomeCookie string) error {
	action := "unlike"
	if liked {
		action = "like"
	}
	startedAt := time.Now()
	if s.auth.Token == "" {
		log.Printf("track.%s stage=auth_error track_id=%d error=%q", action, trackID, "account is not connected")
		return errors.New("сначала подключите аккаунт SoundCloud")
	}
	if trackID <= 0 {
		log.Printf("track.%s stage=validation_error track_id=%d error=%q", action, trackID, "invalid track id")
		return errors.New("некорректный ID трека")
	}
	if strings.TrimSpace(trackURN) == "" {
		trackURN = fmt.Sprintf("soundcloud:tracks:%d", trackID)
	}
	if len(dataDomeCookie) > 4096 || strings.IndexFunc(dataDomeCookie, func(character rune) bool {
		return character < 0x21 || character > 0x7e || strings.ContainsRune(";,\\\"", character)
	}) >= 0 {
		return errors.New("некорректная cookie проверки SoundCloud")
	}
	method := http.MethodDelete
	if liked {
		method = http.MethodPost
	}
	var lastErr error
	var attempts []string
	bases := s.apiBases()
	if len(bases) > 1 {
		bases = bases[:1]
	}
	for _, base := range bases {
		requestMethod := method
		isWebAPI := base == webAPIBase || (s.apiBase != "" && s.apiBase != officialAPIBase && base == s.apiBase)
		endpoint := fmt.Sprintf("%s/likes/tracks/%s", strings.TrimRight(base, "/"), url.PathEscape(trackURN))
		if isWebAPI {
			if s.auth.Profile.ID <= 0 {
				return errors.New("не удалось определить ID аккаунта SoundCloud для изменения лайка")
			}
			endpoint = fmt.Sprintf("%s/users/%d/track_likes/%d", strings.TrimRight(base, "/"), s.auth.Profile.ID, trackID)
			parsed, err := url.Parse(endpoint)
			if err != nil {
				return err
			}
			query := parsed.Query()
			query.Set("client_id", s.settings.ClientID)
			parsed.RawQuery = query.Encode()
			endpoint = parsed.String()
			if liked {
				requestMethod = http.MethodPut
			}
		}
		log.Printf("track.%s stage=request host=%s track_id=%d method=%s", action, hostForLog(base), trackID, requestMethod)
		req, err := http.NewRequest(requestMethod, endpoint, nil)
		if err != nil {
			log.Printf("track.%s stage=request_build_error track_id=%d error=%q", action, trackID, err.Error())
			return err
		}
		req.Header.Set("Authorization", "OAuth "+s.auth.Token)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("User-Agent", userAgent)
		if dataDomeCookie != "" {
			req.Header.Set("Cookie", "datadome="+dataDomeCookie)
			req.Header.Set("X-Datadome-ClientId", dataDomeCookie)
		}
		if base == webAPIBase {
			req.Header.Set("Origin", "https://soundcloud.com")
			req.Header.Set("Referer", "https://soundcloud.com/")
		}
		resp, err := s.httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("SoundCloud недоступен, проверьте подключение к интернету: %w", err)
			log.Printf("track.%s stage=transport_error host=%s track_id=%d error=%q", action, hostForLog(base), trackID, err.Error())
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		bodyText := strings.TrimSpace(string(body))
		if s.auth.Token != "" {
			bodyText = strings.ReplaceAll(bodyText, s.auth.Token, "[redacted]")
		}
		bodyText = strings.Join(strings.Fields(bodyText), " ")
		challengeURL := ""
		if resp.StatusCode == http.StatusForbidden {
			challengeURL = extractCaptchaURL(resp.Header, body)
			if challengeURL != "" {
				bodyText = "[captcha challenge response; URL omitted]"
			}
		}
		if len(bodyText) > 600 {
			bodyText = bodyText[:600] + "…"
		}
		log.Printf("track.%s stage=response host=%s track_id=%d status=%d content_type=%q body=%q read_error=%v", action, hostForLog(base), trackID, resp.StatusCode, resp.Header.Get("Content-Type"), bodyText, readErr)
		if challengeURL != "" {
			log.Printf("track.%s stage=captcha_challenge track_id=%d", action, trackID)
			return &captchaChallengeError{URL: challengeURL}
		}
		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			log.Printf("track.%s stage=complete track_id=%d elapsed_ms=%d", action, trackID, time.Since(startedAt).Milliseconds())
			return nil
		}
		switch resp.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden:
			message := fmt.Sprintf("%s вернул HTTP %d", hostForLog(base), resp.StatusCode)
			if bodyText != "" {
				message += ": " + bodyText
			}
			attempts = append(attempts, message)
			lastErr = fmt.Errorf("SoundCloud отклонил запрос изменения лайка: %s", message)
		case http.StatusTooManyRequests:
			lastErr = errors.New("SoundCloud временно ограничил запросы (HTTP 429), повторите позже")
			attempts = append(attempts, fmt.Sprintf("%s вернул HTTP 429", hostForLog(base)))
		default:
			message := fmt.Sprintf("%s вернул HTTP %d", hostForLog(base), resp.StatusCode)
			if bodyText != "" {
				message += ": " + bodyText
			}
			attempts = append(attempts, message)
			lastErr = fmt.Errorf("SoundCloud вернул ошибку при изменении лайка: %s", message)
		}
	}
	if len(attempts) > 1 {
		lastErr = fmt.Errorf("изменить лайк не удалось: %s", strings.Join(attempts, "; "))
	}
	if lastErr == nil {
		lastErr = errors.New("не удалось изменить лайк SoundCloud")
	}
	log.Printf("track.%s stage=failed track_id=%d elapsed_ms=%d error=%q", action, trackID, time.Since(startedAt).Milliseconds(), lastErr.Error())
	return lastErr
}

func extractCaptchaURL(headers http.Header, body []byte) string {
	if candidate := safeChallengeURL(headers.Get("Location")); candidate != "" {
		return candidate
	}
	var payload any
	if json.Unmarshal(body, &payload) == nil {
		if candidate := findChallengeURL(payload); candidate != "" {
			return candidate
		}
	}

	remaining := string(body)
	for {
		start := strings.Index(remaining, "https://")
		if start < 0 {
			return ""
		}
		remaining = remaining[start:]
		end := strings.IndexAny(remaining, " \t\r\n\"'<>]")
		candidate := remaining
		if end >= 0 {
			candidate = remaining[:end]
		}
		candidate = strings.TrimRight(candidate, ",.;:)")
		if safe := safeChallengeURL(candidate); safe != "" {
			return safe
		}
		if end < 0 {
			return ""
		}
		remaining = remaining[end:]
	}
}

func findChallengeURL(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		for key, nested := range typed {
			name := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
			if candidate, ok := nested.(string); ok && (name == "url" || name == "location" || name == "redirect" || strings.Contains(name, "captcha") || strings.Contains(name, "challenge")) {
				if safe := safeChallengeURL(candidate); safe != "" {
					return safe
				}
			}
			if safe := findChallengeURL(nested); safe != "" {
				return safe
			}
		}
	case []any:
		for _, nested := range typed {
			if safe := findChallengeURL(nested); safe != "" {
				return safe
			}
		}
	}
	return ""
}

func safeChallengeURL(candidate string) string {
	parsed, err := url.Parse(strings.TrimSpace(candidate))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" || parsed.User != nil {
		return ""
	}
	return parsed.String()
}
