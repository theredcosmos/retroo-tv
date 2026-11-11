package com.retroo.web.dto;

/** Payload pushed on {@code /topic/listeners}. An object (not a bare number) so fields can be added later. */
public record ListenerCountMessage(int count) {
}
