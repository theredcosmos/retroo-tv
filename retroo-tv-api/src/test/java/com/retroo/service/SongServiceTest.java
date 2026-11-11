package com.retroo.service;

import com.retroo.domain.Decade;
import com.retroo.domain.Song;
import com.retroo.repository.SongRepository;
import com.retroo.web.dto.AddSongRequest;
import com.retroo.web.error.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.PageRequest;

import java.util.List;
import java.util.Optional;
import java.util.random.RandomGenerator;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Pure unit tests: repository and oEmbed client are mocked, randomness is fixed. */
class SongServiceTest {

    private SongRepository repo;
    private YouTubeMetadataClient metadata;
    private SongService service;

    @BeforeEach
    void setUp() {
        repo = mock(SongRepository.class);
        metadata = mock(YouTubeMetadataClient.class);
        RandomGenerator fixed = new RandomGenerator() {
            @Override
            public long nextLong() {
                return 0;
            }

            @Override
            public int nextInt(int bound) {
                return bound - 1; // always the last candidate
            }
        };
        service = new SongService(repo, new YouTubeLinkParser(), metadata, fixed);
    }

    @Test
    void randomSongExcludesTheSongThatJustPlayed() {
        var song = new Song("hTWKbfoikeg", "Smells Like Teen Spirit", "Nirvana", Decade.NINETIES, 1991);
        when(repo.countByDecadeAndVideoIdNotIn(Decade.NINETIES, List.of("bx1Bh8ZvH84"))).thenReturn(3L);
        when(repo.findByDecadeAndVideoIdNotInOrderByIdAsc(Decade.NINETIES, List.of("bx1Bh8ZvH84"), PageRequest.of(2, 1)))
                .thenReturn(List.of(song));

        var result = service.randomSong("90s", "bx1Bh8ZvH84");

        assertThat(result.videoId()).isEqualTo("hTWKbfoikeg");
        verify(repo, never()).findByDecadeOrderByIdAsc(any(), any());
    }

    @Test
    void randomSongFallsBackWhenExcludedIsTheOnlySong() {
        var only = new Song("4NRXx6U8ABQ", "Blinding Lights", "The Weeknd", Decade.NOW, 2020);
        when(repo.countByDecadeAndVideoIdNotIn(Decade.NOW, List.of("4NRXx6U8ABQ"))).thenReturn(0L);
        when(repo.countByDecade(Decade.NOW)).thenReturn(1L);
        when(repo.findByDecadeOrderByIdAsc(Decade.NOW, PageRequest.of(0, 1))).thenReturn(List.of(only));

        assertThat(service.randomSong("now", "4NRXx6U8ABQ").videoId()).isEqualTo("4NRXx6U8ABQ");
    }

    @Test
    void languageAndRecentSongsAreBothRespected() {
        var hindi = new Song("cNV5hLSa9H8", "Tujhe Dekha To", "Kumar Sanu", Decade.NINETIES, 1995, "hi");
        var recent = List.of("a1111111111", "b2222222222");
        when(repo.countByDecadeAndLangAndVideoIdNotIn(Decade.NINETIES, "hi", recent)).thenReturn(4L);
        when(repo.findByDecadeAndLangAndVideoIdNotInOrderByIdAsc(Decade.NINETIES, "hi", recent, PageRequest.of(3, 1)))
                .thenReturn(List.of(hindi));

        var result = service.randomSong("90s", "hi", recent);

        assertThat(result.lang()).isEqualTo("hi");
        assertThat(result.videoId()).isEqualTo("cNV5hLSa9H8");
    }

    @Test
    void whenAllSongsOfALanguageWereRecentItStillPicksThatLanguage() {
        var hindi = new Song("cNV5hLSa9H8", "Tujhe Dekha To", "Kumar Sanu", Decade.NINETIES, 1995, "hi");
        var recent = List.of("cNV5hLSa9H8");
        when(repo.countByDecadeAndLangAndVideoIdNotIn(Decade.NINETIES, "hi", recent)).thenReturn(0L);
        when(repo.countByDecadeAndLang(Decade.NINETIES, "hi")).thenReturn(1L);
        when(repo.findByDecadeAndLangOrderByIdAsc(Decade.NINETIES, "hi", PageRequest.of(0, 1))).thenReturn(List.of(hindi));

        assertThat(service.randomSong("90s", "hi", recent).lang()).isEqualTo("hi");
    }

    @Test
    void decadeWithoutThatLanguageFallsBackToAnyLanguage() {
        var english = new Song("hTWKbfoikeg", "Smells Like Teen Spirit", "Nirvana", Decade.NINETIES, 1991);
        when(repo.countByDecadeAndLang(Decade.NINETIES, "hi")).thenReturn(0L);
        when(repo.countByDecade(Decade.NINETIES)).thenReturn(1L);
        when(repo.findByDecadeOrderByIdAsc(Decade.NINETIES, PageRequest.of(0, 1))).thenReturn(List.of(english));

        assertThat(service.randomSong("90s", "hi", List.of()).lang()).isEqualTo("en");
    }

    @Test
    void unknownLanguageIs400() {
        assertThatThrownBy(() -> service.randomSong("90s", "fr", List.of())).isInstanceOf(ApiException.BadRequest.class);
    }

    @Test
    void randomSongOnEmptyDecadeIs404() {
        when(repo.countByDecade(Decade.SIXTIES)).thenReturn(0L);
        assertThatThrownBy(() -> service.randomSong("60s", null)).isInstanceOf(ApiException.NotFound.class);
    }

    @Test
    void unknownDecadeIs400() {
        assertThatThrownBy(() -> service.randomSong("1920s", null)).isInstanceOf(ApiException.BadRequest.class);
    }

    @Test
    void addSongEnrichesMissingMetadataFromOEmbed() {
        when(repo.existsByVideoId("dQw4w9WgXcQ")).thenReturn(false);
        when(metadata.fetch("dQw4w9WgXcQ")).thenReturn(Optional.of(
                new YouTubeMetadataClient.VideoMetadata("Never Gonna Give You Up", "Rick Astley - Topic")));
        when(repo.save(any(Song.class))).thenAnswer(inv -> inv.getArgument(0));

        var result = service.addSong(new AddSongRequest("https://youtu.be/dQw4w9WgXcQ", "80s", null, null, 1987, null));

        var captor = ArgumentCaptor.forClass(Song.class);
        verify(repo).save(captor.capture());
        assertThat(captor.getValue().getArtist()).isEqualTo("Rick Astley");
        assertThat(result.title()).isEqualTo("Never Gonna Give You Up");
        assertThat(result.thumbnailUrl()).isEqualTo("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
    }

    @Test
    void addSongRejectsDuplicates() {
        when(repo.existsByVideoId("dQw4w9WgXcQ")).thenReturn(true);
        assertThatThrownBy(() -> service.addSong(new AddSongRequest("dQw4w9WgXcQ", "80s", "t", "a", null, "en")))
                .isInstanceOf(ApiException.Conflict.class);
    }
}
