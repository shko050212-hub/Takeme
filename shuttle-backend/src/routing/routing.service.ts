import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Vehicle } from '../entities/vehicle.entity';
import { Student } from '../entities/student.entity';
import { Academy } from '../entities/academy.entity';
import { User, UserRole } from '../entities/user.entity';
import { OperationLog } from '../entities/operation-log.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { AcademyHoliday } from '../entities/academy-holiday.entity';
import { Notification } from '../entities/notification.entity';
import { PickupPoint } from '../entities/pickup-point.entity';
import { BoardPost } from '../entities/board-post.entity';
import { BoardComment } from '../entities/board-comment.entity';
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
    @InjectRepository(BoardPost)
    private boardPostRepository: Repository<BoardPost>,
    @InjectRepository(BoardComment)
    private boardCommentRepository: Repository<BoardComment>,
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
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

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
        isTeacherRegistered: !!v.teacherUser,
        driverUserId: v.driverUser?.id || null,
        isDriverLocked: !!v.driverUser?.isLocked,
        teacherUserId: v.teacherUser?.id || null,
        isTeacherLocked: !!v.teacherUser?.isLocked,
      };
    });
    
    const dbStudents = await this.studentRepository.find({ 
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true, studentUser: true, parentUser: true, schedules: { assignedVehicle: true } } 
    });
    const formattedStudents = dbStudents.map(st => {
      let parsedRaw: any = {};
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
        allergies: st.allergies || parsedRaw['알레르기'] || parsedRaw['알러지'] || '',
        raw: parsedRaw,
        schedules: st.schedules,
        isRegistered: !!st.studentUser || !!st.parentUser,
        studentUserId: st.studentUser?.id || null,
        parentUserId: st.parentUser?.id || null,
        isLocked: !!(st.parentUser?.isLocked || st.studentUser?.isLocked),
        approvalStatus: st.approvalStatus,
        teacherMemo: st.teacherMemo || '',
        boardStatus: st.boardStatus || 'WAITING'
      };
    });

    return { academy, buses: formattedVehicles, students: formattedStudents };
  }

  async generateAuthCode(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      throw new BadRequestException('유치원 정보가 설정되지 않았습니다.');
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

  async revokeTeacher(teacherId: number) {
    const teacher = await this.userRepository.findOne({ where: { id: teacherId, role: UserRole.TEACHER } });
    if (!teacher) throw new BadRequestException('교사를 찾을 수 없습니다.');

    // If teacher is associated with any vehicle as teacherUser, unlink
    const vehicles = await this.vehicleRepository.find({
      where: { teacherUser: { id: teacherId } },
      relations: { teacherUser: true }
    });
    for (const vehicle of vehicles) {
      vehicle.teacherUser = null as any;
      vehicle.teacherApprovalStatus = 'UNREGISTERED';
      await this.vehicleRepository.save(vehicle);
    }

    await this.userRepository.remove(teacher);
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

  private computeConvexHull(points: [number, number][]): [number, number][] {
    if (points.length <= 3) return points;
    
    // Deduplicate points
    const pointMap = new Map<string, [number, number]>();
    for (const p of points) {
      const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
      if (!pointMap.has(key)) pointMap.set(key, p);
    }
    const uniquePoints = Array.from(pointMap.values());
    if (uniquePoints.length <= 3) return uniquePoints;

    // Sort by latitude (x), then longitude (y)
    const sorted = [...uniquePoints].sort((a, b) => a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]);

    // 2D cross product: > 0 for CCW, < 0 for CW, 0 if collinear
    const cross = (o: [number, number], a: [number, number], b: [number, number]) => {
      return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    };

    const lower: [number, number][] = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper: [number, number][] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  private isPointInPolygon(point: [number, number], vs: [number, number][]): boolean {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const xi = vs[i][0], yi = vs[i][1];
      const xj = vs[j][0], yj = vs[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  async saveStudents(students: any[], academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

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

      let rawObj = st.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
      }
      if (rawObj && typeof rawObj === 'object') {
        const kName = rawObj['유치원명'] || rawObj['소속원명'] || rawObj['학교명'] || academy.name || '';
        const pPhone = rawObj['부모연락처'] || rawObj['보호자연락처'] || rawObj['보호자 연락처'] || '';
        const kAge = rawObj['연령'] || rawObj['학년'] || '';
        const depType = rawObj['하원구분'] || rawObj['하원정보'] || (rawObj['정규하원'] ? '정규하원' : rawObj['방과후하원'] ? '방과후하원' : rawObj['종일반하원'] ? '종일반하원' : '정규하원');
        rawObj['유치원명'] = kName;
        rawObj['학교명'] = kName;
        rawObj['원아명'] = rawObj['원아명'] || rawObj['학생이름/영문이름'] || rawObj['이름'] || st.name;
        rawObj['부모연락처'] = pPhone;
        rawObj['보호자연락처'] = pPhone;
        rawObj['연령'] = kAge;
        rawObj['하원구분'] = depType;
      }

      const allergyVal = rawObj ? (rawObj['알레르기'] || rawObj['알러지'] || rawObj['특이사항(알레르기)'] || '') : '';
      return this.studentRepository.create({
        name: st.name,
        adminDisplayName,
        address: st.address,
        boardingLocation: st.boardingLocation || st.address,
        latitude: st.lat !== undefined && st.lat !== null ? parseFloat(st.lat) : undefined,
        longitude: st.lng !== undefined && st.lng !== null ? parseFloat(st.lng) : undefined,
        allergies: allergyVal || st.allergies || '',
        raw: rawObj || st.raw,
        assignedVehicle: vehicle || undefined,
        academy: academy
      });
    });

    await this.studentRepository.save(newStudents);

    // Expand vehicle zones to encompass all newly assigned students
    for (const vehicle of vehicles) {
      const assignedStudents = newStudents.filter(
        st => st.assignedVehicle && st.assignedVehicle.id === vehicle.id && st.latitude && st.longitude
      );
      if (assignedStudents.length > 0) {
        let existingPoints: [number, number][] = [];
        try {
          const rawPts = typeof vehicle.polygonCoordinates === 'string' 
            ? JSON.parse(vehicle.polygonCoordinates) 
            : vehicle.polygonCoordinates;
          if (Array.isArray(rawPts)) {
            existingPoints = rawPts.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) as [number, number][];
          }
        } catch (e) {}

        const studentBufferedPoints: [number, number][] = [];
        const dLat = 0.0008;
        const dLng = 0.0009;
        for (const st of assignedStudents) {
          studentBufferedPoints.push(
            [st.latitude! + dLat, st.longitude!],
            [st.latitude! - dLat, st.longitude!],
            [st.latitude!, st.longitude! + dLng],
            [st.latitude!, st.longitude! - dLng],
            [st.latitude!, st.longitude!]
          );
        }

        const pointsToHull = [...existingPoints, ...studentBufferedPoints];
        if (existingPoints.length < 3 && academy.latitude && academy.longitude) {
          const acadLat = parseFloat(academy.latitude);
          const acadLng = parseFloat(academy.longitude);
          if (!isNaN(acadLat) && !isNaN(acadLng)) {
            pointsToHull.push(
              [acadLat + dLat, acadLng],
              [acadLat - dLat, acadLng],
              [acadLat, acadLng + dLng],
              [acadLat, acadLng - dLng],
              [acadLat, acadLng]
            );
          }
        }

        const expandedPolygon = this.computeConvexHull(pointsToHull);
        if (expandedPolygon && expandedPolygon.length >= 3) {
          vehicle.polygonCoordinates = JSON.stringify(expandedPolygon);
          await this.vehicleRepository.save(vehicle);
        }
      }
    }

    return { success: true, count: newStudents.length };
  }

  async addStudent(studentData: any, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    let lat = studentData.lat !== undefined && studentData.lat !== null && !isNaN(parseFloat(studentData.lat)) ? parseFloat(studentData.lat) : undefined;
    let lng = studentData.lng !== undefined && studentData.lng !== null && !isNaN(parseFloat(studentData.lng)) ? parseFloat(studentData.lng) : undefined;

    if ((lat === undefined || lng === undefined) && studentData.address) {
      const coords = await this.geocodeAddress(studentData.address);
      if (coords) {
        lat = coords.lat;
        lng = coords.lng;
      }
    }

    const vehicles = await this.vehicleRepository.find({ 
      where: { academy: { id: academy.id } } 
    });

    let vehicle: Vehicle | null = null;
    if (studentData.assignedBusId) {
      vehicle = vehicles.find(v => v.id === Number(studentData.assignedBusId)) || null;
    }

    // Auto-assign to nearest vehicle if not explicitly selected
    if (!vehicle && lat !== undefined && lng !== undefined && vehicles.length > 0) {
      // 1. Check if inside any existing vehicle polygon
      for (const v of vehicles) {
        let pts: [number, number][] = [];
        try {
          pts = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : (v.polygonCoordinates || []);
        } catch (e) {}
        if (Array.isArray(pts) && pts.length >= 3 && this.isPointInPolygon([lat, lng], pts)) {
          vehicle = v;
          break;
        }
      }

      // 2. Fallback: find closest vehicle by distance to its polygon/route points
      if (!vehicle) {
        let minDistance = Infinity;
        for (const v of vehicles) {
          let pts: [number, number][] = [];
          try {
            pts = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : (v.polygonCoordinates || []);
          } catch (e) {}
          if (Array.isArray(pts) && pts.length > 0) {
            for (const pt of pts) {
              const dist = this.getDistanceKm(lat, lng, pt[0], pt[1]);
              if (dist < minDistance) {
                minDistance = dist;
                vehicle = v;
              }
            }
          }
        }
      }

      // 3. Fallback: first vehicle
      if (!vehicle && vehicles.length > 0) {
        vehicle = vehicles[0];
      }
    }

    // AUTO-EXPAND VEHICLE ZONE:
    // Expand assigned vehicle's polygon to encompass the new student's location so that no student is left outside!
    let zoneExpanded = false;
    if (vehicle && lat !== undefined && lng !== undefined) {
      let existingPoints: [number, number][] = [];
      try {
        const rawPts = typeof vehicle.polygonCoordinates === 'string' 
          ? JSON.parse(vehicle.polygonCoordinates) 
          : vehicle.polygonCoordinates;
        if (Array.isArray(rawPts)) {
          existingPoints = rawPts.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) as [number, number][];
        }
      } catch (e) {}

      // Buffer ~80m around the student coordinates so the boundary comfortably encloses the student
      const dLat = 0.0008;
      const dLng = 0.0009;
      const studentBufferedPoints: [number, number][] = [
        [lat + dLat, lng],
        [lat - dLat, lng],
        [lat, lng + dLng],
        [lat, lng - dLng],
        [lat, lng]
      ];

      const pointsToHull: [number, number][] = [...existingPoints, ...studentBufferedPoints];

      // If the vehicle had 0 or very few points, also include academy coordinates
      if (existingPoints.length < 3 && academy.latitude && academy.longitude) {
        const acadLat = parseFloat(academy.latitude);
        const acadLng = parseFloat(academy.longitude);
        if (!isNaN(acadLat) && !isNaN(acadLng)) {
          pointsToHull.push(
            [acadLat + dLat, acadLng],
            [acadLat - dLat, acadLng],
            [acadLat, acadLng + dLng],
            [acadLat, acadLng - dLng],
            [acadLat, acadLng]
          );
        }
      }

      const expandedPolygon = this.computeConvexHull(pointsToHull);
      if (expandedPolygon && expandedPolygon.length >= 3) {
        vehicle.polygonCoordinates = JSON.stringify(expandedPolygon);
        await this.vehicleRepository.save(vehicle);
        zoneExpanded = true;
      }
    }

    // Format raw JSON containing kindergarten columns
    const departureType = studentData.departureType || studentData.raw?.['하원구분'] || studentData.raw?.['하원정보'] || '정규하원';
    const kindergartenName = studentData.kindergartenName || studentData.schoolName || studentData.raw?.['유치원명'] || studentData.raw?.['소속원명'] || studentData.raw?.['학교명'] || academy.name || '';
    const parentPhone = studentData.parentPhone || studentData.raw?.['부모연락처'] || studentData.raw?.['보호자연락처'] || studentData.raw?.['보호자 연락처'] || '';
    const age = studentData.age || studentData.raw?.['연령'] || studentData.raw?.['학년'] || '';
    const className = studentData.className || studentData.raw?.['반명'] || '';
    const teacherName = studentData.teacherName || studentData.raw?.['담임명'] || '';

    const raw = {
      ...(studentData.raw || {}),
      '반명': className,
      '원아명': studentData.name || '',
      '학생이름/영문이름': studentData.name || '',
      '유치원명': kindergartenName,
      '학교명': kindergartenName,
      '연령': age,
      '학년': age,
      '성별': studentData.gender || studentData.raw?.['성별'] || '',
      '보호자 성함': studentData.parentName || studentData.raw?.['보호자 성함'] || '',
      '부모연락처': parentPhone,
      '보호자연락처': parentPhone,
      '주소': studentData.address || '',
      '등원지': studentData.inLocation || studentData.boardingLocation || studentData.address || '',
      '하원지': studentData.outLocation || studentData.address || '',
      '담임명': teacherName,
      '하원구분': departureType,
      '등원차량': studentData.inBus || vehicle?.busNumber || '',
      '하원차량': studentData.outBus || vehicle?.busNumber || '',
      '등원시간': studentData.inTime || '',
      '하원시간': studentData.outTime || '',
      '비고': studentData.note || ''
    };

    // Duplicate name disambiguation (e.g. 홍길동 A, 홍길동 B)
    const existingSameName = await this.studentRepository.find({
      where: { name: studentData.name, academy: { id: academy.id } }
    });
    let adminDisplayName = studentData.name;
    if (existingSameName.length > 0) {
      adminDisplayName = `${studentData.name} ${String.fromCharCode(65 + existingSameName.length)}`;
    }

    if (studentData.allergies) {
      raw['알레르기'] = studentData.allergies;
    }
    const student = this.studentRepository.create({
      name: studentData.name,
      adminDisplayName,
      address: studentData.address,
      boardingLocation: studentData.inLocation || studentData.boardingLocation || studentData.address,
      latitude: lat,
      longitude: lng,
      allergies: studentData.allergies || studentData.raw?.['알레르기'] || '',
      raw,
      assignedVehicle: vehicle || undefined,
      academy
    });

    const saved = await this.studentRepository.save(student);

    return {
      success: true,
      zoneExpanded,
      student: {
        id: saved.id,
        name: saved.adminDisplayName || saved.name,
        realName: saved.name,
        address: saved.address,
        boardingLocation: saved.boardingLocation,
        lat: saved.latitude,
        lng: saved.longitude,
        assignedBusId: vehicle ? vehicle.id : null,
        color: vehicle?.colorHex || '#64748b',
        raw: typeof saved.raw === 'string' ? JSON.parse(saved.raw) : saved.raw,
        isRegistered: false,
        approvalStatus: saved.approvalStatus
      }
    };
  }

  async deleteStudent(studentId: number, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    await this.studentRepository.delete({ id: studentId, academy: { id: academy.id } });
    return { success: true };
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
      relations: { assignedVehicle: true, schedules: { assignedVehicle: true } } 
    });
    const workbook = new ExcelJS.Workbook();
    
    const days = ['월', '화', '수', '목', '금', '토', '일'];
    const daysEnglish = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    
    const columns = [
      { header: '반명', key: 'className', width: 15 },
      { header: '원아명', key: 'name', width: 20 },
      { header: '유치원명', key: 'kindergartenName', width: 18 },
      { header: '연령', key: 'age', width: 12 },
      { header: '성별', key: 'gender', width: 10 },
      { header: '보호자 성함', key: 'parentName', width: 15 },
      { header: '부모연락처', key: 'parentPhone', width: 20 },
      { header: '주소', key: 'address', width: 32 },
      { header: '등원지', key: 'inLocation', width: 20 },
      { header: '하원지', key: 'outLocation', width: 20 },
      { header: '담임명', key: 'teacherName', width: 15 },
      { header: '하원구분', key: 'departureType', width: 15 },
      { header: '등원차량', key: 'inBus', width: 15 },
      { header: '하원차량', key: 'outBus', width: 15 },
      { header: '등원시간', key: 'inTime', width: 15 },
      { header: '하원시간', key: 'outTime', width: 15 },
      { header: '알레르기', key: 'allergies', width: 20 },
      { header: '비고', key: 'note', width: 25 },
    ];

    const getDepartureType = (r: any) => {
      if (r['하원구분']) return r['하원구분'];
      if (r['하원정보']) return r['하원정보'];
      if (r['정규하원'] && String(r['정규하원']).trim()) return '정규하원';
      if (r['방과후하원'] && String(r['방과후하원']).trim()) return '방과후하원';
      if (r['종일반하원'] && String(r['종일반하원']).trim()) return '종일반하원';
      return '정규하원';
    };

    const mapStudentRow = (student: any, sched?: any) => {
      let raw: any = student.raw;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
      }
      raw = raw || {};

      return {
        className: raw['반명'] || '반 미지정',
        name: student.name || raw['원아명'] || raw['학생이름/영문이름'] || raw['이름'] || '',
        kindergartenName: raw['유치원명'] || raw['소속원명'] || raw['학교명'] || academy?.name || '',
        age: raw['연령'] || raw['학년'] || '연령 미입력',
        gender: raw['성별'] || '',
        parentName: raw['보호자 성함'] || '',
        parentPhone: raw['부모연락처'] || raw['보호자연락처'] || raw['보호자 연락처'] || '',
        address: student.address || raw['주소'] || '',
        inLocation: sched?.address || raw['등원지'] || raw['탑승지'] || student.boardingLocation || student.address || '',
        outLocation: raw['하원지'] || sched?.address || student.boardingLocation || student.address || '',
        teacherName: raw['담임명'] || '',
        departureType: getDepartureType(raw),
        inBus: sched?.assignedVehicle?.busNumber || raw['등원차량'] || student.assignedVehicle?.busNumber || '배정 대기',
        outBus: raw['하원차량'] || sched?.assignedVehicle?.busNumber || student.assignedVehicle?.busNumber || '배정 대기',
        inTime: raw['등원시간'] || '',
        outTime: raw['하원시간'] || '',
        allergies: student.allergies || raw['알레르기'] || raw['알러지'] || '',
        note: raw['비고'] || '',
      };
    };

    const allRows = students.map(st => mapStudentRow(st));

    // 1. 전체 원아 명단
    const masterSheet = workbook.addWorksheet('전체 원아 명단');
    masterSheet.columns = columns;
    allRows.forEach(row => masterSheet.addRow(row));

    // 2. 반별 명단 (반명 정렬)
    const classSheet = workbook.addWorksheet('반별 명단');
    classSheet.columns = columns;
    const classRows = [...allRows].sort((a, b) => String(a.className || "").localeCompare(String(b.className || "")));
    classRows.forEach(row => classSheet.addRow(row));

    // 3. 연령별 명단 (연령 정렬)
    const ageSheet = workbook.addWorksheet('연령별 명단');
    ageSheet.columns = columns;
    const ageRows = [...allRows].sort((a, b) => String(a.age || "").localeCompare(String(b.age || "")));
    ageRows.forEach(row => ageSheet.addRow(row));

    // 4. 차량별 명단 (배정차량 정렬)
    const busSheet = workbook.addWorksheet('차량별 명단');
    busSheet.columns = columns;
    const busRows = [...allRows].sort((a, b) => String(a.inBus || "").localeCompare(String(b.inBus || "")));
    busRows.forEach(row => busSheet.addRow(row));

    // 5. 요일별 운행 명단 (월, 화, 수, 목, 금, 토, 일)
    for (let i = 0; i < days.length; i++) {
      const sheet = workbook.addWorksheet(`${days[i]}요일 운행명단`);
      sheet.columns = columns;

      for (const student of students) {
        const sched = student.schedules?.find(s => s.dayOfWeek === daysEnglish[i]);
        if (sched || student.raw) {
          sheet.addRow(mapStudentRow(student, sched));
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
    const msg = `[유치원 공지] ${body.startDate}부터 ${body.endDate}까지 유치원 휴원일로 지정되었습니다. ${body.reason ? `사유: ${body.reason}` : ''}`;
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

  async deleteHoliday(id: number) {
    const holiday = await this.academyHolidayRepository.findOne({ where: { id } });
    if (holiday) {
      const msg = `[유치원 공지] ${holiday.startDate}부터 ${holiday.endDate}까지 예정되었던 유치원 휴원일 지정이 취소(정상 운영)되었습니다.`;
      const notification = this.notificationRepository.create({
        message: msg,
      });
      await this.notificationRepository.save(notification);
      await this.academyHolidayRepository.delete(id);
    }
    return { success: true };
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

  // ===================== BOARD APIs =====================
  async getBoardPosts(params: {
    academyId?: number;
    userId?: number;
    visibility?: string;
    targetClass?: string;
    search?: string;
  }) {
    const { academyId, userId, visibility, targetClass, search } = params;
    const academy = await this.getAcademy(academyId, userId);

    const qb = this.boardPostRepository.createQueryBuilder('post')
      .leftJoinAndSelect('post.comments', 'comment')
      .orderBy('post.createdAt', 'DESC')
      .addOrderBy('comment.createdAt', 'ASC');

    if (academy) {
      qb.where('(post.academyId = :academyId OR post.academyId IS NULL)', { academyId: academy.id });
    }

    if (visibility && visibility !== 'ALL_INCL') {
      if (visibility === 'ALL') {
        qb.andWhere('post.visibility = :v', { v: 'ALL' });
      } else if (visibility === 'CLASS') {
        qb.andWhere('post.visibility = :v', { v: 'CLASS' });
      }
    }

    if (targetClass && targetClass !== 'ALL') {
      qb.andWhere('(post.visibility = :allVis OR post.targetClass = :tc)', { allVis: 'ALL', tc: targetClass });
    }

    if (search && search.trim()) {
      qb.andWhere('(post.title ILIKE :kw OR post.content ILIKE :kw OR post.authorName ILIKE :kw)', { kw: `%${search.trim()}%` });
    }

    return qb.getMany();
  }

  async getBoardPostById(id: number) {
    const post = await this.boardPostRepository.findOne({
      where: { id },
      relations: { comments: true }
    });
    if (!post) throw new BadRequestException('게시글을 찾을 수 없습니다.');
    return post;
  }

  async createBoardPost(body: {
    title: string;
    content: string;
    imageUrl?: string;
    images?: string[];
    authorName?: string;
    authorRole?: string;
    visibility?: string;
    targetClass?: string;
    academyId?: number;
  }, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(body.academyId || academyId, userId);
    const post = this.boardPostRepository.create({
      title: body.title,
      content: body.content,
      imageUrl: body.imageUrl || null,
      images: body.images || [],
      authorName: body.authorName || '원장선생님',
      authorRole: body.authorRole || 'ADMIN',
      visibility: body.visibility || 'ALL',
      targetClass: body.targetClass || null,
      academy: academy || undefined,
      likeCount: 0,
      likedUserIds: [],
    } as any);
    return this.boardPostRepository.save(post);
  }

  async updateBoardPost(id: number, body: {
    title?: string;
    content?: string;
    imageUrl?: string;
    images?: string[];
    visibility?: string;
    targetClass?: string;
  }) {
    const post = await this.getBoardPostById(id);
    if (body.title !== undefined) post.title = body.title;
    if (body.content !== undefined) post.content = body.content;
    if (body.imageUrl !== undefined) post.imageUrl = body.imageUrl;
    if (body.images !== undefined) post.images = body.images;
    if (body.visibility !== undefined) post.visibility = body.visibility;
    if (body.targetClass !== undefined) post.targetClass = body.targetClass;
    return this.boardPostRepository.save(post);
  }

  async deleteBoardPost(id: number) {
    await this.boardPostRepository.delete(id);
    return { success: true };
  }

  async toggleBoardPostLike(id: number, userIdStr?: string) {
    const post = await this.getBoardPostById(id);
    const uid = userIdStr || 'admin';
    let liked = Array.isArray(post.likedUserIds) ? [...post.likedUserIds] : [];
    const exists = liked.includes(uid);
    if (exists) {
      liked = liked.filter(u => u !== uid);
      post.likeCount = Math.max(0, post.likeCount - 1);
    } else {
      liked.push(uid);
      post.likeCount = (post.likeCount || 0) + 1;
    }
    post.likedUserIds = liked;
    await this.boardPostRepository.save(post);
    return { likeCount: post.likeCount, isLiked: !exists };
  }

  async addBoardComment(postId: number, body: {
    content: string;
    authorName?: string;
    authorRole?: string;
  }) {
    const post = await this.getBoardPostById(postId);
    const comment = this.boardCommentRepository.create({
      post,
      content: body.content,
      authorName: body.authorName || '원장선생님',
      authorRole: body.authorRole || 'ADMIN',
    } as any);
    return this.boardCommentRepository.save(comment);
  }

  async deleteBoardComment(commentId: number) {
    await this.boardCommentRepository.delete(commentId);
    return { success: true };
  }

  async updateStudentNote(studentId: number, memo: string) {
    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('원아를 찾을 수 없습니다.');
    student.teacherMemo = memo;
    await this.studentRepository.save(student);
    return { success: true, studentId: student.id, teacherMemo: student.teacherMemo };
  }

  async updateStudentBoardStatus(studentId: number, boardStatus: string) {
    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('원아를 찾을 수 없습니다.');
    student.boardStatus = boardStatus;
    await this.studentRepository.save(student);
    return { success: true, studentId: student.id, boardStatus: student.boardStatus };
  }

  async updateStudentAllergies(studentId: number, allergies: string) {
    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('원아를 찾을 수 없습니다.');
    student.allergies = (allergies || '').trim();
    let rawObj = student.raw;
    if (typeof rawObj === 'string') {
      try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
    }
    if (!rawObj || typeof rawObj !== 'object') rawObj = {};
    rawObj['알레르기'] = student.allergies;
    student.raw = rawObj;
    await this.studentRepository.save(student);
    return { success: true, studentId: student.id, allergies: student.allergies };
  }

  async updateStudentClass(studentId: number, className: string) {
    const student = await this.studentRepository.findOne({ where: { id: studentId } });
    if (!student) throw new BadRequestException('원아를 찾을 수 없습니다.');
    let rawObj = student.raw;
    if (typeof rawObj === 'string') {
      try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
    }
    if (!rawObj || typeof rawObj !== 'object') rawObj = {};
    rawObj['반명'] = className || '';
    rawObj['반'] = className || '';
    student.raw = rawObj;
    await this.studentRepository.save(student);
    return { success: true, studentId: student.id, className };
  }

  async batchAssignStudentClass(studentIds: number[], className: string) {
    if (!Array.isArray(studentIds) || studentIds.length === 0) return { success: true, count: 0 };
    const { In } = require('typeorm');
    const students = await this.studentRepository.find({ where: { id: In(studentIds) } });
    for (const st of students) {
      let rawObj = st.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
      }
      if (!rawObj || typeof rawObj !== 'object') rawObj = {};
      rawObj['반명'] = className || '';
      rawObj['반'] = className || '';
      st.raw = rawObj;
    }
    await this.studentRepository.save(students);
    return { success: true, count: students.length, className };
  }

  async uploadMedia(data: { base64Data: string; filename?: string; mimeType?: string }, reqHost?: string) {
    if (!data.base64Data) {
      throw new BadRequestException('업로드할 미디어 데이터가 없습니다.');
    }

    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');

    let base64String = data.base64Data;
    let ext = 'jpg';
    if (base64String.includes(';base64,')) {
      const parts = base64String.split(';base64,');
      const mime = parts[0].replace('data:', '');
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('gif')) ext = 'gif';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      base64String = parts[1];
    } else if (data.mimeType) {
      if (data.mimeType.includes('png')) ext = 'png';
      else if (data.mimeType.includes('webp')) ext = 'webp';
      else if (data.mimeType.includes('gif')) ext = 'gif';
    }

    const buffer = Buffer.from(base64String, 'base64');
    const uploadsDir = path.join(process.cwd(), 'uploads', 'board');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const randomName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const filePath = path.join(uploadsDir, randomName);
    fs.writeFileSync(filePath, buffer);

    const host = reqHost || '52.63.245.203';
    const protocol = host.includes('localhost') ? 'http' : 'http';
    const url = `${protocol}://${host}/uploads/board/${randomName}`;

    return {
      success: true,
      url,
      filename: randomName,
      size: buffer.length,
      createdAt: new Date().toISOString()
    };
  }

  async getTeachers(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return [];

    const teachers = await this.userRepository.find({
      where: {
        role: UserRole.TEACHER,
        academy: { id: academy.id }
      },
      order: { createdAt: 'DESC' }
    });

    return teachers.map(t => ({
      id: t.id,
      email: t.email,
      name: t.name,
      assignedClass: t.assignedClass || '',
      isLocked: !!t.isLocked,
      createdAt: t.createdAt
    }));
  }

  async unlockUser(userId?: number, email?: string) {
    let user: User | null = null;
    if (userId) {
      user = await this.userRepository.findOne({ where: { id: userId } });
    } else if (email) {
      user = await this.userRepository.findOne({ where: { email } });
    }

    if (!user) {
      throw new BadRequestException('해당 사용자를 찾을 수 없습니다.');
    }

    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockedAt = null;
    await this.userRepository.save(user);

    return { 
      success: true, 
      message: `${user.name || user.email} 님의 계정 잠금이 성공적으로 해제되었습니다.`,
      userId: user.id
    };
  }

  async assignTeacherClass(teacherId: number, assignedClass: string) {
    const teacher = await this.userRepository.findOne({ where: { id: teacherId } });
    if (!teacher) throw new BadRequestException('교사를 찾을 수 없습니다.');
    teacher.assignedClass = assignedClass || '';
    await this.userRepository.save(teacher);
    return { success: true, teacherId: teacher.id, assignedClass: teacher.assignedClass };
  }

  async getTeacherProfile(teacherId: number) {
    const teacher = await this.userRepository.findOne({
      where: { id: teacherId },
      relations: { academy: true }
    });
    if (!teacher) throw new BadRequestException('교사를 찾을 수 없습니다.');
    return {
      id: teacher.id,
      email: teacher.email,
      name: teacher.name,
      role: teacher.role,
      assignedClass: teacher.assignedClass || '',
      academyId: teacher.academy?.id,
      academyName: teacher.academy?.name
    };
  }
}
