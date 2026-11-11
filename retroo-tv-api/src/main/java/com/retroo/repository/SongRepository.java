package com.retroo.repository;

import com.retroo.domain.Decade;
import com.retroo.domain.Song;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * Data access for {@link Song}. Spring Data derives the SQL from the method names at start-up.
 *
 * <p><b>Random pick, portably:</b> instead of {@code ORDER BY DBMS_RANDOM.VALUE} (Oracle-only and a full sort of
 * the decade), the service counts the candidate rows and then fetches exactly one row at a random offset using a
 * {@link Pageable} of size 1 — Hibernate renders that as {@code OFFSET n ROWS FETCH NEXT 1 ROWS ONLY} on Oracle
 * and {@code LIMIT/OFFSET} on H2. Both queries use {@code IX_SONGS_DECADE}.</p>
 */
public interface SongRepository extends JpaRepository<Song, Long> {

    /** Full list for one decade, chronological — used by the "up next" list. */
    List<Song> findByDecadeOrderByReleaseYearAscTitleAsc(Decade decade);

    long countByDecade(Decade decade);

    long countByDecadeAndVideoIdNot(Decade decade, String videoId);

    List<Song> findByDecadeOrderByIdAsc(Decade decade, Pageable pageable);

    List<Song> findByDecadeAndVideoIdNotOrderByIdAsc(Decade decade, String videoId, Pageable pageable);

    // ---- language-aware random pick (2:1 rotation) with recent-song exclusion -----------------------------
    // Four variants instead of one dynamic query: each is a simple indexed query, and NOT IN () with an empty
    // list is never generated (invalid SQL on some databases).

    long countByDecadeAndLang(Decade decade, String lang);

    List<Song> findByDecadeAndLangOrderByIdAsc(Decade decade, String lang, Pageable pageable);

    long countByDecadeAndLangAndVideoIdNotIn(Decade decade, String lang, Collection<String> videoIds);

    List<Song> findByDecadeAndLangAndVideoIdNotInOrderByIdAsc(Decade decade, String lang, Collection<String> videoIds,
                                                              Pageable pageable);

    long countByDecadeAndVideoIdNotIn(Decade decade, Collection<String> videoIds);

    List<Song> findByDecadeAndVideoIdNotInOrderByIdAsc(Decade decade, Collection<String> videoIds, Pageable pageable);

    boolean existsByVideoId(String videoId);

    /** One grouped query for the decade bar instead of seven COUNT(*) round-trips. */
    @Query("select s.decade as decade, count(s) as total from Song s group by s.decade")
    List<DecadeCount> countGroupedByDecade();

    /** Spring Data interface projection for {@link #countGroupedByDecade()}. */
    interface DecadeCount {
        Decade getDecade();

        long getTotal();
    }

    default Map<Decade, Long> countsByDecade() {
        Map<Decade, Long> result = new EnumMap<>(Decade.class);
        countGroupedByDecade().forEach(c -> result.put(c.getDecade(), c.getTotal()));
        return result;
    }
}
