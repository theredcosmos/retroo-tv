package com.retroo.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * A YouTube Music playlist that a visitor shared to the left-hand feed.
 * Only the canonical URL is stored (see {@link com.retroo.service.YouTubeLinkParser}) so that the same playlist
 * shared via youtube.com, m.youtube.com or music.youtube.com collapses to one identity.
 */
@Entity
@Table(name = "SHARED_PLAYLISTS")
public class SharedPlaylist {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "DISPLAY_NAME", nullable = false, length = 40)
    private String displayName;

    @Column(name = "PLAYLIST_ID", nullable = false, length = 64)
    private String playlistId;

    @Column(name = "PLAYLIST_URL", nullable = false, length = 300)
    private String playlistUrl;

    @Column(name = "PLAYLIST_NAME", nullable = false, length = 80)
    private String playlistName;

    @Column(name = "NOTE", length = 140)
    private String note;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private Instant createdAt;

    protected SharedPlaylist() {
    }

    public SharedPlaylist(String displayName, String playlistId, String playlistUrl, String playlistName,
                          String note, Instant createdAt) {
        this.displayName = displayName;
        this.playlistId = playlistId;
        this.playlistUrl = playlistUrl;
        this.playlistName = playlistName;
        this.note = note;
        this.createdAt = createdAt;
    }

    public Long getId() {
        return id;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getPlaylistId() {
        return playlistId;
    }

    public String getPlaylistUrl() {
        return playlistUrl;
    }

    public String getPlaylistName() {
        return playlistName;
    }

    public String getNote() {
        return note;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
