import { BadGatewayException, BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { DirectionsRequestDto, LatLngDto, RouteMode } from './directions.dto';

const KAKAO_WAYPOINTS_URL = 'https://apis-navi.kakaomobility.com/v1/waypoints/directions';

/** 카카오 길찾기 안내 타입 중 회전이 아닌 것 (출발지 100, 목적지 101, 경유지 1000) */
const NON_TURN_GUIDE_TYPES = new Set([100, 101, 1000]);

/**
 * 모드별 실제 카카오 탐색 기준 (공식 문서의 priority / avoid 값만 사용)
 * https://developers.kakaomobility.com/docs/navi-api/waypoints/
 */
export const ROUTE_CRITERIA: Record<RouteMode, { priority: 'RECOMMEND' | 'TIME'; avoid?: string[] }> = {
  safe: { priority: 'RECOMMEND', avoid: ['uturn'] },
  fast: { priority: 'TIME' },
};

/**
 * Kakao Mobility 길찾기 중계
 * 앱이 카카오 API 키를 갖지 않도록, 서버가 대신 호출하고 앱에 필요한 값만 돌려준다.
 */
@Injectable()
export class DirectionsService {
  private readonly logger = new Logger(DirectionsService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  private toXY(p: LatLngDto, label: string) {
    if (p == null || typeof p.lat !== 'number' || typeof p.lng !== 'number') {
      throw new BadRequestException(`${label} 좌표(lat, lng)가 올바르지 않습니다.`);
    }
    return { x: String(p.lng), y: String(p.lat) }; // 카카오는 x=경도, y=위도
  }

  async getRoute(req: DirectionsRequestDto) {
    const apiKey = this.config.get<string>('KAKAO_REST_API_KEY');
    if (!apiKey) throw new BadRequestException('서버에 KAKAO_REST_API_KEY 가 없습니다.');

    const mode: RouteMode = req.mode === 'fast' ? 'fast' : 'safe';
    const criteria = ROUTE_CRITERIA[mode];
    const waypoints = req.waypoints ?? [];
    if (waypoints.length > 30) throw new BadRequestException('경유지는 최대 30개까지 가능합니다.');

    const body = {
      origin: this.toXY(req.origin, '출발지'),
      destination: this.toXY(req.destination, '도착지'),
      waypoints: waypoints.map((w, i) => this.toXY(w, `경유지 ${i + 1}`)),
      priority: criteria.priority,
      ...(criteria.avoid ? { avoid: criteria.avoid } : {}),
    };

    let data: any;
    try {
      const res = await firstValueFrom(
        this.http.post(KAKAO_WAYPOINTS_URL, body, {
          headers: { Authorization: `KakaoAK ${apiKey}`, 'Content-Type': 'application/json' },
        }),
      );
      data = res.data;
    } catch (e: any) {
      this.logger.warn(`[directions] mode=${mode} 카카오 호출 실패: ${JSON.stringify(e?.response?.data ?? e?.message)}`);
      throw new BadGatewayException('카카오 길찾기 호출에 실패했습니다.');
    }

    const route = data?.routes?.[0];
    if (!route || route.result_code !== 0) {
      this.logger.warn(`[directions] mode=${mode} 경로 없음: ${route?.result_msg}`);
      throw new BadRequestException(route?.result_msg ?? '경로를 찾지 못했습니다.');
    }

    // 지도에 그릴 좌표 (vertexes 는 [x1, y1, x2, y2, ...])
    const path: { lat: number; lng: number }[] = [];
    const guides: any[] = [];
    let turnCount = 0;
    for (const section of route.sections ?? []) {
      for (const road of section.roads ?? []) {
        const v: number[] = road.vertexes ?? [];
        for (let i = 0; i + 1 < v.length; i += 2) path.push({ lat: v[i + 1], lng: v[i] });
      }
      for (const g of section.guides ?? []) {
        guides.push({ lat: g.y, lng: g.x, guidance: g.guidance, type: g.type, distance: g.distance, duration: g.duration });
        if (!NON_TURN_GUIDE_TYPES.has(g.type)) turnCount++;
      }
    }

    const result = {
      mode,
      // 앱·로그에서 실제로 어떤 기준으로 탐색했는지 확인할 수 있게 그대로 돌려준다
      criteria: { priority: criteria.priority, avoid: criteria.avoid ?? [] },
      distance: route.summary?.distance, // m
      duration: route.summary?.duration, // 초
      turnCount, // 회전 안내 횟수 (경로 비교용)
      sections: (route.sections ?? []).map((s: any) => ({ distance: s.distance, duration: s.duration })),
      path,
      guides,
    };
    this.logger.log(
      `[directions] mode=${mode} priority=${criteria.priority} avoid=${(criteria.avoid ?? []).join(',') || '-'} ` +
        `waypoints=${waypoints.length} → distance=${result.distance}m duration=${result.duration}s turns=${turnCount} points=${path.length}`,
    );
    return result;
  }
}
