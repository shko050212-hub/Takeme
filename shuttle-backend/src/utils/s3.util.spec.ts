import {
  S3_REF_PREFIX,
  isS3Enabled,
  resolveMediaRef,
  resolveMediaRefs,
  toStoredMediaRef,
  toStoredMediaRefs,
} from './s3.util';

const ENV = { AWS_S3_BUCKET: 'takeme-photos', AWS_REGION: 'ap-northeast-2' };

describe('s3.util', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('isS3Enabled: 버킷과 리전이 모두 있어야 한다', () => {
    expect(isS3Enabled(ENV)).toBe(true);
    expect(isS3Enabled({ AWS_S3_BUCKET: 'a' })).toBe(false);
    expect(isS3Enabled({ AWS_REGION: 'a' })).toBe(false);
    expect(isS3Enabled({})).toBe(false);
  });

  it('toStoredMediaRef: 서명 URL 은 키로 바뀌고, 디스크 URL·data URL 은 그대로', () => {
    const signed =
      'https://takeme-photos.s3.ap-northeast-2.amazonaws.com/board/17_ab.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=3600&X-Amz-Signature=abc';
    expect(toStoredMediaRef(signed, ENV)).toBe('s3:board/17_ab.jpg');
    expect(toStoredMediaRef('https://takeme-photos.s3.amazonaws.com/board/x.png', ENV)).toBe('s3:board/x.png');
    expect(toStoredMediaRef('https://s3.ap-northeast-2.amazonaws.com/takeme-photos/board/y.webp?X=1', ENV)).toBe('s3:board/y.webp');
    expect(toStoredMediaRef('s3:board/z.jpg', ENV)).toBe('s3:board/z.jpg');
    const disk = 'https://52.63.245.203.sslip.io/uploads/board/1_a.jpg';
    expect(toStoredMediaRef(disk, ENV)).toBe(disk);
    expect(toStoredMediaRef('data:image/png;base64,AAAA', ENV)).toBe('data:image/png;base64,AAAA');
    // 다른 버킷의 URL 은 건드리지 않는다
    const other = 'https://other-bucket.s3.ap-northeast-2.amazonaws.com/board/a.jpg?X=1';
    expect(toStoredMediaRef(other, ENV)).toBe(other);
    expect(toStoredMediaRef(null, ENV)).toBeNull();
  });

  it('toStoredMediaRefs: 배열 정리', () => {
    expect(toStoredMediaRefs(['s3:board/a.jpg', '', 3, 'https://x/y.jpg'], ENV)).toEqual(['s3:board/a.jpg', 'https://x/y.jpg']);
    expect(toStoredMediaRefs(undefined, ENV)).toEqual([]);
  });

  it('resolveMediaRef: 키는 매번 1시간 서명 URL 로, 그 외는 그대로', async () => {
    Object.assign(process.env, ENV, { AWS_ACCESS_KEY_ID: 'AKIATESTTESTTESTTEST', AWS_SECRET_ACCESS_KEY: 'secretsecretsecretsecretsecretsecret12' });
    const url = (await resolveMediaRef(`${S3_REF_PREFIX}board/a.jpg`)) as string;
    expect(url).toContain('takeme-photos.s3.ap-northeast-2.amazonaws.com/board/a.jpg');
    expect(url).toContain('X-Amz-Expires=3600');
    expect(url).toContain('X-Amz-Signature=');
    expect(await resolveMediaRef('https://x/y.jpg')).toBe('https://x/y.jpg');
    expect(await resolveMediaRef(null)).toBeNull();
    expect(await resolveMediaRefs(['s3:board/a.jpg', 'https://x/y.jpg'])).toHaveLength(2);
  });

  it('resolveMediaRef: S3 설정이 없으면 키는 빈 값(깨진 링크를 만들지 않는다)', async () => {
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_REGION;
    expect(await resolveMediaRef('s3:board/a.jpg')).toBe('');
    expect(await resolveMediaRefs(['s3:board/a.jpg', 'https://x/y.jpg'])).toEqual(['https://x/y.jpg']);
  });
});

