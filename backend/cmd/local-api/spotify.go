package main

import (
	"encoding/base64"
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
	spotifyDefaultAPIBase = "https://api.spotify.com"
	spotifyDefaultAuthURL = "https://accounts.spotify.com/api/token"
)

// spotifyAuthState is what survives between runs.
//
// The access token lives about an hour, so the refresh token is the part that actually matters: a
// signed-out user has to go through OAuth again, and that is the part people notice when it breaks.
//
// The client secret is deliberately not kept here. It belongs to whoever registered the app, not to
// a session, and it arrives with each request that needs it.
type spotifyAuthState struct {
	AccessToken  string `json:"accessToken"`
	RefreshToken string `json:"refreshToken"`
	// Unix milliseconds.
	ExpiresAt   int64  `json:"expiresAt"`
	Scope       string `json:"scope,omitempty"`
	ID          string `json:"id,omitempty"`
	DisplayName string `json:"displayName,omitempty"`
	Email       string `json:"email,omitempty"`
	Product     string `json:"product,omitempty"`
	SavedAt     string `json:"savedAt"`
}

type spotifyAuthProfile struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
	Email       string `json:"email,omitempty"`
	Product     string `json:"product,omitempty"`
}

type spotifyAuthStatus struct {
	Authorized bool                `json:"authorized"`
	Profile    *spotifyAuthProfile `json:"profile,omitempty"`
	ExpiresAt  int64               `json:"expiresAt,omitempty"`
}

type spotifyExchangeParams struct {
	Code         string `json:"code"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURI  string `json:"redirectUri"`
}

type spotifyRefreshParams struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

type spotifyTokenResponse struct {
	AccessToken  string `json:"access_token"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

type spotifyMeResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Email       string `json:"email"`
	Product     string `json:"product"`
}

// RPCSpotifyAuthExchange trades an authorization code for tokens.
//
// It needs no dispatcher change: rpcMethods() picks up every RPC-prefixed method with the
// (T) (R, error) shape, and rpcNameFromGo turns this name into spotify.auth.exchange.
func (s *service) RPCSpotifyAuthExchange(params spotifyExchangeParams) (spotifyAuthStatus, error) {
	if strings.TrimSpace(params.Code) == "" {
		return spotifyAuthStatus{}, errors.New("не передан код авторизации Spotify")
	}
	if strings.TrimSpace(params.ClientID) == "" || strings.TrimSpace(params.ClientSecret) == "" {
		return spotifyAuthStatus{}, errors.New("не заданы Client ID или Client Secret Spotify")
	}

	values := url.Values{}
	values.Set("grant_type", "authorization_code")
	values.Set("code", strings.TrimSpace(params.Code))
	values.Set("redirect_uri", params.RedirectURI)

	token, err := s.spotifyPostToken(values, params.ClientID, params.ClientSecret)
	if err != nil {
		return spotifyAuthStatus{}, err
	}
	if strings.TrimSpace(token.AccessToken) == "" {
		return spotifyAuthStatus{}, errors.New("Spotify не вернул токен доступа")
	}

	state := spotifyAuthState{
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    spotifyExpiry(token.ExpiresIn),
		Scope:        token.Scope,
		SavedAt:      time.Now().UTC().Format(time.RFC3339),
	}
	// A refresh response may omit the refresh token, which means keep the one already held.
	if state.RefreshToken == "" {
		state.RefreshToken = s.spotifyAuth.RefreshToken
	}
	if err := s.saveSpotifyAuth(state); err != nil {
		return spotifyAuthStatus{}, err
	}

	// The profile is a bonus. Failing to read it must not fail the sign-in: the token is already
	// valid and usable, and refusing here would send the user round the loop for nothing.
	if profile, err := s.spotifyMe(state.AccessToken); err == nil {
		state.ID = profile.ID
		state.DisplayName = profile.DisplayName
		state.Email = profile.Email
		state.Product = profile.Product
		if err := s.saveSpotifyAuth(state); err != nil {
			return spotifyAuthStatus{}, err
		}
	}
	return spotifyStatusFrom(state), nil
}

// RPCSpotifyAuthRefresh renews the access token before it runs out.
func (s *service) RPCSpotifyAuthRefresh(params spotifyRefreshParams) (spotifyAuthStatus, error) {
	if strings.TrimSpace(s.spotifyAuth.RefreshToken) == "" {
		return spotifyAuthStatus{}, errors.New("нет сохранённого refresh token Spotify")
	}
	if strings.TrimSpace(params.ClientID) == "" || strings.TrimSpace(params.ClientSecret) == "" {
		return spotifyAuthStatus{}, errors.New("не заданы Client ID или Client Secret Spotify")
	}

	values := url.Values{}
	values.Set("grant_type", "refresh_token")
	values.Set("refresh_token", s.spotifyAuth.RefreshToken)

	token, err := s.spotifyPostToken(values, params.ClientID, params.ClientSecret)
	if err != nil {
		return spotifyAuthStatus{}, err
	}

	state := s.spotifyAuth
	state.AccessToken = token.AccessToken
	state.ExpiresAt = spotifyExpiry(token.ExpiresIn)
	if token.RefreshToken != "" {
		state.RefreshToken = token.RefreshToken
	}
	if token.Scope != "" {
		state.Scope = token.Scope
	}
	state.SavedAt = time.Now().UTC().Format(time.RFC3339)

	if err := s.saveSpotifyAuth(state); err != nil {
		return spotifyAuthStatus{}, err
	}
	return spotifyStatusFrom(state), nil
}

