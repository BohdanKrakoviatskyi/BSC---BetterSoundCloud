package localapi

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

type soundcloudStreamTranscoding struct {
	URL    string `json:"url"`
	Preset string `json:"preset"`
	Format struct {
		Protocol string `json:"protocol"`
		MimeType string `json:"mime_type"`
	} `json:"format"`
}
type trackTranscodingChoice struct {
	URL      string
	Protocol string
	Preview  bool
	HLS      bool
	Quality  string
	Bitrate  int
}

func trackTranscodingChoices(transcodings []soundcloudStreamTranscoding, previewURL string) []trackTranscodingChoice {
	var aacHLS, otherHLS, progressive, previews []trackTranscodingChoice
	for _, transcoding := range transcodings {
		if strings.TrimSpace(transcoding.URL) == "" {
			continue
		}
		protocol := strings.ToLower(strings.TrimSpace(transcoding.Format.Protocol))
		preset := strings.ToLower(transcoding.Preset)
		mimeType := strings.ToLower(transcoding.Format.MimeType)
		isHLS := strings.Contains(protocol, "hls")
		isAAC := strings.Contains(preset+" "+mimeType+" "+strings.ToLower(transcoding.URL), "aac")
		choice := trackTranscodingChoice{URL: transcoding.URL, Protocol: protocol, HLS: isHLS}
		switch {
		case isHLS && isAAC:
			bitrate := aacBitrateKbps(transcoding)
			choice.Bitrate = bitrate
			choice.Quality = "AAC HLS"
			if bitrate > 0 {
				choice.Quality = fmt.Sprintf("AAC %d kbps", bitrate)
			}
			aacHLS = append(aacHLS, choice)
		case isHLS:
			choice.Quality = transcoding.Preset
			otherHLS = append(otherHLS, choice)
		case protocol == "progressive":
			choice.Quality = "Progressive"
			progressive = append(progressive, choice)
		case strings.Contains(preset, "preview"):
			choice.Preview = true
			choice.Quality = "Превью"
			previews = append(previews, choice)
		}
	}

	sort.SliceStable(aacHLS, func(i, j int) bool {
		return aacHLS[i].Bitrate > aacHLS[j].Bitrate
	})
	choices := append(aacHLS, otherHLS...)
	choices = append(choices, progressive...)
	choices = append(choices, previews...)
	if previewURL != "" {
		choices = append(choices, trackTranscodingChoice{
			URL: previewURL, Protocol: "preview", Preview: true,
			HLS: strings.Contains(strings.ToLower(previewURL), ".m3u8"), Quality: "Превью MP3",
		})
	}
	return choices
}

func aacBitrateKbps(transcoding soundcloudStreamTranscoding) int {
	value := strings.ToLower(transcoding.Preset + " " + transcoding.URL)
	start := strings.Index(value, "aac_")
	if start < 0 {
		return 0
	}
	digits := value[start+4:]
	length := 0
	for length < len(digits) && digits[length] >= '0' && digits[length] <= '9' {
		length++
	}
	if length == 0 {
		return 0
	}
	bitrate, err := strconv.Atoi(digits[:length])
	if err != nil {
		return 0
	}
	return bitrate
}
