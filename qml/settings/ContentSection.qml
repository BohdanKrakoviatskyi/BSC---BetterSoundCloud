pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// a titled group of settings on a tonal card, as end4's settings app lays
// them out.
Column {
    id: root

    property string title
    property string symbol
    readonly property list<string> shapes: ["cookie9", "clover4", "sunny", "flower", "bun", "heart", "puffy", "gem"]
    /// the section's own shape, from its title
    property string iconShape: {
        let hash = 0
        for (let index = 0; index < title.length; ++index) {
            hash = (hash * 31 + title.charCodeAt(index)) >>> 0
        }
        return shapes[hash % shapes.length]
    }
    default property alias content: rows.data

    width: parent ? parent.width : 0
    spacing: 8

    Row {
        spacing: 10
        leftPadding: 2

        HoverHandler {
            id: headerHover
        }

        ShapeIcon {
            anchors.verticalCenter: parent.verticalCenter
            visible: root.symbol.length > 0
            size: 34
            iconSize: 18
            shape: root.iconShape
            symbol: root.symbol
            hovered: headerHover.hovered
        }
        TitleText {
            anchors.verticalCenter: parent.verticalCenter
            text: root.title
            font.pixelSize: Appearance.fontSize.larger
        }
    }

    Rectangle {
        width: parent.width
        implicitHeight: rows.implicitHeight + 16
        radius: Appearance.rounding.normal
        color: Appearance.colors.layer1

        Column {
            id: rows
            x: 8
            y: 8
            width: parent.width - 16
            spacing: 2
        }
    }
}
