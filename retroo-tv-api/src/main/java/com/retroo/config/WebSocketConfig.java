package com.retroo.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

/**
 * STOMP-over-WebSocket configuration.
 *
 * <pre>
 *  Browser ──(ws://host/ws, STOMP CONNECT)──▶ /ws endpoint
 *          ◀──(MESSAGE /topic/listeners)───── SimpleBroker ◀── PresenceService
 *          ◀──(MESSAGE /topic/playlists)───── SimpleBroker ◀── PlaylistService
 * </pre>
 *
 * <ul>
 *   <li>{@code /ws} — handshake endpoint. Native WebSocket only (no SockJS) — every supported browser has it.</li>
 *   <li>{@code /topic} — in-memory "simple broker" fan-out. For multiple API instances swap this for
 *       {@code enableStompBrokerRelay(...)} backed by RabbitMQ/ActiveMQ so every node sees every message.</li>
 *   <li>{@code /queue} + {@code /user} — per-session delivery (jam command errors).</li>
 *   <li>{@code /app} — prefix for client→server messages (presence snapshot, jam join/chat/control).</li>
 * </ul>
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private final RetrooProperties properties;

    public WebSocketConfig(RetrooProperties properties) {
        this.properties = properties;
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        // /topic = fan-out to all subscribers; /queue = per-session messages (jam errors).
        registry.enableSimpleBroker("/topic", "/queue");
        registry.setApplicationDestinationPrefixes("/app");
        // "/user/queue/x" subscriptions are rewritten per session, so a message sent to one session id
        // (JamStompController) reaches only that connection — no login/Principal required.
        registry.setUserDestinationPrefix("/user");
        // Deliver messages to each session in the order they were published (e.g. STATE before the CHAT that
        // follows it). Without this the outbound thread pool may reorder them.
        registry.setPreservePublishOrder(true);
    }

    /**
     * Clients may SEND only to {@code /app/**} (our controllers, which check host tokens, membership, rate limits
     * and links). Without this a client could SEND straight to {@code /topic/jam/{code}} or {@code /topic/playlists}
     * and the simple broker would fan a forged STATE/ENDED/CHAT event or feed entry out to everyone.
     */
    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                var accessor = StompHeaderAccessor.wrap(message);
                if (StompCommand.SEND.equals(accessor.getCommand())) {
                    String destination = accessor.getDestination();
                    if (destination == null || !destination.startsWith("/app/")) {
                        throw new MessageDeliveryException(message, "Clients may only send to /app/**");
                    }
                }
                return message;
            }
        });
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        var origins = properties.cors().allowedOrigins();
        // Process each session's frames in arrival order: a client that SUBSCRIBEs to /topic/jam/{code} and then
        // SENDs /app/jam/{code}/join must not have the join handled first (the inbound pool would allow that).
        registry.setPreserveReceiveOrder(true);
        var endpoint = registry.addEndpoint("/ws");
        if (!origins.isEmpty()) {
            // Same-origin requests are always allowed; this adds the dev origin(s).
            endpoint.setAllowedOrigins(origins.toArray(String[]::new));
        }
    }
}
