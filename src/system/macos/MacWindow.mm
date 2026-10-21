#include "system/macos/MacWindow.h"

#include <QGuiApplication>

#include <QColorSpace>
#include <QLoggingCategory>
#include <QWindow>

#import <AppKit/AppKit.h>
#import <QuartzCore/CAMetalLayer.h>
#import <objc/message.h>

Q_LOGGING_CATEGORY(lcMacWindow, "resonance.window")

/// a window's colour space, as its qt view reports it: whatever the window's
/// own is, with that one's profile kept until the window changes colour
/// space, rather than copied out of colorsync on every call.
///
/// the profile it gives is a compact one, qt's own for sRGB or display p3.
/// qt parses it into the window's format on every frame it asks for, only
/// to read the swap interval there, and parsing the display's own (four
/// kilobytes, its curves 1024 points each) was a fifth of the main thread's
/// time a frame. the layer takes its colour space from CGColorSpace, which
/// is still the window's own.
@interface ResonanceWindowColorSpace : NSColorSpace
- (instancetype)initForWindow:(NSWindow *)window;
@end

@implementation ResonanceWindowColorSpace {
    __weak NSWindow *_window;
    NSColorSpace *_source;
    NSData *_profile;
}

- (instancetype)initForWindow:(NSWindow *)window
{
    self = [super initWithICCProfileData:window.colorSpace.ICCProfileData];
    if (self) {
        _window = window;
    }
    return self;
}

/// the window's colour space, the same object for as long as it is unchanged
- (NSColorSpace *)current
{
    NSColorSpace *now = _window.colorSpace;
    if (now && now != _source) {
        _source = now;
        const bool wide = CGColorSpaceIsWideGamutRGB(now.CGColorSpace);
        _profile = QColorSpace(wide ? QColorSpace::DisplayP3 : QColorSpace::SRgb).iccProfile().toNSData();
    }
    return _source;
}

- (NSData *)ICCProfileData
{
    return [self current] ? _profile : [super ICCProfileData];
}

- (CGColorSpaceRef)CGColorSpace
{
    NSColorSpace *current = [self current];
    return current ? current.CGColorSpace : [super CGColorSpace];
}

@end

namespace resonance::macos {

namespace {

NSView *viewOf(QWindow *window)
{
    // only cocoa's windows are views: the offscreen platform a test or a
    // headless run gets hands out ids that are not
    if (QGuiApplication::platformName() != QLatin1StringView("cocoa")) {
        return nil;
    }
    return (__bridge NSView *)reinterpret_cast<void *>(window->winId());
}

} // namespace

void styleTitleBar(QWindow *window)
{
    NSView *view = viewOf(window);
    NSWindow *frame = view.window;
    if (!frame) {
        return;
    }
    // qt makes the bar transparent and puts the content under it, but leaves
    // the title drawn over the content
    frame.titleVisibility = NSWindowTitleHidden;
    frame.titlebarAppearsTransparent = YES;
    frame.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
    frame.toolbar = nil;
    // the system's traffic lights stay, over the app's own content
    for (const NSWindowButton kind : {NSWindowCloseButton, NSWindowMiniaturizeButton, NSWindowZoomButton}) {
        [frame standardWindowButton:kind].hidden = NO;
    }

    qCDebug(lcMacWindow) << window->title() << "under the bar:"
                         << bool(frame.styleMask & NSWindowStyleMaskFullSizeContentView)
                         << "transparent:" << bool(frame.titlebarAppearsTransparent)
                         << "title hidden:" << (frame.titleVisibility == NSWindowTitleHidden)
                         << "toolbar:" << (frame.toolbar != nil)
                         << "safe area:" << window->safeAreaMargins();
}

namespace {

/// qt puts its metal layer inside a container layer of its own
bool limitIn(CALayer *layer)
{
    if ([layer isKindOfClass:[CAMetalLayer class]]) {
        static_cast<CAMetalLayer *>(layer).maximumDrawableCount = 2;
        return true;
    }
    bool found = false;
    for (CALayer *sublayer in layer.sublayers) {
        found = limitIn(sublayer) || found;
    }
    return found;
}

} // namespace

bool holdColorSpace(QWindow *window)
{
    NSView *view = viewOf(window);
    NSWindow *frame = view.window;
    // qt's view takes a colour space of its own, and reports the window's
    // without one
    if (!frame || !frame.colorSpace || ![view respondsToSelector:@selector(setColorSpace:)]) {
        return false;
    }
    ResonanceWindowColorSpace *held = [[ResonanceWindowColorSpace alloc] initForWindow:frame];
    if (![held isKindOfClass:[ResonanceWindowColorSpace class]]) {
        return false;
    }
    reinterpret_cast<void (*)(id, SEL, id)>(objc_msgSend)(view, @selector(setColorSpace:), held);
    qCDebug(lcMacWindow) << "colour space held for" << window;
    return true;
}

bool limitDrawables(QWindow *window)
{
    NSView *view = viewOf(window);
    const bool found = view.layer && limitIn(view.layer);
    qCDebug(lcMacWindow) << "two drawables for" << window << found;
    return found;
}

} // namespace resonance::macos
