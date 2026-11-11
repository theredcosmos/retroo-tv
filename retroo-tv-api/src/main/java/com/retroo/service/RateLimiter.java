package com.retroo.service;

import org.springframework.scheduling.annotation.Scheduled;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

/**
 * In-memory fixed-window rate limiter keyed by an arbitrary string (client IP, "jam:member", …).
 *
 * <p>Algorithm: each key owns a window {@code [start, start + window)} and a counter. A request inside the
 * window increments the counter; once it exceeds {@code maxRequests} the request is rejected with the number of
 * seconds until the window resets (sent to clients as {@code Retry-After}). {@link ConcurrentMap#compute} makes
 * the read-modify-write atomic per key without a global lock.</p>
 *
 * <p>Not a {@code @Component}: the app needs several independently configured limiters (playlist shares, jam
 * creation, jam chat), so each one is declared as a named bean in {@link com.retroo.config.RateLimitConfig}.
 * {@code @Scheduled} still works on {@code @Bean}-created objects.</p>
 *
 * <p>Trade-offs (good interview material): fixed windows allow a burst of 2×limit around a boundary; a sliding
 * log or token bucket smooths that. State is per-instance — behind a load balancer use Redis
 * ({@code INCR} + {@code EXPIRE}) or Bucket4j with a distributed backend.</p>
 */
public class RateLimiter {

    private record Window(Instant start, int count) {
    }

    /** Result of {@link #tryAcquire}; {@code retryAfter} is only meaningful when not allowed. */
    public record Decision(boolean allowed, Duration retryAfter) {
    }

    private final ConcurrentMap<String, Window> windows = new ConcurrentHashMap<>();
    private final int maxRequests;
    private final Duration window;
    private final Clock clock;

    public RateLimiter(int maxRequests, Duration window, Clock clock) {
        if (maxRequests < 1 || window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("maxRequests must be >= 1 and window positive");
        }
        this.maxRequests = maxRequests;
        this.window = window;
        this.clock = clock;
    }

    public Decision tryAcquire(String key) {
        Instant now = clock.instant();
        Window updated = windows.compute(key, (k, current) -> {
            if (current == null || !now.isBefore(current.start().plus(window))) {
                return new Window(now, 1);                       // new window
            }
            return new Window(current.start(), current.count() + 1);
        });
        if (updated.count() <= maxRequests) {
            return new Decision(true, Duration.ZERO);
        }
        return new Decision(false, Duration.between(now, updated.start().plus(window)));
    }

    /** Housekeeping so the map cannot grow without bound from one-off visitors. */
    @Scheduled(fixedDelay = 60_000)
    public void evictExpired() {
        Instant now = clock.instant();
        windows.entrySet().removeIf(e -> !now.isBefore(e.getValue().start().plus(window)));
    }
}
