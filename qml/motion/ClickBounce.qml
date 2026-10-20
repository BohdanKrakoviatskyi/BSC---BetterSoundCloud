pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's clickBounce: a pressed button stretching into its neighbours.
NumberAnimation {
    duration: Appearance.motion(400)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.expressiveDefaultSpatial
}
