#include <QJsonDocument>
#include <QJsonObject>

#include <iostream>
#include <string>

int main()
{
    std::string line;
    while (std::getline(std::cin, line)) {
        const QJsonObject request = QJsonDocument::fromJson(QByteArray::fromStdString(line)).object();
        QJsonObject result;
        if (request.value(QStringLiteral("method")).toString() == QLatin1StringView("auth.status")) {
            result = QJsonObject {
                { QStringLiteral("authorized"), true },
                { QStringLiteral("profile"), QJsonObject {
                    { QStringLiteral("id"), 81234 },
                    { QStringLiteral("username"), QStringLiteral("restored-user") },
                    { QStringLiteral("fullName"), QStringLiteral("Restored User") },
                } },
            };
        }
        const QJsonObject response {
            { QStringLiteral("id"), request.value(QStringLiteral("id")) },
            { QStringLiteral("result"), result },
        };
        const QByteArray output = QJsonDocument(response).toJson(QJsonDocument::Compact);
        std::cout.write(output.constData(), output.size());
        std::cout << '\n' << std::flush;
    }
}
