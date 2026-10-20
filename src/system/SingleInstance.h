#pragma once

#include <QLocalServer>
#include <QObject>
#include <QStringList>

namespace swiftify {

/// one resonance per user. a second launch hands its command to the first and
/// exits: no command raises the window, and the others are for compositor
/// key binds (`resonance --immersive`, `resonance --play-pause`).
class SingleInstance : public QObject {
    Q_OBJECT

public:
    explicit SingleInstance(QObject *parent = nullptr);

    /// true when another copy took the command, and this one should exit
    bool forwardToRunningInstance(const QStringList &arguments);
    /// the command a launch's arguments ask for; "raise" without one
    static QString commandFrom(const QStringList &arguments);
    /// starts answering later launches
    void listen();

signals:
    void commandReceived(const QString &command);

private:
    static QString serverName();
    QLocalServer m_server;
};

} // namespace swiftify
