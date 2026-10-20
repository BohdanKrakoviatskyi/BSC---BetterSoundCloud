pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's elementMoveExit: something leaving.
NumberAnimation {
    duration: Appearance.motion(200)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.emphasizedAccel
}
