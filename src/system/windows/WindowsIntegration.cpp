#include "system/windows/WindowsIntegration.h"

#include "playback/PlaybackController.h"
#include "theme/Theme.h"

#include <QApplication>
#include <QImage>
#include <QPlatformSurfaceEvent>
#include <QQuickWindow>
#include <QSet>
#include <QStyle>
#include <QTimer>
#include <QWindow>

#include <windows.h>
#include <windowsx.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <shobjidl.h>

#include <algorithm>
#include <array>
#include <cwchar>

namespace swiftify {

namespace {

constexpr UINT kPrevious = 1;
constexpr UINT kPlayPause = 2;
constexpr UINT kNext = 3;
constexpr DWORD kImmersiveDarkMode = 20;
constexpr DWORD kCornerPreference = 33;
constexpr DWORD kBorderColor = 34;
constexpr DWORD kCaptionColor = 35;
constexpr DWORD kTextColor = 36;

COLORREF nativeColor(const QColor &color)
{
    return RGB(color.red(), color.green(), color.blue());
}

} // namespace

struct WindowsIntegration::Native {
    ITaskbarList3 *taskbar = nullptr;
    UINT taskbarCreated = RegisterWindowMessageW(L"TaskbarButtonCreated");
    bool ownsCom = false;
    bool buttonsAdded = false;
    QSet<quintptr> readyWindows;
    HWND handle = nullptr;
    std::array<HICON, 4> icons {};

    Native()
    {
        ownsCom = SUCCEEDED(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED));
        const std::array<QStyle::StandardPixmap, 4> symbols {
            QStyle::SP_MediaSkipBackward, QStyle::SP_MediaPlay,
            QStyle::SP_MediaPause, QStyle::SP_MediaSkipForward
        };
        for (size_t index = 0; index < symbols.size(); ++index) {
            icons[index] = QApplication::style()->standardIcon(symbols[index]).pixmap(24).toImage().toHICON();
        }
    }

    ~Native()
    {
        if (handle) RemoveWindowSubclass(handle, &Native::windowProcedure, reinterpret_cast<UINT_PTR>(this));
        if (taskbar) {
            taskbar->Release();
        }
        for (HICON icon : icons) {
            if (icon) DestroyIcon(icon);
        }
        if (ownsCom) CoUninitialize();
    }

    static LRESULT CALLBACK windowProcedure(HWND window, UINT message, WPARAM wParam, LPARAM lParam,
                                            UINT_PTR identity, DWORD_PTR context)
    {
        auto *integration = reinterpret_cast<WindowsIntegration *>(context);
        if (message == WM_THEMECHANGED || message == WM_DWMCOMPOSITIONCHANGED || message == WM_STYLECHANGED) {
            QTimer::singleShot(0, integration, &WindowsIntegration::styleWindow);
        }
        if (integration->m_window && !(GetWindowLongPtrW(window, GWL_STYLE) & WS_CAPTION)) {
            if (message == WM_NCCALCSIZE) {
                if (IsZoomed(window)) {
                    auto *bounds = wParam ? &reinterpret_cast<NCCALCSIZE_PARAMS *>(lParam)->rgrc[0]
                                         : reinterpret_cast<RECT *>(lParam);
                    MONITORINFO monitor {sizeof(MONITORINFO)};
                    if (GetMonitorInfoW(MonitorFromRect(bounds, MONITOR_DEFAULTTONEAREST), &monitor)) {
                        *bounds = monitor.rcWork;
                    }
                }
                return 0;
            }
            if (message == WM_NCHITTEST && !IsZoomed(window) && integration->m_window->visibility() != QWindow::FullScreen) {
                RECT bounds {};
                if (GetWindowRect(window, &bounds)) {
                    using WindowDpi = UINT (WINAPI *)(HWND);
                    using MetricsForDpi = int (WINAPI *)(int, UINT);
                    static const auto windowDpi = reinterpret_cast<WindowDpi>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetDpiForWindow"));
                    static const auto metricsForDpi = reinterpret_cast<MetricsForDpi>(GetProcAddress(GetModuleHandleW(L"user32.dll"), "GetSystemMetricsForDpi"));
                    const UINT dpi = windowDpi ? windowDpi(window) : qRound(96 * integration->m_window->devicePixelRatio());
                    const int border = metricsForDpi
                        ? metricsForDpi(SM_CXSIZEFRAME, dpi) + metricsForDpi(SM_CXPADDEDBORDER, dpi)
                        : GetSystemMetrics(SM_CXSIZEFRAME) + GetSystemMetrics(SM_CXPADDEDBORDER);
                    const int horizontal = GET_X_LPARAM(lParam);
                    const int vertical = GET_Y_LPARAM(lParam);
                    const bool left = horizontal >= bounds.left && horizontal < bounds.left + border;
                    const bool right = horizontal < bounds.right && horizontal >= bounds.right - border;
                    const bool top = vertical >= bounds.top && vertical < bounds.top + border;
                    const bool bottom = vertical < bounds.bottom && vertical >= bounds.bottom - border;
                    if (top && left) return HTTOPLEFT;
                    if (top && right) return HTTOPRIGHT;
                    if (bottom && left) return HTBOTTOMLEFT;
                    if (bottom && right) return HTBOTTOMRIGHT;
                    if (left) return HTLEFT;
                    if (right) return HTRIGHT;
                    if (top) return HTTOP;
                    if (bottom) return HTBOTTOM;
                }
            }
        }
        if (message == WM_COMMAND && HIWORD(wParam) == THBN_CLICKED) {
            MSG native {};
            native.hwnd = window;
            native.message = message;
            native.wParam = wParam;
            native.lParam = lParam;
            qintptr result = 0;
            if (integration->nativeEventFilter(QByteArrayLiteral("windows_generic_MSG"), &native, &result)) return result;
        } else if (message == WM_NCDESTROY) {
            RemoveWindowSubclass(window, &Native::windowProcedure, identity);
            integration->m_native->handle = nullptr;
            integration->m_native->buttonsAdded = false;
            integration->m_native->readyWindows.remove(reinterpret_cast<quintptr>(window));
        }
        return DefSubclassProc(window, message, wParam, lParam);
    }
};

