package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// Liking and unliking a track on YouTube Music.
//
// The Data API does have a write path for this — videos.rate, POST /videos/rate — and it is worth
// being precise about what it does, because it is not what the name suggests. It records the signed-in
// user's own rating of a video. It does not move the video's public like counter, which is aggregated
// across every viewer and cannot be edited by an API client. What it does change is which playlist the
// video lands in: a "like" puts it in the positively-rated (liked) playlist that channels.list
// reports under the WL id, and that is the same list RPCYoutubeTracksMine reads. So the heart is the
// library — the same role Spotify's save-to-library plays, which is why the adapter maps this onto
// likeTrack/unlikeTrack rather than onto anything counter-shaped.
//
// Quota is the reason there is no batching and no automatic retry. The method costs 50 units against
// the project's shared 10,000 a day, so one like spends what two hundred reads do; the app sends one
// call per deliberate click and never retries on its own, because retrying after a timeout the server
// actually honoured would double-charge for a rating that is already recorded.
//
// The scope is force-ssl, which is why YOUTUBE_SCOPES in src-tauri/src/main.rs asks for it. Reading a
// rating back does not need it — videos.getRating costs one unit and accepts youtube.readonly — but
// writing one does, and a session signed in before this scope was added cannot write until the user
// grants it again. That is why a permission failure here names the scope rather than saying "try again".
//
// No API key is sent. Every other call in this file authenticates with the bearer token alone, which
// Google's "either a key or a token" rule accepts, and adding one here would be the only call in the
// sidecar that behaves differently for no gain.

// youtubeRatingLike and youtubeRatingNone are the two values this app sends. videos.rate also accepts
// "dislike", and a dislike populates the same playlist the app reads as the library, so offering it
// would put a track in "Мои треки" that the heart button then refuses to fill.
const (
	youtubeRatingLike = "like"
	youtubeRatingNone = "none"
)

type youtubeRateParams struct {
	ID     string `json:"id"`
	Rating string `json:"rating"`
}

// youtubeRatingResult is what the heart button needs afterwards: whether the track is now liked, and
// which video it applied to. The id comes back so the caller can apply the result to the right row when
// more than one request was in flight and the user changed their mind about several tracks.
type youtubeRatingResult struct {
	ID    string `json:"id"`
	Liked bool   `json:"liked"`
}

// RPCYoutubeRateTrack likes or unlikes a track.
//
// Published as youtube.rate.track by rpcMethods.
func (s *service) RPCYoutubeRateTrack(params youtubeRateParams) (youtubeRatingResult, error) {
	id := strings.TrimSpace(params.ID)
	if id == "" {
		return youtubeRatingResult{}, errors.New("не передан ID трека YouTube")
	}

	// The rating is validated against what this app is allowed to send rather than passed through.
	// Google would reject anything else with a 400, but finding that out over the wire costs 50 units:
	// the quota is charged for the attempt, not only for a request that went through.
	rating := youtubeRatingNone
	switch strings.ToLower(strings.TrimSpace(params.Rating)) {
	case youtubeRatingLike, "":
		rating = youtubeRatingLike
	case youtubeRatingNone, "unlike", "remove":
		rating = youtubeRatingNone
	default:
		return youtubeRatingResult{}, fmt.Errorf("неизвестная оценка YouTube %q", params.Rating)
	}

	token, err := s.youtubeAccessToken()
	if err != nil {
		return youtubeRatingResult{}, err
	}

	// POST with no body: the documented way to call this and the only one. The doc says outright not to
	// provide a request body, and a GET would be rejected.
	values := url.Values{
		"id":     {id},
		"rating": {rating},
	}
	req, err := http.NewRequest(http.MethodPost, s.youtubeURL("/videos/rate", values), nil)
	if err != nil {
		return youtubeRatingResult{}, fmt.Errorf("не удалось сформировать запрос оценки YouTube: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	if _, err := s.youtubeJSON(req, "оценка трека YouTube"); err != nil {
		return youtubeRatingResult{}, s.youtubeRateError(err, rating)
	}

	// A success is 204 No Content, so there is nothing to decode — youtubeBody.decode treats an empty
	// body as no-op rather than an error. The result is derived from what was asked for, because that
	// is the only information this endpoint gives back.
	return youtubeRatingResult{ID: id, Liked: rating == youtubeRatingLike}, nil
}

// youtubeRateError turns the failures people actually hit into something they can act on.
//
// The documented errors mean different things to the person looking at the heart button and are easy to
// tell apart from the message alone: a missing scope is fixed by signing in again, a disabled rating
// cannot be fixed at all, an unverified e-mail is fixed in Google's account settings. Left as raw API
// text they are three identical failures.
func (s *service) youtubeRateError(err error, rating string) error {
	message := err.Error()
	switch {
	case strings.Contains(message, "youtubeSignupRequired"),
		strings.Contains(message, "insufficientPermissions"),
		strings.Contains(message, "ACCESS_TOKEN_SCOPE_INSUFFICIENT"),
		strings.Contains(message, "forbidden"):
		return fmt.Errorf("YouTube не дал права менять оценки — нужен вход заново с правом записи: %w", err)
	case strings.Contains(message, "videoRatingDisabled"):
		return fmt.Errorf("автор видео запретил оценивать его: %w", err)
	case strings.Contains(message, "emailNotVerified"):
		return errors.New("YouTube требует подтвердить адрес почты, прежде чем оценивать видео")
	case strings.Contains(message, "videoPurchaseRequired"):
		return errors.New("это видео доступно только по аренде и не может быть оценено")
	case rating == youtubeRatingNone && strings.Contains(message, "videoNotFound"):
		return errors.New("видео не найдено — снять оценку не с чем")
	default:
		return err
	}
}
