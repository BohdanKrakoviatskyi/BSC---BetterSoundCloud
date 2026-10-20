pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Templates as T
import Resonance

// a material menu, as end4 draws its popup menus: a surface-container card
// with rounded items.
T.Menu {
    id: root

    /// the immersive player's menus are dark and follow the cover
    property MaterialScheme scheme: UiState.immersiveOpen ? PlayerStyle.darkScheme : Appearance.colors

    // drawn in the window it opens over. a menu in a window of its own got a
    // render thread and a set of window-sized buffers on its first opening,
    // and kept them for the rest of the session
    popupType: T.Popup.Item
    implicitWidth: Math.max(implicitBackgroundWidth + leftInset + rightInset,
                            contentWidth + leftPadding + rightPadding)
    implicitHeight: Math.max(implicitBackgroundHeight + topInset + bottomInset,
                             contentHeight + topPadding + bottomPadding)
    padding: 8
    margins: 8
    overlap: 4

    delegate: StyledMenuItem {}

    enter: Transition {
        NumberAnimation { property: "opacity"; from: 0; to: 1; duration: Appearance.duration(150); easing.type: Easing.OutCubic }
        NumberAnimation { property: "scale"; from: 0.6; to: 1; duration: Appearance.motion(420); easing.type: Easing.BezierSpline; easing.bezierCurve: Appearance.curves.expressiveFastSpatial }
    }
    exit: Transition {
        NumberAnimation { property: "opacity"; to: 0; duration: Appearance.duration(100) }
    }

    contentItem: ListView {
        // as wide as its widest entry, so none is cut short, up to a width
        // past which a name is better ellipsized than the menu spread
        implicitWidth: {
            let widest = 0
            for (let index = 0; index < root.count; ++index) {
                const entry = root.itemAt(index)
                if (entry && entry.visible) {
                    widest = Math.max(widest, entry.implicitWidth)
                }
            }
            return Math.min(widest, 440)
        }
        implicitHeight: contentHeight
        model: root.contentModel
        interactive: Window.window ? contentHeight + root.topPadding + root.bottomPadding > Window.window.height : false
        clip: true
        currentIndex: root.currentIndex
        spacing: 2
    }

    background: Rectangle {
        implicitWidth: 220
        radius: Appearance.rounding.normal
        color: root.scheme.surfaceContainer
        border.width: 1
        border.color: root.scheme.layer0Border
    }
}
