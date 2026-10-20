pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// one step of the PageHost's stack: the page for a destination, built while
// it is kept, and the cover a click on it sent flying to the next page's
// hero, so that cover can fly home again when the next page is left
Item {
    id: slot

    // plain properties: `final` is a reserved word to the qmlcachegen in Qt 6.9,
    // which CMakeLists.txt still asks cmake to accept, and `readonly` cannot be
    // written by the createObject call in PageHost that fills a slot in
    property Component page
    /// an old step is let go, to be built afresh if back ever reaches it
    property bool built: true
    property ArtworkImage returnCover: null
    property url returnSource
    property bool returnCircular: false
    readonly property Item view: loader.item as Item

    Loader {
        id: loader
        anchors.fill: parent
        active: slot.built
        sourceComponent: slot.page
    }
}
