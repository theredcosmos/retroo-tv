package com.retroo.service;

import com.retroo.domain.Decade;
import com.retroo.domain.Song;
import com.retroo.repository.SongRepository;
import com.retroo.web.dto.AddSongRequest;
import com.retroo.web.dto.DecadeResponse;
import com.retroo.web.dto.SongResponse;
import com.retroo.web.error.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import java.util.function.LongSupplier;
import java.util.random.RandomGenerator;

/**
 * Catalog use-cases: list decades, list a decade's songs, pick the next random song, and admin add/remove.
 *
 * <p>Read methods run in read-only transactions (lets Hibernate skip dirty-checking and lets the driver route to
 * a replica if one exists). The class is constructor-injected, so it is trivially unit-testable with mocks, and
 * the random source is injectable for deterministic tests.</p>
 */
@Service
@Transactional(readOnly = true)
public class SongService {

    private static final Logger log = LoggerFactory.getLogger(SongService.class);

    private final SongRepository songs;
    private final YouTubeLinkParser linkParser;
    private final YouTubeMetadataClient metadataClient;
    private final RandomGenerator random;

    @Autowired // two constructors exist (the package-private one is for tests), so tell Spring which to use
    public SongService(SongRepository songs, YouTubeLinkParser linkParser, YouTubeMetadataClient metadataClient) {
        // RandomGenerator.getDefault() is not thread-safe and this service is shared by all request threads:
        // delegate each draw to the calling thread's ThreadLocalRandom instead.
        this(songs, linkParser, metadataClient, () -> java.util.concurrent.ThreadLocalRandom.current().nextLong());
    }

    SongService(SongRepository songs, YouTubeLinkParser linkParser, YouTubeMetadataClient metadataClient,
                RandomGenerator random) {
        this.songs = songs;
        this.linkParser = linkParser;
        this.metadataClient = metadataClient;
        this.random = random;
    }

    public List<DecadeResponse> listDecades() {
        var counts = songs.countsByDecade();
        return Arrays.stream(Decade.values())
                .map(d -> DecadeResponse.of(d, counts.getOrDefault(d, 0L)))
                .toList();
    }

    public List<SongResponse> listByDecade(String decadeSlug) {
        return songs.findByDecadeOrderByReleaseYearAscTitleAsc(resolveDecade(decadeSlug)).stream()
                .map(SongResponse::from)
                .toList();
    }

    /** Languages a caller may ask for; anything else is a 400. */
    public static final Set<String> LANGUAGES = Set.of("hi", "en");
    /** Upper bound on the recent-song exclusion list (keeps the NOT IN clause small). */
    public static final int MAX_EXCLUDE = 20;

    /** Backwards-compatible form: any language, excluding one song. */
    public SongResponse randomSong(String decadeSlug, String excludeVideoId) {
        return randomSong(decadeSlug, null,
                excludeVideoId == null || excludeVideoId.isBlank() ? List.of() : List.of(excludeVideoId));
    }

