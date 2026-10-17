import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/auth-user.decorator';
import { DirectionsService } from './directions.service';
import { DirectionsRequestDto } from './directions.dto';

@ApiTags('directions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('DRIVER', 'TEACHER', 'ACADEMY_ADMIN')
@Controller('directions')
export class DirectionsController {
  constructor(private readonly directionsService: DirectionsService) {}

  @Post()
  @ApiOperation({ summary: '정류장 순서대로 경로 조회 (Kakao Mobility 중계)' })
  getRoute(@Body() body: DirectionsRequestDto) {
    return this.directionsService.getRoute(body);
  }
}
