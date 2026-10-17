pragma ComponentBehavior: Bound
import QtQuick
import Swiftify

// Author's liked tracks page: matches SavedSongsView UI with pagination
SongListPage {
    id: root

    songs: SoundCloud.artistLikes
    loading: SoundCloud.loadingArtist && SoundCloud.artistLikes.count === 0
    loadingMore: SoundCloud.loadingMoreArtistLikes
    showsEmpty: !SoundCloud.loadingArtist && SoundCloud.artistLikes.count === 0
    emptySymbol: "favorite"
    emptyTitle: "Нет лайкнутых треков"
    emptyDescription: "У этого автора пока нет публичных лайков."

    onLoadMoreRequested: {
        if (SoundCloud.hasMoreArtistLikes && !SoundCloud.loadingMoreArtistLikes) {
            SoundCloud.loadMoreArtistLikes()
        }
    }

    hero: CollectionHero {
        id: hero
        kind: "LIKES"
        themeTinted: true
        title: "Лайки " + (Library.currentArtist.name.length > 0 ? Library.currentArtist.name : SoundCloud.currentArtist.fullName)
        artworkUrl: SoundCloud.artistLikes.count > 0
                    ? SoundCloud.artistLikes.at(0).artworkUrl
                    : Library.currentArtist.artworkUrl
        facts: Format.joined([
            Library.currentArtist.name,
            Format.songCount(SoundCloud.artistLikes.count),
            Format.totalDuration(SoundCloud.artistLikes.totalDurationMs)
        ], "  •  ")

        artwork: Rectangle {
            visible: (hero.artworkUrl.toString().length === 0)
            anchors.fill: parent
            radius: Appearance.sizes.artworkRadius
            gradient: Gradient {
                GradientStop { position: 0; color: Appearance.colors.primary }
                GradientStop { position: 1; color: Appearance.colors.tertiary }
            }

            MaterialSymbol {
                anchors.centerIn: parent
                text: "favorite"
                iconSize: 96
                fill: 1
                color: Appearance.colors.onPrimary
            }
        }

        actions: [
            TextButton {
                iconOnly: parent ? parent.compactActions : false
                compactSize: parent ? parent.actionSize : 48
                implicitHeight: iconOnly ? compactSize : 48
                wavy: true
                symbol: "play_arrow"
                burst: "play"
                text: "Воспроизвести"
                enabled: SoundCloud.artistLikes.count > 0
                onClicked: Player.playFromModel(SoundCloud.artistLikes, 0)
            }
        ]
    }
}
