package com.retroo.jam;

import com.retroo.config.RateLimitConfig;
import com.retroo.config.RetrooProperties;
import com.retroo.jam.JamModels.ChatKind;
import com.retroo.jam.JamModels.ChatMessage;
import com.retroo.jam.JamModels.ControlMessage;
import com.retroo.jam.JamModels.CreateJamRequest;
import com.retroo.jam.JamModels.CreateJamResponse;
import com.retroo.jam.JamModels.EndReason;
import com.retroo.jam.JamModels.EndedPayload;
import com.retroo.jam.JamModels.EndingSoonPayload;
import com.retroo.jam.JamModels.EventType;
import com.retroo.jam.JamModels.JamEvent;
import com.retroo.jam.JamModels.JamSnapshot;
import com.retroo.jam.JamModels.JamSummary;
import com.retroo.jam.JamModels.MembersPayload;
import com.retroo.jam.JamModels.PlaybackState;
import com.retroo.service.RateLimiter;
import com.retroo.service.YouTubeLinkParser;
import com.retroo.web.dto.SongResponse;
import com.retroo.web.error.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Jam sessions: watch-together rooms where one host drives playback and everyone chats (gemini.md §8).
 *
 * <p><b>Why in memory?</b> A jam lives at most two hours and nothing about it is worth keeping afterwards, so a
 * {@link ConcurrentHashMap} is the whole "database": no schema, no cleanup jobs, no stale rows; the sweeper simply
 * drops expired entries. The cost is that a restart ends every jam and state is per instance — acceptable for this
 * feature; scaling out would move it to Redis (hash per jam + pub/sub).</p>
 *
 * <p><b>Concurrency:</b> the map handles concurrent create/remove; each {@link JamSession} serialises its own
 * mutations. Broadcasting always happens <i>after</i> a mutation returns, never while holding a session lock.</p>
 *
 * <p><b>Trust model:</b> no accounts. The creator receives a random 256-bit {@code hostToken} once; every
 * privileged action (control, extend, end) must present it and it is compared in constant time. Chat authors are
 * taken from the server-side member registry, so a client cannot speak under someone else's name.</p>
 */
@Service
public class JamService {

    public static final String TOPIC_PREFIX = "/topic/jam/";

    private static final Logger log = LoggerFactory.getLogger(JamService.class);
    private static final String CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
    private static final int CODE_LENGTH = 6;
    private static final int MAX_CHAT_CHARS = 280;
    private static final int MAX_DISPLAY_NAME = 30;
    private static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    private final Map<String, JamSession> jams = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    private final RetrooProperties.Jam config;
    private final RateLimiter createLimiter;
    private final RateLimiter chatLimiter;
    private final YouTubeLinkParser linkParser;
    private final SimpMessagingTemplate messaging;
    private final Clock clock;

    public JamService(RetrooProperties properties,
                      @Qualifier(RateLimitConfig.JAM_CREATE) RateLimiter createLimiter,
                      @Qualifier(RateLimitConfig.JAM_CHAT) RateLimiter chatLimiter,
                      YouTubeLinkParser linkParser, SimpMessagingTemplate messaging, Clock clock) {
        this.config = properties.jam();
        this.createLimiter = createLimiter;
        this.chatLimiter = chatLimiter;
        this.linkParser = linkParser;
        this.messaging = messaging;
        this.clock = clock;
    }

    // =====================================================================================================
    // REST use-cases (errors → ApiException → ProblemDetail)
    // =====================================================================================================

    public CreateJamResponse create(CreateJamRequest request, String clientIp) {
        var decision = createLimiter.tryAcquire("jam-create:" + clientIp);
        if (!decision.allowed()) {
            long seconds = Math.max(1, decision.retryAfter().toSeconds());
            throw new ApiException.TooManyRequests(
                    "You've started a lot of jams. Try again in " + (seconds + 59) / 60 + " min.", seconds);
        }
        String name = requireText(normalise(request.name()), 40, "name");
        String hostName = requireText(normalise(request.hostName()), MAX_DISPLAY_NAME, "hostName");

        // Capacity check and insert are not one atomic step, so two racing creates could overshoot the cap by a
        // few — harmless for a soft resource limit, and far cheaper than a global lock.
        if (jams.size() >= config.maxActive()) {
            throw new ApiException.ServiceUnavailable("All jam rooms are busy right now. Try again in a few minutes.");
        }

        String token = newHostToken();
        JamSession session;
        String code;
        do {
            code = newCode();
            session = new JamSession(code, name, hostName, token, clock.instant(), config.ttl(), config.chatHistory());
        } while (jams.putIfAbsent(code, session) != null); // collision → draw again (32^6 ≈ 1e9 codes)

        log.info("Jam {} created by '{}' ({} active)", code, hostName, jams.size());
        return new CreateJamResponse(snapshotOf(session), token);
    }

