package localapi

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"bettersoundcloud/local-api/internal/rpc"
)

const (
	appName    = "BetterSoundCloud"
	appVersion = "0.1.0"
)

type emptyParams struct{}

type appInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
	Backend string `json:"backend"`
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
}

// Exported methods prefixed with RPC are discovered automatically, published
// by the JSON-RPC dispatcher, and included in the generated OpenAPI schemas.
func (s *service) RPCAppInfo(_ emptyParams) (appInfo, error) {
	return appInfo{Name: appName, Version: appVersion, Backend: "go-sidecar"}, nil
}

func Run(input io.Reader, output io.Writer) error {
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
	return rpc.Serve(input, output, svc.call)
}
