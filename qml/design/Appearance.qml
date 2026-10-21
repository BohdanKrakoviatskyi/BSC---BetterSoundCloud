pragma Singleton
pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// design tokens, after end4's Appearance.qml: rounding, type, motion curves and
// sizes. colours live in Theme (C++), which follows the system scheme.
QtObject {
    id: root

    readonly property MaterialScheme colors: Theme.colors
    /// nothing moves of its own accord, over and over: the shapes that turn
    /// with the music, the edges that run while hovered, the seek line's wave
    /// and the backdrop's flow hold still (Settings.reduceMotion). what
    /// answers a click, a hover or a change still moves. performance mode
    /// includes it
    readonly property bool reduceMotion: Settings.reduceMotion || Settings.performanceMode
    /// as little drawn as can be: nothing animates, not even fades
    /// (Settings.performanceMode)
    readonly property bool performanceMode: Settings.performanceMode

    component Rounding: QtObject {
        readonly property int unsharpen: 2
        readonly property int unsharpenMore: 6
        readonly property int verySmall: 8
        readonly property int small: 12
        readonly property int normal: 17
        readonly property int large: 23
        readonly property int veryLarge: 30
        readonly property int full: 9999
        readonly property int window: 18
    }
    readonly property Rounding rounding: Rounding {}

    component FontSizes: QtObject {
        readonly property int smallest: 10
        readonly property int smaller: 12
        readonly property int smallie: 13
        readonly property int small: 15
        readonly property int normal: 16
        readonly property int large: 17
        readonly property int larger: 19
        readonly property int huge: 22
        readonly property int hugeAss: 23
        readonly property int title: 22
        readonly property int headline: 30
        readonly property int display: 36
    }
    readonly property FontSizes fontSize: FontSizes {}

    // end4's google sans flex when installed (see Fonts.cpp for the fallbacks).
    readonly property string fontFamily: Theme.fontFamily
    readonly property string monoFontFamily: Theme.monoFontFamily
    readonly property string iconFontFamily: "Material Symbols Rounded"

    // end4's animationCurves. bezier control points for Easing.BezierSpline.
    component Curves: QtObject {
        readonly property list<real> expressiveFastSpatial: [0.42, 1.67, 0.21, 0.90, 1, 1]
        readonly property list<real> expressiveDefaultSpatial: [0.38, 1.21, 0.22, 1.00, 1, 1]
        readonly property list<real> expressiveSlowSpatial: [0.39, 1.29, 0.35, 0.98, 1, 1]
        readonly property list<real> expressiveEffects: [0.34, 0.80, 0.34, 1.00, 1, 1]
        readonly property list<real> emphasized: [0.05, 0, 2 / 15, 0.06, 1 / 6, 0.4, 5 / 24, 0.82, 0.25, 1, 1, 1]
        readonly property list<real> emphasizedAccel: [0.3, 0, 0.8, 0.15, 1, 1]
        readonly property list<real> emphasizedDecel: [0.05, 0.7, 0.1, 1, 1, 1]
        readonly property list<real> standard: [0.2, 0, 0, 1, 1, 1]
        readonly property list<real> standardAccel: [0.3, 0, 1, 1, 1, 1]
        readonly property list<real> standardDecel: [0, 0, 0, 1, 1, 1]
    }
    readonly property Curves curves: Curves {}

    /// a fade's or a colour's duration in ms; performance mode collapses it
    function duration(milliseconds: int): int {
        return performanceMode ? 0 : milliseconds
    }

    /// a move's, a growth's or a turn's duration in ms; performance mode
    /// collapses it. reduced motion keeps it: it stills only what loops
    function motion(milliseconds: int): int {
        return performanceMode ? 0 : milliseconds
    }

    /// a state colour to ease to or from. "transparent" is black with no
    /// alpha, and a colour animation from it to a light colour runs through
    /// grey, a flash of dark on the way in; clear, it takes `other`'s colour
    /// at no alpha instead, so the ease only fades
    function fadeable(color: color, other: color): color {
        return color.a > 0 ? color : Qt.alpha(other, 0)
    }

    component Sizes: QtObject {
        readonly property real elevationMargin: 10
        readonly property real pageMargin: 32
        readonly property real sectionGap: 32
        readonly property real shelfGap: 16
        readonly property real cardSize: 176
        readonly property real headerArtwork: 232
        readonly property real artworkRadius: 12
        readonly property real smallArtworkRadius: 7
        readonly property real sideSheetWidth: 320
        readonly property real topBarHeight: 64
        readonly property real playerBarClearance: 120
    }
    readonly property Sizes sizes: Sizes {}
}
