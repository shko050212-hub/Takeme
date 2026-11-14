import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import {
  ApprovalRequest,
  ApprovalStatus,
  ChangeRequestType,
  RequestDirection,
} from '../entities/approval-request.entity';
import { Student } from '../entities/student.entity';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { PickupPoint } from '../entities/pickup-point.entity';
import { User, UserRole } from '../entities/user.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Academy } from '../entities/academy.entity';
import { Notification } from '../entities/notification.entity';
import { AcademyHoliday, CalendarEventType } from '../entities/academy-holiday.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { LocationGateway } from '../teacher/location.gateway';
import { ChatService } from '../chat/chat.service';
import {
  getStudentClassName,
  isSameClass,
  kstDateString,
  isValidDateString,
} from '../utils/school.util';
import { isNotificationEnabled } from '../utils/notification.util';

function typeToKorean(type: ChangeRequestType | string): string {
  switch (type) {
    case ChangeRequestType.ABSENCE:
      return '결석';
    case ChangeRequestType.LATENESS:
      return '지각';
    case ChangeRequestType.INDIVIDUAL_DISMISSAL:
      return '개별 하원';
    case ChangeRequestType.PICKUP:
      return '학부모 직접 픽업';
    case ChangeRequestType.NO_SHUTTLE:
      return '셔틀 미이용';
    case ChangeRequestType.ONE_TIME_BOARDING:
      return '일회성 탑승';
    case ChangeRequestType.CHANGE_LOCATION:
      return '정류장/위치 변경';
    default:
      return '일정 변경';
  }
}

function mapToOverrideType(type: ChangeRequestType | string): OverrideType {
  switch (type) {
    case ChangeRequestType.ABSENCE:
      return OverrideType.ABSENCE;
    case ChangeRequestType.LATENESS:
      return OverrideType.LATENESS;
    case ChangeRequestType.INDIVIDUAL_DISMISSAL:
      return OverrideType.INDIVIDUAL_DISMISSAL;
    case ChangeRequestType.PICKUP:
      return OverrideType.PICKUP;
    case ChangeRequestType.NO_SHUTTLE:
      return OverrideType.NO_SHUTTLE;
    case ChangeRequestType.ONE_TIME_BOARDING:
      return OverrideType.ONE_TIME_BOARDING;
    case ChangeRequestType.CHANGE_LOCATION:
    default:
      return OverrideType.CHANGE_LOCATION;
  }
}

@Injectable()
export class ApprovalService {
  constructor(
    @InjectRepository(ApprovalRequest)
    private readonly approvalRepo: Repository<ApprovalRequest>,
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(ScheduleOverride)
    private readonly overrideRepo: Repository<ScheduleOverride>,
    @InjectRepository(PickupPoint)
    private readonly pickupPointRepo: Repository<PickupPoint>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(Academy)
    private readonly academyRepo: Repository<Academy>,
    @InjectRepository(Notification)
    private readonly notificationRepo: Repository<Notification>,
    @InjectRepository(AcademyHoliday)
    private readonly holidayRepo: Repository<AcademyHoliday>,
    @InjectRepository(StudentSchedule)
    private readonly scheduleRepo: Repository<StudentSchedule>,
    @Inject(forwardRef(() => LocationGateway))
    private readonly locationGateway: LocationGateway,
    @Inject(forwardRef(() => ChatService))
    @Optional()
    private readonly chatService?: ChatService,
  ) {}

  private static systemNotificationHandler: ((
    academyId: number | null,
    category: 'ABSENT' | 'SHUTTLE_REQUEST' | 'PICKUP' | 'PAYMENT_REQUEST' | 'PAYMENT_DECISION' | 'GENERAL',
    title: string,
    content: string,
    extra?: any,
  ) => Promise<any>) | null = null;

  public static registerSystemNotificationHandler(handler: any) {
    ApprovalService.systemNotificationHandler = handler;
  }

  private async notifySystemNotification(
    academyId: number | null,
    category: 'ABSENT' | 'SHUTTLE_REQUEST' | 'PICKUP' | 'PAYMENT_REQUEST' | 'PAYMENT_DECISION' | 'GENERAL',
    title: string,
    content: string,
    extra?: any,
  ) {
    if (ApprovalService.systemNotificationHandler) {
      try {
        await ApprovalService.systemNotificationHandler(academyId, category, title, content, extra);
      } catch (err) {
        console.error('[ApprovalService] System notification error:', err);
      }
    }
  }

  /**
   * 차량의 특정 날짜 승차 예정 인원 계산
   */
  async getVehiclePassengerCount(vehicleId: number, targetDate: string): Promise<number> {
    const dateObj = new Date(targetDate + 'T00:00:00Z');
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const dayOfWeek = days[dateObj.getUTCDay()];

    // 1. 해당 차량에 배정된 기본 스케줄 원아 수 (해당 요일)
    const baseCount = await this.scheduleRepo.count({
      where: {
        assignedVehicle: { id: vehicleId },
        dayOfWeek,
      },
    });

    // 2. 해당 날짜 승인된 결석 수 (제외)
    const absenceCount = await this.overrideRepo.count({
      where: {
        startDate: LessThanOrEqual(targetDate),
        endDate: MoreThanOrEqual(targetDate),
        overrideType: OverrideType.ABSENCE,
        student: { assignedVehicle: { id: vehicleId } },
      },
    });

    // 3. 해당 날짜 해당 차량으로 승인된 일회성 탑승/위치변경 수 (추가)
    const additionalCount = await this.overrideRepo.count({
      where: {
        startDate: LessThanOrEqual(targetDate),
        endDate: MoreThanOrEqual(targetDate),
        newVehicleId: vehicleId,
      },
    });

    return Math.max(0, baseCount - absenceCount + additionalCount);
  }

