import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** safe: 큰길 위주 추천 경로(유턴 회피), fast: 최단 시간 경로 */
export type RouteMode = 'safe' | 'fast';

export class LatLngDto {
  @ApiProperty({ example: 37.5585 }) lat: number;
  @ApiProperty({ example: 126.8352 }) lng: number;
}

export class DirectionsRequestDto {
  @ApiProperty({ type: LatLngDto, description: '출발지' })
  origin: LatLngDto;

  @ApiProperty({ type: LatLngDto, description: '도착지' })
  destination: LatLngDto;

  @ApiPropertyOptional({ type: [LatLngDto], description: '경유지 (정류장 순서대로, 최대 30개)' })
  waypoints?: LatLngDto[];

  @ApiPropertyOptional({ enum: ['safe', 'fast'], description: 'safe: 큰길 위주 안전 경로(기본), fast: 빠른 경로' })
  mode?: RouteMode;
}