    /** Lobby: active jams, newest first. Expired-but-not-yet-swept jams are hidden. */
    public List<JamSummary> list() {
        Instant now = clock.instant();
        return jams.values().stream()
                .filter(j -> !j.isExpired(now))
                .sorted(Comparator.comparing(JamSession::createdAt).reversed())
                .map(JamSession::summary)
                .toList();
    }

    public JamSnapshot snapshot(String code) {
        return snapshotOf(requireJam(code));
    }

    /** One extension of {@code config.extension()}; host only. */
    public JamSnapshot extend(String code, String hostToken) {
        JamSession jam = requireJam(code);
        if (!jam.isHost(hostToken)) {
            throw new ApiException.Forbidden("Only the host can extend this jam.");
        }
        if (!jam.extend(config.extension())) {
            throw new ApiException.Conflict("This jam has already been extended once.");
        }
        long minutes = config.extension().toMinutes();
        addSystemChat(jam, "The host extended the jam by " + minutes + " minutes.");
        JamSnapshot snapshot = snapshotOf(jam);
        publish(jam.code(), EventType.EXTENDED, snapshot);
        return snapshot;
    }

    /** Host ends the jam for everyone. */
    public void end(String code, String hostToken) {
        JamSession jam = requireJam(code);
        if (!jam.isHost(hostToken)) {
            throw new ApiException.Forbidden("Only the host can end this jam.");
        }
        remove(jam, EndReason.HOST_ENDED);
    }

    // =====================================================================================================
    // STOMP use-cases (errors → JamException → /user/queue/jam-errors)
    // =====================================================================================================

    /**
     * Registers the STOMP session as a member. {@code hostToken} is optional and only lets the host rejoin under
     * their own name; it grants nothing else here (control re-checks the token on every command).
     */
    public void join(String code, String sessionId, String requestedName, String hostToken) {
        JamSession jam = requireLiveJam(code);
        String name = jam.isHost(hostToken)
                ? jam.summary().hostName()
                : normalise(requestedName);
        if (name == null || name.isEmpty() || name.length() > MAX_DISPLAY_NAME) {
            throw new JamException(JamException.Code.INVALID, "Pick a name of 1–" + MAX_DISPLAY_NAME + " characters.");
        }
        boolean wasMember = jam.hasMember(sessionId);
        if (!jam.addMember(sessionId, name, config.maxMembers())) {
            throw new JamException(JamException.Code.JAM_FULL,
                    "This jam is full (" + config.maxMembers() + " people).");
        }
        if (!wasMember) {
            addSystemChat(jam, name + " joined");
            publishMembers(jam);
        }
    }

    public void leave(String code, String sessionId) {
        JamSession jam = jams.get(normaliseCode(code));
        if (jam != null) {
            removeMember(jam, sessionId);
        }
    }

    /** Called when a socket closes: the session leaves every jam it was in (normally just one). */
    public void leaveAll(String sessionId) {
        jams.values().forEach(jam -> removeMember(jam, sessionId));
    }

    public void chat(String code, String sessionId, String rawText) {
        JamSession jam = requireLiveJam(code);
        String author = jam.memberName(sessionId);
        if (author == null) {
            throw new JamException(JamException.Code.FORBIDDEN, "Join the jam before chatting.");
        }
        if (!chatLimiter.tryAcquire(jam.code() + ":" + sessionId).allowed()) {
            var limit = config.chatRateLimit();
            throw new JamException(JamException.Code.RATE_LIMITED, "Slow down — max " + limit.maxRequests()
                    + " messages every " + limit.window().toSeconds() + " seconds.");
        }
        String text = normalise(rawText);
        if (text == null || text.isEmpty() || text.length() > MAX_CHAT_CHARS) {
            throw new JamException(JamException.Code.INVALID, "Messages must be 1–" + MAX_CHAT_CHARS + " characters.");
        }
        var playlist = linkParser.findPlaylistInText(text);
        var message = new ChatMessage(UUID.randomUUID().toString(),
                playlist.isPresent() ? ChatKind.PLAYLIST : ChatKind.TEXT, author, text,
                playlist.map(YouTubeLinkParser.PlaylistRef::canonicalUrl).orElse(null), clock.millis());
        jam.addChat(message);
        publish(jam.code(), EventType.CHAT, message);
    }