  /**
   * 동일 기관 내 다른 여유 차량 후보 목록 조회 (정원 초과 시 추천용)
   */
  async getVehicleCapacityCandidates(academyId: number, targetDate: string, excludeVehicleId?: number) {
    const vehicles = await this.vehicleRepo.find({
      where: { academy: { id: academyId } },
      order: { busNumber: 'ASC' },
    });

    const candidates: Array<{
      vehicleId: number;
      busNumber: string;
      plateNumber: string | null;
      capacity: number;
      currentCount: number;
      availableSeats: number;
    }> = [];

    for (const v of vehicles) {
      if (excludeVehicleId && v.id === excludeVehicleId) continue;
      const count = await this.getVehiclePassengerCount(v.id, targetDate);
      const capacity = v.capacity || 25;
      const availableSeats = Math.max(0, capacity - count);
      candidates.push({
        vehicleId: v.id,
        busNumber: v.busNumber,
        plateNumber: v.plateNumber || null,
        capacity,
        currentCount: count,
        availableSeats,
      });
    }

    return candidates.sort((a, b) => b.availableSeats - a.availableSeats);
  }

  /**
   * 통학 변경 신청 생성 (학부모, 담임, 데스크, 관리자)
   */
  async createRequest(callingUser: User, data: {
    studentId: number;
    type: ChangeRequestType;
    targetDate?: string;
    targetTime?: string;
    direction?: string;
    reason?: string;
    newAddress?: string;
    newLatitude?: number;
    newLongitude?: number;
    targetVehicleId?: number;
    message?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  }) {
    const student = await this.studentRepo.findOne({
      where: { id: data.studentId },
      relations: { academy: true, parentUser: true, assignedVehicle: true },
    });
    if (!student) throw new NotFoundException('원아를 찾을 수 없습니다.');

    const academyId = student.academy?.id || callingUser.academyId;
    if (!academyId) throw new BadRequestException('기관 정보가 누락되었습니다.');

    // 권한 검증
    if (callingUser.role === UserRole.PARENT) {
      const isParent = student.parentUser?.id === callingUser.id || student.parentUser?.email === callingUser.email;
      if (!isParent) {
        throw new ForbiddenException('본인의 자녀에 대해서만 통학 변경을 신청할 수 있습니다.');
      }
    } else if (callingUser.role === UserRole.HOMEROOM_TEACHER) {
      const studentClass = getStudentClassName(student);
      if (!isSameClass(studentClass, callingUser.assignedClass)) {
        throw new ForbiddenException('본인 담당 반 원아에 대해서만 신청할 수 있습니다.');
      }
    }

    const targetDate = data.targetDate && isValidDateString(data.targetDate) ? data.targetDate : kstDateString();
    const type = data.type || ChangeRequestType.CHANGE_LOCATION;
    const direction = data.direction || RequestDirection.ALL;
    const reason = (data.reason || data.message || '').trim();

    const newAddress = data.newAddress || data.address || undefined;
    const newLatitude = data.newLatitude ?? data.latitude ?? undefined;
    const newLongitude = data.newLongitude ?? data.longitude ?? undefined;

    let targetVehicle: Vehicle | null = null;
    let isCapacityExceeded = false;
    let candidateVehicles: any[] = [];

    // 일회성 탑승 또는 차량 변경인 경우 정원 검사
    const targetVehicleId = data.targetVehicleId || (type === ChangeRequestType.ONE_TIME_BOARDING ? student.assignedVehicle?.id : undefined);
    if (targetVehicleId) {
      targetVehicle = await this.vehicleRepo.findOne({ where: { id: targetVehicleId } });
      if (targetVehicle) {
        const currentCount = await this.getVehiclePassengerCount(targetVehicle.id, targetDate);
        const capacity = targetVehicle.capacity || 25;
        if (currentCount >= capacity) {
          isCapacityExceeded = true;
          candidateVehicles = await this.getVehicleCapacityCandidates(academyId, targetDate, targetVehicle.id);
        }
      }
    }

    const academy = await this.academyRepo.findOne({ where: { id: academyId } });

    const req = this.approvalRepo.create({
      type,
      requester: callingUser,
      requesterRole: callingUser.role,
      student,
      targetDate,
      targetTime: data.targetTime || undefined,
      direction,
      reason,
      status: ApprovalStatus.PENDING,
      newAddress,
      newLatitude,
      newLongitude,
      address: newAddress,
      latitude: newLatitude,
      longitude: newLongitude,
      targetVehicle: targetVehicle || undefined,
      isCapacityExceeded,
      academy: academy || undefined,
      startDate: targetDate,
      endDate: targetDate,
    });

    const saved = await this.approvalRepo.save(req);

    // 기관 관리자 및 데스크 직원 알림 생성
    const typeKr = typeToKorean(type);
    const noti = this.notificationRepo.create({
      recipient: undefined,
      recipientRole: 'ACADEMY_ADMIN',
      type: 'APPROVAL_REQUEST',
      approvalRequest: saved,
      academy: academy || undefined,
      message: `[신규 신청] ${student.adminDisplayName || student.name} 원아의 ${typeKr} 신청이 접수되었습니다. (적용일: ${targetDate})`,
    });
    await this.notificationRepo.save(noti);

    const notiCategory = type === ChangeRequestType.ABSENCE ? 'ABSENT' : type === ChangeRequestType.ONE_TIME_BOARDING ? 'SHUTTLE_REQUEST' : type === ChangeRequestType.PICKUP || type === ChangeRequestType.INDIVIDUAL_DISMISSAL ? 'PICKUP' : 'GENERAL';
    this.notifySystemNotification(
      academyId,
      notiCategory as any,
      `[신청 접수] ${student.adminDisplayName || student.name} ${typeKr} 신청`,
      `${student.adminDisplayName || student.name} 원아의 ${typeKr} 신청이 접수되었습니다. (적용일: ${targetDate})`,
      { approvalRequestId: saved.id, studentId: student.id, type, targetDate }
    );

    // 소켓 브로드캐스트 (해당 유치원 관리자 방)
    if (this.locationGateway) {
      this.locationGateway.broadcastChangeRequestCreated(academyId, {
        id: saved.id,
        type: saved.type,
        typeKr,
        studentName: student.adminDisplayName || student.name,
        targetDate,
        isCapacityExceeded,
        candidateVehicles,
      });
    }

    if (this.chatService && academyId) {
      const studentClass = getStudentClassName(student) || undefined;
      const whereConditions: any[] = [{ academy: { id: academyId }, role: UserRole.ACADEMY_ADMIN }];
      if (studentClass) {
        whereConditions.push({ academy: { id: academyId }, assignedClass: studentClass, role: UserRole.HOMEROOM_TEACHER });
      }
      this.userRepo.find({
        where: whereConditions,
      }).then((users) => {
        const ids = users.map((u) => u.id);
        if (ids.length > 0) {
          this.chatService?.sendSystemNotificationToUsers(
            ids,
            '통학 변동 신청 접수',
            `[신규 신청] ${student.adminDisplayName || student.name} 원아의 ${typeKr} 신청이 접수되었습니다. (적용일: ${targetDate})`,
            { type: 'change_request' }
          ).catch(() => {});
        }
      }).catch(() => {});
    }

    return {
      success: true,
      message: `${typeKr} 신청이 성공적으로 접수되었습니다. 기관 관리자의 승인 후 최종 반영됩니다.`,
      request: saved,
      candidateVehicles,
    };
  }

