#pragma once

#include <QObject>
#include <QPointer>
#include <QQuickWindow>
#include <QtQml/qqmlregistration.h>

namespace resonance {

/// the top of a window on macos: the content runs up under a transparent
/// title bar, and of the system's bar only the traffic lights stay: no
/// title, no bar, no line beneath it. the window asks for the content under
/// the bar with Qt::ExpandedClientAreaHint and Qt::NoTitleBarBackgroundHint,
/// and this hides the rest. it does nothing elsewhere, where the app draws
/// its own top.
class MacTitleBar : public QObject {
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QQuickWindow *target READ target WRITE setTarget NOTIFY targetChanged FINAL)

public:
    explicit MacTitleBar(QObject *parent = nullptr);

    QQuickWindow *target() const { return m_target; }
    void setTarget(QQuickWindow *target);

signals:
    void targetChanged();

private:
    void apply();

    QPointer<QQuickWindow> m_target;
};

} // namespace resonance
