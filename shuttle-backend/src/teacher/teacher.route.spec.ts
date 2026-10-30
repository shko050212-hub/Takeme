import { TeacherService } from './teacher.service';

/**
 * 기사 앱 경로(getRoute) 검증
 * - 원장 웹에서 추가한 탑승지(pickup_point)가 경유지로 포함되는지
 * - 다른 유치원의 탑승지는 섞이지 않는지
 * - 원아 위치와 같은 좌표의 탑승지는 중복으로 넣지 않는지
 */
describe('TeacherService.getRoute (탑승지 경유)', () => {
  const academy = { id: 11, name: '테스트유치원', latitude: '37.6890', longitude: '127.0470' };
  const vehicle: any = { id: 33, busNumber: '1호차', academy, driverUser: { id: 69 } };

  function build(opts: { students?: any[]; pickupPoints?: any[] }) {
    const repo = (overrides: any = {}) => ({
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      create: jest.fn((x) => x),
      createQueryBuilder: jest.fn(),
      ...overrides,
    });
    const userRepo = repo({ findOne: jest.fn().mockResolvedValue({ id: 69, email: 'driver@test', role: 'DRIVER' }) });
    // 첫 findOne(teacherUser) 은 null, 두 번째(driverUser) 에서 차량을 찾음
    const vehicleRepo = repo({ findOne: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(vehicle) });
    const studentRepo = repo({ find: jest.fn().mockResolvedValue(opts.students ?? []) });
    const pickupRepo = repo({
      find: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve((opts.pickupPoints ?? []).filter((p) => p.academyId === where?.academy?.id)),
      ),
    });
    const service = new TeacherService(
      studentRepo as any, repo() as any, vehicleRepo as any, repo() as any, userRepo as any,
      repo() as any, repo() as any, repo() as any, repo() as any, null as any, pickupRepo as any,
    );
    return { service, pickupRepo };
  }

  it('원장 웹에서 추가한 탑승지가 stops 에 포함된다', async () => {
    const { service } = build({
      pickupPoints: [
        { id: 1, name: '도봉산역 1번 출구', latitude: 37.6896, longitude: 127.0446, academyId: 11 },
        { id: 2, name: '다른 유치원 탑승지', latitude: 37.5, longitude: 126.9, academyId: 1 },
      ],
    });
    const r = await service.getRoute('driver@test');
    expect(r.vehicleId).toBe(33);
    expect(r.stops.map((s: any) => s.name)).toEqual(['도봉산역 1번 출구']);
    expect(r.academy?.name).toBe('테스트유치원');
  });

  it('원아 위치와 같은 좌표의 탑승지는 중복으로 넣지 않는다', async () => {
    const { service } = build({
      students: [{ id: 5, name: '원아A', boardStatus: 'WAITING', latitude: 37.7, longitude: 127.05, raw: {} }],
      pickupPoints: [
        { id: 1, name: '같은 위치', latitude: 37.7, longitude: 127.05, academyId: 11 },
        { id: 2, name: '새 탑승지', latitude: 37.71, longitude: 127.06, academyId: 11 },
      ],
    });
    const r = await service.getRoute('driver@test');
    expect(r.stops.map((s: any) => s.name)).toEqual(['원아A', '새 탑승지']);
  });

  it('탑승 완료(BOARDED) 원아는 경유지에서 빠진다', async () => {
    const { service } = build({
      students: [
        { id: 5, name: '탄 원아', boardStatus: 'BOARDED', latitude: 37.7, longitude: 127.05, raw: {} },
        { id: 6, name: '기다리는 원아', boardStatus: 'WAITING', latitude: 37.72, longitude: 127.05, raw: {} },
      ],
    });
    const r = await service.getRoute('driver@test');
    expect(r.stops.map((s: any) => s.name)).toEqual(['기다리는 원아']);
  });
});

