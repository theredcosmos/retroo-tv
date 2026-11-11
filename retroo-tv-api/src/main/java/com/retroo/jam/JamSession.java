package com.retroo.jam;

import com.retroo.jam.JamModels.ChatMessage;
import com.retroo.jam.JamModels.JamSnapshot;
import com.retroo.jam.JamModels.JamSummary;
import com.retroo.jam.JamModels.PlaybackState;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One live jam, held only in memory.
 *
 * <p><b>Thread-safety:</b> STOMP messages for the same jam arrive on different inbound-channel threads, and the
 * sweeper runs on the scheduler thread, so every method that touches mutable state is {@code synchronized} on the
 * session. The lock is per jam — two different jams never contend — and the critical sections are tiny
 * (no I/O, no broadcasting inside the lock; {@link JamService} broadcasts after the state change returns).</p>
 *
 * <p>The host token is kept here and never leaves this class except through {@link #isHost(String)}.</p>
 */
final class JamSession {

    private final String code;
    private final String name;
    private final String hostName;
    private final byte[] hostToken;
    private final Instant createdAt;
    private final int chatHistory;

    private Instant expiresAt;
    private boolean extended;
    private boolean endingSoonSent;
    private PlaybackState playback;
    /** STOMP session id → display name. Insertion order = join order (nice member list). */
    private final Map<String, String> members = new LinkedHashMap<>();
    private final Deque<ChatMessage> chat = new ArrayDeque<>();

    JamSession(String code, String name, String hostName, String hostToken, Instant createdAt, Duration ttl,
               int chatHistory) {
        this.code = code;
        this.name = name;
        this.hostName = hostName;
        this.hostToken = hostToken.getBytes(StandardCharsets.UTF_8);
        this.createdAt = createdAt;
        this.expiresAt = createdAt.plus(ttl);
        this.chatHistory = chatHistory;
    }

    String code() {
        return code;
    }

    /** Constant-time comparison: response timing must not reveal how many leading characters were right. */
    boolean isHost(String token) {
        return token != null && MessageDigest.isEqual(hostToken, token.getBytes(StandardCharsets.UTF_8));
    }

    // ---- lifetime ---------------------------------------------------------------------------------------

    synchronized Instant expiresAt() {
        return expiresAt;
    }

    synchronized boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    /** @return false if the one allowed extension was already used. */
    synchronized boolean extend(Duration by) {
        if (extended) {
            return false;
        }
        extended = true;
        expiresAt = expiresAt.plus(by);
        endingSoonSent = false; // the warning should fire again before the new deadline
        return true;
    }

    /** True exactly once per deadline, when the remaining time first drops to {@code threshold} or below. */
    synchronized boolean shouldWarnEndingSoon(Instant now, Duration threshold) {
        if (endingSoonSent || now.plus(threshold).isBefore(expiresAt)) {
            return false;
        }
        endingSoonSent = true;
        return true;
    }

    // ---- members ----------------------------------------------------------------------------------------

    synchronized boolean hasMember(String sessionId) {
        return members.containsKey(sessionId);
    }

    synchronized String memberName(String sessionId) {
        return members.get(sessionId);
    }

    synchronized int memberCount() {
        return members.size();
    }

    /**
     * @return {@code true} if added, {@code false} if the jam is full. Re-joining from the same STOMP session just
     * updates the name (idempotent) and never counts against the cap.
     */
    synchronized boolean addMember(String sessionId, String displayName, int maxMembers) {
        if (!members.containsKey(sessionId) && members.size() >= maxMembers) {
            return false;
        }
        members.put(sessionId, displayName);
        return true;
    }

    /** @return the removed member's name, or null if that session was not a member. */
    synchronized String removeMember(String sessionId) {
        return members.remove(sessionId);
    }

    synchronized List<String> memberNames() {
        return List.copyOf(members.values());
    }

    // ---- playback & chat --------------------------------------------------------------------------------

    synchronized PlaybackState playback() {
        return playback;
    }

    synchronized void setPlayback(PlaybackState state) {
        this.playback = state;
    }

    /** Appends and trims to the configured history size (a ring buffer, oldest dropped first). */
    synchronized void addChat(ChatMessage message) {
        chat.addLast(message);
        while (chat.size() > chatHistory) {
            chat.removeFirst();
        }
    }

    synchronized List<ChatMessage> recentChat(int limit) {
        List<ChatMessage> all = new ArrayList<>(chat);
        return List.copyOf(all.subList(Math.max(0, all.size() - limit), all.size()));
    }

    // ---- views ------------------------------------------------------------------------------------------

    synchronized JamSummary summary() {
        return new JamSummary(code, name, hostName, members.size(), createdAt, expiresAt);
    }

    synchronized JamSnapshot snapshot(int chatLimit, long serverTime) {
        return new JamSnapshot(code, name, hostName, members.size(), createdAt, expiresAt, extended,
                List.copyOf(members.values()), playback, recentChat(chatLimit), serverTime);
    }

    Instant createdAt() {
        return createdAt;
    }
}
