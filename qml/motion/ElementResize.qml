pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's elementResize.
NumberAnimation {
    duration: Appearance.motion(300)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.emphasized
}
