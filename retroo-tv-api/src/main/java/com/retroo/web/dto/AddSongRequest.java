package com.retroo.web.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Body of {@code POST /api/admin/songs}. {@code video} accepts a raw 11-char id or any YouTube / YT Music watch URL.
 * Title and artist are optional — when omitted they are looked up through YouTube oEmbed.
 */
public record AddSongRequest(
        @NotBlank(message = "is required") String video,
        @NotBlank(message = "is required") String decade,
        @Size(max = 200) String title,
        @Size(max = 200) String artist,
        @Min(1900) @Max(2100) Integer releaseYear,
        @Pattern(regexp = "hi|en", message = "must be 'hi' or 'en'") String lang) {
}
