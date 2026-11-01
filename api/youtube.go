package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	youtubeDefaultAPIBase = "https://www.googleapis.com/youtube/v3"
	youtubeDefaultAuthURL = "https://oauth2.googleapis.com/token"
)

// youtubeAuthState is what survives between runs.
//
// Google's refresh token does not expire unless the user revokes access, which is what makes a
// remembered session possible at all: the access token lasts an hour, and without the refresh token
// the user would be signing in through a consent screen every hour.
type youtubeAuthState struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	// Unix milliseconds.
	ExpiresAt int64  `json:"expiresAt"`
	Scope     string `json:"scope,omitempty"`
	ID        string `json:"id,omitempty"`
	Email     string `json:"email,omitempty"`
	Name      string `json:"name,omitempty"`
	Picture   string `json:"picture,omitempty"`
	SavedAt   string `json:"savedAt"`
}

type youtubeAuthProfile struct {
	ID      string `json:"id"`
	Email   string `json:"email,omitempty"`
	Name    string `json:"name,omitempty"`
	Picture string `json:"picture,omitempty"`
}

type youtubeAuthStatus struct {
	Authorized bool                `json:"authorized"`
	Profile    *youtubeAuthProfile `json:"profile,omitempty"`
	ExpiresAt  int64               `json:"expiresAt,omitempty"`
}

