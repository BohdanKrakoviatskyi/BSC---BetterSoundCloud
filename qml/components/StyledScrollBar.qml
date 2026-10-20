pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Templates as T
import Resonance

// a slim pill that shows while scrolling or hovered, then fades away.
T.ScrollBar {
    id: root

    implicitWidth: horizontal ? 100 : (hovered || pressed ? 10 : 6) + leftPadding + rightPadding
    implicitHeight: horizontal ? (hovered || pressed ? 10 : 6) + topPadding + bottomPadding : 100
    padding: 3
    minimumSize: 0.06
    visible: policy !== T.ScrollBar.AlwaysOff && size < 1
    hoverEnabled: true

    contentItem: Rectangle {
        radius: Appearance.rounding.full
        color: root.pressed ? Appearance.colors.onSurface : Appearance.colors.onSurfaceVariant
        opacity: root.policy === T.ScrollBar.AlwaysOn || root.active || root.hovered ? 0.45 : 0

        Behavior on opacity {
            NumberAnimation { duration: Appearance.duration(root.active ? 100 : 600) }
        }
    }

    Behavior on implicitWidth {
        ElementMoveFast {}
    }
}
