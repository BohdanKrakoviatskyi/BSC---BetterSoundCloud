# lyrics_widget

A small Qt Widgets lyric view: searches LRCLIB, falls back to Genius, highlights
the line being played and keeps it centred. Plain (untimed) lyrics are shown as
static text without auto-scroll. The playback source can be chosen from a
right-click menu: Auto, LRCLIB or Genius.

Resonance's Qt Quick interface uses `LyricsManager` for LRCLIB/Genius
search when its existing lyrics pipeline has no synced lyrics or when a
source is selected manually. `LyricsWidget` remains available for other
Qt Widgets applications through this same library.

## Requirements

- Qt 6 or Qt 5.15, modules `Core`, `Network`, `Widgets`
- C++17

## Build

```cmake
add_subdirectory(components/lyrics_widget)
target_link_libraries(my_app PRIVATE lyrics_widget)
```

## Wiring

```cpp
#include "LyricsManager.h"
#include "LyricsWidget.h"

auto *lyrics = new resonance::lyrics::LyricsWidget(this);
layout->addWidget(lyrics);

// on track change: names are cleaned before the HTTP requests
lyrics->load(track.title, track.artist, track.durationMs);

// optional: choose the provider programmatically (the context menu does the
// same and reloads the current track)
lyrics->setSource(resonance::lyrics::LyricsManager::Auto);

// every positionChanged() tick
connect(player, &Player::positionChanged,
        lyrics, &resonance::lyrics::LyricsWidget::onPositionChanged);

// optional manual calibration: +500 ms / -500 ms per call, default 0 ms
connect(lyricsEarlier, &QPushButton::clicked,
        lyrics, &resonance::lyrics::LyricsWidget::increaseOffset);
connect(lyricsLater, &QPushButton::clicked,
        lyrics, &resonance::lyrics::LyricsWidget::decreaseOffset);
```

`LyricsWidget::manager()` gives access to `LyricsManager` for the state enum,
`lyricsReady(const QList<LyricLine> &, bool isSynced)` and `stateChanged()`.
`selectedSource()` returns the current provider choice, and `setSource()` reloads
the current track with it.

The right-click menu is available on the lyrics list and on the status label, so
the provider can still be changed when Auto found nothing.

## Sources

`LyricsManager::load()` takes an optional `LyricsSource`:

```cpp
void load(const QString &trackName, const QString &artistName, qint64 durationMs,
          LyricsSource source = Auto);
```

- `Auto` — query LRCLIB and use it only when the best result has timed
  `syncedLyrics`. A plain-only LRCLIB result is discarded and Genius is used.
  Network/JSON errors also fall through to Genius.
- `LrcLib` — use LRCLIB only. Synced lyrics are preferred, but a plain-only
  result is accepted. If LRCLIB has nothing, the request ends in `NotFound`;
  Genius is never tried.
- `Genius` — skip LRCLIB and scrape Genius directly.

## Behaviour

- Track and artist are cleaned before every request: `(feat. X)`, `[Radio
  Edit]` and similar bracket contents are removed, whitespace is collapsed.
- LRCLIB is the primary provider. `/api/search?q=artist track` is used
  (not `/api/get`); every result is scored as `1000 - abs(apiDuration -
  localDuration)`, `-5000` when the difference is over 15 seconds and `+10000`
  when the result has `syncedLyrics`. The best result wins. Presence of
  `syncedLyrics` is what selects LRCLIB in Auto mode; a duration penalty can
  lower the numeric score below 10000 for a different edit of the same track.
- Genius: `/api/search/multi?per_page=1`, first `song` section, then the page
  URL. `data-lyrics-container="true"` and `Lyrics__Container` blocks are
  extracted, nested `<div>` elements are matched by depth, HTML entities are
  decoded with `QTextDocument`, and the lines are emitted with
  `isSynced = false`.
- `syncedLyrics` is parsed from `[mm:ss.xx]` / `[mm:ss.xxx]` stamps, including
  several stamps per line, `[offset:...]`, and enhanced-LRC word stamps.
- Without `syncedLyrics`, `plainLyrics` is split into lines with `timeMs = 0`
  and `isSynced = false`; the view then shows the text with no highlight and
  no auto-scroll.
- `onLyricsReady` stores `m_isSynced`, fills the `QListWidget` and resets the
  current line. `onPositionChanged` adds `m_manualOffsetMs`, scans the sorted
  lines from the end and scrolls only when `m_currentIndex` changes.
- A request in flight is cancelled when another track or source is loaded;
  replies are generation-checked, so a late answer cannot overwrite the current
  track.
- Every HTTP request times out after 15 s. In manual modes HTTP/JSON/network
  failures end up in `State::Error`, and an empty provider result ends up in
  `State::NotFound`, with a message in `statusMessage()`.
