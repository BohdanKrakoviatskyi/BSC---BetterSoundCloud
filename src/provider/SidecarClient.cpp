#include "provider/SidecarClient.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QJsonDocument>
#include <QJsonParseError>
#include <QProcessEnvironment>
#include <QStandardPaths>

#include <chrono>
#include <utility>

namespace swiftify {

namespace {

/// where the sidecar keeps its token files and settings, apart from the other
/// app's copy: two sidecars writing one directory would step on each other
QString dataDirectory()
{
    const QString base = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    const QString swiftifyDir = base + QStringLiteral("/soundcloud");
    if (!QFileInfo::exists(swiftifyDir + QStringLiteral("/auth.json"))) {
        const QString resonanceDir = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + QStringLiteral("/Resonance");
        if (QFileInfo::exists(resonanceDir + QStringLiteral("/auth.json"))) {
            return resonanceDir;
        }
        const QString bscDir = QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + QStringLiteral("/BetterSoundCloud");
        if (QFileInfo::exists(bscDir + QStringLiteral("/auth.json"))) {
            return bscDir;
        }
    }
    return swiftifyDir;
}

constexpr int kStartTimeoutMs = 5000;
/// search and the stream lookup reach out to soundcloud, so a call is given
/// room; anything past this is a service that is not coming back
constexpr auto kCallTimeout = std::chrono::seconds(45);

} // namespace

SidecarClient::Call::Call()
{
    timeout.setSingleShot(true);
}

SidecarClient::Call::~Call()
{
    deregister();
}

void SidecarClient::Call::deregister()
{
    timeout.stop();
    if (client != nullptr) {
        client->m_calls.remove(id);
        client = nullptr;
    }
}

void SidecarClient::Call::complete(Response value)
{
    if (done) {
        return;
    }
    response = std::move(value);
    done = true;
    if (continuation != nullptr) {
        const std::coroutine_handle<> handle = continuation;
        continuation = nullptr;
        handle.resume();
    }
}

SidecarClient::SidecarClient(QObject *parent)
    : QObject(parent)
{
    m_process.setProcessChannelMode(QProcess::SeparateChannels);
    connect(&m_process, &QProcess::readyReadStandardOutput, this, &SidecarClient::onStdout);
    connect(&m_process, &QProcess::readyReadStandardError, this, &SidecarClient::onStderr);
    connect(&m_process, &QProcess::finished, this, &SidecarClient::onFinished);
}

SidecarClient::~SidecarClient()
{
    // the calls are left suspended rather than finished: this object is on its
    // way out, and a resumed coroutine must not touch it. their owners destroy
    // the frames, and every Call unhooks itself on the way.
    const QList<qint64> ids = m_calls.keys();
    for (const qint64 id : ids) {
        Call *call = m_calls.value(id, nullptr);
        if (call != nullptr) {
            call->timeout.stop();
            call->client = nullptr;
        }
    }
    m_calls.clear();

    if (m_process.state() != QProcess::NotRunning) {
        m_process.closeWriteChannel();
        m_process.terminate();
        if (!m_process.waitForFinished(1000)) {
            m_process.kill();
            m_process.waitForFinished(1000);
        }
    }
}

QString SidecarClient::binaryPath() const
{
    const QString override = qEnvironmentVariable("SWIFTIFY_SIDECAR");
    if (!override.isEmpty()) {
        return override;
    }
    const QDir executableDirectory(QCoreApplication::applicationDirPath());
    const QStringList candidates {
#ifdef Q_OS_WIN
        // the go tool writes local-api.exe on windows, and an extensionless name
        // is not executable there as far as QFileInfo is concerned
        executableDirectory.filePath(QStringLiteral("local-api.exe")),
#endif
        executableDirectory.filePath(QStringLiteral("local-api")),
        executableDirectory.filePath(QStringLiteral("../Resources/local-api")),
        executableDirectory.filePath(QStringLiteral("../Frameworks/local-api")),
#ifdef SWIFTIFY_SIDECAR_PATH
        QStringLiteral(SWIFTIFY_SIDECAR_PATH),
#endif
    };
    for (const QString &candidate : candidates) {
        if (QFileInfo(candidate).isExecutable()) {
            return QDir::cleanPath(candidate);
        }
    }
    return {};
}

bool SidecarClient::isRunning() const
{
    return m_process.state() == QProcess::Running;
}

void SidecarClient::stop()
{
    if (m_process.state() != QProcess::NotRunning) {
        m_process.closeWriteChannel();
        m_process.terminate();
    }
}

bool SidecarClient::start()
{
    if (isRunning()) {
        return true;
    }
    const QString binary = binaryPath();
    if (binary.isEmpty()) {
        emit diagnostic(QStringLiteral("the soundcloud service is missing from this build"));
        return false;
    }
    QProcessEnvironment environment = QProcessEnvironment::systemEnvironment();
    environment.insert(QStringLiteral("BSC_DATA_DIR"), dataDirectory());
    m_process.setProcessEnvironment(environment);
    m_process.setProgram(binary);
    m_process.setArguments({});
    m_process.start();
    if (!m_process.waitForStarted(kStartTimeoutMs)) {
        emit diagnostic(QStringLiteral("the soundcloud service would not start: %1").arg(m_process.errorString()));
        return false;
    }
    m_buffer.clear();
    emit runningChanged();
    return true;
}

QCoro::Task<SidecarClient::Response> SidecarClient::call(QString method, QJsonObject params)
{
    if (!isRunning() && !start()) {
        co_return Response { .error = QStringLiteral("the soundcloud service is not running") };
    }

    const qint64 id = m_nextId++;
    Call call;
    call.client = this;
    call.id = id;
    m_calls.insert(id, &call);

    connect(&call.timeout, &QTimer::timeout, this, [&call] {
        call.complete(Response { .error = QStringLiteral("the soundcloud service did not answer") });
    });
    call.timeout.start(std::chrono::milliseconds(kCallTimeout));

    QJsonObject request {
        { QStringLiteral("id"), double(id) },
        { QStringLiteral("method"), method },
    };
    if (!params.isEmpty()) {
        request.insert(QStringLiteral("params"), params);
    }
    const QByteArray line = QJsonDocument(request).toJson(QJsonDocument::Compact) + '\n';
    m_process.write(line);
    m_process.waitForBytesWritten(kStartTimeoutMs);

    Response response = co_await call;
    co_return response;
}

void SidecarClient::onStdout()
{
    m_buffer.append(m_process.readAllStandardOutput());
    // one json object per line; a partial line waits for the rest of itself
    for (;;) {
        const qsizetype newline = m_buffer.indexOf('\n');
        if (newline < 0) {
            break;
        }
        const QByteArray line = m_buffer.left(newline);
        m_buffer.remove(0, newline + 1);
        if (!line.trimmed().isEmpty()) {
            deliver(line);
        }
    }
}

void SidecarClient::onStderr()
{
    const QByteArray data = m_process.readAllStandardError();
    for (const QByteArray &line : data.split('\n')) {
        const QString text = QString::fromUtf8(line).trimmed();
        if (!text.isEmpty()) {
            emit diagnostic(text);
        }
    }
}

void SidecarClient::onFinished(int exitCode, QProcess::ExitStatus status)
{
    Q_UNUSED(status);
    const QString reason = exitCode == 0
        ? QStringLiteral("the soundcloud service stopped")
        : QStringLiteral("the soundcloud service stopped (exit %1)").arg(exitCode);
    // copied first: completing a call resumes a coroutine that may start
    // another one, which would add to the table under us
    QList<Call *> waiting;
    waiting.reserve(m_calls.size());
    for (auto it = m_calls.cbegin(); it != m_calls.cend(); ++it) {
        waiting.append(it.value());
    }
    for (Call *call : waiting) {
        call->complete(Response { .error = reason });
    }
    emit runningChanged();
}

void SidecarClient::deliver(const QByteArray &line)
{
    QJsonParseError parseError;
    const QJsonDocument document = QJsonDocument::fromJson(line, &parseError);
    if (parseError.error != QJsonParseError::NoError || !document.isObject()) {
        emit diagnostic(QStringLiteral("unreadable reply from the soundcloud service: %1")
                            .arg(QString::fromUtf8(line).left(200)));
        return;
    }
    const QJsonObject object = document.object();
    const QJsonValue idValue = object.value(QStringLiteral("id"));
    if (!idValue.isDouble()) {
        // a request the sidecar could not even parse: no id to answer to
        const QString error = object.value(QStringLiteral("error")).toString();
        if (!error.isEmpty()) {
            emit diagnostic(error);
        }
        return;
    }
    Call *call = m_calls.value(qint64(idValue.toDouble()), nullptr);
    if (call == nullptr) {
        return;
    }
    Response response;
    // a reply carries a result or an error, never both
    const QJsonValue error = object.value(QStringLiteral("error"));
    if (!error.isNull() && !error.isUndefined()) {
        response.error = error.toString();
        if (response.error.isEmpty()) {
            response.error = QStringLiteral("the soundcloud request failed");
        }
    } else {
        response.resultValue = object.value(QStringLiteral("result"));
        if (response.resultValue.isObject()) {
            response.result = response.resultValue.toObject();
        }
    }
    call->complete(std::move(response));
}

} // namespace swiftify
