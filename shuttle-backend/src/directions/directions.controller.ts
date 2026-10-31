import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectionsService } from './directions.service';
import { DirectionsRequestDto } from './directions.dto';

@ApiTags('directions')
@Controller('directions')
export class DirectionsController {
  constructor(private readonly directionsService: DirectionsService) {}

  @Post()
  @ApiOperation({ summary: '정류장 순서대로 경로 조회 (Kakao Mobility 중계)' })
  getRoute(@Body() body: DirectionsRequestDto) {
    return this.directionsService.getRoute(body);
  }
}