    /**
     * Host playback command. The server is the clock: it stamps {@code updatedAt} so every guest extrapolates the
     * position from the same reference, regardless of the host's own clock skew.
     */
    public PlaybackState control(String code, ControlMessage command) {
        JamSession jam = requireLiveJam(code);
        if (command == null || !jam.isHost(command.hostToken())) {
            throw new JamException(JamException.Code.FORBIDDEN, "Only the host controls playback.");
        }
        if (command.action() == null) {
            throw new JamException(JamException.Code.INVALID, "Missing action.");
        }
        Double requested = command.positionSec();
        if (requested != null && (requested.isNaN() || requested.isInfinite() || requested < 0 || requested > 86_400)) {
            throw new JamException(JamException.Code.INVALID, "Invalid position.");
        }
        long now = clock.millis();
        PlaybackState previous = jam.playback();

        PlaybackState next = switch (command.action()) {
            case LOAD -> {
                SongResponse song = command.song();
                if (song == null || song.videoId() == null || !VIDEO_ID.matcher(song.videoId()).matches()
                        || song.title() == null) {
                    throw new JamException(JamException.Code.INVALID, "LOAD needs a song with a valid videoId.");
                }
                yield new PlaybackState(song, true, requested == null ? 0 : requested, now);
            }
            case PLAY, PAUSE, SEEK -> {
                if (previous == null) {
                    throw new JamException(JamException.Code.INVALID, "Nothing is loaded yet.");
                }
                double position = requested != null ? requested : livePosition(previous, now);
                boolean playing = switch (command.action()) {
                    case PLAY -> true;
                    case PAUSE -> false;
                    default -> previous.playing();
                };
                yield new PlaybackState(previous.song(), playing, position, now);
            }
        };
        jam.setPlayback(next);
        publish(jam.code(), EventType.STATE, next);
        return next;
    }

    // =====================================================================================================
    // Lifetime
    // =====================================================================================================

    /**
     * Runs every {@code retroo.jam.sweep-interval}: warns jams nearing their deadline once, and ends + deletes
     * expired ones. Precision is ±one interval (15 s) — fine for a 60-minute room.
     */
    @Scheduled(fixedDelayString = "${retroo.jam.sweep-interval}")
    public void sweep() {
        Instant now = clock.instant();
        for (JamSession jam : List.copyOf(jams.values())) {
            if (jam.isExpired(now)) {
                remove(jam, EndReason.EXPIRED);
            } else if (jam.shouldWarnEndingSoon(now, config.endingSoonBefore())) {
                publish(jam.code(), EventType.ENDING_SOON, new EndingSoonPayload(jam.expiresAt()));
            }
        }
    }

    public int activeCount() {
        return jams.size();
    }

    // =====================================================================================================
    // internals
    // =====================================================================================================

    private void remove(JamSession jam, EndReason reason) {
        if (jams.remove(jam.code(), jam)) {
            log.info("Jam {} ended ({})", jam.code(), reason);
            publish(jam.code(), EventType.ENDED, new EndedPayload(reason));
        }
    }

    private void removeMember(JamSession jam, String sessionId) {
        String name = jam.removeMember(sessionId);
        if (name != null && jams.containsKey(jam.code())) {
            addSystemChat(jam, name + " left");
            publishMembers(jam);
        }
    }

    private void addSystemChat(JamSession jam, String text) {
        var message = new ChatMessage(UUID.randomUUID().toString(), ChatKind.SYSTEM, null, text, null, clock.millis());
        jam.addChat(message);
        publish(jam.code(), EventType.CHAT, message);
    }

    private void publishMembers(JamSession jam) {
        List<String> names = jam.memberNames();
        publish(jam.code(), EventType.MEMBERS, new MembersPayload(names, names.size()));
    }

    private void publish(String code, EventType type, Object payload) {
        messaging.convertAndSend(TOPIC_PREFIX + code, new JamEvent(type, payload, clock.millis()));
    }

    private JamSnapshot snapshotOf(JamSession jam) {
        return jam.snapshot(config.snapshotChat(), clock.millis());
    }

    private JamSession requireJam(String code) {
        JamSession jam = jams.get(normaliseCode(code));
        if (jam == null || jam.isExpired(clock.instant())) {
            throw new ApiException.NotFound("This jam doesn't exist or has ended.");
        }
        return jam;
    }

    private JamSession requireLiveJam(String code) {
        JamSession jam = jams.get(normaliseCode(code));
        if (jam == null || jam.isExpired(clock.instant())) {
            throw new JamException(JamException.Code.NOT_FOUND, "This jam doesn't exist or has ended.");
        }
        return jam;
    }

    static double livePosition(PlaybackState state, long nowMillis) {
        return state.playing()
                ? state.positionSec() + Math.max(0, nowMillis - state.updatedAt()) / 1000.0
                : state.positionSec();
    }

    private String newCode() {
        var sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
        }
        return sb.toString();
    }

    private String newHostToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String normaliseCode(String code) {
        return code == null ? "" : code.trim().toUpperCase();
    }

    /** Trim, collapse whitespace, strip control characters (same rules as the playlist wall). */
    static String normalise(String s) {
        return s == null ? null : s.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
    }

    private static String requireText(String value, int max, String field) {
        if (value == null || value.isEmpty() || value.length() > max) {
            throw new ApiException.BadRequest("'" + field + "' must be 1–" + max + " characters.");
        }
        return value;
    }
}
