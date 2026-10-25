#pragma once

#include <QWidget>

class QLabel;
class QListWidget;

namespace resonance::lyrics {

class LyricsManager;

/// QListWidget view over LyricsManager: shows the lyrics, highlights the line
/// that is playing and keeps it centred. Plain (untimed) lyrics are shown as
/// static text: no highlight and no auto-scroll.
class LyricsWidget : public QWidget {
    Q_OBJECT

public:
    explicit LyricsWidget(QWidget *parent = nullptr);

    LyricsManager *manager() const { return m_manager; }

public slots:
    /// Starts loading the lyrics of one track. `durationMs` is the match key
    /// that keeps a radio edit from matching the album cut.
    void load(const QString &trackName, const QString &artistName, qint64 durationMs);
    /// The player's positionChanged(positionMs).
    void setPositionMs(qint64 positionMs);
    /// Manual calibration added to the position: positive values advance the
    /// highlight, negative values delay it.
    void setManualOffsetMs(qint64 offsetMs);

private:
    void rebuildLines();
    void applyActiveLine(int index);
    void showStatus(const QString &text);

    LyricsManager *m_manager = nullptr;
    QListWidget *m_list = nullptr;
    QLabel *m_status = nullptr;
    int m_activeRow = -1;
};

} // namespace resonance::lyrics
