package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	ytAudioCacheMaxBytes = 3 << 30 // 3 GiB
	ytAudioTokenBytes    = 16
)

type ytAudioManager struct {
	mu       sync.Mutex
	cacheDir string
	port     int
	token    string
	client   *http.Client
	active   map[string]*ytAudioActive
}

type ytAudioActive struct {
	done chan struct{}
	err  error
}

func newYTAudioManager(cacheDir string, client *http.Client) *ytAudioManager {
	token := randomHex(ytAudioTokenBytes)
	return &ytAudioManager{
		cacheDir: cacheDir,
		token:    token,
		client:   client,
		active:   make(map[string]*ytAudioActive),
	}
}

func randomHex(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

func (m *ytAudioManager) start() error {
	if err := os.MkdirAll(m.cacheDir, 0o700); err != nil {
		return fmt.Errorf("create yt audio cache: %w", err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("listen yt audio server: %w", err)
	}
	m.port = ln.Addr().(*net.TCPAddr).Port
	mux := http.NewServeMux()
	mux.HandleFunc("/yt-audio/", m.handleAudio)
	srv := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("yt audio server stopped: %v", err)
		}
	}()
	log.Printf("yt audio cache server listening on 127.0.0.1:%d dir=%q", m.port, m.cacheDir)
	return nil
}

func (m *ytAudioManager) streamURL(videoID string) string {
	return fmt.Sprintf("http://127.0.0.1:%d/yt-audio/%s?t=%s", m.port, videoID, m.token)
}

// ensureCached starts a background download to the on-disk cache if needed.
// It is safe to call repeatedly; in-flight and completed downloads are deduped.
func (m *ytAudioManager) ensureCached(videoID string) {
	if !validYouTubeVideoID(videoID) {
		return
	}
	if _, ok := m.cachedPath(videoID); ok {
		return
	}
	m.mu.Lock()
	if _, ok := m.active[videoID]; ok {
		m.mu.Unlock()
		return
	}
	active := &ytAudioActive{done: make(chan struct{})}
	m.active[videoID] = active
	cachePath := filepath.Join(m.cacheDir, videoID+".m4a")
	tmpPath := cachePath + ".part"
	m.mu.Unlock()

	go func() {
		err := m.downloadToCache(videoID, tmpPath, cachePath, nil)
		m.mu.Lock()
		delete(m.active, videoID)
		active.err = err
		m.mu.Unlock()
		close(active.done)
		if err != nil {
			log.Printf("yt audio prefetch/download error id=%s: %v", videoID, err)
			_ = os.Remove(tmpPath)
		}
	}()
}

func (m *ytAudioManager) cachedPath(videoID string) (string, bool) {
	// Prefer m4a, then webm/opus containers that yt-dlp may produce.
	for _, ext := range []string{".m4a", ".webm", ".opus", ".mp3", ".ogg"} {
		path := filepath.Join(m.cacheDir, videoID+ext)
		if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Size() > 64*1024 {
			return path, true
		}
	}
	return "", false
}

