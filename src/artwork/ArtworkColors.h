#pragma once

#include <QColor>
#include <QList>
#include <QObject>
#include <QUrl>
#include <QtQml/qqmlregistration.h>

namespace resonance {

/// the palette of any cover, for the glows behind header artwork. palettes are
/// shared through a cache of 256, as ArtworkAmbience.swift keeps them.
class ArtworkColors : public QObject {
    Q_OBJECT
    QML_ELEMENT

    Q_PROPERTY(QUrl source READ source WRITE setSource NOTIFY sourceChanged FINAL)
    Q_PROPERTY(bool ready READ isReady NOTIFY colorsChanged FINAL)
    Q_PROPERTY(QColor primary READ primary NOTIFY colorsChanged FINAL)
    Q_PROPERTY(QColor secondary READ secondary NOTIFY colorsChanged FINAL)
    Q_PROPERTY(QList<QColor> palette READ palette NOTIFY colorsChanged FINAL)

public:
    using QObject::QObject;

    QUrl source() const { return m_source; }
    void setSource(const QUrl &source);
    bool isReady() const { return !m_palette.isEmpty(); }
    QColor primary() const { return m_palette.value(0, QColor(0xff, 0x3d, 0x8a)); }
    QColor secondary() const { return m_palette.value(1, QColor(0xd6, 0x24, 0x6c)); }
    QList<QColor> palette() const { return m_palette; }

signals:
    void sourceChanged();
    void colorsChanged();

private:
    QUrl m_source;
    QList<QColor> m_palette;
};

} // namespace resonance
