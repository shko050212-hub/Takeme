import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
}
