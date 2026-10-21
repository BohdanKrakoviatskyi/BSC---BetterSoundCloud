#include "app/Settings.h"

#include <QQmlEngine>
#include <QUrl>

#include <algorithm>
#include <initializer_list>

namespace resonance {

namespace {

Settings *s_instance = nullptr;

QString oneOf(const QString &value, std::initializer_list<QString> allowed, const QString &fallback)
{
    return std::find(allowed.begin(), allowed.end(), value) != allowed.end() ? value : fallback;
}

int quality(int kbps, int fallback)
{
    return kbps == 96 || kbps == 160 || kbps == 320 ? kbps : fallback;
}

template <typename T>
T stored(const QSettings &store, const char *key, const T &fallback)
{
    const QVariant value = store.value(QLatin1StringView(key));
    return value.isValid() && value.canConvert<T>() ? value.value<T>() : fallback;
}

} // namespace

Settings::Settings(QObject *parent)
    : QObject(parent)
    , m_store(QSettings::IniFormat, QSettings::UserScope, QStringLiteral("Resonance"),
              QStringLiteral("Resonance"))
{
    if (m_store.allKeys().isEmpty()) {
        const QSettings legacy(QSettings::IniFormat, QSettings::UserScope,
                               QStringLiteral("Swiftify"), QStringLiteral("Swiftify"));
        for (const QString &key : legacy.allKeys()) {
            m_store.setValue(key, legacy.value(key));
        }
        m_store.sync();
    }
    load();
    if (!s_instance) {
        s_instance = this;
    }
}

Settings::Settings(const QString &path, QObject *parent)
    : QObject(parent)
    , m_store(path, QSettings::IniFormat)
{
    load();
    // a test's settings are the ones its views read, never the real file
    if (!s_instance) {
        s_instance = this;
    }
}

Settings::~Settings()
{
    m_store.sync();
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

Settings *Settings::instance()
{
    return s_instance;
}

Settings *Settings::create(QQmlEngine *, QJSEngine *)
{
    QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    return s_instance;
}

QVariant Settings::value(const QString &key, const QVariant &fallback) const
{
    return m_store.value(key, fallback);
}

void Settings::setValue(const QString &key, const QVariant &value)
{
    m_store.setValue(key, value);
}

void Settings::remove(const QString &key)
{
    m_store.remove(key);
}

bool Settings::contains(const QString &key) const
{
    return m_store.contains(key);
}

void Settings::sync()
{
    m_store.sync();
}

void Settings::load()
{
    m_visualizersEnabled = stored<bool>(m_store, "visualizersEnabled", m_visualizersEnabled);
    m_circularVisualizer = stored<bool>(m_store, "circularVisualizer", m_circularVisualizer);
    m_roundArtwork = stored<bool>(m_store, "roundArtwork", m_roundArtwork);
    {
        const QString raw = stored<QString>(m_store, "circularVisualizerShape", m_visualizerShape);
        m_visualizerShape = oneOf(raw, {QStringLiteral("bars"), QStringLiteral("wave")}, QStringLiteral("bars"));
    }
    {
        const double raw = stored<double>(m_store, "visualizerSensitivity", m_visualizerSensitivity);
        m_visualizerSensitivity = std::clamp(raw, 0.6, 1.8);
    }
    {
        const int raw = stored<int>(m_store, "streamingQuality", m_streamingQuality);
        m_streamingQuality = quality(raw, 160);
        const int cache = stored<int>(m_store, "songCacheMegabytes", m_songCacheMegabytes);
        m_songCacheMegabytes = cache == 500 || cache == 2000 ? cache : 1000;
    }
    m_crossfadeEnabled = stored<bool>(m_store, "crossfadeEnabled", m_crossfadeEnabled);
    m_crossfadeDurationSeconds = std::clamp(
        stored<int>(m_store, "crossfadeDurationSeconds", m_crossfadeDurationSeconds), 1, 12);
    m_livingBackdrop = stored<bool>(m_store, "livingBackdrop", m_livingBackdrop);
    {
        const double raw = stored<double>(m_store, "backdropBlur", m_backdropBlur);
        m_backdropBlur = std::clamp(raw, 0.0, 60.0);
    }
    {
        const double raw = stored<double>(m_store, "backdropReactivity", m_backdropReactivity);
        m_backdropReactivity = std::clamp(raw, 0.0, 3.0);
    }
    m_debuggingEnabled = stored<bool>(m_store, "debuggingEnabled", m_debuggingEnabled);
    {
        const QString raw = stored<QString>(m_store, "musicSource", m_musicSource);
        m_musicSource = raw == QLatin1StringView("soundcloud") ? QStringLiteral("soundcloud") : QStringLiteral("spotify");
    }
    m_soundcloudClientId = stored<QString>(m_store, "soundcloudClientId", m_soundcloudClientId);
    m_pinnedPlaylistsExpanded = stored<bool>(m_store, "pinnedPlaylistsExpanded", m_pinnedPlaylistsExpanded);
    m_allPlaylistsExpanded = stored<bool>(m_store, "allPlaylistsExpanded", m_allPlaylistsExpanded);
    {
        const QString raw = stored<QString>(m_store, "immersivePlayerPanel", m_immersivePlayerPanel);
        m_immersivePlayerPanel = oneOf(raw, {QStringLiteral("artwork"), QStringLiteral("lyrics"), QStringLiteral("queue"), QStringLiteral("sleep"), QStringLiteral("audio")}, QStringLiteral("lyrics"));
    }
    {
        const QString raw = stored<QString>(m_store, "sleepTimerFade", m_sleepTimerFade);
        m_sleepTimerFade = oneOf(raw, {QStringLiteral("none"), QStringLiteral("finalSeconds"), QStringLiteral("entire")}, QStringLiteral("finalSeconds"));
    }
    m_reduceMotion = stored<bool>(m_store, "reduceMotion", m_reduceMotion);
    m_performanceMode = stored<bool>(m_store, "performanceMode", m_performanceMode);
    m_noShapes = stored<bool>(m_store, "noShapes", m_noShapes);
    {
        // an unknown theme falls back to the app's own colours in Theme
        const QString raw = stored<QString>(m_store, "themeSource", m_themeSource).trimmed();
        if (!raw.isEmpty()) {
            m_themeSource = raw;
        }
    }
    {
        const QString raw = stored<QString>(m_store, "themeMode", m_themeMode);
        m_themeMode = oneOf(raw, {QStringLiteral("system"), QStringLiteral("light"), QStringLiteral("dark")}, QStringLiteral("system"));
    }
    {
        const QString raw = stored<QString>(m_store, "matugenColorsPath", m_matugenColorsPath);
        m_matugenColorsPath = raw.trimmed();
    }
    m_showWindowControls = stored<bool>(m_store, "showWindowControls", m_showWindowControls);
    m_nativeTitleBar = stored<bool>(m_store, "nativeTitleBar", m_nativeTitleBar);
    m_trayIcon = stored<bool>(m_store, "trayIcon", m_trayIcon);
    m_customBackgroundPath = stored<QString>(m_store, "customBackgroundPath", m_customBackgroundPath);
    {
        const QVariant rawList = m_store.value(QStringLiteral("customBackgrounds"));
        if (rawList.isValid() && rawList.canConvert<QStringList>()) {
            m_customBackgrounds = rawList.toStringList();
        }
        if (!m_customBackgroundPath.isEmpty() && !m_customBackgrounds.contains(m_customBackgroundPath)) {
            m_customBackgrounds.prepend(m_customBackgroundPath);
        }
    }
    {
        const double raw = stored<double>(m_store, "customBackgroundDim", m_customBackgroundDim);
        m_customBackgroundDim = std::clamp(raw, 0.0, 0.95);
    }
}

void Settings::setVisualizersEnabled(bool value)
{
    if (m_visualizersEnabled == value) {
        return;
    }
    m_visualizersEnabled = value;
    m_store.setValue(QStringLiteral("visualizersEnabled"), value);
    emit visualizersEnabledChanged();
}

void Settings::setCircularVisualizer(bool value)
{
    if (m_circularVisualizer == value) {
        return;
    }
    m_circularVisualizer = value;
    m_store.setValue(QStringLiteral("circularVisualizer"), value);
    emit circularVisualizerChanged();
}

void Settings::setRoundArtwork(bool value)
{
    if (m_roundArtwork == value) {
        return;
    }
    m_roundArtwork = value;
    m_store.setValue(QStringLiteral("roundArtwork"), value);
    emit roundArtworkChanged();
}

void Settings::setVisualizerShape(const QString &raw)
{
    const QString value = oneOf(raw, {QStringLiteral("bars"), QStringLiteral("wave")}, QStringLiteral("bars"));
    if (m_visualizerShape == value) {
        return;
    }
    m_visualizerShape = value;
    m_store.setValue(QStringLiteral("circularVisualizerShape"), value);
    emit visualizerShapeChanged();
}

void Settings::setMusicSource(const QString &raw)
{
    const QString value = raw == QLatin1StringView("soundcloud") ? QStringLiteral("soundcloud") : QStringLiteral("spotify");
    if (m_musicSource == value) {
        return;
    }
    m_musicSource = value;
    m_store.setValue(QStringLiteral("musicSource"), value);
    emit musicSourceChanged();
}

void Settings::setSoundcloudClientId(const QString &value)
{
    if (m_soundcloudClientId == value) {
        return;
    }
    m_soundcloudClientId = value;
    m_store.setValue(QStringLiteral("soundcloudClientId"), value);
    emit soundcloudClientIdChanged();
}

void Settings::setVisualizerSensitivity(double raw)
{
    const double value = std::clamp(raw, 0.6, 1.8);
    if (m_visualizerSensitivity == value) {
        return;
    }
    m_visualizerSensitivity = value;
    m_store.setValue(QStringLiteral("visualizerSensitivity"), value);
    emit visualizerSensitivityChanged();
}

void Settings::setStreamingQuality(int raw)
{
    const int value = quality(raw, 160);
    if (m_streamingQuality == value) {
        return;
    }
    m_streamingQuality = value;
    m_store.setValue(QStringLiteral("streamingQuality"), value);
    emit streamingQualityChanged();
}

void Settings::setSongCacheMegabytes(int megabytes)
{
    const int value = megabytes == 500 || megabytes == 2000 ? megabytes : 1000;
    if (m_songCacheMegabytes == value) {
        return;
    }
    m_songCacheMegabytes = value;
    m_store.setValue(QStringLiteral("songCacheMegabytes"), value);
    emit songCacheMegabytesChanged();
}

void Settings::setCrossfadeEnabled(bool value)
{
    if (m_crossfadeEnabled == value) {
        return;
    }
    m_crossfadeEnabled = value;
    m_store.setValue(QStringLiteral("crossfadeEnabled"), value);
    emit crossfadeEnabledChanged();
}

void Settings::setCrossfadeDurationSeconds(int raw)
{
    const int value = std::clamp(raw, 1, 12);
    if (m_crossfadeDurationSeconds == value) {
        return;
    }
    m_crossfadeDurationSeconds = value;
    m_store.setValue(QStringLiteral("crossfadeDurationSeconds"), value);
    emit crossfadeDurationSecondsChanged();
}

void Settings::setLivingBackdrop(bool value)
{
    if (m_livingBackdrop == value) {
        return;
    }
    m_livingBackdrop = value;
    m_store.setValue(QStringLiteral("livingBackdrop"), value);
    emit livingBackdropChanged();
}

void Settings::setBackdropBlur(double raw)
{
    const double value = std::clamp(raw, 0.0, 60.0);
    if (m_backdropBlur == value) {
        return;
    }
    m_backdropBlur = value;
    m_store.setValue(QStringLiteral("backdropBlur"), value);
    emit backdropBlurChanged();
}

void Settings::setBackdropReactivity(double raw)
{
    const double value = std::clamp(raw, 0.0, 3.0);
    if (m_backdropReactivity == value) {
        return;
    }
    m_backdropReactivity = value;
    m_store.setValue(QStringLiteral("backdropReactivity"), value);
    emit backdropReactivityChanged();
}

void Settings::setDebuggingEnabled(bool value)
{
    if (m_debuggingEnabled == value) {
        return;
    }
    m_debuggingEnabled = value;
    m_store.setValue(QStringLiteral("debuggingEnabled"), value);
    emit debuggingEnabledChanged();
}

void Settings::setPinnedPlaylistsExpanded(bool value)
{
    if (m_pinnedPlaylistsExpanded == value) {
        return;
    }
    m_pinnedPlaylistsExpanded = value;
    m_store.setValue(QStringLiteral("pinnedPlaylistsExpanded"), value);
    emit pinnedPlaylistsExpandedChanged();
}

void Settings::setAllPlaylistsExpanded(bool value)
{
    if (m_allPlaylistsExpanded == value) {
        return;
    }
    m_allPlaylistsExpanded = value;
    m_store.setValue(QStringLiteral("allPlaylistsExpanded"), value);
    emit allPlaylistsExpandedChanged();
}

void Settings::setImmersivePlayerPanel(const QString &raw)
{
    const QString value = oneOf(raw, {QStringLiteral("artwork"), QStringLiteral("lyrics"), QStringLiteral("queue"), QStringLiteral("sleep"), QStringLiteral("audio")}, QStringLiteral("lyrics"));
    if (m_immersivePlayerPanel == value) {
        return;
    }
    m_immersivePlayerPanel = value;
    m_store.setValue(QStringLiteral("immersivePlayerPanel"), value);
    emit immersivePlayerPanelChanged();
}

void Settings::setSleepTimerFade(const QString &raw)
{
    const QString value = oneOf(raw, {QStringLiteral("none"), QStringLiteral("finalSeconds"), QStringLiteral("entire")}, QStringLiteral("finalSeconds"));
    if (m_sleepTimerFade == value) {
        return;
    }
    m_sleepTimerFade = value;
    m_store.setValue(QStringLiteral("sleepTimerFade"), value);
    emit sleepTimerFadeChanged();
}

void Settings::setReduceMotion(bool value)
{
    if (m_reduceMotion == value) {
        return;
    }
    m_reduceMotion = value;
    m_store.setValue(QStringLiteral("reduceMotion"), value);
    emit reduceMotionChanged();
}

void Settings::setPerformanceMode(bool value)
{
    if (m_performanceMode == value) {
        return;
    }
    m_performanceMode = value;
    m_store.setValue(QStringLiteral("performanceMode"), value);
    emit performanceModeChanged();
}

void Settings::setNoShapes(bool value)
{
    if (m_noShapes == value) {
        return;
    }
    m_noShapes = value;
    m_store.setValue(QStringLiteral("noShapes"), value);
    emit noShapesChanged();
}

void Settings::setThemeSource(const QString &raw)
{
    const QString value = raw.trimmed();
    if (value.isEmpty() || m_themeSource == value) {
        return;
    }
    m_themeSource = value;
    m_store.setValue(QStringLiteral("themeSource"), value);
    emit themeSourceChanged();
}

void Settings::setThemeMode(const QString &raw)
{
    const QString value = oneOf(raw, {QStringLiteral("system"), QStringLiteral("light"), QStringLiteral("dark")}, QStringLiteral("system"));
    if (m_themeMode == value) {
        return;
    }
    m_themeMode = value;
    m_store.setValue(QStringLiteral("themeMode"), value);
    emit themeModeChanged();
}

void Settings::setMatugenColorsPath(const QString &raw)
{
    const QString value = raw.trimmed();
    if (m_matugenColorsPath == value) {
        return;
    }
    m_matugenColorsPath = value;
    m_store.setValue(QStringLiteral("matugenColorsPath"), value);
    emit matugenColorsPathChanged();
}

void Settings::setShowWindowControls(bool value)
{
    if (m_showWindowControls == value) {
        return;
    }
    m_showWindowControls = value;
    m_store.setValue(QStringLiteral("showWindowControls"), value);
    emit showWindowControlsChanged();
}

void Settings::setNativeTitleBar(bool value)
{
    if (m_nativeTitleBar == value) {
        return;
    }
    m_nativeTitleBar = value;
    m_store.setValue(QStringLiteral("nativeTitleBar"), value);
    emit nativeTitleBarChanged();
}

void Settings::setTrayIcon(bool value)
{
    if (m_trayIcon == value) {
        return;
    }
    m_trayIcon = value;
    m_store.setValue(QStringLiteral("trayIcon"), value);
    emit trayIconChanged();
}

void Settings::setCustomBackgroundPath(const QString &value)
{
    QString cleaned = value.trimmed();
    if (cleaned.startsWith(QLatin1StringView("file://"))) {
        cleaned = QUrl(cleaned).toLocalFile();
    }
    if (m_customBackgroundPath == cleaned) {
        return;
    }
    m_customBackgroundPath = cleaned;
    m_store.setValue(QStringLiteral("customBackgroundPath"), cleaned);
    emit customBackgroundPathChanged();
}

namespace {

/// a stored path as a url qml can load. "file://" + "C:/x.gif" parses the
/// drive letter as a host and opens nothing, so the third slash belongs here.
QUrl backgroundUrlOf(const QString &path)
{
    const QString cleaned = path.trimmed();
    if (cleaned.isEmpty()) {
        return {};
    }
    if (cleaned.startsWith(QLatin1StringView("file://"))
        || cleaned.startsWith(QLatin1StringView("qrc:/"))
        || cleaned.startsWith(QLatin1StringView("http://"))
        || cleaned.startsWith(QLatin1StringView("https://"))) {
        return QUrl(cleaned);
    }
    return QUrl::fromLocalFile(cleaned);
}

} // namespace

QUrl Settings::customBackgroundUrl() const
{
    return backgroundUrlOf(m_customBackgroundPath);
}

QUrl Settings::backgroundUrl(const QString &path) const
{
    return backgroundUrlOf(path);
}

void Settings::setCustomBackgrounds(const QStringList &value)
{
    if (m_customBackgrounds == value) {
        return;
    }
    m_customBackgrounds = value;
    m_store.setValue(QStringLiteral("customBackgrounds"), value);
    emit customBackgroundsChanged();
}

void Settings::setCustomBackgroundDim(double raw)
{
    const double value = std::clamp(raw, 0.0, 0.95);
    if (m_customBackgroundDim == value) {
        return;
    }
    m_customBackgroundDim = value;
    m_store.setValue(QStringLiteral("customBackgroundDim"), value);
    emit customBackgroundDimChanged();
}

void Settings::addCustomBackground(const QString &path)
{
    QString cleaned = path.trimmed();
    if (cleaned.startsWith(QLatin1StringView("file://"))) {
        cleaned = QUrl(cleaned).toLocalFile();
    }
    if (cleaned.isEmpty()) {
        return;
    }
    if (!m_customBackgrounds.contains(cleaned)) {
        m_customBackgrounds.prepend(cleaned);
        m_store.setValue(QStringLiteral("customBackgrounds"), m_customBackgrounds);
        emit customBackgroundsChanged();
    }
    setCustomBackgroundPath(cleaned);
}

void Settings::removeCustomBackground(const QString &path)
{
    QString cleaned = path.trimmed();
    if (cleaned.startsWith(QLatin1StringView("file://"))) {
        cleaned = QUrl(cleaned).toLocalFile();
    }
    if (m_customBackgrounds.removeOne(cleaned)) {
        m_store.setValue(QStringLiteral("customBackgrounds"), m_customBackgrounds);
        emit customBackgroundsChanged();
    }
    if (m_customBackgroundPath == cleaned) {
        clearCustomBackground();
    }
}

void Settings::clearCustomBackground()
{
    if (m_customBackgroundPath.isEmpty()) {
        return;
    }
    m_customBackgroundPath.clear();
    m_store.setValue(QStringLiteral("customBackgroundPath"), QString());
    emit customBackgroundPathChanged();
}

} // namespace resonance
