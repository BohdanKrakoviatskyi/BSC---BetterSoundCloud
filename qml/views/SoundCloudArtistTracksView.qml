pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// Author's tracks page: loaded gradually with infinite scroll pagination (20 at a time)
SongListPage {
    id: root

    songs: SoundCloud.artistTracks
    loading: SoundCloud.loadingArtist && SoundCloud.artistTracks.count === 0
    loadingMore: SoundCloud.loadingMoreArtistTracks
    showsEmpty: !SoundCloud.loadingArtist && SoundCloud.artistTracks.count === 0
    emptySymbol: "music_note"
    emptyTitle: "Нет треков"
    emptyDescription: "У этого автора пока нет треков."

    onLoadMoreRequested: {
        if (SoundCloud.hasMoreArtistTracks && !SoundCloud.loadingMoreArtistTracks) {
            SoundCloud.loadMoreArtistTracks()
        }
    }

    hero: CollectionHero {
        id: hero
        kind: "TRACKS"
        title: "Треки " + (Library.currentArtist.name.length > 0 ? Library.currentArtist.name : SoundCloud.currentArtist.fullName)
        artworkUrl: SoundCloud.artistTracks.count > 0
                    ? SoundCloud.artistTracks.at(0).artworkUrl
                    : Library.currentArtist.artworkUrl
        facts: Format.joined([
            Library.currentArtist.name,
            Format.songCount(SoundCloud.artistTracks.count),
            Format.totalDuration(SoundCloud.artistTracks.totalDurationMs)
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
                text: "music_note"
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
                enabled: SoundCloud.artistTracks.count > 0
                onClicked: Player.playFromModel(SoundCloud.artistTracks, 0)
            }
        ]
    }
}