  /**
   * 내가 신청한 통학 변경 목록 (학부모, 담임, 본인 신청 건)
   */
  async getMyRequests(callingUser: User) {
    const qb = this.approvalRepo.createQueryBuilder('req')
      .leftJoinAndSelect('req.student', 'student')
      .leftJoinAndSelect('req.requester', 'requester')
      .leftJoinAndSelect('req.targetVehicle', 'targetVehicle')
      .leftJoinAndSelect('req.processedBy', 'processedBy')
      .orderBy('req.createdAt', 'DESC');

    if (callingUser.role === UserRole.PARENT) {
      qb.where('(req.requesterId = :uid OR student.parentUserId = :uid)', { uid: callingUser.id });
    } else if (callingUser.role === UserRole.HOMEROOM_TEACHER && callingUser.assignedClass) {
      qb.where('req.requesterId = :uid', { uid: callingUser.id });
    } else {
      qb.where('req.requesterId = :uid', { uid: callingUser.id });
    }

    const list = await qb.getMany();
    return list.map(r => ({
      ...r,
      typeKr: typeToKorean(r.type),
      studentName: r.student?.adminDisplayName || r.student?.name,
    }));
  }

  /**
   * 담임교사용: 자기 반 학생들의 오늘 통학 변경 현황
   */
  async getClassTodayRequests(callingUser: User) {
    const today = kstDateString();
    const assignedClass = callingUser.assignedClass;

    const qb = this.approvalRepo.createQueryBuilder('req')
      .leftJoinAndSelect('req.student', 'student')
      .leftJoinAndSelect('req.requester', 'requester')
      .leftJoinAndSelect('req.targetVehicle', 'targetVehicle')
      .where('req.targetDate = :today', { today })
      .orderBy('req.createdAt', 'DESC');

    const allRequests = await qb.getMany();

    // 담당 반 필터링
    const classRequests = allRequests.filter(r => {
      if (!assignedClass) return true;
      const sClass = getStudentClassName(r.student);
      return isSameClass(sClass, assignedClass);
    });

    const summary = {
      total: classRequests.length,
      approved: classRequests.filter(r => r.status === ApprovalStatus.APPROVED).length,
      pending: classRequests.filter(r => r.status === ApprovalStatus.PENDING).length,
      rejected: classRequests.filter(r => r.status === ApprovalStatus.REJECTED).length,
      absence: classRequests.filter(r => r.type === ChangeRequestType.ABSENCE).length,
      individualDismissal: classRequests.filter(r => r.type === ChangeRequestType.INDIVIDUAL_DISMISSAL).length,
      lateness: classRequests.filter(r => r.type === ChangeRequestType.LATENESS).length,
      pickup: classRequests.filter(r => r.type === ChangeRequestType.PICKUP).length,
      noShuttle: classRequests.filter(r => r.type === ChangeRequestType.NO_SHUTTLE).length,
      oneTimeBoarding: classRequests.filter(r => r.type === ChangeRequestType.ONE_TIME_BOARDING).length,
    };

    return {
      today,
      assignedClass: assignedClass || '전체',
      summary,
      requests: classRequests.map(r => ({
        ...r,
        typeKr: typeToKorean(r.type),
        studentName: r.student?.adminDisplayName || r.student?.name,
      })),
    };
  }

