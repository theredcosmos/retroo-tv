package com.retroo.jam;

import org.springframework.context.event.EventListener;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;
import org.springframework.web.socket.messaging.SessionSubscribeEvent;
import org.springframework.web.socket.messaging.SessionUnsubscribeEvent;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps jam membership honest when clients don't say goodbye.
 *
 * <ul>
 *   <li><b>Disconnect</b> (tab closed, network lost, heart-beat timeout) → leave every jam.</li>
 *   <li><b>UNSUBSCRIBE</b> from {@code /topic/jam/{code}} → leave that jam. An UNSUBSCRIBE frame only carries the
 *       subscription id, not the destination, so we remember {@code sessionId:subscriptionId → code} when the
 *       SUBSCRIBE happens.</li>
 * </ul>
 */
@Component
public class JamMembershipListener {

    private final JamService jams;
    /** "sessionId:subscriptionId" → jam code. */
    private final Map<String, String> subscriptions = new ConcurrentHashMap<>();

    public JamMembershipListener(JamService jams) {
        this.jams = jams;
    }

    @EventListener
    public void onSubscribe(SessionSubscribeEvent event) {
        var headers = StompHeaderAccessor.wrap(event.getMessage());
        String destination = headers.getDestination();
        if (destination != null && destination.startsWith(JamService.TOPIC_PREFIX)) {
            subscriptions.put(key(headers.getSessionId(), headers.getSubscriptionId()),
                    destination.substring(JamService.TOPIC_PREFIX.length()));
        }
    }

    @EventListener
    public void onUnsubscribe(SessionUnsubscribeEvent event) {
        var headers = StompHeaderAccessor.wrap(event.getMessage());
        String code = subscriptions.remove(key(headers.getSessionId(), headers.getSubscriptionId()));
        if (code != null) {
            jams.leave(code, headers.getSessionId());
        }
    }

    @EventListener
    public void onDisconnect(SessionDisconnectEvent event) {
        String sessionId = event.getSessionId();
        subscriptions.keySet().removeIf(k -> k.startsWith(sessionId + ":"));
        jams.leaveAll(sessionId);
    }

    private static String key(String sessionId, String subscriptionId) {
        return sessionId + ":" + subscriptionId;
    }
}
