package com.retroo.web.dto;

import com.retroo.domain.SharedPlaylist;

import java.time.Instant;

/** A feed entry. Also the payload pushed on {@code /topic/playlists}. */
public record PlaylistResponse(
        Long id,
        String displayName,
        String playlistUrl,
        String playlistName,
        String note,
        Instant createdAt) {

    public static PlaylistResponse from(SharedPlaylist p) {
        return new PlaylistResponse(p.getId(), p.getDisplayName(), p.getPlaylistUrl(), p.getPlaylistName(),
                p.getNote(), p.getCreatedAt());
    }
}
