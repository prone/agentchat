/** Shared validation patterns for API v1 routes. */

export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{1,99}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CHANNEL_NAME_RE = AGENT_NAME_RE; // Same format
