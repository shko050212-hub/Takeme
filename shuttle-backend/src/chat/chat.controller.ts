import { Controller, Get, Post, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth-user.decorator';
import type { JwtPayload } from '../auth/auth-user.decorator';

/**
 * 메신저 API
 * - 모든 요청은 로그인 토큰 필수 (JwtAuthGuard)
 * - 사용자·기관은 토큰에서만 꺼낸다. 요청의 email / userId / academyId 값으로 사용자를 정하지 않는다.
 *   (통합 관리자만 academyId 쿼리로 대상 기관을 지정할 수 있다)
 */
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** 기관 결정: 통합 관리자는 쿼리로 지정 가능, 그 외에는 토큰의 기관만 */
  private resolveAcademyId(user: JwtPayload, academyIdQuery?: string): number | undefined {
    if (user.role === 'SUPER_ADMIN' && academyIdQuery && !isNaN(Number(academyIdQuery))) {
      return Number(academyIdQuery);
    }
    return user.academyId ? Number(user.academyId) : undefined;
  }

  @Get('users')
  async getUsers(
    @AuthUser() user: JwtPayload,
    @Query('academyId') academyId?: string,
    @Query('educationLevel') educationLevel?: string,
  ) {
    return this.chatService.getAcademyUsers(this.resolveAcademyId(user, academyId), user.email, educationLevel);
  }

  @Get('rooms')
  async getRooms(
    @AuthUser() user: JwtPayload,
    @Query('educationLevel') educationLevel?: string,
  ) {
    return this.chatService.getRoomsByEmail(user.email, educationLevel);
  }

  @Get('messages')
  async getMessages(
    @AuthUser() user: JwtPayload,
    @Query('roomId') roomId: string,
  ) {
    return this.chatService.getMessages(parseInt(roomId, 10), user.sub);
  }

  @Post('rooms')
  async createRoom(
    @AuthUser() user: JwtPayload,
    @Body('name') name?: string,
    @Body('type') type?: string,
    @Body('userIds') userIds?: number[],
  ) {
    return this.chatService.createRoomByEmail(name, type, userIds || [], user.email);
  }

  @Post('messages')
  async sendMessage(
    @AuthUser() user: JwtPayload,
    @Body('roomId') roomId: number,
    @Body('text') text: string,
  ) {
    return this.chatService.sendMessageAndBroadcast(Number(roomId), user.email, text);
  }

  @Post('rooms/:id/read')
  async markAsRead(
    @AuthUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.markRoomAsRead(parseInt(id, 10), user.sub);
  }

  // ============================================================
  // 결재 및 탑승 신청
  // ============================================================

  @Get('payment-context')
  async getPaymentContext(
    @AuthUser() user: JwtPayload,
    @Query('academyId') academyId?: string,
  ) {
    return this.chatService.getPaymentContext(this.resolveAcademyId(user, academyId), user.email);
  }

  @Get('payment/requests')
  async getPaymentRequests(
    @AuthUser() user: JwtPayload,
    @Query('academyId') academyId?: string,
  ) {
    return this.chatService.getPaymentRequests(this.resolveAcademyId(user, academyId));
  }

  @Post('payment-request')
  async createPaymentRequest(
    @AuthUser() user: JwtPayload,
    @Body() body: any,
  ) {
    return this.chatService.createPaymentRequest(body, user.email);
  }

  @Post('payment-request/:id/decision')
  async decidePaymentRequest(
    @AuthUser() user: JwtPayload,
    @Param('id') id: string,
    @Body('decision') decision: 'APPROVED' | 'REJECTED' | 'APPROVE' | 'REJECT',
    @Body('vehicleId') vehicleId?: number,
  ) {
    const normalizedDecision: 'APPROVED' | 'REJECTED' = (decision === 'APPROVE' || decision === 'APPROVED') ? 'APPROVED' : 'REJECTED';
    return this.chatService.decidePaymentRequest(Number(id), normalizedDecision, user.email, vehicleId ? Number(vehicleId) : undefined);
  }

  @Post('payment-request/:id/re-request')
  async reRequestPayment(
    @AuthUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: {
      suggestedLocation: { boardingLocation: string; address?: string; latitude: number; longitude: number };
      note: string;
    },
  ) {
    return this.chatService.reRequestPayment(Number(id), body, user.email);
  }

  @Post('payment-request/:id/push-parent')
  async pushParentNotification(
    @AuthUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.pushParentNotification(Number(id), user.email);
  }
}
