package localapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestAuthLoginStoresTokenAndHidesIt(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)

	result, err := svc.call("auth.login", json.RawMessage(`{"token":" valid-token "}`))
	if err != nil {
		t.Fatalf("auth.login: %v", err)
	}
	status, ok := result.(authStatus)
	if !ok || !status.Authorized || status.Profile == nil {
		t.Fatalf("unexpected login result: %#v", result)
	}
	if status.Profile.Username != "Max" || status.Profile.LikesCount != 45 {
		t.Fatalf("unexpected profile: %#v", status.Profile)
	}
	if !strings.Contains(status.Profile.AvatarURL, "-t500x500.") {
		t.Fatalf("avatar should use the largest size, got %q", status.Profile.AvatarURL)
	}

	stored, err := os.ReadFile(svc.authPath)
	if err != nil {
		t.Fatalf("auth file: %v", err)
	}
	if !strings.Contains(string(stored), "valid-token") {
		t.Fatalf("auth file should contain the token")
	}
	info, err := os.Stat(svc.authPath)
	if err != nil {
		t.Fatalf("auth file stat: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("auth file permissions = %o, want 600", info.Mode().Perm())
	}

	// Renderer не должен получать сам токен — только признак входа и профиль.
	statusResult, err := svc.call("auth.status", nil)
	if err != nil {
		t.Fatalf("auth.status: %v", err)
	}
	payload, err := json.Marshal(statusResult)
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	if strings.Contains(string(payload), "valid-token") {
		t.Fatalf("auth.status leaks the token: %s", payload)
	}
}

func TestAuthLoginRejectsInvalidToken(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)

	_, err := svc.call("auth.login", json.RawMessage(`{"token":"wrong-token"}`))
	if !errors.Is(err, errTokenRejected) {
		t.Fatalf("err = %v, want errTokenRejected", err)
	}
	if _, statErr := os.Stat(svc.authPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("auth file must not be created for rejected token")
	}
	status, err := svc.call("auth.status", nil)
	if err != nil {
		t.Fatalf("auth.status: %v", err)
	}
	if status.(authStatus).Authorized {
		t.Fatalf("service must stay unauthorized")
	}
}

func TestAuthLoginRequiresToken(t *testing.T) {
	svc := newTestService(t, officialAPIBase)
	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"   "}`)); err == nil {
		t.Fatalf("expected an error for an empty token")
	}
}

func TestAuthRefreshClearsRejectedToken(t *testing.T) {
	reject := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reject {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"id": 1, "username": "Max"})
	}))
	defer server.Close()
	svc := newTestService(t, server.URL)

	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"session-token"}`)); err != nil {
		t.Fatalf("auth.login: %v", err)
	}
	reject = true
	result, err := svc.call("auth.refresh", nil)
	if err != nil {
		t.Fatalf("auth.refresh: %v", err)
	}
	if result.(authStatus).Authorized {
		t.Fatalf("rejected token must log the user out")
	}
	if _, statErr := os.Stat(svc.authPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("auth file must be removed after rejected refresh")
	}
}

func TestAuthLogoutClearsState(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)

	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"valid-token"}`)); err != nil {
		t.Fatalf("auth.login: %v", err)
	}
	result, err := svc.call("auth.logout", nil)
	if err != nil {
		t.Fatalf("auth.logout: %v", err)
	}
	if result.(authStatus).Authorized {
		t.Fatalf("logout must clear the session")
	}
	if _, statErr := os.Stat(svc.authPath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("auth file must be removed after logout")
	}
}

func TestSoundCloudLiveProfile(t *testing.T) {
	token := strings.TrimSpace(os.Getenv("BSC_TEST_TOKEN"))
	if token == "" {
		t.Skip("BSC_TEST_TOKEN не задан — живой тест SoundCloud пропущен (npm run test:go:live)")
	}

	svc := newTestService(t, apiBase())
	payload, err := json.Marshal(map[string]string{"token": token})
	if err != nil {
		t.Fatalf("marshal token: %v", err)
	}
	result, err := svc.call("auth.login", payload)
	if err != nil {
		t.Fatalf("живой auth.login: %v", err)
	}
	status, ok := result.(authStatus)
	if !ok || !status.Authorized || status.Profile == nil {
		t.Fatalf("неожиданный ответ: %#v", result)
	}
	if status.Profile.ID == 0 || status.Profile.Username == "" {
		t.Fatalf("SoundCloud вернул неполный профиль: %#v", status.Profile)
	}
	t.Logf("подключено: %s (@%s), лайков: %d, аватар: %s",
		status.Profile.FullName, status.Profile.Username, status.Profile.LikesCount, status.Profile.AvatarURL)

	// Профиль должен восстанавливаться из auth.json после перезапуска sidecar.
	restarted := newTestService(t, apiBase())
	restarted.authPath = svc.authPath
	if err := restarted.loadAuth(); err != nil {
		t.Fatalf("loadAuth: %v", err)
	}
	restored := restarted.authStatus()
	if !restored.Authorized || restored.Profile == nil || restored.Profile.ID != status.Profile.ID {
		t.Fatalf("сессия не восстановилась: %#v", restored)
	}
}

func TestAuthStateSurvivesRestart(t *testing.T) {
	server := soundCloudStub(t, "valid-token")
	defer server.Close()
	svc := newTestService(t, server.URL)
	if _, err := svc.call("auth.login", json.RawMessage(`{"token":"valid-token"}`)); err != nil {
		t.Fatalf("auth.login: %v", err)
	}

	restarted := newTestService(t, server.URL)
	restarted.authPath = svc.authPath
	if err := restarted.loadAuth(); err != nil {
		t.Fatalf("loadAuth: %v", err)
	}
	status := restarted.authStatus()
	if !status.Authorized || status.Profile == nil || status.Profile.Username != "Max" {
		t.Fatalf("session should survive restart: %#v", status)
	}
}