void WindowsIntegration::initializeProcess()
{
    SetCurrentProcessExplicitAppUserModelID(L"dev.addenator.Swiftify.Qt");
}

void WindowsIntegration::setNativeTitleBar(QWindow *window, bool enabled)
{
    if (!window) return;
    const Qt::WindowFlags flags = enabled
        ? Qt::Window | Qt::WindowTitleHint | Qt::WindowSystemMenuHint | Qt::WindowMinMaxButtonsHint | Qt::WindowCloseButtonHint
        : Qt::Window | Qt::FramelessWindowHint;
    if (window->flags() == flags) return;
    if (!window->handle() || QGuiApplication::platformName() != QLatin1StringView("windows")) {
        window->setFlags(flags);
        return;
    }
    WINDOWPLACEMENT placement {sizeof(WINDOWPLACEMENT)};
    const bool placed = GetWindowPlacement(reinterpret_cast<HWND>(window->winId()), &placement);
    const auto visibility = window->visibility();
    const auto states = window->windowStates();
    const bool active = window->isActive();
    window->hide();
    window->destroy();
    window->setWindowStates(Qt::WindowNoState);
    window->setFlags(flags);
    window->create();
    if (placed) {
        placement.showCmd = SW_HIDE;
        SetWindowPlacement(reinterpret_cast<HWND>(window->winId()), &placement);
    }
    window->setWindowStates(states);
    window->setVisibility(visibility);
    if (active && window->isVisible()) window->requestActivate();
}

WindowsIntegration::WindowsIntegration(PlaybackController *player, Theme *theme, QObject *parent)
    : QObject(parent), m_player(player), m_theme(theme)
{
    if (QGuiApplication::platformName() != QLatin1StringView("windows")) {
        return;
    }
    m_native = std::make_unique<Native>();
    qApp->installNativeEventFilter(this);
    connect(m_theme, &Theme::schemeChanged, this, &WindowsIntegration::styleWindow);
    connect(m_player, &PlaybackController::playingChanged, this, &WindowsIntegration::updateButtons);
    connect(m_player, &PlaybackController::queueChanged, this, &WindowsIntegration::updateButtons);
    connect(m_player, &PlaybackController::currentSongChanged, this, &WindowsIntegration::updateButtons);
    connect(m_player, &PlaybackController::loadingChanged, this, &WindowsIntegration::updateProgress);
    connect(m_player, &PlaybackController::livePositionChanged, this, &WindowsIntegration::updateProgress);
    connect(m_player, &PlaybackController::durationChanged, this, &WindowsIntegration::updateProgress);
}

WindowsIntegration::~WindowsIntegration()
{
    if (m_native) {
        qApp->removeNativeEventFilter(this);
        if (m_window && m_native->taskbar) {
            m_native->taskbar->SetProgressState(reinterpret_cast<HWND>(m_window->winId()), TBPF_NOPROGRESS);
        }
    }
}

