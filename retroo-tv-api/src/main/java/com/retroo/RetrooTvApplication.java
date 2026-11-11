package com.retroo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Entry point of the Retroo TV API.
 *
 * <ul>
 *   <li>{@code @SpringBootApplication} — component scan + auto-configuration for everything under {@code com.retroo}.</li>
 *   <li>{@code @ConfigurationPropertiesScan} — binds {@code retroo.*} keys from application.yml into
 *       {@link com.retroo.config.RetrooProperties}.</li>
 *   <li>{@code @EnableScheduling} — enables the presence heartbeat ({@link com.retroo.service.PresenceService}).</li>
 * </ul>
 */
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
public class RetrooTvApplication {

    public static void main(String[] args) {
        SpringApplication.run(RetrooTvApplication.class, args);
    }
}
