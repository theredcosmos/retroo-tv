package com.retroo;

import com.retroo.web.dto.ListenerCountMessage;
import com.retroo.service.PresenceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.MappingJackson2MessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;

import java.lang.reflect.Type;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end over a real socket: two STOMP clients connect, the listener count goes 1 → 2,
 * one disconnects and the remaining client sees it drop back to 1.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class PresenceWebSocketTest {

    @LocalServerPort
    int port;

    private StompSession connect(BlockingQueue<Integer> counts) throws Exception {
        var client = new WebSocketStompClient(new StandardWebSocketClient());
        client.setMessageConverter(new MappingJackson2MessageConverter());
        StompSession session = client.connectAsync("ws://localhost:" + port + "/ws", new StompSessionHandlerAdapter() {
        }).get(5, TimeUnit.SECONDS);
        StompFrameHandler handler = new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return ListenerCountMessage.class;
            }

            @Override
            public void handleFrame(StompHeaders headers, Object payload) {
                counts.add(((ListenerCountMessage) payload).count());
            }
        };
        session.subscribe("/topic/listeners", handler);   // live updates
        session.subscribe("/app/listeners", handler);     // one-shot current value (@SubscribeMapping)
        return session;
    }

    /** Waits until the queue delivers {@code expected}, skipping intermediate broadcasts. */
    private static boolean awaitCount(BlockingQueue<Integer> q, int expected) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            Integer value = q.poll(200, TimeUnit.MILLISECONDS);
            if (value != null && value == expected) {
                return true;
            }
        }
        return false;
    }

    @Autowired
    PresenceService presence;

    @Test
    void listenerCountTracksConnectAndDisconnect() throws Exception {
        // Relative to the starting count: other test classes share this cached Spring context and may still be
        // closing their own sockets.
        int base = presence.listenerCount();
        BlockingQueue<Integer> first = new LinkedBlockingQueue<>();
        StompSession a = connect(first);
        assertThat(awaitCount(first, base + 1)).isTrue();

        StompSession b = connect(new LinkedBlockingQueue<>());
        assertThat(awaitCount(first, base + 2)).isTrue();

        b.disconnect();
        assertThat(awaitCount(first, base + 1)).isTrue();
        a.disconnect();
    }
}
