package com.retroo.web.dto;

import org.springframework.data.domain.Page;

import java.util.List;
import java.util.function.Function;

/**
 * Stable pagination envelope. Serialising Spring's {@code PageImpl} directly is discouraged (its JSON shape is
 * an implementation detail and Spring Data 3.3+ logs a warning), so we expose our own minimal contract.
 */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, boolean last) {

    public static <E, T> PageResponse<T> from(Page<E> page, Function<E, T> mapper) {
        return new PageResponse<>(page.getContent().stream().map(mapper).toList(), page.getNumber(),
                page.getSize(), page.getTotalElements(), page.isLast());
    }
}
