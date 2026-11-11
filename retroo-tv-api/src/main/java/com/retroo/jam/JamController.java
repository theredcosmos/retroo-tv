package com.retroo.jam;

import com.retroo.jam.JamModels.CreateJamRequest;
import com.retroo.jam.JamModels.CreateJamResponse;
import com.retroo.jam.JamModels.JamSnapshot;
import com.retroo.jam.JamModels.JamSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Jam lifecycle over HTTP (gemini.md §8.2): create, lobby, snapshot, extend, end.
 * Everything live inside a jam (join, chat, playback) goes over STOMP — see {@link JamStompController}.
 * Host-only routes take the token in the {@code X-Jam-Token} header (headers don't end up in access logs or
 * browser history the way query strings do).
 */
@RestController
@RequestMapping("/api/jams")
@Tag(name = "Jams")
public class JamController {

    public static final String TOKEN_HEADER = "X-Jam-Token";

    private final JamService jams;

    public JamController(JamService jams) {
        this.jams = jams;
    }

    @Operation(summary = "Start a jam (60 min, extendable once); returns the host token exactly once")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CreateJamResponse create(@Valid @RequestBody CreateJamRequest request, HttpServletRequest http) {
        return jams.create(request, http.getRemoteAddr());
    }

    @Operation(summary = "Active jams, newest first")
    @GetMapping
    public ResponseEntity<List<JamSummary>> list() {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(jams.list());
    }

    @Operation(summary = "Full state of one jam: members, playback, recent chat")
    @GetMapping("/{code}")
    public ResponseEntity<JamSnapshot> get(@PathVariable String code) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(jams.snapshot(code));
    }

    @Operation(summary = "Host: extend the jam once by 60 minutes")
    @PostMapping("/{code}/extend")
    public JamSnapshot extend(@PathVariable String code, @RequestHeader(name = TOKEN_HEADER, required = false) String token) {
        return jams.extend(code, token);
    }

    @Operation(summary = "Host: end the jam for everyone")
    @DeleteMapping("/{code}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void end(@PathVariable String code, @RequestHeader(name = TOKEN_HEADER, required = false) String token) {
        jams.end(code, token);
    }
}
