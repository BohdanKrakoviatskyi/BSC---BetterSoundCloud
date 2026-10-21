pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Templates as T
import Resonance

T.MenuSeparator {
    id: root

    property MaterialScheme scheme: UiState.immersiveOpen ? PlayerStyle.darkScheme : Appearance.colors

    topPadding: 4
    bottomPadding: 4
    leftPadding: 8
    rightPadding: 8
    contentItem: WavyLine {
        color: root.scheme.outlineVariant
        amplitude: 1.4
        wavelength: 12
    }
}
