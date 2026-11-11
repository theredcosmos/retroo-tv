package com.retroo.service;

import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Pure, stateless parsing of YouTube / YouTube Music links. No network calls — easy to unit test exhaustively.
 *
 * <p>Accepted playlist links (all normalise to {@code https://music.youtube.com/playlist?list=<id>}):</p>
 * <pre>
 *   https://music.youtube.com/playlist?list=PLxyz
 *   https://www.youtube.com/playlist?list=PLxyz
 *   https://youtube.com/watch?v=abc&list=PLxyz
 *   music.youtube.com/playlist?list=PLxyz&si=tracking   (scheme added, tracking params dropped)
 * </pre>
 * Security: an allow-list of hosts prevents users from smuggling arbitrary URLs (phishing) into the public feed.
 */
@Component
public class YouTubeLinkParser {

    private static final Set<String> ALLOWED_HOSTS = Set.of(
            "music.youtube.com", "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be");

    /** YouTube playlist ids: PL…, OLAK5uy_…, RD…, etc. — URL-safe base64 alphabet. */
    private static final Pattern PLAYLIST_ID = Pattern.compile("^[A-Za-z0-9_-]{2,64}$");

    /** YouTube video ids are exactly 11 URL-safe base64 characters. */
    private static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    public record PlaylistRef(String playlistId, String canonicalUrl) {
    }

    /** @return the playlist reference, or empty if the input is not a YouTube playlist link. */
    public Optional<PlaylistRef> parsePlaylist(String rawUrl) {
        return parseUri(rawUrl)
                .filter(uri -> ALLOWED_HOSTS.contains(uri.getHost().toLowerCase()))
                .map(uri -> UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("list"))
                .filter(id -> PLAYLIST_ID.matcher(id).matches())
                .map(id -> new PlaylistRef(id, "https://music.youtube.com/playlist?list=" + id));
    }

    /**
     * Finds the first YouTube playlist link inside free text, e.g. a chat message like
     * {@code "try this one https://music.youtube.com/playlist?list=PLx !!"}. Splits on whitespace and runs every
     * token that mentions {@code list=} through {@link #parsePlaylist}, so the same host allow-list applies.
     * Trailing punctuation people type after a link is trimmed first.
     */
    public Optional<PlaylistRef> findPlaylistInText(String text) {
        if (text == null || text.isBlank()) {
            return Optional.empty();
        }
        for (String token : text.trim().split("\\s+")) {
            if (!token.contains("list=")) {
                continue;
            }
            String cleaned = token.replaceAll("[)\\]}>.,!?;:'\"]+$", "").replaceAll("^[(\\[{<'\"]+", "");
            Optional<PlaylistRef> ref = parsePlaylist(cleaned);
            if (ref.isPresent()) {
                return ref;
            }
        }
        return Optional.empty();
    }

    /**
     * Accepts a bare id ({@code dQw4w9WgXcQ}), {@code youtu.be/<id>}, {@code /watch?v=<id>} on youtube.com or
     * music.youtube.com, and {@code /shorts/<id>}.
     */
    public Optional<String> parseVideoId(String input) {
        if (input == null) {
            return Optional.empty();
        }
        String trimmed = input.trim();
        if (VIDEO_ID.matcher(trimmed).matches()) {
            return Optional.of(trimmed);
        }
        return parseUri(trimmed)
                .filter(uri -> ALLOWED_HOSTS.contains(uri.getHost().toLowerCase()))
                .map(uri -> {
                    String path = uri.getPath() == null ? "" : uri.getPath();
                    if ("youtu.be".equalsIgnoreCase(uri.getHost())) {
                        return path.replaceFirst("^/", "");
                    }
                    if (path.startsWith("/shorts/")) {
                        return path.substring("/shorts/".length());
                    }
                    return UriComponentsBuilder.fromUri(uri).build().getQueryParams().getFirst("v");
                })
                .filter(id -> VIDEO_ID.matcher(id).matches());
    }

    private Optional<URI> parseUri(String raw) {
        if (raw == null || raw.isBlank()) {
            return Optional.empty();
        }
        String candidate = raw.trim();
        if (!candidate.matches("(?i)^https?://.*")) {
            candidate = "https://" + candidate;
        }
        try {
            URI uri = URI.create(candidate);
            return uri.getHost() == null ? Optional.empty() : Optional.of(uri);
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
