package com.retroo.service;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.retroo.config.RetrooProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Optional;

/**
 * Looks up a video's title and channel through YouTube's public oEmbed endpoint
 * ({@code GET https://www.youtube.com/oembed?url=…&format=json}). No API key or quota needed.
 *
 * <p>It is an <i>enrichment</i>, never a hard dependency: any failure (timeout, 4xx for private/removed videos,
 * network down) yields {@link Optional#empty()} and the caller decides what to do. Timeouts are short so an
 * admin request can never hang a Tomcat thread for long.</p>
 */
@Component
public class YouTubeMetadataClient {

    private static final Logger log = LoggerFactory.getLogger(YouTubeMetadataClient.class);

    private final RestClient restClient;
    private final RetrooProperties.Youtube config;

    public YouTubeMetadataClient(RestClient.Builder builder, RetrooProperties properties) {
        this.config = properties.youtube();
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout((int) config.timeout().toMillis());
        factory.setReadTimeout((int) config.timeout().toMillis());
        this.restClient = builder.requestFactory(factory).build();
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record VideoMetadata(String title, @JsonProperty("author_name") String authorName) {
    }

    public Optional<VideoMetadata> fetch(String videoId) {
        var uri = UriComponentsBuilder.fromUri(config.oembedUrl())
                .queryParam("url", "https://www.youtube.com/watch?v=" + videoId)
                .queryParam("format", "json")
                .build().encode().toUri();
        try {
            return Optional.ofNullable(restClient.get().uri(uri).retrieve().body(VideoMetadata.class));
        } catch (RestClientException e) {
            log.warn("oEmbed lookup failed for {}: {}", videoId, e.getMessage());
            return Optional.empty();
        }
    }
}
