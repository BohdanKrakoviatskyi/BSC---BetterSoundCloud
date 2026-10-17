#pragma once

#include <QByteArray>
#include <QHash>
#include <QJsonObject>
#include <QJsonValue>
#include <QObject>
#include <QProcess>
#include <QString>
#include <QTimer>

#include <QCoroTask>

#include <coroutine>

namespace swiftify {

/// the soundcloud sidecar: the go local-api that the better soundcloud app
/// also runs, spoken to over one json object per line on its stdin and stdout.
/// stdout carries nothing but responses (its logging goes to stderr), so the
/// two never confuse each other.
class SidecarClient : public QObject {
    Q_OBJECT

public:
    struct Response {
        QJsonValue resultValue;
        QJsonObject result;
        QString error;

        bool ok() const { return error.isEmpty(); }
    };

    /// one call waiting for the line carrying its id. lives in the coroutine's
    /// own frame, so it goes away when the call does.
    struct Call {
        Response response;
        bool done = false;
        std::coroutine_handle<> continuation;
        SidecarClient *client = nullptr;
        qint64 id = 0;
        /// however long the sidecar takes, a call cannot wait forever
        QTimer timeout;

        Call();
        ~Call();

        bool await_ready() const { return done; }
        void await_suspend(std::coroutine_handle<> handle) { continuation = handle; }
        Response await_resume()
        {
            deregister();
            return std::move(response);
        }

        /// stops the timeout and erases the call from the client's table, once
        void deregister();

        /// fills the call in and resumes the coroutine that made it
        void complete(Response value);
    };

    explicit SidecarClient(QObject *parent = nullptr);
    ~SidecarClient() override;

    /// spawns the sidecar, once. false when it is missing or will not start
    bool start();
    bool isRunning() const;
    void stop();
    /// next to the executable in an installed app, or in third_party while
    /// developing; SWIFTIFY_SIDECAR points somewhere else
    QString binaryPath() const;

    /// asks the sidecar one thing. the response carries either a result or the
    /// sidecar's own user-facing message
    QCoro::Task<Response> call(QString method, QJsonObject params = {});

signals:
    /// a line the sidecar wrote to stderr, or why a call never got there
    void diagnostic(const QString &line);
    void runningChanged();

private:
    void onStdout();
    void onStderr();
    void onFinished(int exitCode, QProcess::ExitStatus status);
    /// hands one response line to the call that asked for it
    void deliver(const QByteArray &line);

    QProcess m_process;
    QByteArray m_buffer;
    qint64 m_nextId = 1;
    QHash<qint64, Call *> m_calls;
};

} // namespace swiftify
