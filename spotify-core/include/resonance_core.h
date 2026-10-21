/*
 * the c interface to spotify-core, built with `--features capi`. it mirrors
 * the swift-bridge interface the apple apps use (src/swift_ffi.rs).
 *
 * strings are nul-terminated utf-8. a string returned from here is owned by the
 * caller and released with resonance_string_free. functions returning an error
 * string return null on success.
 *
 * async calls return immediately. their result is queued as a completion and
 * the descriptor from resonance_core_completion_fd becomes readable: drain it,
 * then call resonance_core_take_completion until it returns false.
 */
#ifndef RESONANCE_CORE_H
#define RESONANCE_CORE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ResonanceCore ResonanceCore;

ResonanceCore *resonance_core_new(void);
void resonance_core_free(ResonanceCore *core);
void resonance_string_free(char *value);

int resonance_core_completion_fd(const ResonanceCore *core);
/* where there is no descriptor (windows: it is -1), callback(context) is
 * called from the finishing thread instead each time a completion is queued;
 * null takes it back. context lives until then. */
void resonance_core_set_completion_callback(const ResonanceCore *core, void (*callback)(void *),
                                           void *context);
bool resonance_core_take_completion(const ResonanceCore *core, uint64_t *request_id, bool *ok,
                                   char **payload);

/* async: each completes with `request_id`. lyrics complete with json, as do
 * both connects (the login to reconnect with), the rest with an empty payload
 * on success.
 *
 * a play call made while an earlier one is still running replaces it, as do
 * an output restart and a new connection: the earlier one then fails with
 * RESONANCE_CORE_SUPERSEDED, having started no sound. */
#define RESONANCE_CORE_SUPERSEDED "the request was replaced by a newer one"

void resonance_core_connect(const ResonanceCore *core, uint64_t request_id, const char *access_token,
                           const char *client_id);
/* a login resonance_core_connect (or this) completed with: librespot's reusable
 * credentials, which spend no oauth refresh token */
void resonance_core_connect_stored(const ResonanceCore *core, uint64_t request_id, const char *login,
                                  const char *client_id);
void resonance_core_play_track(const ResonanceCore *core, uint64_t request_id,
                              const char *spotify_uri);
/* prepares the next Spotify track on the standby player without starting it. */
char *resonance_core_preload_track(const ResonanceCore *core, const char *spotify_uri,
                                  int preload_standby);
/* starts the preloaded track and overlaps it with the current one for duration_ms. */
void resonance_core_crossfade_track(const ResonanceCore *core, uint64_t request_id,
                                   const char *spotify_uri, uint32_t duration_ms);
void resonance_core_restart_audio_output(const ResonanceCore *core, uint64_t request_id);
void resonance_core_lyrics_json(const ResonanceCore *core, uint64_t request_id,
                               const char *spotify_uri);
/* plays a music file of the person's own from anywhere on disk: mp3, flac,
 * ogg vorbis, wav, aiff, or aac or apple lossless in an m4a. */
void resonance_core_play_file(const ResonanceCore *core, uint64_t request_id, const char *path);
void resonance_core_crossfade_file(const ResonanceCore *core, uint64_t request_id, const char *path,
                                  uint32_t duration_ms);

/* what a music file's tags say, as json: title, artist, album, albumArtist,
 * trackNumber, discNumber, date, genre (each null when the file does not
 * say), durationMs and artworkPath (an embedded cover written into
 * artwork_dir under a name taken from its contents, or a cover image kept
 * beside the file, or null). null with *error set if it cannot be read.
 * needs no core and may be called from any thread. */
char *resonance_read_local_tags(const char *path, const char *artwork_dir, char **error);
/* writes edits into a music file's tags: json with any of title, artist,
 * album, albumArtist, genre, date, trackNumber, discNumber (each set, or
 * cleared when empty; one left out is kept) and removeArtwork, with
 * `artwork` (artwork_len bytes of a jpeg or png, or null) as the front
 * cover. returns null, or an error to free; the file is left as it was if
 * anything fails. needs no core and may be called from any thread. */
char *resonance_write_local_tags(const char *path, const char *edits, const uint8_t *artwork,
                                size_t artwork_len);

void resonance_core_disconnect(const ResonanceCore *core);

char *resonance_core_play(const ResonanceCore *core);
char *resonance_core_pause(const ResonanceCore *core);
char *resonance_core_seek(const ResonanceCore *core, uint32_t position_ms);
char *resonance_core_set_volume(const ResonanceCore *core, float volume);
char *resonance_core_set_stream_quality(const ResonanceCore *core, uint32_t kbps);
/* keeps streamed songs in path (empty: none), up to limit_bytes; applies the
 * next time playback connects */
char *resonance_core_set_audio_cache(const ResonanceCore *core, const char *path,
                                    uint64_t limit_bytes);
char *resonance_core_set_playback_shaping(const ResonanceCore *core, float tempo,
                                         float pitch_semitones, bool preserves_pitch);
char *resonance_core_set_equalizer(const ResonanceCore *core, const float *gains_db, size_t count);

bool resonance_core_session_is_valid(const ResonanceCore *core);
bool resonance_core_audio_output_stalled(const ResonanceCore *core);
uint32_t resonance_core_playback_position_ms(const ResonanceCore *core);
uint32_t resonance_core_playback_duration_ms(const ResonanceCore *core);
bool resonance_core_take_end_of_track(const ResonanceCore *core);
float resonance_core_volume(const ResonanceCore *core);

void resonance_core_set_spectrum_enabled(const ResonanceCore *core, bool enabled);
/* 48 bands in 0...1. allocates nothing; returns how many were written. */
size_t resonance_core_spectrum_levels(const ResonanceCore *core, float *out, size_t capacity);

/* the equalizer's centre frequencies in hz; returns how many were written. */
size_t resonance_equalizer_frequencies(float *out, size_t capacity);

#ifdef __cplusplus
}
#endif

#endif
