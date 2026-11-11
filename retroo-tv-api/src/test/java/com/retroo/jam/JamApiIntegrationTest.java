package com.retroo.jam;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.is;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** REST side of jams through the full Spring stack: validation, ProblemDetail mapping, token header. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class JamApiIntegrationTest {

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper json;

    private JsonNode createJam(String name) throws Exception {
        String body = mvc.perform(post("/api/jams").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\",\"hostName\":\"Omkar\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readTree(body);
    }

    @Test
    void createListGetExtendEnd() throws Exception {
        JsonNode created = createJam("Friday night");
        String code = created.at("/jam/code").asText();
        String token = created.at("/hostToken").asText();

        org.assertj.core.api.Assertions.assertThat(code).matches("[A-HJ-NP-Z2-9]{6}");

        mvc.perform(get("/api/jams"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$[*].code", hasItem(code)));

        mvc.perform(get("/api/jams/" + code.toLowerCase())) // codes are case-insensitive
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name", is("Friday night")))
                .andExpect(jsonPath("$.hostName", is("Omkar")))
                .andExpect(jsonPath("$.extended", is(false)))
                .andExpect(jsonPath("$.playback", nullValue()))
                .andExpect(jsonPath("$.serverTime", notNullValue()))
                .andExpect(jsonPath("$.expiresAt", matchesPattern("\\d{4}-\\d{2}-\\d{2}T.*Z")))
                .andExpect(jsonPath("$.hostToken").doesNotExist()); // token never leaks into snapshots

        mvc.perform(post("/api/jams/" + code + "/extend"))
                .andExpect(status().isForbidden())
                .andExpect(header().string("Content-Type", "application/problem+json"));
        mvc.perform(post("/api/jams/" + code + "/extend").header("X-Jam-Token", token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.extended", is(true)));
        mvc.perform(post("/api/jams/" + code + "/extend").header("X-Jam-Token", token))
                .andExpect(status().isConflict());

        mvc.perform(delete("/api/jams/" + code).header("X-Jam-Token", "wrong")).andExpect(status().isForbidden());
        mvc.perform(delete("/api/jams/" + code).header("X-Jam-Token", token)).andExpect(status().isNoContent());
        mvc.perform(get("/api/jams/" + code)).andExpect(status().isNotFound());
    }

    @Test
    void createValidatesInput() throws Exception {
        mvc.perform(post("/api/jams").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"\",\"hostName\":\"" + "x".repeat(31) + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors.name", is("is required")))
                .andExpect(jsonPath("$.errors.hostName", is("must be at most 30 characters")));
    }

    @Test
    void unknownJamIs404() throws Exception {
        mvc.perform(get("/api/jams/ZZZZZZ")).andExpect(status().isNotFound());
    }
}
