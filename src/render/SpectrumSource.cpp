#include "render/SpectrumSource.h"

#include "core/PlaybackCore.h"
#include "playback/PlaybackController.h"

#include <QQmlEngine>

#include <array>
#include <cmath>

namespace resonance {

namespace {
SpectrumSource *s_instance = nullptr;
/// a pass of the loading pulse and the rest after it: 1.25 s of sweep and a
/// short wait for bars, a quicker run down a ring's sides and a longer one
/// (SpectrumItem)
constexpr double kLoadingCycleSeconds = 1.6;
}

SpectrumSource::SpectrumSource(PlaybackCore *core, PlaybackController *player, QObject *parent)
    : QObject(parent)
    , m_core(core)
    , m_player(player)
    , m_levels(kBands, 0.0f)
{
    if (!s_instance) {
        s_instance = this;
    }
    // targets at 60 hz, so none of the analyser's (some 43 a second) waits;
    // the renderer eases between them every display frame.
    m_pollTimer.setInterval(16);
    m_pollTimer.setTimerType(Qt::PreciseTimer);
    connect(&m_pollTimer, &QTimer::timeout, this, &SpectrumSource::poll);
    m_loadingTimer.setInterval(16);
    connect(&m_loadingTimer, &QTimer::timeout, this, &SpectrumSource::tickLoading);

    connect(m_player, &PlaybackController::analysisActiveChanged, this, &SpectrumSource::updateActivity);
    connect(m_player, &PlaybackController::loadingChanged, this, &SpectrumSource::updateActivity);
    updateActivity();
}

SpectrumSource::~SpectrumSource()
{
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

SpectrumSource *SpectrumSource::instance()
{
    return s_instance;
}

SpectrumSource *SpectrumSource::create(QQmlEngine *, QJSEngine *)
{
    QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    return s_instance;
}

void SpectrumSource::updateActivity()
{
    if (m_player->isAnalysisActive()) {
        if (!m_pollTimer.isActive()) {
            m_pollTimer.start();
        }
    } else {
        m_pollTimer.stop();
        clear();
    }

    const bool loading = m_player->isLoading();
    if (loading != m_loading) {
        m_loading = loading;
        m_loadingPhase = 0;
        m_loadingClock.restart();
        emit loadingChanged();
    }
    // the pulse only runs while something on screen would show it
    if (m_loading && m_player->isLoadingPulseVisible()) {
        if (!m_loadingTimer.isActive()) {
            m_loadingClock.restart();
            m_loadingTimer.start();
        }
    } else {
        m_loadingTimer.stop();
    }
}

void SpectrumSource::poll()
{
    float next[kBands];
    publish(next, m_core->spectrumLevels(next, kBands));
}

void SpectrumSource::publish(const float *next, int count)
{
    bool changed = false;
    for (int band = 0; band < kBands; ++band) {
        const float raw = band < count ? next[band] : 0.0f;
        const float level = std::isfinite(raw) ? std::clamp(raw, 0.0f, 1.0f) : 0.0f;
        if (level != m_levels[band]) {
            m_levels[band] = level;
            changed = true;
        }
    }
    if (changed) {
        emit levelsChanged();
    }
}

void SpectrumSource::tickLoading()
{
    m_loadingPhase = float(std::fmod(m_loadingClock.elapsed() / 1000.0, kLoadingCycleSeconds) / kLoadingCycleSeconds);
    emit levelsChanged();
}

void SpectrumSource::clear()
{
    if (std::none_of(m_levels.begin(), m_levels.end(), [](float level) { return level > 0; })) {
        return;
    }
    m_levels.fill(0.0f);
    emit levelsChanged();
}

std::array<float, 5> SpectrumSource::energies() const
{
    const auto mean = [this](int from, int to) {
        float sum = 0;
        for (int band = from; band < to; ++band) {
            sum += m_levels[band];
        }
        return sum / float(to - from);
    };
    return {mean(0, 4), mean(4, 9), mean(9, 15), mean(15, 32), mean(32, 46)};
}

} // namespace resonance
