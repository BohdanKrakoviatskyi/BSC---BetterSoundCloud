pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's sidebarSlideExit: side sheets and drawers closing.
NumberAnimation {
    duration: Appearance.motion(250)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.standardAccel
}
