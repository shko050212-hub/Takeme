import { Controller, Post, Body, Get, Param, Query, Res, Delete, Headers, Put, UseGuards, Req } from '@nestjs/common';
import type { Response } from 'express';
import { RoutingService } from './routing.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/auth-user.decorator';
import type { JwtPayload } from '../auth/auth-user.decorator';

@Controller('routing')
@UseGuards(JwtAuthGuard)
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  private resolveAcademyContext(
    req?: any,
    clientAcademyId?: string | number,
    clientUserId?: string | number
  ) {
    const isSuper = req?.user?.role === 'SUPER_ADMIN';
    const authAcademyId = req?.user?.academyId || req?.dbUser?.academyId || (req?.dbUser?.ownedAcademy ? req.dbUser.ownedAcademy.id : undefined);
    const authUserId = req?.user?.sub || req?.dbUser?.id;

    if (!isSuper && (authAcademyId || authUserId)) {
      return {
        academyId: authAcademyId ? Number(authAcademyId) : undefined,
        userId: authUserId ? Number(authUserId) : undefined,
      };
    }

    const a = clientAcademyId ?? authAcademyId;
    const u = clientUserId ?? authUserId;
    return {
      academyId: a && !isNaN(Number(a)) ? Number(a) : (authAcademyId ? Number(authAcademyId) : undefined),
      userId: u && !isNaN(Number(u)) ? Number(u) : (authUserId ? Number(authUserId) : undefined),
    };
  }

  @Get('academies')
  async getAllAcademies(@Req() req: any) {
    return this.routingService.getAllAcademies(req?.user);
  }

  @Get('initial-state')
  async getInitialState(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
    @Query('userId') userIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery, userIdHeader || userIdQuery);
    return this.routingService.getInitialState(academyId, userId);
  }

  @Get('export-excel')
  async exportExcel(
    @Req() req: any,
    @Res() res: Response,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery);
    const buffer = await this.routingService.generateExcelBuffer(academyId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="students.xlsx"',
      'Content-Length': buffer.length,
    });
    res.end(buffer);
  }

  @Get('daily-logs')
  async getDailyLogs(
    @Query('date') date: string,
    @Query('vehicleId') vehicleId: string,
  ) {
    return this.routingService.getDailyLogs(date, Number(vehicleId));
  }

  @Post('generate-auth-code')
  async generateAuthCode(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
    @Body('academyId') academyIdBody?: number,
  ) {
    const { academyId } = this.resolveAcademyContext(req, academyIdBody || academyIdHeader || academyIdQuery);
    return this.routingService.generateAuthCode(academyId);
  }

  @Post('approve-student')
  async approveStudent(@Body() body: { studentId: number }) {
    return this.routingService.approveStudent(body.studentId);
  }

  @Post('revoke-student')
  async revokeStudent(@Body() body: { studentId: number }) {
    return this.routingService.revokeStudent(body.studentId);
  }

  @Post('approve-staff')
  async approveStaff(@Body() body: { vehicleId: number, role: 'DRIVER' | 'TEACHER' }) {
    return this.routingService.approveStaff(body.vehicleId, body.role);
  }

  @Post('revoke-staff')
  async revokeStaff(@Body() body: { vehicleId: number, role: 'DRIVER' | 'TEACHER' }) {
    return this.routingService.revokeStaff(body.vehicleId, body.role);
  }

  @Post('revoke-teacher')
  async revokeTeacher(@Body() body: { teacherId: number }) {
    return this.routingService.revokeTeacher(Number(body.teacherId));
  }

  @Post('setup-academy')
  async setupAcademy(
    @Req() req: any,
    @Body() body: { name: string, address: string, lat: number, lng: number, businessNumber?: string, academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body.academyId || academyIdHeader, userIdHeader);
    return this.routingService.setupAcademy(body, academyId, userId);
  }

  @Post('absence')
  async createAbsence(@Body() body: { studentId: number, startDate: string, endDate: string }) {
    return this.routingService.createAbsence(body);
  }

  @Get('absences')
  async getAbsences(@Query('vehicleId') vehicleId?: string) {
    return this.routingService.getAbsences(vehicleId ? Number(vehicleId) : undefined);
  }

  @Delete('absence/:id')
  async deleteAbsence(@Param('id') id: string) {
    return this.routingService.deleteAbsence(Number(id));
  }

  @Post('holiday')
  async createHoliday(
    @Req() req: any,
    @Body() body: { startDate: string, endDate: string, reason?: string, academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
  ) {
    const { academyId } = this.resolveAcademyContext(req, body.academyId || academyIdHeader);
    return this.routingService.createHoliday(body, academyId);
  }

  @Get('holidays')
  async getHolidays(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery);
    return this.routingService.getHolidays(academyId, userId);
  }

  @Delete('holiday/:id')
  async deleteHoliday(@Param('id') id: string) {
    return this.routingService.deleteHoliday(Number(id));
  }

  @Post('delete-academy')
  async deleteAcademy(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Body('academyId') academyIdBody?: number,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdBody || academyIdHeader, userIdHeader);
    return this.routingService.deleteAcademy(academyId, userId);
  }

  @Post('init-zones')
  async initZones(
    @Req() req: any,
    @Body() body: { vehicles: any[], parsedData: any[], academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body.academyId || academyIdHeader, userIdHeader);
    return this.routingService.initializeZones(body.vehicles, body.parsedData, academyId, userId);
  }

  @Post('expand-zones-to-students')
  async expandZonesToStudents(
    @Req() req: any,
    @Body() body: { academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body?.academyId || academyIdHeader, userIdHeader);
    return this.routingService.expandZonesToStudents(academyId, userId);
  }

  @Get('yearly-zone-mappings')
  async getYearlyZoneMappings(
    @Req() req: any,
    @Query('academyId') academyIdQuery?: string,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdQuery || academyIdHeader, userIdHeader);
    return this.routingService.getYearlyZoneMappings(academyId, userId);
  }

  @Post('yearly-zone-mappings/archive')
  async archiveZoneMapping(
    @Req() req: any,
    @Body() body: { academyId?: number; academicYear?: string; title?: string; description?: string },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body.academyId || academyIdHeader, userIdHeader);
    return this.routingService.archiveCurrentZoneMapping(academyId, userId, body.academicYear, body.title, body.description);
  }

  @Post('yearly-zone-mappings/:id/restore')
  async restoreZoneMapping(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: { academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body?.academyId || academyIdHeader, userIdHeader);
    return this.routingService.restoreYearlyZoneMapping(Number(id), academyId, userId);
  }

  @Delete('yearly-zone-mappings/:id')
  async deleteZoneMapping(
    @Req() req: any,
    @Param('id') id: string,
    @Query('academyId') academyIdQuery?: string,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdQuery || academyIdHeader, userIdHeader);
    return this.routingService.deleteYearlyZoneMapping(Number(id), academyId, userId);
  }

  @Post('reset-zones')
  async resetZones(
    @Req() req: any,
    @Body() body: { academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body?.academyId || academyIdHeader, userIdHeader);
    return this.routingService.resetActiveZones(academyId, userId);
  }

  @Post('vehicle/:id/zone')
  async updateVehicleZone(
    @Param('id') id: string, 
    @Body() body: { email: string, polygonCoordinates: any[] }
  ) {
    return this.routingService.updateVehicleZone(Number(id), body.email, body.polygonCoordinates);
  }

  @Post('save-students')
  async saveStudents(
    @Req() req: any,
    @Body() body: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const students = Array.isArray(body) ? body : (body.students || []);
    const { academyId, userId } = this.resolveAcademyContext(req, (body && body.academyId) || academyIdHeader || academyIdQuery, userIdHeader);
    return this.routingService.saveStudents(students, academyId, userId);
  }

  @Post('add-student')
  async addStudent(
    @Req() req: any,
    @Body() body: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body?.academyId || academyIdHeader || academyIdQuery, userIdHeader);
    return this.routingService.addStudent(body || {}, academyId, userId);
  }

  @Delete('student/:id')
  async deleteStudent(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery, userIdHeader);
    return this.routingService.deleteStudent(Number(id), academyId, userId);
  }

  @Put('student/:id')
  async updateStudent(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, body?.academyId || academyIdHeader || academyIdQuery, userIdHeader);
    return this.routingService.updateStudent(Number(id), body || {}, academyId, userId);
  }

  @Delete('vehicle/:id')
  async deleteVehicle(
    @Req() req: any,
    @Param('id') id: string,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery, userIdHeader);
    return this.routingService.deleteVehicle(Number(id), academyId, userId);
  }

  @Post('pickup-point')
  async createPickupPoint(
    @Req() req: any,
    @Body() body: { name: string, latitude: number, longitude: number, academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
  ) {
    const { academyId } = this.resolveAcademyContext(req, body.academyId || academyIdHeader);
    return this.routingService.createPickupPoint(body, academyId);
  }

  @Get('pickup-points')
  async getPickupPoints(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery);
    return this.routingService.getPickupPoints(academyId);
  }

  @Delete('pickup-point/:id')
  async deletePickupPoint(@Param('id') id: string) {
    return this.routingService.deletePickupPoint(Number(id));
  }

  @Post('geocode-bulk')
  async geocodeBulk(@Body() body: { addresses: string[] }) {
    return this.routingService.geocodeBulk(body.addresses);
  }

  @Get('reverse-geocode')
  async reverseGeocode(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
    return this.routingService.reverseGeocode(parseFloat(lat), parseFloat(lng));
  }

  @Post('vehicle/:id')
  async updateVehicle(@Body() body: any, @Param('id') id: string) {
    return this.routingService.updateVehicle(Number(id), body);
  }

  @Get('admin-messages')
  async getAdminMessages(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery);
    return this.routingService.getAdminMessages(academyId, userId);
  }

  @Post('admin-messages/send')
  async sendAdminMessage(@Body() body: { targetRoles: string[], vehicleId: number | null, studentIds: number[], message: string }) {
    return this.routingService.sendAdminMessage(body);
  }

  // ===================== BOARD ROUTES =====================
  @Get('board/posts')
  async getBoardPosts(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
    @Query('visibility') visibility?: string,
    @Query('targetClass') targetClass?: string,
    @Query('search') search?: string,
    @Query('postType') postType?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery, userIdHeader);
    return this.routingService.getBoardPosts({ academyId, userId, visibility, targetClass, search, postType });
  }

  @Get('board/posts/:id')
  async getBoardPostById(@Param('id') id: string) {
    return this.routingService.getBoardPostById(Number(id));
  }

  @Post('board/posts')
  async createBoardPost(
    @Req() req: any,
    @Body() body: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @AuthUser() user?: JwtPayload,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader, userIdHeader);
    return this.routingService.createBoardPost(body, academyId, userId);
  }

  @Put('board/posts/:id')
  async updateBoardPost(
    @Param('id') id: string,
    @Body() body: any,
    @AuthUser() user?: JwtPayload,
  ) {
    return this.routingService.updateBoardPost(Number(id), body, user?.sub, user?.role);
  }

  @Put('board/:id')
  async updateBoardAlias(
    @Param('id') id: string,
    @Body() body: any,
    @AuthUser() user?: JwtPayload,
  ) {
    return this.routingService.updateBoardPost(Number(id), body, user?.sub, user?.role);
  }

  @Delete('board/posts/:id')
  async deleteBoardPost(
    @Param('id') id: string,
    @AuthUser() user?: JwtPayload,
  ) {
    return this.routingService.deleteBoardPost(Number(id), user?.sub, user?.role);
  }

  @Delete('board/:id')
  async deleteBoardAlias(
    @Param('id') id: string,
    @AuthUser() user?: JwtPayload,
  ) {
    return this.routingService.deleteBoardPost(Number(id), user?.sub, user?.role);
  }

  @Post('board/posts/:id/like')
  async toggleBoardPostLike(
    @Param('id') id: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Body('userId') userIdBody?: string,
  ) {
    const uid = userIdHeader || userIdBody;
    return this.routingService.toggleBoardPostLike(Number(id), uid);
  }

  @Post('board/posts/:id/comments')
  async addBoardComment(@Param('id') id: string, @Body() body: any) {
    return this.routingService.addBoardComment(Number(id), body);
  }

  @Delete('board/posts/:postId/comments/:commentId')
  async deleteBoardComment(@Param('commentId') commentId: string) {
    return this.routingService.deleteBoardComment(Number(commentId));
  }

  @Post('student/:id/note')
  async updateStudentNote(@Param('id') studentId: number, @Body('memo') memo: string) {
    return this.routingService.updateStudentNote(Number(studentId), memo);
  }

  @Post('student/:id/board-status')
  async updateStudentBoardStatus(@Param('id') studentId: number, @Body('boardStatus') boardStatus: string) {
    return this.routingService.updateStudentBoardStatus(Number(studentId), boardStatus);
  }

  @Post('student/:id/allergies')
  async updateStudentAllergies(@Param('id') studentId: number, @Body('allergies') allergies: string) {
    return this.routingService.updateStudentAllergies(Number(studentId), allergies);
  }

  @Post('student/:id/class')
  async updateStudentClass(@Param('id') studentId: number, @Body('className') className: string) {
    return this.routingService.updateStudentClass(Number(studentId), className);
  }

  @Post('students/assign-class')
  async batchAssignStudentClass(@Body() body: { studentIds: number[]; className: string }) {
    return this.routingService.batchAssignStudentClass(body.studentIds || [], body.className);
  }

  @Post('students/batch-update')
  async batchUpdateStudents(
    @Body('students') students: any[],
    @Body('academyId') academyId?: number,
    @Req() req?: any,
  ) {
    const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
    return this.routingService.batchUpdateStudents(students || [], academyId, userId);
  }

  @Post('board/upload')
  async uploadBoardMedia(
    @Body() body: { base64Data: string; filename?: string; mimeType?: string },
    @Headers('host') host: string
  ) {
    return this.routingService.uploadMedia(body, host);
  }

  @Get('teachers')
  async getTeachers(
    @Req() req: any,
    @Query('academyId') academyId?: string,
    @Headers('x-academy-id') headerA?: string,
    @Headers('x-user-id') headerU?: string
  ) {
    const { academyId: aId, userId: uId } = this.resolveAcademyContext(req, headerA || academyId, headerU);
    return this.routingService.getTeachers(aId, uId);
  }

  @Post('teacher/assign-class')
  async assignTeacherClass(@Body() body: { teacherId: number; assignedClass: string }) {
    return this.routingService.assignTeacherClass(Number(body.teacherId), body.assignedClass);
  }

  @Get('teacher/profile/:id')
  async getTeacherProfile(@Param('id') teacherId: string) {
    return this.routingService.getTeacherProfile(Number(teacherId));
  }

  @Post('unlock-user')
  async unlockUser(@Body() body: { userId?: number; email?: string }) {
    return this.routingService.unlockUser(body.userId ? Number(body.userId) : undefined, body.email);
  }

  @Get('audit-logs')
  async getAuditLogs(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '50', 10), 100);
    return this.routingService.getAuditLogs(take);
  }

  @Get('attendance')
  async getAcademyAttendance(
    @Req() req: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
    @Query('userId') userIdQuery?: string,
    @Query('date') dateQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(req, academyIdHeader || academyIdQuery, userIdHeader || userIdQuery);
    return this.routingService.getAcademyAttendance(academyId, userId, dateQuery);
  }
}