func (m *ytAudioManager) handleAudio(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("t") != m.token {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/yt-audio/")
	if !validYouTubeVideoID(id) {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	if path, ok := m.cachedPath(id); ok {
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(w, r, path)
		return
	}

	// Prefetch probe: start caching in background without tying up this request.
	if r.URL.Query().Get("prefetch") == "1" {
		m.ensureCached(id)
		w.WriteHeader(http.StatusAccepted)
		return
	}

	m.serveAndCache(w, r, id)
}

func (m *ytAudioManager) serveAndCache(w http.ResponseWriter, r *http.Request, id string) {
	// If a download is already active (e.g. background prefetch), wait for it
	// to finish, then serve the completed cache with Range/seeking support.
	m.mu.Lock()
	if active, ok := m.active[id]; ok {
		done := active.done
		m.mu.Unlock()
		select {
		case <-done:
		case <-r.Context().Done():
			return
		}
		if path, ok := m.cachedPath(id); ok {
			w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
			http.ServeFile(w, r, path)
			return
		}
		m.mu.Lock()
	}
	active := &ytAudioActive{done: make(chan struct{})}
	m.active[id] = active
	cachePath := filepath.Join(m.cacheDir, id+".m4a")
	tmpPath := cachePath + ".part"
	m.mu.Unlock()

	err := m.downloadToCache(id, tmpPath, cachePath, &httpStreamTarget{w: w, r: r})

	m.mu.Lock()
	delete(m.active, id)
	active.err = err
	m.mu.Unlock()
	close(active.done)

	if err != nil {
		log.Printf("yt audio cache miss/download error id=%s: %v", id, err)
		_ = os.Remove(tmpPath)
	}
}

type httpStreamTarget struct {
	w http.ResponseWriter
	r *http.Request
}

func sniffAudioType(chunk []byte) (ext, contentType string) {
	if len(chunk) >= 12 && chunk[4] == 'f' && chunk[5] == 't' && chunk[6] == 'y' && chunk[7] == 'p' {
		return ".m4a", "audio/mp4"
	}
	if len(chunk) >= 4 && chunk[0] == 0x1a && chunk[1] == 0x45 && chunk[2] == 0xdf && chunk[3] == 0xa3 {
		return ".webm", "audio/webm"
	}
	if len(chunk) >= 4 && string(chunk[:4]) == "OggS" {
		return ".ogg", "audio/ogg"
	}
	if len(chunk) >= 3 && string(chunk[:3]) == "ID3" {
		return ".mp3", "audio/mpeg"
	}
	if len(chunk) >= 2 && chunk[0] == 0xff && (chunk[1]&0xe0) == 0xe0 {
		return ".mp3", "audio/mpeg"
	}
	return ".m4a", "audio/mp4"
}

func (m *ytAudioManager) downloadToCache(id, tmpPath, finalPath string, target *httpStreamTarget) error {
	binary, err := findYtDlp()
	if err != nil {
		if target != nil {
			http.Error(target.w, err.Error(), http.StatusBadGateway)
		}
		return err
	}
	if err := os.MkdirAll(m.cacheDir, 0o700); err != nil {
		if target != nil {
			http.Error(target.w, err.Error(), http.StatusInternalServerError)
		}
		return err
	}
	m.enforceCacheLimit(0)

	file, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		if target != nil {
			http.Error(target.w, err.Error(), http.StatusInternalServerError)
		}
		return err
	}
	fileClosed := false
	closeFile := func() {
		if !fileClosed {
			fileClosed = true
			_ = file.Sync()
			_ = file.Close()
		}
	}
	defer closeFile()

	// Background context so client disconnects don't kill caching.
	dlCtx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	videoURL := "https://www.youtube.com/watch?v=" + id
	cmd := exec.CommandContext(dlCtx, binary,
		"--no-warnings", "--no-progress", "--no-playlist",
		"--extractor-retries", "2", "--socket-timeout", "15",
		"--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio",
		"-o", "-",
		videoURL,
	)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		if target != nil {
			http.Error(target.w, err.Error(), http.StatusInternalServerError)
		}
		return err
	}
	var stderrBuf strings.Builder
	cmd.Stderr = &stderrBuf
	if err := cmd.Start(); err != nil {
		if target != nil {
			http.Error(target.w, err.Error(), http.StatusBadGateway)
		}
		return err
	}

	var flusher http.Flusher
	clientCtx := context.Background()
	clientGone := target == nil
	headersSent := false
	ext := ".m4a"
	contentType := "audio/mp4"

	buf := make([]byte, 32*1024)
	var total int64
	for {
		n, readErr := stdout.Read(buf)
		if n > 0 {
			chunk := buf[:n]
			if !headersSent {
				ext, contentType = sniffAudioType(chunk)
				if target != nil {
					target.w.Header().Set("Content-Type", contentType)
					target.w.Header().Set("Cache-Control", "private, no-store")
					target.w.Header().Set("X-Content-Type-Options", "nosniff")
					target.w.WriteHeader(http.StatusOK)
					flusher, _ = target.w.(http.Flusher)
					clientCtx = target.r.Context()
				}
				headersSent = true
			}
			if _, werr := file.Write(chunk); werr != nil {
				log.Printf("yt audio cache write error id=%s: %v", id, werr)
			}
			total += int64(n)
			if !clientGone && target != nil {
				select {
				case <-clientCtx.Done():
					clientGone = true
				default:
					if _, cerr := target.w.Write(chunk); cerr != nil {
						clientGone = true
					} else if flusher != nil && total%(128*1024) < int64(n) {
						flusher.Flush()
					}
				}
			}
		}
		if readErr != nil {
			break
		}
	}

	waitErr := cmd.Wait()
	if waitErr != nil {
		msg := strings.TrimSpace(stderrBuf.String())
		if len(msg) > 400 {
			msg = msg[:400]
		}
		if target != nil && !headersSent {
			if msg != "" {
				http.Error(target.w, "yt-dlp: "+msg, http.StatusBadGateway)
			} else {
				http.Error(target.w, "yt-dlp failed", http.StatusBadGateway)
			}
		}
		if msg != "" {
			return fmt.Errorf("yt-dlp: %s", msg)
		}
		return fmt.Errorf("yt-dlp: %w", waitErr)
	}
	if total < 64*1024 {
		return errors.New("yt-dlp produced too little audio data")
	}
	closeFile()
	actualFinal := filepath.Join(m.cacheDir, id+ext)
	if err := os.Rename(tmpPath, actualFinal); err != nil {
		return fmt.Errorf("finalize cache: %w", err)
	}
	_ = os.Chtimes(actualFinal, time.Now(), time.Now())
	_ = finalPath // determined by sniffing
	m.enforceCacheLimit(0)
	return nil
}

func (m *ytAudioManager) enforceCacheLimit(extra int64) {
	m.mu.Lock()
	defer m.mu.Unlock()
	entries, err := os.ReadDir(m.cacheDir)
	if err != nil {
		return
	}
	type item struct {
		path string
		size int64
		mod  time.Time
	}
	var items []item
	var total int64
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".part") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, item{path: filepath.Join(m.cacheDir, e.Name()), size: info.Size(), mod: info.ModTime()})
		total += info.Size()
	}
	target := int64(ytAudioCacheMaxBytes) - extra
	if total <= target {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.Before(items[j].mod) })
	for _, it := range items {
		if total <= target {
			break
		}
		if err := os.Remove(it.path); err == nil {
			total -= it.size
		}
	}
}
