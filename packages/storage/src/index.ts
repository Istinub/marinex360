/**
 * MarineX360 — file storage adapter (the config seam that keeps MinIO -> S3 config-only).
 *
 * The app NEVER constructs an S3 client itself; it imports from here. Local MinIO and
 * AWS S3 differ only by env values:
 *   - MinIO:  S3_ENDPOINT=http://localhost:9000  S3_FORCE_PATH_STYLE=true
 *   - AWS S3: S3_ENDPOINT unset (or regional)    S3_FORCE_PATH_STYLE=false
 *
 * Reference adapter owned by DevOps as the parity guarantee. BE/TL: import this rather
 * than newing up an S3Client anywhere, so the cloud move stays a .env change.
 */
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT || undefined, // undefined => AWS default endpoint
    region: env.S3_REGION ?? "ap-southeast-1",
    bucket: env.S3_BUCKET ?? "marinex360-local",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "false") === "true",
  };
}

export function createS3Client(cfg: StorageConfig = configFromEnv()): S3Client {
  return new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: cfg.forcePathStyle, // REQUIRED true for MinIO
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

export class Storage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): Storage {
    const cfg = configFromEnv(env);
    return new Storage(createS3Client(cfg), cfg.bucket);
  }

  async put(key: string, body: Uint8Array | string, contentType?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return res.Body!.transformToByteArray();
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  /** Presigned URL for client download/upload (API issues these; never expose keys). */
  async presignGet(key: string, expiresInSec = 900): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
  }
}
