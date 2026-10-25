# lyrics_widget

A small Qt Widgets lyric view for LRCLIB: fetches `syncedLyrics`, falls back to
`plainLyrics`, highlights the line being played and keeps it centred.

It is standalone on purpose. Resonance's own interface is Qt Quick and already
has a lyrics pipeline (`src/playback/Lyrics.*` + the Go sidecar), so this
component is not part of the app target: add it to a widget application, or
copy the four files into an existing target.

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

// on track change
lyrics->load(track.title, track.artist, track.durationMs);

// every positionChanged() tick; a binary search, O(log n)
connect(player, &Player::positionChanged,
        lyrics, &resonance::lyrics::LyricsWidget::setPositionMs);

// optional calibration: positive advances the highlight, negative delays it
lyrics->setManualOffsetMs(-250);
```

`LyricsWidget::manager()` gives access to `LyricsManager` for the state enum,
`lyricsChanged()`, `stateChanged()` and `manualOffsetMsChanged()`.

## Behaviour

- `duration` is sent rounded to seconds; it is what keeps a radio edit from
  matching the album cut. Only an unknown (0) duration is left out, because a
  zero-length match would always fail.
- `syncedLyrics` is parsed from `[mm:ss.xx]` / `[mm:ss.xxx]` stamps, including
  several stamps per line, `[offset:...]`, and enhanced-LRC word stamps.
- Without `syncedLyrics`, the plain text is shown with no highlight and no
  auto-scroll (`setPositionMs` then does nothing visible).
- A request in flight is cancelled when another track is loaded; replies are
  generation-checked, so a late answer cannot overwrite the current track.
- The request times out after 15 s, and HTTP/JSON/network failures end up in
  `State::Error` with a message in `statusMessage()`.
- The active line is recomputed with `std::upper_bound`; `activeLineChanged()`
  is emitted only when the index actually changes.
