package com.retroo.web.dto;

import com.retroo.domain.Decade;

/** One button on the "Travel to…" bar. */
public record DecadeResponse(String slug, String label, long songCount, String ytMusicUrl) {

    public static DecadeResponse of(Decade decade, long songCount) {
        return new DecadeResponse(decade.slug(), decade.label(), songCount, decade.ytMusicUrl());
    }
}
