pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a title in end4's manner: google sans flex drawn fully round, a touch wide
// and heavy through its variable axes, so headings read bubbly while body
// text stays plain. without google sans flex it is simply bold.
StyledText {
    /// display, headline or title: the page's name, a hero's, a section's
    property string level: "title"

    font.pixelSize: level === "display" ? Appearance.fontSize.display
                  : level === "headline" ? Appearance.fontSize.headline : Appearance.fontSize.title
    font.weight: Font.Bold
    font.letterSpacing: level === "display" ? -0.4 : 0
    font.variableAxes: ({ "ROND": 100, "wdth": 110, "wght": 720 })
}
