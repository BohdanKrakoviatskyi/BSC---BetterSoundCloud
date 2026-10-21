#include "render/BackdropClock.h"

#include "render/SpectrumSource.h"

namespace resonance {

BackdropClock::BackdropClock(QObject *parent)
    : QObject(parent)
{
    m_timer.setInterval(kIntervalMs);
    m_timer.setTimerType(Qt::PreciseTimer);
    connect(&m_timer, &QTimer::timeout, this, &BackdropClock::tick);
}

void BackdropClock::setRunning(bool running)
{
    if (m_running == running) {
        return;
    }
    m_running = running;
    emit runningChanged();
    update();
}

void BackdropClock::setPlaying(bool playing)
{
    if (m_playing == playing) {
        return;
    }
    m_playing = playing;
    emit playingChanged();
    update();
}

void BackdropClock::setReactivity(qreal reactivity)
{
    if (qFuzzyCompare(m_reactivity, reactivity)) {
        return;
    }
    m_reactivity = reactivity;
    emit reactivityChanged();
}

void BackdropClock::update()
{
    const bool flows = m_running && m_playing;
    if (flows == m_timer.isActive()) {
        return;
    }
    if (flows) {
        // resume from where the field was held, not from where the clock is
        m_clock.start();
        m_timer.start();
        tick();
        return;
    }
    m_timer.stop();
    m_held = m_time;
    m_energy = {};
    m_lead = 0;
    emit frame();
}

void BackdropClock::tick()
{
    m_time = m_held + m_clock.nsecsElapsed() / 1e9;
    if (const SpectrumSource *spectrum = SpectrumSource::instance()) {
        const auto bands = spectrum->energies();
        const float scale = float(m_reactivity);
        m_energy = QVector4D(bands[0], bands[1], bands[2], bands[3]) * scale;
        m_lead = bands[4] * scale;
    }
    emit frame();
}

} // namespace resonance
