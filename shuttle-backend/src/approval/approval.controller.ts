import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { ApprovalStatus } from '../entities/approval-request.entity';

@Controller('approval')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post('request')
  async createRequest(@Body() data: any) {
    return this.approvalService.createRequest(data);
  }

  @Get('pending')
  async getPending(@Query('email') email: string, @Query('role') role: string) {
    return this.approvalService.getPendingRequests(email, role);
  }

  @Post(':id/decide')
  async decideRequest(@Param('id') id: string, @Body('decision') decision: ApprovalStatus) {
    return this.approvalService.decideRequest(parseInt(id, 10), decision);
  }
}
