#include "LyricsWidget.h"

#include "LyricsManager.h"

#include <QAbstractItemView>
#include <QBrush>
#include <QColor>
#include <QFont>
#include <QFrame>
#include <QLabel>
#include <QListWidget>
#include <QListWidgetItem>
#include <QPalette>
#include <QVBoxLayout>

namespace resonance::lyrics {

LyricsWidget::LyricsWidget(QWidget *parent)
    : QWidget(parent)
    , m_manager(new LyricsManager(this))
    , m_list(new QListWidget(this))
    , m_status(new QLabel(this))
{
    m_status->setAlignment(Qt::AlignCenter);
    m_status->setWordWrap(true);

    QPalette statusPalette = m_status->palette();
    QColor statusColor = statusPalette.color(QPalette::WindowText);
    statusColor.setAlphaF(0.6);
    statusPalette.setColor(QPalette::WindowText, statusColor);
    m_status->setPalette(statusPalette);
    m_status->hide();

    m_list->setFrameShape(QFrame::NoFrame);
    m_list->setSelectionMode(QAbstractItemView::NoSelection);
    m_list->setFocusPolicy(Qt::NoFocus);
    m_list->setWordWrap(true);
    m_list->setUniformItemSizes(false);
    m_list->setHorizontalScrollBarPolicy(Qt::ScrollBarAlwaysOff);
    m_list->setVerticalScrollMode(QAbstractItemView::ScrollPerPixel);
    m_list->setResizeMode(QListView::Adjust);
    m_list->setSpacing(6);
    m_list->setStyleSheet(QStringLiteral(
        "QListWidget { background: transparent; }"
        "QListWidget::item { padding: 2px 0px; }"));
    m_list->hide();

    auto *layout = new QVBoxLayout(this);
    layout->setContentsMargins(0, 0, 0, 0);
    layout->setSpacing(8);
    layout->addWidget(m_status);
    layout->addWidget(m_list, 1);

    connect(m_manager, &LyricsManager::lyricsChanged, this, &LyricsWidget::rebuildLines);
    connect(m_manager, &LyricsManager::activeLineChanged, this, &LyricsWidget::applyActiveLine);
    connect(m_manager, &LyricsManager::stateChanged, this, [this](LyricsManager::State) {
        switch (m_manager->state()) {
        case LyricsManager::State::Loading:
        case LyricsManager::State::NotFound:
        case LyricsManager::State::Error:
            showStatus(m_manager->statusMessage());
            break;
        case LyricsManager::State::Idle:
        case LyricsManager::State::Ready:
            showStatus(QString());
            break;
        }
    });
}

void LyricsWidget::load(const QString &trackName, const QString &artistName, qint64 durationMs)
{
    m_manager->load(trackName, artistName, durationMs);
}

void LyricsWidget::setPositionMs(qint64 positionMs)
{
    m_manager->setPositionMs(positionMs);
}

void LyricsWidget::setManualOffsetMs(qint64 offsetMs)
{
    m_manager->setManualOffsetMs(offsetMs);
}

void LyricsWidget::rebuildLines()
{
    m_list->clear();
    m_activeRow = -1;

    const QVector<LyricLine> &lines = m_manager->lines();
    if (lines.isEmpty()) {
        m_list->hide();
        return;
    }

    m_status->hide();
    m_list->show();

    // plain lyrics are readable as they are; timed ones stay dimmed until a
    // line becomes active
    QColor dimColor = m_list->palette().color(QPalette::WindowText);
    dimColor.setAlphaF(0.55);
    const QBrush dimBrush(dimColor);
    const bool synchronized = m_manager->isSynchronized();

    m_list->setUpdatesEnabled(false);
    for (const LyricLine &line : lines) {
        auto *item = new QListWidgetItem(line.text, m_list);
        if (synchronized)
            item->setForeground(dimBrush);
    }
    m_list->setUpdatesEnabled(true);

    if (synchronized)
        applyActiveLine(m_manager->activeLine());
}

void LyricsWidget::applyActiveLine(int index)
{
    if (!m_manager->isSynchronized())
        return; // plain lyrics have no timeline and must not scroll on their own
    if (index == m_activeRow)
        return;
    if (index < -1 || index >= m_list->count())
        return;

    const QColor textColor = m_list->palette().color(QPalette::WindowText);
    QColor dimColor = textColor;
    dimColor.setAlphaF(0.55);

    QFont base = m_list->font();
    QFont active = base;
    active.setBold(true);

    if (QListWidgetItem *previous = m_list->item(m_activeRow)) {
        previous->setFont(base);
        previous->setForeground(dimColor);
    }

    m_activeRow = index;
    if (index < 0)
        return;

    QListWidgetItem *current = m_list->item(index);
    current->setFont(active);
    current->setForeground(textColor);
    m_list->scrollToItem(current, QAbstractItemView::PositionAtCenter);
}

void LyricsWidget::showStatus(const QString &text)
{
    const bool visible = !text.isEmpty();
    m_status->setText(text);
    m_status->setVisible(visible);
    if (visible)
        m_list->hide();
}

} // namespace resonance::lyrics
