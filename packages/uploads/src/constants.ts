/**
 * Values shared by the api and web entry points. This module must stay free
 * of Node-only imports because the web bundle includes it.
 */

/** Header the client sends an upload token in. */
export const UPLOAD_TOKEN_HEADER = 'x-upload-token'
