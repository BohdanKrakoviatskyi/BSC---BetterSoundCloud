#include "app/ErrorCenter.h"

#include <QQmlEngine>

namespace resonance {

namespace {
ErrorCenter *s_instance = nullptr;
}

ErrorCenter::ErrorCenter(QObject *parent)
    : QObject(parent)
{
    if (!s_instance) {
        s_instance = this;
    }
}

ErrorCenter::~ErrorCenter()
{
    if (s_instance == this) {
        s_instance = nullptr;
    }
}

ErrorCenter *ErrorCenter::instance()
{
    return s_instance;
}

ErrorCenter *ErrorCenter::create(QQmlEngine *, QJSEngine *)
{
    QJSEngine::setObjectOwnership(s_instance, QJSEngine::CppOwnership);
    return s_instance;
}

void ErrorCenter::show(const QString &message)
{
    if (message.isEmpty()) {
        clear();
        return;
    }
    m_message = message;
    ++m_serial;
    emit messageChanged();
}

void ErrorCenter::clear()
{
    if (m_message.isEmpty()) {
        return;
    }
    m_message.clear();
    emit messageChanged();
}

} // namespace resonance
