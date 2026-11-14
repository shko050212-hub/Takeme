import { Injectable, BadRequestException, ConflictException, ForbiddenException, NotFoundException, Inject, forwardRef, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual, In, Between } from 'typeorm';
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
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatRoomMember } from '../entities/chat-room-member.entity';
import { LocationGateway } from './location.gateway';
import { getStudentClassName, hasAssignedClass, isSameClass, HOMEROOM_ROLE, kstDateString, isValidDateString } from '../utils/school.util';
import { isNotificationEnabled } from '../utils/notification.util';
import { Attendance, AttendanceStatus } from '../entities/attendance.entity';
import { AttendanceSubmission } from '../entities/attendance-submission.entity';
import { ChatService } from '../chat/chat.service';
import { formatTeacherName } from '../utils/teacher.util';

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
    @InjectRepository(Attendance) private attendanceRepository: Repository<Attendance>,
    @InjectRepository(AttendanceSubmission) private submissionRepository: Repository<AttendanceSubmission>,
    private readonly locationGateway: LocationGateway,
    @Optional() @InjectRepository(PickupPoint) private pickupPointRepository?: Repository<PickupPoint>,
    @Optional() @InjectRepository(ChatMessage) private chatMessageRepository?: Repository<ChatMessage>,
    @Optional() @InjectRepository(ChatRoomMember) private chatRoomMemberRepository?: Repository<ChatRoomMember>,
    @Inject(forwardRef(() => ChatService))
    @Optional()
    private readonly chatService?: ChatService
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
      where: { assignedVehicle: { id: vehicleId } },
      relations: { parentUser: true }
    });
    const overrides = await this.getActiveOverridesForToday();
    
    const absentTypes = [
      OverrideType.ABSENCE,
      OverrideType.INDIVIDUAL_DISMISSAL,
      OverrideType.PICKUP,
      OverrideType.NO_SHUTTLE,
    ];

    // Students originally in this vehicle
    const currentStudents = defaultStudents.map(s => {
      const override = overrides.find(o => o.student?.id === s.id);
      if (override) {
        if (absentTypes.includes(override.overrideType)) {
          s.boardStatus = 'ABSENT';
          (s as any).overrideType = override.overrideType;
          (s as any).overrideReason = override.reason;
        } else if (override.overrideType === OverrideType.CHANGE_LOCATION) {
          if (override.newVehicleId && override.newVehicleId !== vehicleId) {
            return null; // moved to another vehicle
          }
          if (override.newAddress) s.address = override.newAddress;
          if (override.targetTime && s.raw) {
            s.raw = { ...s.raw, '예상탑승시간': override.targetTime };
          }
          (s as any).isOverride = true;
          (s as any).overrideType = override.overrideType;
        }
      }
      return s;
    }).filter(Boolean) as Student[];

    // Students moved into this vehicle today or one-time boarding
    const movedInOverrides = overrides.filter(o => 
      (o.overrideType === OverrideType.CHANGE_LOCATION || o.overrideType === OverrideType.ONE_TIME_BOARDING) &&
      o.newVehicleId === vehicleId
    );
    const movedInStudentIds = movedInOverrides.map(o => o.student?.id).filter(Boolean);

    const movedInStudents = movedInStudentIds.length > 0 
      ? await this.studentRepository.createQueryBuilder('s')
          .leftJoinAndSelect('s.parentUser', 'parentUser')
          .where('s.id IN (:...ids)', { ids: movedInStudentIds })
          .getMany() 
      : [];

    const movedInFiltered = movedInStudents.filter((s: Student) => !currentStudents.find((cs: Student) => cs.id === s.id));
    movedInFiltered.forEach((s: Student) => {
      const override = movedInOverrides.find(o => o.student?.id === s.id);
      (s as any).isOverride = true;
      (s as any).isOneTimeBoarding = override?.overrideType === OverrideType.ONE_TIME_BOARDING;
      (s as any).overrideType = override?.overrideType;
      if (override?.newAddress) s.address = override.newAddress;
      if (override?.targetTime && s.raw) {
        s.raw = { ...s.raw, '예상탑승시간': override.targetTime };
      }
    });

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
   * 테넌트 격리(Tenant Isolation)를 보장하며, 타 학원 차량이나 임의 1호차 자동 할당을 차단합니다.
   */
  private async findAssignedVehicle(userId: number, relations: any = {}) {
    let v =
      (await this.vehicleRepository.findOne({ where: { teacherUser: { id: userId } }, relations })) ||
      (await this.vehicleRepository.findOne({ where: { driverUser: { id: userId } }, relations }));
    if (v) return v;

    const user = await this.userRepository.findOne({ where: { id: userId }, relations: { academy: true } });
    if (user?.academy) {
      // 해당 학원의 배정 차량 탐색 (타 학원 차량 침범 금지)
      v = await this.vehicleRepository.findOne({ where: { academy: { id: user.academy.id } }, relations });
      if (v) return v;
    }

    return null;
  }

  async getStudents(email: string) {
    if (await this.isTodayHoliday()) return [];

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    if ((user.role as string) === 'HOMEROOM_TEACHER' || user.role === UserRole.HOMEROOM_TEACHER) {
      if (!hasAssignedClass(user.assignedClass)) {
        return [];
      }
      const academyId = user.academyId;
      const qb = this.studentRepository.createQueryBuilder('s')
        .leftJoinAndSelect('s.parentUser', 'parentUser')
        .leftJoinAndSelect('s.assignedVehicle', 'vehicle');
      if (academyId) {
        qb.where('s.academyId = :academyId', { academyId });
      }
      const all = await qb.getMany();
      return all
        .filter(s => isSameClass(getStudentClassName(s), user.assignedClass))
        .map(s => {
          const rawPhone = s.raw ? (s.raw['학부모연락처'] || s.raw['연락처'] || s.raw['전화번호'] || s.raw['비상연락처'] || '') : '';
          const parentPhone = s.parentUser?.phone || rawPhone || '';
          return {
            id: s.id,
            name: s.adminDisplayName || s.name,
            address: s.address,
            latitude: s.latitude,
            longitude: s.longitude,
            boarded: s.boardStatus === 'BOARDED',
            absent: s.boardStatus === 'ABSENT',
            expectedTime: s.raw ? s.raw['예상탑승시간'] || '15:30' : '15:30',
            allergies: s.allergies || (s.raw ? s.raw['알레르기'] : '') || '',
            parentPhone,
            className: user.assignedClass,
          };
        });
    }

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) {
      // 담임교사(HOMEROOM_TEACHER)이거나 차량 미배정 교사인 경우:
      // 교사의 담당 학급(assignedClass) 원아들 또는 소속 유치원의 전체 원아 조회
      const assignedClass = (user.assignedClass || '').trim();
      let query = this.studentRepository.createQueryBuilder('student')
        .leftJoinAndSelect('student.assignedVehicle', 'assignedVehicle')
        .leftJoinAndSelect('student.assignedDepartureVehicle', 'assignedDepartureVehicle');
      
      if (user.academyId) {
        query = query.andWhere('student.academyId = :academyId', { academyId: user.academyId });
      }

      const allStudents = await query.getMany();

      // 담당 학급이 지정되어 있으면 해당 반 학생 우선 필터링, 없으면 전체 반 학생 반환
      const classStudents = assignedClass
        ? allStudents.filter(s => {
            const rawObj = typeof s.raw === 'string' ? JSON.parse(s.raw || '{}') : (s.raw || {});
            const sClass = (rawObj['반명'] || rawObj['반'] || '').toString().trim();
            return sClass === assignedClass || !sClass;
          })
        : allStudents;

      return (classStudents.length > 0 ? classStudents : allStudents).map(s => {
        const rawObj = typeof s.raw === 'string' ? JSON.parse(s.raw || '{}') : (s.raw || {});
        return {
          id: s.id,
          name: s.adminDisplayName || s.name,
          address: s.address,
          latitude: s.latitude,
          longitude: s.longitude,
          boarded: s.boardStatus === 'BOARDED',
          absent: s.boardStatus === 'ABSENT',
          expectedTime: rawObj['예상탑승시간'] || '15:30',
          allergies: s.allergies || rawObj['알레르기'] || '',
          teacherMemo: s.teacherMemo,
          runNumber: s.runNumber || 1,
          isOverride: false,
          className: rawObj['반명'] || rawObj['반'] || user.assignedClass || '우리반',
          parentPhone: rawObj['부모연락처'] || rawObj['보호자연락처'] || rawObj['연락처'] || '',
          assignedVehicleName: s.assignedVehicle ? (s.assignedVehicle.busNumber || (s.assignedVehicle as any).plateNumber || '차량') : '차량 미배정'
        };
      });
    }

    const students = await this.getTodayStudentsForVehicle(vehicle.id);
    
    // Return boardStatus from DB, filter out absent students
    return students
      .map(s => {
        const rawPhone = s.raw ? (s.raw['학부모연락처'] || s.raw['연락처'] || s.raw['전화번호'] || s.raw['비상연락처'] || '') : '';
        const parentPhone = s.parentUser?.phone || rawPhone || '';
        return {
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
          isOverride: (s as any).isOverride || false,
          isOneTimeBoarding: (s as any).isOneTimeBoarding || false,
          overrideType: (s as any).overrideType || null,
          overrideReason: (s as any).overrideReason || null,
          parentPhone,
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
    
    // Convert to route stops
    let stops = students
      .filter(s => s.boardStatus === 'WAITING' && s.latitude && s.longitude)
      .map(s => ({
        id: s.id,
        name: s.adminDisplayName || s.name,
        address: s.address,
        latitude: parseFloat(s.latitude as any),
        longitude: parseFloat(s.longitude as any),
        expectedTime: s.raw ? s.raw['예상탑승시간'] || '15:30' : '15:30',
        isOneTimeBoarding: (s as any).isOneTimeBoarding || false,
        isOverride: (s as any).isOverride || false,
        overrideType: (s as any).overrideType || null,
      }));

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

    // In a real app, you would use a TSP algorithm or routing engine to get polyline points
    // For now, we'll just connect the dots (academy -> stops -> academy)
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

  // Vehicle route path storage (in-memory per vehicle)
  public static vehicleRoutePaths = new Map<number, { path: { lat: number; lng: number }[]; progressIndex: number; updatedAt: Date }>();

  static getRoutePathForVehicle(vehicleId: number) {
    const data = TeacherService.vehicleRoutePaths.get(vehicleId);
    return data ? { path: data.path, progressIndex: data.progressIndex } : { path: [], progressIndex: 0 };
  }

  async saveRoutePath(email: string, vehicleId?: number, path?: { lat: number; lng: number }[], progressIndex?: number) {
    const user = await this.userRepository.findOne({ where: { email }, relations: { academy: true } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    let vehicle: Vehicle | null = null;
    if (vehicleId) {
      vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId }, relations: { academy: true } });
    } else {
      vehicle = await this.findAssignedVehicle(user.id, { academy: true });
    }
    if (!vehicle) throw new BadRequestException('배정된 차량을 찾을 수 없습니다.');

    if (user.academy?.id && vehicle.academy?.id && user.academy.id !== vehicle.academy.id) {
      throw new ForbiddenException('소속 기관의 차량 경로만 등록할 수 있습니다.');
    }

    const rawPath = Array.isArray(path) ? path : [];
    const validPath = rawPath
      .filter(p => p && typeof p.lat === 'number' && typeof p.lng === 'number')
      .map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));

    const pIdx = typeof progressIndex === 'number' && progressIndex >= 0 ? progressIndex : 0;

    TeacherService.vehicleRoutePaths.set(vehicle.id, {
      path: validPath,
      progressIndex: pIdx,
      updatedAt: new Date(),
    });

    if (this.locationGateway?.server) {
      this.locationGateway.server.to(`vehicle_${vehicle.id}`).emit('routePathUpdated', {
        vehicleId: vehicle.id,
        path: validPath,
        progressIndex: pIdx,
      });
    }

    return { success: true, vehicleId: vehicle.id, count: validPath.length, progressIndex: pIdx };
  }

  async getTeacherRoutePath(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) return { path: [], progressIndex: 0 };

    return TeacherService.getRoutePathForVehicle(vehicle.id);
  }

  async getInbox(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const resultList: any[] = [];
    const seenTexts = new Set<string>();

    // 1. ParentMessage 조회 (공지 및 직접 지정된 메시지)
    const messages = await this.messageRepository.find({
      relations: { student: true, receiverUser: true },
      order: { createdAt: 'DESC' }
    });

    for (const m of messages) {
      const isTarget =
        (m.receiverUser && m.receiverUser.id === user.id) ||
        (m.targetRoles &&
          Array.isArray(m.targetRoles) &&
          (m.targetRoles.includes('TEACHER') ||
            m.targetRoles.includes('HOMEROOM_TEACHER') ||
            m.targetRoles.includes('SHUTTLE_TEACHER') ||
            m.targetRoles.includes('ALL')));

      if (isTarget) {
        const dedupeKey = `${m.message}_${new Date(m.createdAt).getMinutes()}`;
        seenTexts.add(dedupeKey);
        resultList.push({
          id: m.id,
          message: m.message,
          createdAt: m.createdAt,
          isRead: m.isRead,
          isPersonal:
            (m.receiverUser && m.receiverUser.id === user.id) ||
            m.message.includes('1:1') ||
            m.message.includes('개인'),
          type: (m.receiverUser && m.receiverUser.id === user.id) ? 'PERSONAL' : 'NOTICE',
          student: m.student ? { id: m.student.id, name: m.student.adminDisplayName || m.student.name } : null,
          receiverUser: m.receiverUser ? { id: m.receiverUser.id, name: m.receiverUser.name } : { id: user.id, name: user.name }
        });
      }
    }

    // 2. ChatMessage 조회 (원장님과의 1:1 대화방 및 단체 채팅방에서 원장님이 보낸 메시지)
    if (this.chatRoomMemberRepository && this.chatMessageRepository) {
      try {
        const myMemberships = await this.chatRoomMemberRepository.find({
          where: { user: { id: user.id } },
          relations: { room: true },
        });

        const roomIds = myMemberships.map(m => m.room?.id).filter(Boolean);

        if (roomIds.length > 0) {
          const chatMsgs = await this.chatMessageRepository.find({
            where: { room: { id: In(roomIds) } },
            relations: { sender: true, room: true },
            order: { createdAt: 'DESC' },
            take: 50,
          });

          for (const cm of chatMsgs) {
            // 본인이 보낸 것은 제외하고 상대방(원장님 등)이 보낸 것만 수신함에 추가
            if (cm.sender && cm.sender.id !== user.id) {
              const isDirect = cm.room?.type === 'DIRECT';
              const prefix = isDirect ? '[원장님 1:1 개인 메세지]' : `[${cm.sender.name || '공지'}]`;
              const displayMsg = cm.text.startsWith('[') ? cm.text : `${prefix} ${cm.text}`;

              const dedupeKey = `${displayMsg}_${new Date(cm.createdAt).getMinutes()}`;
              if (!seenTexts.has(dedupeKey)) {
                seenTexts.add(dedupeKey);
                resultList.push({
                  id: `chat_${cm.id}`,
                  message: displayMsg,
                  createdAt: cm.createdAt,
                  isRead: (cm.readBy || []).includes(user.id),
                  isPersonal: isDirect,
                  type: isDirect ? 'PERSONAL' : 'NOTICE',
                  sender: { id: cm.sender.id, name: cm.sender.name, email: cm.sender.email },
                  receiverUser: { id: user.id, name: user.name },
                  student: null,
                });
              }
            }
          }
        }
      } catch (chatQueryErr) {
        console.warn('[TeacherService] ChatMessage inbox merge error:', chatQueryErr);
      }
    }

    // 3. 최신 날짜 순 정렬
    resultList.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return resultList;
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

  /** 원아 탑승/하차/결석 시 학부모에게 실시간 소켓 및 알림 발송 */
  private async notifyParentBoardStatus(
    student: Student,
    vehicle: Vehicle | null,
    status: 'BOARDED' | 'WAITING' | 'ABSENT',
    tagMethod: string = 'MANUAL'
  ) {
    const parent = student.parentUser;
    const studentName = student.adminDisplayName || student.name;
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let statusKr = '탑승 대기';
    if (status === 'BOARDED') statusKr = '탑승 완료';
    else if (status === 'ABSENT') statusKr = '미탑승/결석';

    const message = `[통학 라이브] ${studentName} 원아가 ${vehicle ? vehicle.busNumber + '호차에 ' : ''}${statusKr}되었습니다. (${timeStr})`;

    if (parent) {
      try {
        const noti = this.notificationRepository.create({
          recipient: parent,
          recipientRole: 'PARENT',
          type: 'BOARD_STATUS',
          message,
        });
        await this.notificationRepository.save(noti);
      } catch (err) {
        console.error('[notifyParentBoardStatus] notification save error:', err);
      }

      // 메신저 "TakeMe 알림"(개인 알림) 전송 - 수신 설정에서 꺼진 종류는 보내지 않음
      if (status === 'BOARDED' && this.chatService) {
        this.chatService.sendSystemNotificationToUser(
          parent.id,
          '셔틀 탑승 안내',
          `${studentName} 원아가 ${vehicle ? vehicle.busNumber + '호차에 ' : ''}탑승 완료했습니다.`,
          { type: 'shuttle' },
        ).catch(() => {});
      }
    }

    if (this.locationGateway) {
      this.locationGateway.broadcastChildBoardStatus({
        parentUserId: parent?.id,
        studentId: student.id,
        studentName,
        boardStatus: status,
        vehicleId: vehicle?.id,
      });
    }
  }

  async boardStudent(email: string, studentId: number, reason?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId },
      relations: { parentUser: true }
    });
    if (!student) throw new BadRequestException('Student not found');

    // Update status
    student.boardStatus = 'BOARDED';
    student.actualBoardTime = new Date();
    await this.studentRepository.save(student);

    // 1. Create a Notification for the academy admin
    let msg = `${vehicle?.busNumber || '통학'}호차 ${student.adminDisplayName || student.name} 원생 ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 탑승 완료`;
    if (reason) {
      msg += ` (수동 탑승 사유: ${reason})`;
    }
    if (vehicle) {
      const adminNoti = this.notificationRepository.create({
        vehicle: vehicle,
        message: msg
      });
      await this.notificationRepository.save(adminNoti);
    }

    // 2. 학부모 실시간 알림 및 소켓 브로드캐스트
    await this.notifyParentBoardStatus(student, vehicle, 'BOARDED', 'MANUAL');

    // 3. Append to OperationLog
    if (vehicle) {
      await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'MANUAL');
    }

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async skipStudent(email: string, studentId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId },
      relations: { parentUser: true }
    });
    if (!student) throw new BadRequestException('Student not found');

    student.boardStatus = 'ABSENT';
    await this.studentRepository.save(student);

    const vehicle = await this.findAssignedVehicle(user.id);
    if (vehicle) {
      const adminNoti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${vehicle.busNumber}호차 ${student.adminDisplayName || student.name} 원생 ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 결석/건너뛰기`
      });
      await this.notificationRepository.save(adminNoti);
      await this.appendBoardingLog(vehicle.id, studentId, `${student.adminDisplayName || student.name} 원생 결석 처리`, 'SYSTEM');

      if (this.chatService && student.parentUser) {
        await this.chatService.sendSystemNotificationToUser(
          student.parentUser.id,
          '결석/미탑승 안내',
          `${student.adminDisplayName || student.name} 원생이 오늘 결석(미탑승) 처리되었습니다.`,
          { type: 'shuttle' }
        ).catch(() => {});
      }
    }

    // 학부모 실시간 알림 및 소켓 브로드캐스트
    await this.notifyParentBoardStatus(student, vehicle, 'ABSENT', 'SYSTEM');

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async unboardStudent(email: string, studentId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { id: studentId },
      relations: { assignedVehicle: true, parentUser: true }
    });
    if (!student) throw new BadRequestException('Student not found');

    const todayStudents = await this.getTodayStudentsForVehicle(vehicle.id);
    const isOurStudent = todayStudents.some(s => s.id === student.id);
    if (!isOurStudent) {
      throw new BadRequestException('해당 차량에 배정된 원아가 아닙니다.');
    }

    student.boardStatus = 'WAITING';
    student.actualBoardTime = null as any;
    await this.studentRepository.save(student);

    await this.appendBoardingLog(
      vehicle.id,
      student.id,
      `${student.adminDisplayName || student.name} 탑승 취소`,
      'MANUAL'
    );

    // 학부모 실시간 알림 및 소켓 브로드캐스트
    await this.notifyParentBoardStatus(student, vehicle, 'WAITING', 'MANUAL');

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async checkInEscort(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.findAssignedVehicle(user.id, { academy: true });
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const isMemoryOperating = this.locationGateway?.operatingVehicles?.get(vehicle.id) === true;
    const dateString = new Date().toISOString().split('T')[0];
    const latestLog = await this.operationLogRepository.findOne({
      where: { vehicle: { id: vehicle.id }, dateString },
      order: { id: 'DESC' }
    });
    const isLogOperating = !!(latestLog && latestLog.startTime && !latestLog.endTime);

    const isOperating = isMemoryOperating || isLogOperating;
    if (!isOperating) {
      throw new ConflictException('기사님이 운행을 시작하면 동승 확인을 누를 수 있어요.');
    }

    const escortName = user.name || user.email;
    const confirmedAt = new Date().toISOString();

    await this.appendBoardingLog(
      vehicle.id,
      null,
      `동승 확인: ${escortName}`,
      'ESCORT'
    );

    if (this.locationGateway?.server) {
      // 차량 방에 escortConfirmed 전송 (기사 앱 배지용)
      this.locationGateway.server.to(`vehicle_${vehicle.id}`).emit('escortConfirmed', {
        vehicleId: vehicle.id,
        escortName,
        confirmedAt,
      });

      // 유치원 방에 escortStarted 전송 (관리자 웹 알림용)
      const academyId = vehicle.academy?.id || (vehicle as any).academyId;
      if (academyId) {
        this.locationGateway.server.to(`academy_${academyId}`).emit('escortStarted', {
          vehicleId: vehicle.id,
          vehicleName: vehicle.busNumber,
          escortName,
          time: confirmedAt,
        });
      }
    }

    // 기사 대상 알림 생성
    try {
      if (vehicle.driverUser && isNotificationEnabled(vehicle.driverUser, 'escort')) {
        const escortNoti = this.notificationRepository.create({
          vehicle,
          recipient: vehicle.driverUser || undefined,
          recipientRole: 'DRIVER',
          type: 'ESCORT_CONFIRMED',
          message: `${escortName} 지도교사가 동승 확인을 완료하였습니다.`,
          academy: vehicle.academy || undefined,
        });
        await this.notificationRepository.save(escortNoti);

        if (this.locationGateway?.server) {
          this.locationGateway.server.to(`user_${vehicle.driverUser.id}`).emit('notificationReceived', {
            id: escortNoti.id,
            title: '동승 확인 완료',
            message: escortNoti.message,
            type: 'ESCORT_CONFIRMED',
            createdAt: escortNoti.createdAt,
          });
        }

        if (this.chatService) {
          await this.chatService.sendSystemNotificationToUser(
            vehicle.driverUser.id,
            '동승 확인 완료',
            `${escortName} 지도교사가 동승 확인을 완료하였습니다.`,
            { type: 'escort' }
          ).catch(() => {});
        }
      }
    } catch (_) {}

    return { success: true, escortName, confirmedAt };
  }

  async getEscortStatus(email: string, targetVehicleId?: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    let vehicle: Vehicle | null = null;
    if (targetVehicleId) {
      vehicle = await this.vehicleRepository.findOne({ where: { id: targetVehicleId } });
    } else {
      vehicle = await this.findAssignedVehicle(user.id);
    }
    if (!vehicle) {
      return { operating: false };
    }

    const isMemoryOperating = this.locationGateway?.operatingVehicles?.get(vehicle.id) === true;
    const dateString = new Date().toISOString().split('T')[0];
    const latestLog = await this.operationLogRepository.findOne({
      where: { vehicle: { id: vehicle.id }, dateString },
      order: { id: 'DESC' }
    });
    const isLogOperating = !!(latestLog && latestLog.startTime && !latestLog.endTime);
    const operating = isMemoryOperating || isLogOperating;

    let escortName: string | undefined;
    let confirmedAt: string | undefined;

    if (latestLog?.boardingRecords) {
      let records: any[] = [];
      try {
        records = typeof latestLog.boardingRecords === 'string'
          ? JSON.parse(latestLog.boardingRecords)
          : (latestLog.boardingRecords || []);
      } catch (_) {}

      for (let i = records.length - 1; i >= 0; i--) {
        const rec = records[i];
        if (rec.method === 'ESCORT') {
          confirmedAt = rec.boardTime;
          if (rec.studentName?.startsWith('동승 확인: ')) {
            escortName = rec.studentName.replace('동승 확인: ', '');
          }
          break;
        }
      }
    }

    return {
      operating,
      escortName,
      confirmedAt,
    };
  }

  async startOperation(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (vehicle) {
      const rawBus = (vehicle.busNumber || '셔틀').trim();
      const busName = rawBus.endsWith('호차')
        ? rawBus
        : (rawBus.endsWith('호') ? `${rawBus}차` : `${rawBus}호차`);

      const noti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${busName} 운행이 시작되었습니다.`,
        type: 'SHUTTLE',
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

      if (this.chatService) {
        this.getTodayStudentsForVehicle(vehicle.id).then((students) => {
          const parentIds = students
            .map((s) => s.parentUser?.id)
            .filter((id): id is number => typeof id === 'number');
          if (parentIds.length > 0) {
            this.chatService?.sendSystemNotificationToUsers(
              parentIds,
              '운행 시작 안내',
              `${busName} 운행이 시작되었습니다. 지도에서 실시간 위치를 확인할 수 있습니다.`,
              { type: 'shuttle' }
            ).catch(() => {});
          }
        }).catch(() => {});
      }
    }
    return { success: true };
  }

  async endOperation(email: string, interiorChecked?: boolean) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (vehicle) {
      const rawBus = (vehicle.busNumber || '셔틀').trim();
      const busName = rawBus.endsWith('호차')
        ? rawBus
        : (rawBus.endsWith('호') ? `${rawBus}차` : `${rawBus}호차`);

      const noti = this.notificationRepository.create({
        vehicle: vehicle,
        message: `${busName} 운행이 종료되었습니다.`,
        type: 'SHUTTLE',
      });
      await this.notificationRepository.save(noti);

      if (this.locationGateway) {
        this.locationGateway.broadcastOperationStatus(vehicle.id, false, vehicle.busNumber);
      }

      if (this.chatService) {
        this.getTodayStudentsForVehicle(vehicle.id).then((students) => {
          const parentIds = students
            .map((s) => s.parentUser?.id)
            .filter((id): id is number => typeof id === 'number');
          if (parentIds.length > 0) {
            this.chatService?.sendSystemNotificationToUsers(
              parentIds,
              '운행 종료 안내',
              `${busName} 운행이 안전하게 종료되었습니다.`,
              { type: 'shuttle' }
            ).catch(() => {});
          }
        }).catch(() => {});
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

    const vehicle = await this.findAssignedVehicle(teacherUser.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const student = await this.studentRepository.findOne({ 
      where: { studentUser: { id: studentUser.id } },
      relations: { parentUser: true, assignedVehicle: true }
    });
    if (!student) throw new BadRequestException('Student record not found');

    if (student.assignedVehicle?.id !== vehicle.id) {
      // Allow boarding but could warn. For now, just allow it.
    }

    student.boardStatus = 'BOARDED';
    student.actualBoardTime = new Date();
    await this.studentRepository.save(student);

    // 1. Create a Notification for the academy admin
    this.notificationRepository.save(this.notificationRepository.create({
      vehicle: vehicle,
      message: `${student.adminDisplayName || student.name} 학생이 셔틀버스에 탑승했습니다. ${new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 탑승 완료 (QR)`
    }));

    // 2. 학부모 실시간 알림 및 소켓 브로드캐스트
    await this.notifyParentBoardStatus(student, vehicle, 'BOARDED', 'QR');
    
    // 3. Append to OperationLog
    await this.appendBoardingLog(vehicle.id, student.id, student.adminDisplayName || student.name, 'QR');

    return { success: true, studentName: student.adminDisplayName || student.name };
  }

  async getStaffList(email?: string) {
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
    // 담임교사 등 차량이 배정되지 않은 교사도 원장님 및 학부모에게 메시지 발송 허용

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

  async triggerEmergency(email: string, clientLat?: number, clientLng?: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const vehicle = await this.vehicleRepository.findOne({ 
      where: [{ teacherUser: { id: user.id } }, { driverUser: { id: user.id } }],
      relations: { academy: { owner: true }, driverUser: true, teacherUser: true }
    });
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    const academyId = vehicle.academy?.id || (vehicle as any).academyId;
    if (!academyId) throw new BadRequestException('소속 유치원을 찾을 수 없습니다.');

    // 같은 유치원에 소속된 다른 차량들만 조회
    const otherVehicles = await this.vehicleRepository.find({
      where: { academy: { id: academyId } },
      relations: { driverUser: true, teacherUser: true }
    }).then(list => list.filter(v => v.id !== vehicle.id));

    const todayStudents = await this.getTodayStudentsForVehicle(vehicle.id);
    const unboardedStudents = todayStudents.filter(s => s.boardStatus === 'WAITING' && s.latitude && s.longitude);

    // 자동 재배정은 제거하고 비상 알림만 전송
    for (const student of unboardedStudents) {
      const parentUser = await this.userRepository.createQueryBuilder('user')
        .leftJoin('user.parentStudents', 'student')
        .where('student.id = :studentId', { studentId: student.id })
        .getOne();

      if (parentUser) {
        const msg = this.messageRepository.create({
          student,
          targetRoles: ['PARENT'],
          message: `[긴급 안내] ${vehicle.busNumber} 차량에 비상 상황이 발생하였습니다. 원아의 안전을 최우선으로 확인 중입니다.`,
          receiverUser: parentUser
        });
        await this.messageRepository.save(msg);
      }
    }

    // 유치원 관리자(원장님) 알림
    if (vehicle.academy && vehicle.academy.owner) {
      const msg = this.messageRepository.create({
        targetRoles: ['ACADEMY_ADMIN'],
        message: `🚨 [긴급 SOS] ${vehicle.busNumber} 차량 사고/고장 비상 상황 발생. 즉시 확인해 주세요.`,
        receiverUser: vehicle.academy.owner
      });
      await this.messageRepository.save(msg);
    }

    // 같은 유치원의 타 호차 직원에게 알림
    for (const v of otherVehicles) {
      const staffUsers = [];
      if (v.driverUser) staffUsers.push(v.driverUser);
      if (v.teacherUser) staffUsers.push(v.teacherUser);
      for (const staff of staffUsers) {
        const msg = this.messageRepository.create({
          targetRoles: [staff.role],
          message: `🚨 [비상] ${vehicle.busNumber} 사고/고장 비상 상황이 발생했습니다.`,
          receiverUser: staff
        });
        await this.messageRepository.save(msg);
      }
    }

    // 소켓 emergencyAlert: 오직 유치원 방에만 전송 (전체 브로드캐스트 금지)
    let defaultLat = 37.5580;
    let defaultLng = 126.8240;
    if (vehicle.polygonCoordinates && Array.isArray(vehicle.polygonCoordinates) && vehicle.polygonCoordinates.length > 0) {
      const firstPt = vehicle.polygonCoordinates[0];
      if (Array.isArray(firstPt) && firstPt.length >= 2) {
        defaultLat = Number(firstPt[0]) || defaultLat;
        defaultLng = Number(firstPt[1]) || defaultLng;
      }
    }
    const lat = clientLat || defaultLat;
    const lng = clientLng || defaultLng;
    const time = new Date().toISOString();
    const driverName = vehicle.driverUser?.name || user.name || '기사님';

    if (this.locationGateway?.server) {
      this.locationGateway.server.to(`academy_${academyId}`).emit('emergencyAlert', {
        vehicleId: vehicle.id,
        vehicleName: vehicle.busNumber,
        driverName,
        lat,
        lng,
        time,
      });
    }

    // Operation Log 저장
    await this.appendBoardingLog(vehicle.id, null, '🚨 긴급 SOS 발동', 'SYSTEM');

    return {
      success: true,
      message: '긴급 알림이 유치원 관리자에게 전송되었습니다.',
      alert: { vehicleId: vehicle.id, vehicleName: vehicle.busNumber, driverName, lat, lng, time }
    };
  }

  async getHomeroomShuttleStatus(email: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: { academy: true }
    });
    if (!user) throw new BadRequestException('User not found');

    const assignedClass = user.assignedClass;
    if (!hasAssignedClass(assignedClass)) {
      return {
        assignedClass: null,
        isAssigned: false,
        message: '관리자에게 반 배정을 요청하세요',
        students: [],
        summary: { total: 0, boarded: 0, waiting: 0, absent: 0 }
      };
    }

    const academyId = user.academy?.id || user.academyId;
    const overrides = await this.getActiveOverridesForToday();

    const qb = this.studentRepository.createQueryBuilder('s')
      .leftJoinAndSelect('s.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('s.parentUser', 'parentUser');

    if (academyId) {
      qb.where('s.academyId = :academyId', { academyId });
    }

    const allStudents = await qb.getMany();

    const classStudents = allStudents.filter(s => isSameClass(getStudentClassName(s), assignedClass));

    const students = classStudents.map(s => {
      const override = overrides.find(o => o.student.id === s.id);
      let vehicleName = s.assignedVehicle?.busNumber || '미지정';
      if (override && override.newVehicleId) {
        vehicleName = `${override.newVehicleId}호차 (임시변경)`;
      }

      let status = 'WAITING';
      let statusText = '탑승 대기';
      if (s.boardStatus === 'BOARDED') {
        status = 'BOARDED';
        statusText = '탑승 완료';
      } else if (s.boardStatus === 'ABSENT') {
        status = 'ABSENT';
        statusText = '결석 (미탑승)';
      }

      const rawPhone = s.raw ? (s.raw['학부모연락처'] || s.raw['연락처'] || s.raw['전화번호'] || '') : '';
      const parentPhone = s.parentUser?.phone || rawPhone || '';

      return {
        id: s.id,
        name: s.adminDisplayName || s.name,
        vehicle: vehicleName,
        status,
        statusText,
        boarded: status === 'BOARDED',
        absent: status === 'ABSENT',
        boardedAt: s.actualBoardTime ? new Date(s.actualBoardTime).toISOString() : null,
        address: s.address,
        parentPhone,
        allergies: s.allergies || (s.raw ? s.raw['알레르기'] : '') || '',
      };
    });

    return {
      assignedClass,
      students,
      summary: {
        total: students.length,
        boarded: students.filter(s => s.status === 'BOARDED').length,
        waiting: students.filter(s => s.status === 'WAITING').length,
        absent: students.filter(s => s.status === 'ABSENT').length,
      }
    };
  }

  async getHomeroomAttendance(email: string, dateInput?: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: { academy: true }
    });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    if (!hasAssignedClass(user.assignedClass)) {
      return {
        assignedClass: null,
        isAssigned: false,
        message: '관리자에게 반 배정을 요청하세요',
        date: dateInput || kstDateString(),
        isSubmitted: false,
        submission: null,
        students: [],
      };
    }

    const assignedClass = user.assignedClass!;
    const date = (dateInput && isValidDateString(dateInput)) ? dateInput : kstDateString();
    const academyId = user.academy?.id || user.academyId;

    const submission = await this.submissionRepository.findOne({
      where: {
        academy: { id: academyId },
        className: assignedClass,
        date,
      },
    });

    const qb = this.studentRepository.createQueryBuilder('s')
      .leftJoinAndSelect('s.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('s.parentUser', 'parentUser');

    if (academyId) {
      qb.where('s.academyId = :academyId', { academyId });
    }

    const allStudents = await qb.getMany();
    const classStudents = allStudents.filter(s => isSameClass(getStudentClassName(s), assignedClass));

    const studentIds = classStudents.map(s => s.id);
    let attendances: Attendance[] = [];
    if (studentIds.length > 0) {
      attendances = await this.attendanceRepository.createQueryBuilder('att')
        .leftJoinAndSelect('att.student', 'student')
        .where('att.studentId IN (:...ids) AND att.date = :date', { ids: studentIds, date })
        .getMany();
    }

    const attendanceMap = new Map<number, Attendance>();
    for (const a of attendances) {
      if (a.student?.id) attendanceMap.set(a.student.id, a);
    }

    const studentList = classStudents.map(s => {
      const existing = attendanceMap.get(s.id);

      let currentStatus: AttendanceStatus = AttendanceStatus.PRESENT;
      if (existing) {
        currentStatus = existing.status;
      } else if (s.boardStatus === 'ABSENT') {
        currentStatus = AttendanceStatus.ABSENT;
      } else {
        currentStatus = AttendanceStatus.PRESENT;
      }

      return {
        studentId: s.id,
        name: s.adminDisplayName || s.name,
        status: currentStatus,
        memo: existing?.memo || '',
        boardStatus: s.boardStatus || 'WAITING',
        actualBoardTime: s.actualBoardTime ? new Date(s.actualBoardTime).toISOString() : null,
        vehicleName: s.assignedVehicle?.busNumber || '미지정',
        isRecorded: !!existing,
      };
    });

    return {
      assignedClass,
      isAssigned: true,
      date,
      isSubmitted: !!submission,
      submission: submission || null,
      summary: {
        total: studentList.length,
        present: studentList.filter(s => s.status === AttendanceStatus.PRESENT).length,
        absent: studentList.filter(s => s.status === AttendanceStatus.ABSENT).length,
        late: studentList.filter(s => s.status === AttendanceStatus.LATE).length,
        earlyLeave: studentList.filter(s => s.status === AttendanceStatus.EARLY_LEAVE).length,
      },
      students: studentList,
    };
  }

  async submitHomeroomAttendance(email: string, payload: {
    date: string;
    attendances: Array<{ studentId: number; status: AttendanceStatus; memo?: string }>;
  }) {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: { academy: true }
    });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    if (!hasAssignedClass(user.assignedClass)) {
      throw new BadRequestException('관리자에게 반 배정을 요청하세요.');
    }

    const assignedClass = user.assignedClass!;
    const date = (payload.date && isValidDateString(payload.date)) ? payload.date : kstDateString();
    const academyId = user.academy?.id || user.academyId;

    if (!academyId) throw new BadRequestException('유치원 정보가 필요합니다.');

    let presentCount = 0;
    let absentCount = 0;
    let lateCount = 0;
    let earlyLeaveCount = 0;

    for (const item of (payload.attendances || [])) {
      if (!item.studentId) continue;
      const student = await this.studentRepository.findOne({ where: { id: item.studentId } });
      if (!student) continue;

      let att = await this.attendanceRepository.findOne({
        where: { student: { id: student.id }, date },
      });

      if (!att) {
        att = this.attendanceRepository.create({
          student,
          date,
          status: item.status || AttendanceStatus.PRESENT,
          recordedBy: user,
          recordedByName: user.name ? formatTeacherName(user.name) : '담임선생님',
          memo: item.memo || '',
        });
      } else {
        att.status = item.status || AttendanceStatus.PRESENT;
        att.recordedBy = user;
        att.recordedByName = user.name ? formatTeacherName(user.name) : '담임선생님';
        if (item.memo !== undefined) att.memo = item.memo;
      }

      await this.attendanceRepository.save(att);

      if (att.status === AttendanceStatus.PRESENT) presentCount++;
      else if (att.status === AttendanceStatus.ABSENT) absentCount++;
      else if (att.status === AttendanceStatus.LATE) lateCount++;
      else if (att.status === AttendanceStatus.EARLY_LEAVE) earlyLeaveCount++;
    }

    const totalCount = payload.attendances?.length || 0;

    let submission = await this.submissionRepository.findOne({
      where: {
        academy: { id: academyId },
        className: assignedClass,
        date,
      },
    });

    if (!submission) {
      submission = this.submissionRepository.create({
        academy: { id: academyId } as any,
        className: assignedClass,
        date,
        teacher: user,
        teacherName: user.name ? formatTeacherName(user.name) : '담임선생님',
        totalCount,
        presentCount,
        absentCount,
        lateCount,
        earlyLeaveCount,
        submittedAt: new Date(),
      });
    } else {
      submission.teacher = user;
      submission.teacherName = user.name ? formatTeacherName(user.name) : '담임선생님';
      submission.totalCount = totalCount;
      submission.presentCount = presentCount;
      submission.absentCount = absentCount;
      submission.lateCount = lateCount;
      submission.earlyLeaveCount = earlyLeaveCount;
      submission.submittedAt = new Date();
    }

    const savedSubmission = await this.submissionRepository.save(submission);

    const socketPayload = {
      academyId,
      className: assignedClass,
      date,
      teacherName: user.name ? formatTeacherName(user.name) : '담임선생님',
      teacherEmail: user.email,
      submittedAt: savedSubmission.submittedAt,
      totalCount,
      presentCount,
      absentCount,
      lateCount,
      earlyLeaveCount,
    };
    this.locationGateway.broadcastAttendanceSubmitted(academyId, socketPayload);

    return {
      success: true,
      submission: savedSubmission,
      message: `${assignedClass} 출석부가 성공적으로 제출되었습니다.`,
    };
  }

  /**
   * 교사/기사용 알림 목록 조회
   */
  async getTeacherNotifications(email: string) {
    const user = await this.userRepository.findOne({
      where: { email },
      relations: { academy: true },
    });
    if (!user) throw new BadRequestException('User not found');

    const readKeys = new Set(Array.isArray(user.readNotificationKeys) ? user.readNotificationKeys : []);
    const items: Array<{
      id: number;
      key: string;
      title: string;
      message: string;
      type: string;
      isRead: boolean;
      createdAt: Date;
    }> = [];

    const assignedVehicle = await this.findAssignedVehicle(user.id);

    // 1. Notification entity
    const notiQb = this.notificationRepository.createQueryBuilder('noti')
      .leftJoinAndSelect('noti.vehicle', 'vehicle')
      .leftJoinAndSelect('noti.approvalRequest', 'approvalRequest')
      .leftJoinAndSelect('approvalRequest.student', 'student')
      .where('noti.recipientId = :uid', { uid: user.id });

    if (assignedVehicle) {
      notiQb.orWhere('(noti.vehicleId = :vid AND noti.type IN (:...vTypes))', {
        vid: assignedVehicle.id,
        vTypes: ['SCHEDULE_CHANGE', 'ESCORT_CONFIRMED', 'APPROVAL_RESULT', 'NOTICE'],
      });
    }

    if (user.role === 'HOMEROOM_TEACHER' && user.assignedClass) {
      notiQb.orWhere('(noti.recipientRole = :rRole AND noti.academyId = :aid)', {
        rRole: 'HOMEROOM_TEACHER',
        aid: user.academy?.id,
      });
    }

    const notis = await notiQb.orderBy('noti.createdAt', 'DESC').take(30).getMany();

    for (const n of notis) {
      const key = `n_${n.id}`;
      let title = '공지 알림';
      if (n.type === 'ESCORT_CONFIRMED') title = '동승 확인';
      else if (n.type === 'SCHEDULE_CHANGE' || n.type === 'APPROVAL_RESULT') title = '통학 변동 안내';
      else if (n.type === 'APPROVAL_REQUEST') title = '통학 변경 신청';
      else if (n.message && (n.message.includes('운행이 시작') || n.message.includes('운행이 종료'))) title = '운행 알림';

      items.push({
        id: n.id,
        key,
        title,
        message: n.message,
        type: n.type,
        isRead: n.isRead || readKeys.has(key),
        createdAt: n.createdAt,
      });
    }

    // 2. Direct Messages (Admin / Parent messages)
    const msgQb = this.messageRepository.createQueryBuilder('msg')
      .leftJoinAndSelect('msg.student', 'student')
      .where('msg.receiverUserId = :uid', { uid: user.id });

    if (user.role === 'DRIVER') {
      msgQb.orWhere("msg.targetRoles LIKE :dRole", { dRole: '%DRIVER%' });
    } else if (user.role === 'HOMEROOM_TEACHER' || user.role === 'TEACHER') {
      msgQb.orWhere("msg.targetRoles LIKE :tRole", { tRole: '%TEACHER%' });
    }

    const msgs = await msgQb.orderBy('msg.createdAt', 'DESC').take(30).getMany();

    for (const m of msgs) {
      const key = `m_${m.id}`;
      const senderTitle = m.student ? `${m.student.name} 학부모 메시지` : '기관 관리자 메시지';
      items.push({
        id: m.id,
        key,
        title: senderTitle,
        message: m.message,
        type: 'MESSAGE',
        isRead: m.isRead || readKeys.has(key),
        createdAt: m.createdAt,
      });
    }

    if (user.notificationSettings && user.notificationSettings.all === false) {
      return [];
    }

    const s = user.notificationSettings;
    const filtered = items.filter(item => {
      if (!s) return true;
      if (item.type === 'APPROVAL_REQUEST' || item.type === 'APPROVAL_RESULT' || item.type === 'SCHEDULE_CHANGE') {
        if (s.change_request === false) return false;
      }
      if (item.type === 'ESCORT_CONFIRMED') {
        if (s.escort === false) return false;
      }
      if (item.type === 'NOTICE') {
        if (s.notice === false) return false;
      }
      if (item.type === 'MESSAGE') {
        if (s.chat === false) return false;
      }
      return true;
    });

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filtered.slice(0, 50);
  }

  async getTeacherUnreadCount(email: string): Promise<{ count: number }> {
    const list = await this.getTeacherNotifications(email);
    const unread = list.filter(item => !item.isRead);
    return { count: unread.length };
  }

  async markAllTeacherNotificationsRead(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const list = await this.getTeacherNotifications(email);
    const keys = list.map(item => item.key);
    const existingKeys = new Set(Array.isArray(user.readNotificationKeys) ? user.readNotificationKeys : []);
    keys.forEach(k => existingKeys.add(k));

    user.readNotificationKeys = Array.from(existingKeys);
    await this.userRepository.save(user);

    const notiIds = list.filter(item => item.key.startsWith('n_')).map(item => item.id);
    if (notiIds.length > 0) {
      await this.notificationRepository.createQueryBuilder()
        .update(Notification)
        .set({ isRead: true })
        .whereInIds(notiIds)
        .execute()
        .catch(() => {});
    }

    return { success: true };
  }

  async markTeacherNotificationRead(email: string, id?: number, key?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const notiKey = key || (id ? `n_${id}` : undefined);
    const existingKeys = new Set(Array.isArray(user.readNotificationKeys) ? user.readNotificationKeys : []);
    if (notiKey) {
      existingKeys.add(notiKey);
      user.readNotificationKeys = Array.from(existingKeys);
      await this.userRepository.save(user);
    }

    if (id) {
      await this.notificationRepository.update(id, { isRead: true }).catch(() => {});
    }

    return { success: true };
  }

  async readyToDepart(email: string, stopName?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('Assigned vehicle not found');

    this.locationGateway?.broadcastDepartSignal(vehicle.id, stopName);
    const label = stopName ? ` (${stopName})` : '';
    await this.appendBoardingLog(vehicle.id, null, `지도교사 출발 가능 신호 발송${label}`, 'SYSTEM');
    return { success: true, message: '기사님께 출발 신호를 전달했습니다.' };
  }

  async logDrivingEvent(email: string, type?: string, detail?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) return { success: false };

    const text = detail && detail.trim().length > 0 ? detail.trim() : `안전운전 기록 (${type || 'EVENT'})`;
    await this.appendBoardingLog(vehicle.id, null, `${text}`, 'SYSTEM');
    return { success: true };
  }

  async getWalkInStudents(email: string) {
    const user = await this.userRepository.findOne({ where: { email }, relations: { academy: true } });
    if (!user) throw new BadRequestException('User not found');
    const academyId = user.academy?.id;
    if (!academyId) return [];

    const walkIns = await this.studentRepository.find({
      where: { academy: { id: academyId }, isNotRiding: true },
      order: { name: 'ASC' }
    });

    return walkIns.map(s => ({
      id: s.id,
      name: s.adminDisplayName || s.name,
      address: s.address,
      allergies: s.allergies || '',
    }));
  }

  async requestRide(email: string, studentId: number) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const vehicle = await this.findAssignedVehicle(user.id);
    if (!vehicle) throw new BadRequestException('배정된 차량을 찾을 수 없습니다.');

    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new NotFoundException('원아를 찾을 수 없습니다.');

    const today = new Date().toISOString().split('T')[0];
    const override = this.scheduleOverrideRepository.create({
      student,
      startDate: today,
      endDate: today,
      overrideType: OverrideType.CHANGE_LOCATION,
      newVehicleId: vehicle.id,
      reason: '지도교사 현장 추가 탑승 요청',
    });
    await this.scheduleOverrideRepository.save(override);
    return { success: true };
  }

}
