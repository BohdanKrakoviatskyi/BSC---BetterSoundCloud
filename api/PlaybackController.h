#pragma once

#include "core/Async.h"
#include "library/SongListModel.h"
#include "playback/InteractionState.h"
#include "playback/Lyrics.h"
#include "spotify/SpotifyTypes.h"

#include <QDateTime>
#include <QDeadlineTimer>
#include <QObject>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <limits>
#include <optional>

class QQmlEngine;
class QJSEngine;

namespace resonance {

namespace lyrics { class LyricsManager; }

class ErrorCenter;
class PlaybackCore;
class Settings;
class SpotifySession;
class SoundCloud;
class YouTubeMusic;

/// the player: queue, transport, volume, lyrics and the sleep timer. the
/// transport half of PlayerModel.swift, with the same rule underneath it all:
/// nothing but a person pressing play, choosing a song, or a queue that is
/// already playing may start sound.
class PlaybackController : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Player)
    Q_CLASSINFO("RegisterEnumClassesUnscoped", "false")
    QML_SINGLETON

    Q_PROPERTY(resonance::Song currentSong READ currentSong NOTIFY currentSongChanged FINAL)
    Q_PROPERTY(bool hasSong READ hasSong NOTIFY currentSongChanged FINAL)
    /// how long the crossfade into the current song lasts, 0 when it started without one
    Q_PROPERTY(int crossfadeMs READ crossfadeMs NOTIFY currentSongChanged FINAL)
    Q_PROPERTY(bool playing READ isPlaying NOTIFY playingChanged FINAL)
    Q_PROPERTY(bool loading READ isLoading NOTIFY loadingChanged FINAL)
    /// whole seconds' worth of change only, or a jump back
    Q_PROPERTY(int positionMs READ positionMs NOTIFY positionChanged FINAL)
    Q_PROPERTY(quint32 livePositionMs READ livePositionMs NOTIFY livePositionChanged FINAL)
    Q_PROPERTY(int durationMs READ durationMs NOTIFY durationChanged FINAL)
    Q_PROPERTY(double volume READ volume WRITE setVolume NOTIFY volumeChanged FINAL)
    Q_PROPERTY(bool shuffle READ isShuffleEnabled NOTIFY shuffleChanged FINAL)
    Q_PROPERTY(RepeatMode repeatMode READ repeatMode NOTIFY repeatModeChanged FINAL)
    Q_PROPERTY(bool canSkipBackward READ canSkipBackward NOTIFY queueChanged FINAL)
    Q_PROPERTY(bool canSkipForward READ canSkipForward NOTIFY queueChanged FINAL)
    Q_PROPERTY(resonance::SongListModel *upNext READ upNext CONSTANT FINAL)


    Q_PROPERTY(resonance::LyricsModel *lyrics READ lyrics CONSTANT FINAL)
    Q_PROPERTY(bool hasLyrics READ hasLyrics NOTIFY lyricsChanged FINAL)
    Q_PROPERTY(bool lyricsSynchronized READ lyricsSynchronized NOTIFY lyricsChanged FINAL)
    Q_PROPERTY(QString lyricsProvider READ lyricsProvider NOTIFY lyricsChanged FINAL)
    Q_PROPERTY(bool loadingLyrics READ isLoadingLyrics NOTIFY lyricsChanged FINAL)
    Q_PROPERTY(QString lyricsMessage READ lyricsMessage NOTIFY lyricsChanged FINAL)
    Q_PROPERTY(int activeLyricIndex READ activeLyricIndex NOTIFY activeLyricIndexChanged FINAL)
    Q_PROPERTY(int lyricsSource READ lyricsSource NOTIFY lyricsSourceChanged FINAL)
    Q_PROPERTY(int lyricsOffsetMs READ lyricsOffsetMs NOTIFY lyricsOffsetChanged FINAL)
    Q_PROPERTY(bool lyricsOffsetSaved READ lyricsOffsetSaved NOTIFY lyricsOffsetChanged FINAL)

    Q_PROPERTY(bool showingLyrics READ isShowingLyrics WRITE setShowingLyrics NOTIFY panelsChanged FINAL)
    Q_PROPERTY(bool showingQueue READ isShowingQueue WRITE setShowingQueue NOTIFY panelsChanged FINAL)

    Q_PROPERTY(bool sleepTimerRunning READ isSleepTimerRunning NOTIFY sleepTimerChanged FINAL)
    Q_PROPERTY(QDateTime sleepTimerDeadline READ sleepTimerDeadline NOTIFY sleepTimerChanged FINAL)
    /// the running timer's whole length in seconds, for how much is left
    Q_PROPERTY(double sleepTimerDuration READ sleepTimerDuration NOTIFY sleepTimerChanged FINAL)
    Q_PROPERTY(bool volumeManagedBySleepTimer READ isVolumeManagedBySleepTimer NOTIFY sleepTimerChanged FINAL)

    /// the core is analysing audio for the visualizers

    /// a window showing visualizers is on screen and not covered
    Q_PROPERTY(bool visualizerPresentationActive READ isVisualizerPresentationActive WRITE setVisualizerPresentationActive NOTIFY analysisActiveChanged FINAL)

