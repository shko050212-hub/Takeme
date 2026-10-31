import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { Notification } from '../entities/notification.entity';
import { Student } from '../entities/student.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { RoutingService } from '../routing/routing.service';
import { User } from '../entities/user.entity';
import { PickupPoint } from '../entities/pickup-point.entity';

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
    private routingService: RoutingService,
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

    await this.scheduleRepository.delete({ student: { id: student.id } });

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
        await this.scheduleRepository.save(schedule);
      }
    }

    return { success: true, studentId: student.id };
  }

  async createOverride(email: string, targetDate: string, overrideType: OverrideType, reason: string) {
    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student) {
      throw new BadRequestException('연결된 원생 정보를 찾을 수 없습니다.');
    }

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

    const override = this.overrideRepository.create({
      student,
      startDate: targetDate,
      endDate: targetDate,
      overrideType,
      reason,
      newAddress,
      latitude,
      longitude,
      newVehicleId
    } as any);

    await this.overrideRepository.save(override);
    this.routingService.notifyRouteUpdated(
      undefined,
      `[일정 변경 알림] ${student.name} 원아의 ${overrideType === OverrideType.ABSENCE ? '결석' : '탑승 위치 변경'} 신청이 접수되었습니다.`,
    );
    return { success: true, message: '성공적으로 신청되었습니다.' };
  }

  async getNotifications(email: string) {
    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student || !student.assignedVehicle) {
      return [];
    }

    return this.notificationRepository.find({
      where: { vehicle: { id: student.assignedVehicle.id } },
      order: { createdAt: 'DESC' },
      take: 20
    });
  }

  async getRoute(email: string) {
    const student = await this.studentRepository.createQueryBuilder('student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .leftJoinAndSelect('student.studentUser', 'studentUser')
      .leftJoinAndSelect('student.assignedVehicle', 'vehicle')
      .leftJoinAndSelect('student.academy', 'academy')
      .where('parentUser.email = :email OR studentUser.email = :email', { email })
      .getOne();

    if (!student || !student.assignedVehicle) {
      return { routePoints: [], stops: [], academy: null };
    }

    const allStudents = await this.studentRepository.find({
      where: { assignedVehicle: { id: student.assignedVehicle.id } },
      relations: { academy: true }
    });

    const stops = allStudents
      .filter(s => s.latitude && s.longitude)
      .map(s => ({
        id: s.id,
        name: s.name,
        address: s.address,
        latitude: s.latitude,
        longitude: s.longitude
      }));

    const academy = student.academy;
    const routePoints = [];
    if (academy && academy.latitude && academy.longitude) {
      routePoints.push({ latitude: academy.latitude, longitude: academy.longitude, title: '유치원' });
    }

    stops.forEach(s => {
      routePoints.push({ latitude: s.latitude, longitude: s.longitude, title: s.name });
    });

    let academyPickupPoints: any[] = [];
    if (academy) {
      academyPickupPoints = await this.pickupPointRepository.find({ where: { academy: { id: academy.id } } });
    }

    return {
      vehicleId: student.assignedVehicle.id,
      academy: academy ? { latitude: academy.latitude, longitude: academy.longitude, name: academy.name } : null,
      stops,
      routePoints,
      academyPickupPoints
    };
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

  async readMessage(messageId: number, email: string) {
    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) throw new BadRequestException('User not found');

    const msg = await this.messageRepository.findOne({ where: { id: messageId, receiverUser: { id: user.id } } });
    if (msg) {
      msg.isRead = true;
      await this.messageRepository.save(msg);
    }
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
      timeString: '15시 30분',
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
}
