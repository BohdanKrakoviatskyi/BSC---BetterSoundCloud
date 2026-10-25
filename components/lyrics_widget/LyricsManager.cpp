#include "LyricsManager.h"

#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QStringList>
#include <QTextDocument>
#include <QUrl>
#include <QUrlQuery>

#include <algorithm>
#include <cstdlib>
#include <limits>
#include <utility>

namespace resonance::lyrics {
namespace {

// a stuck provider must not leave the view loading forever
constexpr int kRequestTimeoutMs = 15000;

// LRCLIB asks clients to identify themselves; Genius expects a browser
constexpr auto kAppUserAgent = "Resonance/0.2 (Qt lyrics widget)";
constexpr auto kBrowserUserAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

bool isMissing(const QString &value)
{
    const QString trimmed = value.trimmed();
    return trimmed.isEmpty()
        || trimmed.compare(QStringLiteral("null"), Qt::CaseInsensitive) == 0;
}

QString normalizedWords(const QString &text)
{
    static const QRegularExpression punctuation(QStringLiteral(R"([^\p{L}\p{N}]+)"));
    QString words = text.toCaseFolded();
    words.replace(punctuation, QStringLiteral(" "));
    return words.simplified();
}

QString searchText(const QString &artist, const QString &track)
{
    return QStringList { artist, track }.join(QLatin1Char(' ')).simplified();
}

QList<LyricLine> plainLines(const QString &text)
{
    QList<LyricLine> lines;
    const QStringList rows = text.split(QLatin1Char('\n'));
    lines.reserve(rows.size());
    for (const QString &row : rows) {
        const QString line = row.trimmed();
        if (!line.isEmpty())
            lines.append({ 0, line });
    }
    return lines;
}

QJsonObject chooseBestResult(const QJsonArray &results, qint64 localDurationSeconds)
{
    QJsonObject best;
    int bestScore = std::numeric_limits<int>::min();
    int bestTimeDiff = std::numeric_limits<int>::max();

    const qint64 localDuration64 = qBound<qint64>(
        0, localDurationSeconds, static_cast<qint64>(std::numeric_limits<int>::max()));
    const int localDuration = static_cast<int>(localDuration64);

    for (const QJsonValue &value : results) {
        const QJsonObject candidate = value.toObject();
        const QString synced = candidate.value(QStringLiteral("syncedLyrics")).toString();
        const QString plain = candidate.value(QStringLiteral("plainLyrics")).toString();

        // a candidate without any lyrics is useless, even if its duration fits
        if (isMissing(synced) && isMissing(plain))
            continue;

        const int apiDuration = qRound(candidate.value(QStringLiteral("duration")).toDouble(0.0));
        const int timeDiff = (apiDuration > 0 && localDuration > 0)
            ? std::abs(apiDuration - localDuration)
            : 0;

        int score = 1000 - timeDiff;
        if (timeDiff > 15)
            score -= 5000;
        if (!isMissing(synced))
            score += 10000;

        if (score > bestScore || (score == bestScore && timeDiff < bestTimeDiff)) {
            best = candidate;
            bestScore = score;
            bestTimeDiff = timeDiff;
        }
    }

    return best;
}

QRegularExpressionMatch findMatchingDivClose(const QString &html, int contentStart)
{
    static const QRegularExpression divTagRe(
        QStringLiteral(R"(<div\b[^>]*>|</div\s*>)"),
        QRegularExpression::CaseInsensitiveOption);

    int depth = 1;
    QRegularExpressionMatchIterator tags = divTagRe.globalMatch(html, contentStart);
    while (tags.hasNext()) {
        const QRegularExpressionMatch tag = tags.next();
        const QString text = tag.captured(0);
        if (text.startsWith(QLatin1String("</"))) {
            --depth;
            if (depth == 0)
                return tag;
        } else if (!text.endsWith(QLatin1String("/>"))) {
            ++depth;
        }
    }

    return QRegularExpressionMatch();
}

/// Removes Genius blocks such as the contributors header and inline ads that
/// must not become lyric lines.
QString stripExcludedDivs(const QString &html)
{
    static const QRegularExpression openDivRe(
        QStringLiteral(R"(<div\b[^>]*>)"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression excludeRe(
        QStringLiteral(R"(data-exclude-from-selection\s*=\s*["']true["']|class\s*=\s*["'][^"']*LyricsHeader[^"']*["'])"),
        QRegularExpression::CaseInsensitiveOption);

    QList<QPair<int, int>> ranges;
    int coveredUntil = 0;

    QRegularExpressionMatchIterator divs = openDivRe.globalMatch(html);
    while (divs.hasNext()) {
        const QRegularExpressionMatch div = divs.next();
        const int start = div.capturedStart();
        if (start < coveredUntil)
            continue;
        if (!excludeRe.match(div.captured(0)).hasMatch())
            continue;

        const QRegularExpressionMatch close = findMatchingDivClose(html, div.capturedEnd());
        if (!close.hasMatch())
            continue;

        ranges.append({ start, close.capturedEnd() });
        coveredUntil = close.capturedEnd();
    }

    QString result = html;
    for (int i = ranges.size() - 1; i >= 0; --i)
        result.remove(ranges[i].first, ranges[i].second - ranges[i].first);
    return result;
}

QString extractLyricsHtml(const QString &html)
{
    static const QRegularExpression openDivRe(
        QStringLiteral(R"(<div\b[^>]*>)"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression candidateRe(
        QStringLiteral(R"(data-lyrics-container\s*=\s*["']true["']|class\s*=\s*["'][^"']*Lyrics__Container[^"']*["'])"),
        QRegularExpression::CaseInsensitiveOption);

    QStringList blocks;
    int coveredUntil = 0;

    QRegularExpressionMatchIterator divs = openDivRe.globalMatch(html);
    while (divs.hasNext()) {
        const QRegularExpressionMatch div = divs.next();
        const int start = div.capturedStart();
        if (start < coveredUntil)
            continue;
        if (!candidateRe.match(div.captured(0)).hasMatch())
            continue;

        const int contentStart = div.capturedEnd();
        const QRegularExpressionMatch close = findMatchingDivClose(html, contentStart);
        if (!close.hasMatch())
            continue;

        blocks.append(html.mid(contentStart, close.capturedStart() - contentStart));
        coveredUntil = close.capturedEnd();
    }

    return blocks.join(QLatin1Char('\n'));
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
        // lets the handler report a timeout instead of a cancellation
        m_timedOut = true;
        m_reply->abort();
    });
}

LyricsManager::~LyricsManager()
{
    ++m_generation;
    cancelReply();
}

QString LyricsManager::cleanMetadata(const QString &value)
{
    static const QRegularExpression parentheses(QStringLiteral(R"(\([^()]*\))"));
    static const QRegularExpression squareBrackets(QStringLiteral(R"(\[[^\[\]]*\])"));

    QString cleaned = value;
    QString previous;
    do {
        previous = cleaned;
        cleaned.remove(parentheses);
        cleaned.remove(squareBrackets);
    } while (cleaned != previous);

    return cleaned.simplified();
}

bool LyricsManager::matchesGeniusResult(const QString &track, const QString &artist,
                                         const QJsonObject &result)
{
    const QString expected = normalizedWords(track);
    const QString found = normalizedWords(cleanMetadata(result.value(QStringLiteral("title")).toString()));
    if (expected.isEmpty() || found.isEmpty()
        || (found != expected && !found.startsWith(expected + QLatin1Char(' '))))
        return false;

    const QString expectedArtist = normalizedWords(artist);
    if (expectedArtist.isEmpty() || artist.contains(QLatin1Char('_')))
        return true; // SoundCloud uploader usernames are not always the credited artist.

    const QString credited = normalizedWords(result.value(QStringLiteral("primary_artist"))
                                                 .toObject().value(QStringLiteral("name")).toString());
    return credited == expectedArtist || credited.contains(expectedArtist + QLatin1Char(' '))
        || credited.startsWith(expectedArtist + QLatin1Char(' '));
}

void LyricsManager::load(const QString &trackName, const QString &artistName, qint64 durationMs,
                         LyricsSource source)
{
    m_source = source;

    QString cleanTrack = cleanMetadata(trackName);
    QString cleanArtist = cleanMetadata(artistName);
    // SoundCloud uploads commonly use "Artist — Track" while the artist field
    // contains an unrelated uploader handle; prefer the credited name in the title.
    static const QRegularExpression splitTitle(QStringLiteral(R"(^(.+?)\s+[-–—]\s+(.+)$)"));
    const auto parts = splitTitle.match(cleanTrack);
    if (parts.hasMatch()) {
        cleanArtist = parts.captured(1).trimmed();
        cleanTrack = parts.captured(2).trimmed();
    }

    if (cleanTrack.isEmpty() && cleanArtist.isEmpty()) {
        ++m_generation;
        cancelReply();
        m_cleanTrack.clear();
        m_cleanArtist.clear();
        m_durationSeconds = 0;
        fail(State::NotFound, tr("The track has no usable title or artist."));
        return;
    }

    const quint64 generation = ++m_generation;
    cancelReply();

    m_cleanTrack = cleanTrack;
    m_cleanArtist = cleanArtist;
    m_durationSeconds = qMax<qint64>(0, qRound64(durationMs / 1000.0));

    m_lines.clear();
    m_synced = false;

    if (m_source == Genius) {
        setState(State::Loading, tr("Searching Genius..."));
        startGeniusSearch(generation);
    } else {
        setState(State::Loading, tr("Searching LRCLIB..."));
        startLrclibSearch(generation);
    }
}

void LyricsManager::clear()
{
    ++m_generation;
    cancelReply();

    m_cleanTrack.clear();
    m_cleanArtist.clear();
    m_durationSeconds = 0;
    m_lines.clear();
    m_synced = false;

    setState(State::Idle, QString());
    emit lyricsReady(QList<LyricLine>(), false);
}

void LyricsManager::get(const QUrl &url, quint64 generation, ReplyHandler handler)
{
    if (generation != m_generation)
        return;

    cancelReply();

    QNetworkRequest request(url);
    const bool genius = url.host().endsWith(QStringLiteral("genius.com"), Qt::CaseInsensitive);
    const bool geniusApi = genius && url.path().startsWith(QStringLiteral("/api/"));
    request.setHeader(QNetworkRequest::UserAgentHeader,
                      QString::fromLatin1(genius ? kBrowserUserAgent : kAppUserAgent));
    request.setRawHeader("Accept", geniusApi ? "application/json"
                                             : (genius ? "text/html,application/xhtml+xml"
                                                       : "application/json"));
    if (genius) {
        request.setRawHeader("Accept-Language", "en-US,en;q=0.9");
        request.setRawHeader("Referer", "https://genius.com/");
    }
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                         QNetworkRequest::NoLessSafeRedirectPolicy);

    QNetworkReply *reply = m_network->get(request);
    m_reply = reply;

    connect(reply, &QNetworkReply::finished, this,
            [this, reply, generation, handler = std::move(handler)]() mutable {
        m_timeout.stop();
        if (m_reply == reply)
            m_reply = nullptr;

        if (generation != m_generation) {
            // a newer track has already replaced this one
            reply->deleteLater();
            return;
        }

        const bool timedOut = m_timedOut;
        m_timedOut = false;

        if (timedOut) {
            reply->deleteLater();
            handler(nullptr);
            return;
        }

        handler(reply);
    });

    m_timeout.start();
}

void LyricsManager::cancelReply()
{
    m_timeout.stop();
    m_timedOut = false;

    if (m_reply) {
        m_reply->disconnect(this);
        m_reply->abort();
        m_reply->deleteLater();
        m_reply = nullptr;
    }
}

void LyricsManager::startLrclibSearch(quint64 generation)
{
    if (generation != m_generation)
        return;

    setState(State::Loading, tr("Searching LRCLIB..."));

    QUrl url(QStringLiteral("https://lrclib.net/api/search"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("q"), searchText(m_cleanArtist, m_cleanTrack));
    url.setQuery(query);

    // Auto silently falls through to Genius; a manually selected provider must
    // never be replaced by the other one.
    const auto failOrUseGenius = [this, generation](State state, const QString &message) {
        if (m_source == Auto)
            startGeniusSearch(generation);
        else
            fail(state, message);
    };

    get(url, generation, [this, generation, failOrUseGenius](QNetworkReply *reply) {
        if (generation != m_generation) {
            if (reply)
                reply->deleteLater();
            return;
        }

        if (!reply) {
            failOrUseGenius(State::Error, tr("The LRCLIB request timed out."));
            return;
        }

        const QByteArray payload = reply->readAll();
        const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QNetworkReply::NetworkError error = reply->error();
        const QString errorText = reply->errorString();
        reply->deleteLater();

        if (error != QNetworkReply::NoError || httpStatus != 200) {
            const QString message = httpStatus > 0
                ? tr("LRCLIB request failed (HTTP %1).").arg(httpStatus)
                : tr("Could not reach LRCLIB: %1").arg(errorText);
            failOrUseGenius(State::Error, message);
            return;
        }

        QJsonParseError parseError {};
        const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
        if (parseError.error != QJsonParseError::NoError || !document.isArray()) {
            failOrUseGenius(State::Error,
                            tr("LRCLIB sent a response that could not be read."));
            return;
        }

        const QJsonObject best = chooseBestResult(document.array(), m_durationSeconds);
        if (best.isEmpty()) {
            failOrUseGenius(State::NotFound, tr("No lyrics found in LRCLIB."));
            return;
        }

        const QString syncedLyrics = best.value(QStringLiteral("syncedLyrics")).toString();
        const QString plainLyrics = best.value(QStringLiteral("plainLyrics")).toString();

        QList<LyricLine> lyrics;
        if (!isMissing(syncedLyrics))
            lyrics = parseLrc(syncedLyrics);

        // Auto only accepts timed lyrics. A plain LRCLIB result is discarded
        // in favour of Genius; manual LRCLIB mode accepts plain lyrics too.
        if (m_source == Auto) {
            if (!lyrics.isEmpty()) {
                setLines(lyrics, true);
                return;
            }
            startGeniusSearch(generation);
            return;
        }

        // source == LrcLib: never fall back to Genius.
        bool isSynced = !lyrics.isEmpty();

        if (lyrics.isEmpty() && !isMissing(plainLyrics)) {
            lyrics = plainLines(plainLyrics);
            isSynced = false;
        }
        if (lyrics.isEmpty()) {
            fail(State::NotFound, tr("No usable lyrics found in LRCLIB."));
            return;
        }

        setLines(lyrics, isSynced);
    });
}

void LyricsManager::startGeniusSearch(quint64 generation)
{
    if (generation != m_generation)
        return;

    setState(State::Loading, tr("Searching Genius..."));

    QUrl url(QStringLiteral("https://genius.com/api/search/multi"));
    QUrlQuery query;
    query.addQueryItem(QStringLiteral("per_page"), QStringLiteral("5"));
    query.addQueryItem(QStringLiteral("q"), searchText(m_cleanArtist, m_cleanTrack));
    url.setQuery(query);

    get(url, generation, [this, generation](QNetworkReply *reply) {
        if (generation != m_generation) {
            if (reply)
                reply->deleteLater();
            return;
        }
        if (!reply) {
            fail(State::Error, tr("The lyrics request timed out."));
            return;
        }

        const QByteArray payload = reply->readAll();
        const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QNetworkReply::NetworkError error = reply->error();
        reply->deleteLater();

        if (error != QNetworkReply::NoError || httpStatus != 200) {
            fail(State::Error, tr("Genius search failed (HTTP %1).").arg(httpStatus));
            return;
        }

        QJsonParseError parseError {};
        const QJsonDocument document = QJsonDocument::fromJson(payload, &parseError);
        if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
            fail(State::Error, tr("Genius sent a response that could not be read."));
            return;
        }

        QString pageUrl;
        bool hadSongHits = false;
        const QJsonArray sections = document.object()
                                        .value(QStringLiteral("response"))
                                        .toObject()
                                        .value(QStringLiteral("sections"))
                                        .toArray();

        for (const QJsonValue &sectionValue : sections) {
            const QJsonObject section = sectionValue.toObject();
            if (section.value(QStringLiteral("type")).toString() != QStringLiteral("song"))
                continue;

            const QJsonArray hits = section.value(QStringLiteral("hits")).toArray();
            if (hits.isEmpty())
                continue;

            for (const QJsonValue &hit : hits) {
                const QJsonObject result = hit.toObject().value(QStringLiteral("result")).toObject();
                hadSongHits = true;
                if (!matchesGeniusResult(m_cleanTrack, m_cleanArtist, result))
                    continue;
                pageUrl = result.value(QStringLiteral("url")).toString();
                if (pageUrl.isEmpty()) {
                    const QString path = result.value(QStringLiteral("path")).toString();
                    if (!path.isEmpty())
                        pageUrl = QStringLiteral("https://genius.com") + path;
                }
                if (!pageUrl.isEmpty())
                    break;
            }
            if (!pageUrl.isEmpty())
                break;
        }

        if (pageUrl.isEmpty()) {
            fail(State::NotFound, hadSongHits
                     ? tr("No matching song on Genius. Try Auto or LRCLIB.")
                     : tr("No lyrics on Genius for this track. Try Auto or LRCLIB."));
            return;
        }

        QUrl resolved(pageUrl);
        if (resolved.isRelative())
            resolved = QUrl(QStringLiteral("https://genius.com")).resolved(resolved);

        if (!resolved.isValid()
            || (resolved.scheme() != QStringLiteral("http")
                && resolved.scheme() != QStringLiteral("https"))) {
            fail(State::Error, tr("Genius returned an invalid lyrics URL."));
            return;
        }

        startGeniusPage(resolved, generation);
    });
}

void LyricsManager::startGeniusPage(const QUrl &url, quint64 generation)
{
    if (generation != m_generation)
        return;

    setState(State::Loading, tr("Loading lyrics from Genius..."));

    get(url, generation, [this, generation](QNetworkReply *reply) {
        if (generation != m_generation) {
            if (reply)
                reply->deleteLater();
            return;
        }
        if (!reply) {
            fail(State::Error, tr("The lyrics request timed out."));
            return;
        }

        const QByteArray payload = reply->readAll();
        const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QNetworkReply::NetworkError error = reply->error();
        reply->deleteLater();

        if (error != QNetworkReply::NoError || httpStatus != 200) {
            fail(State::Error, tr("Could not download lyrics from Genius (HTTP %1).")
                                   .arg(httpStatus));
            return;
        }

        const QList<LyricLine> lyrics = parseGeniusHtml(QString::fromUtf8(payload));
        if (lyrics.isEmpty()) {
            fail(State::NotFound, tr("No lyrics found on the Genius page."));
            return;
        }

        setLines(lyrics, false);
    });
}

QList<LyricLine> LyricsManager::parseGeniusHtml(const QString &html)
{
    static const QRegularExpression scriptRe(
        QStringLiteral(R"(<(script|style)\b[^>]*>.*?</\1\s*>)"),
        QRegularExpression::DotMatchesEverythingOption
            | QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression commentRe(
        QStringLiteral(R"(<!--.*?-->)"),
        QRegularExpression::DotMatchesEverythingOption);
    static const QRegularExpression brRe(
        QStringLiteral(R"(<br\s*/?>)"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression divEndRe(
        QStringLiteral(R"(</div\s*>)"),
        QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression tagRe(QStringLiteral(R"(<[^>]*>)"));

    QString source = html;
    source.remove(scriptRe);
    source.remove(commentRe);
    source = stripExcludedDivs(source);

    QString lyricsHtml = extractLyricsHtml(source);
    if (lyricsHtml.isEmpty())
        return {};

    lyricsHtml.replace(brRe, QStringLiteral("\n"));
    lyricsHtml.replace(divEndRe, QStringLiteral("\n"));
    lyricsHtml.remove(tagRe);

    // Decode entities line by line so the \n separators survive QTextDocument.
    QList<LyricLine> lines;
    const QStringList rows = lyricsHtml.split(QLatin1Char('\n'));
    lines.reserve(rows.size());

    for (const QString &row : rows) {
        QTextDocument document;
        document.setHtml(row);

        QString text = document.toPlainText();
        text.replace(QChar(0x00A0), QLatin1Char(' '));
        text = text.trimmed();
        if (!text.isEmpty())
            lines.append({ 0, text });
    }

    return lines;
}

QList<LyricLine> LyricsManager::parseLrc(const QString &lrc)
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

    QList<LyricLine> lines;
    const QStringList rows = lrc.split(QLatin1Char('\n'));
    lines.reserve(rows.size());

    for (const QString &row : rows) {
        // a row can carry several stamps: "[00:12.00][00:42.00]words"
        QList<qint64> times;
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
            times.append(minutes * 60000 + seconds * 1000 + millis);
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
            lines.append({ qMax<qint64>(0, time - offsetMs), text });
        }
    }

    std::stable_sort(lines.begin(), lines.end(),
                     [](const LyricLine &left, const LyricLine &right) {
                         return left.timeMs < right.timeMs;
                     });
    return lines;
}

void LyricsManager::setLines(const QList<LyricLine> &lines, bool isSynced)
{
    m_lines = lines;
    m_synced = isSynced;

    setState(State::Ready, QString());
    emit lyricsReady(m_lines, m_synced);
}

void LyricsManager::fail(State state, const QString &message)
{
    m_lines.clear();
    m_synced = false;

    setState(state, message);
    emit lyricsReady(QList<LyricLine>(), false);
}

void LyricsManager::setState(State state, const QString &message)
{
    if (m_state == state && m_status == message)
        return;
    m_state = state;
    m_status = message;
    emit stateChanged(state);
}

} // namespace resonance::lyrics
