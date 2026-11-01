package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type ytDlpSearchParams struct {
	Query string `json:"query"`
}

type ytDlpStreamParams struct {
	VideoID string `json:"videoId"`
}

type ytDlpTrack struct {
	NativeID   string `json:"nativeId"`
	Source     string `json:"source"`
	URN        string `json:"urn"`
	Title      string `json:"title"`
	Permalink  string `json:"permalink"`
	ArtworkURL string `json:"artworkUrl"`
	DurationMs int64  `json:"durationMs"`
	Artist     string `json:"artist"`
}

type ytDlpEntry struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Channel   string  `json:"channel"`
	Uploader  string  `json:"uploader"`
	Duration  float64 `json:"duration"`
	Thumbnail string  `json:"thumbnail"`
}

type ytDlpSearchPage struct {
	Entries []ytDlpEntry `json:"entries"`
}

type ytDlpStreamResult struct {
	URL string `json:"url"`
}

func (s *service) RPCYtDlpSearch(params ytDlpSearchParams) ([]ytDlpTrack, error) {
	query := strings.TrimSpace(params.Query)
	if query == "" {
		return nil, errors.New("search query is required")
	}
	if len(query) > 300 {
		return nil, errors.New("search query is too long")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	output, err := runYtDlp(ctx, "--no-warnings", "--no-progress", "--skip-download", "--flat-playlist", "--dump-single-json", "ytsearch10:"+query)
	if err != nil {
		return nil, err
	}
	return parseYtDlpSearchResults(output)
}

func (s *service) RPCYtDlpStream(params ytDlpStreamParams) (ytDlpStreamResult, error) {
	if !validYouTubeVideoID(params.VideoID) {
		return ytDlpStreamResult{}, errors.New("invalid YouTube video ID")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	videoURL := "https://www.youtube.com/watch?v=" + params.VideoID
	output, err := runYtDlp(ctx, "--no-warnings", "--no-progress", "--no-playlist", "--format", "bestaudio[ext=m4a]/bestaudio", "--get-url", videoURL)
	if err != nil {
		return ytDlpStreamResult{}, err
	}
	streamURL := strings.TrimSpace(strings.SplitN(string(output), "\n", 2)[0])
	if !validYtDlpAudioURL(streamURL) {
		return ytDlpStreamResult{}, errors.New("yt-dlp did not return a supported audio URL")
	}
	return ytDlpStreamResult{URL: streamURL}, nil
}

func runYtDlp(ctx context.Context, args ...string) ([]byte, error) {
	binary, err := findYtDlp()
	if err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, binary, args...)
	output, err := command.Output()
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			message := strings.TrimSpace(string(exit.Stderr))
			if len(message) > 500 {
				message = message[:500]
			}
			if message != "" {
				return nil, fmt.Errorf("yt-dlp failed: %s", message)
			}
		}
		return nil, fmt.Errorf("yt-dlp failed: %w", err)
	}
	return output, nil
}

func findYtDlp() (string, error) {
	if binary, err := exec.LookPath("yt-dlp"); err == nil {
		return binary, nil
	}
	if home, err := os.UserHomeDir(); err == nil {
		for _, name := range []string{"yt-dlp", "yt-dlp.exe"} {
			candidate := filepath.Join(home, ".local", "bin", name)
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() && info.Mode()&0111 != 0 {
				return candidate, nil
			}
		}
	}
	return "", errors.New("yt-dlp was not found; install it and make sure it is available in PATH")
}

func parseYtDlpSearchResults(data []byte) ([]ytDlpTrack, error) {
	var page ytDlpSearchPage
	if err := json.Unmarshal(data, &page); err != nil {
		return nil, fmt.Errorf("could not parse yt-dlp search results: %w", err)
	}
	tracks := make([]ytDlpTrack, 0, len(page.Entries))
	for _, entry := range page.Entries {
		if !validYouTubeVideoID(entry.ID) || strings.TrimSpace(entry.Title) == "" {
			continue
		}
		artist := strings.TrimSpace(entry.Channel)
		if artist == "" {
			artist = strings.TrimSpace(entry.Uploader)
		}
		if artist == "" {
			artist = "YouTube"
		}
		thumbnail := strings.TrimSpace(entry.Thumbnail)
		if thumbnail == "" {
			thumbnail = "https://i.ytimg.com/vi/" + entry.ID + "/hqdefault.jpg"
		}
		tracks = append(tracks, ytDlpTrack{
			NativeID: entry.ID, Source: "youtube", URN: entry.ID, Title: strings.TrimSpace(entry.Title),
			Permalink:  "https://music.youtube.com/watch?v=" + url.QueryEscape(entry.ID),
			ArtworkURL: thumbnail, DurationMs: int64(entry.Duration * 1000), Artist: artist,
		})
	}
	return tracks, nil
}

func validYouTubeVideoID(value string) bool {
	if len(value) != 11 {
		return false
	}
	for _, char := range value {
		if !(char >= 'A' && char <= 'Z') && !(char >= 'a' && char <= 'z') && !(char >= '0' && char <= '9') && char != '_' && char != '-' {
			return false
		}
	}
	return true
}

func validYtDlpAudioURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "googlevideo.com" || strings.HasSuffix(host, ".googlevideo.com")
}
