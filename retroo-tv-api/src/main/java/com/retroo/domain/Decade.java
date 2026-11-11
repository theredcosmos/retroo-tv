package com.retroo.domain;

import com.fasterxml.jackson.annotation.JsonValue;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Optional;

/**
 * The seven "channels" of the TV. The {@link #slug()} is what travels over the wire and is stored in the
 * {@code SONGS.DECADE} column (guarded by a CHECK constraint), so it must never change once data exists.
 */
public enum Decade {
    SIXTIES("60s", "60s", "60s hits"),
    SEVENTIES("70s", "70s", "70s hits"),
    EIGHTIES("80s", "80s", "80s hits"),
    NINETIES("90s", "90s", "90s hits"),
    TWO_THOUSANDS("2000s", "2000s", "2000s hits"),
    TWENTY_TENS("2010s", "2010s", "2010s hits"),
    NOW("now", "Now", "top hits this year");

    private final String slug;
    private final String label;
    private final String ytMusicQuery;

    Decade(String slug, String label, String ytMusicQuery) {
        this.slug = slug;
        this.label = label;
        this.ytMusicQuery = ytMusicQuery;
    }

    @JsonValue
    public String slug() {
        return slug;
    }

    public String label() {
        return label;
    }

    /**
     * Deep link opened by the header button ("90s playlist on YouTube Music"). A search URL is used because
     * curated playlist IDs change over time, while a search always resolves.
     */
    public String ytMusicUrl() {
        return "https://music.youtube.com/search?q=" + URLEncoder.encode(ytMusicQuery, StandardCharsets.UTF_8)
                .replace("+", "%20");
    }

    /** Case-insensitive lookup by slug, e.g. {@code "90S"} → {@link #NINETIES}. */
    public static Optional<Decade> fromSlug(String slug) {
        if (slug == null) {
            return Optional.empty();
        }
        return Arrays.stream(values()).filter(d -> d.slug.equalsIgnoreCase(slug.trim())).findFirst();
    }
}