// RPCSpotifyAuthStatus reports the stored session. It does not touch the network: the caller decides
// when to spend a round trip, and a status check that fails offline should still say "signed in".
func (s *service) RPCSpotifyAuthStatus() (spotifyAuthStatus, error) {
	if strings.TrimSpace(s.spotifyAuth.AccessToken) == "" {
		return spotifyAuthStatus{Authorized: false}, nil
	}
	return spotifyStatusFrom(s.spotifyAuth), nil
}

// RPCSpotifyAuthLogout clears the stored session.
func (s *service) RPCSpotifyAuthLogout() (spotifyAuthStatus, error) {
	s.spotifyAuth = spotifyAuthState{}
	if s.spotifyPath == "" {
		return spotifyAuthStatus{Authorized: false}, nil
	}
	if err := removeFileIfExists(s.spotifyPath); err != nil {
		return spotifyAuthStatus{}, err
	}
	return spotifyAuthStatus{Authorized: false}, nil
}

// ---- storage

func (s *service) loadSpotifyAuth() error {
	if s.spotifyPath == "" {
		return nil
	}
	data, err := os.ReadFile(s.spotifyPath)
	if errors.Is(err, os.ErrNotExist) {
		s.spotifyAuth = spotifyAuthState{}
		return nil
	}
	if err != nil {
		return fmt.Errorf("read spotify auth: %w", err)
	}
	var state spotifyAuthState
	if err := json.Unmarshal(data, &state); err != nil {
		// Unreadable storage must not stop the app; treat it as signed out.
		s.spotifyAuth = spotifyAuthState{}
		return nil
	}
	s.spotifyAuth = state
	return nil
}

func (s *service) saveSpotifyAuth(state spotifyAuthState) error {
	s.spotifyAuth = state
	if s.spotifyPath == "" {
		return nil
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	return writeSecretFile(s.spotifyPath, data)
}

// ---- http

func (s *service) spotifyPostToken(values url.Values, clientID, clientSecret string) (spotifyTokenResponse, error) {
	endpoint := s.spotifyAuthURL
	if endpoint == "" {
		endpoint = spotifyDefaultAuthURL
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	if err != nil {
		return spotifyTokenResponse{}, fmt.Errorf("не удалось сформировать запрос токена Spotify: %w", err)
	}
	// Spotify wants the credentials in HTTP Basic, not in the form body.
	req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(clientID+":"+clientSecret)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	body, err := s.spotifyJSON(req, "токен Spotify")
	if err != nil {
		return spotifyTokenResponse{}, err
	}
	return body.token()
}

func (s *service) spotifyMe(accessToken string) (spotifyMeResponse, error) {
	var profile spotifyMeResponse
	base := s.spotifyAPIBase
	if base == "" {
		base = spotifyDefaultAPIBase
	}
	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(base, "/")+"/v1/me", nil)
	if err != nil {
		return profile, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)

	body, err := s.spotifyJSON(req, "профиль Spotify")
	if err != nil {
		return profile, err
	}
	if err := body.decode(&profile); err != nil {
		return profile, fmt.Errorf("не удалось разобрать профиль Spotify: %w", err)
	}
	return profile, nil
}

// spotifyJSON performs the request and decodes a successful body into target when one is given.
//
// The Spotify error body is not the documented shape, so a failure reports whatever came back rather
// than a guessed message: "invalid_grant" and a rate limit read very differently to the person
// staring at the settings panel.
func (s *service) spotifyJSON(req *http.Request, what string) (*spotifyBody, error) {
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
		return nil, fmt.Errorf("%s вернул %d: %s", what, resp.StatusCode, spotifyErrorText(body))
	}
	return &spotifyBody{raw: body}, nil
}

type spotifyBody struct{ raw []byte }

func (b *spotifyBody) decode(target any) error {
	if b == nil || len(b.raw) == 0 {
		return nil
	}
	return json.Unmarshal(b.raw, target)
}

// token reads the token shape out of a successful response.
func (b *spotifyBody) token() (spotifyTokenResponse, error) {
	var token spotifyTokenResponse
	if err := b.decode(&token); err != nil {
		return token, fmt.Errorf("не удалось разобрать ответ Spotify: %w", err)
	}
	return token, nil
}

func spotifyErrorText(body []byte) string {
	var payload struct {
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
		Message          string `json:"message"`
	}
	if err := json.Unmarshal(body, &payload); err == nil {
		switch {
		case payload.ErrorDescription != "":
			return payload.Error + ": " + payload.ErrorDescription
		case payload.Error != "":
			return payload.Error
		case payload.Message != "":
			return payload.Message
		}
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

func spotifyExpiry(seconds int) int64 {
	if seconds <= 0 {
		// Spotify sends expires_in; a missing one means the documented hour.
		seconds = 3600
	}
	return time.Now().Add(time.Duration(seconds) * time.Second).UnixMilli()
}

func spotifyStatusFrom(state spotifyAuthState) spotifyAuthStatus {
	status := spotifyAuthStatus{Authorized: true, ExpiresAt: state.ExpiresAt}
	if state.ID != "" || state.DisplayName != "" {
		status.Profile = &spotifyAuthProfile{
			ID:          state.ID,
			DisplayName: state.DisplayName,
			Email:       state.Email,
			Product:     state.Product,
		}
	}
	return status
}
