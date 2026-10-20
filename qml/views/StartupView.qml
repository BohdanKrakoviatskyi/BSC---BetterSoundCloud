pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// while the saved login is checked (SpotifyStartupLoadingView)
Item {
    Rectangle {
        anchors.horizontalCenter: parent.horizontalCenter
        y: -height / 2
        width: parent.width * 1.4
        height: width
        radius: width / 2
        gradient: Gradient {
            orientation: Gradient.Vertical
            GradientStop { position: 0.5; color: Qt.rgba(Appearance.colors.primary.r, Appearance.colors.primary.g, Appearance.colors.primary.b, 0.16) }
            GradientStop { position: 1; color: "transparent" }
        }
        opacity: 0.8
    }

    Stickers {
        anchors.fill: parent
        key: "startup"
        count: 6
    }

    Column {
        anchors.centerIn: parent
        spacing: 16

        Item {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 64
            height: 64

            SoftShadow {
                anchors.fill: parent
                radius: 14
                blur: 14
                offset: Qt.vector2d(0, 5)
                color: Qt.rgba(Appearance.colors.primary.r, Appearance.colors.primary.g, Appearance.colors.primary.b, 0.28)
            }

            Image {
                anchors.fill: parent
                source: "qrc:/qt/qml/Resonance/resources/swiftify-icon.png"
                sourceSize: Qt.size(128, 128)
                smooth: true
            }
        }

        TitleText {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Resonance"
            font.pixelSize: Appearance.fontSize.headline
            font.weight: Font.Bold
        }

        LoadingSpinner {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 44
            height: 44
        }

        StyledText {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Checking your saved Spotify login…"
            color: Appearance.colors.onSurfaceVariant
        }
    }
}
