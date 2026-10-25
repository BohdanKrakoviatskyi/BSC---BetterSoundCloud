#pragma once

#include "LyricsManager.h"

#include <QWidget>

class QLabel;
class QListWidget;
class QPoint;

namespace resonance::lyrics {

/// QListWidget view over LyricsManager: shows the lyrics, highlights the line
/// that is playing and keeps it centred. Plain (untimed) lyrics are shown as
/// static text: no highlight and no auto-scroll.
///
/// A right-click context menu lets the user choose Auto, LRCLIB or Genius.
/// Changing the source reloads the current track without losing the playback
/// position or the manual offset.
class LyricsWidget : public QWidget {
    Q_OBJECT

public:
    explicit LyricsWidget(QWidget *parent = nullptr);

    LyricsManager *manager() const { return m_manager; }
    qint64 manualOffsetMs() const { return m_manualOffsetMs; }
    LyricsManager::LyricsSource selectedSource() const { return m_selectedSource; }

public slots:
    /// Starts loading the lyrics of one track with the currently selected source.
    void load(const QString &trackName, const QString &artistName, qint64 durationMs);

    /// Changes the provider and reloads the current track with it.
    void setSource(LyricsManager::LyricsSource source);

    /// Delivery from LyricsManager; plain lyrics are displayed without timing.
    void onLyricsReady(const QList<LyricLine> &lyrics, bool isSynced);

    /// The player's positionChanged(positionMs).
    void onPositionChanged(qint64 positionMs);

    /// Manual calibration: +500 ms / -500 ms, applied immediately.
    void increaseOffset();
    void decreaseOffset();

    /// Sets the calibration directly. Positive values advance the highlight,
    /// negative values delay it. The default is 0 ms.
    void setManualOffsetMs(qint64 offsetMs);

private:
    void showSourceMenu(const QPoint &pos);
    void applyCurrentIndex(int index);
    void showStatus(const QString &text);

    LyricsManager *m_manager = nullptr;
    QListWidget *m_list = nullptr;
    QLabel *m_status = nullptr;

    QList<LyricLine> m_lines;
    bool m_isSynced = false;
    int m_currentIndex = -1;
    qint64 m_manualOffsetMs = 0;
    qint64 m_positionMs = 0;

    QString m_trackName;
    QString m_artistName;
    qint64 m_durationMs = 0;
    bool m_hasTrack = false;
    LyricsManager::LyricsSource m_selectedSource = LyricsManager::Auto;
};

} // namespace resonance::lyrics
