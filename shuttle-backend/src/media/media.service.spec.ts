import { MediaService } from './media.service';

describe('MediaService', () => {
  let service: MediaService;
  let mockRepo: any;
  let mockRoutingService: any;
  let mockLocationGateway: any;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn((dto) => ({ id: 1, ...dto, createdAt: new Date() })),
      save: jest.fn((asset) => Promise.resolve(asset)),
      findOne: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    mockRoutingService = {
      uploadMedia: jest.fn().mockResolvedValue({
        success: true,
        ref: 's3:board/test_image.jpg',
        url: 'https://s3.signed/test_image.jpg',
        filename: 'test_image.jpg',
        size: 1024,
      }),
    };
    mockLocationGateway = {
      broadcastMediaUploaded: jest.fn(),
      broadcastMediaDeleted: jest.fn(),
    };

    service = new MediaService(mockRepo, mockRoutingService, mockLocationGateway);
  });

  it('기관 정보가 없으면 업로드 실패', async () => {
    await expect(
      service.uploadMedia({ sub: 1, role: 'TEACHER', email: 't@t.com' } as any, {
        base64Data: 'data:image/png;base64,xxxx',
      }),
    ).rejects.toThrow('소속 기관 정보가 필요합니다.');
  });

  it('정상 사진 업로드 후 소켓 이벤트 발행 및 엔티티 반환', async () => {
    const user = { sub: 1, academyId: 10, role: 'SHUTTLE_TEACHER', name: '김교사', email: 't@t.com' } as any;
    const result = await service.uploadMedia(user, {
      base64Data: 'data:image/jpeg;base64,abc1234',
      vehicleId: 5,
      className: '해님반',
    });

    expect(mockRoutingService.uploadMedia).toHaveBeenCalled();
    expect(mockRepo.save).toHaveBeenCalled();
    expect(mockLocationGateway.broadcastMediaUploaded).toHaveBeenCalledWith(10, expect.anything());
    expect(result).toHaveProperty('storageKey', 's3:board/test_image.jpg');
    expect(result).toHaveProperty('className', '해님반');
    expect(result).toHaveProperty('vehicleId', 5);
  });

  it('사진 삭제 권한 검증: 본인 또는 관리자만 삭제 가능', async () => {
    const user = { sub: 2, academyId: 10, role: 'TEACHER' } as any;
    mockRepo.findOne.mockResolvedValue({ id: 99, academyId: 10, uploaderId: 1 }); // 다른 사람이 올린 사진

    await expect(service.deleteMedia(user, 99)).rejects.toThrow('사진을 삭제할 권한이 없습니다.');

    // 관리자는 삭제 가능
    const adminUser = { sub: 999, academyId: 10, role: 'ACADEMY_ADMIN' } as any;
    const deleteResult = await service.deleteMedia(adminUser, 99);
    expect(deleteResult).toEqual({ success: true, id: 99 });
    expect(mockLocationGateway.broadcastMediaDeleted).toHaveBeenCalledWith(10, 99);
  });
});

