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

    /** {@code POST /api/jams}. Lengths re-checked after whitespace normalisation in the service. */
    public record CreateJamRequest(
            @NotBlank(message = "is required") @Size(max = 40, message = "must be at most 40 characters")
            String name,
            @NotBlank(message = "is required") @Size(max = 30, message = "must be at most 30 characters")
            String hostName) {
    }

    /** The host token appears exactly once, here. It is never part of a snapshot or event. */
    public record CreateJamResponse(JamSnapshot jam, String hostToken) {
    }

    /** Lobby row. */
    public record JamSummary(String code, String name, String hostName, int memberCount,
                             Instant createdAt, Instant expiresAt) {
    }

    /**
     * Everything a client needs to render a jam it just opened (summary + state + recent chat).
     * {@code playback} is serialised as {@code null} before the host loads a song — the app-wide
     * {@code non_null} inclusion would otherwise drop it and break the {@code PlaybackState | null} contract.
     */
    public record JamSnapshot(String code, String name, String hostName, int memberCount,
                              Instant createdAt, Instant expiresAt, boolean extended, List<String> members,
                              @JsonInclude(JsonInclude.Include.ALWAYS) PlaybackState playback,
                              List<ChatMessage> chat, long serverTime) {
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

    public record JoinMessage(String name, String hostToken) {
    }

    public record ChatInput(String text) {
    }

    public enum ControlAction { LOAD, PLAY, PAUSE, SEEK }

    public record ControlMessage(String hostToken, ControlAction action, SongResponse song, Double positionSec) {
    }

    // ---- STOMP: server → client ---------------------------------------------------------------------------

    public enum EventType { STATE, CHAT, MEMBERS, EXTENDED, ENDING_SOON, ENDED }

    /** Envelope for everything on {@code /topic/jam/{code}}; {@code serverTime} lets clients compute clock offset. */
    public record JamEvent(EventType type, Object payload, long serverTime) {
    }

    public record MembersPayload(List<String> members, int memberCount) {
    }

    public record EndingSoonPayload(Instant expiresAt) {
    }

    public enum EndReason { EXPIRED, HOST_ENDED }

    public record EndedPayload(EndReason reason) {
    }

    /** Sent only to the offending session on {@code /user/queue/jam-errors}. */
    public record JamError(JamException.Code code, String message) {
    }
}
