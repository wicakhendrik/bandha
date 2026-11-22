import "server-only";

/**
 * The Google "Web application" client id the sign-in button uses, read when the page is requested (not baked in at build
 * time), so changing it only needs a restart. GOOGLE_CLIENT_ID is the same variable the API uses; it may list several ids
 * separated by commas, and the first one is the web one. Null = Google sign-in is off and the button is not shown.
 */
export const googleClientId = (): string | null => process.env.GOOGLE_CLIENT_ID?.split(",")[0]?.trim() || null;
