package com.retroo.web.dto;

import com.retroo.domain.Decade;
import com.retroo.domain.Song;

/** A song as the player needs it. {@code decade} serialises as its slug, e.g. "90s". */
public record SongResponse(
        Long id,
        String videoId,
        String title,
        String artist,
        Decade decade,
        String lang,
        Integer releaseYear,
        String thumbnailUrl) {

    public static SongResponse from(Song song) {
        return new SongResponse(song.getId(), song.getVideoId(), song.getTitle(), song.getArtist(),
                song.getDecade(), song.getLang(), song.getReleaseYear(), song.getThumbnailUrl());
    }
}
