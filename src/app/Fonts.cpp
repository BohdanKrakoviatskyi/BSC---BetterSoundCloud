#include "app/Fonts.h"

#include <QCoreApplication>
#include <QDir>
#include <QFileInfo>
#include <QFontDatabase>
#include <QLoggingCategory>

namespace resonance::fonts {

Q_LOGGING_CATEGORY(lcFonts, "resonance.fonts")

namespace {

constexpr auto kIconFamily = "Material Symbols Rounded";
constexpr auto kIconFile = "MaterialSymbolsRounded.ttf";
constexpr auto kInterfaceFamily = "Google Sans Flex";
constexpr auto kInterfaceFile = "GoogleSansFlex.ttf";

/// a font installed beside the app, unless the system has it already
bool loadBundled(const char *family, const char *file)
{
    if (QFontDatabase::families().contains(QLatin1StringView(family))) {
        return true;
    }
    const QString applicationDirectory = QCoreApplication::applicationDirPath();
    const QStringList candidates {
        applicationDirectory + QStringLiteral("/../share/resonance/fonts/"),
        // inside the macos app bundle
        applicationDirectory + QStringLiteral("/../Resources/fonts/"),
        applicationDirectory + QStringLiteral("/fonts/"),
#ifdef RESONANCE_BUILD_FONT_DIRECTORY
        QStringLiteral(RESONANCE_BUILD_FONT_DIRECTORY "/"),
#endif
    };
    for (const QString &directory : candidates) {
        const QString path = QDir::cleanPath(directory + QLatin1StringView(file));
        if (QFileInfo::exists(path) && QFontDatabase::addApplicationFont(path) >= 0) {
            return true;
        }
    }
    return false;
}

} // namespace

void loadIconFont()
{
    if (!loadBundled(kIconFamily, kIconFile)) {
        qCWarning(lcFonts) << "Material Symbols Rounded is not installed; icons will show as text";
    }
}

void loadInterfaceFont()
{
    if (!loadBundled(kInterfaceFamily, kInterfaceFile)) {
        qCInfo(lcFonts) << "Google Sans Flex is not installed; text uses the next face along, and titles are not rounded";
    }
}

QString iconFamily()
{
    return QString::fromLatin1(kIconFamily);
}

QString interfaceFamily()
{
    static const QString family = [] {
        const QStringList installed = QFontDatabase::families();
        for (const auto *candidate : {"Google Sans Flex", "Google Sans", "Rubik", "Inter", "Noto Sans"}) {
            if (installed.contains(QLatin1StringView(candidate))) {
                return QString::fromLatin1(candidate);
            }
        }
        return QFontDatabase::systemFont(QFontDatabase::GeneralFont).family();
    }();
    return family;
}

QString fixedFamily()
{
    static const QString family = QFontDatabase::systemFont(QFontDatabase::FixedFont).family();
    return family;
}

} // namespace resonance::fonts
