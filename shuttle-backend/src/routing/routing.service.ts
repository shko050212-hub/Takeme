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
import { AuditLog } from '../entities/audit-log.entity';
import { Between } from 'typeorm';
import * as ExcelJS from 'exceljs';
import {
  S3_REF_PREFIX,
  isS3Enabled,
  resolveMediaRef,
  resolveMediaRefs,
  signS3Key,
  toStoredMediaRef,
  toStoredMediaRefs,
  uploadToS3,
} from '../utils/s3.util';
import { getStudentClassName, hasAssignedClass, isSameClass, HOMEROOM_ROLE, kstDateString, isValidDateString } from '../utils/school.util';
import { Attendance, AttendanceStatus } from '../entities/attendance.entity';
import { AttendanceSubmission } from '../entities/attendance-submission.entity';

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
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    @InjectRepository(Attendance)
    private attendanceRepository: Repository<Attendance>,
    @InjectRepository(AttendanceSubmission)
    private submissionRepository: Repository<AttendanceSubmission>,
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

    const cleanCandidates: string[] = [];
    const raw = String(address).trim();
    cleanCandidates.push(raw);

    // Extract region if present (e.g., '경기도 양주시')
    const regionMatch = raw.match(/^([가-힣]+(?:시|도)\s+[가-힣]+(?:구|군|시))/);
    const region = regionMatch ? regionMatch[1] : '';

    // 1. Inside parentheses: apartment / complex / building name
    const parenMatch = raw.match(/\(([^)]+)\)/);
    if (parenMatch) {
      let inside = parenMatch[1]
        .replace(/\d+\s*동\s*\d+\s*호/g, '')
        .replace(/\d+\s*동/g, '')
        .replace(/\d+\s*호/g, '')
        .replace(/\d+\s*-\s*\d+/g, '')
        .trim();
      if (inside) {
        if (region) cleanCandidates.push(`${region} ${inside}`);
        cleanCandidates.push(inside);
      }
    }

    // 2. Without parentheses and without unit details
    let withoutParen = raw.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
    withoutParen = withoutParen
      .replace(/\d+\s*동\s*\d+\s*호/g, '')
      .replace(/\d+\s*동/g, '')
      .replace(/\d+\s*호/g, '')
      .replace(/\d+\s*-\s*\d+/g, '')
      .trim();
    if (withoutParen && !cleanCandidates.includes(withoutParen)) {
      cleanCandidates.push(withoutParen);
    }

    // 3. Road address pattern (시/도 + 시/군/구 + 도로명 + 번호)
    const roadMatch = withoutParen.match(/([가-힣]+(?:시|도)?\s*[가-힣]+(?:구|군|시)?\s*[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?)/);
    if (roadMatch && !cleanCandidates.includes(roadMatch[1])) {
      cleanCandidates.push(roadMatch[1]);
    }

    // 4. Road without number (fallback if building number is missing or non-standard)
    const roadNoNumMatch = withoutParen.match(/([가-힣]+(?:시|도)?\s*[가-힣]+(?:구|군|시)?\s*[가-힣0-9]+(?:로|길))/);
    if (roadNoNumMatch && !cleanCandidates.includes(roadNoNumMatch[1])) {
      cleanCandidates.push(roadNoNumMatch[1]);
    }

    // 5. Town / Dong pattern (시/도 + 시/군/구 + 읍/면/동)
    const dongMatch = withoutParen.match(/([가-힣]+(?:시|도)?\s*[가-힣]+(?:구|군|시)?\s*[가-힣0-9]+(?:읍|면|동))/);
    if (dongMatch && !cleanCandidates.includes(dongMatch[1])) {
      cleanCandidates.push(dongMatch[1]);
    }

    const uniqueCandidates = Array.from(new Set(cleanCandidates.filter(Boolean)));

    for (const query of uniqueCandidates) {
      if (!query) continue;
      // 1. Kakao address search
      try {
        const response = await firstValueFrom(
          this.httpService.get('https://dapi.kakao.com/v2/local/search/address.json', {
            params: { query },
            headers: { Authorization: `KakaoAK ${apiKey}` }
          })
        );
        const docs = response.data?.documents;
        if (docs && docs.length > 0) {
          const x = parseFloat(docs[0].x);
          const y = parseFloat(docs[0].y);
          if (!isNaN(x) && !isNaN(y)) {
            return { lat: y, lng: x };
          }
        }
      } catch (e) {}

      // 2. Kakao keyword search
      try {
        const kw = query.replace(/앞|뒤|옆|근처|건너편|인근/g, '').trim();
        const kwResponse = await firstValueFrom(
          this.httpService.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
            params: { query: kw },
            headers: { Authorization: `KakaoAK ${apiKey}` }
          })
        );
        const kwDocs = kwResponse.data?.documents;
        if (kwDocs && kwDocs.length > 0) {
          const x = parseFloat(kwDocs[0].x);
          const y = parseFloat(kwDocs[0].y);
          if (!isNaN(x) && !isNaN(y)) {
            return { lat: y, lng: x };
          }
        }
      } catch (e) {}
    }

    // 3. Fallback: Naver Cloud Geocoding API if NCP keys are configured
    const naverClientId = this.configService.get<string>('NAVER_CLIENT_ID') || this.configService.get<string>('NCP_CLIENT_ID');
    const naverClientSecret = this.configService.get<string>('NAVER_CLIENT_SECRET') || this.configService.get<string>('NCP_CLIENT_SECRET');
    if (naverClientId && naverClientSecret && naverClientId !== 'TEST_KEY') {
      for (const query of uniqueCandidates) {
        try {
          const nResponse = await firstValueFrom(
            this.httpService.get('https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode', {
              params: { query },
              headers: {
                'X-NCP-APIGW-API-KEY-ID': naverClientId,
                'X-NCP-APIGW-API-KEY': naverClientSecret,
              }
            })
          );
          const addrs = nResponse.data?.addresses;
          if (addrs && addrs.length > 0) {
            const x = parseFloat(addrs[0].x);
            const y = parseFloat(addrs[0].y);
            if (!isNaN(x) && !isNaN(y)) {
              return { lat: y, lng: x };
            }
          }
        } catch (e) {}
      }
    }

    console.warn(`[geocodeAddress] 주소 변환 실패: ${address}`);
    return null;
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
  private routeUpdateNotifier?: (academyId?: number, message?: string) => void;

  public registerRouteUpdateNotifier(fn: (academyId?: number, message?: string) => void) {
    this.routeUpdateNotifier = fn;
  }

  public notifyRouteUpdated(academyId?: number, message?: string) {
    try {
      this.routeUpdateNotifier?.(academyId, message);
    } catch {}
  }

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
    return this.academyRepository.findOne({ where: {}, order: { id: 'DESC' } });
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

    // 1. Preserve existing vehicles, drivers, teachers, and students (Non-destructive update)
    const existingVehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } },
      relations: { driverUser: true, teacherUser: true },
      order: { id: 'ASC' },
    });

    const existingVehicleMap = new Map<string, Vehicle>();
    existingVehicles.forEach((ev, idx) => {
      if (ev.busNumber) {
        existingVehicleMap.set(ev.busNumber, ev);
        const numOnly = ev.busNumber.replace(/[^0-9]/g, '');
        if (numOnly) existingVehicleMap.set(numOnly, ev);
      }
    });

    const savedVehicles: any[] = [];
    const vehiclePointsMap: Record<string, any> = {};

    // Only adopt kindergarten name from Excel if there is NO existing saved name
    const existingAcademyName = academy.name && academy.name.trim() !== '' ? academy.name.trim() : '';
    if (!existingAcademyName) {
      for (const row of parsedData) {
        const kName = row['유치원명'] || row['소속원명'] || row['학교명'];
        if (kName && String(kName).trim()) {
          academy.name = String(kName).trim();
          await this.academyRepository.save(academy);
          break;
        }
      }
    }

    // 2. Synchronize Vehicles: Reuse existing vehicles to preserve IDs, driver/teacher user links and approvals
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const busNum = v.busNumber || `${i + 1}호차`;
      const numOnly = busNum.replace(/[^0-9]/g, '');
      const existing = existingVehicleMap.get(busNum) || (numOnly ? existingVehicleMap.get(numOnly) : undefined) || existingVehicles[i];

      let targetVehicle: Vehicle;
      if (existing) {
        // Reuse existing vehicle record to preserve IDs, driver/teacher relations and approval statuses
        existing.busNumber = busNum;
        if ((!existing.plateNumber || existing.plateNumber.trim() === '') && v.plateNumber && v.plateNumber.trim()) {
          existing.plateNumber = v.plateNumber;
        }
        if (v.capacity && !existing.capacity) {
          existing.capacity = Number(v.capacity) || 25;
        }

        // ONLY bring driver/teacher info if there is NO existing saved data in DB
        const hasExistingDriver = existing.driverName && existing.driverName !== '미정';
        if (!hasExistingDriver && v.driverName && v.driverName !== '미정') {
          existing.driverName = v.driverName;
        }
        const hasExistingDriverPhone = existing.driverPhone && existing.driverPhone !== '000-0000-0000';
        if (!hasExistingDriverPhone && v.driverPhone && v.driverPhone !== '000-0000-0000') {
          existing.driverPhone = v.driverPhone;
        }
        const hasExistingTeacher = existing.teacherName && existing.teacherName !== '미정';
        if (!hasExistingTeacher && v.teacherName && v.teacherName !== '미정') {
          existing.teacherName = v.teacherName;
        }
        const hasExistingTeacherPhone = existing.teacherPhone && existing.teacherPhone !== '000-0000-0000';
        if (!hasExistingTeacherPhone && v.teacherPhone && v.teacherPhone !== '000-0000-0000') {
          existing.teacherPhone = v.teacherPhone;
        }

        if (!existing.colorHex) existing.colorHex = this.getDistinctColor();
        targetVehicle = await this.vehicleRepository.save(existing);
      } else {
        // Create new vehicle if more vehicles needed
        const newVehicle = this.vehicleRepository.create({
          busNumber: busNum,
          plateNumber: v.plateNumber || '',
          driverName: v.driverName || '미정',
          driverPhone: v.driverPhone || '000-0000-0000',
          teacherName: v.teacherName || '미정',
          teacherPhone: v.teacherPhone || '000-0000-0000',
          capacity: Number(v.capacity) || 25,
          academy: academy,
          colorHex: this.getDistinctColor(),
          driverApprovalStatus: 'UNREGISTERED',
          teacherApprovalStatus: 'UNREGISTERED',
        });
        targetVehicle = await this.vehicleRepository.save(newVehicle);
      }

      const vehicleObj = {
        id: targetVehicle.id,
        name: targetVehicle.busNumber,
        color: targetVehicle.colorHex || this.getDistinctColor(),
        points: []
      };
      savedVehicles.push(vehicleObj);
      vehiclePointsMap[busNum] = vehicleObj;
      if (numOnly) vehiclePointsMap[numOnly] = vehicleObj;
    }

    academy.vehicleCount = savedVehicles.length;
    await this.academyRepository.save(academy);

    // 3. Geocode Addresses and Associate with Vehicles (with caching & parallel batch pre-fetch)
    const geocodeCache = new Map<string, { lat: number, lng: number } | null>();

    const uniqueLocations = new Set<string>();
    for (const row of parsedData) {
      const inLocation = row['등원지'] || row['탑승지'] || row['승차지'] || row['승차지(주소)'] || row['주소'] || row['도로명주소'];
      const outLocation = row['하원지'] || row['하차지'] || row['하차지(주소)'] || row['주소'] || row['도로명주소'];
      if (inLocation && inLocation.toString().trim()) uniqueLocations.add(inLocation.toString().trim());
      if (outLocation && outLocation.toString().trim()) uniqueLocations.add(outLocation.toString().trim());
    }

    const locArray = Array.from(uniqueLocations);
    const BATCH_SIZE = 15;
    for (let i = 0; i < locArray.length; i += BATCH_SIZE) {
      const batch = locArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (addr) => {
        try {
          const res = await this.geocodeAddress(addr);
          geocodeCache.set(addr, res);
        } catch (e) {
          geocodeCache.set(addr, null);
        }
      }));
    }

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

    const allGeocodedPoints: [number, number][] = [];

    for (const row of parsedData) {
      const inBusRaw = row['등원차량'] || row['차량'] || row['호차'] || row['등원_차량'];
      const inBusName = inBusRaw ? inBusRaw.toString().trim() : null;
      const inLocation = row['등원지'] || row['탑승지'] || row['승차지'] || row['승차지(주소)'] || row['주소'] || row['도로명주소'];

      const outBusRaw = row['하원차량'] || row['차량'] || row['호차'] || row['하원_차량'];
      const outBusName = outBusRaw ? outBusRaw.toString().trim() : null;
      const outLocation = row['하원지'] || row['하차지'] || row['하차지(주소)'] || row['주소'] || row['도로명주소'];

      const inTarget = inBusName ? findTargetVehicle(inBusName) : null;
      if (inLocation) {
        const coords = await geocodeWithCache(inLocation.toString());
        if (coords) {
          allGeocodedPoints.push([coords.lat, coords.lng]);
          if (inTarget) {
            const exists = inTarget.points.some((p: any) => p[0] === coords.lat && p[1] === coords.lng);
            if (!exists) inTarget.points.push([coords.lat, coords.lng]);
          }
        }
      }

      const outTarget = outBusName ? findTargetVehicle(outBusName) : null;
      if (outLocation && outLocation !== inLocation) {
        const coords = await geocodeWithCache(outLocation.toString());
        if (coords) {
          allGeocodedPoints.push([coords.lat, coords.lng]);
          if (outTarget) {
            const exists = outTarget.points.some((p: any) => p[0] === coords.lat && p[1] === coords.lng);
            if (!exists) outTarget.points.push([coords.lat, coords.lng]);
          }
        }
      }
    }

    // Academy center coordinates (or average of points)
    let centerLat = parseFloat(academy.latitude);
    let centerLng = parseFloat(academy.longitude);
    if ((isNaN(centerLat) || isNaN(centerLng)) && allGeocodedPoints.length > 0) {
      centerLat = allGeocodedPoints.reduce((sum, p) => sum + p[0], 0) / allGeocodedPoints.length;
      centerLng = allGeocodedPoints.reduce((sum, p) => sum + p[1], 0) / allGeocodedPoints.length;
    }
    if (isNaN(centerLat) || isNaN(centerLng)) {
      centerLat = 37.5665;
      centerLng = 126.9780;
    }

    const nVehicles = savedVehicles.length;

    // Check if points were explicitly assigned via vehicle columns
    const totalPointsAssigned = savedVehicles.reduce((sum, v) => sum + v.points.length, 0);

    // If no vehicle columns were present in Excel, partition allGeocodedPoints among the vehicles using 2D K-Means
    if (totalPointsAssigned === 0 && allGeocodedPoints.length > 0 && nVehicles > 0) {
      // Deduplicate points and exclude center academy point if present
      const pointMap = new Map<string, [number, number]>();
      for (const pt of allGeocodedPoints) {
        if (!isNaN(centerLat) && !isNaN(centerLng)) {
          const dFromCenter = this.getDistanceKm(pt[0], pt[1], centerLat, centerLng);
          if (dFromCenter < 0.05) continue; // Skip academy point itself
        }
        pointMap.set(`${pt[0].toFixed(5)},${pt[1].toFixed(5)}`, pt);
      }
      const uniquePoints = Array.from(pointMap.values());

      const clusters = this.clusterPointsKMeans(uniquePoints, nVehicles, centerLat);
      for (let i = 0; i < nVehicles; i++) {
        if (clusters[i]) {
          for (const item of clusters[i]) {
            savedVehicles[i].points.push(item);
          }
        }
      }
    }

    // 4. Form dedicated, non-overlapping contiguous vehicle zones
    // Boundaries touch along shared borders, never overlap (0% invasion), and never anchor to the center kindergarten
    const partitionedPolygons = this.partitionVehicleZones(
      savedVehicles.map(v => v.points),
      1.8 // Realistic neighborhood service sector coverage (~2.5km to ~5km span)
    );

    for (let i = 0; i < nVehicles; i++) {
      const v = savedVehicles[i];
      v.points = partitionedPolygons[i] || [];
      v.polygon = v.points;

      // Update DB with polygon points (TypeORM simple-json handles serialization)
      const vehicleToUpdate = await this.vehicleRepository.findOne({ where: { id: v.id } });
      if (vehicleToUpdate) {
        vehicleToUpdate.colorHex = v.color;
        vehicleToUpdate.polygonCoordinates = v.points;
        await this.vehicleRepository.save(vehicleToUpdate);
      }
    }

    // 5. Merge existing students into newly mapped vehicle zones
    const existingStudents = await this.studentRepository.find({
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true }
    });

    if (existingStudents.length > 0) {
      const currentVehicles = await this.vehicleRepository.find({
        where: { academy: { id: academy.id } }
      });

      const vehiclePolyList = currentVehicles.map(v => {
        let pts: [number, number][] = [];
        try {
          pts = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : (v.polygonCoordinates || []);
        } catch (e) {}
        return { vehicle: v, points: pts };
      });

      for (const student of existingStudents) {
        let targetVehicle: Vehicle | null = null;
        let sLat = student.latitude;
        let sLng = student.longitude;

        if ((sLat === undefined || sLat === null || isNaN(sLat) || sLng === undefined || sLng === null || isNaN(sLng)) && (student.boardingLocation || student.address)) {
          const addr = student.boardingLocation || student.address;
          const coords = await geocodeWithCache(addr);
          if (coords) {
            sLat = coords.lat;
            sLng = coords.lng;
            student.latitude = sLat;
            student.longitude = sLng;
          }
        }

        if (sLat !== undefined && sLat !== null && !isNaN(sLat) && sLng !== undefined && sLng !== null && !isNaN(sLng)) {
          // 1. Check if student coordinate is inside any vehicle polygon
          for (const vp of vehiclePolyList) {
            if (vp.points.length >= 3 && this.isPointInPolygon([sLat, sLng], vp.points)) {
              targetVehicle = vp.vehicle;
              break;
            }
          }

          // 2. Fallback: closest vehicle polygon by minimum distance to polygon points
          if (!targetVehicle) {
            let minDistance = Infinity;
            for (const vp of vehiclePolyList) {
              if (vp.points.length > 0) {
                for (const pt of vp.points) {
                  const dist = this.getDistanceKm(sLat, sLng, pt[0], pt[1]);
                  if (dist < minDistance) {
                    minDistance = dist;
                    targetVehicle = vp.vehicle;
                  }
                }
              }
            }
          }
        }

        // 3. Fallback: retain current vehicle or assign to first vehicle
        if (!targetVehicle) {
          targetVehicle = student.assignedVehicle || (currentVehicles.length > 0 ? currentVehicles[0] : null);
        }

        if (targetVehicle) {
          student.assignedVehicle = targetVehicle;
          if (student.raw && typeof student.raw === 'object') {
            student.raw['등원차량'] = targetVehicle.busNumber;
            student.raw['하원차량'] = targetVehicle.busNumber;
            if (academy.name && academy.name.trim()) {
              student.raw['유치원명'] = academy.name.trim();
              student.raw['학교명'] = academy.name.trim();
            }
          }
        }
      }

      await this.studentRepository.save(existingStudents);

      // Synchronize student_schedules to the newly assigned vehicles
      for (const st of existingStudents) {
        if (st.assignedVehicle) {
          await this.studentRepository.query(
            `UPDATE student_schedules SET "assignedVehicleId" = $1 WHERE "studentId" = $2`,
            [st.assignedVehicle.id, st.id]
          ).catch(() => {});
        }
      }
    }

    this.notifyRouteUpdated(academy.id);
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
      let parsedPoints = v.polygonCoordinates;
      while (typeof parsedPoints === 'string') {
        try { parsedPoints = JSON.parse(parsedPoints); } catch(e) { break; }
      }
      if (!Array.isArray(parsedPoints)) parsedPoints = [];
      
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
    let formattedStudents = dbStudents.map(st => {
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
        parentPhone: st.parentUser?.phone || parsedRaw['부모연락처'] || parsedRaw['연락처'] || parsedRaw['보호자연락처'] || parsedRaw['보호자 연락처'] || parsedRaw['전화번호'] || parsedRaw['학부모전화번호'] || '',
        parentName: st.parentUser?.name || parsedRaw['보호자 성함'] || parsedRaw['학부모 성함'] || parsedRaw['학부모명'] || '',
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

    if (userId) {
      const callingUser = await this.userRepository.findOne({ where: { id: userId } });
      if (callingUser && ((callingUser.role as string) === 'HOMEROOM_TEACHER' || callingUser.role === UserRole.HOMEROOM_TEACHER)) {
        const assignedClass = callingUser.assignedClass;
        if (!hasAssignedClass(assignedClass)) {
          formattedStudents = [];
        } else {
          formattedStudents = formattedStudents.filter(s => isSameClass(getStudentClassName(s), assignedClass));
        }
      }
    }

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

    await this.logAudit({
      action: 'STUDENT_APPROVE',
      targetType: 'STUDENT',
      targetId: String(studentId),
      details: `원생(${student.name}) 승인 완료`,
    });

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
    
    await this.logAudit({
      action: 'STUDENT_REVOKE',
      targetType: 'STUDENT',
      targetId: String(studentId),
      details: `원생(${student.name}) 등록 해제 및 연동 계정 삭제`,
    });

    return { success: true };
  }

  async approveStaff(vehicleId: number, role: 'DRIVER' | 'TEACHER') {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');
    
    if (role === 'DRIVER') vehicle.driverApprovalStatus = 'APPROVED';
    if (role === 'TEACHER') vehicle.teacherApprovalStatus = 'APPROVED';
    
    await this.vehicleRepository.save(vehicle);

    await this.logAudit({
      action: 'STAFF_APPROVE',
      targetType: 'VEHICLE_STAFF',
      targetId: String(vehicleId),
      details: `차량(${vehicle.busNumber || vehicleId}) 교직원 승인 (역할: ${role})`,
    });

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
    
    await this.logAudit({
      action: 'STAFF_REVOKE',
      targetType: 'VEHICLE_STAFF',
      targetId: String(vehicleId),
      details: `차량(${vehicle.busNumber || vehicleId}) 교직원 해제 (역할: ${role})`,
    });

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

    const teacherName = teacher.name || teacher.email;
    await this.userRepository.remove(teacher);

    await this.logAudit({
      action: 'TEACHER_REVOKE',
      targetType: 'TEACHER',
      targetId: String(teacherId),
      details: `선생님(${teacherName}, ID: ${teacherId}) 등록 해제 및 계정 삭제`,
    });

    return { success: true };
  }

  async setupAcademy(data: { name: string, address: string, lat: number, lng: number, businessNumber?: string }, academyId?: number, userId?: number) {
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
        businessNumber: data.businessNumber || null,
        authCode: code
      });
    } else {
      academy.name = data.name;
      academy.roadAddress = data.address;
      academy.latitude = data.lat.toString();
      academy.longitude = data.lng.toString();
      if (data.businessNumber !== undefined) {
        academy.businessNumber = data.businessNumber;
      }
      if (!academy.authCode) {
        let code = Math.random().toString(36).substring(2, 8).toUpperCase();
        while (await this.academyRepository.findOne({ where: { authCode: code } })) {
          code = Math.random().toString(36).substring(2, 8).toUpperCase();
        }
        academy.authCode = code;
      }
    }
    const savedAcademy = await this.academyRepository.save(academy);
    this.notifyRouteUpdated(savedAcademy.id);
    return savedAcademy;
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

  private generateZonePolygon(points: [number, number][], bufferKm: number = 1.8): [number, number][] {
    if (!points || points.length === 0) return [];

    // Deduplicate points
    const pointMap = new Map<string, [number, number]>();
    for (const p of points) {
      if (Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) {
        pointMap.set(`${p[0].toFixed(5)},${p[1].toFixed(5)}`, [p[0], p[1]]);
      }
    }
    const uniquePoints = Array.from(pointMap.values());
    if (uniquePoints.length === 0) return [];

    // Generous service buffer around student stops (~1.8km radius for realistic neighborhood sector)
    // 1 deg lat ≈ 111.0 km, 1 deg lng ≈ 111.0 * cos(lat) ≈ 88.0 km in Korea
    const avgLat = uniquePoints.reduce((s, p) => s + p[0], 0) / uniquePoints.length;
    const dLat = bufferKm / 111.0;
    const cosLat = Math.cos((avgLat * Math.PI) / 180);
    const dLng = bufferKm / (111.0 * (cosLat > 0.1 ? cosLat : 0.8));

    const expandedPoints: [number, number][] = [];
    for (const p of uniquePoints) {
      const lat = p[0];
      const lng = p[1];
      // 12-direction expansion for smooth natural perimeter
      for (let a = 0; a < 12; a++) {
        const rad = (a * 2 * Math.PI) / 12;
        expandedPoints.push([
          lat + dLat * Math.sin(rad),
          lng + dLng * Math.cos(rad)
        ]);
      }
    }

    const hull = this.computeConvexHull(expandedPoints);
    return hull && hull.length >= 3 ? hull : expandedPoints.slice(0, 4);
  }

  // Sutherland-Hodgman polygon clipping against a perpendicular bisector half-plane
  private clipPolygonWithHalfPlane(
    poly: [number, number][],
    c1: [number, number],
    c2: [number, number],
    cosLat: number
  ): [number, number][] {
    if (!poly || poly.length < 3) return poly;

    // Vector from c1 to c2 in metric-proportional coords
    const dx = (c2[1] - c1[1]) * cosLat;
    const dy = c2[0] - c1[0];

    // Midpoint M
    const mx = ((c1[1] + c2[1]) / 2) * cosLat;
    const my = (c1[0] + c2[0]) / 2;

    // Inside test: a point P is on c1's side if dot(P - M, C2 - C1) <= 0
    const isInside = (p: [number, number]) => {
      const px = p[1] * cosLat;
      const py = p[0];
      const dot = (px - mx) * dx + (py - my) * dy;
      return dot <= 0.0000001;
    };

    // Line intersection between edge (p1, p2) and the bisector line
    const intersect = (p1: [number, number], p2: [number, number]): [number, number] => {
      const p1x = p1[1] * cosLat, p1y = p1[0];
      const p2x = p2[1] * cosLat, p2y = p2[0];
      const d1 = (p1x - mx) * dx + (p1y - my) * dy;
      const d2 = (p2x - mx) * dx + (p2y - my) * dy;
      if (Math.abs(d1 - d2) < 1e-12) return p1;
      const t = d1 / (d1 - d2);
      return [
        p1[0] + t * (p2[0] - p1[0]),
        p1[1] + t * (p2[1] - p1[1])
      ];
    };

    const output: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const curr = poly[i];
      const prev = poly[(i + poly.length - 1) % poly.length];

      const currIn = isInside(curr);
      const prevIn = isInside(prev);

      if (currIn) {
        if (!prevIn) output.push(intersect(prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(intersect(prev, curr));
      }
    }

    return output;
  }

  // Generates dedicated, realistic, large zones for all vehicles that:
  // 1. Cover extensive neighborhood service sectors (~2.5km to ~5.0km span)
  // 2. Meet seamlessly at shared borders (서로 맞닿아 있음)
  // 3. Strictly never overlap (침범 0%)
  private partitionVehicleZones(vehiclePointsList: [number, number][][], bufferKm: number = 1.8): [number, number][][] {
    const n = vehiclePointsList.length;
    if (n === 0) return [];
    if (n === 1) {
      return [this.generateZonePolygon(vehiclePointsList[0], bufferKm)];
    }

    // 1. Compute cluster centroid for each vehicle
    const centroids: ([number, number] | null)[] = vehiclePointsList.map(pts => {
      if (!pts || pts.length === 0) return null;
      const avgLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const avgLng = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return [avgLat, avgLng];
    });

    const validCentroids = centroids.filter((c): c is [number, number] => c !== null);
    const avgLat = validCentroids.length > 0 
      ? validCentroids.reduce((s, c) => s + c[0], 0) / validCentroids.length 
      : 37.8;
    const cosLat = Math.cos((avgLat * Math.PI) / 180);

    // 2. Expand each vehicle's student stops with generous service buffer
    const initialPolygons = vehiclePointsList.map((pts, idx) => {
      if (!pts || pts.length === 0) {
        if (centroids[idx]) return this.generateZonePolygon([centroids[idx]!], bufferKm);
        return [];
      }
      return this.generateZonePolygon(pts, bufferKm);
    });

    // 3. Clip each vehicle's polygon against the bisector half-planes of all other vehicles
    // Mathematically guarantees:
    // - ZERO overlap between any two vehicle zones (interiors are disjoint)
    // - Adjacent zones TOUCH seamlessly along the bisector boundary
    const clippedPolygons: [number, number][][] = [];
    for (let i = 0; i < n; i++) {
      let poly = initialPolygons[i];
      const c1 = centroids[i];
      if (!c1 || poly.length < 3) {
        clippedPolygons.push(poly);
        continue;
      }

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const c2 = centroids[j];
        if (!c2) continue;

        poly = this.clipPolygonWithHalfPlane(poly, c1, c2, cosLat);
        if (poly.length < 3) break;
      }

      clippedPolygons.push(this.computeConvexHull(poly));
    }

    return clippedPolygons;
  }

  private clusterPointsKMeans(points: [number, number][], k: number, centerLat: number): [number, number][][] {
    if (points.length === 0 || k <= 0) return [];
    if (k === 1) return [points];
    if (points.length <= k) {
      return points.map(p => [p]);
    }

    const cosLat = Math.cos((centerLat * Math.PI) / 180);
    const distSq = (a: [number, number], b: [number, number]) => {
      const dLat = a[0] - b[0];
      const dLng = (a[1] - b[1]) * cosLat;
      return dLat * dLat + dLng * dLng;
    };

    // 1. K-Means++ initialization: pick initial centroids spread widely across the points
    const centroids: [number, number][] = [];
    let firstIdx = 0;
    let maxDistFromCenter = -1;
    for (let i = 0; i < points.length; i++) {
      const d = distSq(points[i], [centerLat, points[i][1]]);
      if (d > maxDistFromCenter) {
        maxDistFromCenter = d;
        firstIdx = i;
      }
    }
    centroids.push([...points[firstIdx]]);

    while (centroids.length < k) {
      let maxDist = -1;
      let nextCentroidIdx = 0;
      for (let i = 0; i < points.length; i++) {
        let minDistToExisting = Infinity;
        for (const c of centroids) {
          const d = distSq(points[i], c);
          if (d < minDistToExisting) {
            minDistToExisting = d;
          }
        }
        if (minDistToExisting > maxDist) {
          maxDist = minDistToExisting;
          nextCentroidIdx = i;
        }
      }
      centroids.push([...points[nextCentroidIdx]]);
    }

    // 2. Iterative optimization
    let clusters: [number, number][][] = Array.from({ length: k }, () => []);
    const maxIterations = 35;

    for (let iter = 0; iter < maxIterations; iter++) {
      clusters = Array.from({ length: k }, () => []);

      for (const p of points) {
        let minDist = Infinity;
        let bestCluster = 0;
        for (let j = 0; j < k; j++) {
          const d = distSq(p, centroids[j]);
          if (d < minDist) {
            minDist = d;
            bestCluster = j;
          }
        }
        clusters[bestCluster].push(p);
      }

      let maxCentroidShift = 0;
      for (let j = 0; j < k; j++) {
        if (clusters[j].length > 0) {
          const sumLat = clusters[j].reduce((s, p) => s + p[0], 0);
          const sumLng = clusters[j].reduce((s, p) => s + p[1], 0);
          const newLat = sumLat / clusters[j].length;
          const newLng = sumLng / clusters[j].length;
          const shift = distSq(centroids[j], [newLat, newLng]);
          if (shift > maxCentroidShift) maxCentroidShift = shift;
          centroids[j] = [newLat, newLng];
        }
      }

      if (maxCentroidShift < 1e-10) break;
    }

    // 3. Balance empty clusters if any
    for (let j = 0; j < k; j++) {
      if (clusters[j].length === 0) {
        let maxClusterIdx = 0;
        let maxLen = 0;
        for (let m = 0; m < k; m++) {
          if (clusters[m].length > maxLen) {
            maxLen = clusters[m].length;
            maxClusterIdx = m;
          }
        }
        if (maxLen > 2) {
          let furthestIdx = 0;
          let furthestDist = -1;
          for (let pIdx = 0; pIdx < clusters[maxClusterIdx].length; pIdx++) {
            const d = distSq(clusters[maxClusterIdx][pIdx], centroids[maxClusterIdx]);
            if (d > furthestDist) {
              furthestDist = d;
              furthestIdx = pIdx;
            }
          }
          const moved = clusters[maxClusterIdx].splice(furthestIdx, 1)[0];
          clusters[j].push(moved);
        }
      }
    }

    return clusters;
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

    // Preserve existing academy name: only adopt from Excel if no existing saved name
    const existingAcademyName = academy.name && academy.name.trim() !== '' ? academy.name.trim() : '';
    if (!existingAcademyName) {
      for (const st of students) {
        let r = st.raw;
        if (typeof r === 'string') { try { r = JSON.parse(r); } catch(e){} }
        const k = r && (r['유치원명'] || r['소속원명'] || r['학교명']);
        if (k && String(k).trim()) {
          academy.name = String(k).trim();
          await this.academyRepository.save(academy);
          break;
        }
      }
    }
    const currentAcademyName = academy.name && academy.name.trim() !== '' ? academy.name.trim() : '';

    // Query existing teachers for this academy to preserve homeroom teachers
    const existingTeachers = await this.userRepository.find({
      where: [
        { role: UserRole.TEACHER, academy: { id: academy.id } },
        { role: UserRole.HOMEROOM_TEACHER, academy: { id: academy.id } }
      ]
    });
    const classTeacherMap = new Map<string, string>();
    existingTeachers.forEach(t => {
      if (t.assignedClass && t.name && t.assignedClass !== '미배정') {
        classTeacherMap.set(t.assignedClass.trim(), t.name.trim());
      }
    });

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
      let rawObj = st.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
      }

      let adminDisplayName = st.name;
      const pPhone = (rawObj && (rawObj['부모연락처'] || rawObj['보호자연락처'] || rawObj['보호자 연락처'] || rawObj['연락처'] || rawObj['전화번호'])) || (st as any).parentPhone || '';
      if (multipleNames.has(st.name)) {
        adminDisplayName = pPhone ? `${st.name}(${String(pPhone).trim()})` : st.name;
      }
      if (rawObj && typeof rawObj === 'object') {
        const excelKName = rawObj['유치원명'] || rawObj['소속원명'] || rawObj['학교명'] || '';
        // If academy.name already exists, KEEP IT and do not overwrite with Excel!
        const kName = currentAcademyName || excelKName || '';
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

        // Preserve existing teacher data if available in DB
        const studentClass = (rawObj['반명'] || rawObj['반'] || '').toString().trim();
        const classTeacher = studentClass ? classTeacherMap.get(studentClass) : null;
        if (classTeacher) {
          rawObj['담임명'] = classTeacher;
        } else {
          rawObj['담임명'] = rawObj['담임명'] || rawObj['담임'] || '';
        }
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

    const acadLat = parseFloat(academy.latitude);
    const acadLng = parseFloat(academy.longitude);

    // Form clean, non-overlapping vehicle zones encompassing assigned students
    // Boundaries touch along shared borders, never overlap (0% invasion), and never anchor to the center kindergarten
    const vehiclePointsForPartition: [number, number][][] = [];
    for (const vehicle of vehicles) {
      const assignedStudents = newStudents.filter(
        st => st.assignedVehicle && st.assignedVehicle.id === vehicle.id && st.latitude && st.longitude
      );
      let existingPoints: [number, number][] = [];
      try {
        let rawPts = vehicle.polygonCoordinates;
        while (typeof rawPts === 'string') {
          try { rawPts = JSON.parse(rawPts); } catch(e) { break; }
        }
        if (Array.isArray(rawPts)) {
          existingPoints = rawPts.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) as [number, number][];
        }
      } catch (e) {}

      // Filter out academy center point if it was previously included
      existingPoints = existingPoints.filter(p => {
        if (isNaN(acadLat) || isNaN(acadLng)) return true;
        return this.getDistanceKm(p[0], p[1], acadLat, acadLng) > 0.08;
      });

      const studentPoints: [number, number][] = assignedStudents.map(st => [st.latitude!, st.longitude!]);
      vehiclePointsForPartition.push([...existingPoints, ...studentPoints]);
    }

    const updatedPolygons = this.partitionVehicleZones(vehiclePointsForPartition, 1.8);
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      if (updatedPolygons[i] && updatedPolygons[i].length >= 3) {
        v.polygonCoordinates = updatedPolygons[i];
        await this.vehicleRepository.save(v);
      }
    }

    this.notifyRouteUpdated(academy.id);
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
    // Expand assigned vehicle's polygon to encompass the new student's location
    // IMPORTANT: Never anchor or connect zones to the central kindergarten!
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

      const acadLat = parseFloat(academy.latitude);
      const acadLng = parseFloat(academy.longitude);
      existingPoints = existingPoints.filter(p => {
        if (isNaN(acadLat) || isNaN(acadLng)) return true;
        return this.getDistanceKm(p[0], p[1], acadLat, acadLng) > 0.08;
      });

      const pointsToHull: [number, number][] = [...existingPoints, [lat, lng]];
      const expandedPolygon = this.generateZonePolygon(pointsToHull);
      if (expandedPolygon && expandedPolygon.length >= 3) {
        vehicle.polygonCoordinates = JSON.stringify(expandedPolygon);
        await this.vehicleRepository.save(vehicle);
        zoneExpanded = true;
      }
    }

    // Format raw JSON containing kindergarten columns
    const departureType = studentData.departureType || studentData.raw?.['하원구분'] || studentData.raw?.['하원정보'] || '정규하원';
    // Preserve existing academy name if present
    const kindergartenName = (academy.name && academy.name.trim()) || studentData.kindergartenName || studentData.schoolName || studentData.raw?.['유치원명'] || studentData.raw?.['소속원명'] || studentData.raw?.['학교명'] || '';
    const parentPhone = studentData.parentPhone || studentData.raw?.['부모연락처'] || studentData.raw?.['보호자연락처'] || studentData.raw?.['보호자 연락처'] || '';
    const age = studentData.age || studentData.raw?.['연령'] || studentData.raw?.['학년'] || '';
    const className = studentData.className || studentData.raw?.['반명'] || '';

    // Check if class already has an existing assigned teacher in the system
    let teacherName = studentData.teacherName || studentData.raw?.['담임명'] || '';
    if (className) {
      const classTeacher = await this.userRepository.findOne({
        where: { academy: { id: academy.id }, assignedClass: className }
      });
      if (classTeacher && classTeacher.name) {
        teacherName = classTeacher.name; // Preserve existing teacher!
      }
    }

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

    // Duplicate name disambiguation (동명이인: 김민수(부모님 전화번호))
    const existingSameName = await this.studentRepository.find({
      where: { name: studentData.name, academy: { id: academy.id } }
    });
    let adminDisplayName = studentData.name;
    const currentPhone = studentData.parentPhone || studentData.phone || raw['부모연락처'] || raw['보호자연락처'] || '';
    if (existingSameName.length > 0) {
      adminDisplayName = currentPhone ? `${studentData.name}(${String(currentPhone).trim()})` : studentData.name;
      for (const exist of existingSameName) {
        if (!exist.adminDisplayName || !exist.adminDisplayName.includes('(')) {
          const existPhone = (exist as any).parentPhone || (exist.raw && (exist.raw['부모연락처'] || exist.raw['보호자연락처'] || exist.raw['연락처'] || exist.raw['전화번호']));
          if (existPhone) {
            exist.adminDisplayName = `${exist.name}(${String(existPhone).trim()})`;
            await this.studentRepository.save(exist).catch(() => {});
          }
        }
      }
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
    this.notifyRouteUpdated(academy.id);

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
    this.notifyRouteUpdated(academy.id);
    return { success: true };
  }

  async geocodeBulk(addresses: string[]) {
    if (!Array.isArray(addresses)) return [];
    const cache = new Map<string, { lat: number, lng: number } | null>();
    const results = [];
    for (const address of addresses) {
      if (!address || typeof address !== 'string' || !address.trim()) {
        results.push({ address: address || '', coords: null });
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
      results.push({ address: trimmed, coords });
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

    await this.logAudit({
      action: 'EXCEL_EXPORT',
      targetType: 'ACADEMY',
      targetId: academy ? String(academy.id) : (academyId ? String(academyId) : 'ALL'),
      details: `원생 명단 엑셀 다운로드 (유치원: ${academy ? academy.name : (academyId || '전체')})`,
    });

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
    const saved = await this.scheduleOverrideRepository.save(override);
    this.notifyRouteUpdated(undefined, `[결석 등록] ${student.name} 원아 결석이 등록되었습니다.`);
    return saved;
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
    this.notifyRouteUpdated(undefined, `[결석 취소] 원아 결석 처리가 취소되었습니다.`);
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
    const saved = await this.pickupPointRepository.save(point);
    const pushMsg = `[탑승지 추가 알림] 원장님이 새 탑승지 '${body.name}'을(를) 추가했습니다.`;
    await this.parentMessageRepository.save(
      this.parentMessageRepository.create({
        targetRoles: ['TEACHER', 'SHUTTLE_TEACHER'],
        message: pushMsg,
      }),
    ).catch(() => {});
    this.notifyRouteUpdated(academy.id, pushMsg);
    return saved;
  }

  async getPickupPoints(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return [];
    return this.pickupPointRepository.find({ where: { academy: { id: academy.id } } });
  }

  async deletePickupPoint(id: number) {
    const existing = await this.pickupPointRepository.findOne({
      where: { id },
      relations: { academy: true },
    }).catch(() => null);
    await this.pickupPointRepository.delete(id);
    const label = existing?.name ? `'${existing.name}' ` : '';
    const pushMsg = `[탑승지 삭제 알림] 원장님이 탑승지 ${label}항목을 삭제했습니다.`;
    await this.parentMessageRepository.save(
      this.parentMessageRepository.create({
        targetRoles: ['TEACHER', 'SHUTTLE_TEACHER'],
        message: pushMsg,
      }),
    ).catch(() => {});
    this.notifyRouteUpdated(existing?.academy?.id, pushMsg);
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
      qb.where('post.academyId = :academyId', { academyId: academy.id });
    } else {
      qb.where('1 = 0');
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

    if (userId) {
      const callingUser = await this.userRepository.findOne({ where: { id: userId } });
      if (callingUser && ((callingUser.role as string) === 'HOMEROOM_TEACHER' || callingUser.role === UserRole.HOMEROOM_TEACHER)) {
        const assignedClass = callingUser.assignedClass;
        if (!hasAssignedClass(assignedClass)) {
          qb.andWhere('1 = 0');
        } else {
          qb.andWhere('(post.visibility = :vAll OR post.targetClass = :tc)', { vAll: 'ALL', tc: assignedClass });
        }
      }
    }

    if (search && search.trim()) {
      qb.andWhere('(post.title ILIKE :kw OR post.content ILIKE :kw OR post.authorName ILIKE :kw)', { kw: `%${search.trim()}%` });
    }

    const posts = await qb.getMany();
    return Promise.all(posts.map(p => this.hydratePostMedia(p)));
  }

  private async hydratePostMedia(post: BoardPost): Promise<BoardPost> {
    if (!post) return post;
    const resolvedImageUrl = await resolveMediaRef(post.imageUrl);
    const resolvedImages = await resolveMediaRefs(post.images);
    return {
      ...post,
      imageUrl: resolvedImageUrl,
      images: resolvedImages,
    } as BoardPost;
  }

  async getBoardPostById(id: number) {
    const post = await this.boardPostRepository.findOne({
      where: { id },
      relations: { comments: true }
    });
    if (!post) throw new BadRequestException('게시글을 찾을 수 없습니다.');
    return this.hydratePostMedia(post);
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
    let targetClass = body.targetClass || null;
    let authorRole = body.authorRole || 'ADMIN';

    if (userId) {
      const callingUser = await this.userRepository.findOne({ where: { id: userId } });
      if (callingUser && ((callingUser.role as string) === 'HOMEROOM_TEACHER' || callingUser.role === UserRole.HOMEROOM_TEACHER)) {
        if (!hasAssignedClass(callingUser.assignedClass)) {
          throw new BadRequestException('관리자에게 반 배정을 요청하세요.');
        }
        targetClass = callingUser.assignedClass;
        authorRole = 'HOMEROOM_TEACHER';
      }
    }

    const post = this.boardPostRepository.create({
      title: body.title,
      content: body.content,
      imageUrl: toStoredMediaRef(body.imageUrl) || null,
      images: toStoredMediaRefs(body.images),
      authorName: body.authorName || '원장선생님',
      authorRole,
      visibility: body.visibility || 'ALL',
      targetClass,
      className: targetClass,
      academy: academy || undefined,
      likeCount: 0,
      likedUserIds: [],
    } as any);
    const saved = (await this.boardPostRepository.save(post)) as unknown as BoardPost;
    return this.hydratePostMedia(saved);
  }

  async updateBoardPost(id: number, body: {
    title?: string;
    content?: string;
    imageUrl?: string;
    images?: string[];
    visibility?: string;
    targetClass?: string;
  }) {
    const post = await this.boardPostRepository.findOne({ where: { id } });
    if (!post) throw new BadRequestException('게시글을 찾을 수 없습니다.');
    if (body.title !== undefined) post.title = body.title;
    if (body.content !== undefined) post.content = body.content;
    if (body.imageUrl !== undefined) (post as any).imageUrl = toStoredMediaRef(body.imageUrl) || null;
    if (body.images !== undefined) post.images = toStoredMediaRefs(body.images);
    if (body.visibility !== undefined) post.visibility = body.visibility;
    if (body.targetClass !== undefined) post.targetClass = body.targetClass;
    const saved = (await this.boardPostRepository.save(post)) as unknown as BoardPost;
    return this.hydratePostMedia(saved);
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
    let ext = '';
    let detectedMime = 'image/jpeg';

    if (base64String.includes(';base64,')) {
      const parts = base64String.split(';base64,');
      const mime = parts[0].replace('data:', '');
      detectedMime = mime;
      if (mime.includes('png')) ext = 'png';
      else if (mime.includes('webp')) ext = 'webp';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
      base64String = parts[1];
    } else if (data.mimeType) {
      detectedMime = data.mimeType;
      if (data.mimeType.includes('png')) ext = 'png';
      else if (data.mimeType.includes('webp')) ext = 'webp';
      else if (data.mimeType.includes('jpeg') || data.mimeType.includes('jpg')) ext = 'jpg';
    }

    if (!ext && data.filename) {
      const fileExt = path.extname(data.filename).toLowerCase().replace('.', '');
      if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExt)) {
        ext = fileExt === 'jpeg' ? 'jpg' : fileExt;
        if (ext === 'png') detectedMime = 'image/png';
        else if (ext === 'webp') detectedMime = 'image/webp';
        else detectedMime = 'image/jpeg';
      }
    }

    if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      throw new BadRequestException('jpg, png, webp 형식의 이미지만 업로드할 수 있습니다.');
    }

    const buffer = Buffer.from(base64String, 'base64');
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    if (buffer.length > MAX_SIZE) {
      throw new BadRequestException('파일 크기는 10MB를 초과할 수 없습니다.');
    }

    const randomName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;

    // S3 사용 (AWS_S3_BUCKET + AWS_REGION): 파일 키를 돌려주고, 화면 표시용 서명 URL 은 조회할 때마다 새로 만든다.
    if (isS3Enabled()) {
      try {
        const s3Key = `board/${randomName}`;
        await uploadToS3(s3Key, buffer, detectedMime);
        return {
          success: true,
          ref: `${S3_REF_PREFIX}${s3Key}`, // DB 에 저장할 값
          url: await signS3Key(s3Key), // 바로 미리보기용 (1시간). 저장하지 말 것
          filename: randomName,
          size: buffer.length,
          createdAt: new Date().toISOString()
        };
      } catch (s3Err) {
        console.error('S3 upload failed, falling back to local storage:', s3Err);
      }
    }

    // Local disk fallback under uploads/board/
    const uploadsDir = path.join(process.cwd(), 'uploads', 'board');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, randomName);
    fs.writeFileSync(filePath, buffer);

    const host = reqHost || '52.63.245.203.sslip.io';
    const protocol = host.includes('localhost') ? 'http' : 'https';
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
      where: [
        { role: UserRole.TEACHER, academy: { id: academy.id } },
        { role: UserRole.HOMEROOM_TEACHER, academy: { id: academy.id } }
      ],
      order: { createdAt: 'DESC' }
    });

    return teachers.map(t => ({
      id: t.id,
      email: t.email && t.email.includes('@pending.takeme') ? '' : (t.email || ''),
      name: t.name || '미등록 교사',
      phone: t.phone || '',
      assignedClass: t.assignedClass || '',
      approvalStatus: t.approvalStatus || 'APPROVED',
      isLocked: !!t.isLocked,
      createdAt: t.createdAt
    }));
  }

  async preRegisterTeachers(teachersList: Array<{ name: string; assignedClass?: string; phone?: string }>, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');
    if (!Array.isArray(teachersList) || teachersList.length === 0) return { count: 0, teachers: [] };

    const results = [];
    for (const item of teachersList) {
      const name = item.name ? String(item.name).trim() : '';
      if (!name) continue;
      const assignedClass = item.assignedClass ? String(item.assignedClass).trim() : '';
      const phone = item.phone ? String(item.phone).trim() : null;

      // 동명이인 교사 지원: 성함 및 담당 반명(또는 전화번호)으로 개별 교사 식별
      let teacher = await this.userRepository.findOne({
        where: {
          name,
          assignedClass: assignedClass || undefined,
          academy: { id: academy.id }
        }
      });

      if (teacher) {
        if (assignedClass && (!teacher.assignedClass || teacher.assignedClass === '미배정')) {
          teacher.assignedClass = assignedClass;
          if (phone && !teacher.phone) teacher.phone = phone;
          await this.userRepository.save(teacher);
        }
      } else {
        const tempEmail = `teacher_pending_${academy.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}@pending.takeme`;
        teacher = this.userRepository.create({
          name,
          email: tempEmail,
          passwordHash: 'PRE_REGISTERED_TEMP',
          role: UserRole.TEACHER,
          assignedClass,
          academy,
          academyId: academy.id,
          approvalStatus: 'UNREGISTERED',
          phone: phone || null
        });
        await this.userRepository.save(teacher);
      }
      results.push({
        id: teacher.id,
        name: teacher.name,
        assignedClass: teacher.assignedClass,
        phone: teacher.phone,
        approvalStatus: teacher.approvalStatus
      });
    }

    return { count: results.length, teachers: results };
  }

  async approveTeacher(teacherId: number, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    const teacher = await this.userRepository.findOne({
      where: { id: teacherId, academy: academy ? { id: academy.id } : undefined }
    });
    if (!teacher) throw new BadRequestException('해당 교사를 찾을 수 없습니다.');

    teacher.approvalStatus = 'APPROVED';
    await this.userRepository.save(teacher);

    await this.logAudit({
      action: 'TEACHER_APPROVE',
      targetType: 'TEACHER',
      targetId: String(teacher.id),
      details: `교사(${teacher.name || teacher.email}) 가입 승인 완료`
    });

    return { success: true, teacherId: teacher.id, approvalStatus: 'APPROVED' };
  }

  async updateAcademyFromExcel(data: { name?: string; academyId?: number }, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(data.academyId || academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    // Only update academy name if there is NO existing saved name
    if ((!academy.name || academy.name.trim() === '') && data.name && String(data.name).trim()) {
      academy.name = String(data.name).trim();
      await this.academyRepository.save(academy);
    }
    return { success: true, academyName: academy.name };
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
    user.lockedAt = null as any;
    await this.userRepository.save(user);

    await this.logAudit({
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      action: 'ACCOUNT_UNLOCK',
      targetType: 'USER',
      targetId: String(user.id),
      details: `원장이 ${user.name || user.email}(ID: ${user.id}) 계정 잠금 해제`,
    });

    return { 
      success: true, 
      message: `${user.name || user.email} 님의 계정 잠금이 성공적으로 해제되었습니다.`,
      userId: user.id
    };
  }

  async logAudit(params: {
    userId?: number;
    userEmail?: string;
    userName?: string;
    action: string;
    targetType?: string;
    targetId?: string;
    ipAddress?: string;
    details?: string;
  }) {
    try {
      const log = this.auditLogRepository.create(params);
      await this.auditLogRepository.save(log);
    } catch (err) {
      console.error('Failed to save audit log:', err);
    }
  }

  async getAuditLogs(take = 50) {
    return this.auditLogRepository.find({
      order: { createdAt: 'DESC' },
      take,
    });
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

  async getAcademyAttendance(academyId?: number, userId?: number, dateInput?: string) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      return { date: dateInput || kstDateString(), classes: [], submissions: [], summary: { totalStudents: 0, present: 0, absent: 0, late: 0, earlyLeave: 0, submittedClasses: 0, totalClasses: 0 } };
    }

    const date = (dateInput && isValidDateString(dateInput)) ? dateInput : kstDateString();

    const students = await this.studentRepository.find({
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true, parentUser: true },
    });

    const submissions = await this.submissionRepository.find({
      where: { academy: { id: academy.id }, date },
    });

    const studentIds = students.map(s => s.id);
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

    const classMap = new Map<string, any[]>();
    for (const s of students) {
      const cName = getStudentClassName(s) || '미배정';
      if (!classMap.has(cName)) classMap.set(cName, []);

      const att = attendanceMap.get(s.id);
      let status: AttendanceStatus = AttendanceStatus.PRESENT;
      if (att) {
        status = att.status;
      } else if (s.boardStatus === 'ABSENT') {
        status = AttendanceStatus.ABSENT;
      }

      classMap.get(cName)!.push({
        id: s.id,
        name: s.adminDisplayName || s.name,
        status,
        memo: att?.memo || '',
        recordedByName: att?.recordedByName || '',
        recordedAt: att?.recordedAt || null,
        boardStatus: s.boardStatus || 'WAITING',
        vehicleName: s.assignedVehicle?.busNumber || '미지정',
      });
    }

    const classesList: any[] = [];
    let grandTotal = 0;
    let grandPresent = 0;
    let grandAbsent = 0;
    let grandLate = 0;
    let grandEarlyLeave = 0;

    for (const [className, stList] of classMap.entries()) {
      const sub = submissions.find(s => s.className === className);
      const present = stList.filter(s => s.status === AttendanceStatus.PRESENT).length;
      const absent = stList.filter(s => s.status === AttendanceStatus.ABSENT).length;
      const late = stList.filter(s => s.status === AttendanceStatus.LATE).length;
      const earlyLeave = stList.filter(s => s.status === AttendanceStatus.EARLY_LEAVE).length;

      grandTotal += stList.length;
      grandPresent += present;
      grandAbsent += absent;
      grandLate += late;
      grandEarlyLeave += earlyLeave;

      classesList.push({
        className,
        isSubmitted: !!sub,
        submittedAt: sub?.submittedAt || null,
        teacherName: sub?.teacherName || null,
        total: stList.length,
        present,
        absent,
        late,
        earlyLeave,
        students: stList,
      });
    }

    return {
      date,
      summary: {
        totalStudents: grandTotal,
        present: grandPresent,
        absent: grandAbsent,
        late: grandLate,
        earlyLeave: grandEarlyLeave,
        submittedClasses: submissions.length,
        totalClasses: classesList.filter(c => c.className !== '미배정').length,
      },
      submissions,
      classes: classesList,
    };
  }
}
