#pragma once

#include <QElapsedTimer>
#include <QList>
#include <QObject>
#include <QTimer>
#include <QtQml/qqmlregistration.h>

#include <array>

class QQmlEngine;
class QJSEngine;

namespace resonance {

class PlaybackController;
class PlaybackCore;

/// the analyser's 48 bands, polled at 30 hz only while something can show
/// them (AudioSpectrumModel), and the loading pulse while a song loads.
/// visualizers interpolate between polls at the display's own rate.
class SpectrumSource : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Spectrum)
    QML_SINGLETON

    Q_PROPERTY(bool loading READ isLoading NOTIFY loadingChanged FINAL)

public:
    static constexpr int kBands = 48;

    SpectrumSource(PlaybackCore *core, PlaybackController *player, QObject *parent = nullptr);
    ~SpectrumSource() override;

    static SpectrumSource *instance();
    static SpectrumSource *create(QQmlEngine *, QJSEngine *);

    const QList<float> &levels() const { return m_levels; }
    bool isLoading() const { return m_loading; }
    float loadingPhase() const { return m_loadingPhase; }

    /// means of the raw bands over the backdrop's five ranges: sub-bass, bass,
    /// upper bass, vocal and lead
    std::array<float, 5> energies() const;
    /// takes a new set of bands, sanitised; what each poll does
    void publish(const float *levels, int count);

signals:
    void levelsChanged();
    void loadingChanged();

private:
    void updateActivity();
    void poll();
    void tickLoading();
    void clear();

    PlaybackCore *m_core;
    PlaybackController *m_player;
    QList<float> m_levels;
    QTimer m_pollTimer;
    QTimer m_loadingTimer;
    QElapsedTimer m_loadingClock;
    bool m_loading = false;
    float m_loadingPhase = 0;
};

} // namespace resonance
