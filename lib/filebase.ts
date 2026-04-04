import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Create an S3-compatible client for Filebase IPFS pinning.
 *
 * Requires env vars: FILEBASE_ACCESS_KEY, FILEBASE_SECRET_KEY.
 */
export function getFilebaseClient(): S3Client {
  const accessKey = process.env.FILEBASE_ACCESS_KEY;
  const secretKey = process.env.FILEBASE_SECRET_KEY;
  if (!accessKey || !secretKey) {
    throw new Error(
      "Filebase not configured: Missing FILEBASE_ACCESS_KEY or FILEBASE_SECRET_KEY"
    );
  }
  return new S3Client({
    endpoint: "https://s3.filebase.com",
    region: "us-east-1",
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

/**
 * Upload content to Filebase (IPFS pinning via S3 API) and return the CID.
 *
 * The CID is retrieved from the HeadObject response metadata after upload.
 * Content is stored as UTF-8 plain text.
 *
 * @param content - The text content to upload
 * @param key - S3 object key (e.g. "plotlink/plots/42-0.txt")
 * @returns The IPFS CID string
 */
export async function uploadToIPFS(
  content: string,
  key: string
): Promise<string> {
  const bucket = process.env.FILEBASE_BUCKET;
  if (!bucket) {
    throw new Error("Filebase not configured: Missing FILEBASE_BUCKET");
  }

  const s3 = getFilebaseClient();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    })
  );

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: bucket, Key: key })
  );
  const cid = head.Metadata?.cid;
  if (!cid) {
    throw new Error("Filebase response missing CID in metadata");
  }

  return cid;
}

/**
 * Upload content to IPFS with retry logic.
 *
 * 3 attempts with exponential backoff (1s, 2s, 4s).
 * Same pattern as dropcast's upload retry.
 */
export async function uploadWithRetry(
  content: string,
  key: string,
  maxRetries = 3
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadToIPFS(content, key);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      if (attempt < maxRetries) {
        await new Promise((r) =>
          setTimeout(r, Math.pow(2, attempt - 1) * 1000)
        );
      }
    }
  }
  throw lastError || new Error("IPFS upload failed after retries");
}
