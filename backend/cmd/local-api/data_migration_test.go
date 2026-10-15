package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

// The data directory is the one part of the rename that can lose something a user cannot get back:
// settings, three sets of OAuth tokens and the listening history. These tests cover the three states
// the migration can be in when the sidecar starts.

// A machine that never had the old app must not grow a copy of anything.
func TestMigrateLegacyDataDirWithoutALegacyDirectory(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "Resonance")
	legacy := filepath.Join(base, "BetterSoundCloud")

	if got := migrateLegacyDataDir(target, legacy); got != target {
		t.Errorf("вернул %q, ждали %q", got, target)
	}
	if _, err := os.Stat(target); err == nil {
		t.Error("создал каталог, хотя переносить было нечего")
	}
}

// The real case: the previous install's files have to arrive, with their permissions intact.
func TestMigrateLegacyDataDirCarriesFilesAcross(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "Resonance")
	legacy := filepath.Join(base, "BetterSoundCloud")
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	// The shapes that actually exist on disk: a large settings file and a token file at 0600.
	if err := os.WriteFile(filepath.Join(legacy, "settings.json"), []byte(`{"accent":"#fff"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "auth.json"), []byte(`{"token":"secret"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := migrateLegacyDataDir(target, legacy); got != target {
		t.Fatalf("вернул %q, ждали %q", got, target)
	}

	for name, want := range map[string]string{
		"settings.json": `{"accent":"#fff"}`,
		"auth.json":     `{"token":"secret"}`,
	} {
		data, err := os.ReadFile(filepath.Join(target, name))
		if err != nil {
			t.Fatalf("%s не перенесён: %v", name, err)
		}
		if string(data) != want {
			t.Errorf("%s = %q, ждали %q", name, data, want)
		}
	}

	// The copy must not widen what it copied. Asserting an exact 0600 would pass on Unix and fail on
	// Windows, where Go reports 0666 for every writable file whatever mode was asked for — which is why
	// the property is stated as "no more permissive" rather than as a number.
	source, err := os.Stat(filepath.Join(legacy, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	copied, err := os.Stat(filepath.Join(target, "auth.json"))
	if err != nil {
		t.Fatal(err)
	}
	if copied.Mode().Perm()&^source.Mode().Perm() != 0 {
		t.Errorf("права выросли при переносе: было %o, стало %o", source.Mode().Perm(), copied.Mode().Perm())
	}
	if runtime.GOOS != "windows" && copied.Mode().Perm() != 0o600 {
		t.Errorf("auth.json имеет права %o, ждали 600 вне Windows", copied.Mode().Perm())
	}
}

// A run that was interrupted halfway must finish on the next start, not skip the rest of the profile
// because one file already arrived. This is why there is no marker file and no "already migrated" flag.
func TestMigrateLegacyDataDirResumesAndDoesNotOverwrite(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "Resonance")
	legacy := filepath.Join(base, "BetterSoundCloud")
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	// settings.json is already there — as if a previous run got this far and stopped.
	if err := os.WriteFile(filepath.Join(target, "settings.json"), []byte(`{"current":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "settings.json"), []byte(`{"stale":true}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "youtube.json"), []byte(`{"refresh":"rt"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	migrateLegacyDataDir(target, legacy)

	// What the app has been running with wins: overwriting it would discard whatever the user changed
	// since the first run under the new name.
	data, err := os.ReadFile(filepath.Join(target, "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"current":true}` {
		t.Errorf("settings.json = %q — существующий файл перезаписан", data)
	}
	// The one that was missing still has to arrive.
	data, err = os.ReadFile(filepath.Join(target, "youtube.json"))
	if err != nil {
		t.Fatalf("youtube.json не перенесён при повторном запуске: %v", err)
	}
	if string(data) != `{"refresh":"rt"}` {
		t.Errorf("youtube.json = %q", data)
	}
}

// The old directory is the fallback if this migration turns out to have missed something, so it is left
// alone. Deleting it is the only irreversible step here and it buys very little.
func TestMigrateLegacyDataDirLeavesTheOriginalAlone(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "Resonance")
	legacy := filepath.Join(base, "BetterSoundCloud")
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "auth.json"), []byte(`{"token":"secret"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	migrateLegacyDataDir(target, legacy)

	if _, err := os.Stat(filepath.Join(legacy, "auth.json")); err != nil {
		t.Errorf("исходный файл удалён: %v", err)
	}
}

// Subdirectories are not carried over. The old directory has never held any, and copying a directory
// recursively is more code protecting against a shape that does not exist than against a real risk.
func TestMigrateLegacyDataDirSkipsSubdirectories(t *testing.T) {
	base := t.TempDir()
	target := filepath.Join(base, "Resonance")
	legacy := filepath.Join(base, "BetterSoundCloud")
	if err := os.MkdirAll(filepath.Join(legacy, "cache"), 0o700); err != nil {
		t.Fatal(err)
	}

	migrateLegacyDataDir(target, legacy)

	if _, err := os.Stat(filepath.Join(target, "cache")); err == nil {
		t.Error("подкаталог был перенесён")
	}
}

// BSC_DATA_DIR overrides the directory outright. It is how the tests and a portable install point the
// sidecar somewhere else, so the rename must not route it through the migration and must not append the
// app name to it.
func TestAppDataDirHonoursTheEnvironmentOverride(t *testing.T) {
	explicit := filepath.Join(t.TempDir(), "somewhere-else")
	t.Setenv("BSC_DATA_DIR", explicit)

	got, err := appDataDir()
	if err != nil {
		t.Fatalf("appDataDir: %v", err)
	}
	if got != explicit {
		t.Errorf("каталог = %q, ждали ровно BSC_DATA_DIR = %q", got, explicit)
	}
}
