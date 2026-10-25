#pragma once

#include <QObject>
#include <QString>
#include <QTimer>
#include <QVector>

class QNetworkAccessManager;
class QNetworkReply;

namespace resonance::lyrics {

/// One line of an LRC file.
struct LyricLine {
    qint64 timeMs = 0;
    QString text;
};

/// Fetches lyrics from LRCLIB and turns the player's position into the index
/// of the line being sung.
///
/// Everything is asynchronous and lives on the GUI thread: a request never
/// blocks the player, and the active line is found with a binary search, so a
/// positionChanged() tick costs O(log n).
class LyricsManager : public QObject {
    Q_OBJECT

public:
    enum class State {
        Idle,     ///< nothing has been requested yet
        Loading,  ///< a request is in flight
        Ready,    ///< lyrics are available, timed or plain
        NotFound, ///< LRCLIB has no lyrics for the track
        Error     ///< network, HTTP or JSON failure
    };
    Q_ENUM(State)

    explicit LyricsManager(QObject *parent = nullptr);
    ~LyricsManager() override;

    /// Requests the lyrics of one track. A request still in flight is
    /// cancelled. `durationMs` is the match key that keeps a radio edit from
    /// matching the album cut; pass 0 when the length is not known yet.
    void load(const QString &trackName, const QString &artistName, qint64 durationMs);
    void clear();

    State state() const { return m_state; }
    bool isSynchronized() const { return m_synchronized; }
    const QVector<LyricLine> &lines() const { return m_lines; }
    QString statusMessage() const { return m_status; }

    /// The line playing at the last position: -1 before the first timed line
    /// and for plain, unsynchronised lyrics.
    int activeLine() const { return m_activeLine; }

    qint64 manualOffsetMs() const { return m_manualOffsetMs; }
    /// Calibration added to the player's position. Positive values make the
    /// active line switch earlier, which is what a lagging highlight needs.
    void setManualOffsetMs(qint64 offsetMs);

    /// Parses the `syncedLyrics` flavour of LRC: "[mm:ss.xx] text" and
    /// "[mm:ss.xxx] text", several stamps per line, an [offset:] tag.
    static QVector<LyricLine> parseLrc(const QString &lrc);

public slots:
    /// Feed with the player's positionChanged(positionMs).
    void setPositionMs(qint64 positionMs);

signals:
    /// New lines, a cleared list or a failed load: repopulate the view.
    void lyricsChanged();
    void activeLineChanged(int index);
    void stateChanged(resonance::lyrics::LyricsManager::State state);
    void manualOffsetMsChanged(qint64 offsetMs);

private:
    void finishRequest(QNetworkReply *reply, quint64 generation);
    void readPayload(const QByteArray &payload);
    void fail(State state, const QString &message);
    void setLines(QVector<LyricLine> lines, bool synchronized);
    void updateActiveLine();
    void setState(State state, const QString &message);

    QNetworkAccessManager *m_network = nullptr;
    QNetworkReply *m_reply = nullptr;
    QTimer m_timeout;
    quint64 m_generation = 0;
    bool m_timedOut = false;

    State m_state = State::Idle;
    QString m_status;
    QVector<LyricLine> m_lines;
    bool m_synchronized = false;

    qint64 m_positionMs = 0;
    qint64 m_manualOffsetMs = 0;
    int m_activeLine = -1;
};

} // namespace resonance::lyrics
