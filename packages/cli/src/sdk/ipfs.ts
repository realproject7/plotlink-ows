import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Filebase configuration for IPFS pinning via S3-compatible API.
 */
export interface FilebaseConfig {
  accessKey: string;
  secretKey: string;
  bucket: string;
}

/**
 * Create an S3-compatible client for Filebase IPFS pinning.
 */
function createFilebaseClient(config: FilebaseConfig): S3Client {
  return new S3Client({
    endpoint: "https://s3.filebase.com",
    region: "us-east-1",
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  });
}

/**
 * Upload content to Filebase (IPFS pinning via S3 API) and return the CID.
 *
 * The CID is retrieved from the HeadObject response metadata after upload.
 * Content is stored as UTF-8 plain text.
 */
export async function uploadToIPFS(
  content: string,
  key: string,
  config: FilebaseConfig,
): Promise<string> {
  const s3 = createFilebaseClient(config);

  await s3.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );

  const head = await s3.send(
    new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
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
 */
export async function uploadWithRetry(
  content: string,
  key: string,
  config: FilebaseConfig,
  maxRetries = 3,
): Promise<string> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await uploadToIPFS(content, key, config);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");
      if (attempt < maxRetries) {
        await new Promise((r) =>
          setTimeout(r, Math.pow(2, attempt - 1) * 1000),
        );
      }
    }
  }
  throw lastError || new Error("IPFS upload failed after retries");
}
