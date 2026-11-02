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
import { getKstDateString, getKstTimeString } from '../utils/time.util';

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
    const today = getKstDateString();
    const holiday = await this.academyHolidayRepository.findOne({
      where: {
        startDate: LessThanOrEqual(today),
        endDate: MoreThanOrEqual(today),
      }
    });
    return !!holiday;
  }

  private async getActiveOverridesForToday(): Promise<ScheduleOverride[]> {
    const today = getKstDateString();
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
      where: { assignedVehicle: { id: vehicleId } },
      relations: { parentUser: true, academy: true }
    });
    const overrides = await this.getActiveOverridesForToday();
    
    // Students originally in this vehicle, but who are NOT absent and have NOT moved to another vehicle today
    const currentStudents = defaultStudents.filter(s => {
      const override = overrides.find(o => o.student?.id === s.id);
      if (!override) return true;
      if (override.overrideType === OverrideType.ABSENCE) return false;
      if (override.overrideType === OverrideType.CHANGE_LOCATION && override.newVehicleId && override.newVehicleId !== vehicleId) return false;
      return true;
    });

    // Students originally in ANOTHER vehicle, but who MOVED INTO this vehicle today
    const movedInStudentIds = overrides
      .filter(o => o.overrideType === OverrideType.CHANGE_LOCATION && o.newVehicleId === vehicleId)
      .map(o => o.student?.id)
      .filter(Boolean);

    const movedInStudents = movedInStudentIds.length > 0 
      ? await this.studentRepository.createQueryBuilder('s')
          .leftJoinAndSelect('s.parentUser', 'parentUser')
          .leftJoinAndSelect('s.academy', 'academy')
          .where('s.id IN (:...ids)', { ids: movedInStudentIds })
          .getMany() 
      : [];

    const movedInFiltered = movedInStudents.filter((s: Student) => !currentStudents.find((cs: Student) => cs.id === s.id));
    movedInFiltered.forEach((s: Student) => (s as any).isOverride = true);

    return [...currentStudents, ...movedInFiltered];
  }

  async getMyVehicle(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    
    let vehicle: Vehicle | null = await this.findAssignedVehicle(user.id);
    if (!vehicle) {
      vehicle = await this.vehicleRepository.findOne({ where: { driverUser: { id: user.id } } });
    }
    
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');
    
    let polygon = vehicle.polygonCoordinates;
    if (typeof polygon === 'string') {
      try {
        polygon = JSON.parse(polygon);
      } catch(e) {
        polygon = [];
      }
    }

    return {
      id: vehicle.id,
      busNumber: vehicle.busNumber,
      plateNumber: vehicle.plateNumber,
      driverName: vehicle.driverName,
      driverPhone: vehicle.driverPhone,
      teacherName: vehicle.teacherName,
      teacherPhone: vehicle.teacherPhone,
      colorHex: vehicle.colorHex,
      polygonCoordinates: polygon
    };
  }

  public async findAssignedVehicle(userId: number, relations: any = { academy: true }): Promise<Vehicle | null> {
    let v = await this.vehicleRepository.findOne({
      where: [{ teacherUser: { id: userId } }, { driverUser: { id: userId } }],
      relations,
      order: { id: 'DESC' },
    });
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
    if (!vehicle) return [];

    const students = await this.getTodayStudentsForVehicle(vehicle.id);
    
    return students.map(s => {
      let rawObj: any = s.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
      }
      if (!rawObj || typeof rawObj !== 'object') rawObj = {};

      const parentPhone = s.parentUser?.phone || rawObj['부모연락처'] || rawObj['보호자연락처'] || rawObj['연락처'] || '';
      const parentName = s.parentUser?.name || rawObj['보호자 성함'] || rawObj['보호자성함'] || '';
      const className = rawObj['반명'] || rawObj['반'] || (s as any).assignedClass || '';
      const boardingLocation = s.boardingLocation || rawObj['등원탑승지'] || rawObj['등원지'] || rawObj['승차지'] || s.address || '';

      const boardStatus = s.boardStatus || 'WAITING';

      return {
        id: s.id,
        name: s.adminDisplayName || s.name,
        realName: s.name,
        address: s.address,
        boardingLocation,
        latitude: s.latitude,
        longitude: s.longitude,
        boarded: boardStatus === 'BOARDED',
        absent: boardStatus === 'ABSENT',
        droppedOff: boardStatus === 'DROPPED_OFF',
        handoverFailed: boardStatus === 'HANDOVER_FAILED',
        boardStatus,
        expectedTime: rawObj['예상탑승시간'] || '15:30',
        allergies: s.allergies || rawObj['알레르기'] || '',
        teacherMemo: s.teacherMemo,
        runNumber: s.runNumber || 1,
        isOverride: (s as any).isOverride || false,
        parentPhone,
        parentName,
        className,
      };
    });
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

    // Convert students to route stops
    const uniqueStopKeys = new Set<string>();
    let stops: {
      id: number;
      name: string;
      address: string;
      stopMemo: string;
      latitude: number;
      longitude: number;
      expectedTime: string;
    }[] = [];

    for (const s of students) {
      if (s.latitude && s.longitude) {
        let rawObj: any = s.raw;
        if (typeof rawObj === 'string') {
          try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
        }
        const stopName = s.boardingLocation || s.address || s.name;
        const key = `${s.latitude.toFixed(5)}_${s.longitude.toFixed(5)}`;
        if (!uniqueStopKeys.has(key)) {
          uniqueStopKeys.add(key);
          stops.push({
            id: s.id,
            name: stopName,
            address: s.address,
            stopMemo: s.teacherMemo || '',
            latitude: parseFloat(s.latitude as any),
            longitude: parseFloat(s.longitude as any),
            expectedTime: rawObj?.['예상탑승시간'] || '15:30'
          });
        }
      }
    }

    // TSP Optimization (Nearest Neighbor)
    const sortedStops = [];
    if (stops.length > 0) {
      let currentLat = vehicle.academy?.latitude ? parseFloat(vehicle.academy.latitude as any) : stops[0].latitude;
      let currentLng = vehicle.academy?.longitude ? parseFloat(vehicle.academy.longitude as any) : stops[0].longitude;

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
      routePoints.push({ latitude: parseFloat(vehicle.academy.latitude as any), longitude: parseFloat(vehicle.academy.longitude as any) });
    }
    stops.forEach(s => routePoints.push({ latitude: s.latitude, longitude: s.longitude }));
    if (vehicle.academy && vehicle.academy.latitude && vehicle.academy.longitude) {
      routePoints.push({ latitude: parseFloat(vehicle.academy.latitude as any), longitude: parseFloat(vehicle.academy.longitude as any) });
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
      const latestMessage = await this.messageRepository.findOne({
        where: { student: { id: studentId } },
        order: { createdAt: 'DESC' }
      });

      const kstTime = getKstTimeString();
      let adminLogMessage = `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 지도교사 메모 업데이트: ${memo}`;
      if (latestMessage) {
        adminLogMessage = `[${student.adminDisplayName || student.name} 학부모님 ${kstTime} 메세지] ${latestMessage.message}\n` +
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

  // 1. 탑승 처리 (수동)
  async boardStudent(email: string, studentId: number, reason?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId, assignedVehicle: { id: vehicle.id } },
      relations: { parentUser: true }
    });
    if (!student) throw new BadRequestException('해당 차량에 배정된 원아를 찾을 수 없습니다.');

    student.boardStatus = 'BOARDED';
    student.actualBoardTime = new Date();
    await this.studentRepository.save(student);

    const kstTime = getKstTimeString();
    let msg = `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 ${kstTime} 탑승 완료`;
    if (reason) msg += ` (사유: ${reason})`;

    await this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: msg
    }));

    await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'MANUAL_BOARD');

    this.locationGateway.broadcastStudentStatusUpdated(vehicle.id, {
      studentId: student.id,
      boardStatus: 'BOARDED',
      studentName: student.name,
      time: kstTime,
    });

    return { success: true, studentName: student.adminDisplayName || student.name, boardStatus: 'BOARDED' };
  }

  // 2. 하차 및 보호자 인계 완료
  async dropoffStudent(email: string, studentId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId, assignedVehicle: { id: vehicle.id } },
      relations: { parentUser: true }
    });
    if (!student) throw new BadRequestException('해당 차량에 배정된 원아를 찾을 수 없습니다.');

    student.boardStatus = 'DROPPED_OFF';
    student.actualDropTime = new Date();
    await this.studentRepository.save(student);

    const kstTime = getKstTimeString();

    // 1. 운행 일지 기록
    await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'DROPOFF');

    // 2. 원장 관리자 알림
    await this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원아 하차 및 보호자 인계 완료 (${kstTime})`
    }));

    // 3. 학부모 메시지 알림
    const parentMsg = this.messageRepository.create({
      student,
      targetRoles: ['PARENT'],
      message: `[하차 인계 완료] ${student.adminDisplayName || student.name} 원아가 안전하게 하차하여 보호자님께 인계되었습니다. (${kstTime})`
    });
    await this.messageRepository.save(parentMsg);

    // 4. 차량 방 소켓 알림
    this.locationGateway.broadcastStudentStatusUpdated(vehicle.id, {
      studentId: student.id,
      boardStatus: 'DROPPED_OFF',
      studentName: student.name,
      time: kstTime,
    });

    return { success: true, studentName: student.adminDisplayName || student.name, boardStatus: 'DROPPED_OFF' };
  }

  // 3. 보호자 미인계 (인계 실패 / 다시 태움)
  async handoverFailed(email: string, studentId: number, reason?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId, assignedVehicle: { id: vehicle.id } },
      relations: { parentUser: true }
    });
    if (!student) throw new BadRequestException('해당 차량에 배정된 원아를 찾을 수 없습니다.');

    student.boardStatus = 'HANDOVER_FAILED';
    await this.studentRepository.save(student);

    const kstTime = getKstTimeString();
    const reasonText = reason ? ` (사유: ${reason})` : ' (보호자 미도착)';

    // 1. 운행 일지 기록
    await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'HANDOVER_FAILED');

    // 2. 원장 관리자 긴급 알림
    await this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `🚨 [보호자 미인계] ${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원아 보호자 미도착으로 차량 재탑승 조치${reasonText} (${kstTime})`
    }));

    // 3. 학부모 긴급 메시지 알림
    const parentMsg = this.messageRepository.create({
      student,
      targetRoles: ['PARENT'],
      message: `🚨 [긴급 안내] ${student.adminDisplayName || student.name} 원아의 하차 정류장에 보호자님이 확인되지 않아 차량에 재탑승 중입니다. 유치원 또는 교사에게 즉시 연락 바랍니다.`
    });
    await this.messageRepository.save(parentMsg);

    // 4. 차량 방 소켓 알림
    this.locationGateway.broadcastStudentStatusUpdated(vehicle.id, {
      studentId: student.id,
      boardStatus: 'HANDOVER_FAILED',
      studentName: student.name,
      time: kstTime,
    });

    return { success: true, studentName: student.adminDisplayName || student.name, boardStatus: 'HANDOVER_FAILED' };
  }

  // 4. 결석 / 건너뛰기
  async skipStudent(email: string, studentId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    const student = await this.studentRepository.findOne({ 
      where: { id: studentId, assignedVehicle: vehicle ? { id: vehicle.id } : undefined } 
    });
    if (!student) throw new BadRequestException('Student not found');

    student.boardStatus = 'ABSENT';
    await this.studentRepository.save(student);

    const kstTime = getKstTimeString();
    if (vehicle) {
      const adminNoti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 ${kstTime} 결석/건너뛰기`
      });
      await this.notificationRepository.save(adminNoti);
      await this.appendBoardingLog(vehicle.id, studentId, `${student.adminDisplayName || student.name} 원생 결석 처리`, 'SYSTEM');

      this.locationGateway.broadcastStudentStatusUpdated(vehicle.id, {
        studentId: student.id,
        boardStatus: 'ABSENT',
        studentName: student.name,
        time: kstTime,
      });
    }

    return { success: true, studentName: student.adminDisplayName || student.name, boardStatus: 'ABSENT' };
  }

  // 5. 정류장 인원 확인 완료 후 기사에게 출발 신호
  async readyToDepart(email: string, stopName?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    // 차량 방에만 출발 신호 브로드캐스트
    this.locationGateway.broadcastDepartSignal(vehicle.id, stopName);

    await this.appendBoardingLog(vehicle.id, null, `정류장 인원 확인 완료 기사 출발 신호 전송 (${stopName || '정류장'})`, 'DEPART_SIGNAL');

    return { success: true, message: '기사님께 출발 신호를 전송했습니다.' };
  }

  // 6. 동승 시작 (지도교사는 위치 전송 없이 동승보호자 기록만 남김)
  async startEscort(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const kstTime = getKstTimeString();
    const teacherName = user.name || user.email;

    // 운행 일지에 동승보호자 탑승 기록
    await this.appendBoardingLog(vehicle.id, null, `동승 시작 (동승보호자: ${teacherName})`, 'ESCORT_START');

    // 관리자 알림
    await this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `${vehicle.busNumber}호차 동승 교사(${teacherName}) 탑승 및 동승 시작 (${kstTime})`
    }));

    return {
      success: true,
      message: '동승이 시작되었습니다.',
      teacherName,
      vehicleId: vehicle.id
    };
  }

  // 7. 동승 종료 (잔류 원아 검사 + 맨 뒷좌석 확인 체크 필수)
  async endEscort(email: string, checkedBackSeats: boolean, notes?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    if (!checkedBackSeats) {
      throw new BadRequestException('차량 맨 뒷좌석 잔류 아동 확인 체크가 완료되어야 동승을 종료할 수 있습니다.');
    }

    // 차량에 아직 탑승 중이거나 인계 실패 상태인 잔류 아동 확인
    const todayStudents = await this.getTodayStudentsForVehicle(vehicle.id);
    const unhanded = todayStudents.filter(s => s.boardStatus === 'BOARDED' || s.boardStatus === 'HANDOVER_FAILED');

    if (unhanded.length > 0) {
      const names = unhanded.map(s => s.adminDisplayName || s.name).join(', ');
      throw new BadRequestException(`아직 하차하지 않은 원아가 ${unhanded.length}명 남아있습니다 (${names}). 하차 또는 보호자 인계 조치를 먼저 완료해주세요.`);
    }

    const kstTime = getKstTimeString();
    const teacherName = user.name || user.email;

    // 운행 일지 기록
    await this.appendBoardingLog(
      vehicle.id, 
      null, 
      `동승 종료 (차량 맨 뒷좌석 잔류 아동 확인 완료, 확인교사: ${teacherName}${notes ? `, 메모: ${notes}` : ''})`, 
      'ESCORT_END'
    );

    // 관리자 알림
    await this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `${vehicle.busNumber}호차 동승 교사(${teacherName}) 동승 종료 및 차량 내부 잔류 아동 확인 완료 (${kstTime})`
    }));

    return { success: true, message: '동승이 정상적으로 종료되었습니다.' };
  }

  // Legacy operation hooks for compatibility
  async startOperation(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (vehicle) {
      const dateString = getKstDateString();
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
      }

      const dateString = getKstDateString();
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

    const vehicle = await this.findAssignedVehicle(teacherUser.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { studentUser: { id: studentUser.id } },
      relations: { parentUser: true, assignedVehicle: true }
    });
    if (!student) throw new BadRequestException('Student record not found');

    student.boardStatus = 'BOARDED';
    student.actualBoardTime = new Date();
    await this.studentRepository.save(student);

    const kstTime = getKstTimeString();

    this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `${student.adminDisplayName || student.name} 학생이 셔틀버스에 탑승했습니다. ${kstTime} 탑승 완료 (QR)`
    }));

    await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'QR');

    this.locationGateway.broadcastStudentStatusUpdated(vehicle.id, {
      studentId: student.id,
      boardStatus: 'BOARDED',
      studentName: student.name,
      time: kstTime,
    });

    return { success: true, studentName: student.adminDisplayName || student.name, boardStatus: 'BOARDED' };
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
    
    for (const sid of studentIds) {
      const student = await this.studentRepository.findOne({ where: { id: sid } });
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
    const dateString = getKstDateString();
    const timeString = getKstTimeString();

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
      time: timeString,
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

    let replyToStudent = action === 'WAIT' ? '시간이 되서 기다릴게 빨리와줘' : '시간이 없어 먼저 가야할 거 같아';
    let ttsToDriver = action === 'WAIT' 
      ? `${originalMsg.student.name} 학생의 지연에 대해 기다리겠다는 메세지를 보냈습니다.`
      : `${originalMsg.student.name} 학생의 지각에 대해 기다릴 수 없다는 메세지를 전송하였습니다.`;

    const parentMsg = this.messageRepository.create({
      student: originalMsg.student,
      targetRoles: ['PARENT'],
      message: `[지도교사 응답] ${replyToStudent}`
    });
    await this.messageRepository.save(parentMsg);

    if (originalMsg.student.assignedVehicle) {
      const room = `vehicle_${originalMsg.student.assignedVehicle.id}`;
      if (originalMsg.student.parentUser) {
        this.locationGateway.server?.to(room).emit('teacherReply', { 
          email: originalMsg.student.parentUser.email, 
          message: `[지도교사 응답] ${replyToStudent}` 
        });
      }
      if (originalMsg.student.assignedVehicle.driverUser) {
        this.locationGateway.server?.to(room).emit('driverTTS', { 
          email: originalMsg.student.assignedVehicle.driverUser.email, 
          message: ttsToDriver 
        });
      }
      await this.appendBoardingLog(originalMsg.student.assignedVehicle.id, null, '학부모 메세지 응답 (대기/출발)', 'SYSTEM');
    }

    originalMsg.isRead = true;
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

  async triggerEmergency(email: string, studentId?: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.vehicleRepository.findOne({ 
      where: [{ teacherUser: { id: user.id } }, { driverUser: { id: user.id } }],
      relations: { academy: { owner: true } }
    });
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    // 특정 원아 대상 긴급 상황 알림인 경우
    if (studentId) {
      const student = await this.studentRepository.findOne({
        where: { id: studentId, assignedVehicle: { id: vehicle.id } },
        relations: { parentUser: true }
      });
      if (student) {
        const kstTime = getKstTimeString();
        if (student.parentUser) {
          const msg = this.messageRepository.create({
            student,
            targetRoles: ['PARENT'],
            message: `🚨 [긴급 알림] ${student.adminDisplayName || student.name} 원아에게 특이사항이 발생하여 지도교사가 긴급 확인 중입니다. 확인 후 즉시 연락드리겠습니다.`,
            receiverUser: student.parentUser
          });
          await this.messageRepository.save(msg);
        }

        if (vehicle.academy?.owner) {
          const adminMsg = this.messageRepository.create({
            targetRoles: ['ACADEMY_ADMIN'],
            message: `🚨 [원아 긴급 알림] ${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원아 긴급 알림 발생 (${kstTime})`,
            receiverUser: vehicle.academy.owner
          });
          await this.messageRepository.save(adminMsg);
        }

        await this.appendBoardingLog(vehicle.id, student.id, `🚨 원아 개별 긴급 알림 발령 (${student.name})`, 'EMERGENCY_STUDENT');
        return { success: true, message: `${student.name} 원아 긴급 알림이 전송되었습니다.` };
      }
    }

    // 차량 전체 긴급 모드 발동
    const todayStudents = await this.getTodayStudentsForVehicle(vehicle.id);
    const unboardedStudents = todayStudents.filter(s => s.boardStatus === 'WAITING' && s.latitude && s.longitude);

    const allVehicles = await this.vehicleRepository.find({ relations: { driverUser: true, teacherUser: true } });
    const otherVehicles = allVehicles.filter(v => v.id !== vehicle.id);

    const today = getKstDateString();

    for (const student of unboardedStudents) {
      let closestVehicle = otherVehicles.length > 0 ? otherVehicles[0] : null;

      if (closestVehicle) {
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

    if (vehicle.academy && vehicle.academy.owner) {
        const msg = this.messageRepository.create({
          targetRoles: ['ACADEMY_ADMIN'],
          message: `🚨 [긴급] ${vehicle.busNumber} 운행 불가 사태 발생. 남은 학생 ${unboardedStudents.length}명 타 차량 대체 배차 처리 완료.`,
          receiverUser: vehicle.academy.owner
        });
        await this.messageRepository.save(msg);
    }

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

    await this.appendBoardingLog(vehicle.id, null, '🚨 긴급 모드 발동 (타 호차 인계)', 'SYSTEM');
    this.locationGateway.broadcastRouteUpdated(vehicle.id);

    return { success: true, message: '긴급 모드가 성공적으로 발동되었습니다.' };
  }
}
