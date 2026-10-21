pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a group's heading in the drawer: its name, and a squiggle running on to
// whatever sits at the end of the row.
Item {
    id: root

    property string text
    property alias trailing: trailingSlot.data

    implicitHeight: 36
    implicitWidth: label.implicitWidth + 32

    StyledText {
        id: label
        anchors.left: parent.left
        anchors.leftMargin: 16
        anchors.verticalCenter: parent.verticalCenter
        text: root.text
        font.pixelSize: Appearance.fontSize.smaller
        font.weight: Font.DemiBold
        color: Appearance.colors.onSurfaceVariant
    }

    WavyLine {
        anchors.left: label.right
        anchors.leftMargin: 10
        anchors.right: trailingSlot.left
        anchors.rightMargin: trailingSlot.width > 0 ? 6 : 12
        anchors.verticalCenter: parent.verticalCenter
        color: Appearance.colors.outlineVariant
    }

    Row {
        id: trailingSlot
        anchors.right: parent.right
        anchors.rightMargin: 4
        anchors.verticalCenter: parent.verticalCenter
    }
}
