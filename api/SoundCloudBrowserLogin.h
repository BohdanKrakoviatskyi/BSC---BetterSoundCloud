#pragma once

#include <QMutex>
#include <QObject>
#include <QTimer>
#include <QWebEngineUrlRequestInterceptor>

namespace resonance {

/// Captures SoundCloud's web-session credentials from the private embedded
/// WebEngine profile used by the login window.
class SoundCloudBrowserLogin final : public QWebEngineUrlRequestInterceptor {
    Q_OBJECT

public:
    explicit SoundCloudBrowserLogin(QObject *parent = nullptr);
    ~SoundCloudBrowserLogin() override;

    bool active() const { return m_active; }
    void start();
    void cancel();

signals:
    void activeChanged(bool active);
    void captured(const QString &clientId, const QString &token);
    void failed(const QString &message);

protected:
    void interceptRequest(QWebEngineUrlRequestInfo &info) override;

private:
    void setActive(bool value);
    void fail(const QString &message);

    QTimer m_deadline;
    QMutex m_credentialsMutex;
    QString m_clientId;
    QString m_token;
    bool m_active = false;
    bool m_completed = false;
};

} // namespace resonance
