package com.retroo.web;

import com.retroo.service.PlaylistService;
import com.retroo.service.PresenceService;
import com.retroo.service.SongService;
import com.retroo.web.dto.StatsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Snapshot counters. The UI uses {@code listeners} as the initial badge value before the WebSocket connects. */
@RestController
@RequestMapping("/api/stats")
@Tag(name = "Stats")
public class StatsController {

    private final PresenceService presence;
    private final SongService songs;
    private final PlaylistService playlists;

    public StatsController(PresenceService presence, SongService songs, PlaylistService playlists) {
        this.presence = presence;
        this.songs = songs;
        this.playlists = playlists;
    }

    @Operation(summary = "Live listener count and catalog totals")
    @GetMapping
    public StatsResponse stats() {
        return new StatsResponse(presence.listenerCount(), songs.count(), playlists.count());
    }
}
