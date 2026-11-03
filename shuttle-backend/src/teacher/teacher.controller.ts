import { Controller, Get, Post, Body, Query, BadRequestException, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthEmail, Roles } from '../auth/auth-user.decorator';
import { TeacherService } from './teacher.service';

@ApiTags('teacher')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('DRIVER', 'TEACHER', 'SHUTTLE_TEACHER')
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

  // 1. 탑승 처리 (수동)
  @Post('board')
  @Post('board-student')
  async boardStudent(@AuthEmail() email: string, @Body() body: { studentId: number; reason?: string }) {
    if (!body?.studentId) throw new BadRequestException('원아 ID가 필요합니다.');
    return this.teacherService.boardStudent(email, Number(body.studentId), body.reason);
  }

  // 2. 하차 및 보호자 인계 완료
  @Post('dropoff')
  @Post('dropoff-student')
  async dropoffStudent(@AuthEmail() email: string, @Body() body: { studentId: number }) {
    if (!body?.studentId) throw new BadRequestException('원아 ID가 필요합니다.');
    return this.teacherService.dropoffStudent(email, Number(body.studentId));
  }

  // 3. 보호자 미인계 (재탑승)
  @Post('handover-failed')
  async handoverFailed(@AuthEmail() email: string, @Body() body: { studentId: number; reason?: string }) {
    if (!body?.studentId) throw new BadRequestException('원아 ID가 필요합니다.');
    return this.teacherService.handoverFailed(email, Number(body.studentId), body.reason);
  }

  // 4. 결석 / 건너뛰기
  @Post('skip-student')
  async skipStudent(@AuthEmail() email: string, @Body() body: { studentId: number }) {
    if (!body?.studentId) throw new BadRequestException('원아 ID가 필요합니다.');
    return this.teacherService.skipStudent(email, Number(body.studentId));
  }

  // 5. 정류장 인원 확인 완료 후 기사에게 출발 신호
  @Post('ready-to-depart')
  async readyToDepart(@AuthEmail() email: string, @Body() body?: { stopName?: string }) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.readyToDepart(email, body?.stopName);
  }

  // 6. 동승 시작
  @Post('start-escort')
  async startEscort(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.startEscort(email);
  }

  // 7. 동승 종료 (잔류 아동 검사 + 맨 뒷좌석 확인 필수)
  @Post('end-escort')
  async endEscort(
    @AuthEmail() email: string, 
    @Body() body: { checkedBackSeats: boolean; notes?: string }
  ) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.endEscort(email, !!body?.checkedBackSeats, body?.notes);
  }

  // 기사 앱 주행 이벤트 기록
  @Post('driving-event')
  async logDrivingEvent(
    @AuthEmail() email: string,
    @Body() body: { type: string; detail: string },
  ) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.logDrivingEvent(email, body?.type, body?.detail);
  }

  // Legacy operation hooks for compatibility
  @Post('start-operation')
  async startOperation(@AuthEmail() email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.startOperation(email);
  }

  @Post('end-operation')
  async endOperation(
    @AuthEmail() email: string,
    @Body() body?: { interiorChecked?: boolean },
  ) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.teacherService.endOperation(email, body?.interiorChecked);
  }

  @Post('student/:id/memo')
  async updateMemo(
    @Param('id') studentId: number, 
    @AuthEmail() email: string, 
    @Body() body: { memo: string }
  ) {
    return this.teacherService.updateMemo(email, Number(studentId), body.memo);
  }

  @Post('student-board')
  @Roles('STUDENT', 'PARENT')
  async studentBoardByQR(
    @AuthEmail() studentEmail: string,
    @Body('teacherEmail') teacherEmail: string
  ) {
    if (!studentEmail || !teacherEmail) throw new BadRequestException('필수 정보 누락');
    return this.teacherService.studentBoardByQR(studentEmail, teacherEmail);
  }

  @Get('staff')
  async getStaffList() {
    return this.teacherService.getStaffList();
  }

  @Post('send-message')
  @Post('message')
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
    return this.teacherService.replyMessage(email, Number(messageId), action);
  }

  @Post('read-message')
  async readMessage(
    @AuthEmail() email: string,
    @Body('messageId') messageId: number
  ) {
    if (!email || !messageId) throw new BadRequestException('필수 정보 누락');
    return this.teacherService.readMessage(email, Number(messageId));
  }

  @Post('emergency')
  async triggerEmergency(@AuthEmail() email: string, @Body() body?: { studentId?: number }) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    const studentId = body?.studentId ? Number(body.studentId) : undefined;
    return this.teacherService.triggerEmergency(email, studentId);
  }
}
