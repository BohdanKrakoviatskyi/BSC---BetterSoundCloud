pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's elementMoveSmall: short moves, a snappier overshoot.
NumberAnimation {
    duration: Appearance.motion(350)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.expressiveFastSpatial
}
