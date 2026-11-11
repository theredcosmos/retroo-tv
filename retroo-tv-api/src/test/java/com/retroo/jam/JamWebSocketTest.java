package com.retroo.jam;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
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
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end over real sockets: host creates a jam over REST, host + guest join over STOMP, chat reaches both,
 * a guest's playback command is rejected privately on /user/queue/jam-errors, the host's is broadcast as STATE.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class JamWebSocketTest {

    @LocalServerPort
    int port;

    @Autowired
    TestRestTemplate rest;

    /** One connected client with separate inboxes for jam events and private errors. */
    private final class Client {
        final StompSession session;
        final BlockingQueue<Map<String, Object>> events = new LinkedBlockingQueue<>();
        final BlockingQueue<Map<String, Object>> errors = new LinkedBlockingQueue<>();

        Client(String code) throws Exception {
            var stomp = new WebSocketStompClient(new StandardWebSocketClient());
            stomp.setMessageConverter(new MappingJackson2MessageConverter());
            session = stomp.connectAsync("ws://localhost:" + port + "/ws", new StompSessionHandlerAdapter() {
            }).get(5, TimeUnit.SECONDS);
            session.subscribe("/topic/jam/" + code, collector(events));
            session.subscribe("/user/queue/jam-errors", collector(errors));
        }

        Map<String, Object> await(BlockingQueue<Map<String, Object>> q, Predicate<Map<String, Object>> match)
                throws InterruptedException {
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < deadline) {
                var m = q.poll(200, TimeUnit.MILLISECONDS);
                if (m != null && match.test(m)) {
                    return m;
                }
            }
            return null;
        }
    }

    private static StompFrameHandler collector(BlockingQueue<Map<String, Object>> sink) {
        return new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                sink.add((Map<String, Object>) payload);
            }
        };
    }

    private static Predicate<Map<String, Object>> type(String t) {
        return m -> t.equals(m.get("type"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> payload(Map<String, Object> event) {
        return (Map<String, Object>) event.get("payload");
    }

    @Test
    @SuppressWarnings("unchecked")
    void hostAndGuestJam() throws Exception {
        var created = rest.postForObject("/api/jams", Map.of("name", "Socket jam", "hostName", "Omkar"), Map.class);
        String code = (String) ((Map<String, Object>) created.get("jam")).get("code");
        String token = (String) created.get("hostToken");

        Client host = new Client(code);
        Client guest = new Client(code);
        host.session.send("/app/jam/" + code + "/join", Map.of("name", "ignored", "hostToken", token));
        guest.session.send("/app/jam/" + code + "/join", Map.of("name", "Riya"));

        // both are listed once the guest has joined
        var members = host.await(host.events, e -> type("MEMBERS").test(e)
                && ((Number) payload(e).get("memberCount")).intValue() == 2);
        assertThat(members).isNotNull();
        assertThat((java.util.List<String>) payload(members).get("members"))
                .containsExactlyInAnyOrder("Omkar", "Riya"); // two connections: join order is not deterministic

        // chat from the guest reaches the host, with the server-side author name
        guest.session.send("/app/jam/" + code + "/chat", Map.of("text", "hi https://music.youtube.com/playlist?list=PLsock"));
        var chat = host.await(host.events, e -> type("CHAT").test(e) && "Riya".equals(payload(e).get("author")));
        assertThat(chat).isNotNull();
        assertThat(payload(chat).get("kind")).isEqualTo("PLAYLIST");
        assertThat(guest.await(guest.events, e -> type("CHAT").test(e) && "Riya".equals(payload(e).get("author"))))
                .isNotNull();

        // a guest trying to control playback gets a private FORBIDDEN …
        guest.session.send("/app/jam/" + code + "/control",
                Map.of("hostToken", "guess", "action", "PAUSE", "positionSec", 0));
        var error = guest.await(guest.errors, e -> true);
        assertThat(error).isNotNull();
        assertThat(error.get("code")).isEqualTo("FORBIDDEN");

        // … while the host's command is broadcast to everyone as STATE
        var song = Map.of("id", 1, "videoId", "dQw4w9WgXcQ", "title", "Never Gonna Give You Up",
                "artist", "Rick Astley", "decade", "80s");
        host.session.send("/app/jam/" + code + "/control",
                Map.of("hostToken", token, "action", "LOAD", "song", song, "positionSec", 0));
        var state = guest.await(guest.events, type("STATE"));
        assertThat(state).isNotNull();
        assertThat(payload(state).get("playing")).isEqualTo(true);
        assertThat(((Map<String, Object>) payload(state).get("song")).get("videoId")).isEqualTo("dQw4w9WgXcQ");
        assertThat(state.get("serverTime")).isNotNull();

        // the host never received the guest's private error
        assertThat(host.errors).isEmpty();

        // guest disconnects → host sees the member list shrink
        guest.session.disconnect();
        assertThat(host.await(host.events, e -> type("MEMBERS").test(e)
                && ((Number) payload(e).get("memberCount")).intValue() == 1)).isNotNull();
        host.session.disconnect();
    }
}
