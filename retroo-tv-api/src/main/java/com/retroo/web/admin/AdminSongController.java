package com.retroo.web.admin;

import com.retroo.config.OpenApiConfig;
import com.retroo.service.SongService;
import com.retroo.web.dto.AddSongRequest;
import com.retroo.web.dto.SongResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Catalog management. Every route here is protected by {@link AdminKeyInterceptor}. */
@RestController
@RequestMapping("/api/admin/songs")
@Tag(name = "Admin")
@SecurityRequirement(name = OpenApiConfig.ADMIN_KEY_SCHEME)
public class AdminSongController {

    private final SongService songService;

    public AdminSongController(SongService songService) {
        this.songService = songService;
    }

    @Operation(summary = "Add a song by YouTube id/URL; title & artist are auto-filled via oEmbed when omitted")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SongResponse add(@Valid @RequestBody AddSongRequest request) {
        return songService.addSong(request);
    }

    @Operation(summary = "Remove a song from the catalog")
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable long id) {
        songService.deleteSong(id);
    }
}
