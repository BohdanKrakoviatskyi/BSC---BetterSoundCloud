#pragma once

#include <QObject>
#include <QString>
#include <QtQml/qqmlregistration.h>

class QQmlEngine;
class QJSEngine;

namespace resonance {

/// the one error the app is showing, PlayerModel.errorMessage in the swift
/// app. the banner dismisses itself after a while.
class ErrorCenter : public QObject {
    Q_OBJECT
    QML_NAMED_ELEMENT(Errors)
    QML_SINGLETON

    Q_PROPERTY(QString message READ message NOTIFY messageChanged FINAL)
    /// bumped per error, so the same message twice still restarts the banner
    Q_PROPERTY(int serial READ serial NOTIFY messageChanged FINAL)

public:
    /// no default argument: qml builds a singleton with a default constructor
    /// in preference to create(), and would end up with an instance of its own
    explicit ErrorCenter(QObject *parent);
    ~ErrorCenter() override;

    static ErrorCenter *instance();
    static ErrorCenter *create(QQmlEngine *, QJSEngine *);

    QString message() const { return m_message; }
    int serial() const { return m_serial; }

    Q_INVOKABLE void show(const QString &message);
    Q_INVOKABLE void clear();

signals:
    void messageChanged();

private:
    QString m_message;
    int m_serial = 0;
};

} // namespace resonance
