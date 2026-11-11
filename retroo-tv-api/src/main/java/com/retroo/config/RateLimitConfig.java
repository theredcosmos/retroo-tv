package com.retroo.config;

import com.retroo.service.RateLimiter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Clock;

/**
 * One {@link RateLimiter} per use-case, each with its own limits from {@code application.yml}. Separate instances
 * keep the counters independent: sharing playlists never eats into someone's jam-chat budget. Injection points
 * pick theirs with {@code @Qualifier} using the bean names below.
 */
@Configuration
public class RateLimitConfig {

    public static final String PLAYLIST_SHARE = "playlistShareRateLimiter";
    public static final String JAM_CREATE = "jamCreateRateLimiter";
    public static final String JAM_CHAT = "jamChatRateLimiter";

    @Bean(name = PLAYLIST_SHARE)
    public RateLimiter playlistShareRateLimiter(RetrooProperties props, Clock clock) {
        return of(props.playlists().rateLimit(), clock);
    }

    @Bean(name = JAM_CREATE)
    public RateLimiter jamCreateRateLimiter(RetrooProperties props, Clock clock) {
        return of(props.jam().createRateLimit(), clock);
    }

    @Bean(name = JAM_CHAT)
    public RateLimiter jamChatRateLimiter(RetrooProperties props, Clock clock) {
        return of(props.jam().chatRateLimit(), clock);
    }

    private static RateLimiter of(RetrooProperties.RateLimit limit, Clock clock) {
        return new RateLimiter(limit.maxRequests(), limit.window(), clock);
    }
}
