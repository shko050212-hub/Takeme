import { Controller, Post, Get, Body, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthEmail, Roles } from '../auth/auth-user.decorator';
import { ParentService } from './parent.service';
import { OverrideType } from '../entities/schedule-override.entity';

@ApiTags('parent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('PARENT', 'STUDENT')
@Controller('parent')
export class ParentController {
  constructor(private readonly parentService: ParentService) {}

  @Post('override')
  async createOverride(
    @AuthEmail() email: string, 
    @Body('targetDate') targetDate: string,
    @Body('overrideType') overrideType: string,
    @Body('reason') reason: string
  ) {
    if (!email || !targetDate || !overrideType) {
      throw new BadRequestException('필수 정보가 누락되었습니다.');
    }
    
    const type = overrideType as OverrideType;
    if (![OverrideType.ABSENCE, OverrideType.CHANGE_LOCATION].includes(type)) {
      throw new BadRequestException('잘못된 신청 유형입니다.');
    }

    return this.parentService.createOverride(email, targetDate, type, reason);
  }

  @Post('register-info')
  async registerInfo(
    @AuthEmail() email: string,
    @Body() payload: any
  ) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.parentService.registerInfo(email, payload);
  }

  @Get('notifications')
  async getNotifications(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.parentService.getNotifications(email);
  }

  @Get('route')
  async getRoute(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('Email is required');
    return this.parentService.getRoute(email);
  }

  @Post('message')
  async createMessage(
    @AuthEmail() email: string,
    @Body('targetRoles') targetRoles: string[],
    @Body('message') message: string
  ) {
    if (!email) throw new BadRequestException('Email is required');
    return this.parentService.createMessage(email, targetRoles, message);
  }

  @Post('read-message')
  async readMessage(
    @AuthEmail() email: string,
    @Body('messageId') messageId: number
  ) {
    if (!email || !messageId) throw new BadRequestException('Email and messageId required');
    return this.parentService.readMessage(messageId, email);
  }

  @Get('today-schedule')
  async getTodaySchedule(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.parentService.getTodaySchedule(email);
  }
}