public:
    enum class RepeatMode { Off, All, One };
    Q_ENUM(RepeatMode)

    PlaybackController(PlaybackCore *core, SpotifySession *session, Settings *settings, ErrorCenter *errors,
                       QObject *parent = nullptr);
    ~PlaybackController() override;

    static PlaybackController *instance();
    static PlaybackController *create(QQmlEngine *, QJSEngine *);

    Song currentSong() const { return m_currentSong.value_or(Song {}); }
    bool hasSong() const { return m_currentSong.has_value(); }
    int crossfadeMs() const { return int(m_crossfadeMs); }
    /// what is left of the crossfade into the current song
    int crossfadeRemainingMs() const;
    bool isPlaying() const { return m_playing; }
    bool isLoading() const { return m_loading; }
    int positionMs() const { return int(m_publishedPositionMs); }
    /// where playback really is, polled four times a second
    quint32 livePositionMs() const { return m_livePositionMs; }
    int durationMs() const { return int(m_durationMs); }
    double volume() const { return m_volume; }
    bool isShuffleEnabled() const { return m_shuffle; }
    RepeatMode repeatMode() const { return m_repeatMode; }
    bool canSkipBackward() const;
    bool canSkipForward() const;
    SongListModel *upNext() const { return m_upNext; }

    QList<Song> upNextSongs() const;
    QList<Song> previouslyPlayedSongs() const;
    std::optional<Song> upcomingSong() const;
    std::optional<Song> precedingSong() const;
    /// the queue in play order, shuffled or not, for the media session
    const QList<Song> &activeQueue() const;
    int currentQueueIndex() const;

    LyricsModel *lyrics() const { return m_lyricsModel; }
    bool hasLyrics() const { return m_lyrics.has_value(); }
    bool lyricsSynchronized() const { return m_lyrics && m_lyrics->synchronized; }
    QString lyricsProvider() const { return m_lyrics ? m_lyrics->provider : QString(); }
    bool isLoadingLyrics() const { return m_loadingLyrics; }
    QString lyricsMessage() const { return m_lyricsMessage; }
    int activeLyricIndex() const { return m_activeLyricIndex; }
    int lyricsSource() const { return m_lyricsSource; }
    int lyricsOffsetMs() const { return m_lyricsOffsetMs; }
    bool lyricsOffsetSaved() const;

    bool isShowingLyrics() const { return m_showingLyrics; }
    bool isShowingQueue() const { return m_showingQueue; }
    void setShowingLyrics(bool showing);
    void setShowingQueue(bool showing);

    bool isSleepTimerRunning() const { return m_sleepTimerDeadline.isValid(); }
    QDateTime sleepTimerDeadline() const { return m_sleepTimerDeadline; }
    double sleepTimerDuration() const { return m_sleepTimerDurationSeconds; }
    bool isVolumeManagedBySleepTimer() const;

    bool isAnalysisActive() const { return m_analysisActive; }
    bool isLoadingPulseVisible() const { return m_visualizersEnabled && m_presentationActive; }
    bool isVisualizerPresentationActive() const { return m_presentationActive; }
    void setVisualizerPresentationActive(bool active);

    // --- actions ---------------------------------------------------------------

    /// plays `song` with `queue` as what follows; a song outside the queue
    /// plays on its own.
    void play(const Song &song, const QList<Song> &queue, bool fromSearch = false);
    /// plays row `index` of a list, with the list as the queue
    Q_INVOKABLE void playFromModel(resonance::SongListModel *model, int index, bool fromSearch = false);
    /// plays the list from a random song with shuffle on
    Q_INVOKABLE void shufflePlay(resonance::SongListModel *model);
    Q_INVOKABLE void playSong(const resonance::Song &song);
    /// debugging: plays a song whose load never finishes, so the loading
    /// animation of every visualizer can be watched for as long as wanted.
    /// it waits as a real load does, until paused, skipped or replaced
    Q_INVOKABLE void playLoadingTest();
    /// the never-loading song's uri
    static constexpr auto kLoadingTestUri = "resonance:debug:loading";
    Q_INVOKABLE void playNext(const resonance::Song &song);
    Q_INVOKABLE void playLast(const resonance::Song &song);
    /// songs of one's own whose files now say something else (an edit of
    /// their tags): the ones queued, playing or played take it on, each
    /// staying the occurrence it was
    void refreshSongDetails(const QList<Song> &fresh);
    Q_INVOKABLE void playFromQueue(const resonance::Song &song);
    Q_INVOKABLE void togglePlayback();
    Q_INVOKABLE void pause();
    /// play from where it is, rebuilding the output or reloading as needed
    Q_INVOKABLE void resume();
    Q_INVOKABLE void skipForward();
    /// restarts the song when more than 3 s in, otherwise goes back one
    Q_INVOKABLE void skipBackward();
    /// always leaves the current song
    Q_INVOKABLE void skipToPreviousSong();
    Q_INVOKABLE void seek(int positionMs);
    Q_INVOKABLE void seekBy(int offsetMs);
    Q_INVOKABLE void setVolume(double volume);
    Q_INVOKABLE void adjustVolume(double delta);
    Q_INVOKABLE void toggleMute();
    Q_INVOKABLE void toggleShuffle();
    Q_INVOKABLE void cycleRepeatMode();
    Q_INVOKABLE void toggleLyricsPanel();
    Q_INVOKABLE void toggleQueuePanel();
    Q_INVOKABLE void seekToLyricLine(int index);
    Q_INVOKABLE void setLyricsSource(int source);
    Q_INVOKABLE void adjustLyricsOffset(int deltaMs);
    Q_INVOKABLE void setLyricsOffsetMs(int offsetMs);
    Q_INVOKABLE void saveLyricsOffset();
    Q_INVOKABLE void startSleepTimer(int seconds, const QString &fade);
    Q_INVOKABLE void cancelSleepTimer();

    /// the system took the audio device away. stop, and rebuild the output
    /// only when someone presses play again.
    void invalidateAudioOutput();
    /// the machine is about to suspend
    void prepareForSleep();

    void attachSoundCloud(SoundCloud *soundcloud);
    void attachYouTubeMusic(YouTubeMusic *youtubeMusic);

