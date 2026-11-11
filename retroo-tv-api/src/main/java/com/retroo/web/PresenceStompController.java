package com.retroo.web;

import com.retroo.service.PresenceService;
import com.retroo.web.dto.ListenerCountMessage;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.simp.annotation.SubscribeMapping;
import org.springframework.stereotype.Controller;

/**
 * STOMP (not HTTP) controller.
 *
 * <p>When a client SUBSCRIBEs to {@code /app/listeners}, {@code @SubscribeMapping} sends the return value
 * straight back to <i>that</i> session only, once — the request/reply pattern for initial state. Ongoing changes
 * are then delivered on the broker topic {@code /topic/listeners}. This avoids the race of broadcasting on a
 * subscribe event before the broker has registered the subscription.</p>
 */
@Controller
@MessageMapping
public class PresenceStompController {

    private final PresenceService presence;

    public PresenceStompController(PresenceService presence) {
        this.presence = presence;
    }

    @SubscribeMapping("/listeners")
    public ListenerCountMessage currentListeners() {
        return new ListenerCountMessage(presence.listenerCount());
    }
}
