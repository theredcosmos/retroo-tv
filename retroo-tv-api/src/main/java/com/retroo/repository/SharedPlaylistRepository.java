package com.retroo.repository;

import com.retroo.domain.SharedPlaylist;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

/** Data access for the shared-playlist feed. */
public interface SharedPlaylistRepository extends JpaRepository<SharedPlaylist, Long> {

    /** Newest first; backed by IX_SHARED_PLAYLISTS_CREATED. Ties broken by id for a stable order. */
    Page<SharedPlaylist> findAllByOrderByCreatedAtDescIdDesc(Pageable pageable);

    boolean existsByPlaylistIdAndDisplayNameIgnoreCase(String playlistId, String displayName);
}
