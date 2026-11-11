package com.retroo.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.net.URI;
import java.time.Duration;
import java.util.List;

/**
 * Type-safe view of every {@code retroo.*} property in application.yml.
 *
 * <p>Using an immutable record (instead of scattering {@code @Value} annotations) gives us one place to see all
 * tunables, compile-time safety and start-up validation: the app refuses to boot if, say, the rate-limit window is
 * missing.</p>
 */
@Validated
@ConfigurationProperties(prefix = "retroo")
public record RetrooProperties(
        @Valid @NotNull Cors cors,
        @Valid @NotNull Admin admin,
        @Valid @NotNull Playlists playlists,
        @Valid @NotNull Presence presence,
        @Valid @NotNull Youtube youtube,
        @Valid @NotNull Jam jam) {

    /** Browser origins allowed to call the API cross-origin. */
    public record Cors(List<String> allowedOrigins) {
        public Cors {
            allowedOrigins = allowedOrigins == null ? List.of() : List.copyOf(allowedOrigins);
        }
    }

    /** Shared secret for {@code /api/admin/**}. Blank disables the admin API entirely. */
    public record Admin(String apiKey) {
        public boolean enabled() {
            return apiKey != null && !apiKey.isBlank();
        }
    }

    public record Playlists(@Valid @NotNull RateLimit rateLimit) {
    }

    /** Fixed-window limit: at most {@code maxRequests} submissions per client IP per {@code window}. */
    public record RateLimit(@Min(1) int maxRequests, @NotNull Duration window) {
    }

    /** How often the current listener count is re-broadcast even if nothing changed. */
    public record Presence(@NotNull Duration heartbeat) {
    }

    /**
     * Jam-session limits (gemini.md §8). Jams live in memory, so every limit here is also a memory/CPU bound:
     * {@code maxActive × (maxMembers + chatHistory)} caps the state one API instance can accumulate.
     */
    public record Jam(
            @NotNull Duration ttl,
            @NotNull Duration extension,
            @NotNull Duration endingSoonBefore,
            @Min(1) int maxActive,
            @Min(1) int maxMembers,
            @Valid @NotNull RateLimit createRateLimit,
            @Valid @NotNull RateLimit chatRateLimit,
            @Min(1) int chatHistory,
            @Min(1) int snapshotChat,
            @NotNull Duration sweepInterval) {
    }

    /** YouTube oEmbed endpoint used to enrich admin-added songs with title/artist. */
    public record Youtube(@NotNull URI oembedUrl, @NotNull Duration timeout) {
    }
}
