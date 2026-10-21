#include "app/Settings.h"
#include "provider/SidecarClient.h"
#include "provider/SoundCloud.h"

#include <QNetworkAccessManager>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QTest>

using namespace resonance;

class SoundCloudTest : public QObject {
    Q_OBJECT

private slots:
    void startupRefreshRestoresSavedAccount()
    {
        QTemporaryDir directory;
        Settings settings(directory.filePath(QStringLiteral("resonance.conf")));
        settings.setSoundcloudClientId(QStringLiteral("client-id"));
        SidecarClient sidecar;
        QNetworkAccessManager network;
        SoundCloud soundcloud(&sidecar, &settings, &network, nullptr);
        QSignalSpy changed(&soundcloud, &SoundCloud::accountChanged);

        soundcloud.refreshStatus();

        QTRY_VERIFY_WITH_TIMEOUT(soundcloud.connected(), 5000);
        QCOMPARE(soundcloud.userId(), QStringLiteral("81234"));
        QCOMPARE(soundcloud.userName(), QStringLiteral("Restored User"));
        QVERIFY(changed.count() > 0);
    }
};

QTEST_GUILESS_MAIN(SoundCloudTest)
#include "tst_soundcloud.moc"
