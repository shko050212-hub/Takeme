import { BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { DirectionsService, ROUTE_CRITERIA } from './directions.service';

/** 카카오 응답 흉내 (출발지 → 우회전 → 경유지 → 좌회전 → 목적지) */
function kakaoResponse(priority = 'RECOMMEND') {
  return {
    data: {
      routes: [
        {
          result_code: 0,
          result_msg: '길찾기 성공',
          summary: { priority, distance: 1772, duration: 566 },
          sections: [
            {
              distance: 548,
              duration: 156,
              roads: [{ vertexes: [127.1099, 37.3944, 127.1096, 37.3944] }],
              guides: [
                { x: 127.1099, y: 37.3944, type: 100, guidance: '출발지' },
                { x: 127.1096, y: 37.3944, type: 2, guidance: '우회전' },
                { x: 127.1134, y: 37.3962, type: 1000, guidance: '경유지' },
              ],
            },
            {
              distance: 1224,
              duration: 410,
              roads: [{ vertexes: [127.1134, 37.3962, 127.1086, 37.4024] }],
              guides: [
                { x: 127.114, y: 37.3962, type: 1, guidance: '좌회전' },
                { x: 127.1086, y: 37.4024, type: 101, guidance: '목적지' },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('DirectionsService', () => {
  const req = {
    origin: { lat: 37.3944, lng: 127.1099 },
    destination: { lat: 37.4024, lng: 127.1086 },
    waypoints: [{ lat: 37.3962, lng: 127.1134 }],
  };

  function setup(response: any = kakaoResponse()) {
    const http = { post: jest.fn().mockReturnValue(of(response)) };
    const config = { get: jest.fn().mockReturnValue('TEST_KEY') };
    const service = new DirectionsService(http as any, config as any);
    return { service, http };
  }

  it('safe 모드는 추천 경로 + 유턴 회피로 카카오에 요청한다', async () => {
    const { service, http } = setup();
    const r = await service.getRoute({ ...req, mode: 'safe' });
    const body = http.post.mock.calls[0][1];
    expect(body.priority).toBe('RECOMMEND');
    expect(body.avoid).toEqual(['uturn']);
    expect(r.mode).toBe('safe');
    expect(r.criteria).toEqual({ priority: 'RECOMMEND', avoid: ['uturn'] });
  });

  it('fast 모드는 최단 시간으로 요청하고 avoid 를 보내지 않는다', async () => {
    const { service, http } = setup(kakaoResponse('TIME'));
    const r = await service.getRoute({ ...req, mode: 'fast' });
    const body = http.post.mock.calls[0][1];
    expect(body.priority).toBe('TIME');
    expect(body).not.toHaveProperty('avoid');
    expect(r.criteria).toEqual({ priority: 'TIME', avoid: [] });
  });

  it('mode 가 없으면 safe 로 처리한다', async () => {
    const { service, http } = setup();
    const r = await service.getRoute(req);
    expect(http.post.mock.calls[0][1].priority).toBe(ROUTE_CRITERIA.safe.priority);
    expect(r.mode).toBe('safe');
  });

  it('두 모드는 서로 다른 탐색 기준으로 요청된다', async () => {
    const a = setup();
    const b = setup();
    await a.service.getRoute({ ...req, mode: 'safe' });
    await b.service.getRoute({ ...req, mode: 'fast' });
    expect(a.http.post.mock.calls[0][1]).not.toEqual(b.http.post.mock.calls[0][1]);
  });

  it('거리·시간·경로 좌표·회전 횟수를 정리해서 돌려준다', async () => {
    const { service } = setup();
    const r = await service.getRoute(req);
    expect(r.distance).toBe(1772);
    expect(r.duration).toBe(566);
    expect(r.path[0]).toEqual({ lat: 37.3944, lng: 127.1099 }); // x=경도, y=위도 순서 변환
    expect(r.path).toHaveLength(4);
    expect(r.turnCount).toBe(2); // 우회전 + 좌회전 (출발지·경유지·목적지 제외)
    expect(r.sections).toHaveLength(2);
  });

  it('경로를 찾지 못하면 오류를 낸다', async () => {
    const { service } = setup({ data: { routes: [{ result_code: 104, result_msg: '출발지와 도착지가 너무 가까움' }] } });
    await expect(service.getRoute(req)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('경유지가 30개를 넘으면 거절한다', async () => {
    const { service } = setup();
    const many = Array.from({ length: 31 }, () => ({ lat: 37.5, lng: 127.0 }));
    await expect(service.getRoute({ ...req, waypoints: many })).rejects.toBeInstanceOf(BadRequestException);
  });
});
