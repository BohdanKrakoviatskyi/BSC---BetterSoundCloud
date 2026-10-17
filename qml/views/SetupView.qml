pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls.Basic
import Swiftify

// connecting the library and playback for the first time (SpotifySetupView)
Flickable {
    id: root

    // pages run up under the top bar, which floats over them with no
    // background of its own; they start below it
    topMargin: Appearance.sizes.topBarHeight

    property int serviceIndex: Settings.musicSource === "soundcloud" ? 1 : 0

    contentHeight: Math.max(height, column.implicitHeight + 72)
    boundsBehavior: Flickable.StopAtBounds
    ScrollBar.vertical: StyledScrollBar { topPadding: 3 + Appearance.sizes.topBarHeight }

    component Step: Row {
        id: step
        property int number
        property string title
        property string detail

        spacing: 12
        width: parent ? parent.width : 560

        Rectangle {
            width: 26
            height: 26
            radius: 13
            color: Appearance.colors.primary

            StyledText {
                anchors.centerIn: parent
                text: step.number
                font.weight: Font.Bold
                font.pixelSize: Appearance.fontSize.smallie
                color: Appearance.colors.onPrimary
            }
        }

        Column {
            width: step.width - 38
            spacing: 2

            StyledText {
                text: step.title
                font.pixelSize: Appearance.fontSize.normal
                font.weight: Font.DemiBold
            }
            StyledText {
                width: parent.width
                text: step.detail
                wrapMode: Text.Wrap
                color: Appearance.colors.onSurfaceVariant
                font.pixelSize: Appearance.fontSize.smallie
            }
        }
    }

    Stickers {
        width: root.width
        height: Math.max(root.height, column.y + column.height)
        key: "setup"
        count: 6
    }

    Column {
        id: column
        anchors.horizontalCenter: parent.horizontalCenter
        y: Math.max(36, (root.height - implicitHeight) / 2)
        width: Math.min(560, root.width - 72)
        spacing: 20

        MaterialSymbol {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 64
            height: 64
            text: "library_music"
            iconSize: 56
            fill: 1
            color: Appearance.colors.primary
        }

        TitleText {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "Connect Your Music"
            font.pixelSize: Appearance.fontSize.display
            font.weight: Font.Bold
        }

        SegmentedControl {
            anchors.horizontalCenter: parent.horizontalCenter
            currentIndex: root.serviceIndex
            segments: [
                Segment { text: "Spotify" },
                Segment { text: "SoundCloud" }
            ]
            onActivated: (index) => {
                root.serviceIndex = index
                Library.setSource(index === 1 ? "soundcloud" : "spotify")
            }
        }

        Column {
            visible: root.serviceIndex === 0
            width: parent.width
            spacing: 20

            StyledText {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                text: "Resonance needs a Client ID from your own Spotify developer app. You only have to set this up once."
                color: Appearance.colors.onSurfaceVariant
            }

            Column {
                width: parent.width
                spacing: 14

                Step {
                    number: 1
                    title: "Create a Spotify app"
                    detail: "Open the Spotify Developer Dashboard, choose Create app, and select Web API if Spotify asks."
                }

                TextButton {
                    x: 38
                    variant: TextButton.Text
                    symbol: "open_in_new"
                    text: "Open Spotify Developer Dashboard"
                    onClicked: App.openUrl("https://developer.spotify.com/dashboard")
                }

                Step {
                    number: 2
                    title: "Add Resonance's redirect URI"
                    detail: "In the app settings, add this exact address under Redirect URIs, then save:"
                }

                Rectangle {
                    x: 38
                    width: redirect.implicitWidth + 24
                    height: redirect.implicitHeight + 16
                    radius: Appearance.rounding.verySmall
                    color: Appearance.colors.surfaceContainerHigh

                    TextEdit {
                        id: redirect
                        anchors.centerIn: parent
                        text: Session.redirectUri
                        readOnly: true
                        selectByMouse: true
                        font.family: Appearance.monoFontFamily
                        font.pixelSize: Appearance.fontSize.smallie
                        color: Appearance.colors.onSurface
                        selectionColor: Appearance.colors.primary
                        selectedTextColor: Appearance.colors.onPrimary
                    }
                }

                Step {
                    number: 3
                    title: "Paste your Client ID"
                    detail: "Copy the Client ID from the app settings. You do not need the Client Secret."
                }
            }

            OutlinedTextField {
                anchors.horizontalCenter: parent.horizontalCenter
                width: Math.min(460, parent.width)
                placeholder: "Spotify Client ID"
                text: Session.libraryClientId
                onTextEdited: Session.libraryClientId = text
                onAccepted: Session.beginLibraryLogin()
            }

            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 12

                TextButton {
                    variant: Session.libraryConnected ? TextButton.Tonal : TextButton.Filled
                    symbol: Session.libraryConnected ? "check" : ""
                    text: Session.libraryConnected ? "Library Connected" : "Connect Library"
                    enabled: !Session.libraryConnected && Session.libraryClientId.trim().length > 0
                    onClicked: Session.beginLibraryLogin()
                }
                TextButton {
                    variant: Session.libraryConnected && !Session.connected ? TextButton.Filled : TextButton.Tonal
                    symbol: Session.connected ? "check" : ""
                    text: Session.connected ? "Playback Connected" : "Connect Playback"
                    enabled: !Session.connected
                    onClicked: Session.beginPlaybackLogin()
                }
            }

            StyledText {
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                text: Session.libraryConnected && !Session.connected
                      ? "Your library is connected. Now connect playback so Resonance can play music."
                      : Session.connected && !Session.libraryConnected
                        ? "Playback is connected. Now connect your library to see your music."
                        : "Connect Library first, then Connect Playback so Resonance can play music."
                font.pixelSize: Appearance.fontSize.smaller
                color: Session.libraryConnected !== Session.connected ? Appearance.colors.primary
                                                                      : Appearance.colors.onSurfaceVariant
            }
        }

        Column {
            visible: root.serviceIndex === 1
            width: parent.width
            spacing: 20

            StyledText {
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                text: "Connect your SoundCloud account using your Client ID and OAuth Access Token."
                color: Appearance.colors.onSurfaceVariant
            }

            Column {
                width: parent.width
                spacing: 14

                Step {
                    number: 1
                    title: "SoundCloud Client ID"
                    detail: "The client ID used by the SoundCloud web client to sign stream URLs."
                }

                OutlinedTextField {
                    id: scClientIdInput
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: Math.min(460, parent.width)
                    placeholder: "SoundCloud Client ID"
                    text: SoundCloud.clientId
                    onTextEdited: SoundCloud.clientId = text
                }

                Step {
                    number: 2
                    title: "SoundCloud OAuth Access Token"
                    detail: "Copy your OAuth token from your browser cookies or Authorization header on soundcloud.com."
                }

                OutlinedTextField {
                    id: scTokenInput
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: Math.min(460, parent.width)
                    placeholder: "OAuth Access Token"
                }
            }

            Row {
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 12

                TextButton {
                    variant: SoundCloud.connected ? TextButton.Tonal : TextButton.Filled
                    symbol: SoundCloud.connected ? "check" : ""
                    text: SoundCloud.busy ? "Connecting…" : (SoundCloud.connected ? "Connected" : "Connect SoundCloud")
                    enabled: !SoundCloud.busy && scClientIdInput.text.trim().length > 0 && scTokenInput.text.trim().length > 0
                    onClicked: {
                        SoundCloud.connectAccount(scClientIdInput.text, scTokenInput.text)
                    }
                }
            }

            StyledText {
                visible: SoundCloud.statusMessage.length > 0
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                text: SoundCloud.statusMessage
                font.pixelSize: Appearance.fontSize.smaller
                color: Appearance.colors.primary
            }
        }
    }
}
