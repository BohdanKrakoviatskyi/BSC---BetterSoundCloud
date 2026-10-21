#pragma once

#include <QByteArray>
#include <QColor>
#include <QImage>
#include <QList>
#include <QRectF>
#include <QSizeF>
#include <QString>

class QPainter;

namespace resonance {

/// locally drawn playlist covers (PlaylistCoverArt.swift). spotify makes its
/// own mosaics server side with no api to ask for one, so these are drawn
/// from the playlist's palette and uploaded like any other custom cover.
namespace covers {

enum class Style { Pour, Sleeves, Waveform, Orbit, Split };

struct Design {
    int id = 0;
    Style style = Style::Pour;
    QList<QColor> palette;
    bool dark = true;

    /// wraps, so a style may ask for as many colours as it likes
    QColor color(int index) const { return palette.at(index % palette.size()); }
};

/// the edge covers are sent at: big enough not to look soft in spotify's
/// grid, small enough that a flat design lands well inside 256 kB
constexpr int kEdge = 640;

/// one design per style on a dark ground and one on a light ground, each
/// leading with a different colour so ten covers from one artwork still look
/// like ten covers
QList<Design> designs(const QList<QColor> &colors);
/// widens a thin palette to five by rotating hue; a new playlist has no
/// artwork to sample at all
QList<QColor> expandedPalette(const QList<QColor> &colors);

/// draws a design into a square of `edge`, the title along its bottom
void paint(QPainter &painter, const Design &design, const QString &title, qreal edge);
QImage render(const Design &design, const QString &title, int edge = kEdge);
QByteArray jpeg(const Design &design, const QString &title);

/// part of a photo as a square jpeg under `maximumBytes`, stepping the
/// quality down rather than failing outright
QByteArray squareJpeg(const QImage &image, QRectF crop, int maximumBytes);

/// a picked photo, upright and at most 2048 px on its longer side
QImage loadPhoto(const QString &path);

// cropping: the photo fills the square before any zoom is applied

/// viewport points per image point at `zoom`
qreal displayScale(QSizeF imageSize, qreal viewport, qreal zoom);
/// keeps the photo covering the square, so panning never opens a gap
QSizeF clampedOffset(QSizeF proposed, QSizeF imageSize, qreal viewport, qreal zoom);
/// the part of the image the square frames, in the image's own pixels
QRectF cropRect(QSizeF imageSize, qreal viewport, qreal zoom, QSizeF offset);
QRectF centredSquare(QSizeF size);

} // namespace covers
} // namespace resonance
