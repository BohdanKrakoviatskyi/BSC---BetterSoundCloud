#pragma once

#include <QColor>
#include <QImage>
#include <QList>

#include <optional>

namespace resonance {

/// colours taken from a cover, and how much of the cover each stands for
/// (fractions summing to 1; a colour derived to fill out the set stands for none).
struct WeightedPalette {
    QList<QColor> colors;
    QList<double> weights;
};

/// ArtworkPalette.swift: five colours for the backdrop, the bars and the
/// glows. the lead colour is what the cover is mostly made of; the rest are the
/// strongest colours unlike everything already picked.
namespace palette {

constexpr int kDesiredCount = 5;

std::optional<WeightedPalette> extract(const QImage &cover);
/// decodes `encoded` at thumbnail size first, which is all the palette needs
std::optional<WeightedPalette> extract(const QByteArray &encoded);

} // namespace palette
} // namespace resonance
