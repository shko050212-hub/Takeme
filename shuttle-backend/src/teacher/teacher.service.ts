import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Student } from '../entities/student.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Notification } from '../entities/notification.entity';
import { User, UserRole } from '../entities/user.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { OperationLog } from '../entities/operation-log.entity';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { AcademyHoliday } from '../entities/academy-holiday.entity';
import { PickupPoint } from '../entities/pickup-point.entity';
import { LocationGateway } from './location.gateway';

@Injectable()
export class TeacherService {
  constructor(
    @InjectRepository(Student) private studentRepository: Repository<Student>,
    @InjectRepository(StudentSchedule) private studentScheduleRepository: Repository<StudentSchedule>,
    @InjectRepository(Vehicle) private vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Notification) private notificationRepository: Repository<Notification>,
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(ParentMessage) private messageRepository: Repository<ParentMessage>,
    @InjectRepository(OperationLog) private operationLogRepository: Repository<OperationLog>,
    @InjectRepository(ScheduleOverride) private scheduleOverrideRepository: Repository<ScheduleOverride>,
    @InjectRepository(AcademyHoliday) private academyHolidayRepository: Repository<AcademyHoliday>,
    private readonly locationGateway: LocationGateway,
    @Optional() @InjectRepository(PickupPoint) private pickupPointRepository?: Repository<PickupPoint>,
  ) {}

  private async isTodayHoliday(): Promise<boolean> {
    const today = new Date().toISOString().split('T')[0];
    const holiday = await this.academyHolidayRepository.findOne({
      where: {
        startDate: LessThanOrEqual(today),
        endDate: MoreThanOrEqual(today),
      }
    });
    return !!holiday;
  }

  private async getActiveOverridesForToday(): Promise<ScheduleOverride[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.scheduleOverrideRepository.find({
      where: {
        startDate: LessThanOrEqual(today),
        endDate: MoreThanOrEqual(today),
      },
      relations: { student: true }
    });
  }

  private async getTodayStudentsForVehicle(vehicleId: number): Promise<Student[]> {
    const defaultStudents = await this.studentRepository.find({ 
      where: { assignedVehicle: { id: vehicleId } } 
    });
    const overrides = await this.getActiveOverridesForToday();
    
    // Students originally in this vehicle, but who are NOT absent and have NOT moved to another vehicle today
    const currentStudents = defaultStudents.filter(s => {
      const override = overrides.find(o => o.student.id === s.id);
      if (!override) return true;
      if (override.overrideType === OverrideType.ABSENCE) return false;
      if (override.overrideType === OverrideType.CHANGE_LOCATION && override.newVehicleId && override.newVehicleId !== vehicleId) return false;
      return true;
    });

    // Students originally in ANOTHER vehicle, but who MOVED INTO this vehicle today
    const movedInStudentIds = overrides
      .filter(o => o.overrideType === OverrideType.CHANGE_LOCATION && o.newVehicleId === vehicleId)
      .map(o => o.student.id);

    const movedInStudents = movedInStudentIds.length > 0 
      ? await this.studentRepository.createQueryBuilder('s').where('s.id IN (:...ids)', { ids: movedInStudentIds }).getMany() 
      : [];

    // Filter out moved-in students who might already be in defaultStudents just in case
    const movedInFiltered = movedInStudents.filter((s: Student) => !currentStudents.find((cs: Student) => cs.id === s.id));
    movedInFiltered.forEach((s: Student) => (s as any).isOverride = true);

    return [...currentStudents, ...movedInFiltered];
  }

  async getMyVehicle(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    
    // Find vehicle where teacherUser or driverUser matches this user
    let vehicle: Vehicle | null = await this.findAssignedVehicle(user.id);
    if (!vehicle) {
      vehicle = await this.vehicleRepository.findOne({ where: { driverUser: { id: user.id } } });
    }
    
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');
    
    // Convert stringified polygon to array if it's stored as JSON string
    // In our entity it might be simple-json or string
    let polygon = vehicle.polygonCoordinates;
    if (typeof polygon === 'string') {
      try { polygon = JSON.parse(polygon); } catch(e) { polygon = []; }
    }
    
    return {
      id: vehicle.id,
      name: vehicle.busNumber,
      polygon: polygon || []
    };
  }

  /**
   * 로그인한 직원(지도교사 또는 기사)에게 배정된 차량 찾기.
   * 기존에는 teacherUser 로만 찾아서 기사(DRIVER) 계정은 차량을 못 찾던 문제 수정.
   * 차량 재초기화로 연결이 끊긴 경우 소속 유치원 또는 가장 최근에 생성된 유치원 차량을 우선 연결한다.
   */
  private async findAssignedVehicle(userId: number, relations: any = {}) {
    let v =
      (await this.vehicleRepository.findOne({ where: { teacherUser: { id: userId } }, relations })) ||
      (await this.vehicleRepository.findOne({ where: { driverUser: { id: userId } }, relations }));
    if (v) return v;

    const user = await this.userRepository.findOne({ where: { id: userId }, relations: { academy: true } });
    if (user?.academy) {
      v = await this.vehicleRepository.findOne({
        where: { academy: { id: user.academy.id } },
        relations,
        order: { id: 'DESC' },
      });
      if (v) {
        if (!v.driverUser && user.role === 'DRIVER') {
          v.driverUser = user;
          await this.vehicleRepository.save(v).catch(() => {});
        }
        return v;
      }
    }

    if (user?.name) {
      v = await this.vehicleRepository.findOne({
        where: [{ driverName: user.name }, { teacherName: user.name }],
        relations,
        order: { id: 'DESC' },
      });
      if (v) return v;
    }

    const allVehicles = await this.vehicleRepository.find({
      relations,
      order: { id: 'DESC' },
      take: 1,
    });
    return allVehicles[0] || null;
  }

  async getStudents(email: string) {
    if (await this.isTodayHoliday()) return [];

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) return []; // No assigned vehicle

    const students = await this.getTodayStudentsForVehicle(vehicle.id);
    
    // Return boardStatus from DB, filter out absent students
    return students
      .map(s => ({
      id: s.id,
      name: s.adminDisplayName || s.name,
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      boarded: s.boardStatus === 'BOARDED',
      absent: s.boardStatus === 'ABSENT',
      expectedTime: s.raw ? s.raw['예상탑승시간'] || '15:30' : '15:30',
      allergies: s.allergies || (s.raw ? s.raw['알레르기'] : '') || '',
      teacherMemo: s.teacherMemo,
      runNumber: s.runNumber || 1,
      isOverride: (s as any).isOverride || false
    }));
  }

  async getRoute(email: string) {
    if (await this.isTodayHoliday()) {
      return { stops: [], routePoints: [], academy: null, vehicleId: null };
    }

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id, { academy: true });
    if (!vehicle) return { stops: [], routePoints: [], academy: null, vehicleId: null };

    const students = await this.getTodayStudentsForVehicle(vehicle.id);

    // 원장 웹에서 추가한 탑승지(pickup_point)도 경유지로 포함 (같은 유치원 것만)
    let pickupPoints: PickupPoint[] = [];
    if (this.pickupPointRepository && vehicle.academy?.id) {
      pickupPoints = await this.pickupPointRepository.find({
        where: { academy: { id: vehicle.academy.id } },
        order: { id: 'ASC' },
      });
    }

    // Convert students and pickup points to route stops
    const uniqueStopKeys = new Set<string>();
    let stops: {
      id: number;
      name: string;
      address: string;
      latitude: number;
      longitude: number;
      expectedTime: string;
    }[] = [];

    for (const s of students) {
      if (s.boardStatus === 'WAITING' && s.latitude && s.longitude) {
        const lat = parseFloat(s.latitude as any);
        const lng = parseFloat(s.longitude as any);
        if (!isNaN(lat) && !isNaN(lng)) {
          const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
          uniqueStopKeys.add(key);
          stops.push({
            id: s.id,
            name: s.adminDisplayName || s.name,
            address: s.address,
            latitude: lat,
            longitude: lng,
            expectedTime: s.raw ? s.raw['예상탑승시간'] || '15:30' : '15:30',
          });
        }
      }
    }

    for (const p of pickupPoints) {
      if (p.latitude != null && p.longitude != null) {
        const lat = parseFloat(p.latitude as any);
        const lng = parseFloat(p.longitude as any);
        if (!isNaN(lat) && !isNaN(lng)) {
          const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
          if (!uniqueStopKeys.has(key)) {
            uniqueStopKeys.add(key);
            stops.push({
              id: 100000 + p.id,
              name: p.name,
              address: p.name,
              latitude: lat,
              longitude: lng,
              expectedTime: '탑승지',
            });
          }
        }
      }
    }

    // TSP Optimization (Nearest Neighbor)
    const sortedStops = [];
    if (stops.length > 0) {
      let currentLat = vehicle.academy && vehicle.academy.latitude ? parseFloat(vehicle.academy.latitude as any) : stops[0].latitude;
      let currentLng = vehicle.academy && vehicle.academy.longitude ? parseFloat(vehicle.academy.longitude as any) : stops[0].longitude;

      while (stops.length > 0) {
        let nearestIndex = 0;
        let minDistance = Infinity;
        
        for (let i = 0; i < stops.length; i++) {
           const dx = stops[i].longitude - currentLng;
           const dy = stops[i].latitude - currentLat;
           const distSq = dx*dx + dy*dy;
           if (distSq < minDistance) {
             minDistance = distSq;
             nearestIndex = i;
           }
        }
        const nearest = stops.splice(nearestIndex, 1)[0];
        sortedStops.push(nearest);
        currentLat = nearest.latitude;
        currentLng = nearest.longitude;
      }
    }
    
    stops = sortedStops;

    const routePoints = [];
    if (vehicle.academy && vehicle.academy.latitude && vehicle.academy.longitude) {
      routePoints.push({ latitude: vehicle.academy.latitude, longitude: vehicle.academy.longitude });
    }
    stops.forEach(s => routePoints.push({ latitude: s.latitude, longitude: s.longitude }));
    if (vehicle.academy && vehicle.academy.latitude && vehicle.academy.longitude) {
      routePoints.push({ latitude: vehicle.academy.latitude, longitude: vehicle.academy.longitude });
    }

    return {
      vehicleId: vehicle.id,
      academy: vehicle.academy ? { latitude: vehicle.academy.latitude, longitude: vehicle.academy.longitude, name: vehicle.academy.name } : null,
      stops,
      routePoints
    };
  }

  async getInbox(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const messages = await this.messageRepository.find({
      relations: { student: true, receiverUser: true },
      order: { createdAt: 'DESC' }
    });

    return messages
      .filter(m => {
        if (m.receiverUser) return m.receiverUser.id === user.id;
        if (m.targetRoles && Array.isArray(m.targetRoles)) {
          return m.targetRoles.includes('TEACHER') || m.targetRoles.includes('HOMEROOM_TEACHER') || m.targetRoles.includes('SHUTTLE_TEACHER') || m.targetRoles.includes('ALL');
        }
        return true;
      })
      .map(m => ({
      id: m.id,
      message: m.message,
      createdAt: m.createdAt,
      isRead: m.isRead,
      student: m.student ? { id: m.student.id, name: m.student.adminDisplayName || m.student.name } : null,
      receiverUser: m.receiverUser ? { id: m.receiverUser.id, name: m.receiverUser.name } : null
    }));
  }

  async updateMemo(email: string, studentId: number, memo: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);

    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('Student not found');

    student.teacherMemo = memo;
    await this.studentRepository.save(student);

    if (vehicle) {
      // 최근 학부모 메세지 조회
      const latestMessage = await this.messageRepository.findOne({
        where: { student: { id: studentId } },
        order: { createdAt: 'DESC' }
      });

      let adminLogMessage = `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 지도교사 메모 업데이트: ${memo}`;
      if (latestMessage) {
        const timeStr = new Date(latestMessage.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        adminLogMessage = `[${student.adminDisplayName || student.name} 학부모님 ${timeStr} 메세지] ${latestMessage.message}\n` +
                          `▶ 교사 확인 메모: ${memo}`;
      }

      const noti = this.notificationRepository.create({
        vehicle: vehicle,
        message: adminLogMessage
      });
      await this.notificationRepository.save(noti);
    }
    return { success: true };
  }

  async boardStudent(email: string, studentId: number, reason?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id, { academy: true });

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId },
      relations: { parentUser: true }
    });
    if (!student) throw new BadRequestException('Student not found');

    // Update status
    student.boardStatus = 'BOARDED';
    student.actualBoardTime = new Date();
    await this.studentRepository.save(student);

    if (vehicle) {
      // 1. Create a Notification for the academy admin
      let msg = `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 탑승 완료`;
      if (reason) {
        msg += ` (수동 탑승 사유: ${reason})`;
      }
      const adminNoti = this.notificationRepository.create({
        vehicle: vehicle,
        message: msg
      });
      await this.notificationRepository.save(adminNoti);

      // 3. Append to OperationLog
      await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'MANUAL');
      this.locationGateway?.broadcastRouteUpdated(vehicle.academy?.id);
    }

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async skipStudent(email: string, studentId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('Student not found');

    student.boardStatus = 'ABSENT';
    await this.studentRepository.save(student);

    const vehicle = await this.findAssignedVehicle(user.id, { academy: true });
    if (vehicle) {
      const adminNoti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 결석/건너뛰기`
      });
      await this.notificationRepository.save(adminNoti);
      await this.appendBoardingLog(vehicle.id, studentId, `${student.adminDisplayName || student.name} 원생 결석 처리`, 'SYSTEM');
      this.locationGateway?.broadcastRouteUpdated(vehicle.academy?.id);
    }

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async startOperation(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (vehicle) {
      const noti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${vehicle.busNumber}호차 운행이 시작되었습니다. (${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`
      });
      await this.notificationRepository.save(noti);

      // Create new OperationLog
      const dateString = new Date().toISOString().split('T')[0];
      const log = this.operationLogRepository.create({
        vehicle,
        dateString,
        startTime: new Date(),
        boardingRecords: []
      });
      await this.operationLogRepository.save(log);
      await this.appendBoardingLog(vehicle.id, null, '운행 시작', 'SYSTEM');
      if (this.locationGateway) {
        this.locationGateway.broadcastOperationStatus(vehicle.id, true, vehicle.busNumber);
      }
    }
    return { success: true };
  }

  async endOperation(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (vehicle) {
      const noti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${vehicle.busNumber}호차 운행이 종료되었습니다. (${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})`
      });
      await this.notificationRepository.save(noti);

      if (this.locationGateway) {
        this.locationGateway.broadcastOperationStatus(vehicle.id, false, vehicle.busNumber);
      }

      // 미탑승 학생 자동 결석 처리
      const waitingStudents = await this.studentRepository.find({
        where: { assignedVehicle: { id: vehicle.id }, boardStatus: 'WAITING' }
      });

      for (const st of waitingStudents) {
        st.boardStatus = 'ABSENT';
        await this.studentRepository.save(st);

        const absentNoti = this.notificationRepository.create({
          vehicle: vehicle,
          message: `${vehicle.busNumber}호차 ${st.adminDisplayName || st.name} 원생 미탑승(자동 결석 처리)`
        });
        await this.notificationRepository.save(absentNoti);
      }

      // Update the most recent OperationLog for today
      const dateString = new Date().toISOString().split('T')[0];
      const latestLog = await this.operationLogRepository.findOne({
        where: { vehicle: { id: vehicle.id }, dateString },
        order: { id: 'DESC' }
      });
      if (latestLog && !latestLog.endTime) {
        latestLog.endTime = new Date();
        await this.operationLogRepository.save(latestLog);
      }
      
      await this.appendBoardingLog(vehicle.id, null, '운행 종료', 'SYSTEM');
    }
    return { success: true };
  }

  async studentBoardByQR(studentEmail: string, teacherEmail: string) {
    const studentUser = await this.userRepository.findOne({ where: { email: studentEmail } });
    if (!studentUser) throw new BadRequestException('Student user not found');

    const teacherUser = await this.userRepository.findOne({ where: { email: teacherEmail } });
    if (!teacherUser) throw new BadRequestException('Teacher user not found');

    const vehicle = await this.findAssignedVehicle(teacherUser.id, { academy: true });
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { studentUser: { id: studentUser.id } },
      relations: { parentUser: true, assignedVehicle: true }
    });
    if (!student) throw new BadRequestException('Student record not found');

    student.boardStatus = 'BOARDED';
    student.actualBoardTime = new Date();
    await this.studentRepository.save(student);

    // 1. Create a Notification for the academy admin
    this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `${student.adminDisplayName || student.name} 학생이 셔틀버스에 탑승했습니다. ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 탑승 완료 (QR)`
    }));

    // 3. Append to OperationLog
    await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'QR');
    this.locationGateway?.broadcastRouteUpdated(vehicle.academy?.id);

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async getStaffList() {
    const admin = await this.userRepository.findOne({ where: { role: UserRole.ACADEMY_ADMIN } });
    const vehicles = await this.vehicleRepository.find({ relations: { driverUser: true, teacherUser: true } });
    return {
      admin: admin ? { id: admin.id, name: admin.name, role: admin.role } : null,
      vehicles: vehicles.map(v => ({
        id: v.id,
        busNumber: v.busNumber,
        driver: v.driverUser ? { id: v.driverUser.id, name: v.driverUser.name } : null,
        teacher: v.teacherUser ? { id: v.teacherUser.id, name: v.teacherUser.name } : null
      }))
    };
  }

  async sendMessage(email: string, messageText: string, studentIds: number[], parentIds: number[], staffUserIds: number[] = []) {
    if (!messageText || messageText.trim() === '') {
      throw new BadRequestException('메시지 내용을 입력해주세요.');
    }
    if ((!studentIds || studentIds.length === 0) && (!parentIds || parentIds.length === 0) && (!staffUserIds || staffUserIds.length === 0)) {
      throw new BadRequestException('수신 대상을 선택해주세요.');
    }

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    let sentCount = 0;
    
    // Process students
    for (const sid of studentIds) {
      const student = await this.studentRepository.findOne({
        where: { id: sid }
      });
      if (student) {
        const studentMessage = this.messageRepository.create({
          student,
          targetRoles: ['STUDENT'],
          message: messageText
        });
        await this.messageRepository.save(studentMessage);
        sentCount++;
      }
    }

    // Process parents
    for (const pid of parentIds) {
      const student = await this.studentRepository.findOne({
        where: { id: pid },
        relations: { parentUser: true }
      });
      if (student && student.parentUser) {
        const parentMessage = this.messageRepository.create({
          student,
          targetRoles: ['PARENT'],
          message: messageText
        });
        await this.messageRepository.save(parentMessage);
        sentCount++;
      }
    }

    // Process staff
    for (const sid of staffUserIds) {
      const staffUser = await this.userRepository.findOne({ where: { id: sid } });
      if (staffUser) {
        const staffMessage = this.messageRepository.create({
          receiverUser: staffUser,
          targetRoles: [staffUser.role],
          message: messageText
        });
        await this.messageRepository.save(staffMessage);
        sentCount++;
      }
    }

    if (vehicle) {
      await this.appendBoardingLog(vehicle.id, null, `안내 메세지 발송: ${messageText}`, 'SYSTEM');
    }

    return { success: true, sentCount };
  }

  private async appendBoardingLog(vehicleId: number, studentId: number | null, studentName: string, method: string) {
    const dateString = new Date().toISOString().split('T')[0];
    let latestLog = await this.operationLogRepository.findOne({
      where: { vehicle: { id: vehicleId }, dateString },
      order: { id: 'DESC' }
    });
    
    if (!latestLog) {
      latestLog = this.operationLogRepository.create({
        vehicle: { id: vehicleId } as any,
        dateString,
        boardingRecords: []
      });
    }

    let records = [];
    try {
      records = typeof latestLog.boardingRecords === 'string' ? JSON.parse(latestLog.boardingRecords) : (latestLog.boardingRecords || []);
    } catch(e) {}
    
    records.push({
      studentId,
      studentName,
      boardTime: new Date().toISOString(),
      method
    });
    latestLog.boardingRecords = records;
    await this.operationLogRepository.save(latestLog);
  }

  async getOperationLogs(email: string, month: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) return [];
    
    const logs = await this.operationLogRepository.find({
      where: { vehicle: { id: vehicle.id } },
      order: { id: 'ASC' }
    });
    
    return logs.filter(log => !month || log.dateString.startsWith(month)).map(log => {
      let records = [];
      try {
        records = typeof log.boardingRecords === 'string' ? JSON.parse(log.boardingRecords) : (log.boardingRecords || []);
      } catch(e) {}
      return {
        id: log.id,
        dateString: log.dateString,
        startTime: log.startTime,
        endTime: log.endTime,
        boardingRecords: records
      };
    });
  }

  async replyMessage(email: string, messageId: number, action: 'WAIT' | 'GO_AHEAD') {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const originalMsg = await this.messageRepository.findOne({ 
      where: { id: messageId },
      relations: {
        student: {
          parentUser: true,
          studentUser: true,
          assignedVehicle: {
            driverUser: true
          }
        }
      }
    });

    if (!originalMsg) throw new BadRequestException('Message not found');

    // Create response text
    let replyToStudent = action === 'WAIT' ? '시간이 되서 기다릴게 빨리와줘' : '시간이 없어 먼저 가야할 거 같아';
    let ttsToDriver = action === 'WAIT' 
      ? `${originalMsg.student.name} 학생의 지연에 대해 기다리겠다는 메세지를 보냈습니다.`
      : `${originalMsg.student.name} 학생의 지각에 대해 기다릴 수 없다는 메세지를 전송하였습니다.`;

    // 1. Send reply message to Parent
    const parentMsg = this.messageRepository.create({
      student: originalMsg.student,
      targetRoles: ['PARENT'],
      message: `[지도교사 응답] ${replyToStudent}`
    });
    await this.messageRepository.save(parentMsg);

    // Broadcast to parent if they are online (simplified by emitting to vehicle room or we just emit busArriving)
    if (originalMsg.student.assignedVehicle) {
      const room = `vehicle_${originalMsg.student.assignedVehicle.id}`;
      // Emit to parent
      if (originalMsg.student.parentUser) {
        this.locationGateway.server.to(room).emit('teacherReply', { 
          email: originalMsg.student.parentUser.email, 
          message: `[지도교사 응답] ${replyToStudent}` 
        });
      }
      // Emit TTS to Driver
      if (originalMsg.student.assignedVehicle.driverUser) {
        this.locationGateway.server.to(room).emit('driverTTS', { 
          email: originalMsg.student.assignedVehicle.driverUser.email, 
          message: ttsToDriver 
        });
      }
      await this.appendBoardingLog(originalMsg.student.assignedVehicle.id, null, '학부모 메세지 응답 (대기/출발)', 'SYSTEM');
    }

    originalMsg.isRead = true; // Mark the original message as read since they replied
    await this.messageRepository.save(originalMsg);

    return { success: true };
  }

  async readMessage(email: string, messageId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const msg = await this.messageRepository.findOne({ where: { id: messageId, receiverUser: { id: user.id } }, relations: { student: { assignedVehicle: true } } });
    if (msg) {
      msg.isRead = true;
      await this.messageRepository.save(msg);
      if (msg.student && msg.student.assignedVehicle) {
        await this.appendBoardingLog(msg.student.assignedVehicle.id, msg.student.id, `학부모 메세지 수신: ${msg.message}`, 'SYSTEM');
      }
    }
    return { success: true };
  }

  async triggerEmergency(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.vehicleRepository.findOne({ 
      where: [{ teacherUser: { id: user.id } }, { driverUser: { id: user.id } }],
      relations: { academy: { owner: true } }
    });
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    // Get unboarded students for this vehicle
    const todayStudents = await this.getTodayStudentsForVehicle(vehicle.id);
    const unboardedStudents = todayStudents.filter(s => s.boardStatus === 'WAITING' && s.latitude && s.longitude);

    // Find all OTHER vehicles
    const allVehicles = await this.vehicleRepository.find({ relations: { driverUser: true, teacherUser: true } });
    const otherVehicles = allVehicles.filter(v => v.id !== vehicle.id);

    const today = new Date().toISOString().split('T')[0];

    // Auto-reassign and notify
    for (const student of unboardedStudents) {
      let closestVehicle = null;
      if (otherVehicles.length > 0) {
        closestVehicle = otherVehicles[0];
      }

      if (closestVehicle) {
        // 1. Create ScheduleOverride
        const override = this.scheduleOverrideRepository.create({
          student,
          startDate: today,
          endDate: today,
          overrideType: OverrideType.CHANGE_LOCATION,
          reason: '차량 사고 긴급 대체 배차',
          newVehicleId: closestVehicle.id,
          latitude: student.latitude,
          longitude: student.longitude,
          newAddress: student.address
        } as any);
        await this.scheduleOverrideRepository.save(override);

        // 2. Notify Parent
        const parentUser = await this.userRepository.createQueryBuilder('user')
           .leftJoin('user.parentStudents', 'student')
           .where('student.id = :studentId', { studentId: student.id })
           .getOne();

        if (parentUser) {
           const msg = this.messageRepository.create({
             student,
             targetRoles: ['PARENT'],
             message: `[긴급 안내] ${vehicle.busNumber} 사고로 인해 운행이 불가능해졌습니다. 아직 탑승하지 못한 원아들은 다른 호차 차량이 픽업해 유치원까지 안전하게 이동하겠습니다.`,
             receiverUser: parentUser
           });
           await this.messageRepository.save(msg);
        }
      }
    }

    // 3. Notify Admin (Director)
    if (vehicle.academy && vehicle.academy.owner) {
        const msg = this.messageRepository.create({
          targetRoles: ['ACADEMY_ADMIN'],
          message: `🚨 [긴급] ${vehicle.busNumber} 운행 불가 사태 발생. 남은 학생 ${unboardedStudents.length}명 타 차량 대체 배차 처리 완료.`,
          receiverUser: vehicle.academy.owner
        });
        await this.messageRepository.save(msg);
    }

    // 4. Notify other drivers/teachers
    for (const v of otherVehicles) {
       const staffUsers = [];
       if (v.driverUser) staffUsers.push(v.driverUser);
       if (v.teacherUser) staffUsers.push(v.teacherUser);
       for (const staff of staffUsers) {
          const msg = this.messageRepository.create({
            targetRoles: [staff.role],
            message: `🚨 [비상] ${vehicle.busNumber} 고장/사고로 인해 인근 학생이 기사님 노선으로 긴급 추가되었습니다. 명단과 지도를 새로고침해 주세요.`,
            receiverUser: staff
          });
          await this.messageRepository.save(msg);
       }
    }

    // 5. Save Operation Log
    await this.appendBoardingLog(vehicle.id, null, '🚨 긴급 모드 발동 (타 호차 인계)', 'SYSTEM');
    this.locationGateway?.broadcastRouteUpdated(vehicle.academy?.id);

    return { success: true, message: '긴급 모드가 성공적으로 발동되었습니다.' };
  }
}
