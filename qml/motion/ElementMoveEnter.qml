pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's elementMoveEnter: something arriving.
NumberAnimation {
    duration: Appearance.motion(400)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.emphasizedDecel
}