void WindowsIntegration::setWindow(QWindow *window)
{
    if (m_window == window || !m_native) {
        return;
    }
    if (m_window) {
        m_window->removeEventFilter(this);
        disconnect(m_window, nullptr, this, nullptr);
    }
    if (m_native->handle) {
        RemoveWindowSubclass(m_native->handle, &Native::windowProcedure, reinterpret_cast<UINT_PTR>(m_native.get()));
        m_native->handle = nullptr;
    }
    m_window = window;
    m_native->buttonsAdded = false;
    if (!m_window) return;
    m_window->installEventFilter(this);
    m_window->create();
    attachWindow();
    connect(m_window, &QWindow::visibleChanged, this, [this](bool visible) {
        if (visible) {
            styleWindow();
            QTimer::singleShot(0, this, &WindowsIntegration::initializeTaskbar);
        }
    });
    if (auto *quick = qobject_cast<QQuickWindow *>(m_window.data())) {
        connect(quick, &QQuickWindow::colorChanged, this, &WindowsIntegration::styleWindow);
    }
    styleWindow();
    QTimer::singleShot(0, this, &WindowsIntegration::initializeTaskbar);
}

void WindowsIntegration::attachWindow()
{
    if (!m_window || !m_native || !m_window->handle()) return;
    const HWND handle = reinterpret_cast<HWND>(m_window->winId());
    if (m_native->handle == handle) return;
    if (m_native->handle) {
        RemoveWindowSubclass(m_native->handle, &Native::windowProcedure, reinterpret_cast<UINT_PTR>(m_native.get()));
    }
    m_native->handle = nullptr;
    m_native->buttonsAdded = false;
    if (SetWindowSubclass(handle, &Native::windowProcedure, reinterpret_cast<UINT_PTR>(m_native.get()),
                          reinterpret_cast<DWORD_PTR>(this))) {
        m_native->handle = handle;
    }
}

bool WindowsIntegration::eventFilter(QObject *watched, QEvent *event)
{
    if (watched == m_window && event->type() == QEvent::PlatformSurface) {
        const auto *surface = static_cast<QPlatformSurfaceEvent *>(event);
        if (surface->surfaceEventType() == QPlatformSurfaceEvent::SurfaceCreated) {
            styleWindow();
            QTimer::singleShot(0, this, &WindowsIntegration::initializeTaskbar);
        }
    }
    return QObject::eventFilter(watched, event);
}

