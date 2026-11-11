package com.retroo;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.greaterThan;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Full-stack test: real Spring context, real Flyway migrations, real H2 (Oracle mode), MockMvc for HTTP.
 * Proves the migrations, JPA mappings ({@code ddl-auto=validate}), validation and error handling agree.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ApiIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Test
    void decadesAreListedInOrderWithSeededCounts() throws Exception {
        mvc.perform(get("/api/decades"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(7)))
                .andExpect(jsonPath("$[0].slug", is("60s")))
                .andExpect(jsonPath("$[6].slug", is("now")))
                .andExpect(jsonPath("$[*].songCount", everyItem(greaterThan(0))))
                .andExpect(jsonPath("$[3].ytMusicUrl", is("https://music.youtube.com/search?q=90s%20hits")));
    }

    @Test
    void randomSongHonoursDecadeAndExclusion() throws Exception {
        for (int i = 0; i < 10; i++) {
            mvc.perform(get("/api/songs/random").param("decade", "90s").param("exclude", "hTWKbfoikeg"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.decade", is("90s")))
                    .andExpect(jsonPath("$.videoId", not("hTWKbfoikeg")));
        }
    }

    @Test
    void randomSongHonoursLanguageForTheTwoToOneRotation() throws Exception {
        for (String lang : new String[]{"hi", "hi", "en"}) {
            mvc.perform(get("/api/songs/random").param("decade", "2000s").param("lang", lang)
                            .param("exclude", "g0eO74UmRBs,mt9xg0mmt28"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.lang", is(lang)))
                    .andExpect(jsonPath("$.videoId", not("g0eO74UmRBs")))
                    .andExpect(jsonPath("$.videoId", not("mt9xg0mmt28")));
        }
        mvc.perform(get("/api/songs/random").param("decade", "90s").param("lang", "fr"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void unknownDecadeReturnsProblemDetail() throws Exception {
        mvc.perform(get("/api/songs").param("decade", "1920s"))
                .andExpect(status().isBadRequest())
                .andExpect(header().string("Content-Type", "application/problem+json"))
                .andExpect(jsonPath("$.title", is("Bad request")));
    }

    @Test
    void shareValidPlaylistThenDuplicateIsConflict() throws Exception {
        String body = """
                {"displayName":"Avanti","playlistUrl":"https://www.youtube.com/playlist?list=PLintegration1&si=x",
                 "playlistName":"Energetic songs","note":"  I listen to this   when I feel low  "}""";

        mvc.perform(post("/api/playlists").contentType(MediaType.APPLICATION_JSON).content(body)
                        .with(r -> { r.setRemoteAddr("10.0.0.1"); return r; }))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.playlistUrl", is("https://music.youtube.com/playlist?list=PLintegration1")))
                .andExpect(jsonPath("$.note", is("I listen to this when I feel low")));

        mvc.perform(post("/api/playlists").contentType(MediaType.APPLICATION_JSON).content(body)
                        .with(r -> { r.setRemoteAddr("10.0.0.2"); return r; }))
                .andExpect(status().isConflict());

        mvc.perform(get("/api/playlists"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].displayName", is("Avanti")));
    }

    @Test
    void invalidPlaylistPayloadListsFieldErrors() throws Exception {
        mvc.perform(post("/api/playlists").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"displayName\":\"\",\"playlistUrl\":\"x\",\"playlistName\":\"n\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.displayName", is("is required")));
    }

    @Test
    void nonYouTubeLinkIsRejected() throws Exception {
        mvc.perform(post("/api/playlists").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"Eve","playlistUrl":"https://open.spotify.com/playlist/abc","playlistName":"x"}""")
                        .with(r -> { r.setRemoteAddr("10.0.0.3"); return r; }))
                .andExpect(status().isBadRequest());
    }

    @Test
    void rateLimitReturns429WithRetryAfter() throws Exception {
        for (int i = 0; i < 4; i++) {
            var result = mvc.perform(post("/api/playlists").contentType(MediaType.APPLICATION_JSON)
                    .content("""
                            {"displayName":"Spammer%d","playlistUrl":"https://music.youtube.com/playlist?list=PLspam%d","playlistName":"x"}"""
                            .formatted(i, i))
                    .with(r -> { r.setRemoteAddr("10.9.9.9"); return r; }));
            if (i < 3) {
                result.andExpect(status().isCreated());
            } else {
                result.andExpect(status().isTooManyRequests()).andExpect(header().exists("Retry-After"));
            }
        }
    }

    @Test
    void adminRequiresKey() throws Exception {
        String body = "{\"video\":\"dQw4w9WgXcQ\",\"decade\":\"80s\",\"title\":\"t\",\"artist\":\"a\"}";
        mvc.perform(post("/api/admin/songs").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
        // Already seeded → 409 proves the key was accepted and the duplicate check ran.
        mvc.perform(post("/api/admin/songs").header("X-Admin-Key", "test-key")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict());
    }

    @Test
    void statsAndHealthAreUp() throws Exception {
        mvc.perform(get("/api/stats")).andExpect(status().isOk()).andExpect(jsonPath("$.songs", greaterThan(60)));
        mvc.perform(get("/actuator/health")).andExpect(status().isOk()).andExpect(jsonPath("$.status", is("UP")));
    }
}
