package com.retroo.config;

import com.retroo.web.admin.AdminKeyInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.time.Clock;

/**
 * Spring MVC wiring: CORS policy, the admin-key interceptor and a {@link Clock} bean.
 *
 * <p>In production the SPA and the API share one origin behind nginx, so CORS is not exercised at all; the
 * allow-list only matters for local development without the Angular proxy. We deliberately use an explicit
 * allow-list instead of {@code "*"} because wildcard origins combined with credentials is a security smell.</p>
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final RetrooProperties properties;
    private final AdminKeyInterceptor adminKeyInterceptor;

    public WebConfig(RetrooProperties properties, AdminKeyInterceptor adminKeyInterceptor) {
        this.properties = properties;
        this.adminKeyInterceptor = adminKeyInterceptor;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(properties.cors().allowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
                .allowedHeaders("Content-Type", "X-Admin-Key")
                .maxAge(3600);
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(adminKeyInterceptor).addPathPatterns("/api/admin/**");
    }

    /** Injecting a Clock (instead of calling Instant.now()) makes time-based logic deterministic in tests. */
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
