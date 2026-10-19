import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Vehicle } from '../entities/vehicle.entity';
import { Student } from '../entities/student.entity';
import { Academy } from '../entities/academy.entity';
import { User } from '../entities/user.entity';
import { OperationLog } from '../entities/operation-log.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { AcademyHoliday } from '../entities/academy-holiday.entity';
import { Notification } from '../entities/notification.entity';
import { PickupPoint } from '../entities/pickup-point.entity';
import { Between } from 'typeorm';
import * as ExcelJS from 'exceljs';

@Injectable()
export class RoutingService {
  constructor(
    @InjectRepository(Vehicle)
    private vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Student)
    private studentRepository: Repository<Student>,
    @InjectRepository(Academy)
    private academyRepository: Repository<Academy>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(OperationLog)
    private operationLogRepository: Repository<OperationLog>,
    @InjectRepository(ParentMessage)
    private parentMessageRepository: Repository<ParentMessage>,
    @InjectRepository(ScheduleOverride)
    private scheduleOverrideRepository: Repository<ScheduleOverride>,
    @InjectRepository(AcademyHoliday)
    private academyHolidayRepository: Repository<AcademyHoliday>,
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(PickupPoint)
    private pickupPointRepository: Repository<PickupPoint>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  public async checkArrivalAndNotify(vehicleId: number, lat: number, lng: number): Promise<any[]> {
    const students = await this.studentRepository.find({
      where: { assignedVehicle: { id: vehicleId } },
      relations: { parentUser: true }
    });

    const notifications: any[] = [];
    for (const student of students) {
      if (student.latitude && student.longitude) {
        const dLat = (student.latitude - lat) * (Math.PI / 180);
        const dLng = (student.longitude - lng) * (Math.PI / 180);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat * (Math.PI / 180)) * Math.cos(student.latitude * (Math.PI / 180)) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const distanceMeters = 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        if (distanceMeters <= 400) {
          notifications.push({
            studentId: student.id,
            studentName: student.name,
            parentEmail: student.parentUser?.email,
            message: `${student.name} 학생 승하차 지점 부근에 차량이 접근 중입니다.`
          });
        }
      }
    }
    return notifications;
  }

  public async geocodeAddress(address: string): Promise<{ lat: number, lng: number } | null> {
    if (!address) return null;
    const apiKey = this.configService.get<string>('KAKAO_REST_API_KEY');
    if (!apiKey) throw new BadRequestException('Kakao API Key is missing.');

    try {
      const response = await firstValueFrom(
        this.httpService.get('https://dapi.kakao.com/v2/local/search/address.json', {
          params: { query: address },
          headers: { Authorization: `KakaoAK ${apiKey}` }
        })
      );
      
      let documents = response.data?.documents;
      
      // Fallback to keyword search if address search fails (e.g., for POIs like "사동슈퍼 앞")
      if (!documents || documents.length === 0) {
        console.log('Geocoding address failed, trying keyword fallback for:', address);
        const keywordResponse = await firstValueFrom(
          this.httpService.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
            params: { query: address.replace(/앞|뒤|옆|근처|건너편/g, '').trim() },
            headers: { Authorization: `KakaoAK ${apiKey}` }
          })
        );
        documents = keywordResponse.data?.documents;
      }

      if (documents && documents.length > 0) {
        const x = parseFloat(documents[0].x);
        const y = parseFloat(documents[0].y);
        console.log(`Success geocoding ${address}: lat=${y}, lng=${x}`);
        return { lat: y, lng: x }; // Kakao returns x as longitude, y as latitude
      }
      console.log(`Failed to geocode completely: ${address}`);
      return null;
    } catch (e) {
      console.error('Geocoding error for address:', address, e.message);
      return null;
    }
  }

  private colorPalette = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#10b981', // green
    '#f59e0b', // amber
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#14b8a6', // teal
    '#f97316', // orange
    '#6366f1', // indigo
    '#84cc16'  // lime
  ];
  private colorIndex = 0;

  private getDistinctColor(): string {
    const color = this.colorPalette[this.colorIndex % this.colorPalette.length];
    this.colorIndex++;
    return color;
  }

  async getAcademy(academyId?: number, userId?: number): Promise<Academy | null> {
    if (academyId && !isNaN(Number(academyId))) {
      return this.academyRepository.findOne({ where: { id: Number(academyId) } });
    }
    if (userId && !isNaN(Number(userId))) {
      return this.academyRepository.findOne({ where: { owner: { id: Number(userId) } } });
    }
    return this.academyRepository.findOne({ where: {} });
  }

  async getAllAcademies() {
    const academies = await this.academyRepository.find({
      relations: { owner: true },
      order: { id: 'ASC' }
    });
    const results = [];
    for (const ac of academies) {
      const vehicleCount = await this.vehicleRepository.count({ where: { academy: { id: ac.id } } });
      const studentCount = await this.studentRepository.count({ where: { academy: { id: ac.id } } });
      results.push({
        id: ac.id,
        name: ac.name,
        roadAddress: ac.roadAddress,
        latitude: ac.latitude,
        longitude: ac.longitude,
        authCode: ac.authCode,
        vehicleCount,
        studentCount,
        ownerId: ac.owner?.id,
        ownerEmail: ac.owner?.email,
        ownerName: ac.owner?.name,
        createdAt: ac.createdAt
      });
    }
    return results;
  }

  async initializeZones(vehicles: any[], parsedData: any[], academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('학원 정보를 찾을 수 없습니다.');

    // 1. Reset Database Data FOR THIS ACADEMY ONLY (Isolated)
    await this.studentRepository.query(
      `DELETE FROM student_schedules WHERE "studentId" IN (SELECT id FROM students WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.query(
      `DELETE FROM operation_logs WHERE "vehicleId" IN (SELECT id FROM vehicles WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.query(
      `DELETE FROM pickup_point WHERE "academy_id" = $1`,
      [academy.id]
    ).catch(() => {});
    
    // Delete students and vehicles belonging to this academy
    await this.studentRepository.delete({ academy: { id: academy.id } });
    await this.vehicleRepository.delete({ academy: { id: academy.id } });

    academy.vehicleCount = vehicles.length;
    await this.academyRepository.save(academy);

    const savedVehicles: any[] = [];
    const vehiclePointsMap: Record<string, any> = {};

    // 2. Save Vehicles and Assign Colors
    for (const v of vehicles) {
      const newVehicle = this.vehicleRepository.create({
        busNumber: v.busNumber || `${savedVehicles.length + 1}호차`,
        plateNumber: v.plateNumber || '',
        driverName: v.driverName || '미정',
        driverPhone: v.driverPhone || '000-0000-0000',
        teacherName: v.teacherName || '미정',
        teacherPhone: v.teacherPhone || '000-0000-0000',
        capacity: Number(v.capacity) || 25,
        academy: academy,
      });
      const saved = await this.vehicleRepository.save(newVehicle);
      
      savedVehicles.push({
        id: saved.id,
        name: saved.busNumber,
        color: this.getDistinctColor(),
        points: []
      });
      vehiclePointsMap[v.busNumber] = savedVehicles[savedVehicles.length - 1];
    }

    // 3. Geocode Addresses and Associate with Vehicles (with caching & deduplication)
    const geocodeCache = new Map<string, { lat: number, lng: number } | null>();
    const geocodeWithCache = async (addr: string) => {
      const cleanAddr = addr.trim();
      if (!cleanAddr) return null;
      if (geocodeCache.has(cleanAddr)) return geocodeCache.get(cleanAddr);
      const res = await this.geocodeAddress(cleanAddr);
      geocodeCache.set(cleanAddr, res);
      return res;
    };

    const findTargetVehicle = (busName: string | null) => {
      if (!busName) return null;
      if (vehiclePointsMap[busName]) return vehiclePointsMap[busName];
      const numOnly = busName.replace(/[^0-9]/g, '');
      for (const key of Object.keys(vehiclePointsMap)) {
        if (key === busName || (numOnly && key.replace(/[^0-9]/g, '') === numOnly)) {
          return vehiclePointsMap[key];
        }
      }
      return null;
    };

    for (const row of parsedData) {
      const inBusRaw = row['등원차량'] || row['차량'] || row['호차'] || row['등원_차량'];
      const inBusName = inBusRaw ? inBusRaw.toString().trim() : null;
      const inLocation = row['등원지'] || row['탑승지'] || row['승차지'] || row['승차지(주소)'] || row['주소'] || row['도로명주소'];

      const outBusRaw = row['하원차량'] || row['차량'] || row['호차'] || row['하원_차량'];
      const outBusName = outBusRaw ? outBusRaw.toString().trim() : null;
      const outLocation = row['하원지'] || row['하차지'] || row['하차지(주소)'] || row['주소'] || row['도로명주소'];

      const inTarget = inBusName ? findTargetVehicle(inBusName) : null;
      if (inTarget && inLocation) {
        const coords = await geocodeWithCache(inLocation.toString());
        if (coords) {
          const exists = inTarget.points.some((p: any) => p[0] === coords.lat && p[1] === coords.lng);
          if (!exists) inTarget.points.push([coords.lat, coords.lng]);
        }
      }

      const outTarget = outBusName ? findTargetVehicle(outBusName) : null;
      if (outTarget && outLocation) {
        const coords = await geocodeWithCache(outLocation.toString());
        if (coords) {
          const exists = outTarget.points.some((p: any) => p[0] === coords.lat && p[1] === coords.lng);
          if (!exists) outTarget.points.push([coords.lat, coords.lng]);
        }
      }
    }

    // 4. Update DB with polygon points
    for (const v of savedVehicles) {
      const vehicleToUpdate = await this.vehicleRepository.findOne({ where: { id: v.id } });
      if (vehicleToUpdate) {
        vehicleToUpdate.colorHex = v.color;
        vehicleToUpdate.polygonCoordinates = v.points;
        await this.vehicleRepository.save(vehicleToUpdate);
      }
    }

    return savedVehicles;
  }

  async getInitialState(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      return { academy: null, buses: [], students: [] };
    }
    const vehicles = await this.vehicleRepository.find({ 
      where: { academy: { id: academy.id } },
      relations: { driverUser: true, teacherUser: true } 
    });
    const formattedVehicles = vehicles.map(v => {
      let parsedPoints = [];
      try {
        parsedPoints = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : (v.polygonCoordinates || []);
      } catch(e) {}
      
      return {
        id: v.id,
        name: v.busNumber,
        color: v.colorHex || this.getDistinctColor(),
        points: parsedPoints,
        busNumber: v.busNumber,
        plateNumber: v.plateNumber,
        driverName: v.driverName,
        driverPhone: v.driverPhone,
        teacherName: v.teacherName,
        teacherPhone: v.teacherPhone,
        capacity: v.capacity,
        driverApprovalStatus: v.driverApprovalStatus,
        teacherApprovalStatus: v.teacherApprovalStatus,
        isDriverRegistered: !!v.driverUser,
        isTeacherRegistered: !!v.teacherUser
      };
    });
    
    const dbStudents = await this.studentRepository.find({ 
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true, studentUser: true, parentUser: true, schedules: { assignedVehicle: true } } 
    });
    const formattedStudents = dbStudents.map(st => {
      let parsedRaw = {};
      try {
        parsedRaw = typeof st.raw === 'string' ? JSON.parse(st.raw) : (st.raw || {});
      } catch(e) {}

      return {
        id: st.id,
        name: st.adminDisplayName || st.name,
        realName: st.name,
        address: st.address,
        boardingLocation: st.boardingLocation,
        lat: st.latitude,
        lng: st.longitude,
        assignedBusId: st.assignedVehicle ? st.assignedVehicle.id : null,
        color: st.assignedVehicle ? (st.assignedVehicle.colorHex || '#64748b') : '#64748b',
        raw: parsedRaw,
        schedules: st.schedules,
        isRegistered: !!st.studentUser || !!st.parentUser,
        approvalStatus: st.approvalStatus
      };
    });

    return { academy, buses: formattedVehicles, students: formattedStudents };
  }

  async generateAuthCode(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      throw new BadRequestException('학원 정보가 설정되지 않았습니다.');
    }
    
    // Generate a random 6-character alphanumeric code
    let code = Math.random().toString(36).substring(2, 8).toUpperCase();
    while (await this.academyRepository.findOne({ where: { authCode: code } })) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
    }
    academy.authCode = code;
    await this.academyRepository.save(academy);
    
    return { success: true, authCode: code };
  }

  async approveStudent(studentId: number) {
    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('원생을 찾을 수 없습니다.');
    
    student.approvalStatus = 'APPROVED';
    await this.studentRepository.save(student);
    return { success: true };
  }

  async revokeStudent(studentId: number) {
    const student = await this.studentRepository.findOne({ where: { id: studentId }, relations: { studentUser: true, parentUser: true } });
    if (!student) throw new BadRequestException('원생을 찾을 수 없습니다.');
    
    const sUser = student.studentUser;
    const pUser = student.parentUser;

    // Unlink the user and reset status
    student.studentUser = null as any;
    student.parentUser = null as any;
    student.approvalStatus = 'UNREGISTERED';
    await this.studentRepository.save(student);

    // Completely delete the user account
    if (sUser) await this.userRepository.remove(sUser);
    if (pUser) await this.userRepository.remove(pUser);
    
    return { success: true };
  }

  async approveStaff(vehicleId: number, role: 'DRIVER' | 'TEACHER') {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');
    
    if (role === 'DRIVER') vehicle.driverApprovalStatus = 'APPROVED';
    if (role === 'TEACHER') vehicle.teacherApprovalStatus = 'APPROVED';
    
    await this.vehicleRepository.save(vehicle);
    return { success: true };
  }

  async revokeStaff(vehicleId: number, role: 'DRIVER' | 'TEACHER') {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId }, relations: { driverUser: true, teacherUser: true } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');
    
    let userToDelete = null;

    if (role === 'DRIVER') {
      userToDelete = vehicle.driverUser;
      vehicle.driverUser = null as any;
      vehicle.driverApprovalStatus = 'UNREGISTERED';
    } else if (role === 'TEACHER') {
      userToDelete = vehicle.teacherUser;
      vehicle.teacherUser = null as any;
      vehicle.teacherApprovalStatus = 'UNREGISTERED';
    }

    await this.vehicleRepository.save(vehicle);
    
    if (userToDelete) {
      await this.userRepository.remove(userToDelete);
    }
    
    return { success: true };
  }

  async setupAcademy(data: { name: string, address: string, lat: number, lng: number }, academyId?: number, userId?: number) {
    let academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      let code = Math.random().toString(36).substring(2, 8).toUpperCase();
      while (await this.academyRepository.findOne({ where: { authCode: code } })) {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
      }
      academy = this.academyRepository.create({
        name: data.name,
        roadAddress: data.address,
        latitude: data.lat.toString(),
        longitude: data.lng.toString(),
        authCode: code
      });
    } else {
      academy.name = data.name;
      academy.roadAddress = data.address;
      academy.latitude = data.lat.toString();
      academy.longitude = data.lng.toString();
      if (!academy.authCode) {
        let code = Math.random().toString(36).substring(2, 8).toUpperCase();
        while (await this.academyRepository.findOne({ where: { authCode: code } })) {
          code = Math.random().toString(36).substring(2, 8).toUpperCase();
        }
        academy.authCode = code;
      }
    }
    return await this.academyRepository.save(academy);
  }

  async updateVehicleZone(vehicleId: number, email: string, polygonCoordinates: any[]) {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');

    vehicle.polygonCoordinates = JSON.stringify(polygonCoordinates);
    await this.vehicleRepository.save(vehicle);

    // Log this change so admin can see it in Calendar Log
    const todayStr = new Date().toISOString().split('T')[0];
    let log = await this.operationLogRepository.findOne({ 
      where: { vehicle: { id: vehicleId }, dateString: todayStr } 
    });

    if (!log) {
      log = this.operationLogRepository.create({
        vehicle: { id: vehicleId } as any,
        dateString: todayStr,
        boardingRecords: []
      });
    }

    if (!log.boardingRecords) {
      log.boardingRecords = [];
    }

    const userName = email.split('@')[0]; // fallback if we don't fetch user
    log.boardingRecords.push({
      studentName: `구역 변경 (${userName})`,
      method: 'SYSTEM', // Will render as ⚙️ or fallback icon in Web
      boardTime: new Date().toISOString()
    });

    await this.operationLogRepository.save(log);
    
    return { success: true };
  }

  async deleteAcademy(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return { success: true };

    await this.studentRepository.query(
      `DELETE FROM student_schedules WHERE "studentId" IN (SELECT id FROM students WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.query(
      `DELETE FROM operation_logs WHERE "vehicleId" IN (SELECT id FROM vehicles WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.query(
      `DELETE FROM pickup_point WHERE "academy_id" = $1`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.delete({ academy: { id: academy.id } });
    await this.vehicleRepository.delete({ academy: { id: academy.id } });
    await this.academyRepository.delete(academy.id);
    return { success: true };
  }

  async saveStudents(students: any[], academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('학원 정보를 찾을 수 없습니다.');

    // Only clear student records for THIS academy
    await this.studentRepository.query(
      `DELETE FROM student_schedules WHERE "studentId" IN (SELECT id FROM students WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.query(
      `DELETE FROM schedule_overrides WHERE "studentId" IN (SELECT id FROM students WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.query(
      `DELETE FROM parent_messages WHERE "studentId" IN (SELECT id FROM students WHERE "academyId" = $1)`,
      [academy.id]
    ).catch(() => {});
    await this.studentRepository.delete({ academy: { id: academy.id } });

    const vehicles = await this.vehicleRepository.find({ where: { academy: { id: academy.id } } });
    const vehicleMap = new Map();
    vehicles.forEach(v => vehicleMap.set(v.id, v));

    const nameCounts: Record<string, number> = {};
    
    // First pass to count names
    students.forEach(st => {
      if (!nameCounts[st.name]) nameCounts[st.name] = 0;
      nameCounts[st.name]++;
    });

    const multipleNames = new Set(Object.keys(nameCounts).filter(k => nameCounts[k] > 1));
    const currentNameIndex: Record<string, number> = {};

    const newStudents = students.map(st => {
      const vehicle = st.assignedBusId ? vehicleMap.get(st.assignedBusId) : null;
      let adminDisplayName = st.name;
      
      if (multipleNames.has(st.name)) {
        if (!currentNameIndex[st.name]) currentNameIndex[st.name] = 0;
        const index = currentNameIndex[st.name];
        currentNameIndex[st.name]++;
        adminDisplayName = `${st.name} ${String.fromCharCode(65 + index)}`; // A, B, C...
      }

      return this.studentRepository.create({
        name: st.name,
        adminDisplayName,
        address: st.address,
        boardingLocation: st.boardingLocation || st.address,
        latitude: st.lat !== undefined && st.lat !== null ? parseFloat(st.lat) : undefined,
        longitude: st.lng !== undefined && st.lng !== null ? parseFloat(st.lng) : undefined,
        raw: st.raw,
        assignedVehicle: vehicle || undefined,
        academy: academy
      });
    });

    await this.studentRepository.save(newStudents);
    return { success: true, count: newStudents.length };
  }

  async geocodeBulk(addresses: string[]) {
    const cache = new Map<string, { lat: number, lng: number } | null>();
    const results = [];
    for (const address of addresses) {
      if (!address) {
        results.push({ address, coords: null });
        continue;
      }
      const trimmed = address.trim();
      let coords;
      if (cache.has(trimmed)) {
        coords = cache.get(trimmed);
      } else {
        coords = await this.geocodeAddress(trimmed);
        cache.set(trimmed, coords);
      }
      results.push({ address, coords });
    }
    return results;
  }

  async updateVehicle(id: number, data: Partial<Vehicle>) {
    const vehicle = await this.vehicleRepository.findOne({ where: { id } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');

    Object.assign(vehicle, data);
    await this.vehicleRepository.save(vehicle);
    return vehicle;
  }

  async getDailyLogs(date: string, vehicleId: number) {
    const logs = [];

    // 1. Get OperationLogs for the date and vehicle
    const opLog = await this.operationLogRepository.findOne({
      where: { dateString: date, vehicle: { id: vehicleId } },
    });

    const toSafeIsoString = (val: any) => {
      if (!val) return new Date().toISOString();
      const d = new Date(val);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    };

    if (opLog) {
      if (opLog.startTime) {
        logs.push({
          time: toSafeIsoString(opLog.startTime),
          type: 'OPERATION_START',
          message: '운행을 시작했습니다.',
          icon: '🚌'
        });
      }
      
      let boardings = [];
      try {
        boardings = typeof opLog.boardingRecords === 'string' ? JSON.parse(opLog.boardingRecords) : (opLog.boardingRecords || []);
      } catch(e){}
      
      boardings.forEach((b: any) => {
        if (b.action === 'ADMIN_MSG_SENT') {
          logs.push({
            time: toSafeIsoString(b.time),
            type: 'PARENT_MESSAGE',
            message: `[공지] ${b.message || ''}`,
            icon: '📢'
          });
          return;
        }
        logs.push({
          time: toSafeIsoString(b.boardTime),
          type: 'BOARDING',
          message: `${b.studentName || '원생'} 탑승 완료 (${b.method || '확인'})`,
          icon: '🟢'
        });
      });

      if (opLog.endTime) {
        logs.push({
          time: toSafeIsoString(opLog.endTime),
          type: 'OPERATION_END',
          message: '운행을 종료했습니다.',
          icon: '🏁'
        });
      }
    }

    // 2. Get ParentMessages for students in this vehicle on this date
    const startOfDay = new Date(`${date}T00:00:00.000Z`);
    const endOfDay = new Date(`${date}T23:59:59.999Z`);
    
    // adjust for KST (+9 hours) to UTC matching, actually let's assume the DB uses UTC and the date parameter is local date.
    // If the date parameter is KST '2026-07-27', then in UTC it's '2026-07-26T15:00' to '2026-07-27T14:59'
    // To keep it simple, we can just query using Between with the date string if DB is setup with local timezone,
    // or just construct KST boundaries in UTC.
    // Let's use simple new Date(date).
    const startOfKSTDay = new Date(`${date}T00:00:00+09:00`);
    const endOfKSTDay = new Date(`${date}T23:59:59+09:00`);

    const messages = await this.parentMessageRepository.find({
      where: {
        student: { assignedVehicle: { id: vehicleId } },
        createdAt: Between(startOfKSTDay, endOfKSTDay)
      },
      relations: { student: true }
    });

    messages.forEach(msg => {
      const studentName = msg.student ? (msg.student.adminDisplayName || msg.student.name) : '알수없음';
      logs.push({
        time: new Date(msg.createdAt).toISOString(),
        type: 'PARENT_MESSAGE',
        message: `${studentName} 학부모: ${msg.message} (읽음: ${msg.isRead ? 'O' : 'X'})`,
        icon: '💬'
      });
    });

    // 3. Sort by time ascending
    logs.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

    return logs;
  }

  async generateExcelBuffer(academyId?: number, userId?: number): Promise<Buffer> {
    const academy = await this.getAcademy(academyId, userId);
    const students = await this.studentRepository.find({ 
      where: academy ? { academy: { id: academy.id } } : {},
      relations: { schedules: { assignedVehicle: true } } 
    });
    const workbook = new ExcelJS.Workbook();
    
    const days = ['월', '화', '수', '목', '금', '토', '일'];
    const daysEnglish = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    
    const columns = [
      { header: '반명', key: 'className', width: 15 },
      { header: '학생이름/영문이름', key: 'name', width: 20 },
      { header: '학교명', key: 'schoolName', width: 15 },
      { header: '학년', key: 'grade', width: 10 },
      { header: '연령', key: 'age', width: 10 },
      { header: '성별', key: 'gender', width: 10 },
      { header: '보호자 성함', key: 'parentName', width: 15 },
      { header: '보호자연락처', key: 'parentPhone', width: 20 },
      { header: '주소', key: 'address', width: 30 },
      { header: '등원지', key: 'inLocation', width: 20 },
      { header: '하원지', key: 'outLocation', width: 20 },
      { header: '담임명', key: 'teacherName', width: 15 },
      { header: '등원차량', key: 'inBus', width: 15 },
      { header: '하원차량', key: 'outBus', width: 15 },
      { header: '등원시간', key: 'inTime', width: 15 },
      { header: '하원시간', key: 'outTime', width: 15 },
      { header: '비고', key: 'note', width: 20 },
    ];

    for (let i = 0; i < days.length; i++) {
      const sheet = workbook.addWorksheet(`${days[i]} 초-중-고등부`);
      sheet.columns = columns;

      for (const student of students) {
        const sched = student.schedules?.find(s => s.dayOfWeek === daysEnglish[i]);
        if (sched || student.raw) {
          const raw = student.raw || {};
          sheet.addRow({
            className: raw['반명'] || '',
            name: student.name || '',
            schoolName: raw['학교명'] || '',
            grade: raw['학년'] || '',
            age: raw['연령'] || '',
            gender: raw['성별'] || '',
            parentName: raw['보호자 성함'] || '',
            parentPhone: raw['보호자 연락처'] || '',
            address: student.address || '',
            inLocation: sched?.address || raw['등원지'] || student.address || '',
            outLocation: raw['하원지'] || sched?.address || student.address || '',
            teacherName: raw['담임명'] || '',
            inBus: sched?.assignedVehicle?.busNumber || raw['등원차량'] || '',
            outBus: raw['하원차량'] || sched?.assignedVehicle?.busNumber || '',
            inTime: raw['등원시간'] || '',
            outTime: raw['하원시간'] || '',
            note: raw['비고'] || '',
          });
        }
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return buffer as any as Buffer;
  }
  async createAbsence(body: { studentId: number, startDate: string, endDate: string }) {
    const student = await this.studentRepository.findOne({ where: { id: body.studentId } });
    if (!student) throw new BadRequestException('Student not found');
    
    const override = this.scheduleOverrideRepository.create({
      student,
      startDate: body.startDate,
      endDate: body.endDate,
      overrideType: OverrideType.ABSENCE,
    });
    return this.scheduleOverrideRepository.save(override);
  }

  async getAbsences(vehicleId?: number) {
    const query = this.scheduleOverrideRepository.createQueryBuilder('override')
      .leftJoinAndSelect('override.student', 'student')
      .where('override.overrideType = :type', { type: OverrideType.ABSENCE });
      
    if (vehicleId) {
      query.leftJoin('student.assignedVehicle', 'vehicle')
           .andWhere('vehicle.id = :vehicleId', { vehicleId });
    }
    
    return query.getMany();
  }

  async deleteAbsence(id: number) {
    await this.scheduleOverrideRepository.delete(id);
    return { success: true };
  }

  async createHoliday(body: { startDate: string, endDate: string, reason?: string }, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    const holiday = this.academyHolidayRepository.create({
      ...body,
      academy: academy || undefined
    });
    await this.academyHolidayRepository.save(holiday);

    // Notify system (broadcast)
    const msg = `[학원 공지] ${body.startDate}부터 ${body.endDate}까지 학원 휴무일로 지정되었습니다. ${body.reason ? `사유: ${body.reason}` : ''}`;
    const notification = this.notificationRepository.create({
      message: msg
    });
    await this.notificationRepository.save(notification);
    
    return holiday;
  }

  async getHolidays(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return this.academyHolidayRepository.find({ order: { startDate: 'DESC' } });
    return this.academyHolidayRepository.find({ 
      where: { academy: { id: academy.id } },
      order: { startDate: 'DESC' } 
    });
  }

  async getAdminMessages() {
    return this.parentMessageRepository.createQueryBuilder('msg')
      .where('msg.targetRoles LIKE :role', { role: '%ACADEMY_ADMIN%' })
      .leftJoinAndSelect('msg.student', 'student')
      .orderBy('msg.createdAt', 'DESC')
      .getMany();
  }

  async sendAdminMessage(body: { targetRoles: string[], vehicleId: number | null, studentIds: number[], message: string }) {
    const { targetRoles, vehicleId, studentIds, message } = body;
    const adminMsg = this.parentMessageRepository.create({
      targetRoles,
      message,
    });
    // In a full implementation, we'd loop through studentIds to send individual messages or use notification entity.
    // For now, save a broadcast record.
    await this.parentMessageRepository.save(adminMsg);
    
    // Also log it
    const log = this.operationLogRepository.create({
       dateString: new Date().toISOString().split('T')[0],
       boardingRecords: [{ action: 'ADMIN_MSG_SENT', message, targetRoles, vehicleId, studentIds }]
    });
    if (vehicleId) {
      const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId }});
      if (vehicle) {
        log.vehicle = vehicle;
      }
    }
    await this.operationLogRepository.save(log);

    return { success: true, message: 'Message sent successfully.' };
  }

  async createPickupPoint(body: { name: string, latitude: number, longitude: number }, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('Academy not set up');
    const point = this.pickupPointRepository.create({
      name: body.name,
      latitude: body.latitude,
      longitude: body.longitude,
      academy: academy
    });
    return this.pickupPointRepository.save(point);
  }

  async getPickupPoints(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return [];
    return this.pickupPointRepository.find({ where: { academy: { id: academy.id } } });
  }

  async deletePickupPoint(id: number) {
    await this.pickupPointRepository.delete(id);
    return { success: true };
  }
}
