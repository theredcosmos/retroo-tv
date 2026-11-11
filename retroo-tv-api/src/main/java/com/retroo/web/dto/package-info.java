/**
 * Request/response DTOs. All are Java records: immutable, equals/hashCode/toString for free, serialised by
 * Jackson out of the box.
 *
 * <p>Why DTOs instead of returning JPA entities?</p>
 * <ul>
 *   <li>The API contract stays stable when the table changes.</li>
 *   <li>No lazy-loading surprises or accidental exposure of internal columns.</li>
 *   <li>Validation annotations belong on input DTOs, not on persistence entities.</li>
 * </ul>
 */
package com.retroo.web.dto;
