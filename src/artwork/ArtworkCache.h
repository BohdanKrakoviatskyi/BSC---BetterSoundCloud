#pragma once

#include <QCache>
#include <QHash>
#include <QImage>
#include <QObject>
#include <QQuickAsyncImageProvider>
#include <QUrl>
#include <QCoroTask>

#include <functional>
#include <memory>

class QNetworkAccessManager;

namespace resonance {

/// cover art, fetched once and kept (ArtworkDataRepository.swift).
///
/// encoded bytes come through a disk cache under ~/.cache/Resonance and a small
/// memory cache; requests for the same url share one download. decoded images
/// are cached per size bucket, decoded off the gui thread straight at the size
/// they are shown, never at the full size spotify serves.
class ArtworkCache : public QObject {
    Q_OBJECT

public:
    using BytesCallback = std::function<void(const QByteArray &)>;
    using ImageCallback = std::function<void(const QImage &)>;

    explicit ArtworkCache(QNetworkAccessManager *network, QObject *parent = nullptr);
    ~ArtworkCache() override;

    static ArtworkCache *instance();

    /// `pixels` rounded up to 32, from 32 up to 2048
    static int bucket(int pixels);

    void bytes(const QUrl &url, BytesCallback callback);
    QCoro::Task<QByteArray> bytes(QUrl url);
    /// an image at least `pixels` on its longer side, from memory when there
    void image(const QUrl &url, int pixels, ImageCallback callback);
    /// drops a url whose bytes changed under it, as a playlist cover's does
    void invalidate(const QUrl &url);

private:
    void finishDownload(const QUrl &url, const QByteArray &data);

    QNetworkAccessManager *m_network;
    QCache<QUrl, QByteArray> m_encoded;
    QCache<QString, QImage> m_decoded;
    QHash<QUrl, QList<BytesCallback>> m_downloads;
    QHash<QString, QList<ImageCallback>> m_decodes;
};

/// image://art/<size>/<url> for qml images
class ArtworkImageProvider : public QQuickAsyncImageProvider {
public:
    QQuickImageResponse *requestImageResponse(const QString &id, const QSize &requestedSize) override;
};

} // namespace resonance
