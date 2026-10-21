#pragma once

#include <QDateTime>
#include <QHash>
#include <QObject>

#include <cstdint>

struct pa_context;
struct pa_server_info;
struct pa_sink_info;
struct pa_threaded_mainloop;

namespace resonance {

/// watches pulseaudio (pipewire-pulse) for the output going away or arriving.
///
/// on linux the core does not notice headphones being pulled: pipewire just
/// moves the stream to the speakers. the mac app's rule still holds, so here
/// the default sink disappearing, or its active port (the headphone jack)
/// becoming unavailable, counts as the output being lost. a new sink or port
/// counts as one arriving, which some devices follow with a "play".
class AudioDeviceMonitor : public QObject {
    Q_OBJECT

public:
    explicit AudioDeviceMonitor(QObject *parent = nullptr);
    ~AudioDeviceMonitor() override;

signals:
    void outputLost();
    void outputArrived();

private:
    struct Sink {
        QString name;
        QString activePort;
        bool activePortAvailable = true;
    };

    static void onContextState(pa_context *context, void *self);
    static void onSubscription(pa_context *context, int type, uint32_t index, void *self);
    static void onServerInfo(pa_context *context, const pa_server_info *info, void *self);
    static void onSinkInfo(pa_context *context, const pa_sink_info *info, int endOfList, void *self);
    static void onInitialSinkInfo(pa_context *context, const pa_sink_info *info, int endOfList, void *self);

    // these run on pulseaudio's thread and only touch the state below it
    void serverInfo(const pa_server_info *info);
    void sinkInfo(const pa_sink_info *info, bool initial);
    void sinkRemoved(uint32_t index);
    void notifyLost();
    void notifyArrived();

    pa_threaded_mainloop *m_mainloop = nullptr;
    pa_context *m_context = nullptr;

    QHash<uint32_t, Sink> m_sinks;
    QString m_defaultSink;
    /// pipewire can name a new default before it removes the old one
    QString m_previousDefaultSink;
    QDateTime m_defaultChangedAt;
};

} // namespace resonance
