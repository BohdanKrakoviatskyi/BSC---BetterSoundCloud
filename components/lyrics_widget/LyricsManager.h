#pragma once

#include <QList>
#include <QObject>
#include <QString>
#include <QTimer>

#include <functional>

class QJsonObject;
class QNetworkAccessManager;
class QNetworkReply;
class QUrl;

namespace resonance::lyrics {

/// One line of the lyrics. Plain lyrics keep timeMs at 0.
struct LyricLine {
    qint64 timeMs = 0;
    QString text;
};

/// Asynchronous LRCLIB + Genius lyrics loader.
///
/// LRCLIB is the primary provider: /api/search is queried and the candidates
/// are scored against the local track duration. When it has no usable result,
/// Genius search + page scraping is used as a fallback. All HTTP work happens
/// through QNetworkAccessManager on the GUI thread; no call blocks the player.
class LyricsManager : public QObject {
    Q_OBJECT

public:
    enum LyricsSource {
        Auto,   ///< prefer timed LRCLIB, otherwise fall back to Genius
        LrcLib, ///< use LRCLIB only, even if it has only plain lyrics
        Genius  ///< use Genius only
    };
    Q_ENUM(LyricsSource)

    enum class State {
        Idle,     ///< nothing has been requested yet
        Loading,  ///< a request is in flight
        Ready,    ///< lyrics have been delivered
        NotFound, ///< no provider has lyrics for the track
        Error     ///< network, HTTP or JSON failure
    };
    Q_ENUM(State)

    explicit LyricsManager(QObject *parent = nullptr);
    ~LyricsManager() override;

    /// Requests lyrics for one track. A request still in flight is cancelled.
    /// Track and artist names are cleaned before they are sent anywhere.
    void load(const QString &trackName, const QString &artistName, qint64 durationMs,
              LyricsSource source = Auto);
    void clear();

    State state() const { return m_state; }
    LyricsSource source() const { return m_source; }
    bool isSynced() const { return m_synced; }
    const QList<LyricLine> &lines() const { return m_lines; }
    QString statusMessage() const { return m_status; }

    /// Removes the contents of (...) and [...] and collapses whitespace.
    /// "Track (feat. X) [Radio Edit]" -> "Track".
    static QString cleanMetadata(const QString &value);

    /// Rejects a search hit for a different song (including translated titles).
    static bool matchesGeniusResult(const QString &track, const QString &artist,
                                    const QJsonObject &result);

    /// Parses LRC lines: "[mm:ss.xx] text", "[mm:ss.xxx] text", several
    /// stamps per line, an [offset:] tag and enhanced-LRC word stamps.
    static QList<LyricLine> parseLrc(const QString &lrc);

    /// Extracts lyrics from Genius HTML: data-lyrics-container="true" blocks
    /// and elements whose class contains Lyrics__Container.
    static QList<LyricLine> parseGeniusHtml(const QString &html);

signals:
    /// Timed or plain lyrics. An empty list with isSynced == false means
    /// there is nothing to show (or the load failed).
    void lyricsReady(const QList<LyricLine> &lyrics, bool isSynced);
    void stateChanged(resonance::lyrics::LyricsManager::State state);

private:
    using ReplyHandler = std::function<void(QNetworkReply *)>;

    void get(const QUrl &url, quint64 generation, ReplyHandler handler);
    void cancelReply();
    void startLrclibSearch(quint64 generation);
    void startGeniusSearch(quint64 generation);
    void startGeniusPage(const QUrl &url, quint64 generation);
    void fail(State state, const QString &message);
    void setLines(const QList<LyricLine> &lines, bool isSynced);
    void setState(State state, const QString &message);

    QNetworkAccessManager *m_network = nullptr;
    QNetworkReply *m_reply = nullptr;
    QTimer m_timeout;
    quint64 m_generation = 0;
    bool m_timedOut = false;

    State m_state = State::Idle;
    LyricsSource m_source = Auto;
    QString m_status;
    QList<LyricLine> m_lines;
    bool m_synced = false;

    QString m_cleanTrack;
    QString m_cleanArtist;
    qint64 m_durationSeconds = 0;
};

} // namespace resonance::lyrics
