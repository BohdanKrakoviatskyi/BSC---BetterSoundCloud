#include "LyricsManager.h"

#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QStringList>
#include <QUrl>
#include <QUrlQuery>

#include <algorithm>
#include <utility>

namespace resonance::lyrics {
namespace {

// an unresponsive service must not leave the view loading forever
constexpr int kRequestTimeoutMs = 15000;

// LRCLIB asks clients to identify themselves
constexpr auto kUserAgent = "Resonance/0.2 (Qt lyrics widget)";

bool isPlainEmpty(const QString &text)
{
    return text.trimmed().isEmpty();
}

} // namespace

LyricsManager::LyricsManager(QObject *parent)
    : QObject(parent)
    , m_network(new QNetworkAccessManager(this))
{
    m_timeout.setSingleShot(true);
    m_timeout.setInterval(kRequestTimeoutMs);
    connect(&m_timeout, &QTimer::timeout, this, [this] {
        if (!m_reply)
            return;
        // abort() delivers finished() with OperationCanceledError; m_timedOut
        // lets finishRequest() report the timeout instead of a cancellation
        m_timedOut = true;
        m_reply->abort();
    });
}

LyricsManager::~LyricsManager() = default;

void LyricsManager::load(const QString &trackName, const QString &artistName, qint64 durationMs)
{
    if (trackName.trimmed().isEmpty() && artistName.trimmed().isEmpty()) {
        clear();
        return;
    }

    // a newer track wins over whatever was still in flight
    const quint64 generation = ++m_generation;
    if (m_reply) {
        m_reply->disconnect(this);
        m_reply->abort();
        m_reply->deleteLater();
        m_reply = nullptr;
    }
    m_timeout.stop();
    m_timedOut = false;

    QUrlQuery query;
    query.addQueryItem(QStringLiteral("track_name"), trackName);
    query.addQueryItem(QStringLiteral("artist_name"), artistName);
    // the duration is what tells the radio edit from the album cut; skip it
    // only when the player genuinely does not know the length yet
    if (durationMs > 0) {
        query.addQueryItem(QStringLiteral("duration"),
                           QString::number(qRound64(durationMs / 1000.0)));
    }

    QUrl url(QStringLiteral("https://lrclib.net/api/get"));
    url.setQuery(query);

    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::UserAgentHeader, QString::fromLatin1(kUserAgent));
    request.setRawHeader("Accept", "application/json");
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::NoLessSafeRedirectPolicy);

    setState(State::Loading, tr("Loading lyrics..."));
    m_reply = m_network->get(request);
    m_timeout.start();

    connect(m_reply, &QNetworkReply::finished, this, [this, reply = m_reply, generation] {
        m_timeout.stop();
        if (m_reply == reply)
            m_reply = nullptr;
        finishRequest(reply, generation);
    });
}

void LyricsManager::clear()
{
    ++m_generation;
    if (m_reply) {
        m_reply->disconnect(this);
        m_reply->abort();
        m_reply->deleteLater();
        m_reply = nullptr;
    }
    m_timeout.stop();
    m_timedOut = false;

    const bool hadLines = !m_lines.isEmpty();
    const int previous = m_activeLine;
    m_lines.clear();
    m_synchronized = false;
    m_activeLine = -1;

    setState(State::Idle, QString());
    if (hadLines)
        emit lyricsChanged();
    if (previous != -1)
        emit activeLineChanged(-1);
}

void LyricsManager::setPositionMs(qint64 positionMs)
{
    m_positionMs = positionMs;
    updateActiveLine();
}

void LyricsManager::setManualOffsetMs(qint64 offsetMs)
{
    if (m_manualOffsetMs == offsetMs)
        return;
    m_manualOffsetMs = offsetMs;
    emit manualOffsetMsChanged(offsetMs);
    updateActiveLine();
}

void LyricsManager::finishRequest(QNetworkReply *reply, quint64 generation)
{
    if (!reply)
        return;
    if (generation != m_generation) {
        // a newer track has already replaced this one
        reply->deleteLater();
        return;
    }

    const QByteArray payload = reply->readAll();
    const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    const QNetworkReply::NetworkError error = reply->error();
    const QString errorText = reply->errorString();
    reply->deleteLater();

    if (m_timedOut) {
        m_timedOut = false;
        fail(State::Error, tr("The lyrics request timed out."));
        return;
    }
    if (httpStatus == 404) {
        fail(State::NotFound, tr("No lyrics found for this track."));
        return;
    }
    if (error != QNetworkReply::NoError) {
        fail(State::Error, tr("Could not reach LRCLIB: %1").arg(errorText));
        return;
    }
    if (httpStatus != 200) {
        fail(State::Error, tr("LRCLIB answered with HTTP %1.").arg(httpStatus));
        return;
    }

    readPayload(payload);
}

