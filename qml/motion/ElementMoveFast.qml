pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// end4's elementMoveFast: small state changes such as radii and widths.
NumberAnimation {
    duration: Appearance.motion(200)
    easing.type: Easing.BezierSpline
    easing.bezierCurve: Appearance.curves.expressiveEffects
}
