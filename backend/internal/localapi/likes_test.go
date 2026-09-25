package localapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestTrackLikeUsesSoundCloudV2Endpoints(t *testing.T) {
	for _, test := range []struct {
		name                 string
		liked                bool
		wantMethod           string
		dataDomeCookie       string
		wantCookieHeader     string
		wantDataDomeClientID string
	}{
		{name: "like", liked: true, wantMethod: http.MethodPut},
		{name: "unlike", liked: false, wantMethod: http.MethodDelete},
		{name: "like after captcha", liked: true, wantMethod: http.MethodPut, dataDomeCookie: "verified-cookie", wantCookieHeader: "datadome=verified-cookie", wantDataDomeClientID: "verified-cookie"},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/users/1323227109/track_likes/2391534675" {
					t.Errorf("request path = %q", r.URL.Path)
				}
				if r.Method != test.wantMethod {
					t.Errorf("request method = %q, want %q", r.Method, test.wantMethod)
				}
				if r.URL.Query().Get("client_id") != "test-client-id" {
					t.Errorf("client_id = %q", r.URL.Query().Get("client_id"))
				}
				if r.Header.Get("Authorization") != "OAuth test-token" {
					t.Errorf("unexpected authorization header")
				}
				if r.Header.Get("Cookie") != test.wantCookieHeader {
					t.Errorf("Cookie header = %q, want %q", r.Header.Get("Cookie"), test.wantCookieHeader)
				}
				if r.Header.Get("X-Datadome-ClientId") != test.wantDataDomeClientID {
					t.Errorf("X-Datadome-ClientId header = %q, want %q", r.Header.Get("X-Datadome-ClientId"), test.wantDataDomeClientID)
				}
				w.WriteHeader(http.StatusOK)
			}))
			defer server.Close()

			svc := newTestService(t, server.URL)
			svc.auth.Token = "test-token"
			svc.auth.Profile.ID = 1323227109
			svc.settings.ClientID = "test-client-id"
			params := trackLikeParams{TrackID: 2391534675, TrackURN: "soundcloud:tracks:2391534675", DataDomeCookie: test.dataDomeCookie}
			var result trackLikeResult
			var err error
			if test.liked {
				result, err = svc.RPCTrackLike(params)
			} else {
				result, err = svc.RPCTrackUnlike(params)
			}
			if err != nil {
				t.Fatalf("track-like request failed: %v", err)
			}
			if result.Liked != test.liked || result.CaptchaURL != "" {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func TestTrackLikeReturnsCaptchaURLFromForbiddenResponse(t *testing.T) {
	const captchaURL = "https://geo.captcha-delivery.com/captcha/?challenge=test"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("request method = %q, want PUT", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"url":"` + captchaURL + `"}`))
	}))
	defer server.Close()

	svc := newTestService(t, server.URL)
	svc.auth.Token = "test-token"
	svc.auth.Profile.ID = 1323227109
	svc.settings.ClientID = "test-client-id"
	result, err := svc.RPCTrackLike(trackLikeParams{TrackID: 2391534675})
	if err != nil {
		t.Fatalf("captcha response should be returned to the UI: %v", err)
	}
	if result.Liked || result.CaptchaURL != captchaURL {
		t.Fatalf("result = %#v, want captcha URL and no like", result)
	}
}
