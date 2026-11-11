package com.retroo.service;

import com.retroo.web.dto.ListenerCountMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.messaging.SessionConnectedEvent;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Live "N listening" counter.
 *
 * <p>Every open browser tab holds one STOMP session. Spring publishes application events for the session
 * lifecycle, and we keep the ids in a concurrent set:</p>
 * <ul>
 *   <li>{@link SessionConnectedEvent} → add id, broadcast.</li>
 *   <li>{@link SessionDisconnectEvent} → remove id, broadcast. Fired for clean closes <i>and</i> for dead
 *       connections detected by STOMP heart-beats/transport errors, so no stale sessions accumulate.</li>
 *   <li>Initial state for a new client comes from {@link com.retroo.web.PresenceStompController} via
 *       {@code @SubscribeMapping} — broadcasting on SessionSubscribeEvent would race the broker registering the
 *       subscription and the message could be lost.</li>
 *   <li>A heartbeat re-broadcasts periodically as a safety net for any missed message.</li>
 * </ul>
 * Using a {@code Set} of ids (not an {@code AtomicInteger}) makes duplicate/out-of-order events idempotent.
 *
 * <p>Compared with the v1 design (clients POSTing a ping every N seconds into a SESSIONS table) this needs zero DB
 * writes and is exact. It is per-instance; with N API replicas, publish counts to Redis and sum them.</p>
 */
@Service
public class PresenceService {

    public static final String TOPIC = "/topic/listeners";
    private static final Logger log = LoggerFactory.getLogger(PresenceService.class);

    private final Set<String> sessions = ConcurrentHashMap.newKeySet();
    private final SimpMessagingTemplate messaging;

    public PresenceService(SimpMessagingTemplate messaging) {
        this.messaging = messaging;
    }

    public int listenerCount() {
        return sessions.size();
    }

    @EventListener
    public void onConnected(SessionConnectedEvent event) {
        String id = StompHeaderAccessor.wrap(event.getMessage()).getSessionId();
        if (id != null && sessions.add(id)) {
            log.debug("Listener joined: {} (now {})", id, sessions.size());
            broadcast();
        }
    }

    @EventListener
    public void onDisconnected(SessionDisconnectEvent event) {
        if (sessions.remove(event.getSessionId())) {
            log.debug("Listener left: {} (now {})", event.getSessionId(), sessions.size());
            broadcast();
        }
    }

    @Scheduled(fixedRateString = "${retroo.presence.heartbeat}")
    public void heartbeat() {
        broadcast();
    }

    private void broadcast() {
        messaging.convertAndSend(TOPIC, new ListenerCountMessage(sessions.size()));
    }
}
