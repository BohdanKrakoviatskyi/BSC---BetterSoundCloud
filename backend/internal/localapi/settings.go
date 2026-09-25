package localapi

import (
	"errors"
	"fmt"
	"strings"

	"bettersoundcloud/local-api/internal/storage"
)

type settings struct {
	Accent   string `json:"accent"`
	Compact  bool   `json:"compact"`
	Volume   int    `json:"volume"`
	ClientID string `json:"clientId"`
}

type settingsPatch struct {
	Accent   *string `json:"accent"`
	Compact  *bool   `json:"compact"`
	Volume   *int    `json:"volume"`
	ClientID *string `json:"clientId"`
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
	if err := storage.RemoveFileIfExists(s.settingsPath); err != nil {
		return settings{}, fmt.Errorf("clear settings: %w", err)
	}
	if err := storage.RemoveFileIfExists(s.historyPath); err != nil {
		return settings{}, fmt.Errorf("clear history: %w", err)
	}
	s.auth = authState{}
	s.settings = defaultSettings()
	s.history = nil
	return s.settings, nil
}
func defaultSettings() settings {
	return settings{Accent: "#ff765d", Compact: false, Volume: 70, ClientID: soundcloudClientID}
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
