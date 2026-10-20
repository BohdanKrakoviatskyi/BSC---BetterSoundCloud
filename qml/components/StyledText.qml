pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// text in the app's face and colours. with `animateChange`, a new string slides
// out and the next one in, like end4's StyledText.
Text {
    id: root

    property bool animateChange: false
    property real changeDistanceX: 0
    property real changeDistanceY: 6
    property bool tabularNumbers: false

    font.family: Appearance.fontFamily
    font.pixelSize: Appearance.fontSize.small
    font.features: tabularNumbers ? ({ "tnum": 1 }) : ({})
    color: Appearance.colors.onSurface
    linkColor: Appearance.colors.primary
    textFormat: Text.PlainText
    verticalAlignment: Text.AlignVCenter

    transform: Translate {
        id: shift
    }

    // the old text slides out and the new one in
    Behavior on text {
        enabled: root.animateChange && !Appearance.performanceMode

        SequentialAnimation {
            alwaysRunToEnd: true

            ParallelAnimation {
                NumberAnimation { target: shift; property: "x"; to: -root.changeDistanceX; duration: 150; easing.type: Easing.InSine }
                NumberAnimation { target: shift; property: "y"; to: -root.changeDistanceY; duration: 150; easing.type: Easing.InSine }
                NumberAnimation { target: root; property: "opacity"; to: 0; duration: 150; easing.type: Easing.InSine }
            }
            PropertyAction {}
            PropertyAction { target: shift; property: "x"; value: root.changeDistanceX }
            PropertyAction { target: shift; property: "y"; value: root.changeDistanceY }
            ParallelAnimation {
                NumberAnimation { target: shift; property: "x"; to: 0; duration: 150; easing.type: Easing.OutSine }
                NumberAnimation { target: shift; property: "y"; to: 0; duration: 150; easing.type: Easing.OutSine }
                NumberAnimation { target: root; property: "opacity"; to: 1; duration: 150; easing.type: Easing.OutSine }
            }
        }
    }
}
