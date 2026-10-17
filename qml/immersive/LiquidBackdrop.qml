pragma ComponentBehavior: Bound
import QtQuick
import Swiftify

// the immersive player's backdrop (ArtworkBackdrop): the cover's palette
// poured into a slow fluid that swells with the bass. the field is drawn
// small, blurred there, and stretched over the window, so the blur costs next
// to nothing and the window-sized pass is one texture read. it redraws at
// 30 hz only while music plays; with the living backdrop off, or reduced
// motion, it is one still frame that changes only with the cover.
Item {
    id: root

    /// the backdrop is on screen, so it may move
    property bool shown: true
    /// the bass as the field swells with it, 0 to about 1; 0 while it holds
    readonly property real bass: flows ? clock.energy.y : 0

    readonly property bool flows: Settings.livingBackdrop && !Appearance.reduceMotion
    // the blur radius is the standard deviation, in points; the field is drawn
    // at the scale that makes it about two texels, where a 13-tap blur covers it
    readonly property real sigma: Settings.backdropBlur
    readonly property real renderScale: sigma > 2 ? Math.max(1 / 8, 2 / sigma) : 1
    readonly property size textureSize: Qt.size(Math.max(1, Math.ceil(width * renderScale)),
                                                Math.max(1, Math.ceil(height * renderScale)))

    function shade(index: int): color {
        const palette = PlayerStyle.palette
        return palette.length > 0 ? palette[index % palette.length] : Appearance.colors.primary
    }

    BackdropClock {
        id: clock
        running: root.flows && root.shown && root.visible
        playing: Player.playing
        reactivity: Settings.backdropReactivity
    }

    Rectangle {
        anchors.fill: parent
        color: "#020203"
    }

    ShaderEffect {
        id: field
        anchors.fill: parent

        property size itemSize: Qt.size(width, height)
        // the still field is the moment the mac app picked for it
        property real time: root.flows ? clock.time : 37
        property vector4d energy: root.flows ? clock.energy : Qt.vector4d(0, 0, 0, 0)
        property real lead: root.flows ? clock.lead : 0
        property color c0: root.shade(0)
        property color c1: root.shade(1)
        property color c2: root.shade(2)
        property color c3: root.shade(3)
        property color c4: root.shade(4)

        fragmentShader: "qrc:/shaders/liquid_backdrop.frag.qsb"
    }

    ShaderEffectSource {
        id: fieldTexture
        anchors.fill: parent
        sourceItem: field
        hideSource: true
        visible: false
        smooth: true
        textureSize: root.textureSize
    }

    ShaderEffect {
        id: across
        anchors.fill: parent

        property variant source: fieldTexture
        property vector2d texelStep: Qt.vector2d(1 / root.textureSize.width, 0)
        property real sigma: root.sigma * root.renderScale

        fragmentShader: "qrc:/shaders/backdrop_blur.frag.qsb"
    }

    ShaderEffectSource {
        id: acrossTexture
        anchors.fill: parent
        sourceItem: across
        hideSource: true
        visible: false
        smooth: true
        textureSize: root.textureSize
    }

    ShaderEffect {
        id: down
        anchors.fill: parent

        property variant source: acrossTexture
        property vector2d texelStep: Qt.vector2d(0, 1 / root.textureSize.height)
        property real sigma: root.sigma * root.renderScale

        fragmentShader: "qrc:/shaders/backdrop_blur.frag.qsb"
    }

    ShaderEffectSource {
        id: blurred
        anchors.fill: parent
        sourceItem: down
        hideSource: true
        visible: false
        smooth: true
        textureSize: root.textureSize
    }

    ShaderEffect {
        anchors.fill: parent

        property variant source: blurred

        fragmentShader: "qrc:/shaders/backdrop_composite.frag.qsb"
    }

    // ambient adaptive lighting layer driven by cover's primary & secondary palette
    Item {
        anchors.fill: parent

        // left ambient bloom (behind artwork area)
        SoftShadow {
            x: -parent.width * 0.05
            y: parent.height * 0.08
            width: Math.max(380, parent.width * 0.55)
            height: Math.max(380, parent.height * 0.84)
            radius: Math.min(width, height) / 2
            blur: Math.min(width, height) * 0.48
            color: Qt.rgba(PlayerStyle.primary.r, PlayerStyle.primary.g, PlayerStyle.primary.b, 0.45)

            Behavior on color {
                ColorAnimation { duration: 600; easing.type: Easing.InOutQuad }
            }
        }

        // right ambient bloom (behind lyrics area)
        SoftShadow {
            x: parent.width * 0.42
            y: parent.height * 0.12
            width: Math.max(380, parent.width * 0.60)
            height: Math.max(380, parent.height * 0.80)
            radius: Math.min(width, height) / 2
            blur: Math.min(width, height) * 0.48
            color: Qt.rgba(PlayerStyle.secondary.r, PlayerStyle.secondary.g, PlayerStyle.secondary.b, 0.32)

            Behavior on color {
                ColorAnimation { duration: 600; easing.type: Easing.InOutQuad }
            }
        }

        // top/bottom subtle dark gradient vignette to keep text & controls crisp
        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0.0; color: Qt.rgba(0.01, 0.01, 0.02, 0.55) }
                GradientStop { position: 0.22; color: "transparent" }
                GradientStop { position: 0.78; color: "transparent" }
                GradientStop { position: 1.0; color: Qt.rgba(0.01, 0.01, 0.02, 0.7) }
            }
        }
    }
}
