pragma ComponentBehavior: Bound
import QtQuick
import Resonance

// Author's tracks page: loaded gradually with infinite scroll pagination (20 at a time)
SongListPage {
    id: root

    readonly property bool isYouTube: Library.source === "youtube-music" || Library.currentArtist.isYouTubeMusic
    readonly property SongListModel tracksModel: isYouTube ? YouTubeMusic.artistTracks : SoundCloud.artistTracks

    songs: tracksModel
    loading: (isYouTube ? YouTubeMusic.loadingArtist : SoundCloud.loadingArtist) && tracksModel.count === 0
    loadingMore: isYouTube ? YouTubeMusic.loadingMoreArtistTracks : SoundCloud.loadingMoreArtistTracks
    showsEmpty: !(isYouTube ? YouTubeMusic.loadingArtist : SoundCloud.loadingArtist) && tracksModel.count === 0
    emptySymbol: "music_note"
    emptyTitle: "No tracks"
    emptyDescription: "This artist has no tracks yet."

    onLoadMoreRequested: {
        if (root.isYouTube) {
            if (YouTubeMusic.hasMoreArtistTracks && !YouTubeMusic.loadingMoreArtistTracks) {
                YouTubeMusic.loadMoreArtistTracks()
            }
        } else if (SoundCloud.hasMoreArtistTracks && !SoundCloud.loadingMoreArtistTracks) {
            SoundCloud.loadMoreArtistTracks()
        }
    }

    hero: CollectionHero {
        id: hero
        kind: "TRACKS"
        title: "Tracks by " + (Library.currentArtist.name.length > 0 ? Library.currentArtist.name : (root.isYouTube ? YouTubeMusic.currentArtist.fullName : SoundCloud.currentArtist.fullName))
        artworkUrl: root.tracksModel.count > 0
                    ? root.tracksModel.at(0).artworkUrl
                    : Library.currentArtist.artworkUrl
        facts: Format.joined([
            Library.currentArtist.name,
            Format.songCount(root.tracksModel.count),
            Format.totalDuration(root.tracksModel.totalDurationMs)
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
                text: "Play"
                enabled: root.tracksModel.count > 0
                onClicked: Player.playFromModel(root.tracksModel, 0)
            }
        ]
    }
}
