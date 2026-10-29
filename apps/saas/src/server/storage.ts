import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Where the media lives.
 *
 * The important part is what this module makes possible rather than what it does: the browser
 * uploads **straight to the bucket** with a presigned URL, and the worker reads from the bucket
 * with another one. The file never passes through the web server.
 *
 * That is not an optimisation, it is the difference between working and not. Reading uploads into
 * the server's memory means a thousand people uploading podcasts is a thousand hundred-megabyte
 * buffers, and the box dies long before any of them is transcribed.
 *
 * MinIO locally, Cloudflare R2 in production — same API, different endpoint. R2 because its egress
 * is free, and playback traffic would otherwise cost more than all the transcription.
 */

const endpoint = process.env.S3_ENDPOINT ?? "http://localhost:9000";
const region = process.env.S3_REGION ?? "auto";
export const bucket = process.env.S3_BUCKET ?? "recordings";

/**
 * Where the *browser* reaches storage.
 *
 * Inside the compose network the bucket is `minio:9000`, which means nothing to a browser. A
 * presigned URL has to be signed against the address the browser will actually use, so uploads
 * and playback are signed against this one and only the worker uses the internal address.
 */
const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT ?? endpoint;

let client: S3Client | null = null;
let signer: S3Client | null = null;

function make(forEndpoint: string): S3Client {
  return new S3Client({
    region,
    endpoint: forEndpoint,
    // MinIO serves buckets as a path, not a subdomain; R2 is happy either way.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "bevoiced",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "bevoiced123",
    },
  });
}

/** Reaching storage from inside: what the worker uses. */
function s3(): S3Client {
  client ??= make(endpoint);
  return client;
}

/** Signing URLs for the outside: what the browser is handed. */
function s3Public(): S3Client {
  signer ??= make(publicEndpoint);
  return signer;
}

export const storageConfigured = () => !!process.env.S3_ENDPOINT || process.env.NODE_ENV !== "production";

/** Where a recording's media sits. Namespaced by owner so nothing can collide or be guessed. */
export const keyFor = (userId: string, recordingId: string, filename: string) =>
  `u/${userId}/${recordingId}/${filename.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "recording"}`;

/** A URL the browser can PUT the file to directly. Short-lived on purpose. */
export function uploadUrl(key: string, contentType: string, expiresIn = 900): Promise<string> {
  return getSignedUrl(s3Public(), new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }), {
    expiresIn,
  });
}

/** A URL the worker can read the file from, over the internal network. */
export function downloadUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}

/** A URL the browser can play from. Same object, address it can actually reach. */
export function playbackUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(s3Public(), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
}
