#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QUrl>

#include <memory>

namespace resonance {

class ArtworkCache;
class PlaybackController;

/// the player in macos's now playing (control centre, the menu bar's now
/// playing item, the lock screen) and on the media keys and headphone
/// buttons, through the MediaPlayer framework. the job
/// SystemMediaSession.swift does in the swift app and Mpris does on linux.
class NowPlaying : public QObject {
    Q_OBJECT

public:
    NowPlaying(PlaybackController *player, ArtworkCache *artwork, QObject *parent = nullptr);
    ~NowPlaying() override;

private:
    struct Native;

    void update();
    /// a seek moves the position by more than playback would have
    void checkForJump();
    void loadArtwork(const QUrl &url);

    PlaybackController *m_player;
    ArtworkCache *m_artwork;
    std::unique_ptr<Native> m_native;
    QUrl m_artworkUrl;
    // where the position stood at the last update, and since when, so a seek
    // can be told from the clock running on
    qint64 m_publishedPositionMs = 0;
    QElapsedTimer m_publishedAt;
    bool m_publishedPlaying = false;
};

} // namespace resonance