void LyricsManager::readPayload(const QByteArray &payload)
{
    QJsonParseError parseError {};
    const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        fail(State::Error, tr("LRCLIB sent a response that could not be read."));
        return;
    }

    const QJsonObject object = document.object();
    if (object.value(QStringLiteral("instrumental")).toBool()) {
        fail(State::NotFound, tr("This track is instrumental."));
        return;
    }

    const QString synced = object.value(QStringLiteral("syncedLyrics")).toString();
    if (!isPlainEmpty(synced)) {
        QVector<LyricLine> lines = parseLrc(synced);
        if (!lines.isEmpty()) {
            setLines(std::move(lines), true);
            return;
        }
    }

    // fallback: the whole text, shown without pretending to follow playback
    const QString plain = object.value(QStringLiteral("plainLyrics")).toString();
    QVector<LyricLine> lines;
    const QStringList rows = plain.split(QLatin1Char('\n'));
    lines.reserve(rows.size());
    for (const QString &row : rows) {
        const QString text = row.trimmed();
        if (!text.isEmpty())
            lines.push_back({ 0, text });
    }

    if (lines.isEmpty()) {
        fail(State::NotFound, tr("No lyrics found for this track."));
        return;
    }
    setLines(std::move(lines), false);
}

QVector<LyricLine> LyricsManager::parseLrc(const QString &lrc)
{
    // [mm:ss], [mm:ss.xx], [mm:ss.xxx]; a few files use ':' before the fraction
    static const QRegularExpression stamp(
        QStringLiteral(R"(\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\])"));
    static const QRegularExpression offsetTag(
        QStringLiteral(R"(\[offset:\s*([+-]?\d+)\s*\])"),
        QRegularExpression::CaseInsensitiveOption);
    // enhanced LRC word timings are not shown, only the line text
    static const QRegularExpression wordStamp(
        QStringLiteral(R"(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)"));

    qint64 offsetMs = 0;
    const QRegularExpressionMatch offsetMatch = offsetTag.match(lrc);
    if (offsetMatch.hasMatch())
        offsetMs = offsetMatch.captured(1).toLongLong();

    QVector<LyricLine> lines;
    const QStringList rows = lrc.split(QLatin1Char('\n'));
    lines.reserve(rows.size());

    for (const QString &row : rows) {
        // a row can carry several stamps: "[00:12.00][00:42.00]words"
        QVector<qint64> times;
        int consumed = 0;
        QRegularExpressionMatchIterator stamps = stamp.globalMatch(row);
        while (stamps.hasNext()) {
            const QRegularExpressionMatch match = stamps.next();
            if (int(match.capturedStart()) != consumed)
                break; // stamps must lead the row; anything else is metadata
            consumed = int(match.capturedEnd());

            const qint64 minutes = match.captured(1).toLongLong();
            const qint64 seconds = match.captured(2).toLongLong();
            qint64 millis = 0;
            if (!match.captured(3).isEmpty()) {
                // "5" -> 500 ms, "05" -> 50 ms, "500" -> 500 ms
                millis = (match.captured(3) + QStringLiteral("000")).left(3).toLongLong();
            }
            times.push_back(minutes * 60000 + seconds * 1000 + millis);
        }

        if (times.isEmpty())
            continue;

        QString text = row.mid(consumed);
        text.remove(wordStamp);
        text = text.trimmed();
        if (text.isEmpty())
            continue;

        for (qint64 time : times) {
            // a positive [offset:] pulls the lyrics earlier
            lines.push_back({ qMax<qint64>(0, time - offsetMs), text });
        }
    }

    std::stable_sort(lines.begin(), lines.end(),
                     [](const LyricLine &left, const LyricLine &right) {
                         return left.timeMs < right.timeMs;
                     });
    return lines;
}

void LyricsManager::setLines(QVector<LyricLine> lines, bool synchronized)
{
    m_lines = std::move(lines);
    m_synchronized = synchronized && !m_lines.isEmpty();

    const int previous = m_activeLine;
    m_activeLine = -1;

    setState(State::Ready, QString());
    emit lyricsChanged();
    if (previous != -1)
        emit activeLineChanged(-1);

    // the player may already be in the middle of the track
    updateActiveLine();
}

void LyricsManager::fail(State state, const QString &message)
{
    const bool hadLines = !m_lines.isEmpty();
    const int previous = m_activeLine;
    m_lines.clear();
    m_synchronized = false;
    m_activeLine = -1;

    setState(state, message);
    if (hadLines)
        emit lyricsChanged();
    if (previous != -1)
        emit activeLineChanged(-1);
}

void LyricsManager::setState(State state, const QString &message)
{
    if (m_state == state && m_status == message)
        return;
    m_state = state;
    m_status = message;
    emit stateChanged(state);
}

void LyricsManager::updateActiveLine()
{
    int line = -1;
    if (m_synchronized && !m_lines.isEmpty()) {
        const qint64 effective = m_positionMs + m_manualOffsetMs;
        if (effective >= m_lines.first().timeMs) {
            // last line whose time is <= the current position
            const auto bound = std::upper_bound(
                m_lines.cbegin(), m_lines.cend(), effective,
                [](qint64 position, const LyricLine &candidate) {
                    return position < candidate.timeMs;
                });
            line = int(bound - m_lines.cbegin()) - 1;
        }
    }

    if (line == m_activeLine)
        return;
    m_activeLine = line;
    emit activeLineChanged(line);
}

} // namespace resonance::lyrics
