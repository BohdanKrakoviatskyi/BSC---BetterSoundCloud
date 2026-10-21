pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Templates as T
import Resonance

// a menu built the first time it is opened, rather than with the view it
// belongs to: most menus are never opened, and each one built is a few
// hundred objects kept for as long as the view is
Loader {
    id: root

    active: false

    /// opens it under or beside `anchor`, at `x`, `y` in its coordinates
    function popupAt(anchor: Item, x: real, y: real) {
        active = true
        // through a name: a line opening with a bracket runs on from the
        // one before, and `true(item)` is no call
        const menu = item as T.Menu
        menu.popup(anchor, x, y)
    }

    /// opens it at the pointer
    function popupHere() {
        active = true
        const menu = item as T.Menu
        menu.popup()
    }
}
