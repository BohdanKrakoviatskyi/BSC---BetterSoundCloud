#pragma once

#include <QByteArray>
#include <QObject>
#include <QProcess>
#include <QTcpSocket>
#include <QTimer>
#include <QUrl>

#include <QCoroTask>

class QNetworkAccessManager;

namespace resonance {

/// a chromium-based browser window, opened just for the soundcloud sign-in,
/// whose network traffic is read through chrome's own debugging socket (the
/// devtools protocol, spoken over a hand-rolled websocket). while the person
/// logs in there, sign-ins show up as requests to api-v2.soundcloud.com: the
/// query string carries the client id, and the Authorization header carries
/// "OAuth <token>". both are lifted straight off the wire, and the window
/// closes itself once the two are in hand. no proxy, no certificate games.
class SoundCloudBrowserLogin : public QObject {
    Q_OBJECT

public:
    explicit SoundCloudBrowserLogin(QObject *parent = nullptr);
    ~SoundCloudBrowserLogin() override;

    bool active() const { return m_active; }

    /// opens the window and starts listening. the capture ends on its own
    /// (then captured fires), on cancel(), on failure (failed fires), or on
    /// a five-minute timeout with nothing captured.
    void start();
    void cancel();

signals:
    void activeChanged(bool active);
    void captured(const QString &clientId, const QString &token);
    void failed(const QString &message);

private:
    void setActive(bool value);
    /// chrome-by-any-other-name, from the well-known installs on each platform
    QString findBrowser() const;
    /// one free loopback port, for the debugging endpoint
    quint16 claimDebugPort() const;
    void startBrowser(const QString &program);
    /// polls the debug endpoint until the soundcloud page reports itself,
    /// then upgrades a plain tcp connection to its websocket
    QCoro::Task<> attach();
    void sendWebSocketUpgrade(const QUrl &webSocketUrl);
    void sendNetworkEnable();
    void sendWebSocketFrame(quint8 opcode, const QByteArray &payload);
    void onSocketData();
    /// the frame's whole size (header and payload), or -1 while the
    /// header itself is still incomplete
    static qint64 frameLength(const QByteArray &buffer);
    void consumeFrame(const QByteArray &frame);
    void consumeMessage(const QByteArray &message);
    void finish(const QString &clientId, const QString &token);
    void fail(const QString &message);
    /// closes the browser window; the profile is kept so a later login is fast
    void closeBrowser();
    void teardown();

    QNetworkAccessManager *m_network = nullptr;
    QProcess m_browser;
    QTimer m_deadline;
    QTcpSocket m_socket;
    QByteArray m_buffer;
    QByteArray m_message;
    bool m_wsUp = false;
    quint16 m_port = 0;
    bool m_active = false;
    bool m_completed = false;
    QString m_clientId;
    QString m_token;
};

} // namespace resonance
