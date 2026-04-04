import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock @aws-sdk/client-s3 before importing filebase module
vi.mock("@aws-sdk/client-s3", () => {
  const sendMock = vi.fn();
  return {
    S3Client: vi.fn(() => ({ send: sendMock })),
    PutObjectCommand: vi.fn((args: unknown) => ({
      _type: "PutObject",
      ...Object(args),
    })),
    HeadObjectCommand: vi.fn((args: unknown) => ({
      _type: "HeadObject",
      ...Object(args),
    })),
    __sendMock: sendMock,
  };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sendMock: any;

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv("FILEBASE_ACCESS_KEY", "test-key");
  vi.stubEnv("FILEBASE_SECRET_KEY", "test-secret");
  vi.stubEnv("FILEBASE_BUCKET", "test-bucket");

  const s3Module = await import("@aws-sdk/client-s3");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendMock = (s3Module as any).__sendMock;
  sendMock.mockReset();
});

import { getFilebaseClient, uploadToIPFS, uploadWithRetry } from "./filebase";

// ---------------------------------------------------------------------------
// getFilebaseClient
// ---------------------------------------------------------------------------

describe("getFilebaseClient", () => {
  it("throws when FILEBASE_ACCESS_KEY is missing", () => {
    vi.stubEnv("FILEBASE_ACCESS_KEY", "");
    expect(() => getFilebaseClient()).toThrow("Missing FILEBASE_ACCESS_KEY");
  });

  it("throws when FILEBASE_SECRET_KEY is missing", () => {
    vi.stubEnv("FILEBASE_SECRET_KEY", "");
    expect(() => getFilebaseClient()).toThrow("Missing FILEBASE_ACCESS_KEY or FILEBASE_SECRET_KEY");
  });

  it("returns an S3Client when credentials are set", () => {
    const client = getFilebaseClient();
    expect(client).toBeDefined();
    expect(client.send).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// uploadToIPFS
// ---------------------------------------------------------------------------

describe("uploadToIPFS", () => {
  it("throws when FILEBASE_BUCKET is missing", async () => {
    vi.stubEnv("FILEBASE_BUCKET", "");
    await expect(uploadToIPFS("content", "key.txt")).rejects.toThrow(
      "Missing FILEBASE_BUCKET"
    );
  });

  it("uploads content and returns CID from HeadObject metadata", async () => {
    // PutObject succeeds, HeadObject returns CID
    sendMock
      .mockResolvedValueOnce({}) // PutObjectCommand
      .mockResolvedValueOnce({ Metadata: { cid: "QmTestCid123" } }); // HeadObjectCommand

    const cid = await uploadToIPFS("chapter content", "plots/1-0.txt");
    expect(cid).toBe("QmTestCid123");
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("throws when HeadObject response has no CID", async () => {
    sendMock
      .mockResolvedValueOnce({}) // PutObjectCommand
      .mockResolvedValueOnce({ Metadata: {} }); // HeadObjectCommand — no cid

    await expect(uploadToIPFS("content", "key.txt")).rejects.toThrow(
      "Filebase response missing CID"
    );
  });
});

// ---------------------------------------------------------------------------
// uploadWithRetry
// ---------------------------------------------------------------------------

describe("uploadWithRetry", () => {
  it("returns CID on first success", async () => {
    sendMock
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Metadata: { cid: "QmFirst" } });

    const cid = await uploadWithRetry("content", "key.txt");
    expect(cid).toBe("QmFirst");
  });

  it("retries on failure and succeeds on second attempt", async () => {
    // First attempt: PutObject fails
    sendMock
      .mockRejectedValueOnce(new Error("Network error"))
      // Second attempt: succeeds
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Metadata: { cid: "QmRetry" } });

    const cid = await uploadWithRetry("content", "key.txt", 3);
    expect(cid).toBe("QmRetry");
  });

  it("throws after exhausting all retries", async () => {
    sendMock.mockRejectedValue(new Error("Persistent failure"));

    await expect(
      uploadWithRetry("content", "key.txt", 2)
    ).rejects.toThrow("Persistent failure");
  });
});
