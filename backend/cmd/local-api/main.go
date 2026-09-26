package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/net/html"
)

const (
	appName         = "BetterSoundCloud"
	appVersion      = "0.1.0"
	maxLine         = 1 << 20
	maxRecentTracks = 20

	// officialAPIBase — официальный API SoundCloud (OAuth-приложения).
	officialAPIBase = "https://api.soundcloud.com"
	// webAPIBase — Web API v2, который принимает токены веб-сессии SoundCloud.
	webAPIBase = "https://api-v2.soundcloud.com"
	// defaultUserAgent — полный браузерный User-Agent. Обрезанная строка вида
	// "AppleWebKit/537.36" без "(KHTML, like Gecko)" и версии браузера не
	// сопоставляется DataDome, поэтому используется целый заголовок.
	defaultUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
		"(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

// errTokenRejected означает, что SoundCloud отклонил токен (401/403),
// а не то, что сервис недоступен.
var errTokenRejected = errors.New("SoundCloud отклонил токен, проверьте, что вставлен действующий access token")

type request struct {
	ID     uint64          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params"`
}

type response struct {
	ID     uint64 `json:"id"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

type appInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Backend string `json:"backend"`
}

type emptyParams struct{}

type settings struct {
	Accent          string `json:"accent"`
	Compact         bool   `json:"compact"`
	Volume          int    `json:"volume"`
	ClientID        string `json:"clientId"`
	BackgroundImage string `json:"backgroundImage"`
	BackgroundBlur  int    `json:"backgroundBlur"`
}

type settingsPatch struct {
	Accent          *string `json:"accent"`
	Compact         *bool   `json:"compact"`
	Volume          *int    `json:"volume"`
	ClientID        *string `json:"clientId"`
	BackgroundImage *string `json:"backgroundImage"`
	BackgroundBlur  *int    `json:"backgroundBlur"`
}

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

type loginParams struct {
	Token string `json:"token"`
}

type trackLikeParams struct {
	TrackID        int64  `json:"trackId"`
	TrackURN       string `json:"trackUrn"`
	DataDomeCookie string `json:"datadomeCookie,omitempty"`
	// UserAgent — идентичность webview, который прошёл проверку DataDome.
	// Повтор запроса должен предъявлять тот же User-Agent, иначе cookie
	// проверки не совпадёт с клиентом и SoundCloud вернёт 403 снова.
	UserAgent string `json:"userAgent,omitempty"`
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

type trackDetailsParams struct {
	TrackID int64 `json:"trackId"`
}

type trackLyricsParams struct {
	TrackID    int64  `json:"trackId"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	DurationMs int64  `json:"durationMs"`
}

type geniusSearchResponse struct {
	Response struct {
		Hits []struct {
			Result struct {
				URL           string `json:"url"`
				Title         string `json:"title"`
				PrimaryArtist struct {
					Name string `json:"name"`
				} `json:"primary_artist"`
			} `json:"result"`
		} `json:"hits"`
	} `json:"response"`
}

type trackLyrics struct {
	TrackID   int64        `json:"trackId"`
	Lines     []lyricsLine `json:"lines"`
	SourceURL string       `json:"sourceUrl,omitempty"`
	IsSynced  bool         `json:"isSynced,omitempty"`
}

type lyricsLine struct {
	ID      string `json:"id"`
	Text    string `json:"text"`
	StartMs int64  `json:"startMs"`
}

type playlistTracksParams struct {
	PlaylistURN string `json:"playlistUrn"`
}

type searchTracksParams struct {
	Query string `json:"query"`
}

type relatedTracksParams struct {
	TrackID int64 `json:"trackId"`
}

type userProfileParams struct {
	UserID int64 `json:"userId"`
}

type soundcloudUserProfile struct {
	ID              int64  `json:"id"`
	Username        string `json:"username"`
	FullName        string `json:"fullName,omitempty"`
	PermalinkURL    string `json:"permalinkUrl,omitempty"`
	AvatarURL       string `json:"avatarUrl,omitempty"`
	BannerURL       string `json:"bannerUrl,omitempty"`
	Description     string `json:"description,omitempty"`
	City            string `json:"city,omitempty"`
	Country         string `json:"country,omitempty"`
	FollowersCount  int64  `json:"followersCount"`
	FollowingsCount int64  `json:"followingsCount"`
	TrackCount      int64  `json:"trackCount"`
	Verified        bool   `json:"verified,omitempty"`
}

type historyTrackParams struct {
	Track soundcloudTrackCard `json:"track"`
}

type mixedSelection struct {
	ID          string                   `json:"id"`
	Title       string                   `json:"title"`
	Description string                   `json:"description,omitempty"`
	Tracks      []soundcloudSearchTrack  `json:"tracks"`
	Playlists   []soundcloudPlaylistCard `json:"playlists,omitempty"`
	MadeForYou  bool                     `json:"madeForYou,omitempty"`
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
		ID             int64  `json:"id"`
		Username       string `json:"username"`
		AvatarURL      string `json:"avatarUrl"`
		PermalinkURL   string `json:"permalinkUrl"`
		FollowersCount int64  `json:"followersCount"`
	} `json:"user"`
}

type service struct {
	mu           sync.Mutex
	settingsPath string
	settings     settings
	authPath     string
	auth         authState
	historyPath  string
	history      []soundcloudTrackCard
	apiBase      string
	httpClient   *http.Client
	pacer        requestPacer
}

const (
	// soundCloudRequestGap is the minimum pause between two calls to
	// SoundCloud. The UI fires several loads at once on start, and DataDome
	// answers bursts with a captcha or a temporary address block.
	soundCloudRequestGap = 350 * time.Millisecond
	// trackWarmUpPause separates opening a track from reacting to it, the way
	// the working reference script in scripts/like.py does.
	trackWarmUpPause = 800 * time.Millisecond
	// soundCloudBurstPenalty is added to the gap after HTTP 429.
	soundCloudBurstPenalty = 5 * time.Second
	// maxRequestPenalty caps the penalty so a single 429 cannot stall the
	// sidecar for minutes.
	maxRequestPenalty = 30 * time.Second
)

// requestPacer spaces requests out and remembers a penalty. The zero value
// disables pacing, which keeps tests fast.
type requestPacer struct {
	mu           sync.Mutex
	gap          time.Duration
	warmUpPause  time.Duration
	penalty      time.Duration
	penaltyUntil time.Time
	next         time.Time
}

func newRequestPacer(gap, warmUpPause time.Duration) requestPacer {
	return requestPacer{gap: gap, warmUpPause: warmUpPause}
}

