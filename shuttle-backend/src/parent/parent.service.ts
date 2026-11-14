import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { ApprovalService } from '../approval/approval.service';
import { ChangeRequestType } from '../entities/approval-request.entity';
import { Notification } from '../entities/notification.entity';
import { Student } from '../entities/student.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { RoutingService } from '../routing/routing.service';
import { User } from '../entities/user.entity';
import { PickupPoint } from '../entities/pickup-point.entity';

import { BoardPost } from '../entities/board-post.entity';
import { getStudentClassName } from '../utils/school.util';
import { resolveMediaRef, resolveMediaRefs } from '../utils/s3.util';
import { isNotificationEnabled, getUserNotificationSettings } from '../utils/notification.util';
import { TeacherService } from '../teacher/teacher.service';

@Injectable()
export class ParentService {
  constructor(
    @InjectRepository(ScheduleOverride) private overrideRepository: Repository<ScheduleOverride>,
    @InjectRepository(Notification) private notificationRepository: Repository<Notification>,
    @InjectRepository(Student) private studentRepository: Repository<Student>,
    @InjectRepository(StudentSchedule) private scheduleRepository: Repository<StudentSchedule>,
    @InjectRepository(Vehicle) private vehicleRepository: Repository<Vehicle>,
    @InjectRepository(ParentMessage) private messageRepository: Repository<ParentMessage>,
    @InjectRepository(User) private userRepository: Repository<User>,
    @InjectRepository(PickupPoint) private pickupPointRepository: Repository<PickupPoint>,
    @InjectRepository(BoardPost) private boardPostRepository: Repository<BoardPost>,
    private routingService: RoutingService,
    private approvalService: ApprovalService,
  ) {}

  private isPointInPolygon(point: number[], vs: number[][]) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  async registerInfo(email: string, payload: any) {
    // 1. Find or create student based on the user's email
    // Wait, the parent registers their info. We need to find the User.
    // We can find the student linked to this parent's email.
    let student = await this.studentRepository.findOne({ where: { raw: { email } }, relations: { schedules: true } });
    if (!student) {
      student = new Student();
      student.name = payload.name;
      student.address = payload.address;
      student.raw = { ...payload, email };
      student = await this.studentRepository.save(student);
    } else {
      student.name = payload.name;
      student.address = payload.address;
      student.raw = { ...student.raw, ...payload };
      await this.studentRepository.save(student);
    }

    // Clear old schedules
    await this.scheduleRepository.delete({ student: { id: student.id } });

    // Save schedules
    if (payload.schedules && Array.isArray(payload.schedules)) {
      for (const sched of payload.schedules) {
        const schedule = new StudentSchedule();
        schedule.student = student;
        schedule.type = sched.type;
        schedule.dayOfWeek = sched.dayOfWeek;
        schedule.address = sched.address;
        schedule.latitude = sched.latitude;
        schedule.longitude = sched.longitude;
        schedule.isCustomLocation = sched.isCustomLocation || false;
        // Optionally find and assign vehicle here if provided
        await this.scheduleRepository.save(schedule);
      }
    }

    return { success: true, studentId: student.id };
  }

  async createOverride(email: string, targetDate: string, overrideType: OverrideType, reason: string) {
    // 1. Find student linked to this parent email
    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student) {
      throw new BadRequestException('연결된 원생 정보를 찾을 수 없습니다.');
    }

    // 2. Time limit removed as per request

    let latitude = null;
    let longitude = null;
    let newVehicleId = null;
    let newAddress = null;

    if (overrideType === OverrideType.CHANGE_LOCATION) {
      if (!reason || reason.trim() === '') {
        throw new BadRequestException('변경할 주소를 입력해주세요.');
      }
      newAddress = reason;
      
      const coords = await this.routingService.geocodeAddress(newAddress);
      if (!coords) {
        throw new BadRequestException('해당 주소를 좌표로 변환할 수 없습니다. 올바른 주소인지 확인해주세요.');
      }
      
      latitude = coords.lat;
      longitude = coords.lng;

      const vehicles = await this.vehicleRepository.find();
      for (const v of vehicles) {
        if (v.polygonCoordinates) {
          try {
            const polygon = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : v.polygonCoordinates;
            if (Array.isArray(polygon) && polygon.length > 2) {
              if (this.isPointInPolygon([latitude, longitude], polygon)) {
                newVehicleId = v.id;
                break;
              }
            }
          } catch(e) {}
        }
      }
    }