signals:
    void currentSongChanged();
    void playingChanged();
    void loadingChanged();
    void positionChanged();
    void livePositionChanged();
    void durationChanged();
    void volumeChanged();
    void shuffleChanged();
    void repeatModeChanged();
    void queueChanged();
    void lyricsChanged();
    void activeLyricIndexChanged();
    void lyricsSourceChanged();
    void lyricsOffsetChanged();
    void panelsChanged();
    void sleepTimerChanged();
    void analysisActiveChanged();
    /// a song started from search results, for the search history
    void playedFromSearch(const resonance::Song &song);
    /// state the system media session reflects changed
    void mediaStateChanged();

private:
    void beginPlayback(const Song &song, const QList<Song> &queue, bool fromSearch);
    void startPlayback(const Song &song, bool recordHistory = true, bool fromSearch = false,
                       quint32 crossfadeDurationMs = 0);
    QCoro::Task<> runStartPlayback(Song song, CancelToken token, bool fromSearch, quint32 crossfadeDurationMs);
    QCoro::Task<> runResume(CancelToken token);
    QCoro::Task<> restartAudioOutput(CancelToken token);
    QCoro::Task<> runLoadLyrics(Song song, CancelToken token);
    void cancelPlaybackRequest();
    void silenceWithdrawnPlayback();
    void handleEndOfTrack();
    void pollPlayback();
    void syncPositionAndDuration();
    void stopIfAudioOutputStalled();
    bool isPlaybackAtEnd() const;
    void loadLyrics(const Song &song);
    void clearLyrics();
    void updateActiveLyricLine();
    void loadOnlineLyrics(const Song &song);
    void sleepTimerTick();
    void updatePlaybackWorkers();
    void rebuildShuffledQueue(const std::optional<Song> &startingWith);
    std::optional<Song> nextQueueSong(bool allowWrap) const;
    void queueDidChange();
    void preloadNextTrack();
    void syncMediaSession();
    void reset();
    bool isCurrent(const Song &song) const { return m_currentSong && m_currentSong->isSameInstance(song); }
    void setCurrentSong(const std::optional<Song> &song, quint32 crossfadeMs = 0);
    void setPlaying(bool playing);
    void setLoading(bool loading);
    void setLivePosition(quint32 positionMs);
    void setDuration(quint32 durationMs);
    void setStatus(const QString &status);
    void reportError(const QString &context, const QString &message);

    PlaybackCore *m_core;
    SpotifySession *m_session;
    Settings *m_settings;
    ErrorCenter *m_errors;

    QList<Song> m_queue;
    QList<Song> m_shuffledQueue;
    QList<Song> m_history;
    std::optional<Song> m_currentSong;
    SongListModel *m_upNext;


    /// whatever is asking the core to make sound right now: a song loading, a
    /// resume, an output rebuild. empty once it finished or was withdrawn.
    TaskSlot m_playbackRequest;
    bool m_playbackNeedsLoad = false;
    bool m_audioOutputNeedsRestart = false;
    bool m_playing = false;
    bool m_loading = false;
    quint32 m_livePositionMs = 0;
    quint32 m_publishedPositionMs = 0;
    quint32 m_durationMs = 0;
    quint32 m_lastSyncedMediaPosition = std::numeric_limits<quint32>::max();
    quint64 m_crossfadeSerial = 0;
    bool m_crossfadeStarted = false;
    quint32 m_crossfadeMs = 0;
    QDeadlineTimer m_crossfadeDeadline;
    QTimer m_pollTimer;

    double m_volume = 0.75;
    double m_volumeBeforeMute = 0.75;
    bool m_shuffle = false;
    RepeatMode m_repeatMode = RepeatMode::Off;

    LyricsModel *m_lyricsModel;
    lyrics::LyricsManager *m_onlineLyrics = nullptr;
    int m_lyricsSource = 0;
    int m_lyricsOffsetMs = 0;
    std::optional<Lyrics> m_lyrics;
    std::optional<Lyrics> m_plainFallback;
    TaskSlot m_lyricsRequest;
    bool m_loadingLyrics = false;
    QString m_lyricsMessage;
    int m_activeLyricIndex = -1;
    bool m_showingLyrics = true;
    bool m_showingQueue = false;

    QTimer m_sleepTimer;
    QDateTime m_sleepTimerDeadline;
    double m_sleepTimerDurationSeconds = 0;
    double m_volumeBeforeSleepTimer = -1;
    SleepFade m_sleepFade = SleepFade::None;

    bool m_visualizersEnabled = true;
    SoundCloud *m_soundcloud = nullptr;
    YouTubeMusic *m_youtubeMusic = nullptr;
    bool m_presentationActive = true;
    bool m_analysisActive = false;
    bool m_loadingPulseWasVisible = true;


};

} // namespace resonance
