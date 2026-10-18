pragma ComponentBehavior: Bound
import QtQuick

// One choice in a SegmentedControl: a glyph, a label or both. A value type
// rather than an item, so a list of choices can be written inline in a model.
//
// Plain properties, deliberately: qmlcachegen in Qt 6.9 — the oldest version
// CMakeLists.txt asks for — reads `final` as a reserved word and refuses the
// file, which broke the linux release build, and `readonly` would refuse the
// assignment a caller makes when it writes `Segment { text: "Light" }`.
QtObject {
    property string text
    property string symbol
    property string tooltip
    property bool enabled: true
}
