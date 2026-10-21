#pragma once

#include <QColor>
#include <QQuickItem>
#include <QVector2D>
#include <QtQml/qqmlregistration.h>

namespace resonance {

/// a rounded rectangle's soft shadow or glow, drawn as qt quick effects'
/// RectangularShadow draws one: solid over the rectangle and fading out to
/// nothing `blur` pixels past its edge.
///
/// as a RectangularShadow every one was an effect of its own and a draw of
/// its own, and a shelf of cards drew a shadow under each. here all a
/// shadow's particulars ride in its vertices, so the scene graph draws the
/// shadows that do not overlap something between them as one.
class SoftShadowItem : public QQuickItem {
    Q_OBJECT
    QML_NAMED_ELEMENT(SoftShadow)

    Q_PROPERTY(qreal radius READ radius WRITE setRadius NOTIFY radiusChanged FINAL)
    /// how far past the edge it fades out, in pixels
    Q_PROPERTY(qreal blur READ blur WRITE setBlur NOTIFY blurChanged FINAL)
    /// how far it is moved from the rectangle it falls from
    Q_PROPERTY(QVector2D offset READ offset WRITE setOffset NOTIFY offsetChanged FINAL)
    Q_PROPERTY(QColor color READ color WRITE setColor NOTIFY colorChanged FINAL)

public:
    explicit SoftShadowItem(QQuickItem *parent = nullptr);

    qreal radius() const { return m_radius; }
    void setRadius(qreal radius);
    qreal blur() const { return m_blur; }
    void setBlur(qreal blur);
    QVector2D offset() const { return m_offset; }
    void setOffset(const QVector2D &offset);
    QColor color() const { return m_color; }
    void setColor(const QColor &color);

signals:
    void radiusChanged();
    void blurChanged();
    void offsetChanged();
    void colorChanged();

protected:
    QSGNode *updatePaintNode(QSGNode *node, UpdatePaintNodeData *data) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;

private:
    qreal m_radius = 0;
    qreal m_blur = 10;
    QVector2D m_offset;
    QColor m_color = Qt::black;
};

} // namespace resonance
