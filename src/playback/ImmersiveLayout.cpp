#include "playback/ImmersiveLayout.h"

#include <algorithm>

namespace resonance {

ImmersiveLayout::ImmersiveLayout(QObject *parent)
    : QObject(parent)
{
}

void ImmersiveLayout::set(qreal width, qreal height, bool showsSpectrum, bool showsPanel, bool circular)
{
    m_windowWidth = width;
    m_windowHeight = height;
    m_showsSpectrum = showsSpectrum;
    m_showsPanel = showsPanel;
    m_circular = circular;
    emit changed();
}

qreal ImmersiveLayout::artworkSize() const
{
    const qreal metadataAndControls = chromeHeight();
    qreal widthShare;
    qreal heightShare;
    if (m_showsPanel && m_circular) {
        widthShare = 0.34;
        heightShare = 0.42;
    } else if (m_showsPanel) {
        widthShare = 0.27;
        heightShare = 0.32;
    } else if (m_circular) {
        widthShare = 0.48;
        heightShare = 0.5;
    } else {
        widthShare = 0.38;
        heightShare = 0.38;
    }
    return std::max(0.0, std::min({m_circular ? 500.0 : 380.0, m_windowWidth * widthShare, m_windowHeight * heightShare,
                                   contentHeight() - metadataAndControls}));
}

qreal ImmersiveLayout::chromeHeight() const
{
    // two title lines, artist and album, progress, transport, the volume,
    // and their gaps
    return usesCompactSpacing() ? 274 : 318;
}

} // namespace resonance
