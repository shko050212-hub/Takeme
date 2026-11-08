import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** DB 에는 서명 URL 이 아니라 이 접두사가 붙은 S3 파일 키를 저장한다. 예) s3:board/1700000000_ab12.jpg */
export const S3_REF_PREFIX = 's3:';
export const SIGNED_URL_EXPIRES_SEC = 3600;

type Env = Record<string, string | undefined>;

/** AWS_S3_BUCKET, AWS_REGION 이 둘 다 있을 때만 S3 사용 (자격 증명은 SDK 기본 순서: 환경변수 → EC2 역할 등) */
export function isS3Enabled(env: Env = process.env): boolean {
  return !!(env.AWS_S3_BUCKET && env.AWS_REGION);
}

let cachedClient: S3Client | null = null;
function getClient(): S3Client {
  if (!cachedClient) cachedClient = new S3Client({ region: process.env.AWS_REGION });
  return cachedClient;
}

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** 비공개 버킷 파일에 대한 1시간짜리 읽기용 서명 URL */
export async function signS3Key(key: string, expiresIn = SIGNED_URL_EXPIRES_SEC): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }),
    { expiresIn },
  );
}

/**
 * 저장용 값으로 변환한다.
 * - 이미 `s3:` 키면 그대로
 * - 우리 버킷의 S3 URL(서명 URL 포함)이면 `s3:` + 키
 * - 그 외(디스크 URL, data: 등)는 그대로
 */
export function toStoredMediaRef(value: string | null | undefined, env: Env = process.env): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.startsWith(S3_REF_PREFIX)) return value as string;
  const bucket = env.AWS_S3_BUCKET;
  if (!bucket || !/^https?:\/\//i.test(value)) return value;
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    const path = decodeURIComponent(u.pathname);
    if (host.endsWith('.amazonaws.com')) {
      if (host.startsWith(`${bucket.toLowerCase()}.s3`)) return S3_REF_PREFIX + path.replace(/^\//, '');
      if (host.startsWith('s3') && path.startsWith(`/${bucket}/`)) return S3_REF_PREFIX + path.slice(bucket.length + 2);
    }
  } catch {
    /* URL 이 아니면 그대로 */
  }
  return value;
}

export function toStoredMediaRefs(values: unknown, env: Env = process.env): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => toStoredMediaRef(v, env) as string);
}

/** 화면에 내려줄 값으로 변환한다. `s3:` 키는 매번 새 1시간 서명 URL 로 바꾼다. */
export async function resolveMediaRef(value: string | null | undefined): Promise<string | null> {
  if (value === null || value === undefined) return null;
  if (!value.startsWith(S3_REF_PREFIX)) return value;
  if (!isS3Enabled()) return '';
  return signS3Key(value.slice(S3_REF_PREFIX.length));
}

export async function resolveMediaRefs(values: unknown): Promise<string[]> {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const resolved = await resolveMediaRef(v);
    if (resolved) out.push(resolved);
  }
  return out;
}

