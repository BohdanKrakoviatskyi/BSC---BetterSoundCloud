# SoundCloud API & BetterSoundCloud Integration Reference

This document outlines the data sources, RPC methods, parameters, and payloads extracted from `BSC---BetterSoundCloud` (Go sidecar `cmd/local-api` and desktop frontend `src/renderer`) for use in `resonance`.

---

## 1. Search

- **RPC Method:** `search.tracks`
- **Go Handler:** `RPCSearchTracks(params searchTracksParams) ([]soundcloudSearchTrack, error)`
- **Parameters:**
  ```json
  {
    "query": "string"
  }
  ```
- **SoundCloud API Endpoint:** `GET /search/tracks?q={query}&limit=20` (v2 API)
- **Sidecar Response Format:**
  *Note:* The Go backend returns a raw JSON array: `[]soundcloudSearchTrack`.
  ```json
  {
    "id": 1,
    "result": [
      {
        "id": 123456789,
        "urn": "soundcloud:tracks:123456789",
        "title": "Track Title",
        "permalinkUrl": "https://soundcloud.com/artist/track",
        "artworkUrl": "https://i1.sndcdn.com/artworks-xxx-t300x300.jpg",
        "duration": 215000,
        "user": {
          "username": "ArtistName",
          "avatarUrl": "https://i1.sndcdn.com/avatars-xxx-large.jpg"
        }
      }
    ]
  }
  ```
- **Critical sidecar communication requirement:**
  `SidecarClient::Response` must support `QJsonArray` (or `QJsonValue` result), because Go's `search.tracks` directly returns a JSON array as `result`, not `{ "tracks": [...] }`.

---

## 2. Artist Profile & Information

- **RPC Method:** `user.profile`
- **Go Handler:** `RPCUserProfile(params userProfileParams) (soundcloudUserProfile, error)`
- **Parameters:**
  ```json
  {
    "userId": 12345678
  }
  ```
- **SoundCloud API Endpoint:** `GET /users/{userId}` (v2 API)
- **Response Structure (`soundcloudUserProfile`):**
  ```json
  {
    "id": 12345678,
    "username": "ArtistUsername",
    "fullName": "Artist Full Name",
    "permalinkUrl": "https://soundcloud.com/artist",
    "avatarUrl": "https://i1.sndcdn.com/avatars-xxx-t500x500.jpg",
    "bannerUrl": "https://i1.sndcdn.com/visuals-xxx.jpg",
    "description": "Artist biography / description",
    "city": "Berlin",
    "country": "DE",
    "followersCount": 154200,
    "followingsCount": 120,
    "trackCount": 45,
    "likesCount": 210,
    "verified": true
  }
  ```
- **Avatar & Banner Upscaling:**
  - Avatar is converted from `-large.` to `-t500x500.`.
  - Banner is retrieved from `visuals.visuals[0].visual_url` or `urls.url`.

---

## 3. Artist Tracks

- **RPC Method:** `user.tracks`
- **Go Handler:** `RPCUserTracks(params userProfileParams) ([]soundcloudTrackCard, error)`
- **Parameters:**
  ```json
  {
    "userId": 12345678
  }
  ```
- **SoundCloud API Endpoint:** `GET /users/{userId}/tracks?representation=minimal&limit=50`
- **Response Format:**
  Raw JSON array of `soundcloudTrackCard`:
  ```json
  [
    {
      "id": 987654321,
      "trackUrn": "soundcloud:tracks:987654321",
      "title": "Song Title",
      "permalinkUrl": "https://soundcloud.com/artist/song",
      "artworkUrl": "https://i1.sndcdn.com/artworks-xxx-t500x500.jpg",
      "duration": 180000,
      "playbackCount": 1250000,
      "likesCount": 45000,
      "user": {
        "username": "ArtistUsername"
      }
    }
  ]
  ```

---

## 4. Artist Playlists

- **RPC Method:** `user.playlists`
- **Go Handler:** `RPCUserPlaylists(params userProfileParams) ([]soundcloudPlaylistCard, error)`
- **Parameters:**
  ```json
  {
    "userId": 12345678
  }
  ```
