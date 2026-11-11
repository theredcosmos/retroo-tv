package com.retroo.web.error;

import org.springframework.http.HttpStatus;

/**
 * Base class for expected, business-level failures. Each subclass maps to one HTTP status, and
 * {@link GlobalExceptionHandler} turns it into an RFC 7807 problem document. Services throw these instead of
 * returning nulls or building {@code ResponseEntity}s, which keeps HTTP concerns out of the service layer.
 */
public abstract class ApiException extends RuntimeException {

    private final HttpStatus status;
    private final String title;

    protected ApiException(HttpStatus status, String title, String detail) {
        super(detail);
        this.status = status;
        this.title = title;
    }

    public HttpStatus status() {
        return status;
    }

    public String title() {
        return title;
    }

    public static class NotFound extends ApiException {
        public NotFound(String detail) {
            super(HttpStatus.NOT_FOUND, "Not found", detail);
        }
    }

    public static class BadRequest extends ApiException {
        public BadRequest(String detail) {
            super(HttpStatus.BAD_REQUEST, "Bad request", detail);
        }
    }

    public static class Conflict extends ApiException {
        public Conflict(String detail) {
            super(HttpStatus.CONFLICT, "Conflict", detail);
        }
    }

    public static class TooManyRequests extends ApiException {
        private final long retryAfterSeconds;

        public TooManyRequests(String detail, long retryAfterSeconds) {
            super(HttpStatus.TOO_MANY_REQUESTS, "Too many requests", detail);
            this.retryAfterSeconds = retryAfterSeconds;
        }

        public long retryAfterSeconds() {
            return retryAfterSeconds;
        }
    }

    /** Server-side capacity reached (e.g. too many active jams). Temporary — clients may retry later. */
    public static class ServiceUnavailable extends ApiException {
        public ServiceUnavailable(String detail) {
            super(HttpStatus.SERVICE_UNAVAILABLE, "Service unavailable", detail);
        }
    }

    public static class Unauthorized extends ApiException {
        public Unauthorized(String detail) {
            super(HttpStatus.UNAUTHORIZED, "Unauthorized", detail);
        }
    }

    public static class Forbidden extends ApiException {
        public Forbidden(String detail) {
            super(HttpStatus.FORBIDDEN, "Forbidden", detail);
        }
    }
}
