pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's elementMove: things moving to a new place, with a little overshoot.
NumberAnimation {
    duration: Appearance.motion(500)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.expressiveDefaultSpatial
}