  /**
   * 관리자 신청함 목록 (대기 우선, 정원 초과 시 대체 후보 포함)
   */
  async getAdminRequests(callingUser: User, statusFilter?: ApprovalStatus) {
    const allowed = [UserRole.ACADEMY_ADMIN, UserRole.SUPER_ADMIN, UserRole.DESK_STAFF];
    if (!allowed.includes(callingUser.role as UserRole)) {
      throw new ForbiddenException('기관 관리자 또는 데스크 직원만 신청함을 조회할 수 있습니다.');
    }

    const academyId = callingUser.academyId;
    const qb = this.approvalRepo.createQueryBuilder('req')
      .leftJoinAndSelect('req.student', 'student')
      .leftJoinAndSelect('student.assignedVehicle', 'assignedVehicle')
      .leftJoinAndSelect('req.requester', 'requester')
      .leftJoinAndSelect('req.targetVehicle', 'targetVehicle')
      .leftJoinAndSelect('req.processedBy', 'processedBy');

    if (callingUser.role !== UserRole.SUPER_ADMIN && academyId) {
      qb.where('(req.academyId = :academyId OR student.academyId = :academyId)', { academyId });
    }

    if (statusFilter) {
      qb.andWhere('req.status = :st', { st: statusFilter });
    }

    qb.orderBy(`CASE WHEN req.status = '${ApprovalStatus.PENDING}' THEN 0 ELSE 1 END`, 'ASC')
      .addOrderBy('req.createdAt', 'DESC');

    const list = await qb.getMany();

    const result = [];
    for (const r of list) {
      let candidates: any[] = [];
      if (r.status === ApprovalStatus.PENDING && (r.isCapacityExceeded || r.targetVehicle)) {
        const vId = r.targetVehicle?.id || r.student?.assignedVehicle?.id;
        const targetDate = r.targetDate || kstDateString();
        const aId = r.academy?.id || academyId || 0;
        if (aId > 0) {
          candidates = await this.getVehicleCapacityCandidates(aId, targetDate, vId);
        }
      }

      result.push({
        ...r,
        typeKr: typeToKorean(r.type),
        studentName: r.student?.adminDisplayName || r.student?.name,
        studentClass: r.student ? getStudentClassName(r.student) : '',
        candidateVehicles: candidates,
      });
    }

    return result;
  }

