#pragma once

#include <QColor>
#include <QQuickItem>
#include <QtQml/qqmlregistration.h>

#include <memory>

namespace resonance {

struct SymbolGlyph;

/// a material symbols rounded glyph, named by its ligature ("play_arrow"),
/// centred in its box as a Text's would be.
///
/// as a Text every size and set of axes was a font engine of its own, each
/// with its own copy of the font's shaping tables and a glyph texture of its
/// own, and every icon a draw of its own. here a name is shaped once for its
/// axes, its outline filled at the size it shows into one atlas a window, and
/// its colour rides in its vertices: the icons in a window that do not
/// overlap something else between them draw as one.
///
/// fill is outlined or filled, never in between, and the optical size takes
/// four steps rather than every icon size, as before: each step is a shape
/// of its own to fill.
class MaterialSymbolItem : public QQuickItem {
    Q_OBJECT
    QML_NAMED_ELEMENT(MaterialSymbol)

    Q_PROPERTY(QString text READ text WRITE setText NOTIFY textChanged FINAL)
    /// the font's pixel size, in points; drawn at the nearest whole one
    Q_PROPERTY(qreal iconSize READ iconSize WRITE setIconSize NOTIFY iconSizeChanged FINAL)
    /// outlined below a half, filled from it
    Q_PROPERTY(qreal fill READ fill WRITE setFill NOTIFY fillChanged FINAL)
    Q_PROPERTY(int weight READ weight WRITE setWeight NOTIFY weightChanged FINAL)

    /// transparent, and so not drawn, until one is given
    Q_PROPERTY(QColor color READ color WRITE setColor NOTIFY colorChanged FINAL)

public:
    explicit MaterialSymbolItem(QQuickItem *parent = nullptr);
    ~MaterialSymbolItem() override;

    QString text() const { return m_text; }
    void setText(const QString &text);
    qreal iconSize() const { return m_iconSize; }
    void setIconSize(qreal size);
    qreal fill() const { return m_fill; }
    void setFill(qreal fill);
    int weight() const { return m_weight; }
    void setWeight(int weight);

    QColor color() const { return m_color; }
    void setColor(const QColor &color);

signals:
    void textChanged();
    void iconSizeChanged();
    void fillChanged();
    void weightChanged();

    void colorChanged();

protected:
    void updatePolish() override;
    QSGNode *updatePaintNode(QSGNode *node, UpdatePaintNodeData *data) override;
    void itemChange(ItemChange change, const ItemChangeData &data) override;
    void geometryChange(const QRectF &newGeometry, const QRectF &oldGeometry) override;

private:
    /// the glyph is filled again before the next frame
    void reshape();

    QString m_text;
    qreal m_iconSize = 24;
    qreal m_fill = 0;
    int m_weight = 400;

    QColor m_color = Qt::transparent;

    std::shared_ptr<const SymbolGlyph> m_glyph;
    bool m_stale = true;
};

} // namespace resonance
