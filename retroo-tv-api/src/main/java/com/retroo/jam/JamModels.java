package com.retroo.jam;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.retroo.web.dto.SongResponse;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * Wire contract for jam sessions (gemini.md §8) — every record here is serialised as-is by Jackson.
 * Grouped in one file because they only make sense together; each is an immutable snapshot, so a value handed to
 * the broker can never change underneath a slow subscriber.
 */
public final class JamModels {

    private JamModels() {
    }

    // ---- REST -------------------------------------------------------------------------------------------

    /** Open jams are listed in the lobby and anyone with the code joins; private ones need a key or the host's OK. */
    public enum Visibility { OPEN, PRIVATE }

    /**
     * {@code POST /api/jams}. Lengths re-checked after whitespace normalisation in the service.
     * {@code visibility} is optional (default {@link Visibility#OPEN}).
     */
    public record CreateJamRequest(
            @NotBlank(message = "is required") @Size(max = 40, message = "must be at most 40 characters")
            String name,
            @NotBlank(message = "is required") @Size(max = 30, message = "must be at most 30 characters")
            String hostName,
            Visibility visibility) {

        public CreateJamRequest(String name, String hostName) {
            this(name, hostName, null);
        }
    }

    /**
     * The host token appears exactly once, here; never in a snapshot or event. {@code inviteToken} is the private
     * invite-link secret, also host-only (fetch it again with {@code GET /api/jams/{code}/invite}).
     */
    public record CreateJamResponse(JamSnapshot jam, String hostToken, String inviteToken) {
    }

    /** {@code POST /api/jams/{code}/visibility}. */
    public record VisibilityRequest(Visibility visibility) {
    }

    /** {@code GET|POST /api/jams/{code}/invite} (host only). */
    public record InviteResponse(String inviteToken) {
    }

    /** Lobby row. */
    public record JamSummary(String code, String name, String hostName, int memberCount,
                             Instant createdAt, Instant expiresAt, Visibility visibility) {
    }

    /**
     * Everything a client needs to render a jam it just opened (summary + state + recent chat).
     * {@code playback} is serialised as {@code null} before the host loads a song — the app-wide
     * {@code non_null} inclusion would otherwise drop it and break the {@code PlaybackState | null} contract.
     */
    public record JamSnapshot(String code, String name, String hostName, int memberCount,
                              Instant createdAt, Instant expiresAt, boolean extended, List<String> members,
                              @JsonInclude(JsonInclude.Include.ALWAYS) PlaybackState playback,
                              List<ChatMessage> chat, long serverTime, Visibility visibility, boolean locked) {
    }

    // ---- shared state -----------------------------------------------------------------------------------

    /**
     * Host playback as of {@code updatedAt} (epoch ms, server clock). Guests extrapolate the live position:
     * {@code positionSec + (playing ? (serverNow - updatedAt) / 1000 : 0)}.
     */
    public record PlaybackState(SongResponse song, boolean playing, double positionSec, long updatedAt) {
    }

    public enum ChatKind { TEXT, PLAYLIST, SYSTEM }

    /** {@code playlistUrl} is set only for {@link ChatKind#PLAYLIST} (canonical music.youtube.com form). */
    public record ChatMessage(String id, ChatKind kind, String author, String text, String playlistUrl,
                              long sentAt) {
    }

    // ---- STOMP: client → server ---------------------------------------------------------------------------

    /** {@code key} = invite token or personal pass, needed to join a private jam (the host uses {@code hostToken}). */
    public record JoinMessage(String name, String hostToken, String key) {
    }

    /** Ask the host of a private jam to be let in. */
    public record RequestMessage(String name) {
    }

    /** Host's answer to a join request. */
    public record AdmitMessage(String hostToken, String requestId, Boolean allow) {
    }

    public record ChatInput(String text) {
    }

    public enum ControlAction { LOAD, PLAY, PAUSE, SEEK }

    public record ControlMessage(String hostToken, ControlAction action, SongResponse song, Double positionSec) {
    }

    // ---- STOMP: server → client ---------------------------------------------------------------------------

    public enum EventType { STATE, CHAT, MEMBERS, EXTENDED, ENDING_SOON, ENDED, REQUESTS, VISIBILITY }

    /** Envelope for everything on {@code /topic/jam/{code}}; {@code serverTime} lets clients compute clock offset. */
    public record JamEvent(EventType type, Object payload, long serverTime) {
    }

    public record MembersPayload(List<String> members, int memberCount) {
    }

    public record EndingSoonPayload(Instant expiresAt) {
    }

    /** A pending "let me in" for a private jam. {@code id} is random — never the requester's session id. */
    public record JoinRequest(String id, String name) {
    }

    public record RequestsPayload(List<JoinRequest> requests) {
    }

    public record VisibilityPayload(Visibility visibility) {
    }

    public enum AccessType { APPROVED, DECLINED }

    /**
     * Sent only to the requester on {@code /user/queue/jam-access}. APPROVED carries a personal {@code pass} (their
     * key from now on, also after a reload) and the full snapshot to enter with.
     */
    public record AccessMessage(AccessType type, String code, String pass, JamSnapshot jam) {
    }

    public enum EndReason { EXPIRED, HOST_ENDED }

    public record EndedPayload(EndReason reason) {
    }

    /** Sent only to the offending session on {@code /user/queue/jam-errors}. */
    public record JamError(JamException.Code code, String message) {
    }
}
