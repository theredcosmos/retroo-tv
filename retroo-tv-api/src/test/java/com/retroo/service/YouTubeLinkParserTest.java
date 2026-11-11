package com.retroo.service;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

class YouTubeLinkParserTest {

    private final YouTubeLinkParser parser = new YouTubeLinkParser();

    @ParameterizedTest
    @CsvSource({
            "https://music.youtube.com/playlist?list=PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i, PL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i",
            "https://www.youtube.com/playlist?list=PLabc123, PLabc123",
            "https://youtube.com/watch?v=dQw4w9WgXcQ&list=RDabc_-9, RDabc_-9",
            "music.youtube.com/playlist?list=OLAK5uy_abc&si=tracking, OLAK5uy_abc",
            "HTTPS://M.YOUTUBE.COM/playlist?list=PLzz, PLzz"
    })
    void parsesAndCanonicalisesPlaylistLinks(String url, String expectedId) {
        var ref = parser.parsePlaylist(url);
        assertThat(ref).isPresent();
        assertThat(ref.get().playlistId()).isEqualTo(expectedId);
        assertThat(ref.get().canonicalUrl()).isEqualTo("https://music.youtube.com/playlist?list=" + expectedId);
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "https://evil.example.com/playlist?list=PLabc",       // host not allow-listed
            "https://music.youtube.com.evil.com/playlist?list=PL", // look-alike host
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ",       // no list param
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
            "javascript:alert(1)",
            "https://music.youtube.com/playlist?list=<script>",
            "   "
    })
    void rejectsNonPlaylistLinks(String url) {
        assertThat(parser.parsePlaylist(url)).isEmpty();
    }

    @ParameterizedTest
    @CsvSource({
            "dQw4w9WgXcQ, dQw4w9WgXcQ",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ, dQw4w9WgXcQ",
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share, dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ, dQw4w9WgXcQ",
            "https://www.youtube.com/shorts/dQw4w9WgXcQ, dQw4w9WgXcQ"
    })
    void parsesVideoIds(String input, String expected) {
        assertThat(parser.parseVideoId(input)).contains(expected);
    }

    @ParameterizedTest
    @ValueSource(strings = {"short", "https://vimeo.com/123456", "https://youtube.com/watch?v=tooShort"})
    void rejectsInvalidVideoIds(String input) {
        assertThat(parser.parseVideoId(input)).isEmpty();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "check this https://music.youtube.com/playlist?list=PLabc out | PLabc",
            "(https://www.youtube.com/playlist?list=PLxyz&si=1)! | PLxyz",
            "music.youtube.com/playlist?list=OLAK5uy_q. | OLAK5uy_q"
    })
    void findsPlaylistLinksInsideFreeText(String text, String expectedId) {
        assertThat(parser.findPlaylistInText(text)).get()
                .extracting(YouTubeLinkParser.PlaylistRef::playlistId).isEqualTo(expectedId);
    }

    @ParameterizedTest
    @ValueSource(strings = {"no links here", "https://evil.com/playlist?list=PLabc", "list= alone"})
    void ignoresTextWithoutAValidPlaylistLink(String text) {
        assertThat(parser.findPlaylistInText(text)).isEmpty();
    }
}
