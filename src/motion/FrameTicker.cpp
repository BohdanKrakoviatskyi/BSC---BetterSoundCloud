#include "motion/FrameTicker.h"

namespace resonance {

FrameTicker *FrameTicker::instance()
{
    // never freed: items unsubscribe as they are destroyed, which can be
    // after the application object has gone
    static FrameTicker *ticker = new FrameTicker;
    return ticker;
}

FrameTicker::FrameTicker(QObject *parent)
    : QObject(parent)
{
    m_timer.setInterval(kIntervalMs);
    m_timer.setTimerType(Qt::PreciseTimer);
    connect(&m_timer, &QTimer::timeout, this, &FrameTicker::tick);
}

void FrameTicker::subscribe(QObject *subscriber)
{
    if (!subscriber || m_subscribers.contains(subscriber)) {
        return;
    }
    m_subscribers.insert(subscriber);
    connect(subscriber, &QObject::destroyed, this, [this, subscriber] {
        m_subscribers.remove(subscriber);
        update();
    });
    update();
}

void FrameTicker::unsubscribe(QObject *subscriber)
{
    if (m_subscribers.remove(subscriber)) {
        disconnect(subscriber, &QObject::destroyed, this, nullptr);
        update();
    }
}

void FrameTicker::update()
{
    if (m_subscribers.isEmpty()) {
        m_timer.stop();
    } else if (!m_timer.isActive()) {
        m_timer.start();
    }
}

} // namespace resonance
