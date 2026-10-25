import { Controller, Post, Body, Get, Param, Query, Res, Delete, Headers } from '@nestjs/common';
import type { Response } from 'express';
import { RoutingService } from './routing.service';

@Controller('routing')
export class RoutingController {
  constructor(private readonly routingService: RoutingService) {}

  private resolveAcademyContext(headerA?: string, queryA?: string, headerU?: string, queryU?: string) {
    const a = headerA || queryA;
    const u = headerU || queryU;
    return {
      academyId: a && !isNaN(Number(a)) ? Number(a) : undefined,
      userId: u && !isNaN(Number(u)) ? Number(u) : undefined,
    };
  }

  @Get('academies')
  async getAllAcademies() {
    return this.routingService.getAllAcademies();
  }

  @Get('initial-state')
  async getInitialState(
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
    @Query('userId') userIdQuery?: string,
  ) {
    const { academyId, userId } = this.resolveAcademyContext(academyIdHeader, academyIdQuery, userIdHeader, userIdQuery);
    return this.routingService.getInitialState(academyId, userId);
  }

  @Get('export-excel')
  async exportExcel(
    @Res() res: Response,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const academyId = academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined);
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
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
    @Body('academyId') academyIdBody?: number,
  ) {
    const academyId = academyIdBody || (academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined));
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

  @Post('setup-academy')
  async setupAcademy(
    @Body() body: { name: string, address: string, lat: number, lng: number, academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const academyId = body.academyId || (academyIdHeader ? Number(academyIdHeader) : undefined);
    const userId = userIdHeader ? Number(userIdHeader) : undefined;
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
    @Body() body: { startDate: string, endDate: string, reason?: string, academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
  ) {
    const academyId = body.academyId || (academyIdHeader ? Number(academyIdHeader) : undefined);
    return this.routingService.createHoliday(body, academyId);
  }

  @Get('holidays')
  async getHolidays(
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const academyId = academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined);
    return this.routingService.getHolidays(academyId);
  }

  @Delete('holiday/:id')
  async deleteHoliday(@Param('id') id: string) {
    return this.routingService.deleteHoliday(Number(id));
  }

  @Post('delete-academy')
  async deleteAcademy(
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Body('academyId') academyIdBody?: number,
  ) {
    const academyId = academyIdBody || (academyIdHeader ? Number(academyIdHeader) : undefined);
    const userId = userIdHeader ? Number(userIdHeader) : undefined;
    return this.routingService.deleteAcademy(academyId, userId);
  }

  @Post('init-zones')
  async initZones(
    @Body() body: { vehicles: any[], parsedData: any[], academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
  ) {
    const academyId = body.academyId || (academyIdHeader ? Number(academyIdHeader) : undefined);
    const userId = userIdHeader ? Number(userIdHeader) : undefined;
    return this.routingService.initializeZones(body.vehicles, body.parsedData, academyId, userId);
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
    @Body() body: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const students = Array.isArray(body) ? body : (body.students || []);
    const academyId = (body && body.academyId) || (academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined));
    const userId = userIdHeader ? Number(userIdHeader) : undefined;
    return this.routingService.saveStudents(students, academyId, userId);
  }

  @Post('add-student')
  async addStudent(
    @Body() body: any,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const academyId = body?.academyId || (academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined));
    const userId = userIdHeader ? Number(userIdHeader) : undefined;
    return this.routingService.addStudent(body || {}, academyId, userId);
  }

  @Delete('student/:id')
  async deleteStudent(
    @Param('id') id: string,
    @Headers('x-academy-id') academyIdHeader?: string,
    @Headers('x-user-id') userIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const academyId = academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined);
    const userId = userIdHeader ? Number(userIdHeader) : undefined;
    return this.routingService.deleteStudent(Number(id), academyId, userId);
  }

  @Post('pickup-point')
  async createPickupPoint(
    @Body() body: { name: string, latitude: number, longitude: number, academyId?: number },
    @Headers('x-academy-id') academyIdHeader?: string,
  ) {
    const academyId = body.academyId || (academyIdHeader ? Number(academyIdHeader) : undefined);
    return this.routingService.createPickupPoint(body, academyId);
  }

  @Get('pickup-points')
  async getPickupPoints(
    @Headers('x-academy-id') academyIdHeader?: string,
    @Query('academyId') academyIdQuery?: string,
  ) {
    const academyId = academyIdHeader ? Number(academyIdHeader) : (academyIdQuery ? Number(academyIdQuery) : undefined);
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

  @Post('vehicle/:id')
  async updateVehicle(@Body() body: any, @Param('id') id: string) {
    return this.routingService.updateVehicle(Number(id), body);
  }

  @Get('admin-messages')
  async getAdminMessages() {
    return this.routingService.getAdminMessages();
  }

  @Post('admin-messages/send')
  async sendAdminMessage(@Body() body: { targetRoles: string[], vehicleId: number | null, studentIds: number[], message: string }) {
    return this.routingService.sendAdminMessage(body);
  }
}
