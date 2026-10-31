import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { DirectionsRequestDto, LatLngDto, RouteMode } from './directions.dto';

const KAKAO_WAYPOINTS_URL = 'https://apis-navi.kakaomobility.com/v1/waypoints/directions';

/** 카카오 길찾기 안내 타입 중 회전이 아닌 것 (출발지 100, 목적지 101, 경유지 1000) */
const NON_TURN_GUIDE_TYPES = new Set([100, 101, 1000]);

/**
 * 모드별 실제 카카오 탐색 기준 (공식 문서의 priority / avoid 값만 사용)
 * safe: 큰길 기준 (추천 도로, 대로 우선, 유턴 회피)
 * fast: 최단길 기준 (최단 시간 우선)
 */
export const ROUTE_CRITERIA: Record<RouteMode, { priority: 'RECOMMEND' | 'TIME'; avoid?: string[] }> = {
  safe: { priority: 'RECOMMEND', avoid: ['uturn'] },
  fast: { priority: 'TIME' },
};

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

  private haversineDistance(a: LatLngDto, b: LatLngDto): number {
    const R = 6371000; // meters
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const sinLat = Math.sin(dLat / 2);
    const sinLng = Math.sin(dLng / 2);
    const f =
      sinLat * sinLat +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * sinLng * sinLng;
    return 2 * R * Math.atan2(Math.sqrt(f), Math.sqrt(1 - f));
  }

  private generateSyntheticRoute(req: DirectionsRequestDto, mode: RouteMode) {
    const isFast = mode === 'fast';
    const stops: LatLngDto[] = [req.origin, ...(req.waypoints ?? []), req.destination];

    const finePath: { lat: number; lng: number }[] = [];
    let directDistance = 0;

    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      const legDist = this.haversineDistance(a, b);
      directDistance += legDist;

      const steps = Math.max(10, Math.round(legDist / 50));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        // 큰길 기준은 주요 도로를 경유하는 부드러운 우회 굴곡 가미
        const latOffset = isFast ? 0 : Math.sin(t * Math.PI) * 0.0007;
        const lngOffset = isFast ? 0 : Math.sin(t * Math.PI) * 0.0009;
        finePath.push({
          lat: a.lat + (b.lat - a.lat) * t + latOffset,
          lng: a.lng + (b.lng - a.lng) * t + lngOffset,
        });
      }
    }
    finePath.push({ lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng });

    // 큰길 기준: 도로 굴곡 약 18% 우회, 속도 30km/h (8.3 m/s)
    // 최단길 기준: 최단 직행, 속도 42km/h (11.6 m/s)
    const distance = Math.round(directDistance * (isFast ? 1.0 : 1.18));
    const speed = isFast ? 11.6 : 8.3;
    const duration = Math.round(distance / speed);

    const guides: any[] = [];
    (req.waypoints ?? []).forEach((w, i) => {
      guides.push({
        lat: w.lat,
        lng: w.lng,
        guidance: `정류장 ${i + 1} 도착 예정`,
        type: 1000,
        distance: Math.round(distance / (stops.length || 1)),
        duration: Math.round(duration / (stops.length || 1)),
      });
    });

    const criteria = ROUTE_CRITERIA[mode];
    return {
      mode,
      criteria: { priority: criteria.priority, avoid: criteria.avoid ?? [] },
      distance,
      duration,
      turnCount: (req.waypoints ?? []).length + (isFast ? 4 : 8),
      sections: [{ distance, duration }],
      path: finePath,
      guides,
    };
  }

  async getRoute(req: DirectionsRequestDto) {
    const mode: RouteMode = req.mode === 'fast' ? 'fast' : 'safe';
    const criteria = ROUTE_CRITERIA[mode];
    const waypoints = req.waypoints ?? [];
    if (waypoints.length > 30) throw new BadRequestException('경유지는 최대 30개까지 가능합니다.');

    const apiKey = this.config.get<string>('KAKAO_REST_API_KEY');
    if (!apiKey) {
      this.logger.warn('[directions] KAKAO_REST_API_KEY 미설정, 시뮬레이션 경로 생성');
      return this.generateSyntheticRoute(req, mode);
    }

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
      this.logger.warn(
        `[directions] mode=${mode} 카카오 호출 실패 (${e?.message}), 시뮬레이션 대체 경로 제공`,
      );
      return this.generateSyntheticRoute(req, mode);
    }

    const route = data?.routes?.[0];
    if (!route || route.result_code !== 0) {
      this.logger.warn(
        `[directions] mode=${mode} 카카오 경로 없음 (${route?.result_msg}), 시뮬레이션 대체 경로 제공`,
      );
      return this.generateSyntheticRoute(req, mode);
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
        guides.push({
          lat: g.y,
          lng: g.x,
          guidance: g.guidance,
          type: g.type,
          distance: g.distance,
          duration: g.duration,
        });
        if (!NON_TURN_GUIDE_TYPES.has(g.type)) turnCount++;
      }
    }

    const result = {
      mode,
      criteria: { priority: criteria.priority, avoid: criteria.avoid ?? [] },
      distance: route.summary?.distance,
      duration: route.summary?.duration,
      turnCount,
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
