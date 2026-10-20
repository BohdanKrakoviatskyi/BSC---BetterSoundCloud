pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a clicked cover flying from its card to the hero of the page it opened
// (UiState.launchHero): it follows the hero as the page settles in, springs
// past its spot and back, and hands over once the hero's own cover is in.
// it starts as the card's cover, already decoded, and sharpens into the
// hero's as that arrives.
Item {
    id: root

    readonly property Item destination: UiState.heroTarget
    property real progress: 0
    property rect from
    property rect to
    /// the corners as they look on screen, from the cover it left to the
    /// one it lands on
    readonly property real cornerRadius: UiState.heroFromRadius + (UiState.heroToRadius - UiState.heroFromRadius) * progress

    function track() {
        const box = root.destination
        if (box) {
            root.to = box.mapToItem(root, 0, 0, box.width, box.height)
        }
    }

    function land() {
        flight.stop()
        deadline.stop()
        UiState.heroTarget = null
    }

    visible: destination !== null

    onDestinationChanged: {
        if (destination) {
            from = mapFromItem(null, UiState.heroFrom.x, UiState.heroFrom.y, UiState.heroFrom.width, UiState.heroFrom.height)
            track()
            progress = 0
            flight.restart()
            deadline.restart()
        }
    }

    SpringAnimation {
        id: flight
        target: root
        property: "progress"
        from: 0
        to: 1
        spring: 3.4
        damping: 0.27
        epsilon: 0.002
    }

    // whatever happens to the page, the cover never hangs about
    Timer {
        id: deadline
        interval: 2200
        onTriggered: root.land()
    }

    FrameAnimation {
        running: root.visible
        onTriggered: {
            root.track()
            if (!flight.running && UiState.heroReady) {
                root.land()
            }
        }
    }

    Item {
        id: flyer

        readonly property real size: root.from.width + (root.to.width - root.from.width) * root.progress

        x: root.from.x + (root.to.x - root.from.x) * root.progress
        y: root.from.y + (root.to.y - root.from.y) * root.progress
        width: size
        height: size

        // the card's cover, at the card's size so it comes straight from
        // the cache, stretched as it grows
        ArtworkImage {
            width: UiState.heroBaseSize
            height: UiState.heroBaseSize
            transformOrigin: Item.TopLeft
            scale: flyer.size / Math.max(1, UiState.heroBaseSize)
            source: UiState.heroSource
            circular: UiState.heroCircular
            // the corners keep the size they look on screen
            radius: Math.max(0, root.cornerRadius) / Math.max(0.01, scale)
            fades: false
            squiggleTurning: false
        }

        // the hero's own cover, the same request the page makes, over it
        ArtworkImage {
            width: Appearance.sizes.headerArtwork
            height: Appearance.sizes.headerArtwork
            transformOrigin: Item.TopLeft
            scale: flyer.size / width
            source: UiState.heroSource
            circular: UiState.heroCircular
            radius: Math.max(0, root.cornerRadius) / Math.max(0.01, scale)
            squiggleTurning: false
        }
    }
}