  /**
   * 승인 또는 반려 처리 (관리자/데스크 전용)
   */
  async decideRequest(
    callingUser: User,
    requestId: number,
    decision: ApprovalStatus,
    rejectionReason?: string,
  ) {
    const allowed = [UserRole.ACADEMY_ADMIN, UserRole.SUPER_ADMIN, UserRole.DESK_STAFF];
    if (!allowed.includes(callingUser.role as UserRole)) {
      throw new ForbiddenException('기관 관리자 또는 데스크 직원만 신청을 처리할 수 있습니다.');
    }

    const req = await this.approvalRepo.findOne({
      where: { id: requestId },
      relations: {
        student: { academy: true, parentUser: true, assignedVehicle: true },
        targetVehicle: true,
        requester: true,
        academy: true,
      },
    });

    if (!req) throw new NotFoundException('신청 정보를 찾을 수 없습니다.');

    if (req.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('이미 처리된 신청입니다.');
    }

    if (decision === ApprovalStatus.REJECTED && (!rejectionReason || !rejectionReason.trim())) {
      throw new BadRequestException('반려 시에는 반려 사유를 반드시 입력해야 합니다.');
    }

    const targetDate = req.targetDate || req.startDate || kstDateString();
    const student = req.student;
    const academyId = req.academy?.id || student?.academy?.id || callingUser.academyId;

    req.status = decision;
    req.processedBy = callingUser;
    req.processedAt = new Date();
    if (decision === ApprovalStatus.REJECTED) {
      req.rejectionReason = rejectionReason!.trim();
    }
    await this.approvalRepo.save(req);

    // 승인인 경우 ScheduleOverride 및 당일 명단 반영
    if (decision === ApprovalStatus.APPROVED) {
      const overrideType = mapToOverrideType(req.type);

      const override = this.overrideRepo.create({
        student,
        startDate: targetDate,
        endDate: targetDate,
        overrideType,
        direction: req.direction || RequestDirection.ALL,
        targetTime: req.targetTime || undefined,
        reason: req.reason || undefined,
        newAddress: req.newAddress || req.address || undefined,
        latitude: req.newLatitude ?? req.latitude ?? undefined,
        longitude: req.newLongitude ?? req.longitude ?? undefined,
        newVehicleId: req.targetVehicle?.id || undefined,
        approvalRequest: req,
      });
      await this.overrideRepo.save(override);

      // 당일 결석이면 student boardStatus 즉시 갱신
      if (req.type === ChangeRequestType.ABSENCE && targetDate === kstDateString()) {
        student.boardStatus = 'ABSENT';
        await this.studentRepo.save(student);
      }

      // 주소/정류장 영구 변경 요청이고 단일일자 지정이 아닌 경우 기본 주소 반영
      if (req.type === ChangeRequestType.CHANGE_LOCATION && req.newAddress) {
        student.boardingLocation = req.newAddress;
        if (req.newLatitude && req.newLongitude) {
          student.latitude = req.newLatitude;
          student.longitude = req.newLongitude;
        }
        await this.studentRepo.save(student);

        // 픽업 포인트 등록
        const existingPt = await this.pickupPointRepo.findOne({ where: { name: req.newAddress } });
        if (!existingPt && req.newLatitude && req.newLongitude) {
          const pt = this.pickupPointRepo.create({
            name: req.newAddress,
            latitude: req.newLatitude,
            longitude: req.newLongitude,
          });
          await this.pickupPointRepo.save(pt);
        }
      }
    }

    // 알림 생성
    const typeKr = typeToKorean(req.type);
    const decisionKr = decision === ApprovalStatus.APPROVED ? '승인' : '반려';
    const message = `[신청 ${decisionKr}] ${student.adminDisplayName || student.name} 원아의 ${typeKr} 신청이 ${decisionKr}되었습니다.${decision === ApprovalStatus.REJECTED ? ` (사유: ${rejectionReason})` : ''}`;

    // 1. 신청 학부모에게 알림 (설정 확인)
    const parentUser = student.parentUser || req.requester;
    if (parentUser && isNotificationEnabled(parentUser, 'change_request')) {
      const noti = this.notificationRepo.create({
        recipient: parentUser,
        recipientRole: 'PARENT',
        type: 'APPROVAL_RESULT',
        approvalRequest: req,
        message,
      });
      await this.notificationRepo.save(noti);

      if (this.chatService) {
        this.chatService.sendSystemNotificationToUser(
          parentUser.id,
          `통학 변동 신청 ${decisionKr}`,
          message,
          { type: 'change_request' }
        ).catch(() => {});
      }
    }

    // 2. 차량 기사 및 지도교사 알림 (승인인 경우, 기사 알림 수신 설정 확인)
    const affectedVehicle = req.targetVehicle || student.assignedVehicle;
    if (decision === ApprovalStatus.APPROVED && affectedVehicle) {
      const driver = affectedVehicle.driverUser;
      if (!driver || isNotificationEnabled(driver, 'change_request')) {
        const vNoti = this.notificationRepo.create({
          vehicle: affectedVehicle,
          type: 'SCHEDULE_CHANGE',
          approvalRequest: req,
          message: `[운행 변동] ${student.adminDisplayName || student.name} (${targetDate} ${typeKr})`,
        });
        await this.notificationRepo.save(vNoti);

        if (this.chatService && driver) {
          this.chatService.sendSystemNotificationToUser(
            driver.id,
            '운행 변동 안내',
            `[운행 변동] ${student.adminDisplayName || student.name} (${targetDate} ${typeKr})`,
            { type: 'change_request' }
          ).catch(() => {});
        }
      }
    }

    this.notifySystemNotification(
      academyId,
      'PAYMENT_DECISION',
      `[결재 ${decisionKr}] ${student.adminDisplayName || student.name} ${typeKr} ${decisionKr}`,
      `${student.adminDisplayName || student.name} 원아의 ${typeKr} 신청이 최종 ${decisionKr}되었습니다.${decision === ApprovalStatus.REJECTED ? ` (사유: ${rejectionReason})` : ''}`,
      { approvalRequestId: req.id, studentId: student.id, decision, type: req.type }
    );

    // 소켓 브로드캐스트
    if (this.locationGateway && academyId) {
      this.locationGateway.broadcastChangeRequestDecided({
        academyId,
        vehicleId: affectedVehicle?.id,
        parentUserId: parentUser?.id,
        request: {
          id: req.id,
          decision,
          typeKr,
          studentName: student.adminDisplayName || student.name,
          targetDate,
        },
      });
    }

    return {
      success: true,
      message: `신청이 ${decisionKr} 처리되었습니다.`,
      request: req,
    };
  }

