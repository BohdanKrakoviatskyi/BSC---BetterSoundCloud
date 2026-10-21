#pragma once

#include <QDBusUnixFileDescriptor>
#include <QObject>

namespace resonance {

class PlaybackController;

/// systemd-logind's sleep notice. while something plays, a delay inhibitor
/// gives the player time to pause before the machine suspends, so it wakes up
/// paused rather than playing wherever it is by then.
class SleepMonitor : public QObject {
    Q_OBJECT

public:
    explicit SleepMonitor(PlaybackController *player, QObject *parent = nullptr);

private slots:
    void prepareForSleep(bool sleeping);

private:
    void updateInhibitor();

    PlaybackController *m_player;
    bool m_available = false;
    QDBusUnixFileDescriptor m_inhibitor;
};

} // namespace resonance
