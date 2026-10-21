#include "app/Paths.h"

#include <QDir>
#include <QStandardPaths>

namespace resonance::paths {

namespace {

QString ensured(const QString &path)
{
    QDir().mkpath(path);
    return path;
}

} // namespace

QString appDirectory(const QString &base)
{
    const QString current = base + QStringLiteral("/Resonance");
    const QString legacy = base + QStringLiteral("/Swiftify");
    if (!QDir(current).exists() && QDir(legacy).exists()) {
        if (!QDir().rename(legacy, current)) {
            return legacy;
        }
    }
    return ensured(current);
}

QString dataDirectory()
{
    return appDirectory(QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation));
}

QString cacheDirectory()
{
    return appDirectory(QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation));
}

} // namespace resonance::paths