- **SoundCloud API Endpoint:** `GET /users/{userId}/playlists_without_albums?limit=20`
- **Response Format:**
  Raw JSON array of `soundcloudPlaylistCard`:
  ```json
  [
    {
      "id": "11223344",
      "urn": "soundcloud:playlists:11223344",
      "title": "Album or Playlist Title",
      "permalinkUrl": "https://soundcloud.com/artist/sets/album",
      "artworkUrl": "https://i1.sndcdn.com/artworks-xxx-t500x500.jpg",
      "trackCount": 12,
      "user": {
        "username": "ArtistUsername"
      }
    }
  ]
  ```

---

## 5. Artist Liked Tracks (Public Likes)

- **RPC Method:** `user.likes`
- **Go Handler:** `RPCUserLikes(params userLikesParams) (soundcloudTrackPage, error)`
- **Parameters:**
  ```json
  {
    "userId": 12345678,
    "next": ""
  }
  ```
- **SoundCloud API Endpoint:** `GET /users/{userId}/likes?limit=20`
- **Response Format:**
  ```json
  {
    "tracks": [ /* soundcloudTrackCard */ ],
    "nextHref": "https://api-v2.soundcloud.com/users/.../likes?..."
  }
  ```

---

## 6. Track Details

- **RPC Method:** `track.details`
- **Go Handler:** `RPCTrackDetails(params trackDetailsParams) (soundcloudTrackDetails, error)`
- **Parameters:**
  ```json
  {
    "trackId": 987654321
  }
  ```
- **SoundCloud API Endpoint:** `GET /tracks/{trackId}`
- **Response Structure (`soundcloudTrackDetails`):**
  ```json
  {
    "id": 987654321,
    "urn": "soundcloud:tracks:987654321",
    "title": "Track Title",
    "permalinkUrl": "https://soundcloud.com/artist/track",
    "artworkUrl": "https://i1.sndcdn.com/artworks-xxx-t500x500.jpg",
    "description": "Full track description / lyrics / credits",
    "genre": "Electronic",
    "tagList": "synthwave chill electronic",
    "duration": 215000,
    "playbackCount": 2400000,
    "likesCount": 85000,
    "repostsCount": 3200,
    "commentCount": 1400,
    "createdAt": "2023-05-12T10:00:00Z",
    "displayDate": "2023-05-12T10:00:00Z",
    "waveformUrl": "https://wave.sndcdn.com/xxx.json",
    "user": {
      "id": 12345678,
      "username": "ArtistUsername",
      "avatarUrl": "https://i1.sndcdn.com/avatars-xxx-large.jpg",
      "permalinkUrl": "https://soundcloud.com/artist",
      "followersCount": 154200
    }
  }
  ```

---

## 7. Related Tracks

- **RPC Method:** `track.related`
- **Go Handler:** `RPCTrackRelated(params relatedTracksParams) ([]soundcloudSearchTrack, error)`
- **Parameters:**
  ```json
  {
    "trackId": 987654321
  }
  ```
- **SoundCloud API Endpoint:** `GET /tracks/{trackId}/related?limit=15`
- **Response Format:**
  Raw JSON array of `soundcloudSearchTrack`.

---

## 8. Track Stream Resolution & Playback

- **RPC Method:** `track.stream`
- **Parameters:** `{ "trackUrn": "soundcloud:tracks:..." }`
- **Returns:** `{ "url": "https://...", "hls": true/false, "preview": false, "quality": "sq" }`
- **Resonance Playback Strategy:**
  - HLS streams fetched segment-by-segment and saved to a local `.mp3`/`.aac` in the cache directory (`~/Library/Caches/Resonance/soundcloud/`).
  - Progressive streams downloaded directly.
  - The local cached file is then passed to the core player engine.

---

## 9. Formatting Conventions

- **View / Play count, Likes, Followers:**
  - Millions: `1.2M`, `5M`, `14.5M` (1 decimal place if non-zero, suffix `M`).
  - Thousands: `850K`, `12.4K` (suffix `K`).
  - Below 1,000: exact number.
- **Duration:** `m:ss` (e.g. `3:45`).
- **Dates:** formatted as display date or year.
