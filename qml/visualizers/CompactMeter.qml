pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// the six-bar meter in the player bar and over the playing row, at the
// display's rate like every visualizer
SpectrumView {
    kind: SpectrumView.Compact
    sensitivity: Settings.visualizerSensitivity
}
