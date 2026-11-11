package com.retroo.jam;

/**
 * Failure of a STOMP jam command (join / chat / control). HTTP status codes don't exist on a WebSocket, so the
 * error is reported with a stable machine-readable {@link Code} to the sending session only
 * (see {@link JamStompController}); REST endpoints keep using {@link com.retroo.web.error.ApiException}.
 */
public class JamException extends RuntimeException {

    public enum Code { RATE_LIMITED, JAM_FULL, NOT_FOUND, FORBIDDEN, INVALID }

    private final Code code;

    public JamException(Code code, String message) {
        super(message);
        this.code = code;
    }

    public Code code() {
        return code;
    }
}
