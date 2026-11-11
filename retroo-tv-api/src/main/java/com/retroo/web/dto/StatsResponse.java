package com.retroo.web.dto;

/** Snapshot for {@code GET /api/stats}; {@code listeners} is also used as the initial badge value. */
public record StatsResponse(int listeners, long songs, long playlists) {
}
