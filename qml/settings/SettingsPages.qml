pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Dialogs
import QtQuick.Effects
import QtMultimedia
import Resonance

// the settings themselves (ResonanceSettingsView), one page per rail
// destination: what the visualizers and the backdrop cost, the sleep fade and
// audio quality, the folders of music of the person's own, how the app fits
// the desktop, how much it moves and draws, the
// spotify logins, and about. every change applies at once.
Item {
    id: root

    property int page: 0
    readonly property list<string> fades: ["none", "finalSeconds", "entire"]
    readonly property list<int> qualities: [96, 160, 320]
    readonly property list<int> cacheSizes: [500, 1000, 2000]

    component Page: Column {
        width: parent ? parent.width : 0
        spacing: 24
    }

    /// a login's state: a label, and the state beside a dot that says
    /// whether all is well
    component StatusRow: Item {
        id: status

        property string label
        property string value
        property bool good: false

        width: parent ? parent.width : 0
        height: 40

        StyledText {
            x: 12
            anchors.verticalCenter: parent.verticalCenter
            text: status.label
        }
        Row {
            anchors.right: parent.right
            anchors.rightMargin: 12
            anchors.verticalCenter: parent.verticalCenter
            spacing: 8

            Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: 8
                height: 8
                radius: 4
                color: status.good ? Appearance.colors.primary : Appearance.colors.error
            }
            StyledText {
                anchors.verticalCenter: parent.verticalCenter
                text: status.value
                color: Appearance.colors.onSurfaceVariant
            }
        }
    }

    implicitHeight: pages.implicitHeight

    // only the chosen page is visible, and a column leaves the rest no room
    Column {
        id: pages
        width: parent.width

        Page {
            visible: root.page === 0

            ContentSection {
                title: "Visualizer"
                symbol: "graphic_eq"

                ConfigSwitch {
                    text: "Show audio visualizers"
                    checked: Settings.visualizersEnabled
                    onToggledTo: (checked) => Settings.visualizersEnabled = checked
                }
                ConfigSelection {
                    text: "Style"
                    enabled: Settings.visualizersEnabled
                    currentIndex: Settings.circularVisualizer ? 1 : 0
                    segments: [
                        Segment { text: "Normal" },
                        Segment { text: "Circular" }
                    ]
                    onActivated: (index) => Settings.circularVisualizer = index === 1
                }
                ConfigSelection {
                    text: "Shape"
                    enabled: Settings.visualizersEnabled
                    currentIndex: Settings.visualizerShape === "wave" ? 1 : 0
                    segments: [
                        Segment { text: "Bars" },
                        Segment { text: "Wave" }
                    ]
                    onActivated: (index) => Settings.visualizerShape = index === 1 ? "wave" : "bars"
                }
                ConfigSwitch {
                    text: "Round artwork"
                    // with visualizers on, the circular style rounds the
                    // cover inside its ring
                    enabled: !Settings.visualizersEnabled
                    checked: Settings.roundArtwork || (Settings.visualizersEnabled && Settings.circularVisualizer)
                    onToggledTo: (checked) => Settings.roundArtwork = checked
                }
                ConfigSlider {
                    text: "Sensitivity"
                    enabled: Settings.visualizersEnabled
                    from: 0.6
                    to: 1.8
                    stepSize: 0.05
                    value: Settings.visualizerSensitivity
                    valueText: Math.round(Settings.visualizerSensitivity * 100) + "%"
                    onMoved: (value) => Settings.visualizerSensitivity = value
                }
                NoteText {
                    text: "turn this off if u want lower cpu cost"
                }
            }
        }

        Page {
            visible: root.page === 1

            ContentSection {
                title: "App Wallpaper"
                symbol: "image"

                FileDialog {
                    id: bgFileDialog
                    title: "Select Background"
                    fileMode: FileDialog.OpenFile
                    nameFilters: ["All supported (*.png *.jpg *.jpeg *.webp *.bmp *.gif *.mp4 *.mov *.webm *.mkv)",
                                  "Images (*.png *.jpg *.jpeg *.webp *.bmp *.gif)",
                                  "Videos (*.mp4 *.mov *.webm *.mkv)"]
                    onAccepted: {
                        if (selectedFile) {
                            Settings.addCustomBackground(selectedFile.toString())
                        }
                    }
                }

                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8
                    topPadding: 4
                    bottomPadding: 6

                    TextButton {
                        variant: TextButton.Tonal
                        symbol: "add_photo_alternate"
                        text: "Upload Background"
                        onClicked: bgFileDialog.open()
                    }

                    TextButton {
                        visible: Settings.customBackgroundPath.length > 0
                        variant: TextButton.Text
                        symbol: "close"
                        text: "Reset to Default"
                        onClicked: Settings.clearCustomBackground()
                    }
                }

                ConfigSlider {
                    visible: Settings.customBackgroundPath.length > 0
                    text: "Wallpaper dim"
                    from: 0.0
                    to: 0.85
                    stepSize: 0.05
                    value: Settings.customBackgroundDim
                    valueText: Math.round(Settings.customBackgroundDim * 100) + "%"
                    onMoved: (value) => Settings.customBackgroundDim = value
                }

                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 10
                    topPadding: 4
                    bottomPadding: 8
                    visible: Settings.customBackgrounds.length > 0

                    Repeater {
                        model: Settings.customBackgrounds

                        Item {
                            id: bgCard
                            required property string modelData
                            width: 136
                            height: 88

                            readonly property bool isSelected: modelData === Settings.customBackgroundPath
                            readonly property string cardPathLower: modelData.toLowerCase()
                            readonly property bool isVideo: cardPathLower.endsWith(".mp4") || cardPathLower.endsWith(".mov")
                                                         || cardPathLower.endsWith(".webm") || cardPathLower.endsWith(".mkv")
                                                         || cardPathLower.endsWith(".avi") || cardPathLower.endsWith(".m4v")
                            readonly property bool isGif: cardPathLower.endsWith(".gif")

                            Rectangle {
                                id: cardBorder
                                anchors.fill: parent
                                radius: Appearance.rounding.normal
                                color: Appearance.colors.surfaceContainer
                                border.width: bgCard.isSelected ? 2 : 1
                                border.color: bgCard.isSelected ? Appearance.colors.primary : Appearance.colors.outlineVariant

                                Item {
                                    id: imgContainer
                                    anchors.fill: parent
                                    anchors.margins: bgCard.isSelected ? 3 : 2

                                    Image {
                                        id: previewImg
                                        anchors.fill: parent
                                        source: Settings.backgroundUrl(bgCard.modelData)
                                        fillMode: Image.PreserveAspectCrop
                                        asynchronous: true
                                        visible: !bgCard.isVideo && !bgCard.isGif
                                    }

                                    AnimatedImage {
                                        id: previewGif
                                        anchors.fill: parent
                                        source: Settings.backgroundUrl(bgCard.modelData)
                                        fillMode: Image.PreserveAspectCrop
                                        asynchronous: true
                                        visible: bgCard.isGif
                                        playing: true
                                    }

                                    Loader {
                                        anchors.fill: parent
                                        active: bgCard.isVideo
                                        visible: active
                                        sourceComponent: Item {
                                            anchors.fill: parent

                                            MediaPlayer {
                                                id: cardVideoPlayer
                                                source: Settings.backgroundUrl(bgCard.modelData)
                                                loops: MediaPlayer.Infinite
                                                videoOutput: cardVideoOutput
                                                audioOutput: AudioOutput { muted: true; volume: 0 }
                                                Component.onCompleted: play()
                                            }

                                            VideoOutput {
                                                id: cardVideoOutput
                                                anchors.fill: parent
                                                fillMode: VideoOutput.PreserveAspectCrop
                                            }
                                        }
                                    }

                                    Rectangle {
                                        id: cardMask
                                        anchors.fill: parent
                                        radius: Appearance.rounding.normal - 2
                                        visible: false
                                        layer.enabled: true
                                    }

                                    MultiEffect {
                                        anchors.fill: parent
                                        source: bgCard.isGif ? previewGif : previewImg
                                        visible: !bgCard.isVideo
                                        maskEnabled: true
                                        maskSource: cardMask
                                    }
                                }

                                RippleButton {
                                    anchors.fill: parent
                                    colBackground: "transparent"
                                    colBackgroundHover: "transparent"
                                    buttonRadius: Appearance.rounding.normal
                                    onClicked: {
                                        if (bgCard.isSelected) {
                                            Settings.clearCustomBackground()
                                        } else {
                                            Settings.customBackgroundPath = bgCard.modelData
                                        }
                                    }
                                }

                                IconButton {
                                    anchors.top: parent.top
                                    anchors.right: parent.right
                                    anchors.margins: 4
                                    symbol: "close"
                                    size: 24
                                    iconSize: 14
                                    tooltip: bgCard.isVideo ? "Delete video" : (bgCard.isGif ? "Delete GIF" : "Delete photo")
                                    colBackground: Qt.rgba(0, 0, 0, 0.65)
                                    colBackgroundHover: Appearance.colors.error
                                    iconColor: "white"
                                    onClicked: Settings.removeCustomBackground(bgCard.modelData)
                                }

                                Rectangle {
                                    anchors.bottom: parent.bottom
                                    anchors.left: parent.left
                                    anchors.margins: 6
                                    width: 18
                                    height: 18
                                    radius: 9
                                    color: Appearance.colors.primary
                                    visible: bgCard.isSelected

                                    MaterialSymbol {
                                        anchors.centerIn: parent
                                        text: "check"
                                        iconSize: 12
                                        color: Appearance.colors.onPrimary
                                        fill: 1
                                    }
                                }

                                Rectangle {
                                    anchors.bottom: parent.bottom
                                    anchors.right: parent.right
                                    anchors.margins: 6
                                    width: bgCard.isVideo ? 24 : 32
                                    height: 18
                                    radius: 4
                                    color: Qt.rgba(0, 0, 0, 0.72)
                                    visible: bgCard.isVideo || bgCard.isGif

                                    MaterialSymbol {
                                        visible: bgCard.isVideo
                                        anchors.centerIn: parent
                                        text: "videocam"
                                        iconSize: 14
                                        color: "white"
                                    }

                                    StyledText {
                                        visible: bgCard.isGif
                                        anchors.centerIn: parent
                                        text: "GIF"
                                        font.pixelSize: 9
                                        font.weight: Font.Bold
                                        color: "white"
                                    }
                                }
                            }
                        }
                    }
                }

                NoteText {
                    text: "Click a saved image, GIF or video to apply it as the application background. Click the cross to remove or delete."
                }
            }

            ContentSection {
                title: "Live Background"
                symbol: "wallpaper"

                ConfigSwitch {
                    text: "Live background"
                    checked: Settings.livingBackdrop
                    onToggledTo: (checked) => Settings.livingBackdrop = checked
                }
                ConfigSlider {
                    text: "Blur"
                    from: 0
                    to: 60
                    stepSize: 1
                    value: Settings.backdropBlur
                    onMoved: (value) => Settings.backdropBlur = value
                }
                ConfigSlider {
                    text: "Reactivity"
                    enabled: Settings.livingBackdrop
                    from: 0
                    to: 3
                    stepSize: 0.1
                    value: Settings.backdropReactivity
                    valueText: Math.round(Settings.backdropReactivity * 100) + "%"
                    onMoved: (value) => Settings.backdropReactivity = value
                }
                NoteText {
                    text: "turn this off if u want lower cpu cost"
                }
            }
        }

        Page {
            visible: root.page === 2

            ContentSection {
                title: "Crossfade"
                symbol: "play_circle"

                ConfigSwitch {
                    text: "Crossfade between songs"
                    checked: Settings.crossfadeEnabled
                    onToggledTo: (checked) => Settings.crossfadeEnabled = checked
                }
                ConfigSlider {
                    text: "Crossfade duration"
                    enabled: Settings.crossfadeEnabled
                    from: 1
                    to: 12
                    stepSize: 1
                    value: Settings.crossfadeDurationSeconds
                    valueText: Settings.crossfadeDurationSeconds + " s"
                    onMoved: (value) => Settings.crossfadeDurationSeconds = Math.round(value)
                }
            }

            ContentSection {
                title: "Sleep Timer"
                symbol: "bedtime"

                ConfigSelection {
                    text: "Fade Out"
                    currentIndex: Math.max(0, root.fades.indexOf(Settings.sleepTimerFade))
                    segments: [
                        Segment { text: "None" },
                        Segment { text: "Last 10 Seconds" },
                        Segment { text: "Whole Timer" }
                    ]
                    onActivated: (index) => Settings.sleepTimerFade = root.fades[index]
                }
                NoteText {
                    text: "fading lowers the volume as the timer runs down and restores it once playback stops."
                }
            }

            ContentSection {
                title: "Audio Quality"
                symbol: "high_quality"

                ConfigSelection {
                    text: "Streaming"
                    currentIndex: Math.max(0, root.qualities.indexOf(Settings.streamingQuality))
                    segments: [
                        Segment { text: "96 kbps" },
                        Segment { text: "160 kbps" },
                        Segment { text: "320 kbps" }
                    ]
                    onActivated: (index) => Settings.streamingQuality = root.qualities[index]
                }
                ConfigSelection {
                    text: "Song cache"
                    currentIndex: Math.max(0, root.cacheSizes.indexOf(Settings.songCacheMegabytes))
                    segments: [
                        Segment { text: "500 MB" },
                        Segment { text: "1 GB" },
                        Segment { text: "2 GB" }
                    ]
                    onActivated: (index) => Settings.songCacheMegabytes = root.cacheSizes[index]
                }
                NoteText {
                    text: "both cache and quality apply the next time playback connects"
                }
            }
        }

        Page {
            visible: root.page === 3

            ContentSection {
                title: "Local Files"
                symbol: "folder_open"

                MusicPicker {
                    id: musicPicker
                }

                Repeater {
                    model: LocalFiles.sources

                    Item {
                        id: source

                        required property string modelData

                        width: parent ? parent.width : 0
                        height: 48

                        MaterialSymbol {
                            id: sourceSymbol
                            x: 12
                            anchors.verticalCenter: parent.verticalCenter
                            text: source.modelData.match(/\.[A-Za-z0-9]{2,4}$/) ? "audio_file" : "folder"
                            iconSize: 20
                            color: Appearance.colors.onSurfaceVariant
                        }
                        StyledText {
                            anchors.left: sourceSymbol.right
                            anchors.leftMargin: 12
                            anchors.right: removeSource.left
                            anchors.rightMargin: 8
                            anchors.verticalCenter: parent.verticalCenter
                            text: source.modelData
                            elide: Text.ElideMiddle
                        }
                        IconButton {
                            id: removeSource
                            anchors.right: parent.right
                            anchors.rightMargin: 4
                            anchors.verticalCenter: parent.verticalCenter
                            symbol: "close"
                            size: 32
                            iconSize: 18
                            tooltip: "Remove"
                            onClicked: LocalFiles.removeSource(source.modelData)
                        }
                    }
                }

                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8
                    topPadding: LocalFiles.sources.length > 0 ? 4 : 0
                    bottomPadding: 8

                    TextButton {
                        variant: TextButton.Tonal
                        symbol: "create_new_folder"
                        text: "Add Folder"
                        onClicked: musicPicker.pickFolder()
                    }
                    TextButton {
                        variant: TextButton.Text
                        symbol: "audio_file"
                        text: "Add Files"
                        onClicked: musicPicker.pickFiles()
                    }
                    TextButton {
                        variant: TextButton.Text
                        symbol: "refresh"
                        text: LocalFiles.scanning ? "Looking…" : "Look Again"
                        enabled: LocalFiles.sources.length > 0 && !LocalFiles.scanning
                        onClicked: LocalFiles.rescan()
                    }
                }

                NoteText {
                    text: "each songs title, artists, album and cover come from its own tags, and a .lrc file "
                          + "beside a song gives its lyrics. you can also drop files or folders onto the window"
                }
            }
        }

        Page {
            visible: root.page === 4

            ContentSection {
                title: "Colours"
                symbol: "palette"

                ConfigSelection {
                    text: "Light or dark"
                    // Matugen exports can contain both light and dark variants.
                    currentIndex: Math.max(0, ["system", "light", "dark"].indexOf(Settings.themeMode))
                    segments: [
                        Segment { text: "System"; symbol: "brightness_auto" },
                        Segment { text: "Light"; symbol: "light_mode" },
                        Segment { text: "Dark"; symbol: "dark_mode" }
                    ]
                    onActivated: (index) => Settings.themeMode = ["system", "light", "dark"][index]
                }

                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 10
                    topPadding: 6
                    bottomPadding: 10

                    Repeater {
                        model: Theme.themeOptions(Theme.dark)

                        delegate: ThemeSwatch {
                            required property themeOption modelData
                            option: modelData
                            selected: modelData.id === Settings.themeSource
                            onClicked: Settings.themeSource = modelData.id
                        }
                    }
                }

                Item {
                    width: parent.width
                    height: path.implicitHeight + automatic.implicitHeight + 24
                    visible: Settings.themeSource === "system"

                    OutlinedTextField {
                        id: path
                        x: 8
                        y: 8
                        width: parent.width - 16
                        placeholder: "Automatic (optional JSON file path)"
                        text: Settings.matugenColorsPath
                        onAccepted: Settings.matugenColorsPath = text
                    }
                    TextButton {
                        id: automatic
                        x: 8
                        y: path.y + path.height + 8
                        variant: TextButton.Tonal
                        symbol: "refresh"
                        text: "Auto-detect"
                        onClicked: {
                            path.text = ""
                            Settings.matugenColorsPath = ""
                            Theme.refreshSystemScheme()
                        }
                    }
                    Connections {
                        target: path.inputItem
                        function onActiveFocusChanged() {
                            if (!path.inputItem.activeFocus) {
                                Settings.matugenColorsPath = path.text
                            }
                        }
                    }
                }
                NoteText {
                    text: Settings.themeSource !== "system"
                        ? "these are hardcoded themes"
                        : (Theme.usingSystemScheme
                            ? "following " + Theme.systemSchemePath + "; updates when the file changes."
                            : Settings.matugenColorsPath.length > 0
                              ? "no valid Matugen scheme found at " + Theme.systemSchemePath
                              : "automatically looks for Matugen JSON in common config and cache folders. an optional path overrides discovery.")
                }
            }

            ContentSection {
                // a mac window keeps its traffic lights, and has no tray
                visible: !App.macOS
                title: "Window"
                symbol: "web_asset"

                ConfigSelection {
                    objectName: "windowControlsMode"
                    visible: App.windows
                    text: "Window controls"
                    currentIndex: Settings.nativeTitleBar ? 0 : 1
                    segments: [
                        Segment { text: "Native title bar" },
                        Segment { text: "In-app" }
                    ]
                    onActivated: (index) => Settings.nativeTitleBar = index === 0
                }
                ConfigSwitch {
                    text: "Window buttons"
                    visible: !App.windows
                    checked: Settings.showWindowControls
                    onToggledTo: (checked) => Settings.showWindowControls = checked
                }
                ConfigSwitch {
                    text: App.windows ? "Always show tray icon" : "Tray icon"
                    checked: Settings.trayIcon
                    onToggledTo: (checked) => Settings.trayIcon = checked
                }
                NoteText {
                    text: App.windows
                        ? "closing the window keeps Resonance running in the tray. choose Quit Resonance from the tray menu to exit."
                        : "window buttons are for desktops that draw none of their own, Hyprland closes and moves windows itself"
                }
            }
        }

        Page {
            visible: root.page === 5

            ContentSection {
                title: "Motion"
                symbol: "animation"

                ConfigSwitch {
                    text: "Reduce motion"
                    checked: Settings.reduceMotion || Settings.performanceMode
                    enabled: !Settings.performanceMode
                    onToggledTo: (checked) => Settings.reduceMotion = checked
                }
                ConfigSwitch {
                    text: "Performance mode"
                    checked: Settings.performanceMode
                    onToggledTo: (checked) => Settings.performanceMode = checked
                }
                NoteText {
                    text: "reduced motion stops anything from constantly animating on its own, interactions still animate tho. "
                        + "performance mode goes way further, NOTHING animates! drastically improves performance but looks ugly imo"
                }
            }

            ContentSection {
                title: "Shapes"
                symbol: "category"

                ConfigSwitch {
                    text: "No shapes"
                    checked: Settings.noShapes
                    onToggledTo: (checked) => Settings.noShapes = checked
                }
                NoteText {
                    text: "less shapes if you prefer minimalistic look"
                }
            }
        }

        // the logins: who is signed in, the library's and playback's state,
        // connecting them again, and logging out
        Page {
            visible: root.page === 6

            ContentSection {
                title: "Music Service"
                symbol: "hub"

                ConfigSelection {
                    text: "Active Service"
                    currentIndex: Library.source === "soundcloud" ? 1 : 0
                    segments: [
                        Segment { text: "Spotify" },
                        Segment { text: "SoundCloud" }
                    ]
                    onActivated: (index) => {
                        Library.setSource(index === 1 ? "soundcloud" : "spotify")
                    }
                }
            }

            ContentSection {
                title: "Account"
                symbol: "account_circle"

                Item {
                    width: parent.width
                    height: 72

                    Item {
                        id: avatar
                        x: 12
                        anchors.verticalCenter: parent.verticalCenter
                        width: 48
                        height: 48

                        ArtworkImage {
                            anchors.fill: parent
                            Reveal.shown: Library.profileArtworkUrl.toString().length > 0
                            circular: true
                            source: Library.profileArtworkUrl
                            placeholderSymbol: "person"
                        }
                        MaterialSymbol {
                            anchors.centerIn: parent
                            Reveal.shown: Library.profileArtworkUrl.toString().length === 0
                            text: "account_circle"
                            iconSize: 48
                            fill: 1
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }

                    Column {
                        anchors.left: avatar.right
                        anchors.leftMargin: 18
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2

                        StyledText {
                            width: parent.width
                            text: Library.profileName.length > 0 ? Library.profileName : (Library.source === "soundcloud" ? "SoundCloud" : "Spotify")
                            elide: Text.ElideRight
                            font.pixelSize: Appearance.fontSize.larger
                            font.weight: Font.DemiBold
                        }
                        StyledText {
                            width: parent.width
                            text: Library.source === "soundcloud"
                                ? (SoundCloud.connected ? "SoundCloud connected" : "SoundCloud not connected")
                                : (Session.libraryConnected && Session.connected ? "Library and playback connected"
                                    : Session.libraryConnected ? "Library connected"
                                    : Session.connected ? "Playback connected" : "Not signed in")
                            elide: Text.ElideRight
                            color: Appearance.colors.onSurfaceVariant
                        }
                    }
                }

                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8

                    TextButton {
                        symbol: "logout"
                        text: "Log Out"
                        colBackground: Appearance.colors.error
                        colBackgroundHover: Appearance.colors.errorHover
                        labelColor: Appearance.colors.onError
                        enabled: Library.source === "soundcloud" ? SoundCloud.connected : (Session.libraryConnected || Session.connected)
                        onClicked: logOutDialog.open()
                    }
                }
                NoteText {
                    text: Library.source === "soundcloud"
                        ? "forgets the soundcloud login on this computer, local files stay of course"
                        : "forgets both logins on this computer, local files stay of course"
                }

                StyledDialog {
                    id: logOutDialog
                    headline: Library.source === "soundcloud" ? "Log Out of SoundCloud?" : "Log Out of Spotify?"
                    symbol: "logout"
                    iconShape: "ghostish"
                    body: Library.source === "soundcloud"
                        ? "Resonance forgets your soundcloud login on this computer. you can connect again any time."
                        : "Resonance forgets your library and playback logins on this computer. you can connect again any time."

                    buttons: [
                        TextButton {
                            text: "Log Out"
                            colBackground: Appearance.colors.error
                            colBackgroundHover: Appearance.colors.errorHover
                            labelColor: Appearance.colors.onError
                            onClicked: {
                                if (Library.source === "soundcloud") {
                                    SoundCloud.logOut()
                                } else {
                                    Session.logOut()
                                }
                                logOutDialog.accept()
                            }
                        },
                        TextButton {
                            variant: TextButton.Text
                            text: "Cancel"
                            onClicked: logOutDialog.close()
                        }
                    ]
                }
            }

            ContentSection {
                title: "SoundCloud"
                symbol: "cloud"

                StatusRow {
                    label: "Status"
                    value: SoundCloud.connected ? ("Connected as " + (SoundCloud.userName.length > 0 ? SoundCloud.userName : "User"))
                         : (SoundCloud.available ? "Not connected" : "Sidecar not available")
                    good: SoundCloud.connected
                }
                TextButton {
                    x: 8
                    variant: SoundCloud.browserLoginActive ? TextButton.Tonal : TextButton.Filled
                    symbol: SoundCloud.browserLoginActive ? "" : "cloud"
                    busy: SoundCloud.browserLoginActive
                    text: SoundCloud.browserLoginActive
                          ? "Waiting for soundcloud.com sign-in"
                          : "Login with SoundCloud"
                    onClicked: {
                        if (SoundCloud.browserLoginActive) {
                            SoundCloud.cancelBrowserLogin()
                        } else {
                            SoundCloud.loginWithBrowser()
                        }
                    }
                }
                NoteText {
                    visible: SoundCloud.browserLoginActive
                    text: "Sign in to SoundCloud in the browser window that just opened — it closes itself once the session is in. Click the button again to cancel."
                }
                Row {
                    x: 8
                    spacing: 12

                    Rectangle {
                        width: 90
                        height: 1
                        color: Appearance.colors.outlineVariant
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    StyledText {
                        text: "or"
                        color: Appearance.colors.onSurfaceVariant
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Rectangle {
                        width: 90
                        height: 1
                        color: Appearance.colors.outlineVariant
                        anchors.verticalCenter: parent.verticalCenter
                    }
                }
                OutlinedTextField {
                    id: scSettingsClientIdField
                    x: 8
                    width: Math.min(460, parent.width - 16)
                    placeholder: "SoundCloud Client ID"
                    text: SoundCloud.clientId
                    onTextEdited: SoundCloud.clientId = text
                }
                OutlinedTextField {
                    id: scSettingsTokenField
                    x: 8
                    width: Math.min(460, parent.width - 16)
                    placeholder: "SoundCloud OAuth Token"
                }
                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8
                    topPadding: 4

                    TextButton {
                        variant: TextButton.Tonal
                        symbol: SoundCloud.connected ? "cloud_done" : "cloud_sync"
                        text: SoundCloud.busy ? "Connecting…" : (SoundCloud.connected ? "Reconnect SoundCloud" : "Connect SoundCloud")
                        enabled: !SoundCloud.busy && (scSettingsClientIdField.text.trim().length > 0 || SoundCloud.clientId.length > 0)
                        onClicked: {
                            SoundCloud.connectAccount(scSettingsClientIdField.text, scSettingsTokenField.text)
                        }
                    }

                    TextButton {
                        visible: SoundCloud.connected
                        symbol: "logout"
                        text: "Disconnect"
                        colBackground: Appearance.colors.error
                        colBackgroundHover: Appearance.colors.errorHover
                        labelColor: Appearance.colors.onError
                        enabled: !SoundCloud.busy
                        onClicked: {
                            SoundCloud.logOut()
                            if (Library.source === "soundcloud") {
                                Library.setSource("spotify")
                            }
                        }
                    }

                    TextButton {
                        visible: SoundCloud.connected && Library.source !== "soundcloud"
                        variant: TextButton.Filled
                        symbol: "swap_horiz"
                        text: "Switch to SoundCloud"
                        onClicked: {
                            Library.setSource("soundcloud")
                        }
                    }
                }
                NoteText {
                    visible: SoundCloud.statusMessage.length > 0
                    text: SoundCloud.statusMessage
                }
                NoteText {
                    text: "Paste your SoundCloud Client ID and OAuth token from soundcloud.com — or log in with the browser button above, which grabs both by itself. Streams are cached locally with full EQ and spectrum."
                }
            }

            ContentSection {
                title: "Library"
                symbol: "library_music"

                StatusRow {
                    label: "Status"
                    value: Session.libraryStatus
                    good: Session.libraryConnected && !Session.libraryNeedsAuthorizationUpgrade
                }
                OutlinedTextField {
                    x: 8
                    width: Math.min(460, parent.width - 16)
                    placeholder: "Spotify Client ID"
                    text: Session.libraryClientId
                    onTextEdited: Session.libraryClientId = text
                }
                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8
                    topPadding: 4

                    TextButton {
                        variant: TextButton.Tonal
                        symbol: "library_music"
                        text: Session.libraryConnected ? "Reconnect Library" : "Connect Library"
                        enabled: Session.libraryClientId.trim().length > 0 && !Session.loginInProgress
                        onClicked: Session.beginLibraryLogin()
                    }
                }
                NoteText {
                    text: Session.libraryNeedsAuthorizationUpgrade
                          ? "reconnect once to let Resonance edit playlists and save songs"
                          : "your playlists, saved songs and search come through the Spotify app whose Client ID is above."
                }
            }

            ContentSection {
                title: "Playback"
                symbol: "play_circle"

                StatusRow {
                    label: "Status"
                    value: Session.connected ? "Connected" : "Not connected"
                    good: Session.connected
                }
                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8
                    topPadding: 4

                    TextButton {
                        variant: TextButton.Tonal
                        symbol: "play_circle"
                        text: Session.connected ? "Reconnect Playback" : "Connect Playback"
                        enabled: !Session.loginInProgress
                        onClicked: Session.beginPlaybackLogin()
                    }
                }
                NoteText {
                    text: "playing music needs a Spotify Premium login of its own, separate from the librarys"
                }
            }
        }

        Page {
            visible: root.page === 7

            ContentSection {
                title: "Debugging"
                symbol: "bug_report"

                ConfigSwitch {
                    text: "Debugging shortcuts"
                    checked: Settings.debuggingEnabled
                    onToggledTo: (checked) => Settings.debuggingEnabled = checked
                }
                NoteText {
                    text: "Adds a seconds dial to the sleep timer, so a fade can be watched without waiting out a long ass timer"
                }

                Flow {
                    x: 8
                    width: parent.width - 16
                    spacing: 8
                    topPadding: 4

                    TextButton {
                        variant: TextButton.Tonal
                        symbol: "hourglass_empty"
                        text: "Play Loading Test"
                        onClicked: Player.playLoadingTest()
                    }
                }
                NoteText {
                    text: "plays a song that never finishes loading, so the visualizers loading animation can be watched"
                }
            }

            ContentSection {
                id: about

                property bool revealed: false

                title: "About"
                symbol: "info"

                Row {
                    x: 12
                    width: parent.width - 24
                    topPadding: 8
                    bottomPadding: 8
                    spacing: 16

                    // the app's icon
                    Item {
                        anchors.verticalCenter: parent.verticalCenter
                        width: 72
                        height: 72

                        Image {
                            anchors.centerIn: parent
                            width: 46
                            height: 46
                            source: "qrc:/qt/qml__LEGACY_RESONANCE_IGNORE__resources/resonance-icon.png"
                            sourceSize: Qt.size(96, 96)
                            smooth: true
                            mipmap: true
                        }
                    }

                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 2

                        StyledText {
                            text: "Resonance " + App.version
                            font.weight: Font.Medium

                            TapHandler {
                                onTapped: about.revealed = true
                            }
                            HoverHandler {
                                cursorShape: Qt.PointingHandCursor
                            }
                        }
                        StyledText {
                            text: "humans"
                            font.pixelSize: Appearance.fontSize.smaller
                            color: Appearance.colors.onSurfaceVariant
                        }
                        StyledText {
                            topPadding: 8
                            visible: opacity > 0
                            opacity: about.revealed ? 1 : 0
                            scale: about.revealed ? 1 : 0.92
                            transformOrigin: Item.Left
                            text: "no secret dev options here..."
                            font.weight: Font.DemiBold
                            color: Appearance.colors.primary

                            Behavior on opacity {
                                NumberAnimation { duration: Appearance.duration(250); easing.type: Easing.OutCubic }
                            }
                            Behavior on scale {
                                ElementMoveSmall {}
                            }
                        }
                    }
                }
            }

            ContentSection {
                id: updatesSection
                title: "Updates"
                symbol: "update"

                Component.onCompleted: {
                    if (Updater.status === Updater.Idle) {
                        Updater.checkForUpdates()
                    }
                }

                Column {
                    x: 12
                    width: parent.width - 24
                    spacing: 12
                    topPadding: 4
                    bottomPadding: 8

                    Row {
                        width: parent.width
                        spacing: 16

                        Item {
                            anchors.verticalCenter: parent.verticalCenter
                            width: 44
                            height: 44

                            Rectangle {
                                anchors.fill: parent
                                radius: 22
                                color: {
                                    if (Updater.status === Updater.Checking || Updater.status === Updater.Downloading || Updater.status === Updater.Installing)
                                        return Appearance.colors.secondaryContainer;
                                    if (Updater.status === Updater.UpdateAvailable)
                                        return Appearance.colors.primaryContainer;
                                    if (Updater.status === Updater.Downloaded)
                                        return Appearance.colors.primary;
                                    if (Updater.status === Updater.Error)
                                        return Appearance.colors.errorContainer;
                                    return Appearance.colors.surfaceContainerHigh;
                                }

                                LoadingSpinner {
                                    anchors.centerIn: parent
                                    width: 24
                                    height: 24
                                    running: Updater.status === Updater.Checking || Updater.status === Updater.Downloading || Updater.status === Updater.Installing
                                    visible: running
                                    color: Appearance.colors.primary
                                }

                                MaterialSymbol {
                                    anchors.centerIn: parent
                                    visible: Updater.status !== Updater.Checking && Updater.status !== Updater.Downloading && Updater.status !== Updater.Installing
                                    text: {
                                        if (Updater.status === Updater.UpdateAvailable) return "system_update";
                                        if (Updater.status === Updater.Downloaded) return "check_circle";
                                        if (Updater.status === Updater.UpToDate) return "check";
                                        if (Updater.status === Updater.Error) return "error";
                                        return "update";
                                    }
                                    color: {
                                        if (Updater.status === Updater.Downloaded) return Appearance.colors.onPrimary;
                                        if (Updater.status === Updater.Error) return Appearance.colors.error;
                                        if (Updater.status === Updater.UpdateAvailable) return Appearance.colors.onPrimaryContainer;
                                        return Appearance.colors.primary;
                                    }
                                    iconSize: 22
                                    fill: 1
                                }
                            }
                        }

                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            width: parent.width - 60
                            spacing: 4

                            StyledText {
                                text: {
                                    switch (Updater.status) {
                                    case Updater.Checking:
                                        return "Checking for updates…";
                                    case Updater.UpdateAvailable:
                                        return "New version available: " + Updater.latestVersion;
                                    case Updater.Downloading:
                                        return "Downloading update… " + Math.round(Updater.downloadProgress * 100) + "%";
                                    case Updater.Downloaded:
                                        return "Update " + Updater.latestVersion + " downloaded";
                                    case Updater.Installing:
                                        return "Installing update…";
                                    case Updater.UpToDate:
                                        return "You’re up to date (" + Updater.currentVersion + ")";
                                    case Updater.Error:
                                        return "Failed to check for updates";
                                    default:
                                        return "Current version: " + Updater.currentVersion;
                                    }
                                }
                                font.weight: Font.Medium
                                color: Updater.status === Updater.Error ? Appearance.colors.error : Appearance.colors.onSurface
                            }

                            StyledText {
                                text: {
                                    if (Updater.status === Updater.UpdateAvailable) {
                                        let details = Updater.releaseTitle ? Updater.releaseTitle : "";
                                        if (Updater.assetSize > 0) {
                                            const mb = (Updater.assetSize / (1024 * 1024)).toFixed(1);
                                            details += (details.length > 0 ? " • " : "") + mb + " MB";
                                        }
                                        return details;
                                    }
                                    if (Updater.status === Updater.Downloading) {
                                        const receivedMb = (Updater.downloadedBytes / (1024 * 1024)).toFixed(1);
                                        const totalMb = Updater.assetSize > 0 ? (Updater.assetSize / (1024 * 1024)).toFixed(1) : "?";
                                        return receivedMb + " MB of " + totalMb + " MB";
                                    }
                                    if (Updater.status === Updater.Downloaded) {
                                        return "The installer is ready to run from your Downloads folder";
                                    }
                                    if (Updater.status === Updater.Error) {
                                        return Updater.errorMessage;
                                    }
                                    return "GitHub releases: Resonance";
                                }
                                font.pixelSize: Appearance.fontSize.smaller
                                color: Appearance.colors.onSurfaceVariant
                                elide: Text.ElideRight
                                width: parent.width
                            }
                        }
                    }

                    // Download progress bar
                    Rectangle {
                        width: parent.width
                        height: 4
                        radius: 2
                        color: Appearance.colors.surfaceContainerHigh
                        visible: Updater.status === Updater.Downloading
                        clip: true

                        Rectangle {
                            height: parent.height
                            width: parent.width * Math.max(0.02, Updater.downloadProgress)
                            radius: 2
                            color: Appearance.colors.primary

                            Behavior on width {
                                NumberAnimation { duration: 100 }
                            }
                        }
                    }

                    // Release notes preview (if update available)
                    Rectangle {
                        width: parent.width
                        height: Math.min(120, releaseNotesText.implicitHeight + 16)
                        radius: 12
                        color: Appearance.colors.surfaceContainerLow
                        visible: (Updater.status === Updater.UpdateAvailable || Updater.status === Updater.Downloaded) && Updater.releaseNotes.length > 0
                        clip: true

                        Flickable {
                            anchors.fill: parent
                            anchors.margins: 8
                            contentWidth: width
                            contentHeight: releaseNotesText.implicitHeight
                            boundsBehavior: Flickable.StopAtBounds

                            StyledText {
                                id: releaseNotesText
                                width: parent.width
                                text: Updater.releaseNotes
                                font.pixelSize: Appearance.fontSize.smaller
                                color: Appearance.colors.onSurfaceVariant
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    // Action buttons
                    Row {
                        spacing: 8
                        topPadding: 4

                        TextButton {
                            variant: TextButton.Filled
                            symbol: "sync"
                            text: "Check for updates"
                            visible: Updater.status === Updater.Idle || Updater.status === Updater.UpToDate || Updater.status === Updater.Error
                            busy: Updater.status === Updater.Checking
                            enabled: Updater.status !== Updater.Checking
                            onClicked: Updater.checkForUpdates()
                        }

                        TextButton {
                            variant: TextButton.Filled
                            symbol: "download"
                            text: "Download update"
                            visible: Updater.status === Updater.UpdateAvailable
                            onClicked: Updater.startDownload()
                        }

                        TextButton {
                            variant: TextButton.Filled
                            symbol: "open_in_new"
                            text: App.macOS ? "Install and restart" : "Open installer"
                            visible: Updater.status === Updater.Downloaded
                            onClicked: {
                                if (App.macOS) {
                                    Updater.installAndRelaunch();
                                } else {
                                    Updater.openInstaller();
                                }
                            }
                        }

                        TextButton {
                            variant: TextButton.Tonal
                            symbol: "folder_open"
                            text: "Show file"
                            visible: Updater.status === Updater.Downloaded
                            onClicked: Updater.openInstaller()
                        }

                        TextButton {
                            variant: TextButton.Tonal
                            symbol: "open_in_browser"
                            text: "GitHub"
                            visible: Updater.releaseUrl.length > 0
                            onClicked: Updater.openReleasePage()
                        }
                    }
                }
            }
        }
    }
}
