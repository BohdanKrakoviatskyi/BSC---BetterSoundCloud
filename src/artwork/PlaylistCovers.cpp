#include "artwork/PlaylistCovers.h"

#include "theme/Theme.h"

#include <QBuffer>
#include <QFontMetricsF>
#include <QImageReader>
#include <QLinearGradient>
#include <QPainter>
#include <QPainterPath>
#include <QRadialGradient>
#include <QTextLayout>
#include <QThread>

#include <algorithm>
#include <cmath>

namespace resonance::covers {

namespace {

const QColor kAccentSecondary(214, 36, 108);
const QColor kDarkGround = QColor::fromRgbF(0.05f, 0.05f, 0.06f);
const QColor kLightGround = QColor::fromRgbF(0.97f, 0.96f, 0.94f);
const QColor kLightInk = QColor::fromRgbF(0.07f, 0.07f, 0.08f);

QColor withAlpha(QColor color, qreal alpha)
{
    color.setAlphaF(float(color.alphaF() * alpha));
    return color;
}

/// rotating hue in hsb rather than mixing towards another colour: a mix
/// greys a palette that is short on colour, which is the opposite of the point
QColor hueRotated(const QColor &color, qreal amount)
{
    const QColor rgb = color.toRgb();
    const qreal red = rgb.redF();
    const qreal green = rgb.greenF();
    const qreal blue = rgb.blueF();
    const qreal maximum = std::max({red, green, blue});
    const qreal minimum = std::min({red, green, blue});
    const qreal range = maximum - minimum;
    qreal hue = 0;
    qreal saturation = 0;
    if (range > 0) {
        if (maximum == red) {
            hue = (green - blue) / range + (green < blue ? 6 : 0);
        } else if (maximum == green) {
            hue = (blue - red) / range + 2;
        } else {
            hue = (red - green) / range + 4;
        }
        hue /= 6;
        saturation = range / maximum;
    }
    return QColor::fromHsvF(float(std::fmod(hue + amount, 1.0)), float(std::clamp(saturation * 1.08, 0.42, 1.0)),
                            float(std::clamp(maximum * 1.04, 0.5, 0.96)));
}

/// stable across launches, unlike a hash seeded per process, so a playlist
/// is drawn the same way every time
qreal titleSeed(const QString &title)
{
    qint64 sum = 0;
    for (const char32_t scalar : title.toUcs4()) {
        sum = (sum * 31 + qint64(scalar)) % 9973;
    }
    return qreal(sum) / 9973;
}

QColor ground(const Design &design)
{
    return design.dark ? kDarkGround : kLightGround;
}

QColor ink(const Design &design)
{
    return design.dark ? QColor(Qt::white) : kLightInk;
}

void fillLinear(QPainter &painter, qreal edge, QPointF from, QPointF to, const QList<QColor> &colors)
{
    QLinearGradient gradient(from, to);
    for (qsizetype index = 0; index < colors.size(); ++index) {
        gradient.setColorAt(colors.size() > 1 ? qreal(index) / qreal(colors.size() - 1) : 0, colors.at(index));
    }
    painter.fillRect(QRectF(0, 0, edge, edge), gradient);
}

// --- styles: everything relative to the edge, since the carousel draws them small ---

/// overlapping soft radial washes, read as poured ink
void pour(QPainter &painter, const Design &design, qreal edge)
{
    fillLinear(painter, edge, {0, 0}, {edge, edge}, {withAlpha(design.color(0), design.dark ? 0.62 : 0.78), ground(design)});
    const auto wash = [&](const QColor &color, qreal x, qreal y, qreal reach) {
        QRadialGradient gradient(QPointF(x * edge, y * edge), edge * reach);
        gradient.setColorAt(0, withAlpha(color, 0.92));
        gradient.setColorAt(0.5, withAlpha(color, 0.28));
        gradient.setColorAt(1, withAlpha(color, 0));
        painter.fillRect(QRectF(0, 0, edge, edge), gradient);
    };
    wash(design.color(1), 0.24, 0.26, 0.66);
    wash(design.color(2), 0.8, 0.36, 0.52);
    wash(design.color(3), 0.58, 0.8, 0.58);
    wash(design.color(4), 0.12, 0.78, 0.4);
}

/// three record sleeves fanned out of a stack
void sleeves(QPainter &painter, const Design &design, qreal edge)
{
    fillLinear(painter, edge, {0, 0}, {0, edge}, {ground(design), withAlpha(design.color(0), design.dark ? 0.4 : 0.3)});
    const qreal side = edge * 0.46;
    for (int index = 0; index < 3; ++index) {
        painter.save();
        painter.translate(edge / 2 + edge * (index * 0.1 - 0.12), edge / 2 + edge * (0.06 - index * 0.05));
        painter.rotate(index * 8.0 - 8.0);
        const QRectF sleeve(-side / 2, -side / 2, side, side);
        QLinearGradient fill(sleeve.topLeft(), sleeve.bottomRight());
        fill.setColorAt(0, design.color(index + 1));
        fill.setColorAt(1, withAlpha(design.color(index + 1), 0.66));
        painter.setPen(Qt::NoPen);
        painter.setBrush(fill);
        painter.drawRoundedRect(sleeve, edge * 0.05, edge * 0.05);
        painter.restore();
    }
}

/// bars, since this is a music app. the title sets their heights, so a
/// playlist keeps its own skyline
void waveform(QPainter &painter, const Design &design, const QString &title, qreal edge)
{
    fillLinear(painter, edge, {0, 0}, {0, edge}, {withAlpha(design.color(0), design.dark ? 0.3 : 0.24), ground(design)});
    constexpr int kCount = 15;
    const qreal seed = titleSeed(title);
    const qreal width = edge * 0.038;
    const qreal spacing = edge * 0.021;
    const qreal start = (edge - (kCount * width + (kCount - 1) * spacing)) / 2;
    const qreal middle = edge / 2 - edge * 0.08;

    QPainterPath bars;
    for (int index = 0; index < kCount; ++index) {
        const qreal phase = index * 0.82 + seed * M_PI * 2;
        const qreal fine = index * 2.37 + seed * M_PI;
        const qreal level = (std::sin(phase) * 0.5 + 0.5) * 0.7 + (std::sin(fine) * 0.5 + 0.5) * 0.3;
        const qreal height = edge * (0.12 + 0.5 * level);
        bars.addRoundedRect(QRectF(start + index * (width + spacing), middle - height / 2, width, height), width / 2,
                            width / 2);
    }
    QLinearGradient fill(0, 0, edge, 0);
    fill.setColorAt(0, design.color(1));
    fill.setColorAt(0.5, design.color(2));
    fill.setColorAt(1, design.color(3));
    painter.fillPath(bars, fill);
}

/// concentric rings, with one arc broken out of the pattern so it does not
/// read as a target
void orbit(QPainter &painter, const Design &design, qreal edge)
{
    painter.save();
    painter.translate(0, -edge * 0.07);
    const QPointF centre(edge / 2, edge / 2);
    QRadialGradient glow(centre, edge * 0.72);
    glow.setColorAt(0, withAlpha(design.color(0), design.dark ? 0.55 : 0.42));
    glow.setColorAt(1, ground(design));
    painter.fillRect(QRectF(0, 0, edge, edge + edge * 0.07), glow);

    painter.setBrush(Qt::NoBrush);
    for (int ring = 0; ring < 4; ++ring) {
        const qreal line = edge * (0.052 - ring * 0.009);
        // drawn inside the ring's frame, as a stroked border is
        const qreal radius = edge * (0.26 + ring * 0.19) / 2 - line / 2;
        painter.setPen(QPen(withAlpha(design.color(ring + 1), 0.9), line));
        painter.drawEllipse(centre, radius, radius);
    }

    // a trim of 0.06 to 0.44 from three o'clock, clockwise, turned 28° back
    const qreal radius = edge * 0.45;
    QPen arc(withAlpha(ink(design), 0.8), edge * 0.018);
    arc.setCapStyle(Qt::RoundCap);
    painter.setPen(arc);
    const qreal from = 0.06 * 360 - 28;
    const qreal span = (0.44 - 0.06) * 360;
    painter.drawArc(QRectF(centre.x() - radius, centre.y() - radius, 2 * radius, 2 * radius), qRound(-from * 16),
                    qRound(-span * 16));
    painter.restore();
}

/// a hard diagonal cut, with a thin band of a third colour along it
void split(QPainter &painter, const Design &design, qreal edge)
{
    fillLinear(painter, edge, {0, 0}, {edge, edge}, {design.color(0), design.color(1)});
    QPainterPath cut;
    cut.moveTo(0, edge * 0.92);
    cut.lineTo(edge, edge * 0.24);
    cut.lineTo(edge, edge);
    cut.lineTo(0, edge);
    cut.closeSubpath();
    painter.fillPath(cut, withAlpha(ground(design), design.dark ? 0.88 : 0.92));
    painter.setPen(QPen(design.color(2), edge * 0.035, Qt::SolidLine, Qt::FlatCap));
    painter.drawLine(QPointF(0, edge * 0.92), QPointF(edge, edge * 0.24));
    painter.setPen(Qt::NoPen);
    painter.setBrush(design.color(3));
    painter.drawEllipse(QPointF(edge * 0.74, edge * 0.26), edge * 0.08, edge * 0.08);
}

/// lays the title out in at most two lines, shrinking it to as little as
/// 0.45 of its size before it gives up and elides
QList<QTextLayout *> layoutTitle(const QString &text, QFont font, qreal width, qreal size, qreal &height)
{
    for (qreal scale = 1.0;; scale = std::max(0.45, scale - 0.05)) {
        font.setPixelSize(std::max(1, qRound(size * scale)));
        const QFontMetricsF metrics(font);
        QList<QTextLayout *> lines;
        QString remaining = text;
        bool fits = true;
        for (int line = 0; line < 2 && !remaining.isEmpty(); ++line) {
            auto *layout = new QTextLayout(remaining, font);
            layout->beginLayout();
            QTextLine first = layout->createLine();
            first.setLineWidth(width);
            const int length = first.textLength();
            layout->endLayout();
            const bool last = line == 1;
            const QString rest = remaining.mid(length);
            if (last && !rest.trimmed().isEmpty()) {
                delete layout;
                layout = new QTextLayout(metrics.elidedText(remaining, Qt::ElideRight, width), font);
                layout->beginLayout();
                layout->createLine().setLineWidth(width);
                layout->endLayout();
                fits = false;
            } else if (first.naturalTextWidth() > width + 0.5) {
                // a single word wider than the cover
                fits = false;
            }
            lines.append(layout);
            remaining = last ? QString() : rest.trimmed();
        }
        if (fits || scale <= 0.45) {
            height = lines.size() * metrics.lineSpacing();
            return lines;
        }
        qDeleteAll(lines);
    }
}

/// the title on a scrim of the ground colour rather than a shadow: it keeps
/// light designs readable without darkening the whole cover
void titleBlock(QPainter &painter, const Design &design, const QString &title, qreal edge)
{
    QFont font(Theme::instance() ? Theme::instance()->fontFamily() : QString());
    font.setWeight(QFont::Black);
    const qreal inset = edge * 0.075;
    qreal textHeight = 0;
    const QList<QTextLayout *> lines = layoutTitle(title.isEmpty() ? QStringLiteral("Playlist") : title, font,
                                                   edge - 2 * inset, edge * 0.115, textHeight);
    const qreal blockHeight = edge * 0.16 + textHeight + inset;
    const qreal top = edge - blockHeight;

    QLinearGradient scrim(0, top, 0, edge);
    scrim.setColorAt(0, withAlpha(ground(design), 0));
    scrim.setColorAt(0.5, withAlpha(ground(design), 0.72));
    scrim.setColorAt(1, withAlpha(ground(design), 0.92));
    painter.fillRect(QRectF(0, top, edge, blockHeight), scrim);

    painter.setPen(ink(design));
    qreal y = top + edge * 0.16;
    for (QTextLayout *line : lines) {
        line->draw(&painter, QPointF(inset, y));
        y += line->boundingRect().height();
    }
    qDeleteAll(lines);
}

QByteArray encodeJpeg(const QImage &image, int quality)
{
    QByteArray data;
    QBuffer buffer(&data);
    buffer.open(QIODevice::WriteOnly);
    image.save(&buffer, "JPG", quality);
    return data;
}

} // namespace

QList<QColor> expandedPalette(const QList<QColor> &colors)
{
    // with no cover to take colours from, the selected theme's, read where
    // the theme lives
    QList<QColor> seeds = colors;
    if (seeds.isEmpty()) {
        const Theme *theme = Theme::instance();
        if (theme && theme->thread() == QThread::currentThread()) {
            const MaterialScheme::Roles &roles = theme->colors()->roles();
            seeds = {roles[std::size_t(MaterialScheme::Role::Primary)], roles[std::size_t(MaterialScheme::Role::Tertiary)]};
        } else {
            seeds = {QColor::fromRgba(Theme::kAccent), kAccentSecondary};
        }
    }
    QList<QColor> palette = seeds;
    for (int step = 0; palette.size() < 5; ++step) {
        palette.append(hueRotated(seeds.at(step % seeds.size()), 0.13 * (step + 1)));
    }
    return palette;
}

QList<Design> designs(const QList<QColor> &colors)
{
    const QList<QColor> base = expandedPalette(colors);
    const Style styles[] = {Style::Pour, Style::Sleeves, Style::Waveform, Style::Orbit, Style::Split};
    QList<Design> result;
    for (int index = 0; index < 5; ++index) {
        for (const bool dark : {true, false}) {
            const int slot = index * 2 + (dark ? 0 : 1);
            const qsizetype offset = slot % base.size();
            result.append({slot, styles[index], base.mid(offset) + base.first(offset), dark});
        }
    }
    return result;
}

void paint(QPainter &painter, const Design &design, const QString &title, qreal edge)
{
    painter.save();
    painter.setRenderHint(QPainter::Antialiasing);
    painter.setClipRect(QRectF(0, 0, edge, edge), Qt::IntersectClip);
    painter.fillRect(QRectF(0, 0, edge, edge), ground(design));
    switch (design.style) {
    case Style::Pour: pour(painter, design, edge); break;
    case Style::Sleeves: sleeves(painter, design, edge); break;
    case Style::Waveform: waveform(painter, design, title, edge); break;
    case Style::Orbit: orbit(painter, design, edge); break;
    case Style::Split: split(painter, design, edge); break;
    }
    titleBlock(painter, design, title, edge);
    painter.restore();
}

QImage render(const Design &design, const QString &title, int edge)
{
    QImage image(edge, edge, QImage::Format_RGB32);
    QPainter painter(&image);
    paint(painter, design, title, edge);
    painter.end();
    return image;
}

QByteArray jpeg(const Design &design, const QString &title)
{
    return encodeJpeg(render(design, title), 86);
}

QByteArray squareJpeg(const QImage &image, QRectF crop, int maximumBytes)
{
    if (crop.isEmpty()) {
        crop = centredSquare(image.size());
    }
    const QRect source = crop.toAlignedRect().intersected(image.rect());
    if (source.isEmpty()) {
        return {};
    }
    // resampled rather than sent at the camera's size: a 12-megapixel crop is
    // several megabytes at any quality worth sending
    const QImage square = image.copy(source)
                              .scaled(kEdge, kEdge, Qt::IgnoreAspectRatio, Qt::SmoothTransformation)
                              .convertToFormat(QImage::Format_RGB32);
    for (const int quality : {85, 70, 55, 40}) {
        const QByteArray encoded = encodeJpeg(square, quality);
        if (!encoded.isEmpty() && encoded.size() <= maximumBytes) {
            return encoded;
        }
    }
    return {};
}

QImage loadPhoto(const QString &path)
{
    QImageReader reader(path);
    // the exif orientation, so a crop measured on screen means the same
    // thing to the encoder
    reader.setAutoTransform(true);
    const QSize size = reader.size();
    constexpr int kLongest = 2048;
    if (size.isValid() && std::max(size.width(), size.height()) > kLongest) {
        reader.setScaledSize(size.scaled(kLongest, kLongest, Qt::KeepAspectRatio));
    }
    return reader.read();
}

qreal displayScale(QSizeF imageSize, qreal viewport, qreal zoom)
{
    const qreal fill = viewport / std::max(1.0, std::min(imageSize.width(), imageSize.height()));
    return fill * zoom;
}

QSizeF clampedOffset(QSizeF proposed, QSizeF imageSize, qreal viewport, qreal zoom)
{
    const qreal unit = displayScale(imageSize, viewport, zoom);
    const qreal limitX = std::max(0.0, (imageSize.width() * unit - viewport) / 2);
    const qreal limitY = std::max(0.0, (imageSize.height() * unit - viewport) / 2);
    return {std::clamp(proposed.width(), -limitX, limitX), std::clamp(proposed.height(), -limitY, limitY)};
}

QRectF cropRect(QSizeF imageSize, qreal viewport, qreal zoom, QSizeF offset)
{
    const qreal unit = displayScale(imageSize, viewport, zoom);
    const qreal side = viewport / unit;
    return {imageSize.width() / 2 - (viewport / 2 + offset.width()) / unit,
            imageSize.height() / 2 - (viewport / 2 + offset.height()) / unit, side, side};
}

QRectF centredSquare(QSizeF size)
{
    const qreal edge = std::min(size.width(), size.height());
    return {(size.width() - edge) / 2, (size.height() - edge) / 2, edge, edge};
}

} // namespace resonance::covers
