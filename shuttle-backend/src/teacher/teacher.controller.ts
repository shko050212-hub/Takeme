import { Controller, Get, Post, Body, Query, BadRequestException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthEmail, Roles } from '../auth/auth-user.decorator';
import { TeacherService } from './teacher.service';

@ApiTags('teacher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('DRIVER', 'TEACHER')
@Controller('teacher')
export class TeacherController {
  constructor(private readonly teacherService: TeacherService) {}

  @Get('students')
  async getStudents(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.getStudents(email);
  }

  @Get('my-vehicle')
  async getMyVehicle(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.getMyVehicle(email);
  }

  @Get('route')
  async getRoute(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.getRoute(email);
  }

  @Get('inbox')
  async getInbox(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.getInbox(email);
  }

  @Get('operation-logs')
  async getOperationLogs(@AuthEmail() email: string, @Query('month') month: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.getOperationLogs(email, month);
  }

  @Post('board')
  async boardStudent(@AuthEmail() email: string, @Body() body: { studentId: number; reason?: string }) {
    return this.teacherService.boardStudent(email, body.studentId, body.reason);
  }

  @Post('skip-student')
  async skipStudent(@AuthEmail() email: string, @Body() body: { studentId: number }) {
    return this.teacherService.skipStudent(email, body.studentId);
  }

  @Post('start-operation')
  async startOperation(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.startOperation(email);
  }

  @Post('end-operation')
  async endOperation(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.endOperation(email);
  }

  @Post('student/:id/memo')
  async updateMemo(
    @Param('id') studentId: number, 
    @AuthEmail() email: string, @Body() body: { memo: string }
  ) {
    return this.teacherService.updateMemo(email, studentId, body.memo);
  }

  @Post('student-board')
  async studentBoardByQR(
    @Body('studentEmail') studentEmail: string,
    @AuthEmail() teacherEmail: string
  ) {
    if (!studentEmail || !teacherEmail) throw new BadRequestException('필수 정보 누락');
    return this.teacherService.studentBoardByQR(studentEmail, teacherEmail);
  }

  @Get('staff')
  async getStaffList() {
    return this.teacherService.getStaffList();
  }

  @Post('send-message')
  async sendMessage(
    @AuthEmail() email: string, 
    @Body('message') message: string, 
    @Body('studentIds') studentIds: number[],
    @Body('parentIds') parentIds: number[] = [],
    @Body('staffUserIds') staffUserIds: number[] = []
  ) {
    return this.teacherService.sendMessage(email, message, studentIds, parentIds, staffUserIds);
  }

  @Post('reply-message')
  async replyMessage(
    @AuthEmail() email: string,
    @Body('messageId') messageId: number,
    @Body('action') action: 'WAIT' | 'GO_AHEAD'
  ) {
    if (!email || !messageId || !action) throw new BadRequestException('필수 정보 누락');
    return this.teacherService.replyMessage(email, messageId, action);
  }

  @Post('read-message')
  async readMessage(
    @AuthEmail() email: string,
    @Body('messageId') messageId: number
  ) {
    if (!email || !messageId) throw new BadRequestException('필수 정보 누락');
    return this.teacherService.readMessage(email, messageId);
  }

  @Post('emergency')
  async triggerEmergency(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.triggerEmergency(email);
  }
}
