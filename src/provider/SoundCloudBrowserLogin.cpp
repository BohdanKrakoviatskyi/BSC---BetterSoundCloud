#include "provider/SoundCloudBrowserLogin.h"

#include "app/Paths.h"
#include "core/Async.h"

#include <QDir>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkProxy>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRandomGenerator>
#include <QStandardPaths>
#include <QTcpServer>
#include <QUrlQuery>

#include <QCoroAbstractSocket>
#include <QCoroNetworkReply>
#include <QCoroTimer>

namespace resonance {

namespace {

/// soundcloud's api, where every signed-in request of the web client lands
constexpr const char *kApiHost = "api-v2.soundcloud.com";
/// the login page the person is sent to
constexpr const char *kLoginUrl = "https://soundcloud.com";
/// however long the person takes to sign in, the capture does not wait forever
constexpr int kDeadlineMs = 5 * 60 * 1000;
/// the debug endpoint takes a moment to appear, and connection checks repeat
constexpr int kPollAttempts = 60;
constexpr std::chrono::milliseconds kPollInterval = std::chrono::milliseconds(500);

/// the app's own profile inside the browser: kept between logins, so a second
/// sign-in finds the cookies and only asks for the account
constexpr const char *kProfileName = "soundcloud-login-profile";

/// a fresh mask key per frame, as the websocket spec demands for outgoing
QByteArray maskKey()
{
    const quint32 raw = QRandomGenerator::system()->generate();
    return QByteArray(reinterpret_cast<const char *>(&raw), sizeof(raw));
}

} // namespace

SoundCloudBrowserLogin::SoundCloudBrowserLogin(QObject *parent)
    : QObject(parent)
{
    // the app may run behind a proxy; the debugging endpoint sits on the
    // loopback and must never go through one
    m_network = new QNetworkAccessManager(this);
    m_network->setProxy(QNetworkProxy(QNetworkProxy::NoProxy));
    m_socket.setSocketOption(QAbstractSocket::LowDelayOption, 1);

    connect(&m_deadline, &QTimer::timeout, this, [this] {
        fail(QStringLiteral("The sign-in was not captured within five minutes."));
    });
    connect(&m_socket, &QTcpSocket::disconnected, this, [this] {
        if (!m_active || m_completed) {
            return;
        }
        if (m_wsUp) {
            fail(QStringLiteral("The browser closed before the sign-in was captured."));
            return;
        }
        // the handshake was refused, likely a stale page url; attach again
        detach(attach());
    });
    connect(&m_browser, &QProcess::errorOccurred, this, [this](QProcess::ProcessError error) {
        if (error == QProcess::FailedToStart && m_active && !m_completed) {
            fail(QStringLiteral("The browser could not be started."));
        }
    });
    connect(&m_browser, &QProcess::finished, this, [this] {
        if (m_active && !m_completed) {
            fail(QStringLiteral("The browser closed before the sign-in was captured."));
        }
    });
    connect(&m_socket, &QTcpSocket::readyRead, this, &SoundCloudBrowserLogin::onSocketData);
}

SoundCloudBrowserLogin::~SoundCloudBrowserLogin()
{
    teardown();
}

QString SoundCloudBrowserLogin::findBrowser() const
{
    QStringList candidates;
#if defined(Q_OS_WIN)
    const QString programFiles = qEnvironmentVariable("ProgramFiles");
    const QString programFilesX86 = qEnvironmentVariable("ProgramFiles(x86)");
    for (const QString &root : { programFiles, programFilesX86 }) {
        if (root.isEmpty()) {
            continue;
        }
        candidates << root + QStringLiteral("/Google/Chrome/Application/chrome.exe")
                   << root + QStringLiteral("/Microsoft/Edge/Application/msedge.exe")
                   << root + QStringLiteral("/BraveSoftware/Brave-Browser/Application/brave.exe");
    }
#elif defined(Q_OS_MAC)
    candidates << QStringLiteral("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
               << QStringLiteral("/Applications/Chromium.app/Contents/MacOS/Chromium")
               << QStringLiteral("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge")
               << QStringLiteral("/Applications/Brave Browser.app/Contents/MacOS/Brave Browser");
#else
    for (const char *name : { "google-chrome-stable", "google-chrome", "chromium",
                              "chromium-browser", "microsoft-edge", "microsoft-edge-stable",
                              "brave-browser" }) {
        candidates << QStandardPaths::findExecutable(QLatin1String(name));
    }
    candidates << QStringLiteral("/opt/google/chrome/chrome");
#endif
    candidates.removeAll(QString());
    return candidates.value(0);
}

quint16 SoundCloudBrowserLogin::claimDebugPort() const
{
    QTcpServer server;
    if (!server.listen(QHostAddress::LocalHost)) {
        return 0;
    }
    const quint16 port = server.serverPort();
    server.close();
    return port;
}

void SoundCloudBrowserLogin::setActive(bool value)
{
    if (m_active == value) {
        return;
    }
    m_active = value;
    emit activeChanged(value);
}

void SoundCloudBrowserLogin::start()
{
    if (m_active) {
        return;
    }
    const QString browser = findBrowser();
    if (browser.isEmpty()) {
        emit failed(QStringLiteral("No Chrome-based browser was found. Paste the client id and token instead."));
        return;
    }
    m_port = claimDebugPort();
    if (m_port == 0) {
        emit failed(QStringLiteral("Could not open a local port for the sign-in capture."));
        return;
    }

    m_completed = false;
    m_clientId.clear();
    m_token.clear();
    m_buffer.clear();
    m_message.clear();
    m_wsUp = false;
    setActive(true);
    m_deadline.start(kDeadlineMs);
    startBrowser(browser);
    detach(attach());
}

void SoundCloudBrowserLogin::startBrowser(const QString &program)
{
    // the profile sits with the app's cache, and the debugging port rides the
    // start-up flags (chrome only allows the port for a non-default profile)
    const QString profile = paths::cacheDirectory() + '/' + QLatin1String(kProfileName);
    QDir().mkpath(profile);
    const QStringList arguments = {
        QStringLiteral("--user-data-dir=%1").arg(profile),
        QStringLiteral("--remote-debugging-port=%1").arg(m_port),
        QStringLiteral("--no-first-run"),
        QStringLiteral("--no-default-browser-check"),
        QStringLiteral("--no-default-browser-update"),
        QLatin1String(kLoginUrl),
    };
    m_browser.setProgram(program);
    m_browser.setArguments(arguments);
    m_browser.start();
}

QCoro::Task<> SoundCloudBrowserLogin::attach()
{
    const QUrl endpoint(QStringLiteral("http://127.0.0.1:%1/json/list").arg(m_port));
    for (int attempt = 0; attempt < kPollAttempts; ++attempt) {
        co_await QCoro::sleepFor(kPollInterval);
        if (m_completed) {
            co_return;
        }
        if (m_browser.state() != QProcess::Running) {
            fail(QStringLiteral("The browser window did not open."));
            co_return;
        }
        QNetworkReply *reply = m_network->get(QNetworkRequest(endpoint));
        co_await qCoro(reply).waitForFinished();
        if (m_completed) {
            reply->deleteLater();
            co_return;
        }
        if (reply->error() != QNetworkReply::NoError) {
            reply->deleteLater();
            continue;
        }
        // one target is the soundcloud page the window opened onto
        QString webSocketUrl;
        const QJsonArray targets = QJsonDocument::fromJson(reply->readAll()).array();
        for (const QJsonValue &value : targets) {
            const QJsonObject target = value.toObject();
            if (target.value(QStringLiteral("type")).toString() != QLatin1String("page")) {
                continue;
            }
            if (!QUrl(target.value(QStringLiteral("url")).toString()).host()
                     .endsWith(QLatin1String("soundcloud.com"))) {
                continue;
            }
            webSocketUrl = target.value(QStringLiteral("webSocketDebuggerUrl")).toString();
            break;
        }
        reply->deleteLater();
        if (webSocketUrl.isEmpty()) {
            continue;
        }

        const QUrl websocket(webSocketUrl);
        if (m_socket.state() != QTcpSocket::UnconnectedState) {
            m_socket.abort();
        }
        m_socket.connectToHost(QHostAddress::LocalHost, quint16(websocket.port(int(m_port))));
        const bool connected =
            co_await qCoro(m_socket).waitForConnected(std::chrono::milliseconds(3000));
        if (m_completed) {
            co_return;
        }
        if (!connected) {
            continue;
        }
        sendWebSocketUpgrade(websocket);
        co_return;
    }
    if (!m_completed) {
        fail(QStringLiteral("Could not reach the browser's debugging endpoint."));
    }
}

void SoundCloudBrowserLogin::sendWebSocketUpgrade(const QUrl &webSocketUrl)
{
    // the devtools ws:// url carries the page's own debugger path
    const QByteArray key = maskKey().toBase64();
    QString request;
    request += QStringLiteral("GET %1 HTTP/1.1\r\n").arg(webSocketUrl.path());
    request += QStringLiteral("Host: 127.0.0.1:%1\r\n").arg(m_port);
    request += QStringLiteral("Upgrade: websocket\r\n");
    request += QStringLiteral("Connection: Upgrade\r\n");
    request += QStringLiteral("Sec-WebSocket-Key: %1\r\n").arg(QString::fromLatin1(key));
    request += QStringLiteral("Sec-WebSocket-Version: 13\r\n\r\n");
    m_socket.write(request.toLatin1());
}

void SoundCloudBrowserLogin::sendNetworkEnable()
{
    // the network domain reports every request the page makes; the response
    // ({"id":1}) is ignored, events carry method instead
    const QByteArray message =
        QJsonDocument(QJsonObject { { QStringLiteral("id"), 1 },
                                     { QStringLiteral("method"),
                                       QStringLiteral("Network.enable") } })
            .toJson(QJsonDocument::Compact);
    sendWebSocketFrame(0x1, message);
}

void SoundCloudBrowserLogin::sendWebSocketFrame(quint8 opcode, const QByteArray &payload)
{
    QByteArray frame;
    frame.append(char(0x80 | opcode));
    if (payload.size() < 126) {
        frame.append(char(0x80 | payload.size()));
    } else if (payload.size() <= 0xFFFF) {
        frame.append(char(0x80 | 126));
        frame.append(char(payload.size() >> 8));
        frame.append(char(payload.size() & 0xFF));
    } else {
        frame.append(char(0x80 | 127));
        const quint64 length = quint64(payload.size());
        for (int shift = 56; shift >= 0; shift -= 8) {
            frame.append(char((length >> shift) & 0xFF));
        }
    }
    const QByteArray key = maskKey();
    frame.append(key);
    QByteArray masked = payload;
    for (int i = 0; i < masked.size(); ++i) {
        masked[i] = char(uchar(masked[i]) ^ uchar(key[i % 4]));
    }
    frame.append(masked);
    m_socket.write(frame);
}

void SoundCloudBrowserLogin::onSocketData()
{
    m_buffer.append(m_socket.readAll());

    if (!m_wsUp) {
        const int headEnd = m_buffer.indexOf("\r\n\r\n");
        if (headEnd < 0) {
            return;
        }
        const QByteArray head = m_buffer.left(headEnd);
        m_buffer.remove(0, headEnd + 4);
        const bool upgrade = head.startsWith("HTTP/1.1 101") || head.startsWith("HTTP/1.0 101");
        // chrome answers beyond 101 only when the ws:// url was stale, and the
        // next poll would attach then; staying silent here is the mercy
        if (!upgrade) {
            m_socket.abort();
            return;
        }
        m_wsUp = true;
        sendNetworkEnable();
    }

    while (!m_buffer.isEmpty()) {
        const qint64 length = frameLength(m_buffer);
        if (length < 0 || m_buffer.size() < length) {
            break;
        }
        const QByteArray frame = m_buffer.left(int(length));
        m_buffer.remove(0, int(length));
        consumeFrame(frame);
    }
}

qint64 SoundCloudBrowserLogin::frameLength(const QByteArray &buffer)
{
    if (buffer.size() < 2) {
        return -1;
    }
    const uchar first = uchar(buffer[0]);
    const uchar second = uchar(buffer[1]);
    const bool masked = second & 0x80;
    int header = 2;
    qint64 length = second & 0x7F;
    if (length == 126) {
        if (buffer.size() < 4) {
            return -1;
        }
        length = (qint64(uchar(buffer[2])) << 8) | uchar(buffer[3]);
        header = 4;
    } else if (length == 127) {
        if (buffer.size() < 10) {
            return -1;
        }
        length = 0;
        for (int i = 2; i < 10; ++i) {
            length = (length << 8) | uchar(buffer[i]);
        }
        header = 10;
    }
    return header + (masked ? 4 : 0) + length;
}

void SoundCloudBrowserLogin::consumeFrame(const QByteArray &frame)
{
    const uchar first = uchar(frame[0]);
    const uchar second = uchar(frame[1]);
    const quint8 opcode = quint8(first & 0x0F);

    int header = 2;
    qint64 length = second & 0x7F;
    if (length == 126) {
        length = (qint64(uchar(frame[2])) << 8) | uchar(frame[3]);
        header = 4;
    } else if (length == 127) {
        length = 0;
        for (int i = 2; i < 10; ++i) {
            length = (length << 8) | uchar(frame[i]);
        }
        header = 10;
    }

    QByteArray payload = frame.mid(header, int(length));
    if (second & 0x80) {
        // servers answer unmasked; if somehow not, unmask with the real key
        // (header counted the four key bytes already, so they end in front)
        const QByteArray key = frame.mid(header - 4, 4);
        for (int i = 0; i < payload.size(); ++i) {
            payload[i] = char(uchar(payload[i]) ^ uchar(key[i % 4]));
        }
    }

    if (opcode == 0x9) {
        // ping answers pong, keeps the debugging socket alive
        sendWebSocketFrame(0xA, payload);
        return;
    }
    if (opcode == 0x8) {
        // a close frame: the window (or just the tab) went away. the
        // disconnected handler above spells out what that means
        m_socket.abort();
        return;
    }
    if (opcode != 0x1 && opcode != 0x2 && opcode != 0x0) {
        return;
    }

    m_message.append(payload);
    if (first & 0x80) {
        const QByteArray message = std::exchange(m_message, QByteArray {});
        if (opcode == 0x1) {
            consumeMessage(message);
        }
    }
}

void SoundCloudBrowserLogin::consumeMessage(const QByteArray &message)
{
    const QJsonObject object = QJsonDocument::fromJson(message).object();
    if (!object.contains(QStringLiteral("method"))) {
        return;
    }
    if (object.value(QStringLiteral("method")).toString()
        != QLatin1String("Network.requestWillBeSent")) {
        return;
    }
    const QJsonObject request = object.value(QStringLiteral("params")).toObject()
                                    .value(QStringLiteral("request"))
                                    .toObject();
    const QUrl url(request.value(QStringLiteral("url")).toString());
    if (url.host() != QLatin1String(kApiHost)) {
        return;
    }

    if (m_clientId.isEmpty()) {
        const QString id =
            QUrlQuery(url.query()).queryItemValue(QStringLiteral("client_id"));
        if (!id.isEmpty()) {
            m_clientId = id;
        }
    }
    if (m_token.isEmpty()) {
        const QJsonObject headers = request.value(QStringLiteral("headers")).toObject();
        for (const QString &key : headers.keys()) {
            if (key.compare(QLatin1String("Authorization"), Qt::CaseInsensitive) != 0) {
                continue;
            }
            const QString value = headers.value(key).toString().trimmed();
            // "OAuth eyJ..." — the part behind the scheme is the token
            const QStringList schemes = { QStringLiteral("OAuth "), QStringLiteral("Bearer ") };
            for (const QString &scheme : schemes) {
                if (value.startsWith(scheme, Qt::CaseInsensitive) && value.length() > scheme.length()) {
                    m_token = value.mid(scheme.length()).trimmed();
                    break;
                }
            }
        }
    }

    if (!m_clientId.isEmpty() && !m_token.isEmpty()) {
        finish(m_clientId, m_token);
    }
}

void SoundCloudBrowserLogin::finish(const QString &clientId, const QString &token)
{
    if (m_completed) {
        return;
    }
    m_completed = true;
    teardown();
    setActive(false);
    emit captured(clientId, token);
}

void SoundCloudBrowserLogin::fail(const QString &message)
{
    if (m_completed) {
        return;
    }
    m_completed = true;
    teardown();
    setActive(false);
    emit failed(message);
}

void SoundCloudBrowserLogin::cancel()
{
    if (!m_active) {
        return;
    }
    m_completed = true;
    teardown();
    setActive(false);
}

void SoundCloudBrowserLogin::teardown()
{
    m_deadline.stop();
    if (m_socket.state() != QTcpSocket::UnconnectedState) {
        m_socket.abort();
    }
    closeBrowser();
}

void SoundCloudBrowserLogin::closeBrowser()
{
    if (m_browser.state() == QProcess::NotRunning) {
        return;
    }
    m_browser.terminate();
    QTimer::singleShot(2000, &m_browser, &QProcess::kill);
}

} // namespace resonance
