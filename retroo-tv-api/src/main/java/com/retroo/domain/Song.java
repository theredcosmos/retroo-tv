package com.retroo.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;

import java.time.Instant;

/**
 * A playable track in the catalog. {@code videoId} is the YouTube video id and the natural key — inserting the
 * same video twice violates {@code UK_SONGS_VIDEO_ID}, which keeps seeding and admin imports idempotent.
 */
@Entity
@Table(name = "SONGS")
public class Song {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "VIDEO_ID", nullable = false, unique = true, length = 11)
    private String videoId;

    @Column(name = "TITLE", nullable = false, length = 200)
    private String title;

    @Column(name = "ARTIST", nullable = false, length = 200)
    private String artist;

    @Column(name = "DECADE", nullable = false, length = 10)
    private Decade decade;

    @Column(name = "RELEASE_YEAR")
    private Integer releaseYear;

    /** {@code "hi"} (Bollywood) or {@code "en"} (Hollywood/international) — drives the 2:1 rotation. */
    @Column(name = "LANG", nullable = false, length = 2)
    private String lang = "en";

    @Column(name = "THUMBNAIL_URL", length = 500)
    private String thumbnailUrl;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private Instant createdAt;

    /** Required by JPA. */
    protected Song() {
    }

    public Song(String videoId, String title, String artist, Decade decade, Integer releaseYear) {
        this(videoId, title, artist, decade, releaseYear, "en");
    }

    public Song(String videoId, String title, String artist, Decade decade, Integer releaseYear, String lang) {
        this.lang = lang;
        this.videoId = videoId;
        this.title = title;
        this.artist = artist;
        this.decade = decade;
        this.releaseYear = releaseYear;
        this.thumbnailUrl = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
    }

    @PrePersist
    void onCreate() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    public Long getId() {
        return id;
    }

    public String getVideoId() {
        return videoId;
    }

    public String getTitle() {
        return title;
    }

    public String getArtist() {
        return artist;
    }

    public Decade getDecade() {
        return decade;
    }

    public Integer getReleaseYear() {
        return releaseYear;
    }

    public String getLang() {
        return lang;
    }

    public String getThumbnailUrl() {
        return thumbnailUrl;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
