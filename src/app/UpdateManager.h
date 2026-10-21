#pragma once

#include <QFile>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QObject>
#include <QPointer>
#include <QString>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

#include <memory>

class QQmlEngine;
class QJSEngine;

namespace resonance {

class UpdateManager : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Updater)
    QML_SINGLETON

    Q_PROPERTY(Status status READ status NOTIFY statusChanged FINAL)

    Q_PROPERTY(QString currentVersion READ currentVersion CONSTANT FINAL)
    Q_PROPERTY(QString latestVersion READ latestVersion NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(QString releaseTitle READ releaseTitle NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(QString releaseNotes READ releaseNotes NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(QString releaseUrl READ releaseUrl NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(QString downloadUrl READ downloadUrl NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(QString assetName READ assetName NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(qint64 assetSize READ assetSize NOTIFY releaseInfoChanged FINAL)
    Q_PROPERTY(qreal downloadProgress READ downloadProgress NOTIFY downloadProgressChanged FINAL)
    Q_PROPERTY(qint64 downloadedBytes READ downloadedBytes NOTIFY downloadProgressChanged FINAL)
    Q_PROPERTY(QString statusMessage READ statusMessage NOTIFY statusChanged FINAL)
    Q_PROPERTY(QString errorMessage READ errorMessage NOTIFY errorChanged FINAL)


public:
    enum class Status {
        Idle,
        Checking,
        UpToDate,
        UpdateAvailable,
        Downloading,
        Downloaded,
        Installing,
        Error
    };
    Q_ENUM(Status)

    explicit UpdateManager(QObject *parent = nullptr);
    ~UpdateManager() override;

    static UpdateManager *instance();
    static UpdateManager *create(QQmlEngine *engine, QJSEngine *scriptEngine);

    Status status() const { return m_status; }

    QString currentVersion() const;
    QString latestVersion() const { return m_latestVersion; }
    QString releaseTitle() const { return m_releaseTitle; }
    QString releaseNotes() const { return m_releaseNotes; }
    QString releaseUrl() const { return m_releaseUrl; }
    QString downloadUrl() const { return m_downloadUrl; }
    QString assetName() const { return m_assetName; }
    qint64 assetSize() const { return m_assetSize; }
    qreal downloadProgress() const { return m_downloadProgress; }
    qint64 downloadedBytes() const { return m_downloadedBytes; }
    QString statusMessage() const { return m_statusMessage; }
    QString errorMessage() const { return m_errorMessage; }


    Q_INVOKABLE void checkForUpdates();
    Q_INVOKABLE void startDownload();
    Q_INVOKABLE void openInstaller();
    Q_INVOKABLE void installAndRelaunch();
    Q_INVOKABLE void openReleasePage() const;

signals:
    void statusChanged();

    void releaseInfoChanged();
    void downloadProgressChanged();
    void errorChanged();


private:
    void setStatus(Status s, const QString &message = QString());
    bool isNewerVersion(const QString &remote, const QString &local) const;

    QNetworkAccessManager m_nam;
    QPointer<QNetworkReply> m_checkReply;
    QPointer<QNetworkReply> m_downloadReply;
    std::unique_ptr<QFile> m_downloadFile;

    Status m_status = Status::Idle;

    QString m_latestVersion;
    QString m_releaseTitle;
    QString m_releaseNotes;
    QString m_releaseUrl;
    QString m_downloadUrl;
    QString m_assetName;
    qint64 m_assetSize = 0;
    qreal m_downloadProgress = 0.0;
    qint64 m_downloadedBytes = 0;
    QString m_statusMessage;
    QString m_errorMessage;
    QString m_downloadedFilePath;
};

} // namespace resonance
