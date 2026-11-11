package com.retroo.web.admin;

import com.retroo.config.RetrooProperties;
import com.retroo.web.error.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/**
 * Guards {@code /api/admin/**} with a shared secret in the {@code X-Admin-Key} header.
 *
 * <ul>
 *   <li>No key configured → 403 for everyone (admin API disabled, fail-closed).</li>
 *   <li>Missing/wrong key → 401.</li>
 *   <li>Comparison uses {@link MessageDigest#isEqual} which is constant-time, so an attacker cannot recover the
 *       key byte-by-byte from response timing.</li>
 * </ul>
 * Exceptions thrown here are rendered by {@link com.retroo.web.error.GlobalExceptionHandler} like any other.
 * For multiple admins/roles, replace with Spring Security + OAuth2/JWT.
 */
@Component
public class AdminKeyInterceptor implements HandlerInterceptor {

    public static final String HEADER = "X-Admin-Key";

    private final RetrooProperties.Admin admin;

    public AdminKeyInterceptor(RetrooProperties properties) {
        this.admin = properties.admin();
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true; // CORS pre-flight carries no credentials
        }
        if (!admin.enabled()) {
            throw new ApiException.Forbidden("The admin API is disabled on this server.");
        }
        String provided = request.getHeader(HEADER);
        if (provided == null || !MessageDigest.isEqual(
                provided.getBytes(StandardCharsets.UTF_8), admin.apiKey().getBytes(StandardCharsets.UTF_8))) {
            throw new ApiException.Unauthorized("Missing or invalid " + HEADER + " header.");
        }
        return true;
    }
}