void WindowsIntegration::styleWindow()
{
    if (!m_window || !m_native || !m_window->handle()) return;
    attachWindow();
    const HWND handle = reinterpret_cast<HWND>(m_window->winId());
    if (m_window->flags().testFlag(Qt::FramelessWindowHint) && m_window->visibility() != QWindow::FullScreen) {
        const LONG_PTR current = GetWindowLongPtrW(handle, GWL_STYLE);
        const LONG_PTR desired = (current | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU) & ~WS_CAPTION;
        if (current != desired) {
            SetWindowLongPtrW(handle, GWL_STYLE, desired);
            SetWindowPos(handle, nullptr, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }
    const auto *quick = qobject_cast<QQuickWindow *>(m_window.data());
    const QColor background = quick ? quick->color() : m_theme->colors()->layer0();
    const BOOL dark = background.lightnessF() < 0.5;
    const DWORD corners = 2;
    const COLORREF border = 0xfffffffe;
    const COLORREF caption = nativeColor(background);
    const COLORREF text = dark ? RGB(255, 255, 255) : RGB(0, 0, 0);
    DwmSetWindowAttribute(handle, kImmersiveDarkMode, &dark, sizeof(dark));
    DwmSetWindowAttribute(handle, kCornerPreference, &corners, sizeof(corners));
    DwmSetWindowAttribute(handle, kBorderColor, &border, sizeof(border));
    DwmSetWindowAttribute(handle, kCaptionColor, &caption, sizeof(caption));
    DwmSetWindowAttribute(handle, kTextColor, &text, sizeof(text));
}

void WindowsIntegration::initializeTaskbar()
{
    if (!m_window || !m_native || !m_window->isVisible()) return;
    if (!m_native->readyWindows.contains(quintptr(m_window->winId()))) return;
    if (!m_native->taskbar) {
        if (FAILED(CoCreateInstance(CLSID_TaskbarList, nullptr, CLSCTX_INPROC_SERVER,
                                    IID_ITaskbarList3, reinterpret_cast<void **>(&m_native->taskbar)))) {
            return;
        }
        if (FAILED(m_native->taskbar->HrInit())) {
            m_native->taskbar->Release();
            m_native->taskbar = nullptr;
            return;
        }
    }
    updateButtons();
}

void WindowsIntegration::updateButtons()
{
    if (!m_window || !m_native || !m_native->taskbar || !m_window->isVisible()) return;
    const HWND handle = reinterpret_cast<HWND>(m_window->winId());
    std::array<THUMBBUTTON, 3> buttons {};
    const std::array<HICON, 3> icons {
        m_native->icons[0], m_native->icons[m_player->isPlaying() ? 2 : 1], m_native->icons[3]
    };
    const std::array<const wchar_t *, 3> tips {
        L"Previous", m_player->isPlaying() ? L"Pause" : L"Play", L"Next"
    };
    const std::array<bool, 3> enabled {
        m_player->hasSong(), m_player->hasSong(), m_player->canSkipForward()
    };
    for (size_t index = 0; index < buttons.size(); ++index) {
        buttons[index].dwMask = THB_ICON | THB_TOOLTIP | THB_FLAGS;
        buttons[index].iId = UINT(index) + 1;
        buttons[index].hIcon = icons[index];
        buttons[index].dwFlags = enabled[index] ? THBF_ENABLED : THBF_DISABLED;
        std::wcsncpy(buttons[index].szTip, tips[index], std::size(buttons[index].szTip) - 1);
    }
    if (!m_native->buttonsAdded) {
        m_native->buttonsAdded = SUCCEEDED(m_native->taskbar->ThumbBarAddButtons(handle, UINT(buttons.size()), buttons.data()));
    } else {
        m_native->taskbar->ThumbBarUpdateButtons(handle, UINT(buttons.size()), buttons.data());
    }
    const Song song = m_player->currentSong();
    const QString tooltip = m_player->hasSong() ? song.name + QStringLiteral(" — ") + song.artists : QStringLiteral("Resonance");
    m_native->taskbar->SetThumbnailTooltip(handle, reinterpret_cast<LPCWSTR>(tooltip.utf16()));
    updateProgress();
}

void WindowsIntegration::updateProgress()
{
    if (!m_window || !m_native || !m_native->taskbar || !m_window->isVisible()) return;
    const HWND handle = reinterpret_cast<HWND>(m_window->winId());
    if (!m_player->hasSong()) {
        m_native->taskbar->SetProgressState(handle, TBPF_NOPROGRESS);
    } else if (m_player->isLoading()) {
        m_native->taskbar->SetProgressState(handle, TBPF_INDETERMINATE);
    } else if (m_player->durationMs() > 0) {
        m_native->taskbar->SetProgressState(handle, m_player->isPlaying() ? TBPF_NORMAL : TBPF_PAUSED);
        m_native->taskbar->SetProgressValue(handle,
            std::min<quint64>(m_player->livePositionMs(), m_player->durationMs()), m_player->durationMs());
    } else {
        m_native->taskbar->SetProgressState(handle, TBPF_NOPROGRESS);
    }
}

bool WindowsIntegration::nativeEventFilter(const QByteArray &eventType, void *message, qintptr *result)
{
    if (!m_native || (eventType != "windows_generic_MSG" && eventType != "windows_dispatcher_MSG")) return false;
    const auto *native = static_cast<MSG *>(message);
    if (m_native->taskbarCreated && native->message == m_native->taskbarCreated) {
        m_native->readyWindows.insert(reinterpret_cast<quintptr>(native->hwnd));
        if (!m_window || !m_window->handle() || native->hwnd != reinterpret_cast<HWND>(m_window->winId())) return false;
        m_native->buttonsAdded = false;
        if (m_native->taskbar) {
            m_native->taskbar->Release();
            m_native->taskbar = nullptr;
        }
        initializeTaskbar();
        return false;
    }
    if (!m_window || !m_window->handle() || native->hwnd != reinterpret_cast<HWND>(m_window->winId())) return false;
    if (native->message == WM_COMMAND && HIWORD(native->wParam) == THBN_CLICKED) {
        switch (LOWORD(native->wParam)) {
        case kPrevious: m_player->skipBackward(); break;
        case kPlayPause: m_player->togglePlayback(); break;
        case kNext: m_player->skipForward(); break;
        default: return false;
        }
        *result = 0;
        return true;
    }
    return false;
}

} // namespace swiftify