    /**
     * Random song from a decade, optionally in one language ({@code "hi"}/{@code "en"} — the client rotates
     * hi, hi, en for the 2:1 Bollywood/Hollywood ratio), avoiding recently played video ids.
     *
     * <p>Strategies are tried in order until one has candidates, so a thin decade never dead-ends:</p>
     * <ol>
     *   <li>language + not recently played</li>
     *   <li>language only (all songs of that language were played recently)</li>
     *   <li>any language, not recently played (the decade has no songs in that language)</li>
     *   <li>anything in the decade</li>
     * </ol>
     * Each strategy is one COUNT + one single-row fetch at a random offset on the (DECADE, LANG) index.
     */
    public SongResponse randomSong(String decadeSlug, String lang, Collection<String> exclude) {
        Decade decade = resolveDecade(decadeSlug);
        if (lang != null && !LANGUAGES.contains(lang)) {
            throw new ApiException.BadRequest("'lang' must be 'hi' or 'en'.");
        }
        List<String> recent = exclude == null ? List.of() : exclude.stream()
                .filter(id -> id != null && !id.isBlank()).distinct().limit(MAX_EXCLUDE).toList();

        List<Strategy> strategies = new ArrayList<>();
        if (lang != null && !recent.isEmpty()) {
            strategies.add(new Strategy(() -> songs.countByDecadeAndLangAndVideoIdNotIn(decade, lang, recent),
                    p -> songs.findByDecadeAndLangAndVideoIdNotInOrderByIdAsc(decade, lang, recent, p)));
        }
        if (lang != null) {
            strategies.add(new Strategy(() -> songs.countByDecadeAndLang(decade, lang),
                    p -> songs.findByDecadeAndLangOrderByIdAsc(decade, lang, p)));
        }
        if (!recent.isEmpty()) {
            strategies.add(new Strategy(() -> songs.countByDecadeAndVideoIdNotIn(decade, recent),
                    p -> songs.findByDecadeAndVideoIdNotInOrderByIdAsc(decade, recent, p)));
        }
        strategies.add(new Strategy(() -> songs.countByDecade(decade), p -> songs.findByDecadeOrderByIdAsc(decade, p)));

        for (Strategy s : strategies) {
            long candidates = s.count().getAsLong();
            if (candidates > 0) {
                int offset = random.nextInt((int) Math.min(candidates, Integer.MAX_VALUE));
                var page = s.fetch().apply(PageRequest.of(offset, 1));
                if (!page.isEmpty()) {
                    return SongResponse.from(page.get(0));
                }
                // A song was deleted between the COUNT and this fetch: fall through to the next strategy.
            }
        }
        throw new ApiException.NotFound("No songs in the " + decade.label() + " yet.");
    }

    /** One way of narrowing the candidates: how many there are, and how to fetch the n-th. */
    private record Strategy(LongSupplier count, Function<Pageable, List<Song>> fetch) {
    }

    public long count() {
        return songs.count();
    }

    @Transactional
    public SongResponse addSong(AddSongRequest request) {
        String videoId = linkParser.parseVideoId(request.video())
                .orElseThrow(() -> new ApiException.BadRequest("'video' must be a YouTube video id or link."));
        Decade decade = resolveDecade(request.decade());
        if (songs.existsByVideoId(videoId)) {
            throw new ApiException.Conflict("Video " + videoId + " is already in the catalog.");
        }

        String title = request.title();
        String artist = request.artist();
        if (isBlank(title) || isBlank(artist)) {
            var meta = metadataClient.fetch(videoId).orElseThrow(() -> new ApiException.BadRequest(
                    "Could not look up video " + videoId + " on YouTube; provide title and artist explicitly."));
            title = isBlank(title) ? meta.title() : title;
            artist = isBlank(artist) ? stripTopicSuffix(meta.authorName()) : artist;
        }

        Song saved = songs.save(new Song(videoId, truncate(title, 200), truncate(artist, 200), decade,
                request.releaseYear(), request.lang() == null ? "en" : request.lang()));
        log.info("Added song {} ({}) to {}", saved.getVideoId(), saved.getTitle(), decade.slug());
        return SongResponse.from(saved);
    }

    @Transactional
    public void deleteSong(long id) {
        if (!songs.existsById(id)) {
            throw new ApiException.NotFound("Song " + id + " does not exist.");
        }
        songs.deleteById(id);
    }

    static Decade resolveDecade(String slug) {
        return Decade.fromSlug(slug).orElseThrow(() -> new ApiException.BadRequest(
                "Unknown decade '" + slug + "'. Use one of 60s, 70s, 80s, 90s, 2000s, 2010s, now."));
    }

    /** Auto-generated YT Music channels are named "Artist - Topic"; the suffix is noise in the UI. */
    private static String stripTopicSuffix(String author) {
        return author == null ? "Unknown artist" : author.replaceFirst("\\s*-\\s*Topic$", "").replaceFirst("VEVO$", "");
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String truncate(String s, int max) {
        return s.length() <= max ? s : s.substring(0, max);
    }
}
