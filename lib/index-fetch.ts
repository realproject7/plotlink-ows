/**
 * Fetch wrapper for real-time indexer endpoints.
 * Indexer routes validate tx hashes server-side (existence + recency),
 * so no auth token is needed from the client.
 */

export function indexFetch(route: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
