#include "artwork/ArtworkColors.h"

#include "artwork/ArtworkCache.h"
#include "artwork/ArtworkPalette.h"

#include <QCache>
#include <QPointer>
#include <QtConcurrent>

namespace resonance {

namespace {

QCache<QUrl, QList<QColor>> &sharedPalettes()
{
    static QCache<QUrl, QList<QColor>> cache(256);
    return cache;
}

} // namespace

void ArtworkColors::setSource(const QUrl &source)
{
    if (m_source == source) {
        return;
    }
    m_source = source;
    emit sourceChanged();

    if (source.isEmpty() || !ArtworkCache::instance()) {
        return;
    }
    if (const QList<QColor> *cached = sharedPalettes().object(source)) {
        m_palette = *cached;
        emit colorsChanged();
        return;
    }
    // the old colours stay until the new ones are ready
    QPointer<ArtworkColors> self(this);
    ArtworkCache::instance()->bytes(source, [self, source](const QByteArray &data) {
        if (!self || data.isEmpty() || self->m_source != source) {
            return;
        }
        QtConcurrent::run([data] { return palette::extract(data); })
            .then(self.data(), [self, source](const std::optional<WeightedPalette> &palette) {
                if (!self || !palette) {
                    return;
                }
                sharedPalettes().insert(source, new QList<QColor>(palette->colors));
                if (self->m_source == source) {
                    self->m_palette = palette->colors;
                    emit self->colorsChanged();
                }
            });
    });
}

} // namespace resonance
