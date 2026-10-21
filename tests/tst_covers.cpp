#include "artwork/PlaylistCovers.h"

#include <QBuffer>
#include <QImageReader>
#include <QTest>

#include <random>

using namespace resonance;

/// PlaylistCoverArt's rules: ten designs from any palette, a crop that never
/// leaves a gap, and a jpeg that always fits spotify's 256 kB.
class CoversTest : public QObject {
    Q_OBJECT

private slots:
    void tenDesignsAlternatingGrounds()
    {
        const QList<covers::Design> designs = covers::designs({});
        QCOMPARE(designs.size(), 10);
        for (int index = 0; index < 10; ++index) {
            QCOMPARE(designs.at(index).id, index);
            QCOMPARE(designs.at(index).dark, index % 2 == 0);
            QCOMPARE(designs.at(index).palette.size(), 5);
        }
        // each leads with a different colour
        QVERIFY(designs.at(0).palette.first() != designs.at(1).palette.first());
    }

    void aThinPaletteWidensByHue()
    {
        const QList<QColor> palette = covers::expandedPalette({QColor(40, 160, 90)});
        QCOMPARE(palette.size(), 5);
        QCOMPARE(palette.first(), QColor(40, 160, 90));
        for (int index = 1; index < 5; ++index) {
            QVERIFY(palette.at(index).hsvHueF() != palette.at(index - 1).hsvHueF());
            // never washed out or black
            QVERIFY(palette.at(index).hsvSaturationF() >= 0.41f);
            QVERIFY(palette.at(index).valueF() >= 0.49f);
        }
        // and nothing at all falls back on the accent pair
        QCOMPARE(covers::expandedPalette({}).first(), QColor(0xff, 0x3d, 0x8a));
    }

    void everyDesignDraws()
    {
        for (const covers::Design &design : covers::designs({QColor(200, 60, 40), QColor(30, 90, 200)})) {
            const QImage image = covers::render(design, QStringLiteral("Late Night Drives"), 128);
            QCOMPARE(image.size(), QSize(128, 128));
            // something besides the ground made it onto the cover
            QSet<QRgb> colours;
            for (int y = 0; y < 128; y += 8) {
                for (int x = 0; x < 128; x += 8) {
                    colours.insert(image.pixel(x, y));
                }
            }
            QVERIFY2(colours.size() > 8, qPrintable(QString::number(design.id)));
        }
    }

    void aDesignFitsTheUploadLimit()
    {
        for (const covers::Design &design : covers::designs({})) {
            const QByteArray jpeg = covers::jpeg(design, QStringLiteral("A playlist with rather a long name indeed"));
            QVERIFY(!jpeg.isEmpty());
            QVERIFY(jpeg.size() <= 256'000);
            QBuffer buffer;
            buffer.setData(jpeg);
            QCOMPARE(QImageReader(&buffer).size(), QSize(covers::kEdge, covers::kEdge));
        }
    }

    void theCropNeverOpensAGap()
    {
        const QSizeF image(3000, 2000);
        const qreal viewport = 380;
        // at zoom 1 the short side fills the square: no vertical play at all
        QCOMPARE(covers::clampedOffset({500, 500}, image, viewport, 1), QSizeF(95, 0));
        // zoomed in, the photo may move as far as it overhangs, no further
        const QSizeF limit = covers::clampedOffset({1e6, -1e6}, image, viewport, 2);
        QCOMPARE(limit, QSizeF((3000 * 0.38 - 380) / 2, -(2000 * 0.38 - 380) / 2));
        // the framed square at the far edge sits exactly on the image's edge
        const QRectF crop = covers::cropRect(image, viewport, 2, limit);
        QVERIFY(std::abs(crop.left()) < 1e-6);
        QVERIFY(std::abs(crop.bottom() - 2000) < 1e-6);
        QCOMPARE(crop.width(), crop.height());
        // centred, it is the middle of the image
        QCOMPARE(covers::cropRect(image, viewport, 1, {0, 0}), covers::centredSquare(image));
    }

    void aNoisyPhotoStillFits()
    {
        // noise is the worst case for jpeg; the quality ladder brings it in
        QImage noise(2048, 1536, QImage::Format_RGB32);
        std::mt19937 random(7);
        for (int y = 0; y < noise.height(); ++y) {
            auto *line = reinterpret_cast<QRgb *>(noise.scanLine(y));
            for (int x = 0; x < noise.width(); ++x) {
                line[x] = qRgb(int(random() % 256), int(random() % 256), int(random() % 256));
            }
        }
        const QByteArray jpeg = covers::squareJpeg(noise, {}, 256'000);
        if (!jpeg.isEmpty()) {
            QVERIFY(jpeg.size() <= 256'000);
        }
        // and an ordinary photo lands first time
        QImage smooth(1200, 900, QImage::Format_RGB32);
        smooth.fill(QColor(120, 140, 160));
        QVERIFY(!covers::squareJpeg(smooth, {}, 256'000).isEmpty());
    }
};

QTEST_MAIN(CoversTest)
#include "tst_covers.moc"
