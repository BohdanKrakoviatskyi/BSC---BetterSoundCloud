package localapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// errTokenRejected означает, что SoundCloud отклонил токен (401/403),
// а не то, что сервис недоступен.
var errTokenRejected = errors.New("SoundCloud отклонил токен, проверьте, что вставлен действующий access token")

type profile struct {
	ID             int64  `json:"id"`
	Username       string `json:"username"`
	FullName       string `json:"fullName,omitempty"`
	PermalinkURL   string `json:"permalinkUrl,omitempty"`
	AvatarURL      string `json:"avatarUrl,omitempty"`
	City           string `json:"city,omitempty"`
	Country        string `json:"country,omitempty"`
	FollowersCount int64  `json:"followersCount,omitempty"`
	TrackCount     int64  `json:"trackCount,omitempty"`
	LikesCount     int64  `json:"likesCount,omitempty"`
}

type soundcloudUser struct {
	ID             int64  `json:"id"`
	Username       string `json:"username"`
	FullName       string `json:"full_name"`
	PermalinkURL   string `json:"permalink_url"`
	AvatarURL      string `json:"avatar_url"`
	City           string `json:"city"`
	Country        string `json:"country"`
	FollowersCount int64  `json:"followers_count"`
	TrackCount     int64  `json:"track_count"`
	LikesCount     int64  `json:"likes_count"`
}

type authState struct {
	Token   string  `json:"token"`
	Profile profile `json:"profile"`
	SavedAt string  `json:"savedAt"`
}

type authStatus struct {
	Authorized bool     `json:"authorized"`
	Profile    *profile `json:"profile,omitempty"`
}
type loginParams struct {
	Token string `json:"token"`
}

func (s *service) RPCAuthStatus(_ emptyParams) (authStatus, error) {
	return s.authStatus(), nil
}

func (s *service) RPCAuthLogin(login loginParams) (authStatus, error) {
	token := strings.TrimSpace(login.Token)
	if token == "" {
		return authStatus{}, errors.New("вставьте access token SoundCloud")
	}
	user, err := s.fetchProfile(token)
	if err != nil {
		return authStatus{}, err
	}
	state := authState{Token: token, Profile: user, SavedAt: time.Now().UTC().Format(time.RFC3339)}
	if err := s.saveAuth(state); err != nil {
		return authStatus{}, fmt.Errorf("save auth: %w", err)
	}
	s.auth = state
	return s.authStatus(), nil
}

func (s *service) RPCAuthRefresh(_ emptyParams) (authStatus, error) {
	if s.auth.Token == "" {
		return authStatus{Authorized: false}, nil
	}
	user, err := s.fetchProfile(s.auth.Token)
	if err != nil {
		if errors.Is(err, errTokenRejected) {
			if clearErr := s.clearAuth(); clearErr != nil {
				return authStatus{}, fmt.Errorf("clear auth: %w", clearErr)
			}
			s.auth = authState{}
			return authStatus{Authorized: false}, nil
		}
		// Сеть недоступна: сохраняем сессию и отдаём кэшированный профиль.
		return s.authStatus(), nil
	}
	s.auth.Profile = user
	if err := s.saveAuth(s.auth); err != nil {
		return authStatus{}, fmt.Errorf("save auth: %w", err)
	}
	return s.authStatus(), nil
}

func (s *service) RPCAuthLogout(_ emptyParams) (authStatus, error) {
	if err := s.clearAuth(); err != nil {
		return authStatus{}, fmt.Errorf("clear auth: %w", err)
	}
	s.auth = authState{}
	return authStatus{Authorized: false}, nil
}

// authStatus отдаёт renderer-у только признак входа и профиль.
// Сам токен никогда не покидает Go sidecar.
func (s *service) authStatus() authStatus {
	if s.auth.Token == "" {
		return authStatus{Authorized: false}
	}
	user := s.auth.Profile
	return authStatus{Authorized: true, Profile: &user}
}

func (s *service) fetchProfile(token string) (profile, error) {
	bases := s.apiBases()
	var lastErr error
	for _, base := range bases {
		user, err := s.fetchProfileFrom(base, token)
		if err == nil {
			return user, nil
		}
		lastErr = err
	}
	if lastErr == nil {
		lastErr = errors.New("SoundCloud недоступен")
	}
	return profile{}, lastErr
}

func (s *service) fetchProfileFrom(base, token string) (profile, error) {
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(base, "/")+"/me", nil)
	if err != nil {
		return profile{}, err
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
		return profile{}, fmt.Errorf("SoundCloud недоступен, проверьте подключение к интернету: %w", err)
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
		return profile{}, fmt.Errorf("%w (HTTP %d)", errTokenRejected, resp.StatusCode)
	case resp.StatusCode == http.StatusTooManyRequests:
		return profile{}, errors.New("SoundCloud временно ограничил запросы (HTTP 429), повторите позже")
	case resp.StatusCode != http.StatusOK:
		return profile{}, fmt.Errorf("SoundCloud вернул HTTP %d", resp.StatusCode)
	}

	var user soundcloudUser
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 1<<20))
	if err := decoder.Decode(&user); err != nil || user.ID == 0 || user.Username == "" {
		return profile{}, errors.New("SoundCloud вернул неожиданный ответ при проверке токена")
	}
	return profileFrom(user), nil
}
func profileFrom(user soundcloudUser) profile {
	avatar := user.AvatarURL
	if strings.Contains(avatar, "-large.") {
		avatar = strings.Replace(avatar, "-large.", "-t500x500.", 1)
	}
	return profile{
		ID:             user.ID,
		Username:       user.Username,
		FullName:       user.FullName,
		PermalinkURL:   user.PermalinkURL,
		AvatarURL:      avatar,
		City:           user.City,
		Country:        user.Country,
		FollowersCount: user.FollowersCount,
		TrackCount:     user.TrackCount,
		LikesCount:     user.LikesCount,
	}
}