  /**
   * 통합 캘린더 조회 (휴업·방학·행사 + 승인된 변경 내역)
   */
  async getCalendar(
    callingUser: User,
    query: {
      year?: string;
      month?: string;
      date?: string;
      className?: string;
      vehicleId?: string;
      studentId?: string;
      search?: string;
      mode?: string;
    },
  ) {
    const academyId = callingUser.academyId;
    const todayStr = kstDateString();

    const now = new Date();
    const year = query.year ? parseInt(query.year, 10) : now.getFullYear();
    const month = query.month ? parseInt(query.month, 10) : now.getMonth() + 1;

    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // 1. 기관/반 휴업 및 행사 조회
    const holidayQb = this.holidayRepo.createQueryBuilder('h')
      .where('h.startDate <= :endDate AND h.endDate >= :startDate', { startDate, endDate });

    if (callingUser.role !== UserRole.SUPER_ADMIN && academyId) {
      holidayQb.andWhere('(h.academyId = :academyId OR h.academyId IS NULL)', { academyId });
    }

    // 역할별 열람 범위 차등화:
    // 학부모: 기관 전체 + 자녀 반 행사만
    // 지도교사: 기관 전체 + 담당 반(있다면) 행사만
    // 담임교사: 기관 전체 + 자기 반 행사만
    // 원장/관리자: 모든 일정 반 구분 없이 전체 열람 (특정 반 선택 시 필터링)
    if (callingUser.role === UserRole.PARENT) {
      const whereConditions: any[] = [
        { parentUser: { id: callingUser.id } },
        { studentUser: { id: callingUser.id } },
      ];
      if (callingUser.phone) {
        whereConditions.push({ phone: callingUser.phone });
      }
      const parentStudents = await this.studentRepo.find({ where: whereConditions });
      const childClasses = Array.from(new Set(parentStudents.map(s => s.className).filter(Boolean)));
      if (childClasses.length > 0) {
        holidayQb.andWhere('(h.targetClass IS NULL OR h.targetClass IN (:...childClasses))', { childClasses });
      } else {
        holidayQb.andWhere('h.targetClass IS NULL');
      }
    } else if (callingUser.role === UserRole.HOMEROOM_TEACHER && callingUser.assignedClass) {
      holidayQb.andWhere('(h.targetClass IS NULL OR h.targetClass = :myClass)', { myClass: callingUser.assignedClass });
    } else if (callingUser.role === UserRole.TEACHER || callingUser.role === UserRole.SHUTTLE_TEACHER) {
      if (callingUser.assignedClass) {
        holidayQb.andWhere('(h.targetClass IS NULL OR h.targetClass = :myClass)', { myClass: callingUser.assignedClass });
      } else {
        holidayQb.andWhere('h.targetClass IS NULL');
      }
    } else if (query.className && query.className !== 'ALL') {
      holidayQb.andWhere('(h.targetClass IS NULL OR h.targetClass = :cName)', { cName: query.className });
    }

    const holidays = await holidayQb.getMany();

    // 2. 승인된 변경 내역 조회 (ScheduleOverride)
    const overrideQb = this.overrideRepo.createQueryBuilder('o')
      .leftJoinAndSelect('o.student', 'student')
      .leftJoinAndSelect('student.assignedVehicle', 'assignedVehicle')
      .where('o.startDate <= :endDate AND o.endDate >= :startDate', { startDate, endDate });

    if (callingUser.role !== UserRole.SUPER_ADMIN && academyId) {
      overrideQb.andWhere('student.academyId = :academyId', { academyId });
    }

    // 역할별 범위 제한:
    // 학부모: 자녀 관련 결석/변동만
    // 담임교사: 담당 반 학생들만
    // 지도교사/기사: 담당 차량 또는 담당 학생들만
    // 원장/관리자: 전체 학생 (반별 필터 선택 시 해당 반만)
    if (callingUser.role === UserRole.PARENT) {
      overrideQb.andWhere('(student.parentUserId = :uid OR student.studentUserId = :uid OR student.phone = :uphone)', {
        uid: callingUser.id,
        uphone: callingUser.phone || '',
      });
    } else if (callingUser.role === UserRole.HOMEROOM_TEACHER && callingUser.assignedClass) {
      overrideQb.andWhere('student.className = :myClass', { myClass: callingUser.assignedClass });
    } else if (callingUser.role === UserRole.DRIVER || callingUser.role === UserRole.SHUTTLE_TEACHER) {
      const vehicle = await this.vehicleRepo.findOne({
        where: callingUser.role === UserRole.DRIVER ? { driverUser: { id: callingUser.id } } : { teacherUser: { id: callingUser.id } },
      });
      if (vehicle) {
        overrideQb.andWhere('(student.assignedVehicleId = :vid OR o.newVehicleId = :vid)', { vid: vehicle.id });
      }
    } else if (query.className && query.className !== 'ALL') {
      overrideQb.andWhere('student.className = :cName', { cName: query.className });
    }

    // 원장 결석/변동 학생 검색 기능
    if (query.search && query.search.trim()) {
      const sTerm = `%${query.search.trim()}%`;
      overrideQb.andWhere(
        '(student.name LIKE :sTerm OR student.adminDisplayName LIKE :sTerm OR student.phone LIKE :sTerm OR student.className LIKE :sTerm OR o.reason LIKE :sTerm)',
        { sTerm }
      );
    }

    if (query.vehicleId) {
      overrideQb.andWhere('(student.assignedVehicleId = :vId OR o.newVehicleId = :vId)', { vId: parseInt(query.vehicleId, 10) });
    }
    if (query.studentId) {
      overrideQb.andWhere('student.id = :sId', { sId: parseInt(query.studentId, 10) });
    }

    const overrides = await overrideQb.getMany();

    // 개인정보 보호: 관리자, 담당 담임교사 외에는 전화번호/생년월일 마스킹
    const canViewSensitive =
      callingUser.role === UserRole.ACADEMY_ADMIN ||
      callingUser.role === UserRole.SUPER_ADMIN ||
      callingUser.role === UserRole.DESK_STAFF;

    const formattedOverrides = overrides.map(o => {
      const student = o.student;
      const isMyHomeroom = callingUser.role === UserRole.HOMEROOM_TEACHER && isSameClass(student.className, callingUser.assignedClass);
      const allowSensitive = canViewSensitive || isMyHomeroom;

      return {
        id: o.id,
        startDate: o.startDate,
        endDate: o.endDate,
        overrideType: o.overrideType,
        direction: o.direction,
        targetTime: o.targetTime,
        reason: o.reason,
        newAddress: o.newAddress,
        newVehicleId: o.newVehicleId,
        student: {
          id: student.id,
          name: student.adminDisplayName || student.name,
          className: student.className || getStudentClassName(student),
          assignedVehicle: student.assignedVehicle?.busNumber || null,
          phone: allowSensitive ? student.phone : null,
          birthDate: allowSensitive ? student.birthDate : null,
        },
      };
    });

    // 3. 통계 카운트 계산
    let pendingCount = 0;
    let todayNewCount = 0;
    let monthApprovedCount = overrides.length;

    if (canViewSensitive && academyId) {
      pendingCount = await this.approvalRepo.count({
        where: { academy: { id: academyId }, status: ApprovalStatus.PENDING },
      });
      todayNewCount = await this.approvalRepo.count({
        where: {
          academy: { id: academyId },
          createdAt: Between(new Date(todayStr + 'T00:00:00Z'), new Date(todayStr + 'T23:59:59Z')),
        },
      });
    }

    return {
      year,
      month,
      summary: {
        pendingCount,
        todayNewCount,
        monthApprovedCount,
      },
      holidays: holidays.map(h => ({
        id: h.id,
        type: h.type,
        title: h.title || h.reason || '일정',
        startDate: h.startDate,
        endDate: h.endDate,
        targetClass: h.targetClass,
        reason: h.reason,
      })),
      scheduleChanges: formattedOverrides,
    };
  }

