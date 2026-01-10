/**
 * JWT Utility functions for decoding and validating tokens in the frontend.
 */

/**
 * Robustly decodes a JWT token payload.
 * 
 * Handles base64url encoding (RFC 4648) by replacing '-' with '+' and '_' with '/'.
 * 
 * @param token The full JWT token string to decode
 * @returns The decoded payload object of type T, or null if decoding fails
 */
export const decodeJwtPayload = <T = any>(token: string): T | null => {
    if (!token) return null;

    try {
        const parts = token.split('.');
        if (parts.length !== 3 || !parts[1]) {
            return null;
        }

        // Convert base64url to standard base64
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');

        // Decode base64 to string
        const json = atob(base64);

        // Parse JSON
        return JSON.parse(json) as T;
    } catch (error) {
        return null;
    }
};
