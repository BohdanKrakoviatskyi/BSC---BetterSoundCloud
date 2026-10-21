pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Dialogs
import Resonance

// the system's own pickers for music to add to Local Files: a folder,
// searched all the way down, or a few files. given a playlist made here,
// what is picked is copied into it instead
Item {
    id: root

    property string playlistId

    function pickFolder() {
        folderDialog.open()
    }

    function pickFiles() {
        fileDialog.open()
    }

    function add(urls: list<url>) {
        if (playlistId.length > 0) {
            LocalFiles.addFiles(playlistId, urls)
            UiState.toastRequested("Adding to the playlist…")
            return
        }
        const added = LocalFiles.addSources(urls)
        UiState.toastRequested(added > 0 ? "Looking for music…" : "Already in Local Files")
    }

    FolderDialog {
        id: folderDialog
        title: "Add a Folder of Music"
        onAccepted: root.add([selectedFolder])
    }

    FileDialog {
        id: fileDialog
        title: root.playlistId.length > 0 ? "Add Tracks" : "Add Music Files"
        fileMode: FileDialog.OpenFiles
        nameFilters: ["Music (*.mp3 *.flac *.ogg *.oga *.m4a *.mp4 *.aac *.wav *.aif *.aiff)"]
        onAccepted: root.add(selectedFiles)
    }
}
