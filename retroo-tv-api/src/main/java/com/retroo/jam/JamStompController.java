package com.retroo.jam;

import com.retroo.jam.JamModels.ChatInput;
import com.retroo.jam.JamModels.ControlMessage;
import com.retroo.jam.JamModels.JamError;
import com.retroo.jam.JamModels.JoinMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.messaging.MessageHeaders;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageExceptionHandler;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;

/**
 * Live jam commands over STOMP (gemini.md §8.3). Clients SEND to {@code /app/jam/{code}/…}; results are
 * broadcast by {@link JamService} on {@code /topic/jam/{code}}.
 *
 * <p><b>Per-session errors without login:</b> there is no {@code Principal}, so the usual
 * {@code convertAndSendToUser(username, …)} has no user to target. Instead we address the STOMP <i>session id</i>
 * and put that id in the message headers; Spring's {@code DefaultUserDestinationResolver} then delivers to
 * {@code /queue/jam-errors-user{sessionId}}, which is exactly what a client subscribed to
 * {@code /user/queue/jam-errors} on that connection is listening to. Nobody else sees the error.</p>
 */
@Controller
public class JamStompController {

    public static final String ERROR_QUEUE = "/queue/jam-errors";
    private static final Logger log = LoggerFactory.getLogger(JamStompController.class);

    private final JamService jams;
    private final SimpMessagingTemplate messaging;

    public JamStompController(JamService jams, SimpMessagingTemplate messaging) {
        this.jams = jams;
        this.messaging = messaging;
    }

    @MessageMapping("/jam/{code}/join")
    public void join(@DestinationVariable String code, @Payload(required = false) JoinMessage message,
                     SimpMessageHeaderAccessor headers) {
        jams.join(code, headers.getSessionId(), message == null ? null : message.name(),
                message == null ? null : message.hostToken(), message == null ? null : message.key());
    }

    @MessageMapping("/jam/{code}/request")
    public void request(@DestinationVariable String code, @Payload(required = false) JamModels.RequestMessage message,
                        SimpMessageHeaderAccessor headers) {
        jams.requestAccess(code, headers.getSessionId(), message == null ? null : message.name());
    }

    @MessageMapping("/jam/{code}/admit")
    public void admit(@DestinationVariable String code, @Payload(required = false) JamModels.AdmitMessage message) {
        jams.admit(code, message);
    }

    @MessageMapping("/jam/{code}/leave")
    public void leave(@DestinationVariable String code, SimpMessageHeaderAccessor headers) {
        jams.leave(code, headers.getSessionId());
    }

    @MessageMapping("/jam/{code}/chat")
    public void chat(@DestinationVariable String code, @Payload(required = false) ChatInput message,
                     SimpMessageHeaderAccessor headers) {
        jams.chat(code, headers.getSessionId(), message == null ? null : message.text());
    }

    @MessageMapping("/jam/{code}/control")
    public void control(@DestinationVariable String code, @Payload(required = false) ControlMessage message) {
        jams.control(code, message);
    }

    /** Expected failures (bad token, full jam, spam…) go back to the sender only. */
    @MessageExceptionHandler(JamException.class)
    public void onJamError(JamException ex, SimpMessageHeaderAccessor headers) {
        sendError(headers.getSessionId(), new JamError(ex.code(), ex.getMessage()));
    }

    /** Malformed JSON or anything unexpected: still answer the sender instead of silently dropping it. */
    @MessageExceptionHandler(Exception.class)
    public void onUnexpected(Exception ex, SimpMessageHeaderAccessor headers) {
        log.warn("Jam command failed for session {}: {}", headers.getSessionId(), ex.toString());
        sendError(headers.getSessionId(), new JamError(JamException.Code.INVALID, "That command could not be processed."));
    }

    private void sendError(String sessionId, JamError error) {
        if (sessionId == null) {
            return;
        }
        messaging.convertAndSendToUser(sessionId, ERROR_QUEUE, error, headersFor(sessionId));
    }

    private static MessageHeaders headersFor(String sessionId) {
        SimpMessageHeaderAccessor accessor = SimpMessageHeaderAccessor.create(SimpMessageType.MESSAGE);
        accessor.setSessionId(sessionId);
        accessor.setLeaveMutable(true);
        return accessor.getMessageHeaders();
    }
}
