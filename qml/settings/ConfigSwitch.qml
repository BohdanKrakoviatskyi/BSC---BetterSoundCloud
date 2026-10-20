pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a setting that is on or off: the whole row toggles it (end4's ConfigSwitch).
RippleButton {
    id: root

    // text and checked are the button's own; checked follows its binding,
    // since the button is not checkable and never flips it itself
    signal toggledTo(bool checked)

    width: parent ? parent.width : 0
    implicitHeight: 52
    leftPadding: 12
    rightPadding: 12
    buttonRadius: Appearance.rounding.small
    onClicked: toggledTo(!checked)

    contentItem: Item {
        StyledText {
            anchors.left: parent.left
            anchors.right: toggle.left
            anchors.rightMargin: 12
            anchors.verticalCenter: parent.verticalCenter
            text: root.text
            elide: Text.ElideRight
        }
        StyledSwitch {
            id: toggle
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            checked: root.checked
            enabled: root.enabled
            onToggled: root.toggledTo(checked)
        }
    }
}
