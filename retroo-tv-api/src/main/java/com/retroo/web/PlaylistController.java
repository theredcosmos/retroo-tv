package com.retroo.web;

import com.retroo.service.PlaylistService;
import com.retroo.web.dto.PageResponse;
import com.retroo.web.dto.PlaylistResponse;
import com.retroo.web.dto.SharePlaylistRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Shared-playlist feed: read a page, or share a new playlist. */
@RestController
@RequestMapping("/api/playlists")
@Tag(name = "Playlists")
public class PlaylistController {

    private final PlaylistService playlistService;

    public PlaylistController(PlaylistService playlistService) {
        this.playlistService = playlistService;
    }

    @Operation(summary = "Shared playlists, newest first")
    @GetMapping
    public PageResponse<PlaylistResponse> feed(@RequestParam(defaultValue = "0") int page,
                                               @RequestParam(defaultValue = "30") int size) {
        return playlistService.feed(page, size);
    }

    @Operation(summary = "Share a YouTube Music playlist (rate limited per IP)")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public PlaylistResponse share(@Valid @RequestBody SharePlaylistRequest request, HttpServletRequest http) {
        // getRemoteAddr() already honours X-Forwarded-For because server.forward-headers-strategy=framework
        // makes Spring rewrite it from the trusted proxy's headers.
        return playlistService.share(request, http.getRemoteAddr());
    }
}