  /**
   * 캘린더 일정/휴업 추가
   * 역할별 등록 권한:
   * - 원장/관리자: 학원/유치원 행사, 휴업일, 방학 등 전체 및 모든 반 일정 등록
   * - 담임교사: 학원/유치원 행사 일정, 휴업일, 담당 반 행사 일정 등록
   * - 교사(지도교사): 반 행사 일정 등록
   */
  async createCalendarEvent(callingUser: User, data: {
    type: CalendarEventType;
    title: string;
    startDate: string;
    endDate: string;
    targetClass?: string;
    reason?: string;
  }) {
    const isAdmin = [UserRole.ACADEMY_ADMIN, UserRole.SUPER_ADMIN, UserRole.DESK_STAFF].includes(callingUser.role as UserRole);
    const isHomeroom = callingUser.role === UserRole.HOMEROOM_TEACHER;
    const isTeacher = callingUser.role === UserRole.TEACHER || callingUser.role === UserRole.SHUTTLE_TEACHER;

    if (!isAdmin && !isHomeroom && !isTeacher) {
      throw new ForbiddenException('일정을 등록할 권한이 없습니다.');
    }

    if (isTeacher && !isAdmin && !isHomeroom) {
      if (data.type !== CalendarEventType.EVENT && data.type !== CalendarEventType.CLASS_HOLIDAY) {
        throw new BadRequestException('교사는 반 행사 일정만 등록할 수 있습니다.');
      }
    }

    const academyId = callingUser.academyId;
    const academy = academyId ? await this.academyRepo.findOne({ where: { id: academyId } }) : null;

    const holiday = this.holidayRepo.create({
      type: data.type || CalendarEventType.EVENT,
      title: data.title,
      startDate: data.startDate,
      endDate: data.endDate,
      targetClass: data.targetClass || undefined,
      reason: data.reason || data.title,
      academy: academy || undefined,
    });

    const saved = await this.holidayRepo.save(holiday);

    // 행사/휴업일 등록 시 실시간 알림 채널에 알림 메시지 발송 및 소켓 브로드캐스트
    try {
      const typeLabel =
        saved.type === CalendarEventType.ACADEMY_HOLIDAY || saved.type === CalendarEventType.CLASS_HOLIDAY
          ? '휴업일'
          : saved.type === CalendarEventType.VACATION
          ? '방학'
          : '학원/유치원 행사';
      const targetLabel = saved.targetClass ? `[${saved.targetClass}] ` : '[전체] ';
      const dateText = saved.startDate === saved.endDate ? saved.startDate : `${saved.startDate} ~ ${saved.endDate}`;
      const notiTitle = `${targetLabel}${typeLabel} 일정 등록 안내`;
      const notiContent = `${saved.title} (${dateText})${saved.reason ? ` - ${saved.reason}` : ''}`;

      await this.notifySystemNotification(
        academyId,
        'GENERAL',
        notiTitle,
        notiContent,
        {
          eventId: saved.id,
          type: saved.type,
          title: saved.title,
          startDate: saved.startDate,
          endDate: saved.endDate,
          targetClass: saved.targetClass,
        },
      );
    } catch (notiErr) {
      console.error('[createCalendarEvent] Notification dispatch error:', notiErr);
    }

    return { success: true, event: saved };
  }

