package com.retroo.jam;

import com.retroo.config.RetrooProperties;
import com.retroo.jam.JamModels.ChatKind;
import com.retroo.jam.JamModels.ChatMessage;
import com.retroo.jam.JamModels.ControlAction;
import com.retroo.jam.JamModels.ControlMessage;
import com.retroo.jam.JamModels.CreateJamRequest;
import com.retroo.jam.JamModels.EndReason;
import com.retroo.jam.JamModels.EndedPayload;
import com.retroo.jam.JamModels.EventType;
import com.retroo.jam.JamModels.JamEvent;
import com.retroo.jam.JamModels.PlaybackState;
import com.retroo.service.RateLimiter;
import com.retroo.service.YouTubeLinkParser;
import com.retroo.web.dto.SongResponse;
import com.retroo.web.error.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

/** Pure unit tests: in-memory service, mocked broker, hand-driven clock. */
class JamServiceTest {

    /** Mutable clock — tests jump through a jam's 60-minute life in microseconds. */
    static final class TestClock extends Clock {
        Instant now = Instant.parse("2026-11-12T10:00:00Z");

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }
    }

    private static final SongResponse SONG =
            new SongResponse(1L, "dQw4w9WgXcQ", "Never Gonna Give You Up", "Rick Astley", null, "en", 1987, null);

    private TestClock clock;
    private SimpMessagingTemplate messaging;
    private JamService service;

    private JamService newService(int maxActive, int maxMembers, int createLimit) {
        var jam = new RetrooProperties.Jam(Duration.ofMinutes(60), Duration.ofMinutes(60), Duration.ofMinutes(5),
                maxActive, maxMembers, new RetrooProperties.RateLimit(createLimit, Duration.ofHours(1)),
                new RetrooProperties.RateLimit(5, Duration.ofSeconds(10)), 100, 50, Duration.ofSeconds(15));
        var props = new RetrooProperties(null, null, null, null, null, jam);
        return new JamService(props,
                new RateLimiter(createLimit, Duration.ofHours(1), clock),
                new RateLimiter(5, Duration.ofSeconds(10), clock),
                new YouTubeLinkParser(), messaging, clock);
    }

    @BeforeEach
    void setUp() {
        clock = new TestClock();
        messaging = mock(SimpMessagingTemplate.class);
        service = newService(50, 50, 100);
    }

    private JamModels.CreateJamResponse create() {
        return service.create(new CreateJamRequest("  Friday   night ", "Omkar"), "1.2.3.4");
    }

    private List<JamEvent> events() {
        var captor = ArgumentCaptor.forClass(Object.class);
        verify(messaging, atLeast(0)).convertAndSend(anyString(), captor.capture());
        return captor.getAllValues().stream().map(JamEvent.class::cast).toList();
    }

    // ---- create ---------------------------------------------------------------------------------------

    @Test
    void createReturnsCodeTokenAndOneHourLifetime() {
        var created = create();

        assertThat(created.jam().code()).matches("[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}");
        assertThat(created.jam().name()).isEqualTo("Friday night");      // whitespace normalised
        assertThat(created.hostToken()).hasSizeGreaterThanOrEqualTo(43); // 32 bytes base64url
        assertThat(created.jam().expiresAt()).isEqualTo(clock.now.plus(Duration.ofMinutes(60)));
        assertThat(created.jam().extended()).isFalse();
        assertThat(service.list()).extracting(JamModels.JamSummary::code).containsExactly(created.jam().code());
    }

    @Test
    void createIsRateLimitedPerIp() {
        service = newService(50, 50, 3);
        for (int i = 0; i < 3; i++) {
            service.create(new CreateJamRequest("jam " + i, "host"), "9.9.9.9");
        }
        assertThatThrownBy(() -> service.create(new CreateJamRequest("one more", "host"), "9.9.9.9"))
                .isInstanceOf(ApiException.TooManyRequests.class);
        // a different IP is unaffected
        service.create(new CreateJamRequest("other", "host"), "8.8.8.8");
    }

    @Test
    void createFailsWith503WhenAllRoomsAreBusy() {
        service = newService(2, 50, 100);
        create();
        create();
        assertThatThrownBy(this::create).isInstanceOf(ApiException.ServiceUnavailable.class);
    }

    @Test
    void blankNamesAfterNormalisationAreRejected() {
        assertThatThrownBy(() -> service.create(new CreateJamRequest("   ", "x"), "1.1.1.1"))
                .isInstanceOf(ApiException.BadRequest.class);
    }

    // ---- extend & end ---------------------------------------------------------------------------------

    @Test
    void hostCanExtendExactlyOnce() {
        var created = create();
        String code = created.jam().code();

        assertThatThrownBy(() -> service.extend(code, "wrong-token")).isInstanceOf(ApiException.Forbidden.class);

        var extended = service.extend(code, created.hostToken());
        assertThat(extended.extended()).isTrue();
        assertThat(extended.expiresAt()).isEqualTo(clock.now.plus(Duration.ofMinutes(120)));

        assertThatThrownBy(() -> service.extend(code, created.hostToken())).isInstanceOf(ApiException.Conflict.class);
        assertThat(events()).extracting(JamEvent::type).contains(EventType.EXTENDED);
    }

    @Test
    void hostEndsJamForEveryone() {
        var created = create();
        service.end(created.jam().code(), created.hostToken());

        assertThat(service.list()).isEmpty();
        assertThatThrownBy(() -> service.snapshot(created.jam().code())).isInstanceOf(ApiException.NotFound.class);
        assertThat(events()).anySatisfy(e -> {
            assertThat(e.type()).isEqualTo(EventType.ENDED);
            assertThat(((EndedPayload) e.payload()).reason()).isEqualTo(EndReason.HOST_ENDED);
        });
    }

    // ---- sweeper --------------------------------------------------------------------------------------

    @Test
    void sweeperWarnsOnceThenRemovesAtExpiry() {
        var created = create();
        String code = created.jam().code();

        clock.advance(Duration.ofMinutes(54));
        service.sweep();
        assertThat(events()).extracting(JamEvent::type).doesNotContain(EventType.ENDING_SOON);

        clock.advance(Duration.ofMinutes(1)); // 5 min left
        service.sweep();
        service.sweep(); // must not warn twice
        assertThat(events()).filteredOn(e -> e.type() == EventType.ENDING_SOON).hasSize(1);

        clock.advance(Duration.ofMinutes(5));
        service.sweep();
        assertThat(service.activeCount()).isZero();
        assertThatThrownBy(() -> service.snapshot(code)).isInstanceOf(ApiException.NotFound.class);
        assertThat(events()).anySatisfy(e -> assertThat(e.type()).isEqualTo(EventType.ENDED));
    }

    @Test
    void extendedJamOutlivesTheFirstDeadline() {
        var created = create();
        service.extend(created.jam().code(), created.hostToken());
        clock.advance(Duration.ofMinutes(90));
        service.sweep();
        assertThat(service.activeCount()).isEqualTo(1);
        clock.advance(Duration.ofMinutes(30));
        service.sweep();
        assertThat(service.activeCount()).isZero();
    }

    // ---- membership -----------------------------------------------------------------------------------

    @Test
    void joinLeaveAndCapacity() {
        service = newService(50, 2, 100);
        var created = create();
        String code = created.jam().code();

        service.join(code, "s1", "Riya", null);
        service.join(code, "s1", "Riya", null); // idempotent re-join
        service.join(code, "s2", "Avi", null);
        assertThatThrownBy(() -> service.join(code, "s3", "Late", null))
                .isInstanceOf(JamException.class)
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.JAM_FULL);

        assertThat(service.snapshot(code).members()).containsExactly("Riya", "Avi");
        service.leaveAll("s1");
        assertThat(service.snapshot(code).members()).containsExactly("Avi");
        assertThat(service.snapshot(code).chat()).extracting(ChatMessage::text)
                .containsExactly("Riya joined", "Avi joined", "Riya left");
    }

    @Test
    void hostRejoiningWithTokenKeepsHostName() {
        var created = create();
        service.join(created.jam().code(), "s1", "Impostor", created.hostToken());
        assertThat(service.snapshot(created.jam().code()).members()).containsExactly("Omkar");
    }

    // ---- chat -----------------------------------------------------------------------------------------

    @Test
    void chatRequiresMembershipAndUsesServerSideAuthor() {
        String code = create().jam().code();
        assertThatThrownBy(() -> service.chat(code, "stranger", "hi"))
                .isInstanceOf(JamException.class)
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.FORBIDDEN);

        service.join(code, "s1", "Riya", null);
        service.chat(code, "s1", "  hello   there ");
        var last = service.snapshot(code).chat().get(1);
        assertThat(last.author()).isEqualTo("Riya");
        assertThat(last.text()).isEqualTo("hello there");
        assertThat(last.kind()).isEqualTo(ChatKind.TEXT);
    }

    @Test
    void chatDetectsPlaylistLinks() {
        String code = create().jam().code();
        service.join(code, "s1", "Riya", null);
        service.chat(code, "s1", "try this (https://www.youtube.com/playlist?list=PLjam123&si=x)!");

        var msg = service.snapshot(code).chat().get(1);
        assertThat(msg.kind()).isEqualTo(ChatKind.PLAYLIST);
        assertThat(msg.playlistUrl()).isEqualTo("https://music.youtube.com/playlist?list=PLjam123");
    }

    @Test
    void chatIsRateLimitedAndLengthChecked() {
        String code = create().jam().code();
        service.join(code, "s1", "Riya", null);
        assertThatThrownBy(() -> service.chat(code, "s1", "x".repeat(281)))
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.INVALID);

        for (int i = 0; i < 4; i++) {        // first attempt above counted too → 5 in the window
            service.chat(code, "s1", "msg " + i);
        }
        assertThatThrownBy(() -> service.chat(code, "s1", "spam"))
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.RATE_LIMITED);

        clock.advance(Duration.ofSeconds(10));
        service.chat(code, "s1", "ok again");
    }

    @Test
    void chatHistoryIsBounded() {
        String code = create().jam().code();
        service.join(code, "s1", "Riya", null);
        for (int i = 0; i < 120; i++) {
            clock.advance(Duration.ofSeconds(3)); // stay under the chat rate limit
            service.chat(code, "s1", "m" + i);
        }
        var chat = service.snapshot(code).chat();
        assertThat(chat).hasSize(50);                                  // snapshot limit
        assertThat(chat.get(chat.size() - 1).text()).isEqualTo("m119");
    }

    // ---- playback control -----------------------------------------------------------------------------

    @Test
    void onlyHostControlsPlayback() {
        var created = create();
        String code = created.jam().code();
        assertThatThrownBy(() -> service.control(code, new ControlMessage("nope", ControlAction.LOAD, SONG, 0.0)))
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.FORBIDDEN);
        assertThatThrownBy(() -> service.control(code, new ControlMessage(created.hostToken(), ControlAction.PLAY, null, null)))
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.INVALID); // nothing loaded
    }

    @Test
    void controlStampsServerTimeAndExtrapolatesPosition() {
        var created = create();
        String code = created.jam().code();
        String token = created.hostToken();

        PlaybackState loaded = service.control(code, new ControlMessage(token, ControlAction.LOAD, SONG, null));
        assertThat(loaded.playing()).isTrue();
        assertThat(loaded.positionSec()).isZero();
        assertThat(loaded.updatedAt()).isEqualTo(clock.millis());

        clock.advance(Duration.ofSeconds(30));
        PlaybackState paused = service.control(code, new ControlMessage(token, ControlAction.PAUSE, null, null));
        assertThat(paused.playing()).isFalse();
        assertThat(paused.positionSec()).isEqualTo(30.0); // extrapolated from the server clock

        PlaybackState seeked = service.control(code, new ControlMessage(token, ControlAction.SEEK, null, 95.5));
        assertThat(seeked.playing()).isFalse();
        assertThat(seeked.positionSec()).isEqualTo(95.5);

        assertThat(service.snapshot(code).playback()).isEqualTo(seeked);
        assertThat(events()).filteredOn(e -> e.type() == EventType.STATE).hasSize(3);
    }

    @Test
    void invalidVideoIdIsRejected() {
        var created = create();
        var bad = new SongResponse(1L, "<script>", "t", "a", null, "en", null, null);
        assertThatThrownBy(() -> service.control(created.jam().code(),
                new ControlMessage(created.hostToken(), ControlAction.LOAD, bad, 0.0)))
                .extracting(e -> ((JamException) e).code()).isEqualTo(JamException.Code.INVALID);
        verify(messaging, org.mockito.Mockito.never()).convertAndSend(anyString(), (Object) any(PlaybackState.class));
    }
}
