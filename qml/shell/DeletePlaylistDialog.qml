pragma ComponentBehavior: Bound
import QtQuick
import Resonance

StyledDialog {
    id: root

    property playlist playlist

    function ask(target: playlist) {
        playlist = target
        open()
    }

    headline: "Delete “" + playlist.name + "”?"
symbol: "delete"
iconShape: "ghostish"
    body: playlist.isLocal ? "This deletes the playlist from this computer. Its music files stay where they are."
                           : "This removes the playlist from your Spotify library."

    buttons: [
        TextButton {
            text: "Delete Playlist"
            colBackground: Appearance.colors.error
            colBackgroundHover: Appearance.colors.errorHover
            labelColor: Appearance.colors.onError
            onClicked: {
                Library.deletePlaylist(root.playlist)
                root.accept()
            }
        },
        TextButton {
            variant: TextButton.Text
            text: "Cancel"
            onClicked: root.close()
        }
    ]
}
