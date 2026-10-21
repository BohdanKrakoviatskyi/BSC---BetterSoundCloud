#include "system/MacTitleBar.h"

#ifdef Q_OS_MACOS
#include "system/macos/MacWindow.h"
#endif

namespace resonance {

MacTitleBar::MacTitleBar(QObject *parent)
    : QObject(parent)
{
}

void MacTitleBar::setTarget(QQuickWindow *target)
{
    if (m_target == target) {
        return;
    }
    if (m_target) {
        disconnect(m_target, nullptr, this, nullptr);
    }
    m_target = target;
    emit targetChanged();
#ifdef Q_OS_MACOS
    if (m_target) {
        // applied each time the window shows or changes state, after qt has
        // set the frame up for it
        connect(m_target, &QWindow::visibleChanged, this, &MacTitleBar::apply);
        connect(m_target, &QWindow::windowStateChanged, this, &MacTitleBar::apply);
        apply();
    }
#endif
}

void MacTitleBar::apply()
{
#ifdef Q_OS_MACOS
    if (m_target && m_target->isVisible()) {
        macos::styleTitleBar(m_target);
    }
#endif
}

} // namespace resonance