    // 3. 통학 변경 신청 (ApprovalRequest) 단일 생성 및 기관 관리자 승인 절차 연동
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');
    const appType = overrideType === OverrideType.ABSENCE ? ChangeRequestType.ABSENCE : ChangeRequestType.CHANGE_LOCATION;
    const reqRes = await this.approvalService.createRequest(user, {
      studentId: student.id,
      type: appType,
      targetDate,
      reason,
      newAddress: newAddress || undefined,
      newLatitude: latitude || undefined,
      newLongitude: longitude || undefined,
      targetVehicleId: newVehicleId || undefined,
    });

    return {
      success: true,
      message: '성공적으로 신청되었습니다. 기관 관리자의 승인 후 최종 반영됩니다.',
      request: reqRes.request,
    };
  }

  async getNotifications(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) return [];

    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('student.academy', 'academy')
      .where('parentUser.id = :uid OR studentUser.id = :uid OR parentUser.email = :email OR studentUser.email = :email', { uid: user.id, email })
      .getOne();

    const readKeys = new Set(Array.isArray(user.readNotificationKeys) ? user.readNotificationKeys : []);
    if (user.notificationSettings && user.notificationSettings.all === false) {
      return [];
    }

    const items: Array<{
      id: number;
      key: string;
      title: string;
      message: string;
      type: string;
      isRead: boolean;
      createdAt: Date;
    }> = [];

    // 1. Vehicle notifications (shuttle start/end, boarding, absence)
    if (student?.assignedVehicle) {
      const vNotis = await this.notificationRepository.find({
        where: { vehicle: { id: student.assignedVehicle.id } },
        order: { createdAt: 'DESC' },
        take: 30,
      });

      for (const n of vNotis) {
        const msg = n.message || '';
        let type = 'NOTICE';
        let title = '공지 알림';
        if (msg.includes('운행이 시작')) {
          if (user.notifyShuttleOperation === false) continue;
          type = 'SHUTTLE';
          title = '셔틀 운행 시작';
        } else if (msg.includes('운행이 종료')) {
          if (user.notifyShuttleOperation === false) continue;
          type = 'SHUTTLE';
          title = '셔틀 운행 종료';
        } else if (msg.includes('탑승')) {
          type = 'BOARDING';
          title = '원아 탑승 완료';
        } else if (msg.includes('결석') || msg.includes('미탑승')) {
          type = 'ABSENCE';
          title = '결석 처리 안내';
        }

        const key = `n_${n.id}`;
        items.push({
          id: n.id,
          key,
          title,
          message: msg,
          type,
          isRead: readKeys.has(key),
          createdAt: n.createdAt,
        });
      }
    }

    // 2. Direct Messages (Teacher / Admin)
    const qbMsg = this.messageRepository.createQueryBuilder('msg')
      .leftJoinAndSelect('msg.student', 'student')
      .where('msg.receiverUserId = :uid', { uid: user.id });

    if (student) {
      qbMsg.orWhere('(msg.studentId = :sid AND msg.targetRoles LIKE :pRole)', { sid: student.id, pRole: '%PARENT%' });
    }
    const msgs = await qbMsg.orderBy('msg.createdAt', 'DESC').take(30).getMany();

    for (const m of msgs) {
      const key = `m_${m.id}`;
      items.push({
        id: m.id,
        key,
        title: '선생님/원장님 메시지',
        message: m.message,
        type: 'MESSAGE',
        isRead: m.isRead || readKeys.has(key),
        createdAt: m.createdAt,
      });
    }

    // 3. New Board Posts / Notices (새 알림장 / 새 게시물)
    const academyId = student?.academy?.id || user.academyId;
    if (academyId) {
      const className = student ? getStudentClassName(student) : null;
      const postQb = this.boardPostRepository.createQueryBuilder('post')
        .where('post.academyId = :aid', { aid: academyId });

      if (className) {
        postQb.andWhere('(post.visibility = :vAll OR post.targetClass = :tc)', { vAll: 'ALL', tc: className });
      } else {
        postQb.andWhere('post.visibility = :vAll', { vAll: 'ALL' });
      }

      const posts = await postQb.orderBy('post.createdAt', 'DESC').take(25).getMany();
      for (const p of posts) {
        const isNotice = p.postType === 'NOTICE';
        if (isNotice) {
          if (!isNotificationEnabled(user, 'notice')) continue;
        } else {
          if (!isNotificationEnabled(user, 'post')) continue;
        }

        const key = `p_${p.id}`;
        const preview = p.content ? (p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content) : p.title;
        items.push({
          id: p.id,
          key,
          title: isNotice ? `[새 알림장] ${p.title}` : `[새 게시물] ${p.title}`,
          message: preview,
          type: isNotice ? 'NOTICE' : 'POST',
          isRead: readKeys.has(key),
          createdAt: p.createdAt,
        });
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return items.slice(0, 50);
  }

  async getUnreadNotificationCount(email: string): Promise<{ count: number }> {
    const list = await this.getNotifications(email);
    const count = list.filter((n: any) => !n.isRead).length;
    return { count };
  }

  async readAllNotifications(email: string) {
    const notifications = await this.getNotifications(email);
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) return { success: true };

    const keys = notifications.map((n: any) => n.key).filter(Boolean);
    const readKeys = new Set(Array.isArray(user.readNotificationKeys) ? user.readNotificationKeys : []);
    keys.forEach(k => readKeys.add(k));
    user.readNotificationKeys = Array.from(readKeys);
    await this.userRepository.save(user);

    await this.messageRepository.createQueryBuilder()
      .update(ParentMessage)
      .set({ isRead: true })
      .where('receiverUserId = :uid', { uid: user.id })
      .execute()
      .catch(() => {});

    return { success: true };
  }

  async getNotificationSettings(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    return getUserNotificationSettings(user);
  }

  async updateNotificationSettings(email: string, settings: Record<string, boolean>) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');
    const current = user.notificationSettings || {};
    const updated = { ...current, ...settings };

    // 기존 notifyBoardPost 설정 시 notifyNotice, notifyPost 둘 다에 반영
    if (settings.notifyBoardPost !== undefined) {
      user.notifyBoardPost = !!settings.notifyBoardPost;
      if (settings.notifyNotice === undefined) {
        user.notifyNotice = !!settings.notifyBoardPost;
        updated.notifyNotice = !!settings.notifyBoardPost;
        updated.notice = !!settings.notifyBoardPost;
      }
      if (settings.notifyPost === undefined) {
        user.notifyPost = !!settings.notifyBoardPost;
        updated.notifyPost = !!settings.notifyBoardPost;
        updated.post = !!settings.notifyBoardPost;
      }
    }
    if (settings.notifyNotice !== undefined) {
      user.notifyNotice = !!settings.notifyNotice;
      updated.notice = !!settings.notifyNotice;
    }
    if (settings.notice !== undefined) {
      user.notifyNotice = !!settings.notice;
      updated.notifyNotice = !!settings.notice;
    }
    if (settings.notifyPost !== undefined) {
      user.notifyPost = !!settings.notifyPost;
      updated.post = !!settings.notifyPost;
    }
    if (settings.post !== undefined) {
      user.notifyPost = !!settings.post;
      updated.notifyPost = !!settings.post;
    }
    if (settings.notifyShuttleOperation !== undefined) {
      user.notifyShuttleOperation = !!settings.notifyShuttleOperation;
    }

    user.notificationSettings = updated;
    await this.userRepository.save(user);
    return {
      success: true,
      settings: getUserNotificationSettings(user),
    };
  }

  async getRoute(email: string, studentId?: number, direction: string = 'GOTO') {
    let student: Student | null = null;

    if (studentId) {
      student = await this.studentRepository.createQueryBuilder('student')
        .leftJoinAndSelect('student.parentUser', 'parentUser')
        .leftJoinAndSelect('student.studentUser', 'studentUser')
        .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
        .leftJoinAndSelect('student.academy', 'academy')
        .where('student.id = :studentId AND (parentUser.email = :email OR studentUser.email = :email)', { studentId, email })
        .getOne();
    }

    if (!student) {
      student = await this.studentRepository.createQueryBuilder('student')
        .leftJoinAndSelect('student.parentUser', 'parentUser')
        .leftJoinAndSelect('student.studentUser', 'studentUser')
        .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
        .leftJoinAndSelect('student.academy', 'academy')
        .where('parentUser.email = :email OR studentUser.email = :email', { email })
        .getOne();
    }

    if (!student) {
      student = await this.studentRepository.findOne({
        where: { raw: { email } },
        relations: { assignedVehicle: true, academy: true }
      });
    }

    if (!student || !student.assignedVehicle) {
      return { routePoints: [], stops: [], academy: null, myChildStop: null, academyPickupPoints: [] };
    }

    const isGohome = direction?.toUpperCase() === 'GOHOME';

    // Get all students assigned to this vehicle (소속 유치원 일치 보장)
    const allStudents = await this.studentRepository.find({
      where: {
        assignedVehicle: { id: student.assignedVehicle.id },
        ...(student.academy ? { academy: { id: student.academy.id } } : {})
      },
      relations: { academy: true }
    });

    // 오늘 결석 또는 직접 픽업 원아 체크 (override 또는 boardStatus)
    const today = new Date();
    const tzOffset = today.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, 10);
    const overrides = await this.overrideRepository.find({
      where: {
        startDate: localISOTime,
      },
      relations: { student: true }
    });

    const excludedStudentIds = new Set<number>();
    for (const ov of overrides) {
      if (!ov.student?.id) continue;
      if (ov.overrideType === OverrideType.ABSENCE) {
        excludedStudentIds.add(ov.student.id);
      } else if (isGohome && ov.overrideType === OverrideType.PICKUP) {
        // 하원 시 보호자 직접 픽업은 하원 차량 미탑승 처리
        excludedStudentIds.add(ov.student.id);
      }
    }

    // Extract valid locations
    const stops = allStudents
      .filter(s => s.latitude && s.longitude && s.boardStatus !== 'ABSENT' && !excludedStudentIds.has(s.id))
      .map(s => {
        const isMyChild = s.id === student!.id;
        const displayName = isMyChild 
          ? `${s.adminDisplayName || s.name} (우리 아이 ${isGohome ? '하차지' : '탑승지'})` 
          : (s.adminDisplayName || s.name);
        
        let expectedTime = isGohome ? '16:30' : '08:40';
        if (s.raw) {
          if (isGohome) {
            expectedTime = s.raw['하원예상시간'] || s.raw['예상하차시간'] || '16:30';
          } else {
            expectedTime = s.raw['등원예상시간'] || s.raw['예상탑승시간'] || '08:40';
          }
        }

        const stopAddress = isGohome 
          ? (s.dropoffLocation || s.boardingLocation || s.address)
          : (s.boardingLocation || s.address);

        return {
          id: s.id,
          name: displayName,
          rawName: s.name,
          isMyChild,
          address: stopAddress,
          latitude: parseFloat(s.latitude as any),
          longitude: parseFloat(s.longitude as any),
          expectedTime,
        };
      });

    const academy = student.academy;
    const routePoints: any[] = [];
    if (academy && academy.latitude && academy.longitude) {
      routePoints.push({
        latitude: parseFloat(academy.latitude as any),
        longitude: parseFloat(academy.longitude as any),
        title: academy.name || '유치원'
      });
    }

    stops.forEach(s => {
      routePoints.push({ latitude: s.latitude, longitude: s.longitude, title: s.name });
    });

    if (academy && academy.latitude && academy.longitude && stops.length > 0) {
      routePoints.push({
        latitude: parseFloat(academy.latitude as any),
        longitude: parseFloat(academy.longitude as any),
        title: academy.name || '유치원'
      });
    }

    let academyPickupPoints: any[] = [];
    if (academy) {
      academyPickupPoints = await this.pickupPointRepository.find({ where: { academy: { id: academy.id } } });
    }

    const myChildStop = stops.find(s => s.isMyChild) || null;
    // 개인정보 보호: 학부모에게는 내 아이 정류장만 전달 (다른 아이의 정류장 위치/이름 노출 차단)
    const parentVisibleStops = stops.filter(s => s.isMyChild);

    return {
      vehicleId: student.assignedVehicle.id,
      academy: academy ? {
        latitude: parseFloat(academy.latitude as any),
        longitude: parseFloat(academy.longitude as any),
        name: academy.name
      } : null,
      stops: parentVisibleStops,
      routePoints,
      academyPickupPoints,
      myChildStop
    };
  }

  async getRoutePath(email: string) {
    let student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student) {
      student = await this.studentRepository.findOne({
        where: { raw: { email } },
        relations: { assignedVehicle: true }
      });
    }

    if (!student?.assignedVehicle) {
      return { path: [], progressIndex: 0 };
    }

    return TeacherService.getRoutePathForVehicle(student.assignedVehicle.id);
  }

  async createMessage(email: string, targetRoles: string[], message: string) {
    if (!message || message.trim() === '') {
      throw new BadRequestException('메시지 내용을 입력해주세요.');
    }
    if (!targetRoles || targetRoles.length === 0) {
      throw new BadRequestException('수신 대상을 선택해주세요.');
    }

    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('vehicle.driverUser', 'driverUser')
      .leftJoinAndSelect('vehicle.teacherUser', 'teacherUser')
      .leftJoinAndSelect('vehicle.academy', 'academy')
      .leftJoinAndSelect('academy.owner', 'owner')
      .where('parentUser.email = :email', { email })
      .getOne();

    if (!student) {
      throw new BadRequestException('학부모님과 연결된 원생 정보를 찾을 수 없습니다.');
    }

    let activeVehicle = student.assignedVehicle;

    const today = new Date();
    const tzOffset = today.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, 10);
    
    const override = await this.overrideRepository.findOne({
      where: { 
        student: { id: student.id },
        startDate: localISOTime,
        overrideType: OverrideType.CHANGE_LOCATION
      }
    });

    if (override && override.newVehicleId) {
      const newVehicle = await this.vehicleRepository.findOne({ 
        where: { id: override.newVehicleId },
        relations: {
          driverUser: true,
          teacherUser: true,
          academy: { owner: true }
        }
      });
      if (newVehicle) {
        activeVehicle = newVehicle;
      }
    }

    const receivers: User[] = [];
    if (activeVehicle) {
      if (targetRoles.includes('DRIVER') && activeVehicle.driverUser) receivers.push(activeVehicle.driverUser);
      if (targetRoles.includes('TEACHER') && activeVehicle.teacherUser) receivers.push(activeVehicle.teacherUser);
      if (targetRoles.includes('ACADEMY_ADMIN') && activeVehicle.academy?.owner) receivers.push(activeVehicle.academy.owner);
    }

    if (receivers.length > 0) {
      for (const receiver of receivers) {
        const parentMessage = this.messageRepository.create({
          student,
          targetRoles,
          message,
          receiverUser: receiver
        });
        await this.messageRepository.save(parentMessage);
      }
    } else {
      const parentMessage = this.messageRepository.create({
        student,
        targetRoles,
        message
      });
      await this.messageRepository.save(parentMessage);
    }

    return { success: true, message: '메시지가 성공적으로 전송되었습니다.' };
  }

  async readMessage(param: { messageId?: number; notificationKey?: string } | number, email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const messageId = typeof param === 'number' ? param : param?.messageId;
    const notificationKey = typeof param === 'object' ? param?.notificationKey : undefined;

    let readKeys = Array.isArray(user.readNotificationKeys) ? [...user.readNotificationKeys] : [];

    if (notificationKey) {
      if (!readKeys.includes(notificationKey)) readKeys.push(notificationKey);
    }

    if (messageId) {
      const msg = await this.messageRepository.findOne({ where: { id: messageId } });
      if (msg) {
        msg.isRead = true;
        await this.messageRepository.save(msg);
      }
      const mKey = `m_${messageId}`;
      const nKey = `n_${messageId}`;
      const pKey = `p_${messageId}`;
      if (!readKeys.includes(mKey)) readKeys.push(mKey);
      if (!readKeys.includes(nKey)) readKeys.push(nKey);
      if (!readKeys.includes(pKey)) readKeys.push(pKey);
    }

    user.readNotificationKeys = readKeys;
    await this.userRepository.save(user);
    return { success: true };
  }

  async getTodaySchedule(email: string) {
    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('student.schedules', 'schedules')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student) {
      return null;
    }

    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const today = new Date();
    const todayDayStr = days[today.getDay()];
    
    const normalSchedule = student.schedules?.find(s => s.dayOfWeek === todayDayStr);

    let result = {
      isChanged: false,
      dateStr: today.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }),
      address: normalSchedule?.address || student.address || '탑승지 미지정',
      vehicleName: student.assignedVehicle?.busNumber || '차량 미배정',
      teacherName: student.assignedVehicle?.teacherName || '',
      teacherPhone: student.assignedVehicle?.teacherPhone || '',
      timeString: '15시 30분', // 임시 예상 시간
    };

    const tzOffset = today.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, 10);

    const override = await this.overrideRepository.findOne({
      where: { 
        student: { id: student.id },
        startDate: localISOTime,
        overrideType: OverrideType.CHANGE_LOCATION
      }
    });

    if (override) {
      result.isChanged = true;
      result.address = override.newAddress || result.address;
      
      if (override.newVehicleId) {
        const newVehicle = await this.vehicleRepository.findOne({ where: { id: override.newVehicleId } });
        if (newVehicle) {
          result.vehicleName = newVehicle.busNumber;
          result.teacherName = newVehicle.teacherName;
          result.teacherPhone = newVehicle.teacherPhone;
        }
      }
    }

    return result;
  }

  async getMyChild(email: string) {
    let student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('student.academy', 'academy')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student) {
      student = await this.studentRepository.findOne({
        where: { raw: { email } },
        relations: { assignedVehicle: true, academy: true }
      });
    }

    if (!student) return null;

    let rawObj: any = {};
    if (typeof student.raw === 'string') {
      try { rawObj = JSON.parse(student.raw); } catch (e) { rawObj = {}; }
    } else if (student.raw && typeof student.raw === 'object') {
      rawObj = student.raw;
    }

    const allergies = student.allergies || rawObj['알레르기'] || rawObj['알러지'] || '';

    return {
      id: student.id,
      name: student.adminDisplayName || student.name,
      realName: student.name,
      address: student.address,
      boardingLocation: student.boardingLocation || student.address,
      allergies,
      className: rawObj['반명'] || rawObj['반'] || '',
      academyName: student.academy?.name || rawObj['유치원명'] || '',
      vehicleName: student.assignedVehicle?.busNumber || '차량 미배정',
      approvalStatus: student.approvalStatus
    };
  }

  async getMyChildren(email: string) {
    const students = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('student.academy', 'academy')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getMany();

    if (students.length === 0) {
      const fallback = await this.studentRepository.find({
        where: { raw: { email } },
        relations: { assignedVehicle: true, academy: true }
      });
      students.push(...fallback);
    }

    return students.map(s => {
      let rawObj: any = {};
      if (typeof s.raw === 'string') {
        try { rawObj = JSON.parse(s.raw); } catch (e) { rawObj = {}; }
      } else if (s.raw && typeof s.raw === 'object') {
        rawObj = s.raw;
      }
      return {
        id: s.id,
        name: s.adminDisplayName || s.name,
        realName: s.name,
        address: s.address,
        boardingLocation: s.boardingLocation || s.address,
        allergies: s.allergies || rawObj['알레르기'] || '',
        className: s.className || rawObj['반명'] || rawObj['반'] || '',
        academyName: s.academy?.name || rawObj['유치원명'] || '',
        vehicleName: s.assignedVehicle?.busNumber || '차량 미배정',
        approvalStatus: s.approvalStatus,
      };
    });
  }

  async updateChildAllergies(email: string, allergies: string) {
    let student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student) {
      student = await this.studentRepository.findOne({
        where: { raw: { email } }
      });
    }

    if (!student) {
      throw new BadRequestException('연결된 원아 정보를 찾을 수 없습니다.');
    }

    student.allergies = (allergies || '').trim();

    let rawObj: any = student.raw;
    if (typeof rawObj === 'string') {
      try { rawObj = JSON.parse(rawObj); } catch (e) { rawObj = {}; }
    }
    if (!rawObj || typeof rawObj !== 'object') rawObj = {};
    rawObj['알레르기'] = student.allergies;
    student.raw = rawObj;

    await this.studentRepository.save(student);

    return {
      success: true,
      studentId: student.id,
      allergies: student.allergies
    };
  }

  async getProfile(email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    let child = await this.getMyChild(email);

    return {
      email: user.email,
      name: user.name || (child ? child.name : ''),
      phone: user.phone || '',
      role: user.role,
      childName: child?.name || null,
      academyName: child?.academyName || null
    };
  }

  async updatePhone(email: string, phone: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');
    const cleanedPhone = (phone || '').trim();
    if (!cleanedPhone) throw new BadRequestException('전화번호를 입력해주세요.');

    user.phone = cleanedPhone;
    await this.userRepository.save(user);

    // 자녀 정보에도 보호자 연락처 동기화
    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .where('parentUser.email = :email', { email })
      .getOne();

    if (student) {
      let rawObj: any = student.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch (e) { rawObj = {}; }
      }
      if (!rawObj || typeof rawObj !== 'object') rawObj = {};
      rawObj['부모연락처'] = cleanedPhone;
      rawObj['보호자연락처'] = cleanedPhone;
      student.raw = rawObj;
      await this.studentRepository.save(student);
    }

    return { success: true, phone: cleanedPhone, message: '전화번호가 성공적으로 변경되었습니다.' };
  }

  async changePassword(email: string, currentPass: string, newPass: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    if (!currentPass || !newPass) {
      throw new BadRequestException('현재 비밀번호와 새 비밀번호를 모두 입력해주세요.');
    }

    const isMatch = await bcrypt.compare(currentPass, user.passwordHash);
    if (!isMatch) {
      throw new BadRequestException('현재 비밀번호가 일치하지 않습니다.');
    }

    if (newPass.length < 6) {
      throw new BadRequestException('새 비밀번호는 최소 6자 이상이어야 합니다.');
    }

    user.passwordHash = await bcrypt.hash(newPass, 10);
    await this.userRepository.save(user);

    return { success: true, message: '비밀번호가 성공적으로 변경되었습니다.' };
  }

  async getClassBoard(email: string, postType?: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) return [];

    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.academy', 'academy')
      .where('parentUser.id = :uid OR studentUser.id = :uid OR parentUser.email = :email OR studentUser.email = :email', { uid: user.id, email })
      .getOne();

    if (!student) return [];

    const academyId = student.academy?.id || user.academyId;
    if (!academyId) return [];

    const className = getStudentClassName(student);

    const qb = this.boardPostRepository.createQueryBuilder('post')
      .leftJoinAndSelect('post.comments', 'comment')
      .where('post.academyId = :aid', { aid: academyId });

    if (className) {
      qb.andWhere('(post.visibility = :vAll OR post.targetClass = :tc OR post.className = :tc)', { vAll: 'ALL', tc: className });
    } else {
      qb.andWhere('post.visibility = :vAll', { vAll: 'ALL' });
    }

    if (postType && postType !== 'ALL') {
      qb.andWhere('post.postType = :postType', { postType });
    }

    qb.orderBy('post.createdAt', 'DESC')
      .addOrderBy('comment.createdAt', 'ASC');

    const posts = await qb.getMany();

    const authorUserIds = posts.map(p => p.authorUserId).filter(Boolean);
    const roleMap = new Map<number, string>();
    if (authorUserIds.length > 0) {
      const authorUsers = await this.userRepository.find({ where: { id: In(authorUserIds) } });
      for (const u of authorUsers) {
        roleMap.set(u.id, u.role);
      }
    }

    return Promise.all(posts.map(async p => {
      const resolvedImageUrl = await resolveMediaRef(p.imageUrl);
      const resolvedImages = await resolveMediaRefs(p.images);
      const effectiveRole = (p.authorUserId && roleMap.get(p.authorUserId)) || p.authorRole;
      return {
        id: p.id,
        title: p.title,
        content: p.content,
        postType: p.postType || 'POST',
        imageUrl: resolvedImageUrl,
        images: resolvedImages,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        authorName: p.authorName,
        authorRole: effectiveRole,
        targetClass: p.targetClass,
        className: p.className || p.targetClass,
        likeCount: p.likeCount || 0,
        likedUserIds: p.likedUserIds || [],
        commentCount: p.comments?.length || 0,
        comments: p.comments || [],
      };
    }));
  }
}
