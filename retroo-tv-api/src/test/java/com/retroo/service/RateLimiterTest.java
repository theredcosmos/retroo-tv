package com.retroo.service;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.assertj.core.api.Assertions.assertThat;

class RateLimiterTest {

    /** Hand-rolled mutable clock so we can move time forward deterministically. */
    static final class TestClock extends Clock {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }


    @Test
    void allowsUpToLimitThenRejectsWithRetryAfter() {
        var clock = new TestClock();
        var limiter = new RateLimiter(2, Duration.ofMinutes(10), clock);

        assertThat(limiter.tryAcquire("1.1.1.1").allowed()).isTrue();
        assertThat(limiter.tryAcquire("1.1.1.1").allowed()).isTrue();

        clock.now = clock.now.plusSeconds(60);
        var third = limiter.tryAcquire("1.1.1.1");
        assertThat(third.allowed()).isFalse();
        assertThat(third.retryAfter()).isEqualTo(Duration.ofMinutes(9));
    }

    @Test
    void keysAreIndependentAndWindowResets() {
        var clock = new TestClock();
        var limiter = new RateLimiter(1, Duration.ofMinutes(1), clock);

        assertThat(limiter.tryAcquire("a").allowed()).isTrue();
        assertThat(limiter.tryAcquire("b").allowed()).isTrue();
        assertThat(limiter.tryAcquire("a").allowed()).isFalse();

        clock.now = clock.now.plus(Duration.ofMinutes(1));
        assertThat(limiter.tryAcquire("a").allowed()).isTrue();
    }
}
