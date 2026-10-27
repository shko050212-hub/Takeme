import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { DirectionsRequestDto, LatLngDto } from './directions.dto';

const KAKAO_WAYPOINTS_URL = 'https://apis-navi.kakaomobility.com/v1/waypoints/directions';

/**
 * Kakao Mobility 길찾기 중계
 * 앱이 카카오 API 키를 갖지 않도록, 서버가 대신 호출하고 앱에 필요한 값만 돌려준다.
 */
@Injectable()
export class DirectionsService {
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

    const waypoints = req.waypoints ?? [];
    if (waypoints.length > 30) throw new BadRequestException('경유지는 최대 30개까지 가능합니다.');

    let data: any;
    try {
      const res = await firstValueFrom(
        this.http.post(
          KAKAO_WAYPOINTS_URL,
          {
            origin: this.toXY(req.origin, '출발지'),
            destination: this.toXY(req.destination, '도착지'),
            waypoints: waypoints.map((w, i) => this.toXY(w, `경유지 ${i + 1}`)),
            // 안전 경로: 큰길 위주의 추천 경로 + 유턴 회피 (통학버스 안전)
            // 빠른 경로: 최단 시간
            ...(req.mode === 'fast'
              ? { priority: 'TIME' }
              : { priority: 'RECOMMEND', avoid: ['uturn'] }),
          },
          { headers: { Authorization: `KakaoAK ${apiKey}`, 'Content-Type': 'application/json' } },
        ),
      );
      data = res.data;
    } catch (e: any) {
      if (e instanceof BadRequestException) throw e;
      console.error('Kakao directions error:', e?.response?.data ?? e?.message);
      throw new BadGatewayException('카카오 길찾기 호출에 실패했습니다.');
    }

    const route = data?.routes?.[0];
    if (!route || route.result_code !== 0) {
      throw new BadRequestException(route?.result_msg ?? '경로를 찾지 못했습니다.');
    }

    // 지도에 그릴 경로 좌표 (vertexes 는 [x1, y1, x2, y2, ...] 형태)
    const path: { lat: number; lng: number }[] = [];
    const guides: any[] = [];
    for (const section of route.sections ?? []) {
      for (const road of section.roads ?? []) {
        const v: number[] = road.vertexes ?? [];
        for (let i = 0; i + 1 < v.length; i += 2) path.push({ lat: v[i + 1], lng: v[i] });
      }
      for (const g of section.guides ?? []) {
        // 음성 안내(TTS)·회전 안내에 사용
        guides.push({ lat: g.y, lng: g.x, guidance: g.guidance, type: g.type, distance: g.distance, duration: g.duration });
      }
    }

    return {
      mode: req.mode === 'fast' ? 'fast' : 'safe',
      distance: route.summary?.distance, // m
      duration: route.summary?.duration, // 초
      sections: (route.sections ?? []).map((s: any) => ({ distance: s.distance, duration: s.duration })), // 정류장 사이 구간별
      path,
      guides,
    };
  }
}
