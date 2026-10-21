pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a setting that is one of a few choices: its name, then the choices as
// segmented buttons (end4's ConfigSelectionArray).
Item {
    id: root

    property string text
    property alias segments: choices.segments
    property alias currentIndex: choices.currentIndex
    signal activated(int index)

    width: parent ? parent.width : 0
    implicitHeight: Math.max(52, choices.implicitHeight + 12)
    opacity: enabled ? 1 : 0.38

    StyledText {
        x: 12
        anchors.right: choices.left
        anchors.rightMargin: 12
        anchors.verticalCenter: parent.verticalCenter
        text: root.text
        elide: Text.ElideRight
    }

    SegmentedControl {
        id: choices
        anchors.right: parent.right
        anchors.rightMargin: 6
        anchors.verticalCenter: parent.verticalCenter
        segmentHeight: 32
        enabled: root.enabled
        onActivated: (index) => root.activated(index)
    }
}