// reserve claims the next slot and reports how long the caller must wait.
func (p *requestPacer) reserve() time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	if !p.penaltyUntil.IsZero() && now.After(p.penaltyUntil) {
		p.penalty = 0
		p.penaltyUntil = time.Time{}
	}
	// The cursor only ever moves forward from the slot that was handed out
	// last, otherwise every call would measure from its own start and the
	// spacing would collapse to a single gap.
	ready := p.next
	if ready.Before(now) {
		ready = now
	}
	p.next = ready.Add(p.gap + p.penalty)
	return ready.Sub(now)
}

// wait blocks until the previously reserved slot has passed.
func (p *requestPacer) wait(ctx context.Context) error {
	if p.gap <= 0 {
		return nil
	}
	return sleep(ctx, p.reserve())
}

// pause waits between two related requests, for example opening a track before
// liking it. It is a no-op while pacing is disabled.
func (p *requestPacer) pause(ctx context.Context) error {
	if p.gap <= 0 || p.warmUpPause <= 0 {
		return nil
	}
	return sleep(ctx, p.warmUpPause)
}

// penalize pushes the following requests away after a rate limit, doubling the
// penalty while the server keeps complaining and letting it decay afterwards.
func (p *requestPacer) penalize(d time.Duration) {
	if p.gap <= 0 || d <= 0 {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	now := time.Now()
	switch {
	case p.penaltyUntil.IsZero() || now.After(p.penaltyUntil):
		p.penalty = d
	case p.penalty < maxRequestPenalty:
		p.penalty *= 2
		if p.penalty > maxRequestPenalty {
			p.penalty = maxRequestPenalty
		}
	}
	p.penaltyUntil = now.Add(p.penalty)
}

func sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// isSoundCloudHost reports whether a request targets SoundCloud itself, so
// Genius and lyric lookups are not paced against the same budget.
func isSoundCloudHost(host string) bool {
	host = strings.ToLower(host)
	return host == "soundcloud.com" || strings.HasSuffix(host, ".soundcloud.com")
}

// send performs a request, pacing calls to SoundCloud. A 429 stretches the gap
// for the requests that follow.
func (s *service) send(req *http.Request) (*http.Response, error) {
	soundcloud := isSoundCloudHost(req.URL.Hostname())
	if soundcloud {
		if err := s.pacer.wait(req.Context()); err != nil {
			return nil, err
		}
	}
	resp, err := s.httpClient.Do(req)
	if err == nil && soundcloud && resp.StatusCode == http.StatusTooManyRequests {
		s.pacer.penalize(soundCloudBurstPenalty)
	}
	return resp, err
}

// warmUpBase returns the host used to open a track before liking it: the web
// API when it is reachable, otherwise whatever host is configured.
func (s *service) warmUpBase() string {
	bases := s.apiBases()
	for _, base := range bases {
		if base == webAPIBase {
			return base
		}
	}
	if len(bases) > 0 {
		return bases[0]
	}
	return ""
}
func main() {
	if err := run(os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "local backend:", err)
		os.Exit(1)
	}
}

func run(input io.Reader, output io.Writer) error {
	loadGeniusKeyFromDotEnv()
	dataDir, err := appDataDir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return fmt.Errorf("create app data directory: %w", err)
	}

	svc := &service{
		settingsPath: filepath.Join(dataDir, "settings.json"),
		settings:     defaultSettings(),
		authPath:     filepath.Join(dataDir, "auth.json"),
		historyPath:  filepath.Join(dataDir, "history.json"),
		apiBase:      apiBase(),
		httpClient:   &http.Client{Timeout: 15 * time.Second},
		pacer:        newRequestPacer(soundCloudRequestGap, trackWarmUpPause),
	}
	if err := svc.loadSettings(); err != nil {
		return err
	}
	// Повреждённое или нечитаемое хранилище токена не должно мешать запуску:
	// работаем как неавторизованные, диагностика уходит в stderr.
	if err := svc.loadAuth(); err != nil {
		fmt.Fprintln(os.Stderr, "local backend: auth state ignored:", err)
	}
	if err := svc.loadHistory(); err != nil {
		fmt.Fprintln(os.Stderr, "local backend: playback history ignored:", err)
	}
	if os.Getenv("BSC_SWAGGER") == "1" {
		if err := startSwaggerServer(svc); err != nil {
			log.Printf("swagger server unavailable: %v", err)
		}
	}

	scanner := bufio.NewScanner(input)
	scanner.Buffer(make([]byte, 4096), maxLine)
	writer := bufio.NewWriter(output)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			if err := writeResponse(writer, response{Error: "invalid request"}); err != nil {
				return err
			}
			continue
		}

		result, callErr := svc.call(req.Method, req.Params)
		res := response{ID: req.ID, Result: result}
		if callErr != nil {
			res.Result = nil
			res.Error = callErr.Error()
		}
		if err := writeResponse(writer, res); err != nil {
			return err
		}
	}
	return scanner.Err()
}

// loadGeniusKeyFromDotEnv supports a project-local .env during development. Packaged builds should
// receive GENIUS_API_KEY from the process environment; the file is never created or logged here.
func loadGeniusKeyFromDotEnv() {
	if strings.TrimSpace(os.Getenv("GENIUS_API_KEY")) != "" {
		return
	}
	dir, err := os.Getwd()
	if err != nil {
		return
	}
	for depth := 0; depth < 4; depth++ {
		file, err := os.Open(filepath.Join(dir, ".env"))
		if err == nil {
			scanner := bufio.NewScanner(file)
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if strings.HasPrefix(line, "GENIUS_API_KEY=") {
					value := strings.TrimSpace(strings.TrimPrefix(line, "GENIUS_API_KEY="))
					value = strings.Trim(value, "\"'")
					if value != "" {
						_ = os.Setenv("GENIUS_API_KEY", value)
					}
					break
				}
			}
			_ = file.Close()
			if strings.TrimSpace(os.Getenv("GENIUS_API_KEY")) != "" {
				return
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return
		}
		dir = parent
	}
}

const swaggerHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BetterSoundCloud Go API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>window.onload=()=>SwaggerUIBundle({url:'/openapi.json',dom_id:'#swagger-ui',deepLinking:true});</script>
</body></html>`

func startSwaggerServer(svc *service) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	address := "http://" + listener.Addr().String()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, swaggerHTML)
	})
	mux.HandleFunc("GET /openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(buildOpenAPISpec(address))
	})
	mux.HandleFunc("POST /rpc", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		defer r.Body.Close()
		var req request
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxLine)).Decode(&req); err != nil || req.Method == "" {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(response{Error: "invalid request"})
			return
		}
		result, callErr := svc.call(req.Method, req.Params)
		res := response{ID: req.ID, Result: result}
		if callErr != nil {
			res.Result = nil
			res.Error = callErr.Error()
			w.WriteHeader(http.StatusBadRequest)
		}
		_ = json.NewEncoder(w).Encode(res)
	})
	server := &http.Server{Handler: loopbackOnly(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("swagger server stopped: %v", err)
		}
	}()
	log.Printf("Swagger UI: %s/", address)
	return nil
}

func loopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || (host != "127.0.0.1" && host != "localhost") {
			http.Error(w, "loopback access only", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type rpcMethodSpec struct {
	goName string
	params reflect.Type
	result reflect.Type
}

func rpcMethods() map[string]rpcMethodSpec {
	methods := map[string]rpcMethodSpec{}
	errorType := reflect.TypeOf((*error)(nil)).Elem()
	serviceType := reflect.TypeOf((*service)(nil))
	for i := 0; i < serviceType.NumMethod(); i++ {
		method := serviceType.Method(i)
		if !strings.HasPrefix(method.Name, "RPC") || method.Type.NumIn() != 2 || method.Type.NumOut() != 2 || method.Type.Out(1) != errorType {
			continue
		}
		apiName := rpcNameFromGo(method.Name)
		methods[apiName] = rpcMethodSpec{goName: method.Name, params: method.Type.In(1), result: method.Type.Out(0)}
	}
	return methods
}

func rpcNameFromGo(goName string) string {
	runes := []rune(strings.TrimPrefix(goName, "RPC"))
	var result strings.Builder
	for i, current := range runes {
		if i > 0 && unicode.IsUpper(current) {
			previous := runes[i-1]
			nextIsLower := i+1 < len(runes) && unicode.IsLower(runes[i+1])
			if unicode.IsLower(previous) || unicode.IsDigit(previous) || (unicode.IsUpper(previous) && nextIsLower) {
				result.WriteByte('.')
			}
		}
		result.WriteRune(unicode.ToLower(current))
	}
	return result.String()
}

func buildOpenAPISpec(serverURL string) map[string]any {
	methods := rpcMethods()
	names := make([]string, 0, len(methods))
	for name := range methods {
		names = append(names, name)
	}
	sort.Strings(names)

	schemas := map[string]any{}
	requestVariants := make([]any, 0, len(names))
	resultVariants := make([]any, 0, len(names))
	for _, name := range names {
		spec := methods[name]
		methodSchemaName := "RPCRequest_" + strings.ReplaceAll(name, ".", "_")
		paramsSchema := schemaForGoType(spec.params, schemas)
		schemas[methodSchemaName] = map[string]any{
			"type": "object", "required": []string{"method", "params"},
			"properties": map[string]any{
				"id":     map[string]any{"type": "integer", "format": "int64", "example": 1},
				"method": map[string]any{"type": "string", "enum": []string{name}},
				"params": paramsSchema,
			},
		}
		requestVariants = append(requestVariants, map[string]any{"$ref": "#/components/schemas/" + methodSchemaName})
		resultVariants = append(resultVariants, schemaForGoType(spec.result, schemas))
	}
	schemas["RPCRequest"] = map[string]any{"oneOf": requestVariants}
	schemas["RPCResult"] = map[string]any{"oneOf": resultVariants, "nullable": true}
	schemas["RPCResponse"] = map[string]any{
		"type": "object", "properties": map[string]any{
			"id":     map[string]any{"type": "integer", "format": "int64"},
			"result": map[string]any{"$ref": "#/components/schemas/RPCResult"},
			"error":  map[string]any{"type": "string"},
		},
	}
	return map[string]any{
		"openapi": "3.0.3",
		"info": map[string]any{
			"title": "BetterSoundCloud local Go sidecar", "version": appVersion,
			"description": "Development-only HTTP bridge for the sidecar JSON-RPC methods. Request and result schemas are generated from Go types.",
		},
		"servers": []any{map[string]any{"url": serverURL}},
		"paths": map[string]any{
			"/rpc": map[string]any{"post": map[string]any{
				"operationId": "callSidecarMethod", "summary": "Call a Go sidecar method",
				"description": "The request model is a oneOf of every registered Go method and its typed params.",
				"requestBody": map[string]any{"required": true, "content": map[string]any{"application/json": map[string]any{
					"schema": map[string]any{"$ref": "#/components/schemas/RPCRequest"},
				}}},
				"responses": map[string]any{
					"200": map[string]any{"description": "JSON-RPC response", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/RPCResponse"}}}},
					"400": map[string]any{"description": "Invalid request or method error", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/RPCResponse"}}}},
				},
			}},
		},
		"components": map[string]any{"schemas": schemas},
	}
}

func schemaForGoType(t reflect.Type, components map[string]any) any {
	if t == reflect.TypeOf(json.RawMessage{}) {
		return map[string]any{"type": "object", "additionalProperties": true}
	}
	switch t.Kind() {
	case reflect.Pointer:
		inner := schemaForGoType(t.Elem(), components)
		if schema, ok := inner.(map[string]any); ok {
			copy := make(map[string]any, len(schema)+1)
			for key, value := range schema {
				copy[key] = value
			}
			copy["nullable"] = true
			return copy
		}
		return inner
	case reflect.Struct:
		if t.Name() == "" {
			return structSchema(t, components)
		}
		name := t.Name()
		if _, exists := components[name]; !exists {
			components[name] = map[string]any{"type": "object", "properties": map[string]any{}}
			components[name] = structSchema(t, components)
		}
		return map[string]any{"$ref": "#/components/schemas/" + name}
	case reflect.Slice, reflect.Array:
		return map[string]any{"type": "array", "items": schemaForGoType(t.Elem(), components)}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": schemaForGoType(t.Elem(), components)}
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32:
		return map[string]any{"type": "integer", "format": "int32"}
	case reflect.Int64:
		return map[string]any{"type": "integer", "format": "int64"}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return map[string]any{"type": "integer", "format": "int64", "minimum": 0}
	case reflect.Float32:
		return map[string]any{"type": "number", "format": "float"}
	case reflect.Float64:
		return map[string]any{"type": "number", "format": "double"}
	case reflect.Interface:
		return map[string]any{}
	default:
		return map[string]any{}
	}
}

func structSchema(t reflect.Type, components map[string]any) map[string]any {
	properties := map[string]any{}
	required := []string{}
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		parts := strings.Split(field.Tag.Get("json"), ",")
		name := parts[0]
		if name == "-" {
			continue
		}
		if name == "" {
			name = strings.ToLower(field.Name[:1]) + field.Name[1:]
		}
		properties[name] = schemaForGoType(field.Type, components)
		optional := field.Type.Kind() == reflect.Pointer
		for _, option := range parts[1:] {
			if option == "omitempty" {
				optional = true
			}
		}
		if !optional {
			required = append(required, name)
		}
	}
	schema := map[string]any{"type": "object", "properties": properties}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func (s *service) call(method string, params json.RawMessage) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	startedAt := time.Now()
	log.Printf("rpc stage=received method=%q params_bytes=%d", method, len(params))
	spec, ok := rpcMethods()[method]
	if !ok {
		log.Printf("rpc stage=dispatch_error method=%q error=%q", method, "unknown method")
		return nil, errors.New("unknown method")
	}
	paramsValue := reflect.New(spec.params)
	if len(params) == 0 {
		params = json.RawMessage(`{}`)
	}
	if err := json.Unmarshal(params, paramsValue.Interface()); err != nil {
		wrapped := fmt.Errorf("invalid %s payload: %w", method, err)
		log.Printf("rpc stage=decode_error method=%q params_type=%s error=%q", method, spec.params, wrapped.Error())
		return nil, wrapped
	}
	methodValue := reflect.ValueOf(s).MethodByName(spec.goName)
	if !methodValue.IsValid() {
		log.Printf("rpc stage=dispatch_error method=%q go_method=%q error=%q", method, spec.goName, "method disappeared after discovery")
		return nil, errors.New("unknown method")
	}
	outputs := methodValue.Call([]reflect.Value{paramsValue.Elem()})
	if !outputs[1].IsNil() {
		err := outputs[1].Interface().(error)
		log.Printf("rpc stage=handler_error method=%q go_method=%q elapsed_ms=%d error=%q", method, spec.goName, time.Since(startedAt).Milliseconds(), err.Error())
		return nil, err
	}
	log.Printf("rpc stage=complete method=%q result_type=%s elapsed_ms=%d", method, spec.result, time.Since(startedAt).Milliseconds())
	return outputs[0].Interface(), nil
}

// Exported methods prefixed with RPC are discovered automatically, published
// by the JSON-RPC dispatcher, and included in the generated OpenAPI schemas.
func (s *service) RPCAppInfo(_ emptyParams) (appInfo, error) {
	return appInfo{Name: appName, Version: appVersion, Backend: "go-sidecar"}, nil
}

func (s *service) RPCSettingsGet(_ emptyParams) (settings, error) {
	return s.settings, nil
}

func (s *service) RPCSettingsUpdate(patch settingsPatch) (settings, error) {
	updated := s.settings
	if patch.Accent != nil {
		if !validAccent(*patch.Accent) {
			return settings{}, errors.New("accent must be a six-digit hex color")
		}
		updated.Accent = strings.ToLower(*patch.Accent)
	}
	if patch.Compact != nil {
		updated.Compact = *patch.Compact
	}
	if patch.Volume != nil {
		if *patch.Volume < 0 || *patch.Volume > 100 {
			return settings{}, errors.New("volume must be between 0 and 100")
		}
		updated.Volume = *patch.Volume
	}
	if patch.ClientID != nil {
		clientID := strings.TrimSpace(*patch.ClientID)
		if !validSoundCloudClientID(clientID) {
			return settings{}, errors.New("client_id должен содержать от 8 до 128 латинских букв, цифр, дефисов или подчёркиваний")
		}
		updated.ClientID = clientID
	}
	if patch.BackgroundImage != nil {
		if !validBackgroundImage(*patch.BackgroundImage) {
			return settings{}, errors.New("background image must be a JPEG data URL under 700 KB")
		}
		updated.BackgroundImage = *patch.BackgroundImage
	}
	if patch.BackgroundBlur != nil {
		if *patch.BackgroundBlur < 0 || *patch.BackgroundBlur > 24 {
			return settings{}, errors.New("background blur must be between 0 and 24")
		}
		updated.BackgroundBlur = *patch.BackgroundBlur
	}
	if err := s.saveSettings(updated); err != nil {
		return settings{}, fmt.Errorf("save settings: %w", err)
	}
	s.settings = updated
	return updated, nil
}

// RPCSettingsClear clears locally persisted account credentials and preferences.
func (s *service) RPCSettingsClear(_ emptyParams) (settings, error) {
	if err := s.clearAuth(); err != nil {
		return settings{}, fmt.Errorf("clear auth: %w", err)
	}
	if err := removeFileIfExists(s.settingsPath); err != nil {
		return settings{}, fmt.Errorf("clear settings: %w", err)
	}
	if err := removeFileIfExists(s.historyPath); err != nil {
		return settings{}, fmt.Errorf("clear history: %w", err)
	}
	s.auth = authState{}
	s.settings = defaultSettings()
	s.history = nil
	return s.settings, nil
}

func (s *service) RPCHistoryList(_ emptyParams) ([]soundcloudTrackCard, error) {
	return append([]soundcloudTrackCard{}, s.history...), nil
}

func (s *service) RPCHistoryRecord(params historyTrackParams) ([]soundcloudTrackCard, error) {
	track := params.Track
	if track.ID <= 0 || strings.TrimSpace(track.Title) == "" {
		return nil, errors.New("для записи истории нужны корректные ID и название трека")
	}
	if track.TrackURN == "" {
		track.TrackURN = fmt.Sprintf("soundcloud:tracks:%d", track.ID)
	}
	updated := make([]soundcloudTrackCard, 0, maxRecentTracks)
	updated = append(updated, track)
	for _, existing := range s.history {
		if existing.ID == track.ID {
			continue
		}
		updated = append(updated, existing)
		if len(updated) == maxRecentTracks {
			break
		}
	}
	if err := s.saveHistory(updated); err != nil {
		return nil, fmt.Errorf("save playback history: %w", err)
	}
	s.history = updated
	return append([]soundcloudTrackCard{}, updated...), nil
}

func (s *service) RPCHistoryClear(_ emptyParams) ([]soundcloudTrackCard, error) {
	if err := removeFileIfExists(s.historyPath); err != nil {
		return nil, fmt.Errorf("clear playback history: %w", err)
	}
	s.history = nil
	return []soundcloudTrackCard{}, nil
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

func (s *service) RPCTracksMine(_ emptyParams) ([]soundcloudTrackCard, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	return s.fetchMyTracks(s.auth.Token, s.auth.Profile.ID)
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

func (s *service) RPCTrackLyrics(params trackLyricsParams) (trackLyrics, error) {
	if params.TrackID <= 0 || strings.TrimSpace(params.Title) == "" {
		return trackLyrics{}, errors.New("некорректные данные трека")
	}
	if synced, ok := s.fetchSyncedLyrics(params); ok {
		return synced, nil
	}
	apiKey := strings.TrimSpace(os.Getenv("GENIUS_API_KEY"))
	if apiKey == "" {
		return trackLyrics{}, errors.New("не задан GENIUS_API_KEY")
	}
	query := strings.TrimSpace(params.Artist + " " + params.Title)
	searchURL := "https://api.genius.com/search?q=" + url.QueryEscape(query)
	searchReq, err := http.NewRequest(http.MethodGet, searchURL, nil)
	if err != nil {
		return trackLyrics{}, err
	}
	searchReq.Header.Set("Authorization", "Bearer "+apiKey)
	searchResp, err := s.httpClient.Do(searchReq)
	if err != nil {
		return trackLyrics{}, fmt.Errorf("ошибка поиска Genius: %w", err)
	}
	defer searchResp.Body.Close()
	if searchResp.StatusCode != http.StatusOK {
		return trackLyrics{}, fmt.Errorf("Genius API вернул статус %d", searchResp.StatusCode)
	}
	var result geniusSearchResponse
	if err := json.NewDecoder(io.LimitReader(searchResp.Body, 4<<20)).Decode(&result); err != nil {
		return trackLyrics{}, fmt.Errorf("не удалось прочитать ответ Genius: %w", err)
	}
	if len(result.Response.Hits) == 0 {
		return trackLyrics{TrackID: params.TrackID, Lines: []lyricsLine{}}, nil
	}
	pageURL := result.Response.Hits[0].Result.URL
	parsedURL, err := url.Parse(pageURL)
	if err != nil || parsedURL.Hostname() != "genius.com" && !strings.HasSuffix(parsedURL.Hostname(), ".genius.com") {
		return trackLyrics{}, errors.New("Genius вернул некорректную ссылку")
	}
	pageReq, _ := http.NewRequest(http.MethodGet, pageURL, nil)
	pageReq.Header.Set("User-Agent", defaultUserAgent)
	pageResp, err := s.httpClient.Do(pageReq)
	if err != nil {
		return trackLyrics{}, fmt.Errorf("ошибка загрузки страницы Genius: %w", err)
	}
	defer pageResp.Body.Close()
	if pageResp.StatusCode != http.StatusOK {
		return trackLyrics{}, fmt.Errorf("страница Genius вернула статус %d", pageResp.StatusCode)
	}
	doc, err := html.Parse(io.LimitReader(pageResp.Body, 8<<20))
	if err != nil {
		return trackLyrics{}, fmt.Errorf("не удалось прочитать страницу Genius: %w", err)
	}
	var blocks []*html.Node
	var walk func(*html.Node)
	walk = func(node *html.Node) {
		if node.Type == html.ElementNode {
			for _, attr := range node.Attr {
				if attr.Key == "class" && strings.Contains(attr.Val, "Lyrics__Container") {
					blocks = append(blocks, node)
					return
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}
	walk(doc)
	var lines []lyricsLine
	for _, block := range blocks {
		var collect func(*html.Node)
		collect = func(node *html.Node) {
			if node.Type == html.ElementNode && node.Data == "br" {
				lines = append(lines, lyricsLine{Text: ""})
				return
			}
			if node.Type == html.TextNode {
				for _, part := range strings.Split(node.Data, "\n") {
					text := strings.TrimSpace(part)
					if text != "" && !(strings.HasPrefix(text, "[") && strings.HasSuffix(text, "]")) {
						lines = append(lines, lyricsLine{Text: text})
					}
				}
			}
			for child := node.FirstChild; child != nil; child = child.NextSibling {
				collect(child)
			}
		}
		collect(block)
	}
	lines = stripGeniusPagePreamble(lines)
	clean := lines[:0]
	for _, line := range lines {
		if line.Text == "" {
			if len(clean) > 0 && clean[len(clean)-1].Text != "" {
				clean = append(clean, line)
			}
			continue
		}
		line.ID = fmt.Sprintf("genius-%d", len(clean))
		clean = append(clean, line)
	}
	for len(clean) > 0 && clean[len(clean)-1].Text == "" {
		clean = clean[:len(clean)-1]
	}
	return trackLyrics{TrackID: params.TrackID, Lines: clean, SourceURL: pageURL}, nil
}

// Genius sometimes puts its page header and song description in the same container as the
// lyrics. Start at the first verse marker when present; otherwise drop the page intro through
// its “Read More” control. This keeps page chrome out of the lyrics sidebar without assuming
// that every song has section labels.
func stripGeniusPagePreamble(lines []lyricsLine) []lyricsLine {
	for index, line := range lines {
		if isGeniusSectionHeading(line.Text) {
			return lines[index+1:]
		}
	}
	for index, line := range lines {
		if strings.Contains(strings.ToLower(strings.TrimSpace(line.Text)), "read more") {
			return lines[index+1:]
		}
	}
	return lines
}

func isGeniusSectionHeading(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) < 3 || value[0] != '[' || value[len(value)-1] != ']' {
		return false
	}
	heading := strings.ToLower(strings.TrimSpace(value[1 : len(value)-1]))
	for _, prefix := range []string{
		"intro", "verse", "chorus", "pre-chorus", "post-chorus", "bridge", "outro", "hook", "refrain", "part",
		"интро", "куплет", "припев", "предприпев", "постприпев", "бридж", "аутро",
	} {
		if strings.HasPrefix(heading, prefix) {
			return true
		}
	}
	return false
}

type lrclibLyricsResponse struct {
	SyncedLyrics string `json:"syncedLyrics"`
}

func (s *service) fetchSyncedLyrics(params trackLyricsParams) (trackLyrics, bool) {
	query := url.Values{}
	query.Set("track_name", params.Title)
	query.Set("artist_name", params.Artist)
	if params.DurationMs > 0 {
		query.Set("duration", strconv.FormatInt((params.DurationMs+500)/1000, 10))
	}
	req, err := http.NewRequest(http.MethodGet, "https://lrclib.net/api/get?"+query.Encode(), nil)
	if err != nil {
		return trackLyrics{}, false
	}
	req.Header.Set("User-Agent", "BetterSoundCloud/0.1.0 (lyrics sidebar)")
	resp, err := s.httpClient.Do(req)
	if err != nil {
		return trackLyrics{}, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return trackLyrics{}, false
	}
	var payload lrclibLyricsResponse
	if json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(&payload) != nil {
		return trackLyrics{}, false
	}
	lines := parseLRC(payload.SyncedLyrics)
	if len(lines) == 0 {
		return trackLyrics{}, false
	}
	return trackLyrics{TrackID: params.TrackID, Lines: lines, SourceURL: "https://lrclib.net", IsSynced: true}, true
}

func parseLRC(content string) []lyricsLine {
	var lines []lyricsLine
	for _, row := range strings.Split(content, "\n") {
		row = strings.TrimSpace(row)
		for strings.HasPrefix(row, "[") {
			end := strings.IndexByte(row, ']')
			if end < 0 {
				break
			}
			timestamp := row[1:end]
			parts := strings.Split(timestamp, ":")
			if len(parts) != 2 {
				break
			}
			minutes, errM := strconv.ParseInt(parts[0], 10, 64)
			seconds, errS := strconv.ParseFloat(parts[1], 64)
			if errM != nil || errS != nil {
				break
			}
			text := strings.TrimSpace(row[end+1:])
			if text != "" {
				lines = append(lines, lyricsLine{ID: fmt.Sprintf("lrclib-%d", len(lines)), Text: text, StartMs: minutes*60_000 + int64(seconds*1000)})
			}
			row = row[end+1:]
		}
	}
	return lines
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
			ID             int64  `json:"id"`
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
	result.User.ID = track.User.ID
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

func (s *service) RPCUserProfile(params userProfileParams) (soundcloudUserProfile, error) {
	if s.auth.Token == "" {
		return soundcloudUserProfile{}, errors.New("сначала подключите аккаунт SoundCloud")
	}
	if params.UserID <= 0 {
		return soundcloudUserProfile{}, errors.New("некорректный ID пользователя")
	}
	endpoint, err := s.soundcloudV2URL("/users/"+strconv.FormatInt(params.UserID, 10), nil)
	if err != nil {
		return soundcloudUserProfile{}, fmt.Errorf("не удалось сформировать запрос профиля: %w", err)
	}
	var user struct {
		ID              int64  `json:"id"`
		Username        string `json:"username"`
		FullName        string `json:"full_name"`
		PermalinkURL    string `json:"permalink_url"`
		AvatarURL       string `json:"avatar_url"`
		Description     string `json:"description"`
		City            string `json:"city"`
		CountryCode     string `json:"country_code"`
		FollowersCount  int64  `json:"followers_count"`
		FollowingsCount int64  `json:"followings_count"`
		TrackCount      int64  `json:"track_count"`
		Verified        bool   `json:"verified"`
		Visuals         struct {
			Visuals []struct {
				VisualURL string `json:"visual_url"`
				URLs      struct {
					URL string `json:"url"`
				} `json:"urls"`
			} `json:"visuals"`
		} `json:"visuals"`
	}
	startedAt := time.Now()
	log.Printf("user.profile stage=request user_id=%d", params.UserID)
	if err := s.getSoundCloudJSON(endpoint, &user); err != nil {
		log.Printf("user.profile stage=failed user_id=%d elapsed_ms=%d error=%q", params.UserID, time.Since(startedAt).Milliseconds(), err.Error())
		return soundcloudUserProfile{}, fmt.Errorf("не удалось загрузить профиль автора: %w", err)
	}
	avatar := user.AvatarURL
	if avatar != "" {
		avatar = strings.Replace(avatar, "-large.", "-t500x500.", 1)
	}
	banner := ""
	if len(user.Visuals.Visuals) > 0 {
		visual := user.Visuals.Visuals[0]
		if visual.VisualURL != "" {
			banner = visual.VisualURL
		} else {
			banner = visual.URLs.URL
		}
	}
	result := soundcloudUserProfile{
		ID: user.ID, Username: user.Username, FullName: user.FullName, PermalinkURL: user.PermalinkURL,
		AvatarURL: avatar, BannerURL: banner, Description: user.Description, City: user.City, Country: user.CountryCode,
		FollowersCount: user.FollowersCount, FollowingsCount: user.FollowingsCount, TrackCount: user.TrackCount, Verified: user.Verified,
	}
	log.Printf("user.profile stage=complete user_id=%d elapsed_ms=%d", params.UserID, time.Since(startedAt).Milliseconds())
	return result, nil
}

func (s *service) RPCUserTracks(params userProfileParams) ([]soundcloudTrackCard, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	if params.UserID <= 0 {
		return nil, errors.New("некорректный ID пользователя")
	}
	query := url.Values{}
	query.Set("limit", "40")
	query.Set("linked_partitioning", "true")
	endpoint, err := s.soundcloudV2URL("/users/"+strconv.FormatInt(params.UserID, 10)+"/tracks", query)
	if err != nil {
		return nil, fmt.Errorf("не удалось сформировать запрос треков автора: %w", err)
	}
	var response struct {
		Collection []soundcloudTrack `json:"collection"`
	}
	startedAt := time.Now()
	log.Printf("user.tracks stage=request user_id=%d", params.UserID)
	if err := s.getSoundCloudJSON(endpoint, &response); err != nil {
		log.Printf("user.tracks stage=failed user_id=%d elapsed_ms=%d error=%q", params.UserID, time.Since(startedAt).Milliseconds(), err.Error())
		return nil, fmt.Errorf("не удалось загрузить треки автора: %w", err)
	}
	result := make([]soundcloudTrackCard, 0, len(response.Collection))
	for _, track := range response.Collection {
		artwork := track.ArtworkURL
		if artwork != "" {
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
	log.Printf("user.tracks stage=complete user_id=%d count=%d elapsed_ms=%d", params.UserID, len(result), time.Since(startedAt).Milliseconds())
	return result, nil
}

func (s *service) RPCUserPlaylists(params userProfileParams) ([]soundcloudPlaylistCard, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	if params.UserID <= 0 {
		return nil, errors.New("некорректный ID пользователя")
	}
	var lastErr error
	for _, base := range s.apiBases() {
		endpoint, err := url.Parse(strings.TrimRight(base, "/") + fmt.Sprintf("/users/%d/playlists", params.UserID))
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
		log.Printf("user.playlists stage=fallback host=%s error=%q", hostForLog(base), err.Error())
	}
	if lastErr == nil {
		lastErr = errors.New("SoundCloud API не вернул плейлисты автора")
	}
	return nil, fmt.Errorf("не удалось загрузить плейлисты автора: %w", lastErr)
}

func (s *service) RPCMixedSelections(_ emptyParams) ([]mixedSelection, error) {
	if s.auth.Token == "" {
		return nil, errors.New("сначала подключите аккаунт SoundCloud")
	}
	query := url.Values{}
	query.Set("oauth_token", s.auth.Token)
	endpoint, err := s.soundcloudV2URL("/mixed-selections", query)
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
		selection := mixedSelection{
			ID:          item.ID,
			Title:       item.Title,
			Description: item.Description,
			Tracks:      make([]soundcloudSearchTrack, 0, len(itemPayloads)),
			MadeForYou:  isMadeForYouSelection(item.ID, item.Title),
		}
		seenTrackIDs := make(map[int64]struct{}, len(itemPayloads))
		seenPlaylistIDs := make(map[string]struct{}, len(itemPayloads))
		if selection.ID == "" {
			selection.ID = fmt.Sprintf("selection-%d", index)
		}
		if selection.MadeForYou && selection.Title == "" {
			selection.Title = "Made for you"
		}
		for _, raw := range itemPayloads {
			if playlist, ok := decodeMixedSelectionPlaylist(raw); ok {
				if _, exists := seenPlaylistIDs[playlist.ID]; exists {
					continue
				}
				seenPlaylistIDs[playlist.ID] = struct{}{}
				selection.Playlists = append(selection.Playlists, playlist)
				continue
			}
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
		if selection.Title != "" && (len(selection.Tracks) > 0 || len(selection.Playlists) > 0) {
			selections = append(selections, selection)
		}
	}
	log.Printf("mixed-selections stage=complete count=%d elapsed_ms=%d", len(selections), time.Since(startedAt).Milliseconds())
	return selections, nil
}

func isMadeForYouSelection(id, title string) bool {
	id = strings.ToLower(id)
	title = strings.ToLower(strings.TrimSpace(title))
	return strings.Contains(id, "discovery") || strings.Contains(id, "personalized") || strings.Contains(id, "personalised") ||
		strings.Contains(title, "made for you") || strings.Contains(title, "специально для вас")
}

func decodeMixedSelectionPlaylist(raw json.RawMessage) (soundcloudPlaylistCard, bool) {
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil {
		return soundcloudPlaylistCard{}, false
	}

	var itemType string
	_ = json.Unmarshal(object["type"], &itemType)
	if itemType == "playlist" || itemType == "system-playlist" {
		for _, key := range []string{"playlist", "resource", "item", "data"} {
			if nested, ok := object[key]; ok {
				if playlist, valid := decodeMixedSelectionPlaylistSource(nested); valid {
					return mixedSelectionPlaylistCard(playlist)
				}
			}
		}
		if playlist, valid := decodeMixedSelectionPlaylistSource(raw); valid {
			return mixedSelectionPlaylistCard(playlist)
		}
		return soundcloudPlaylistCard{}, false
	}

	for _, key := range []string{"playlist", "resource", "item", "data"} {
		if nested, ok := object[key]; ok {
			if playlist, valid := decodeMixedSelectionPlaylist(nested); valid {
				return playlist, true
			}
		}
	}

	playlist, valid := decodeMixedSelectionPlaylistSource(raw)
	if !valid || (!strings.Contains(playlist.URN, "soundcloud:playlists:") && object["is_album"] == nil) {
		return soundcloudPlaylistCard{}, false
	}
	return mixedSelectionPlaylistCard(playlist)
}

func decodeMixedSelectionPlaylistSource(raw json.RawMessage) (soundcloudPlaylistSource, bool) {
	var playlist soundcloudPlaylistSource
	if json.Unmarshal(raw, &playlist) != nil || playlist.Title == "" || (playlist.ID <= 0 && playlist.URN == "") {
		return soundcloudPlaylistSource{}, false
	}
	return playlist, true
}

func mixedSelectionPlaylistCard(source soundcloudPlaylistSource) (soundcloudPlaylistCard, bool) {
	playlistURN := source.URN
	if playlistURN == "" && source.ID > 0 {
		playlistURN = fmt.Sprintf("soundcloud:playlists:%d", source.ID)
	}
	playlistID := playlistURN
	if source.ID > 0 {
		playlistID = strconv.FormatInt(source.ID, 10)
	}
	if playlistID == "" || source.Title == "" {
		return soundcloudPlaylistCard{}, false
	}
	playlist := soundcloudPlaylistCard{
		ID:           playlistID,
		URN:          playlistURN,
		Title:        source.Title,
		PermalinkURL: source.PermalinkURL,
		ArtworkURL:   normalizeArtworkURL(source.ArtworkURL),
		TrackCount:   source.TrackCount,
	}
	playlist.User.Username = source.User.Username
	return playlist, true
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
	var object map[string]json.RawMessage
	if json.Unmarshal(raw, &object) != nil {
		return soundcloudSearchTrackSource{}, false
	}
	var itemType string
	_ = json.Unmarshal(object["type"], &itemType)
	if itemType == "playlist" || itemType == "system-playlist" {
		return soundcloudSearchTrackSource{}, false
	}
	var source soundcloudSearchTrackSource
	if json.Unmarshal(raw, &source) == nil && source.ID > 0 && source.Title != "" {
		return source, true
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

func (s *service) RPCTrackLike(params trackLikeParams) (trackLikeResult, error) {
	return trackLikeResponse(s.setTrackLiked(params.TrackID, params.TrackURN, true, params.DataDomeCookie, params.UserAgent), true)
}

func (s *service) RPCTrackUnlike(params trackLikeParams) (trackLikeResult, error) {
	return trackLikeResponse(s.setTrackLiked(params.TrackID, params.TrackURN, false, params.DataDomeCookie, params.UserAgent), false)
}

// applyBrowserHeaders оформляет запрос как обычный вызов из браузера.
// DataDome оценивает каждый заголовок: запрос из sidecar с голым
// User-Agent и без Sec-Fetch-*/sec-ch-ua выглядит как автоматизация, и
// SoundCloud отвечает на него проверкой или блокировкой адреса.
func applyBrowserHeaders(req *http.Request, requestAgent string) {
	version, platform := chromeIdentity(requestAgent)
	major := "131"
	if version != "" {
		major = version
	}
	req.Header.Set("Accept", "application/json, text/javascript, */*; q=0.01")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,ru;q=0.8")
	req.Header.Set("Origin", "https://soundcloud.com")
	req.Header.Set("Referer", "https://soundcloud.com/")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	req.Header.Set("Sec-Fetch-Dest", "empty")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Site", "same-site")
	req.Header.Set("sec-ch-ua", fmt.Sprintf("%q;v=%q, %q;v=%q, %q;v=%q",
		"Chromium", major, "Not:A-Brand", "24", "Google Chrome", major))
	req.Header.Set("sec-ch-ua-mobile", "?0")
	req.Header.Set("sec-ch-ua-platform", fmt.Sprintf("%q", platform))
}

// chromeIdentity вытаскивает из User-Agent версию Chromium и платформу, чтобы
// клиентские подсказки не противоречили заявленному браузеру.
func chromeIdentity(agent string) (string, string) {
	version := ""
	if idx := strings.Index(agent, "Chrome/"); idx >= 0 {
		rest := agent[idx+len("Chrome/"):]
		end := strings.IndexFunc(rest, func(character rune) bool {
			return character < '0' || character > '9'
		})
		if end > 0 {
			version = rest[:end]
		}
	}
	platform := "Windows"
	switch {
	case strings.Contains(agent, "Windows"):
		platform = "Windows"
	case strings.Contains(agent, "Macintosh"), strings.Contains(agent, "Mac OS"):
		platform = "macOS"
	case strings.Contains(agent, "Android"):
		platform = "Android"
	case strings.Contains(agent, "Linux"):
		platform = "Linux"
	}
	return version, platform
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

// applyNavigationHeaders оформляет разогрев как обычное открытие страницы, а не
// как XHR к API.
func applyNavigationHeaders(req *http.Request, requestAgent string) {
	_, platform := chromeIdentity(requestAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,ru;q=0.8")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	req.Header.Set("sec-ch-ua-mobile", "?0")
	req.Header.Set("sec-ch-ua-platform", fmt.Sprintf("%q", platform))
}

// warmUpTrack opens the track before reacting to it. A like that is also the
// very first request to that track is one of the shapes DataDome scores as
// automation, so the reference script in scripts/like.py does the same. Failures
// are not fatal: the like is still attempted afterwards.
func (s *service) warmUpTrack(base string, trackID int64, requestAgent string) {
	endpoint := fmt.Sprintf("%s/tracks/%d", strings.TrimRight(base, "/"), trackID)
	if parsed, err := url.Parse(endpoint); err == nil {
		query := parsed.Query()
		query.Set("client_id", s.settings.ClientID)
		parsed.RawQuery = query.Encode()
		endpoint = parsed.String()
	}
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		log.Printf("track.warmup stage=build_error track_id=%d error=%q", trackID, err.Error())
		return
	}
	req.Header.Set("Authorization", "OAuth "+s.auth.Token)
	req.Header.Set("User-Agent", requestAgent)
	applyNavigationHeaders(req, requestAgent)
	resp, err := s.send(req)
	if err != nil {
		log.Printf("track.warmup stage=transport_error track_id=%d error=%q", trackID, err.Error())
		return
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	resp.Body.Close()
	log.Printf("track.warmup stage=done track_id=%d status=%d", trackID, resp.StatusCode)
	if err := s.pacer.pause(req.Context()); err != nil {
		log.Printf("track.warmup stage=interrupted track_id=%d error=%q", trackID, err.Error())
	}
}

func (s *service) setTrackLiked(trackID int64, trackURN string, liked bool, dataDomeCookie string, userAgent string) error {
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
	// User-Agent попадает в заголовок запроса, поэтому принимаем только
	// printable однострочные ASCII-строки ограниченной длины.
	requestAgent := userAgent
	if len(requestAgent) > 512 || strings.IndexFunc(requestAgent, func(character rune) bool {
		return character < 0x20 || character > 0x7e
	}) >= 0 {
		return errors.New("некорректный User-Agent проверки SoundCloud")
	}
	if strings.TrimSpace(requestAgent) == "" {
		requestAgent = defaultUserAgent
		log.Printf("track.%s stage=agent_fallback track_id=%d", action, trackID)
	}
	// Открыть трек перед реакцией: лайк, который одновременно является первым
	// запросом к треку, выглядит для DataDome как автоматизация.
	if warmBase := s.warmUpBase(); warmBase != "" {
		s.warmUpTrack(warmBase, trackID, requestAgent)
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
		req.Header.Set("User-Agent", requestAgent)
		applyBrowserHeaders(req, requestAgent)
		if dataDomeCookie != "" {
			req.Header.Set("Cookie", "datadome="+dataDomeCookie)
			req.Header.Set("X-Datadome-ClientId", dataDomeCookie)
		}
		resp, err := s.send(req)
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
	req.Header.Set("User-Agent", defaultUserAgent)
	if base == webAPIBase {
		req.Header.Set("Origin", "https://soundcloud.com")
		req.Header.Set("Referer", "https://soundcloud.com/")
	}

	resp, err := s.send(req)
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
			req.Header.Set("User-Agent", defaultUserAgent)
			if base == webAPIBase {
				req.Header.Set("Origin", "https://soundcloud.com")
				req.Header.Set("Referer", "https://soundcloud.com/")
			}
			resp, err := s.send(req)
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

func (s *service) loadSettings() error {
	data, err := os.ReadFile(s.settingsPath)
	if errors.Is(err, os.ErrNotExist) {
		return s.saveSettings(s.settings)
	}
	if err != nil {
		return fmt.Errorf("read settings: %w", err)
	}
	loaded := defaultSettings()
	if err := json.Unmarshal(data, &loaded); err != nil {
		return fmt.Errorf("parse settings: %w", err)
	}
	if !validAccent(loaded.Accent) || loaded.Volume < 0 || loaded.Volume > 100 || (loaded.ClientID != "" && !validSoundCloudClientID(loaded.ClientID)) || !validBackgroundImage(loaded.BackgroundImage) || loaded.BackgroundBlur < 0 || loaded.BackgroundBlur > 24 {
		return errors.New("saved settings are invalid")
	}
	s.settings = loaded
	return nil
}

func (s *service) saveSettings(value settings) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeSecretFile(s.settingsPath, data)
}

func (s *service) loadHistory() error {
	data, err := os.ReadFile(s.historyPath)
	if errors.Is(err, os.ErrNotExist) {
		s.history = nil
		return nil
	}
	if err != nil {
		return fmt.Errorf("read history: %w", err)
	}
	var loaded []soundcloudTrackCard
	if err := json.Unmarshal(data, &loaded); err != nil {
		return fmt.Errorf("parse history: %w", err)
	}
	seen := make(map[int64]struct{}, len(loaded))
	s.history = make([]soundcloudTrackCard, 0, min(len(loaded), maxRecentTracks))
	for _, track := range loaded {
		if track.ID <= 0 || strings.TrimSpace(track.Title) == "" {
			continue
		}
		if _, exists := seen[track.ID]; exists {
			continue
		}
		seen[track.ID] = struct{}{}
		s.history = append(s.history, track)
		if len(s.history) == maxRecentTracks {
			break
		}
	}
	if len(s.history) != len(loaded) {
		return s.saveHistory(s.history)
	}
	return nil
}

func (s *service) saveHistory(value []soundcloudTrackCard) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeSecretFile(s.historyPath, data)
}

func (s *service) loadAuth() error {
	data, err := os.ReadFile(s.authPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read auth: %w", err)
	}
	var loaded authState
	if err := json.Unmarshal(data, &loaded); err != nil {
		return fmt.Errorf("parse auth: %w", err)
	}
	if strings.TrimSpace(loaded.Token) == "" {
		return errors.New("saved auth token is empty")
	}
	s.auth = loaded
	return nil
}

func (s *service) saveAuth(value authState) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeSecretFile(s.authPath, data)
}

func (s *service) clearAuth() error {
	return removeFileIfExists(s.authPath)
}

func removeFileIfExists(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// writeSecretFile атомарно пишет JSON с правами 0600: файл может содержать токен.
func writeSecretFile(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func appDataDir() (string, error) {
	if configured := os.Getenv("BSC_DATA_DIR"); configured != "" {
		return configured, nil
	}
	userConfig, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(userConfig, "BetterSoundCloud"), nil
}

func apiBase() string {
	if configured := strings.TrimSpace(os.Getenv("BSC_SOUNDCLOUD_API_BASE")); configured != "" {
		return configured
	}
	return officialAPIBase
}

func defaultSettings() settings {
	return settings{Accent: "#ff765d", Compact: false, Volume: 70, BackgroundBlur: 0}
}

func validSoundCloudClientID(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func validBackgroundImage(value string) bool {
	if value == "" {
		return true
	}
	const prefix = "data:image/jpeg;base64,"
	if len(value) > 700_000 || !strings.HasPrefix(value, prefix) {
		return false
	}
	image, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	return err == nil && len(image) >= 3 && image[0] == 0xff && image[1] == 0xd8 && image[2] == 0xff
}

func validAccent(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func writeResponse(writer *bufio.Writer, value response) error {
	if err := json.NewEncoder(writer).Encode(value); err != nil {
		return err
	}
	return writer.Flush()
}
