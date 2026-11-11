package com.retroo.domain;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

/**
 * Persists {@link Decade} as its slug ("90s") rather than its ordinal (fragile when re-ordering) or its
 * name ("NINETIES", which would not match the CHECK constraint and is less readable in SQL).
 */
@Converter(autoApply = true)
public class DecadeConverter implements AttributeConverter<Decade, String> {

    @Override
    public String convertToDatabaseColumn(Decade decade) {
        return decade == null ? null : decade.slug();
    }

    @Override
    public Decade convertToEntityAttribute(String slug) {
        if (slug == null) {
            return null;
        }
        return Decade.fromSlug(slug)
                .orElseThrow(() -> new IllegalStateException("Unknown decade in database: " + slug));
    }
}
