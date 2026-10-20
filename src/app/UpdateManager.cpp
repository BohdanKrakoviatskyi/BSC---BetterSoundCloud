#include "app/UpdateManager.h"

#include <QCoreApplication>
#include <QDesktopServices>
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QNetworkRequest>
#include <QProcess>
#include <QQmlEngine>
#include <QStandardPaths>
#include <QUrl>

namespace swiftify {

namespace {

UpdateManager *s_instance = nullptr;
constexpr const char *kReleasesApiUrl = "https://api.github.com/repos/BohdanKrakoviatskyi/BSC---BetterSoundCloud/releases/latest";

QList<int> parseSemver(const QString &versionStr)
{
    QString cleaned = versionStr.trimmed();
    if (cleaned.startsWith(QLatin1Char('v'), Qt::CaseInsensitive)) {
        cleaned.remove(0, 1);
    }
    const int dashIdx = cleaned.indexOf(QLatin1Char('-'));
    if (dashIdx != -1) {
        cleaned = cleaned.left(dashIdx);
    }
    const int plusIdx = cleaned.indexOf(QLatin1Char('+'));
    if (plusIdx != -1) {
        cleaned = cleaned.left(plusIdx);
    }

    const QStringList parts = cleaned.split(QLatin1Char('.'), Qt::SkipEmptyParts);
    QList<int> numbers;
    for (const QString &part : parts) {
        bool ok = false;
        int n = part.toInt(&ok);
        if (ok) {
            numbers.append(n);
        } else {
            numbers.append(0);
        }
    }
    while (numbers.size() < 3) {
        numbers.append(0);
    }
    return numbers;
}

} // namespace

UpdateManager::UpdateManager(QObject *parent)
    : QObject(parent)
{
    if (!s_instance) {
        s_instance = this;
    }
}

UpdateManager::~UpdateManager()
{
    if (m_checkReply) {
        m_checkReply->abort();
    }
    if (m_downloadReply) {
        m_downloadReply->abort();
    }
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

UpdateManager *UpdateManager::instance()
{
    return s_instance;
}

UpdateManager *UpdateManager::create(QQmlEngine *, QJSEngine *)
{
    QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    return s_instance;
}

QString UpdateManager::currentVersion() const
{
    return QStringLiteral(SWIFTIFY_VERSION);
}

void UpdateManager::setStatus(Status s, const QString &message)
{
    if (m_status == s && m_statusMessage == message) {
        return;
    }
    m_status = s;
    m_statusMessage = message;
    if (s == Status::Error) {
        m_errorMessage = message;
        emit errorChanged();
    }
    emit statusChanged();
}

bool UpdateManager::isNewerVersion(const QString &remote, const QString &local) const
{
    const QList<int> rem = parseSemver(remote);
    const QList<int> loc = parseSemver(local);
    const int count = qMin(rem.size(), loc.size());
    for (int i = 0; i < count; ++i) {
        if (rem[i] > loc[i]) {
            return true;
        }
        if (rem[i] < loc[i]) {
            return false;
        }
    }
    return rem.size() > loc.size();
}

void UpdateManager::checkForUpdates()
{
    if (m_status == Status::Checking || m_status == Status::Downloading) {
        return;
    }

    if (m_checkReply) {
        m_checkReply->abort();
        m_checkReply->deleteLater();
    }

    setStatus(Status::Checking, QStringLiteral("Checking for updates..."));
    m_errorMessage.clear();
    emit errorChanged();

    QNetworkRequest request{QUrl(QString::fromLatin1(kReleasesApiUrl))};
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setRawHeader("User-Agent", "Resonance-App");
    request.setRawHeader("Accept", "application/vnd.github.v3+json");

    m_checkReply = m_nam.get(request);

    connect(m_checkReply, &QNetworkReply::finished, this, [this]() {
        if (!m_checkReply) {
            return;
        }
        m_checkReply->deleteLater();

        if (m_checkReply->error() != QNetworkReply::NoError) {
            setStatus(Status::Error, m_checkReply->errorString());
            return;
        }

        const QByteArray responseData = m_checkReply->readAll();
        QJsonParseError parseError{};
        const QJsonDocument doc = QJsonDocument::fromJson(responseData, &parseError);
        if (parseError.error != QJsonParseError::NoError || !doc.isObject()) {
            setStatus(Status::Error, QStringLiteral("Failed to parse release information"));
            return;
        }

        const QJsonObject release = doc.object();
        m_latestVersion = release.value(QStringLiteral("tag_name")).toString();
        m_releaseTitle = release.value(QStringLiteral("name")).toString();
        m_releaseNotes = release.value(QStringLiteral("body")).toString();
        m_releaseUrl = release.value(QStringLiteral("html_url")).toString();

        if (m_latestVersion.isEmpty()) {
            setStatus(Status::Error, QStringLiteral("No version tag found in release"));
            return;
        }

        // Find appropriate download asset for current platform. The asset names
        // carry the platform (Resonance-<version>-macOS.dmg and so on), and more
        // than one platform ships a zip, so matching on the extension alone
        // handed Windows the macOS zip whenever the assets happened to be
        // listed that way. The platform token in the name is what decides.
        const QJsonArray assets = release.value(QStringLiteral("assets")).toArray();
        QJsonObject chosenAsset;

#ifdef Q_OS_MACOS
        const QString platformToken = QStringLiteral("macOS");
        const QStringList extensions { QStringLiteral(".dmg"), QStringLiteral(".zip") };
#elif defined(Q_OS_WIN)
        const QString platformToken = QStringLiteral("Windows");
        const QStringList extensions { QStringLiteral(".zip"), QStringLiteral(".exe") };
#else
        const QString platformToken = QStringLiteral("Linux");
        const QStringList extensions { QStringLiteral(".AppImage"), QStringLiteral(".tar.gz") };
#endif

        for (const QString &extension : extensions) {
            for (const auto &val : assets) {
                const QJsonObject asset = val.toObject();
                const QString name = asset.value(QStringLiteral("name")).toString();
                if (name.contains(platformToken, Qt::CaseInsensitive)
                    && name.endsWith(extension, Qt::CaseInsensitive)) {
                    chosenAsset = asset;
                    break;
                }
            }
            if (!chosenAsset.isEmpty()) {
                break;
            }
        }

        // a release from before the names carried a platform has one unlabelled
        // asset: fall back to the extension alone rather than offer no download
        if (chosenAsset.isEmpty()) {
            for (const QString &extension : extensions) {
                for (const auto &val : assets) {
                    const QJsonObject asset = val.toObject();
                    const QString name = asset.value(QStringLiteral("name")).toString();
                    if (name.endsWith(extension, Qt::CaseInsensitive)) {
                        chosenAsset = asset;
                        break;
                    }
                }
                if (!chosenAsset.isEmpty()) {
                    break;
                }
            }
        }

        if (!chosenAsset.isEmpty()) {
            m_assetName = chosenAsset.value(QStringLiteral("name")).toString();
            m_downloadUrl = chosenAsset.value(QStringLiteral("browser_download_url")).toString();
            m_assetSize = chosenAsset.value(QStringLiteral("size")).toInteger();
        } else {
            m_assetName.clear();
            m_downloadUrl = m_releaseUrl;
            m_assetSize = 0;
        }

        emit releaseInfoChanged();

        if (isNewerVersion(m_latestVersion, currentVersion())) {
            m_updateAvailable = true;
            emit updateAvailableChanged();
            setStatus(Status::UpdateAvailable, QStringLiteral("New update available"));
        } else {
            m_updateAvailable = false;
            emit updateAvailableChanged();
            setStatus(Status::UpToDate, QStringLiteral("You have the latest version"));
        }
    });
}

void UpdateManager::startDownload()
{
    if (m_downloadUrl.isEmpty() || m_status == Status::Downloading) {
        return;
    }

    if (m_downloadReply) {
        m_downloadReply->abort();
        m_downloadReply->deleteLater();
    }

    QString downloadsDir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (downloadsDir.isEmpty() || !QDir(downloadsDir).exists()) {
        downloadsDir = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
    }

    const QString fileName = m_assetName.isEmpty() ? QStringLiteral("Resonance-update") : m_assetName;
    const QString targetPath = downloadsDir + QDir::separator() + fileName;

    m_downloadFile = std::make_unique<QFile>(targetPath);
    if (!m_downloadFile->open(QIODevice::WriteOnly | QIODevice::Truncate)) {
        setStatus(Status::Error, QStringLiteral("Failed to open file for downloading: ") + targetPath);
        return;
    }

    m_downloadProgress = 0.0;
    m_downloadedBytes = 0;
    emit downloadProgressChanged();

    setStatus(Status::Downloading, QStringLiteral("Downloading update..."));

    QNetworkRequest request{QUrl(m_downloadUrl)};
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    request.setRawHeader("User-Agent", "Resonance-Updater");

    m_downloadReply = m_nam.get(request);

    connect(m_downloadReply, &QNetworkReply::readyRead, this, [this]() {
        if (m_downloadFile && m_downloadReply) {
            m_downloadFile->write(m_downloadReply->readAll());
        }
    });

    connect(m_downloadReply, &QNetworkReply::downloadProgress, this, [this](qint64 bytesReceived, qint64 bytesTotal) {
        m_downloadedBytes = bytesReceived;
        if (bytesTotal > 0) {
            m_downloadProgress = static_cast<qreal>(bytesReceived) / static_cast<qreal>(bytesTotal);
        }
        emit downloadProgressChanged();
    });

    connect(m_downloadReply, &QNetworkReply::finished, this, [this, targetPath]() {
        if (!m_downloadReply) {
            return;
        }
        m_downloadReply->deleteLater();

        if (m_downloadFile) {
            m_downloadFile->flush();
            m_downloadFile->close();
        }

        if (m_downloadReply->error() != QNetworkReply::NoError) {
            if (m_downloadFile) {
                m_downloadFile->remove();
            }
            setStatus(Status::Error, m_downloadReply->errorString());
            return;
        }

        m_downloadedFilePath = targetPath;
        emit downloadedFilePathChanged();
        setStatus(Status::Downloaded, QStringLiteral("Update downloaded successfully"));

        // Open installer automatically on macOS
        openInstaller();
    });
}

void UpdateManager::openInstaller()
{
    if (m_downloadedFilePath.isEmpty() || !QFile::exists(m_downloadedFilePath)) {
        return;
    }

#ifdef Q_OS_MACOS
    QProcess::startDetached(QStringLiteral("open"), QStringList() << m_downloadedFilePath);
#else
    QDesktopServices::openUrl(QUrl::fromLocalFile(m_downloadedFilePath));
#endif
}

void UpdateManager::installAndRelaunch()
{
    if (m_downloadedFilePath.isEmpty() || !QFile::exists(m_downloadedFilePath)) {
        return;
    }

#ifdef Q_OS_MACOS
    // If it's a DMG, automate mount, copy to /Applications or current app bundle, and relaunch
    if (m_downloadedFilePath.endsWith(QLatin1String(".dmg"), Qt::CaseInsensitive)) {
        const QString appPath = QFileInfo(QCoreApplication::applicationDirPath() + QStringLiteral("/../../")).canonicalFilePath();
        QString targetApp = appPath;
        if (!targetApp.endsWith(QLatin1String(".app"))) {
            targetApp = QStringLiteral("/Applications/Resonance.app");
        }

        const QString script = QString(
            "sleep 1\n"
            "MNT=$(mktemp -d /tmp/swiftify_mnt.XXXXXX)\n"
            "hdiutil attach -nobrowse -mountpoint \"$MNT\" \"%1\"\n"
            "if [ -d \"$MNT/Resonance.app\" ]; then\n"
            "    rm -rf \"%2\"\n"
            "    cp -R \"$MNT/Resonance.app\" \"%2\"\n"
            "    xattr -cr \"%2\"\n"
            "fi\n"
            "hdiutil detach \"$MNT\" 2>/dev/null || true\n"
            "rm -rf \"$MNT\"\n"
            "open \"%2\"\n"
        ).arg(m_downloadedFilePath, targetApp);

        setStatus(Status::Installing, QStringLiteral("Installing update..."));
        QProcess::startDetached(QStringLiteral("/bin/bash"), QStringList() << QStringLiteral("-c") << script);
        QCoreApplication::quit();
        return;
    }
#endif

    openInstaller();
}

void UpdateManager::openReleasePage() const
{
    if (!m_releaseUrl.isEmpty()) {
        QDesktopServices::openUrl(QUrl(m_releaseUrl));
    } else {
        QDesktopServices::openUrl(QUrl(QStringLiteral("https://github.com/BohdanKrakoviatskyi/BSC---BetterSoundCloud/releases")));
    }
}

} // namespace swiftify