  /**
   * 캘린더 일정/휴업 삭제
   */
  async deleteCalendarEvent(callingUser: User, eventId: number) {
    const allowed = [
      UserRole.ACADEMY_ADMIN,
      UserRole.SUPER_ADMIN,
      UserRole.DESK_STAFF,
      UserRole.HOMEROOM_TEACHER,
      UserRole.TEACHER,
    ];
    if (!allowed.includes(callingUser.role as UserRole)) {
      throw new ForbiddenException('일정을 삭제할 수 있는 권한이 없습니다.');
    }

    const event = await this.holidayRepo.findOne({ where: { id: eventId }, relations: { academy: true } });
    if (!event) throw new NotFoundException('일정을 찾을 수 없습니다.');

    if (callingUser.role === UserRole.TEACHER && event.targetClass && event.targetClass !== callingUser.assignedClass) {
      throw new ForbiddenException('담당 반의 일정만 삭제할 수 있습니다.');
    }

    await this.holidayRepo.remove(event);
    return { success: true, message: '일정이 삭제되었습니다.' };
  }

  /**
   * 캘린더 원아 결석 등록 (학부모, 담임교사, 관리자)
   * 학부모=자녀 결석일 설정
   */
  async createCalendarAbsence(callingUser: User, data: {
    studentId: number;
    startDate: string;
    endDate: string;
    reason?: string;
  }) {
    const student = await this.studentRepo.findOne({
      where: { id: data.studentId },
      relations: { assignedVehicle: true, parentUser: true, studentUser: true, academy: true },
    });
    if (!student) throw new NotFoundException('원아 정보를 찾을 수 없습니다.');

    if (callingUser.role === UserRole.PARENT) {
      const isMyChild =
        student.parentUser?.id === callingUser.id ||
        student.studentUser?.id === callingUser.id ||
        (student.phone && student.phone === callingUser.phone);
      if (!isMyChild) {
        throw new ForbiddenException('본인의 자녀에 대해서만 결석을 신청할 수 있습니다.');
      }
    }

    const override = this.overrideRepo.create({
      student,
      startDate: data.startDate,
      endDate: data.endDate,
      overrideType: OverrideType.ABSENCE,
      reason: data.reason || '결석 신청',
    });

    const saved = await this.overrideRepo.save(override);

    try {
      const dateText = data.startDate === data.endDate ? data.startDate : `${data.startDate} ~ ${data.endDate}`;
      const notiTitle = '원아 결석 신청 안내';
      const notiContent = `[결석 신청] ${student.name} (${student.className || '반 미배정'}) - ${dateText}${data.reason ? ` (${data.reason})` : ''}`;

      await this.notifySystemNotification(
        (student.academy?.id || callingUser.academyId || null),
        'ABSENT',
        notiTitle,
        notiContent,
        {
          studentId: student.id,
          studentName: student.name,
          className: student.className,
          startDate: data.startDate,
          endDate: data.endDate,
          reason: data.reason,
        },
      );
    } catch (notiErr) {
      console.error('[createCalendarAbsence] Notification dispatch error:', notiErr);
    }

    return { success: true, override: saved };
  }

  /**
   * 캘린더 원아 결석 취소/삭제
   */
  async deleteCalendarAbsence(callingUser: User, overrideId: number) {
    const override = await this.overrideRepo.findOne({
      where: { id: overrideId },
      relations: { student: { parentUser: true, studentUser: true } },
    });
    if (!override) throw new NotFoundException('결석 내역을 찾을 수 없습니다.');

    if (callingUser.role === UserRole.PARENT) {
      const isMyChild =
        override.student?.parentUser?.id === callingUser.id ||
        override.student?.studentUser?.id === callingUser.id ||
        (override.student?.phone && override.student.phone === callingUser.phone);
      if (!isMyChild) {
        throw new ForbiddenException('본인의 자녀 결석만 취소할 수 있습니다.');
      }
    }

    await this.overrideRepo.remove(override);
    return { success: true, message: '결석 처리가 취소되었습니다.' };
  }

  /**
   * 메신저 결재 요청 생성 브리지 (MessagePanel.jsx 호환)
   */
  async createPaymentRequestFromChat(callingUser: User, data: any) {
    const studentId = data.studentId;
    const req = await this.createRequest(callingUser, {
      studentId,
      type: ChangeRequestType.CHANGE_LOCATION,
      targetDate: data.targetDate || kstDateString(),
      reason: data.reason || data.comment || '메신저 결재 요청',
      newAddress: data.suggestedLocation?.boardingLocation || data.address,
    });
    return { success: true, messageId: req.request.id, request: req.request };
  }

  /**
   * 메신저 결재 결정 브리지
   */
  async decidePaymentRequestFromChat(callingUser: User, id: number, decision: 'APPROVE' | 'REJECT', rejectionReason?: string) {
    const status = decision === 'APPROVE' ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    return this.decideRequest(callingUser, id, status, rejectionReason);
  }
}
