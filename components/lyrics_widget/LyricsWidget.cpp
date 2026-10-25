#include "LyricsWidget.h"

#include <QAbstractItemView>
#include <QAction>
#include <QActionGroup>
#include <QBrush>
#include <QColor>
#include <QFont>
#include <QFrame>
#include <QLabel>
#include <QListWidget>
#include <QListWidgetItem>
#include <QMenu>
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

    m_list->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(m_list, &QWidget::customContextMenuRequested,
            this, &LyricsWidget::showSourceMenu);

    // When there are no lyrics the list is hidden and the status label is
    // visible, so the source menu must be available there too.
    m_status->setContextMenuPolicy(Qt::CustomContextMenu);
    connect(m_status, &QWidget::customContextMenuRequested,
            this, &LyricsWidget::showSourceMenu);

    setContextMenuPolicy(Qt::CustomContextMenu);
    connect(this, &QWidget::customContextMenuRequested,
            this, &LyricsWidget::showSourceMenu);

    connect(m_manager, &LyricsManager::lyricsReady, this, &LyricsWidget::onLyricsReady);
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
    m_trackName = trackName;
    m_artistName = artistName;
    m_durationMs = durationMs;
    m_hasTrack = true;

    // a new track starts from the top; the old lines must not flash
    m_positionMs = 0;
    m_currentIndex = -1;
    m_isSynced = false;
    m_lines.clear();
    m_list->clear();

    m_manager->load(m_trackName, m_artistName, m_durationMs, m_selectedSource);
}

void LyricsWidget::setSource(LyricsManager::LyricsSource source)
{
    if (m_selectedSource == source)
        return;

    m_selectedSource = source;

    if (!m_hasTrack)
        return;

    // keep m_positionMs: the new provider should highlight the same moment,
    // but the old provider's lines must not be treated as current anymore
    m_currentIndex = -1;
    m_isSynced = false;
    m_lines.clear();
    m_list->clear();
    m_manager->load(m_trackName, m_artistName, m_durationMs, m_selectedSource);
}

void LyricsWidget::showSourceMenu(const QPoint &pos)
{
    auto *origin = qobject_cast<QWidget *>(sender());
    if (!origin)
        origin = this;

    QMenu menu(this);
    auto *group = new QActionGroup(&menu);
    group->setExclusive(true);

    const auto addAction = [&](const QString &text, LyricsManager::LyricsSource source) {
        QAction *action = menu.addAction(text);
        action->setCheckable(true);
        action->setChecked(m_selectedSource == source);
        group->addAction(action);
        connect(action, &QAction::triggered, this, [this, source](bool) {
            setSource(source);
        });
    };

    addAction(tr("Source: Auto"), LyricsManager::Auto);
    addAction(tr("Source: LRCLIB"), LyricsManager::LrcLib);
    addAction(tr("Source: Genius"), LyricsManager::Genius);

    menu.exec(origin->mapToGlobal(pos));
}

void LyricsWidget::onLyricsReady(const QList<LyricLine> &lyrics, bool isSynced)
{
    m_lines = lyrics;
    m_isSynced = isSynced;
    m_currentIndex = -1;

    m_list->clear();
    if (m_lines.isEmpty()) {
        m_list->hide();
        return;
    }

    m_status->hide();
    m_list->show();

    // timed lyrics stay dimmed until a line becomes active; plain text is
    // readable as it is
    QColor dimColor = m_list->palette().color(QPalette::WindowText);
    dimColor.setAlphaF(0.55);
    const QBrush dimBrush(dimColor);

    m_list->setUpdatesEnabled(false);
    for (const LyricLine &line : m_lines) {
        auto *item = new QListWidgetItem(line.text, m_list);
        if (m_isSynced)
            item->setForeground(dimBrush);
    }
    m_list->setUpdatesEnabled(true);

    if (m_isSynced) {
        // the track may already be playing when the response arrives
        onPositionChanged(m_positionMs);
    } else {
        // plain lyrics have no timeline and are never auto-scrolled
        m_list->scrollToTop();
    }
}

void LyricsWidget::onPositionChanged(qint64 positionMs)
{
    m_positionMs = positionMs;

    // plain lyrics have no timeline: no highlight and no scrolling
    if (!m_isSynced || m_lines.isEmpty())
        return;

    const qint64 effectiveMs = positionMs + m_manualOffsetMs;

    // lyrics are sorted, so the current line is found from the end
    int index = -1;
    for (int i = int(m_lines.size()) - 1; i >= 0; --i) {
        if (m_lines.at(i).timeMs <= effectiveMs) {
            index = i;
            break;
        }
    }

    if (index == m_currentIndex)
        return;

    applyCurrentIndex(index);
}

void LyricsWidget::increaseOffset()
{
    setManualOffsetMs(m_manualOffsetMs + 500);
}

void LyricsWidget::decreaseOffset()
{
    setManualOffsetMs(m_manualOffsetMs - 500);
}

void LyricsWidget::setManualOffsetMs(qint64 offsetMs)
{
    if (m_manualOffsetMs == offsetMs)
        return;

    m_manualOffsetMs = offsetMs;
    setToolTip(tr("Lyrics offset: %1 ms").arg(m_manualOffsetMs));

    // recalibrate immediately instead of waiting for the next position tick
    if (m_isSynced)
        onPositionChanged(m_positionMs);
}

void LyricsWidget::applyCurrentIndex(int index)
{
    if (!m_isSynced)
        return;
    if (index < -1 || index >= m_list->count())
        return;

    const QColor textColor = m_list->palette().color(QPalette::WindowText);
    QColor dimColor = textColor;
    dimColor.setAlphaF(0.55);

    QFont base = m_list->font();
    QFont active = base;
    active.setBold(true);

    if (QListWidgetItem *previous = m_list->item(m_currentIndex)) {
        previous->setFont(base);
        previous->setForeground(dimColor);
    }

    m_currentIndex = index;
    if (index < 0)
        return;

    QListWidgetItem *current = m_list->item(index);
    if (!current) {
        m_currentIndex = -1;
        return;
    }

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
