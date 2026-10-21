#include "motion/Reveal.h"

#include "app/Settings.h"

#include <QEasingCurve>
#include <QPropertyAnimation>

#include <algorithm>

namespace resonance {

namespace {
constexpr qreal kScaleFrom = 0.85;
}

RevealAttached::RevealAttached(QObject *parent)
    : QObject(parent)
    , m_item(qobject_cast<QQuickItem *>(parent))
{
    connect(&m_animation, &QAbstractAnimation::finished, this, [this] {
        if (m_item && !m_shown) {
            m_item->setVisible(false);
        }
    });
}


void RevealAttached::setDuration(int duration)
{
    if (m_duration == duration) {
        return;
    }
    m_duration = duration;
    emit timingChanged();
}

void RevealAttached::setOvershoot(qreal overshoot)
{
    if (qFuzzyCompare(m_overshoot, overshoot)) {
        return;
    }
    m_overshoot = overshoot;
    emit timingChanged();
}

void RevealAttached::setShown(bool shown)
{
    if (m_settled && shown == m_shown) {
        return;
    }
    const bool first = !m_settled;
    m_settled = true;
    m_shown = shown;
    emit shownChanged();
    if (!m_item) {
        return;
    }
    const Settings *settings = Settings::instance();
    if (first || (settings && settings->performanceMode())) {
        m_animation.stop();
        m_item->setOpacity(shown ? 1 : 0);
        m_item->setScale(1);
        m_item->setVisible(shown);
        return;
    }
    animate(shown);
}

void RevealAttached::animate(bool shown)
{
    m_animation.stop();
    m_animation.clear();

    if (shown && !m_item->isVisible()) {
        m_item->setOpacity(0);
        m_item->setScale(kScaleFrom);
    }
    m_item->setVisible(true);

    auto *fade = new QPropertyAnimation(m_item, "opacity");
    fade->setEndValue(shown ? 1.0 : 0.0);
    fade->setDuration(shown ? std::min(200, m_duration) : std::min(150, m_duration));
    fade->setEasingCurve(shown ? QEasingCurve::OutCubic : QEasingCurve::InCubic);
    m_animation.addAnimation(fade);

    auto *grow = new QPropertyAnimation(m_item, "scale");
    grow->setEndValue(shown ? 1.0 : kScaleFrom);
    grow->setDuration(shown ? m_duration : std::min(170, m_duration));
    QEasingCurve spring(shown ? (m_overshoot > 0 ? QEasingCurve::OutBack : QEasingCurve::OutCubic) : QEasingCurve::InCubic);
    if (shown && m_overshoot > 0) {
        spring.setOvershoot(m_overshoot);
    }
    grow->setEasingCurve(spring);

    m_animation.addAnimation(grow);
    m_animation.start();
}

} // namespace resonance
