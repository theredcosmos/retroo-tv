package com.retroo.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Metadata for the generated OpenAPI 3 document (served at /v3/api-docs, UI at /swagger-ui.html in dev). */
@Configuration
public class OpenApiConfig {

    public static final String ADMIN_KEY_SCHEME = "adminKey";

    @Bean
    public OpenAPI retrooOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("Retroo TV API")
                        .version("1.0.0")
                        .description("Decade catalog, random playback, shared YouTube Music playlists and admin tools."))
                .components(new Components().addSecuritySchemes(ADMIN_KEY_SCHEME, new SecurityScheme()
                        .type(SecurityScheme.Type.APIKEY)
                        .in(SecurityScheme.In.HEADER)
                        .name("X-Admin-Key")));
    }
}
