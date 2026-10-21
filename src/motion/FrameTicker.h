#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QSet>
#include <QTimer>

namespace resonance {

/// one 30 hz tick shared by everything that moves slowly and for as long as
/// music plays: the shapes that turn (AmbientClock). it runs while anything
/// is subscribed. sharing it puts all their changes in the same frame: two
/// 30 hz timers out of step have the window drawn 60 times a second.
class FrameTicker : public QObject {
    Q_OBJECT

public:
    static constexpr int kIntervalMs = 33;

    static FrameTicker *instance();

    /// ticks reach `subscriber` through tick() until it unsubscribes or is
    /// destroyed; subscribing twice is the same as once
    void subscribe(QObject *subscriber);
    void unsubscribe(QObject *subscriber);
    bool isRunning() const { return m_timer.isActive(); }

signals:
    void tick();

private:
    explicit FrameTicker(QObject *parent = nullptr);
    void update();

    QTimer m_timer;
    QSet<QObject *> m_subscribers;
};

} // namespace resonance