type youtubeExchangeParams struct {
	Code         string `json:"code"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURI  string `json:"redirectUri"`
}

type youtubeRefreshParams struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type youtubeTokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	TokenType    string `json:"token_type"`
}

// youtubeOauth2TokenWire is the error shape Google uses for a failed grant. It is not the shape a
// success uses, so it gets its own type rather than being forced into youtubeTokenResponse.
type youtubeOauth2TokenWire struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// youtubeProfileWire is the openid/userinfo response. Only the fields the app shows are asked for, so
// nothing here can be mistaken for a field Google simply did not send.
type youtubeProfileWire struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// RPCYoutubeAuthExchange trades an authorization code for tokens.
//
// No dispatcher change needed: rpcMethods() finds every RPC-prefixed method with the (T) (R, error)
// shape and rpcNameFromGo turns this into youtube.auth.exchange.
func (s *service) RPCYoutubeAuthExchange(params youtubeExchangeParams) (youtubeAuthStatus, error) {
	if strings.TrimSpace(params.Code) == "" {
		return youtubeAuthStatus{}, errors.New("не передан код авторизации YouTube")
	}
	if strings.TrimSpace(params.ClientID) == "" || strings.TrimSpace(params.ClientSecret) == "" {
		return youtubeAuthStatus{}, errors.New("не заданы Client ID или Client Secret Google")
	}

	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("code", strings.TrimSpace(params.Code))
	values.Set("client_id", params.ClientID)
	values.Set("client_secret", params.ClientSecret)
	// redirect_uri repeats the authorize request value. Google requires it in the token
	// request and answers invalid_request: Missing parameter: redirect_uri when omitted.
	values.Set("redirect_uri", strings.TrimSpace(params.RedirectURI))

	token, err := s.youtubePostToken(values)
	if err != nil {
		return youtubeAuthStatus{}, err
	}
	if strings.TrimSpace(token.AccessToken) == "" {
		return youtubeAuthStatus{}, errors.New("Google не вернул токен доступа")
	}

	state := youtubeAuthState{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    youtubeExpiry(token.ExpiresIn),
		Scope:        token.Scope,
		SavedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	if state.RefreshToken == "" {
		state.RefreshToken = s.youtubeAuth.RefreshToken
	}
	if err := s.saveYoutubeAuth(state); err != nil {
		return youtubeAuthStatus{}, err
	}

	// A bonus, not a requirement. The token is already usable, and failing the sign-in because a
	// profile lookup did not work would send the user round the loop for nothing.
	if profile, err := s.youtubeUserInfo(state.AccessToken); err == nil {
		state.ID = profile.ID
		state.Email = profile.Email
		state.Name = profile.Name
		state.Picture = profile.Picture
		if err := s.saveYoutubeAuth(state); err != nil {
			return youtubeAuthStatus{}, err
		}
	}
	return youtubeStatusFrom(state), nil
}

// RPCYoutubeAuthRefresh renews the access token.
//
// Google's refresh grant for this client needs the same credentials as the exchange: the stored
// session alone is not enough, so the frontend passes what it kept at sign-in (like Spotify).
func (s *service) RPCYoutubeAuthRefresh(params youtubeRefreshParams) (youtubeAuthStatus, error) {
	if strings.TrimSpace(s.youtubeAuth.RefreshToken) == "" {
		return youtubeAuthStatus{}, errors.New("нет сохранённого refresh token YouTube")
	}
	if strings.TrimSpace(params.ClientID) == "" || strings.TrimSpace(params.ClientSecret) == "" {
		return youtubeAuthStatus{}, errors.New("не заданы Client ID или Client Secret Google")
	}

	values := url.Values{}
	values.Set("grant_type", "refresh_token")
	values.Set("refresh_token", s.youtubeAuth.RefreshToken)
	values.Set("client_id", params.ClientID)
	values.Set("client_secret", params.ClientSecret)

	token, err := s.youtubePostToken(values)
	if err != nil {
		return youtubeAuthStatus{}, err
	}

	state := s.youtubeAuth
	state.AccessToken = token.AccessToken
	state.ExpiresAt = youtubeExpiry(token.ExpiresIn)
	if token.RefreshToken != "" {
		state.RefreshToken = token.RefreshToken
	}
	if token.Scope != "" {
		state.Scope = token.Scope
	}
	state.SavedAt = time.Now().UTC().Format(time.RFC3339)

	if err := s.saveYoutubeAuth(state); err != nil {
		return youtubeAuthStatus{}, err
	}
	return youtubeStatusFrom(state), nil
}

// RPCYoutubeAuthStatus reports the stored session without touching the network.
func (s *service) RPCYoutubeAuthStatus(_ emptyParams) (youtubeAuthStatus, error) {
	if strings.TrimSpace(s.youtubeAuth.AccessToken) == "" {
		return youtubeAuthStatus{Authorized: false}, nil
	}
	if s.youtubeAuth.ExpiresAt > 0 && time.Now().UnixMilli() >= s.youtubeAuth.ExpiresAt {
		return youtubeAuthStatus{Authorized: false}, nil
	}
	return youtubeStatusFrom(s.youtubeAuth), nil
}

// RPCYoutubeAuthLogout clears the stored session.
func (s *service) RPCYoutubeAuthLogout(_ emptyParams) (youtubeAuthStatus, error) {
	s.youtubeAuth = youtubeAuthState{}
	if s.youtubePath == "" {
		return youtubeAuthStatus{Authorized: false}, nil
	}
	if err := removeFileIfExists(s.youtubePath); err != nil {
		return youtubeAuthStatus{}, err
	}
	// The cached home page rows were fetched under the session that just ended, and they are not
	// personal either way, so they are dropped rather than kept for whoever signs in next.
	s.youtubeDiscoverClearCache()
	return youtubeAuthStatus{Authorized: false}, nil
}

// ---- storage

func (s *service) loadYoutubeAuth() error {
	if s.youtubePath == "" {
		return nil
	}
	data, err := os.ReadFile(s.youtubePath)
	if errors.Is(err, os.ErrNotExist) {
		s.youtubeAuth = youtubeAuthState{}
		return nil
	}
	if err != nil {
		return fmt.Errorf("read youtube auth: %w", err)
	}
	var state youtubeAuthState
	if err := json.Unmarshal(data, &state); err != nil {
		s.youtubeAuth = youtubeAuthState{}
		return nil
	}
	s.youtubeAuth = state
	return nil
}

func (s *service) saveYoutubeAuth(state youtubeAuthState) error {
	s.youtubeAuth = state
	if s.youtubePath == "" {
		return nil
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return writeSecretFile(s.youtubePath, data)
}

// ---- http

func (s *service) youtubePostToken(values url.Values) (youtubeTokenResponse, error) {
	endpoint := s.youtubeAuthURL
	if endpoint == "" {
		endpoint = youtubeDefaultAuthURL
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return youtubeTokenResponse{}, fmt.Errorf("не удалось сформировать запрос токена Google: %w", err)
	}
	// The credentials go in the body. Google accepts HTTP Basic too for web clients, but for an
	// installed client it expects them here, and a request that sends them the other way is refused
	// with invalid_client.
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	body, err := s.youtubeJSON(req, "токен Google")
	if err != nil {
		return youtubeTokenResponse{}, err
	}
	var token youtubeTokenResponse
	if err := body.decode(&token); err != nil {
		return token, fmt.Errorf("не удалось разобрать ответ Google: %w", err)
	}
	return token, nil
}

func (s *service) youtubeUserInfo(accessToken string) (youtubeProfileWire, error) {
	var profile youtubeProfileWire
	// Google separates OpenID Connect profile data from the YouTube API, so the profile lives at its
	// own host. The scopes requested include openid email profile, which is what makes this readable.
	endpoint := "https://www.googleapis.com/oauth2/v2/userinfo"
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return profile, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	body, err := s.youtubeJSON(req, "профиль Google")
	if err != nil {
		return profile, err
	}
	if err := body.decode(&profile); err != nil {
		return profile, fmt.Errorf("не удалось разобрать профиль Google: %w", err)
	}
	return profile, nil
}

func (s *service) youtubeJSON(req *http.Request, what string) (*youtubeBody, error) {
	client := s.httpClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("запрос %s не выполнен: %w", what, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxLine))
	if err != nil {
		return nil, fmt.Errorf("не удалось прочитать ответ %s: %w", what, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("%s вернул %d: %s", what, resp.StatusCode, youtubeErrorText(body))
	}
	return &youtubeBody{raw: body}, nil
}

type youtubeBody struct{ raw []byte }

func (b *youtubeBody) decode(target any) error {
	if b == nil || len(b.raw) == 0 {
		return nil
	}
	return json.Unmarshal(b.raw, target)
}

// youtubeErrorText pulls the reason out of Google's error body.
//
// The Data API answers with an object whose message is the useful part, while the OAuth endpoint uses
// error and error_description. Both are read so the settings panel can say what actually went wrong
// instead of a code the user has to look up.
func youtubeErrorText(body []byte) string {
	var oauthErr youtubeOauth2TokenWire
	if err := json.Unmarshal(body, &oauthErr); err == nil && oauthErr.Error != "" {
		if oauthErr.ErrorDescription != "" {
			return oauthErr.Error + ": " + oauthErr.ErrorDescription
		}
		return oauthErr.Error
	}

	var apiErr struct {
		Error struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
			Status  string `json:"status"`
			Errors  []struct {
				Reason  string `json:"reason"`
				Message string `json:"message"`
			} `json:"errors"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &apiErr); err == nil && apiErr.Error.Message != "" {
		if len(apiErr.Error.Errors) > 0 && apiErr.Error.Errors[0].Reason != "" {
			return fmt.Sprintf("%s (%s)", apiErr.Error.Message, apiErr.Error.Errors[0].Reason)
		}
		return apiErr.Error.Message
	}

	trimmed := strings.TrimSpace(string(body))
	if len(trimmed) > 200 {
		trimmed = trimmed[:200]
	}
	if trimmed == "" {
		return "пустой ответ"
	}
	return trimmed
}

func youtubeExpiry(seconds int) int64 {
	if seconds <= 0 {
		seconds = 3600
	}
	return time.Now().Add(time.Duration(seconds) * time.Second).UnixMilli()
}

func youtubeStatusFrom(state youtubeAuthState) youtubeAuthStatus {
	status := youtubeAuthStatus{Authorized: true, ExpiresAt: state.ExpiresAt}
	if state.ID != "" || state.Email != "" || state.Name != "" {
		status.Profile = &youtubeAuthProfile{
			ID:      state.ID,
			Email:   state.Email,
			Name:    state.Name,
			Picture: state.Picture,
		}
	}
	return status
}
