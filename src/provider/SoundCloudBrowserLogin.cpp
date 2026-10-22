#include "provider/SoundCloudBrowserLogin.h"

#include <QHash>
#include <QMetaObject>
#include <QMutexLocker>
#include <QQuickWebEngineProfile>
#include <QUrlQuery>
#include <QWebEngineUrlRequestInfo>

namespace resonance {

namespace {

constexpr auto kApiHost = "api-v2.soundcloud.com";
constexpr int kDeadlineMs = 5 * 60 * 1000;

QString tokenFromAuthorization(const QByteArray &authorization)
{
    const QString value = QString::fromUtf8(authorization).trimmed();
    for (const QString &scheme : {QStringLiteral("OAuth "), QStringLiteral("Bearer ")}) {
        if (value.startsWith(scheme, Qt::CaseInsensitive) && value.size() > scheme.size()) {
            return value.mid(scheme.size()).trimmed();
        }
    }
    return {};
}

} // namespace

SoundCloudBrowserLogin::SoundCloudBrowserLogin(QObject *parent)
    : QWebEngineUrlRequestInterceptor(parent)
{
    QQuickWebEngineProfile::defaultProfile()->setUrlRequestInterceptor(this);
    connect(&m_deadline, &QTimer::timeout, this, [this] {
        fail(QStringLiteral("The sign-in was not captured within five minutes."));
    });
}

SoundCloudBrowserLogin::~SoundCloudBrowserLogin()
{
    QQuickWebEngineProfile::defaultProfile()->setUrlRequestInterceptor(nullptr);
}

void SoundCloudBrowserLogin::start()
{
    if (m_active) {
        return;
    }
    {
        QMutexLocker lock(&m_credentialsMutex);
        m_clientId.clear();
        m_token.clear();
    }
    m_completed = false;
    setActive(true);
    m_deadline.start(kDeadlineMs);
}

void SoundCloudBrowserLogin::cancel()
{
    if (!m_active) {
        return;
    }
    m_completed = true;
    m_deadline.stop();
    setActive(false);
}

void SoundCloudBrowserLogin::interceptRequest(QWebEngineUrlRequestInfo &info)
{
    const QUrl url = info.requestUrl();
    if (url.host() != QLatin1String(kApiHost)) {
        return;
    }

    QString clientId;
    QString token;
    {
        QMutexLocker lock(&m_credentialsMutex);
        if (m_clientId.isEmpty()) {
            m_clientId = QUrlQuery(url).queryItemValue(QStringLiteral("client_id"));
        }
        if (m_token.isEmpty()) {
            const auto headers = info.httpHeaders();
            for (auto it = headers.cbegin(); it != headers.cend(); ++it) {
                if (it.key().compare("Authorization", Qt::CaseInsensitive) == 0) {
                    m_token = tokenFromAuthorization(it.value());
                    if (!m_token.isEmpty()) {
                        break;
                    }
                }
            }
        }
        if (m_clientId.isEmpty() || m_token.isEmpty()) {
            return;
        }
        clientId = m_clientId;
        token = m_token;
    }

    // WebEngine calls the interceptor on its IO thread. Finish the login on
    // the GUI thread, where the QML window and SoundCloud provider live.
    QMetaObject::invokeMethod(this, [this, clientId, token] {
        if (!m_active || m_completed) {
            return;
        }
        m_completed = true;
        m_deadline.stop();
        setActive(false);
        emit captured(clientId, token);
    }, Qt::QueuedConnection);
}

void SoundCloudBrowserLogin::setActive(bool value)
{
    if (m_active == value) {
        return;
    }
    m_active = value;
    emit activeChanged(value);
}

void SoundCloudBrowserLogin::fail(const QString &message)
{
    if (m_completed) {
        return;
    }
    m_completed = true;
    m_deadline.stop();
    setActive(false);
    emit failed(message);
}

} // namespace resonance
