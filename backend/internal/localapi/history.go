package localapi

import (
	"errors"
	"fmt"
	"strings"

	"bettersoundcloud/local-api/internal/storage"
)

const maxRecentTracks = 20

type historyTrackParams struct {
	Track soundcloudTrackCard `json:"track"`
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
	if err := storage.RemoveFileIfExists(s.historyPath); err != nil {
		return nil, fmt.Errorf("clear playback history: %w", err)
	}
	s.history = nil
	return []soundcloudTrackCard{}, nil
}
