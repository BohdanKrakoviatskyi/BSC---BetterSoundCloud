package main

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// Rating costs 50 units against a 10,000-a-day budget, so these tests assert on what reaches the wire
// as much as on what comes back: a value this app must never send has to be refused locally, before
// the request is built, because Google charges for the attempt and not only for a request it accepts.

// youtubeRateCapture records the single request the method under test is allowed to make.
type youtubeRateCapture struct {
	calls      int
	method     string
	path       string
	query      url.Values
	authHeader string
	body       string
}

// routeYoutubeRate answers /v3/videos/rate with 204 No Content, which is what the real endpoint returns
// on success, and records the request. A 200 with a JSON body would let a test pass against a response
// shape YouTube never sends.
func routeYoutubeRate(t *testing.T, svc *service, status int, body string) *youtubeRateCapture {
	t.Helper()
	capture := &youtubeRateCapture{}
	svc.httpClient = &http.Client{Transport: testRoundTripper(func(request *http.Request) (*http.Response, error) {
		capture.calls++
		capture.method = request.Method
		capture.path = request.URL.Path
		capture.query = request.URL.Query()
		capture.authHeader = request.Header.Get("Authorization")
		if request.Body != nil {
			raw := make([]byte, 512)
			read, _ := request.Body.Read(raw)
			capture.body = string(raw[:read])
		}
		return youtubeResponse(request, status, body), nil
	})}
	return capture
}

func TestYoutubeRateTrackLikesThroughPost(t *testing.T) {
	svc := signedInYoutubeService(t)
	capture := routeYoutubeRate(t, svc, http.StatusNoContent, "")

	result, err := svc.RPCYoutubeRateTrack(youtubeRateParams{ID: "vid1", Rating: "like"})
	if err != nil {
		t.Fatalf("rate: %v", err)
	}

	// POST is not a detail: the documented method is POST and a GET would be rejected.
	if capture.method != http.MethodPost {
		t.Errorf("method = %s, want POST", capture.method)
	}
	if capture.path != "/v3/videos/rate" {
		t.Errorf("path = %s, want /v3/videos/rate", capture.path)
	}
	// The doc says not to send a body. A JSON body here is the kind of thing that works until it
	// does not, so it is asserted rather than assumed.
	if capture.body != "" {
		t.Errorf("body = %q, want empty", capture.body)
	}
	if got := capture.query.Get("id"); got != "vid1" {
		t.Errorf("id = %q, want vid1", got)
	}
	if got := capture.query.Get("rating"); got != "like" {
		t.Errorf("rating = %q, want like", got)
	}
	if capture.authHeader != "Bearer at-live" {
		t.Errorf("Authorization = %q, want the bearer token", capture.authHeader)
	}
	if !result.Liked {
		t.Error("liked = false after a successful like")
	}
	if result.ID != "vid1" {
		t.Errorf("result id = %q, want vid1 — the caller matches a row by it", result.ID)
	}
}

func TestYoutubeRateTrackUnlikeRemovesTheRating(t *testing.T) {
	svc := signedInYoutubeService(t)
	capture := routeYoutubeRate(t, svc, http.StatusNoContent, "")

	result, err := svc.RPCYoutubeRateTrack(youtubeRateParams{ID: "vid2", Rating: "none"})
	if err != nil {
		t.Fatalf("rate: %v", err)
	}
	if got := capture.query.Get("rating"); got != "none" {
		t.Errorf("rating = %q, want none", got)
	}
	if result.Liked {
		t.Error("liked = true after a successful unlike")
	}
}

func TestYoutubeRateTrackRefusesAnUnknownRatingLocally(t *testing.T) {
	// The one assertion that protects the quota: the request must never leave the machine.
	svc := signedInYoutubeService(t)
	capture := routeYoutubeRate(t, svc, http.StatusNoContent, "")

	_, err := svc.RPCYoutubeRateTrack(youtubeRateParams{ID: "vid1", Rating: "dislike"})
	if err == nil {
		t.Fatal("a rating this app must not send should be refused")
	}
	if capture.calls != 0 {
		t.Errorf("sent %d request(s); a refused rating must not reach YouTube at 50 units a call", capture.calls)
	}
}

func TestYoutubeRateTrackExplainsAMissingScope(t *testing.T) {
	// The likeliest real failure after this shipped: a session signed in before force-ssl was added.
	// "Forbidden" alone sends the user looking for a network problem.
	svc := signedInYoutubeService(t)
	routeYoutubeRate(t, svc, http.StatusForbidden,
		`{"error":{"code":403,"message":"Forbidden","errors":[{"reason":"youtubeSignupRequired"}]}}`)

	_, err := svc.RPCYoutubeRateTrack(youtubeRateParams{ID: "vid1", Rating: "like"})
	if err == nil {
		t.Fatal("a 403 must be an error")
	}
	message := err.Error()
	if !strings.Contains(message, "правом записи") {
		t.Errorf("message = %q, want it to name the missing write scope", message)
	}
}

func TestYoutubeRateTrackNamesADisabledRating(t *testing.T) {
	// This one cannot be fixed by retrying, signing in again or clearing anything, so the message has
	// to say so rather than look like a transient failure.
	svc := signedInYoutubeService(t)
	routeYoutubeRate(t, svc, http.StatusForbidden,
		`{"error":{"code":403,"message":"Forbidden","errors":[{"reason":"videoRatingDisabled"}]}}`)

	_, err := svc.RPCYoutubeRateTrack(youtubeRateParams{ID: "vid1", Rating: "like"})
	if err == nil {
		t.Fatal("a disabled rating must be an error")
	}
	if !strings.Contains(err.Error(), "запретил") {
		t.Errorf("message = %q, want it to say the owner disabled ratings", err.Error())
	}
}

func TestYoutubeRateTrackRequiresAVideoID(t *testing.T) {
	svc := signedInYoutubeService(t)
	capture := routeYoutubeRate(t, svc, http.StatusNoContent, "")

	if _, err := svc.RPCYoutubeRateTrack(youtubeRateParams{Rating: "like"}); err == nil {
		t.Fatal("an empty id should be refused before the request")
	}
	if capture.calls != 0 {
		t.Errorf("sent %d request(s) with no video id", capture.calls)
	}
}

func TestYoutubeRateTrackNeedsASession(t *testing.T) {
	// Signed out is a different situation from a broken session and gets a different message, because
	// the user has to sign in rather than retry.
	svc := newYoutubeTestService(t)
	capture := routeYoutubeRate(t, svc, http.StatusNoContent, "")

	if _, err := svc.RPCYoutubeRateTrack(youtubeRateParams{ID: "vid1", Rating: "like"}); err == nil {
		t.Fatal("rating without a session should be an error")
	}
	if capture.calls != 0 {
		t.Errorf("sent %d request(s) with no token", capture.calls)
	}
}

// The name the frontend calls it by. Asserted here because a method can compile and still be invisible
// to the dispatcher, which only registers the exact (T) (R, error) shape.
func TestYoutubeRateTrackIsPublished(t *testing.T) {
	spec, ok := rpcMethods()["youtube.rate.track"]
	if !ok {
		t.Fatal("youtube.rate.track не опубликован")
	}
	if spec.goName != "RPCYoutubeRateTrack" {
		t.Errorf("youtube.rate.track указывает на %s", spec.goName)
	}
}
