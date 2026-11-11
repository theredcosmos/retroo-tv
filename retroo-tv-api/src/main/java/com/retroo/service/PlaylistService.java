package com.retroo.service;

import com.retroo.domain.SharedPlaylist;
import com.retroo.repository.SharedPlaylistRepository;
import com.retroo.web.dto.PageResponse;
import com.retroo.web.dto.PlaylistResponse;
import com.retroo.web.dto.SharePlaylistRequest;
import com.retroo.web.error.ApiException;
import com.retroo.config.RateLimitConfig;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.Clock;

/**
 * "Share your playlist" use-case.
 *
 * <p>Flow of {@link #share}:</p>
 * <ol>
 *   <li>Rate-limit by client IP (429 + Retry-After when exceeded).</li>
 *   <li>Parse + allow-list the link → canonical YT Music URL (400 if not a YouTube playlist).</li>
 *   <li>Reject a duplicate (same playlist + same display name) with 409. The DB unique constraint is the
 *       real guarantee; the pre-check only exists to give a friendly message in the common case.</li>
 *   <li>Persist, then publish a {@link PlaylistShared} event.</li>
 *   <li>{@link #broadcast} runs <b>after commit</b> and pushes the new entry to {@code /topic/playlists}, so
 *       clients never see an entry that was rolled back.</li>
 * </ol>
 */
@Service
public class PlaylistService {

    public static final String TOPIC = "/topic/playlists";
    private static final int MAX_PAGE_SIZE = 50;

    /** Domain event raised inside the transaction, consumed after commit. */
    public record PlaylistShared(PlaylistResponse playlist) {
    }

    private final SharedPlaylistRepository repository;
    private final YouTubeLinkParser linkParser;
    private final RateLimiter rateLimiter;
    private final ApplicationEventPublisher events;
    private final SimpMessagingTemplate messaging;
    private final Clock clock;

    public PlaylistService(SharedPlaylistRepository repository, YouTubeLinkParser linkParser,
                           @Qualifier(RateLimitConfig.PLAYLIST_SHARE) RateLimiter rateLimiter,
                           ApplicationEventPublisher events,
                           SimpMessagingTemplate messaging, Clock clock) {
        this.repository = repository;
        this.linkParser = linkParser;
        this.rateLimiter = rateLimiter;
        this.events = events;
        this.messaging = messaging;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public PageResponse<PlaylistResponse> feed(int page, int size) {
        var pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE));
        return PageResponse.from(repository.findAllByOrderByCreatedAtDescIdDesc(pageable), PlaylistResponse::from);
    }

    @Transactional(readOnly = true)
    public long count() {
        return repository.count();
    }

    @Transactional
    public PlaylistResponse share(SharePlaylistRequest request, String clientKey) {
        var decision = rateLimiter.tryAcquire(clientKey);
        if (!decision.allowed()) {
            long seconds = Math.max(1, decision.retryAfter().toSeconds());
            throw new ApiException.TooManyRequests(
                    "You're sharing too fast. Try again in " + seconds + " seconds.", seconds);
        }

        var ref = linkParser.parsePlaylist(request.playlistUrl())
                .orElseThrow(() -> new ApiException.BadRequest(
                        "Please paste a YouTube Music playlist link (it contains 'list=')."));

        String displayName = normalise(request.displayName());
        if (repository.existsByPlaylistIdAndDisplayNameIgnoreCase(ref.playlistId(), displayName)) {
            throw new ApiException.Conflict("You've already shared this playlist.");
        }

        var saved = repository.save(new SharedPlaylist(displayName, ref.playlistId(), ref.canonicalUrl(),
                normalise(request.playlistName()), blankToNull(normalise(request.note())), clock.instant()));

        var response = PlaylistResponse.from(saved);
        events.publishEvent(new PlaylistShared(response));
        return response;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void broadcast(PlaylistShared event) {
        messaging.convertAndSend(TOPIC, event.playlist());
    }

    /** Trim and collapse internal whitespace / control characters so the feed renders cleanly. */
    static String normalise(String s) {
        return s == null ? null : s.replaceAll("\\p{Cntrl}", " ").replaceAll("\\s+", " ").trim();
    }

    private static String blankToNull(String s) {
        return s == null || s.isEmpty() ? null : s;
    }
}
