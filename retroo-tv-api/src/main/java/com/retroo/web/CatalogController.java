package com.retroo.web;

import com.retroo.service.SongService;
import com.retroo.web.dto.DecadeResponse;
import com.retroo.web.dto.SongResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.util.List;

/**
 * Read-only catalog endpoints used by the decade bar, the "up next" list and the TV itself.
 * Controllers are deliberately thin: parse HTTP → call service → shape HTTP response.
 */
@RestController
@RequestMapping("/api")
@Tag(name = "Catalog")
public class CatalogController {

    private final SongService songService;

    public CatalogController(SongService songService) {
        this.songService = songService;
    }

    @Operation(summary = "All decades with song counts and a YouTube Music link")
    @GetMapping("/decades")
    public ResponseEntity<List<DecadeResponse>> decades() {
        // The catalog changes rarely; let browsers/CDNs cache it briefly.
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(Duration.ofMinutes(5)).cachePublic())
                .body(songService.listDecades());
    }

    @Operation(summary = "Songs in a decade, in chronological order")
    @GetMapping("/songs")
    public List<SongResponse> songs(@RequestParam String decade) {
        return songService.listByDecade(decade);
    }

    @Operation(summary = "A random song from a decade, optionally in one language (hi/en), avoiding recent songs")
    @GetMapping("/songs/random")
    public ResponseEntity<SongResponse> random(@RequestParam String decade,
                                               @RequestParam(required = false) String lang,
                                               @RequestParam(required = false) List<String> exclude) {
        // `exclude` may be repeated or comma-separated (?exclude=a,b). Must never be cached — every call is a draw.
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(songService.randomSong(decade, lang, exclude));
    }
}
