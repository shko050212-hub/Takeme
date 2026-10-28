import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 경로 모드
 * - safe: 카카오 추천 경로(RECOMMEND) + 유턴 회피(avoid: uturn)
 * - fast: 카카오 최단 시간 경로(TIME)
 * 카카오 길찾기 API에는 도로 위험도 정보가 없으므로 'safe'는 위 두 기준까지만 보장한다.
 */
export type RouteMode = 'safe' | 'fast';

export class LatLngDto {
  @ApiProperty({ example: 37.5172 }) lat: number;
  @ApiProperty({ example: 127.0473 }) lng: number;
}

export class DirectionsRequestDto {
  @ApiProperty({ type: LatLngDto, description: '출발지' })
  origin: LatLngDto;

  @ApiProperty({ type: LatLngDto, description: '도착지' })
  destination: LatLngDto;

  @ApiPropertyOptional({ type: [LatLngDto], description: '경유지 (정류장 순서대로, 최대 30개)' })
  waypoints?: LatLngDto[];

  @ApiPropertyOptional({
    enum: ['safe', 'fast'],
    description: 'safe: 추천 경로 + 유턴 회피 (기본값), fast: 최단 시간',
  })
  mode?: RouteMode;
}
