package localapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"bettersoundcloud/local-api/internal/storage"
)

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
	if !validAccent(loaded.Accent) || loaded.Volume < 0 || loaded.Volume > 100 || !validSoundCloudClientID(loaded.ClientID) {
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
	return storage.WriteSecretFile(s.settingsPath, data)
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
	return nil
}

func (s *service) saveHistory(value []soundcloudTrackCard) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return storage.WriteSecretFile(s.historyPath, data)
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
	return storage.WriteSecretFile(s.authPath, data)
}

func (s *service) clearAuth() error {
	return storage.RemoveFileIfExists(s.authPath)
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
