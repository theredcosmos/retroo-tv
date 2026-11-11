package com.retroo.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/playlists}. Syntactic checks happen here (Bean Validation, before the controller runs);
 * the semantic check — "is this really a YouTube playlist link?" — happens in the service via
 * {@link com.retroo.service.YouTubeLinkParser}.
 */
public record SharePlaylistRequest(
        @NotBlank(message = "is required") @Size(max = 40, message = "must be at most 40 characters")
        String displayName,

        @NotBlank(message = "is required") @Size(max = 500, message = "is too long")
        String playlistUrl,

        @NotBlank(message = "is required") @Size(max = 80, message = "must be at most 80 characters")
        String playlistName,

        @Size(max = 140, message = "must be at most 140 characters")
        String note) {
}
