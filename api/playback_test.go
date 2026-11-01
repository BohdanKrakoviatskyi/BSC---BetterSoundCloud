package main

import "testing"

func makeTranscoding(preset, protocol, mimeType, streamURL string) soundcloudStreamTranscoding {
	var transcoding soundcloudStreamTranscoding
	transcoding.Preset = preset
	transcoding.URL = streamURL
	transcoding.Format.Protocol = protocol
	transcoding.Format.MimeType = mimeType
	return transcoding
}

func TestTrackTranscodingChoicesPrioritizesFullStreamsOverPreviewHLS(t *testing.T) {
	choices := trackTranscodingChoices([]soundcloudStreamTranscoding{
		makeTranscoding("aac_160k_preview", "hls", "audio/mp4", "https://api-v2.soundcloud.com/preview/aac"),
		makeTranscoding("aac_160k", "hls", "audio/mp4", "https://api-v2.soundcloud.com/media/aac"),
	}, "")

	if len(choices) != 2 {
		t.Fatalf("got %d choices, want 2", len(choices))
	}
	if choices[0].Preview {
		t.Fatal("full HLS stream was not prioritized over preview HLS")
	}
	if !choices[1].Preview {
		t.Fatal("preview HLS was not identified as a preview")
	}
}

func TestTrackTranscodingChoicesRecognizesPreviewInURL(t *testing.T) {
	choices := trackTranscodingChoices([]soundcloudStreamTranscoding{
		makeTranscoding("aac_160k", "hls", "audio/mp4", "https://api-v2.soundcloud.com/media/preview/aac"),
	}, "")

	if len(choices) != 1 || !choices[0].Preview {
		t.Fatalf("preview URL not identified: %#v", choices)
	}
}
