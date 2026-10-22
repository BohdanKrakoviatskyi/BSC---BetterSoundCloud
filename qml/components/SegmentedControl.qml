pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// material 3 segmented buttons, drawn the way end4 draws its tab groups: a
// pill track, and the choice as a filled pill that slides to the chosen
// segment with a little overshoot. a segment's hover and press tint lies
// under that pill, so the pill slides over it, not beneath.
Item {
    id: root

    property list<Segment> segments
    property int currentIndex: -1
    property MaterialScheme scheme: Appearance.colors
    property color trackColor: scheme.surfaceContainerHigh
    property color indicatorColor: scheme.secondaryContainer
    property color contentColor: scheme.onSurfaceVariant
    property color selectedContentColor: scheme.onSecondaryContainer
    property real segmentHeight: 36
    property real horizontalPadding: 14
    property real iconSize: 20
    /// 0 sizes each segment to its content
    property real segmentWidth: 0
    readonly property real inset: 4

    /// a segment was chosen; the owner decides whether currentIndex follows
    signal activated(int index)

    implicitWidth: row.implicitWidth + 2 * inset
    implicitHeight: segmentHeight + 2 * inset

    // the pill slides from one segment to another. its first placement jumps
    // straight there, and so does a choice its owner settles as it is built
    // (the immersive player picks its panel in its own onCompleted): until
    // everything built with it has completed, nothing has been seen to move
    property bool built: false
    property bool sliding: false
    property int placedIndex: -1
    Component.onCompleted: {
        placedIndex = currentIndex
        Qt.callLater(() => root.built = true)
    }
    onCurrentIndexChanged: {
        sliding = built && placedIndex >= 0 && currentIndex >= 0
        placedIndex = currentIndex
    }

    Rectangle {
        anchors.fill: parent
        radius: height / 2
        color: root.trackColor
    }

    // each segment's hover and press tint, under the pill
    Repeater {
        id: tints
        model: repeater.count

        delegate: Rectangle {
            id: tint

            required property int index
            readonly property RippleButton segment: repeater.count > index ? repeater.itemAt(index) as RippleButton : null

            x: segment ? row.x + segment.x : 0
            y: root.inset
            width: segment ? segment.width : 0
            height: root.segmentHeight
            radius: height / 2
            color: segment && segment.hovered ? Appearance.fadeable(root.scheme.layer1Hover, "transparent")
                                              : Appearance.fadeable("transparent", root.scheme.layer1Hover)

            Behavior on color {
                ElementMoveFastColor {}
            }

            Ripple {
                id: ripple
                anchors.fill: parent
                cornerRadius: tint.radius
                color: root.scheme.layer1Active
            }

            Connections {
                target: tint.segment
                function onPressed() {
                    ripple.start(tint.segment.pressX, tint.segment.pressY)
                }
                function onReleased() {
                    ripple.release()
                }
                function onCanceled() {
                    ripple.release()
                }
            }
        }
    }

    Rectangle {
        id: indicator

        readonly property Item target: repeater.count > 0 ? repeater.itemAt(root.currentIndex) : null

        visible: target !== null
        x: target ? row.x + target.x : 0
        y: root.inset
        width: target ? target.width : 0
        height: root.segmentHeight
        radius: height / 2
        color: root.indicatorColor

        Behavior on x {
            enabled: root.sliding
            ElementMove {}
        }
        Behavior on width {
            enabled: root.sliding
            ElementMove {}
        }
    }

    Row {
        id: row
        x: root.inset
        y: root.inset

        Repeater {
            id: repeater
            model: root.segments

            delegate: RippleButton {
                id: segment

                required property int index
                required property Segment modelData
                readonly property bool selected: index === root.currentIndex
                readonly property color foreground: selected ? root.selectedContentColor : root.contentColor

                width: root.segmentWidth > 0 ? root.segmentWidth : implicitWidth
                height: root.segmentHeight
                leftPadding: root.horizontalPadding
                rightPadding: root.horizontalPadding
                topPadding: 0
                bottomPadding: 0
                scheme: root.scheme
                enabled: modelData.enabled
                buttonRadius: height / 2
                colBackground: "transparent"
                // its tint and ripple are drawn under the pill (tints)
                colBackgroundHover: "transparent"
                rippleEnabled: false
                tooltip: modelData.tooltip
                onClicked: root.activated(index)

                contentItem: Item {
                    implicitWidth: content.implicitWidth
                    implicitHeight: content.implicitHeight

                    Row {
                        id: content
                        anchors.centerIn: parent
                        spacing: segment.modelData.text.length > 0 && segment.modelData.symbol.length > 0 ? 6 : 0

                        Image {
                            id: spotifyIcon
                            anchors.verticalCenter: parent.verticalCenter
                            width: root.iconSize
                            height: root.iconSize
                            sourceSize.width: root.iconSize * 2
                            sourceSize.height: root.iconSize * 2
                            fillMode: Image.PreserveAspectFit
                            visible: segment.modelData.symbol === "spotify"
                            source: "qrc:/qt/qml/Resonance/resources/spotify.svg"
                            opacity: segment.selected ? 1.0 : 0.65

                            Behavior on opacity {
                                NumberAnimation { duration: Appearance.duration(150) }
                            }
                        }

                        Image {
                            id: soundcloudIcon
                            anchors.verticalCenter: parent.verticalCenter
                            width: root.iconSize
                            height: root.iconSize
                            sourceSize.width: root.iconSize * 2
                            sourceSize.height: root.iconSize * 2
                            fillMode: Image.PreserveAspectFit
                            visible: segment.modelData.symbol === "soundcloud" || segment.modelData.symbol === "cloud"
                            source: "qrc:/qt/qml/Resonance/resources/soundcloud.svg"
                            opacity: segment.selected ? 1.0 : 0.65

                            Behavior on opacity {
                                NumberAnimation { duration: Appearance.duration(150) }
                            }
                        }

                        MaterialSymbol {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: segment.modelData.symbol.length > 0 && segment.modelData.symbol !== "spotify" && segment.modelData.symbol !== "soundcloud" && segment.modelData.symbol !== "cloud"
                            text: segment.modelData.symbol
                            iconSize: root.iconSize
                            fill: segment.selected ? 1 : 0
                            color: segment.foreground

                            Behavior on color {
                                ElementMoveFastColor {}
                            }
                        }
                        StyledText {
                            anchors.verticalCenter: parent.verticalCenter
                            visible: segment.modelData.text.length > 0
                            text: segment.modelData.text
                            font.pixelSize: Appearance.fontSize.smallie
                            font.weight: Font.Medium
                            color: segment.foreground

                            Behavior on color {
                                ElementMoveFastColor {}
                            }
                        }
                    }
                }
            }
        }
    }
}
