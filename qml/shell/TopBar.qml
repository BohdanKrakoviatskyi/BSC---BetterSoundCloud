pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Effects
import Resonance

// the macos unified toolbar as a material top app bar: back, the open
// playlist's actions, a search field, and the playback menu. it has no
// background: the pages scroll up under it, and each button sits on a shape
// of its own. it is also the handle the window is moved by.
Item {
    id: root

    required property Window window
    property Item backdropSource
    readonly property bool onPlaylist: Library.page === Library.Page.Playlist && Library.selectedPlaylist.valid
    readonly property bool searching: (Library.source === "soundcloud" ? SoundCloud.connected : Session.libraryConnected) && Library.page === Library.Page.Search
    readonly property bool compact: width < 600
    readonly property real buttonSize: width < 420 ? 26 : (compact ? 34 : 46)
    readonly property real searchLeftEdge: back.x + back.width + 8
    readonly property real searchRightEdge: rightControls.x - 8
    // Reserve the collapsed field's space even while its overlay is focused.
    readonly property real reservedSearchWidth: Math.max(40, Math.min(340, searchRightEdge - searchLeftEdge - (onPlaylist ? playlistActions.implicitWidth + 8 : 0)))
    readonly property string playlistLink: Library.selectedPlaylist.isSoundCloud ? "https://soundcloud.com" : ("https://open.spotify.com/playlist/" + Library.selectedPlaylist.id)

    function focusSearch() {
        if (search.visible) {
            search.focusField();
        }
    }

    implicitHeight: Appearance.sizes.topBarHeight

    DragHandler {
        target: null
        grabPermissions: PointerHandler.CanTakeOverFromAnything
        onActiveChanged: if (active)
            root.window.startSystemMove()
    }
    TapHandler {
        acceptedButtons: Qt.LeftButton
        onDoubleTapped: root.window.visibility === Window.Maximized ? root.window.showNormal() : root.window.showMaximized()
    }

    Item {
        id: toolbarButtons
        anchors.fill: parent

        ToolbarButton {
            id: back
            effect: ToolbarButton.NudgeLeft
            anchors.left: parent.left
            anchors.leftMargin: 12
            anchors.verticalCenter: parent.verticalCenter
            size: root.buttonSize
            iconSize: root.compact ? 20 : 26
            symbol: "arrow_back"
            // it sits on an arrow, pointing the way it goes
            shape: "arrow"
            shapeAngle: -90
            turnsOnHover: false
            enabled: Library.canGoBack
            onClicked: Library.goBack()
            tooltip: "Back"
        }

        Row {
            id: rightControls
            anchors.right: parent.right
            anchors.rightMargin: 12
            anchors.verticalCenter: parent.verticalCenter
            spacing: 4

            ToolbarButton {
                id: overflow
                effect: ToolbarButton.Spin
                size: root.buttonSize
                iconSize: root.compact ? 20 : 26
                shape: "cookie9"
                anchors.verticalCenter: parent.verticalCenter
                symbol: "more_vert"
                onClicked: playbackMenu.popupAt(overflow, 0, overflow.height)
                tooltip: "Playback"
            }

        }

        Row {
            id: playlistActions
            objectName: "playlistActions"
            x: root.searchRightEdge - root.reservedSearchWidth - 8 - width
            anchors.verticalCenter: parent.verticalCenter
            spacing: root.compact ? 0 : 2
            Reveal.shown: root.onPlaylist

            ToolbarButton {
                effect: ToolbarButton.Spin
                size: root.buttonSize
                iconSize: root.compact ? 19 : 26
                shape: "clover4"
                symbol: "add"
                onClicked: Library.selectedPlaylist.isLocal ? UiState.createLocalPlaylistRequested(null) : UiState.beginCreatePlaylist()
                tooltip: "New Playlist"
            }
            ToolbarButton {
                effect: ToolbarButton.Pop
                Reveal.shown: Library.selectedPlaylistEditable
                size: root.buttonSize
                iconSize: root.compact ? 19 : 26
                shape: "puffy"
                symbol: "edit"
                onClicked: UiState.editPlaylistRequested()
                tooltip: "Edit Playlist"
            }
            ToolbarButton {
                effect: ToolbarButton.Pop
                Reveal.shown: !Library.selectedPlaylist.isLocal
                size: root.buttonSize
                iconSize: root.compact ? 19 : 26
                shape: "cookie6"
                symbol: "share"
                onClicked: {
                    App.copyToClipboard(root.playlistLink);
                    UiState.toastRequested("Playlist link copied");
                }
                tooltip: "Copy Link"
            }
            ToolbarButton {
                id: more
                effect: ToolbarButton.Pop
                size: root.buttonSize
                iconSize: root.compact ? 19 : 26
                shape: "sunny"
                symbol: "more_horiz"
                onClicked: moreMenu.popupAt(more, 0, more.height)
                tooltip: "More"
            }
            ToolbarButton {
                id: sort
                effect: ToolbarButton.Pop
                size: root.buttonSize
                iconSize: root.compact ? 19 : 26
                shape: "flower"
                symbol: "sort"
                onClicked: sortMenu.popupAt(sort, 0, sort.height)
                tooltip: "Sort Options"
            }
        }
    }

    Rectangle {
        id: searchMask
        width: search.width
        height: search.height
        radius: height / 2
        layer.enabled: true
        visible: false
    }

    Item {
        id: searchBlur
        anchors.left: search.left
        anchors.right: search.right
        anchors.top: search.top
        anchors.bottom: search.bottom
        z: 8
        visible: search.editing && !!root.backdropSource

        Rectangle {
            anchors.fill: parent
            radius: height / 2
            color: Appearance.colors.layer1
        }

        ShaderEffectSource {
            id: searchBackdrop
            anchors.fill: parent
            sourceItem: root.backdropSource
            live: searchBlur.visible
            hideSource: false
            sourceRect: {
                const origin = root.mapToItem(root.backdropSource, search.x, search.y);
                return Qt.rect(origin.x, origin.y, search.width, search.height);
            }
            textureSize: Qt.size(Math.max(1, Math.ceil(search.width)), Math.max(1, Math.ceil(search.height)))
            visible: false
        }
        MultiEffect {
            anchors.fill: parent
            source: searchBackdrop
            blurEnabled: true
            blur: 0.8
            blurMax: 48
            maskEnabled: true
            maskSource: searchMask
        }
        // Capture only the buttons, so the field never samples itself.
        ShaderEffectSource {
            id: buttonBackdrop
            anchors.fill: parent
            sourceItem: toolbarButtons
            sourceRect: Qt.rect(search.x, search.y, search.width, search.height)
            live: searchBlur.visible
            hideSource: false
            visible: false
        }
        MultiEffect {
            anchors.fill: parent
            source: buttonBackdrop
            blurEnabled: true
            blur: 0.8
            blurMax: 48
            maskEnabled: true
            maskSource: searchMask
        }
        Rectangle {
            anchors.fill: parent
            radius: height / 2
            color: Qt.alpha(Appearance.colors.surfaceContainerHighest, 0.18)
        }
    }

    SearchField {
        id: search
        objectName: "toolbarSearch"
        x: root.searchRightEdge - width
        anchors.verticalCenter: parent.verticalCenter
        z: editing ? 9 : 0
        Reveal.shown: root.searching || root.onPlaylist
        width: {
            if (!visible)
                return 0;
            return editing ? Math.max(40, Math.min(340, root.searchRightEdge - root.searchLeftEdge)) : root.reservedSearchWidth;
        }
        placeholder: root.searching ? "Search Spotify" : "Find in Playlist"
        text: root.searching ? Library.searchQuery : Library.playlistFilterQuery
        onTextChanged: {
            if (root.searching) {
                Library.searchQuery = text;
            } else if (root.onPlaylist) {
                Library.playlistFilterQuery = text;
            }
        }

        Behavior on width {
            ElementMoveSmall {}
        }
    }

    MusicPicker {
        id: trackPicker
        playlistId: Library.selectedPlaylist.isLocal ? Library.selectedPlaylist.id : ""
    }

    MenuLoader {
        id: playbackMenu
        sourceComponent: PlaybackMenu {}
    }

    MenuLoader {
        id: moreMenu
        sourceComponent: StyledMenu {
            StyledMenuItem {
                text: "New Playlist"
                symbol: "add"
                onTriggered: Library.selectedPlaylist.isLocal ? UiState.createLocalPlaylistRequested(null) : UiState.beginCreatePlaylist()
            }
            StyledMenuItem {
                visible: Library.selectedPlaylistEditable
                height: visible ? implicitHeight : 0
                text: "Edit Playlist"
                symbol: "edit"
                onTriggered: UiState.editPlaylistRequested()
            }
            StyledMenuItem {
                visible: Library.selectedPlaylist.isLocal
                height: visible ? implicitHeight : 0
                text: "Add Tracks…"
                symbol: "playlist_add"
                onTriggered: trackPicker.pickFiles()
            }
            StyledMenuItem {
                visible: Library.selectedPlaylist.isLocal
                height: visible ? implicitHeight : 0
                text: "Add a Folder…"
                symbol: "create_new_folder"
                onTriggered: trackPicker.pickFolder()
            }
            StyledMenuItem {
                visible: !Library.selectedPlaylist.isLocal
                height: visible ? implicitHeight : 0
                text: Library.selectedPlaylist.isSoundCloud ? "Open in SoundCloud" : "Open in Spotify"
                symbol: "open_in_new"
                onTriggered: App.openUrl(root.playlistLink)
            }
            StyledMenuSeparator {
                visible: Library.selectedPlaylistEditable
                height: visible ? implicitHeight : 0
            }
            StyledMenuItem {
                visible: Library.selectedPlaylistEditable
                height: visible ? implicitHeight : 0
                text: "Delete Playlist"
                symbol: "delete"
                destructive: true
                onTriggered: UiState.deletePlaylistRequested(Library.selectedPlaylist)
            }
        }
    }

    MenuLoader {
        id: sortMenu
        sourceComponent: StyledMenu {
            Repeater {
                model: [
                    {
                        label: "Playlist Order",
                        order: Library.SortOrder.Playlist
                    },
                    {
                        label: "Title",
                        order: Library.SortOrder.Title
                    },
                    {
                        label: "Artist",
                        order: Library.SortOrder.Artist
                    },
                    {
                        label: "Album",
                        order: Library.SortOrder.Album
                    },
                    {
                        label: "Time",
                        order: Library.SortOrder.Duration
                    }
                ]

                StyledMenuItem {
                    required property var modelData
                    text: modelData.label
                    checkmark: true
                    checked: Library.playlistSortOrder === modelData.order
                    onTriggered: Library.playlistSortOrder = modelData.order
                }
            }
        }
    }
}
