import { Controller, Get, Put, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthUser } from './auth-user.decorator';
import type { JwtPayload } from './auth-user.decorator';
import { getUserNotificationSettings } from '../utils/notification.util';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  @Get('notification-settings')
  async getNotificationSettings(@AuthUser() authUser: JwtPayload) {
    if (!authUser?.sub) throw new BadRequestException('로그인이 필요합니다.');
    const user = await this.userRepository.findOne({ where: { id: authUser.sub } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');
    return getUserNotificationSettings(user);
  }

  @Put('notification-settings')
  async updateNotificationSettings(
    @AuthUser() authUser: JwtPayload,
    @Body() body: Record<string, boolean>,
  ) {
    if (!authUser?.sub) throw new BadRequestException('로그인이 필요합니다.');
    const user = await this.userRepository.findOne({ where: { id: authUser.sub } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    const current = user.notificationSettings || {};
    const updated = { ...current, ...body };
    user.notificationSettings = updated;

    if (body.notifyShuttleOperation !== undefined) {
      user.notifyShuttleOperation = !!body.notifyShuttleOperation;
    }
    if (body.notifyBoardPost !== undefined) {
      user.notifyBoardPost = !!body.notifyBoardPost;
      if (body.notifyNotice === undefined) {
        user.notifyNotice = !!body.notifyBoardPost;
        updated.notifyNotice = !!body.notifyBoardPost;
        updated.notice = !!body.notifyBoardPost;
      }
      if (body.notifyPost === undefined) {
        user.notifyPost = !!body.notifyBoardPost;
        updated.notifyPost = !!body.notifyBoardPost;
        updated.post = !!body.notifyBoardPost;
      }
    }
    if (body.notifyNotice !== undefined) {
      user.notifyNotice = !!body.notifyNotice;
      updated.notice = !!body.notifyNotice;
    }
    if (body.notice !== undefined) {
      user.notifyNotice = !!body.notice;
      updated.notifyNotice = !!body.notice;
    }
    if (body.notifyPost !== undefined) {
      user.notifyPost = !!body.notifyPost;
      updated.post = !!body.notifyPost;
    }
    if (body.post !== undefined) {
      user.notifyPost = !!body.post;
      updated.notifyPost = !!body.post;
    }

    await this.userRepository.save(user);
    return {
      success: true,
      settings: getUserNotificationSettings(user),
    };
  }
}
