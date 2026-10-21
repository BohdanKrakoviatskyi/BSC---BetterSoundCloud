#include "motion/AmbientClock.h"

#include "motion/FrameTicker.h"

#include <QJSEngine>

#include <algorithm>
#include <cmath>

namespace resonance {

AmbientClock::AmbientClock(QObject *parent)
    : QObject(parent)
{
}

AmbientClock *AmbientClock::spin()
{
    static AmbientClock *clock = [] {
        auto *made = new AmbientClock;
        QJSEngine::setObjectOwnership(made, QJSEngine::CppOwnership);
        return made;
    }();
    return clock;
}

AmbientClock::~AmbientClock()
{
    FrameTicker::instance()->unsubscribe(this);
}

void AmbientClock::setSpeed(qreal speed)
{
    if (!std::isfinite(speed) || qFuzzyCompare(m_speed + 1, speed + 1)) {
        return;
    }
    // the time run at the old speed counts before the new one takes over.
    // nothing is published here: a speed easing in or out changes every
    // frame, and the value still moves only on the ticks
    if (m_ticking) {
        accumulate();
    }
    m_speed = speed;
    emit speedChanged();

    const bool moving = std::abs(m_speed) > 1e-4;
    if (moving && !m_ticking) {
        m_ticking = true;
        m_clock.start();
        connect(FrameTicker::instance(), &FrameTicker::tick, this, &AmbientClock::tick);
        FrameTicker::instance()->subscribe(this);
    } else if (!moving && m_ticking) {
        m_ticking = false;
        disconnect(FrameTicker::instance(), &FrameTicker::tick, this, &AmbientClock::tick);
        FrameTicker::instance()->unsubscribe(this);
        emit valueChanged();
    }
}

void AmbientClock::accumulate()
{
    // a long stall, as after the machine slept, does not throw everything
    // round in one leap
    const qreal elapsed = std::min(m_clock.restart() / 1000.0, 0.25);
    m_value += m_speed * std::max(elapsed, 0.0);
}

void AmbientClock::tick()
{
    accumulate();
    emit valueChanged();
}

} // namespace resonance
