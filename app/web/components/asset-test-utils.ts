import { vi } from "vitest";

/** Object URL returned by the stubbed `URL.createObjectURL` in jsdom tests. */
export const MOCK_BLOB_URL = "blob:mock-asset-url";

/**
 * jsdom doesn't implement the object-URL APIs that `useAuthedAsset` relies on.
 * Stub them so blob-backed asset loading works in component tests, and so a
 * test can assert that an `<img>` points at the object URL rather than the
 * raw auth-protected API route.
 */
export function installObjectUrlStub(): void {
  const u = URL as unknown as {
    createObjectURL: (b: Blob) => string;
    revokeObjectURL: (s: string) => void;
  };
  u.createObjectURL = vi.fn(() => MOCK_BLOB_URL);
  u.revokeObjectURL = vi.fn();
}

/**
 * `authFetch` double for tests that render asset-loading components. Asset
 * routes (`/asset/`) resolve to an image blob the way the real authenticated
 * route does; every other route resolves to `jsonData`. This mirrors the real
 * world where the Bearer header reaches both the data route and the image —
 * the bug being fixed was a raw `<img src>` that never sent that header.
 */
export function makeAssetAuthFetch(jsonData: unknown = {}) {
  return vi.fn((url: string) =>
    Promise.resolve(
      url.includes("/asset/")
        ? {
            ok: true,
            status: 200,
            blob: () => Promise.resolve(new Blob(["img-bytes"], { type: "image/webp" })),
          }
        : {
            ok: true,
            status: 200,
            json: () => Promise.resolve(jsonData),
          },
    ),
  );
}
