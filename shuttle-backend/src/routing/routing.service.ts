import { Injectable, BadRequestException, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, In } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Vehicle } from '../entities/vehicle.entity';
import { Student } from '../entities/student.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
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
import { BoardPostRead } from '../entities/board-post-read.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { YearlyZoneMapping } from '../entities/yearly-zone-mapping.entity';
import { LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
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
import { applyBoardVisibility, canViewBoardPost, getLinkedClassNames } from '../utils/board-visibility.util';
import { getStudentClassName, hasAssignedClass, isSameClass, HOMEROOM_ROLE, kstDateString, isValidDateString } from '../utils/school.util';
import { Attendance, AttendanceStatus } from '../entities/attendance.entity';
import { AttendanceSubmission } from '../entities/attendance-submission.entity';
import { MediaAsset } from '../entities/media-asset.entity';
import { formatTeacherName, cleanTeacherBaseName } from '../utils/teacher.util';
import { CloudDocument } from '../entities/cloud-document.entity';
import { LegalExpiry } from '../entities/legal-expiry.entity';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class RoutingService implements OnModuleInit {
  private legalExpiryNotifiedCooldown = new Map<string, string>(); // key: ${today}_${vehicleId}_${itemKey}_${userId}, value: ISOString
  private lastScheduledExpiryCheckDate = '';

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
    @InjectRepository(BoardPostRead)
    private boardPostReadRepository: Repository<BoardPostRead>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
    @InjectRepository(YearlyZoneMapping)
    private yearlyZoneMappingRepository: Repository<YearlyZoneMapping>,
    @InjectRepository(Attendance)
    private attendanceRepository: Repository<Attendance>,
    @InjectRepository(AttendanceSubmission)
    private submissionRepository: Repository<AttendanceSubmission>,
    @InjectRepository(CloudDocument)
    private cloudDocumentRepository: Repository<CloudDocument>,
    @InjectRepository(LegalExpiry)
    private legalExpiryRepository: Repository<LegalExpiry>,
    @InjectRepository(MediaAsset)
    private mediaAssetRepository: Repository<MediaAsset>,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  /** 같은 알림을 한 번만 보내기 위한 기록: `${종류}:${studentId}:${날짜}:${AM|PM}` */
  private sentArrivalAlerts = new Set<string>();
  /** 차량이 이번 운행에서 유치원을 벗어났었는지 (유치원 도착 판정용) */
  private vehicleLeftAcademy = new Map<number, boolean>();

  private static distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLng = (lng2 - lng1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 6371e3 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** 한국 시간 기준 날짜와 오전/오후 (오전 = 등원, 오후 = 하원 운행으로 본다) */
  private static kstSlot(): { date: string; isMorning: boolean } {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    return { date: kst.toISOString().slice(0, 10), isMorning: kst.getUTCHours() < 12 };
  }

  /**
   * 차량 위치가 들어올 때마다 학부모 알림을 판단한다. (기사 앱 위치 전송 → LocationGateway 에서 호출)
   * 1) 도착 2분 전: 등원은 아직 타지 않은(대기) 원아의 탑승지, 하원은 타고 있는 원아의 하차지까지
   *    남은 시간이 2분 이하가 되면 그 원아의 학부모에게 한 번 알린다.
   *    남은 시간 = 직선거리 × 1.3(도로 보정) ÷ 현재 속도(느리면 시속 25km 로 계산)
   * 2) 유치원 도착(등원): 유치원에서 500m 넘게 벗어났던 차량이 150m 안으로 돌아오면
   *    타고 있는 원아의 학부모에게 한 번 알린다.
   * 알림은 학부모의 TakeMe 알림(개인 알림방)으로 가며, 실시간 화면용 소켓 이벤트 목록을 돌려준다.
   */
  public async checkArrivalAndNotify(vehicleId: number, lat: number, lng: number, speedKmh?: number | null): Promise<any[]> {
    const { date, isMorning } = RoutingService.kstSlot();
    const slot = `${date}:${isMorning ? 'AM' : 'PM'}`;
    const events: any[] = [];

    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId }, relations: { academy: true } });
    const students = await this.studentRepository.find({
      where: isMorning
        ? { assignedVehicle: { id: vehicleId } }
        : [{ assignedDepartureVehicle: { id: vehicleId } }, { assignedVehicle: { id: vehicleId } }],
      relations: { parentUser: true },
    });

    // 아직 들르지 않은 정류장: 등원은 아직 안 탄 원아의 탑승지, 하원은 타고 있는 원아의 하차지
    const pending = students.filter(st =>
      st.latitude && st.longitude && !st.isNotRiding &&
      (isMorning ? st.boardStatus === 'WAITING' : st.boardStatus === 'BOARDED'));

    // 0) 몇 정거장 전: 기사 앱과 같은 방식(지금 위치에서 가장 가까운 정류장부터 차례로)으로 남은 순서를 정하고,
    //    학부모에게는 '내 아이 정류장 앞에 남은 정류장 수'만 보낸다(다른 아이 정류장 이름·위치는 보내지 않음)
    {
      const left = [...pending];
      let curLat = lat;
      let curLng = lng;
      let order = 0;
      while (left.length > 0) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < left.length; i++) {
          const d = RoutingService.distanceM(curLat, curLng, Number(left[i].latitude), Number(left[i].longitude));
          if (d < bestD) { bestD = d; best = i; }
        }
        const st = left.splice(best, 1)[0];
        if (st.parentUser?.id) {
          events.push({ kind: 'PROGRESS', studentId: st.id, parentUserId: st.parentUser.id, stopsBefore: order, totalRemaining: pending.length });
        }
        curLat = Number(st.latitude);
        curLng = Number(st.longitude);
        order++;
      }
    }

    // 1) 도착 N분 전: 학부모가 고른 시점(2분 전 기본, 5분 전, 끄기=0)에 한 번
    const speedMps = speedKmh && speedKmh > 10 ? speedKmh / 3.6 : 25 / 3.6;
    for (const st of pending) {
      const pref = Number((st.parentUser as any)?.notificationSettings?.arrivalNoticeMinutes);
      const minutes = Number.isFinite(pref) ? pref : 2;
      if (minutes <= 0) continue;
      const dist = RoutingService.distanceM(lat, lng, Number(st.latitude), Number(st.longitude));
      const etaSec = (dist * 1.3) / speedMps;
      if (etaSec > minutes * 60) continue;
      const key = `soon:${st.id}:${slot}`;
      if (this.sentArrivalAlerts.has(key)) continue;
      this.sentArrivalAlerts.add(key);

      const name = st.adminDisplayName || st.name;
      const place = isMorning ? '탑승지' : '하차지';
      const etaMin = Math.max(1, Math.round(etaSec / 60));
      const rawBus = String(vehicle?.busNumber || '').trim();
      const bus = !rawBus ? '버스' : rawBus.endsWith('호차') ? rawBus : rawBus.endsWith('호') ? `${rawBus}차` : `${rawBus}호차`;
      const message = `${bus}가 약 ${etaMin}분 후 ${name} 원아 ${place}에 도착합니다. ${isMorning ? '미리 나와 주세요.' : '마중 나와 주세요.'}`;
      this.notifyStudentRelated(st.id, '버스 도착 예정', message, ['PARENT'], { type: 'shuttle' });
      events.push({ kind: 'SOON', studentId: st.id, studentName: name, parentUserId: st.parentUser?.id, message });
    }

    // 2) 유치원 도착 (등원)
    const acLat = vehicle?.academy?.latitude ? Number(vehicle.academy.latitude) : null;
    const acLng = vehicle?.academy?.longitude ? Number(vehicle.academy.longitude) : null;
    if (acLat && acLng) {
      const toAcademy = RoutingService.distanceM(lat, lng, acLat, acLng);
      if (toAcademy > 500) this.vehicleLeftAcademy.set(vehicleId, true);
      if (isMorning && toAcademy <= 150 && this.vehicleLeftAcademy.get(vehicleId)) {
        this.vehicleLeftAcademy.set(vehicleId, false);
        const academyName = vehicle?.academy?.name || '유치원';
        for (const st of students) {
          if (st.boardStatus !== 'BOARDED') continue;
          const key = `arrived:${st.id}:${slot}`;
          if (this.sentArrivalAlerts.has(key)) continue;
          this.sentArrivalAlerts.add(key);
          const name = st.adminDisplayName || st.name;
          const message = `${name} 원아가 ${academyName}에 도착했습니다.`;
          this.notifyStudentRelated(st.id, '유치원 도착', message, ['PARENT'], { type: 'shuttle' });
          events.push({ kind: 'ARRIVED_ACADEMY', studentId: st.id, studentName: name, parentUserId: st.parentUser?.id, message });
        }
      }
    }

    // 지난 날짜 기록은 정리한다
    if (this.sentArrivalAlerts.size > 5000) {
      for (const k of this.sentArrivalAlerts) if (!k.includes(`:${date}:`)) this.sentArrivalAlerts.delete(k);
    }
    return events;
  }

  public async geocodeAddress(
    address: string,
    defaultRegion?: string,
    centerCoords?: { lat: number, lng: number }
  ): Promise<{ lat: number, lng: number } | null> {
    if (!address) return null;
    const apiKey = this.configService.get<string>('KAKAO_REST_API_KEY');
    if (!apiKey) throw new BadRequestException('Kakao API Key is missing.');

    const cleanCandidates: string[] = [];
    let raw = String(address).trim();

    // 0. Strip vehicle prefixes and labels like '1호차', '(1호차)', '[1호차]', '1코스'
    raw = raw.replace(/\([0-9]+\s*호차\)/g, '').replace(/\[[0-9]+\s*호차\]/g, '');
    raw = raw.replace(/^[0-9]+\s*호차\s*/, '');
    raw = raw.replace(/^[0-9]+\s*코스\s*/, '');
    raw = raw.replace(/^[0-9]+\s*노선\s*/, '');
    raw = raw.trim();

    // 1. Raw exact address has highest priority (works nationwide)
    if (raw) {
      cleanCandidates.push(raw);
    }

    // Extract region if present (e.g., '경기도 양주시', '서울특별시 강남구')
    const regionMatch = raw.match(/^([가-힣]+(?:시|도)\s+[가-힣]+(?:구|군|시))/);
    const region = regionMatch ? regionMatch[1] : (defaultRegion || '');

    // 2. Full address without parentheses (road name + building number)
    let withoutParen = raw.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim();
    withoutParen = withoutParen
      .replace(/\d+\s*동\s*\d+\s*호/g, '')
      .replace(/\d+\s*동/g, '')
      .replace(/\d+\s*호/g, '')
      .trim();
    if (withoutParen && withoutParen !== raw) {
      if (region && !withoutParen.startsWith(region) && !withoutParen.match(/^[가-힣]+(?:시|도)/)) {
        cleanCandidates.push(`${region} ${withoutParen}`);
      }
      cleanCandidates.push(withoutParen);
    }

    // 3. Inside parentheses: apartment / complex / building name
    const parenMatch = raw.match(/\(([^)]+)\)/);
    if (parenMatch) {
      let inside = parenMatch[1]
        .replace(/\d+\s*동\s*\d+\s*호/g, '')
        .replace(/\d+\s*동/g, '')
        .replace(/\d+\s*호/g, '')
        .replace(/[0-9]+\s*호차/g, '')
        .trim();
      if (inside && inside.length >= 2) {
        if (region) cleanCandidates.push(`${region} ${inside}`);
        cleanCandidates.push(inside);
        const strippedInside = inside.replace(/[0-9]+\s*차/g, '').replace(/센트럴파크|파크빌리지/g, '').trim();
        if (strippedInside && strippedInside !== inside) {
          if (region) cleanCandidates.push(`${region} ${strippedInside}`);
          cleanCandidates.push(strippedInside);
        }
      }
    }

    // 4. Road name without building number (e.g., '고읍북로', '테헤란로')
    const roadOnlyMatch = withoutParen.match(/([가-힣]+(?:시|도)?\s*[가-힣]+(?:구|군|시)?\s*[가-힣0-9]+(?:로|길))/);
    if (roadOnlyMatch && roadOnlyMatch[1]) {
      const roadOnly = roadOnlyMatch[1].trim();
      if (region && !roadOnly.startsWith(region) && !roadOnly.match(/^[가-힣]+(?:시|도)/)) {
        cleanCandidates.push(`${region} ${roadOnly}`);
      }
      cleanCandidates.push(roadOnly);
    }

    const uniqueCandidates = Array.from(new Set(cleanCandidates.filter(Boolean)));

    for (const query of uniqueCandidates) {
      if (!query) continue;
      // 1. Kakao address search (전국 정확한 도로명/지번 좌표 조회)
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

      // 2. Kakao keyword search (아파트명, 건물명, 주요 시설물 조회)
      try {
        const kw = query.replace(/앞|뒤|옆|근처|건너편|인근/g, '').trim();
        const kwParams: any = { query: kw, size: 5 };
        if (centerCoords && centerCoords.lat && centerCoords.lng) {
          kwParams.x = centerCoords.lng;
          kwParams.y = centerCoords.lat;
          kwParams.radius = 20000;
          kwParams.sort = 'accuracy';
        }
        const kwResponse = await firstValueFrom(
          this.httpService.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
            params: kwParams,
            headers: { Authorization: `KakaoAK ${apiKey}` }
          })
        );
        const kwDocs = kwResponse.data?.documents;
        if (kwDocs && kwDocs.length > 0) {
          const doc = kwDocs[0];
          const x = parseFloat(doc.x);
          const y = parseFloat(doc.y);
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
            const doc = addrs[0];
            const x = parseFloat(doc.x);
            const y = parseFloat(doc.y);
            if (!isNaN(x) && !isNaN(y)) {
              return { lat: y, lng: x };
            }
          }
        } catch (e) {}
      }
    }

    console.warn(`[geocodeAddress] 주소 변환 실패: ${address} -> null 반환 (임의 기본좌표 사용 금지)`);
    return null;
  }

  /**
   * 도로명 주소 실시간 검색 API (자동완성 및 지도 핀 연동용)
   */
  async searchAddress(query: string): Promise<Array<{
    addressName: string;
    roadAddress: string;
    buildingName: string;
    lat: number;
    lng: number;
  }>> {
    if (!query || !query.trim()) return [];
    const apiKey = this.configService.get<string>('KAKAO_REST_API_KEY');
    if (!apiKey) return [];

    const results: Array<{
      addressName: string;
      roadAddress: string;
      buildingName: string;
      lat: number;
      lng: number;
    }> = [];

    const cleanQuery = query.trim();

    // 1. Kakao 도로명 주소 검색
    try {
      const resp = await firstValueFrom(
        this.httpService.get('https://dapi.kakao.com/v2/local/search/address.json', {
          params: { query: cleanQuery, size: 10 },
          headers: { Authorization: `KakaoAK ${apiKey}` },
        }),
      );
      const docs = resp.data?.documents || [];
      for (const d of docs) {
        const road = d.road_address;
        const lat = parseFloat(d.y);
        const lng = parseFloat(d.x);
        if (!isNaN(lat) && !isNaN(lng)) {
          results.push({
            addressName: d.address_name,
            roadAddress: road?.address_name || d.address_name,
            buildingName: road?.building_name || '',
            lat,
            lng,
          });
        }
      }
    } catch (_) {}

    // 2. Kakao 키워드 검색 (아파트명, 건물명, 상호명 등)
    if (results.length < 5) {
      try {
        const kwResp = await firstValueFrom(
          this.httpService.get('https://dapi.kakao.com/v2/local/search/keyword.json', {
            params: { query: cleanQuery, size: 10 },
            headers: { Authorization: `KakaoAK ${apiKey}` },
          }),
        );
        const kwDocs = kwResp.data?.documents || [];
        for (const kd of kwDocs) {
          const lat = parseFloat(kd.y);
          const lng = parseFloat(kd.x);
          if (!isNaN(lat) && !isNaN(lng)) {
            if (!results.some(r => Math.abs(r.lat - lat) < 0.0001 && Math.abs(r.lng - lng) < 0.0001)) {
              results.push({
                addressName: kd.address_name,
                roadAddress: kd.road_address_name || kd.address_name,
                buildingName: kd.place_name || '',
                lat,
                lng,
              });
            }
          }
        }
      } catch (_) {}
    }

    return results;
  }

  private colorPalette = [
    '#1d4ed8', // 1: royal blue (파랑)
    '#059669', // 2: emerald green (초록)
    '#f97316', // 3: vivid orange (주황)
    '#7c3aed', // 4: deep purple (보라)
    '#eab308', // 5: bright gold (골드/노랑)
    '#0891b2', // 6: deep teal (청록)
    '#dc2626', // 7: crimson red (빨강)
    '#78350f', // 8: warm chocolate (브라운)
  ];
  private colorIndex = 0;
  private routeUpdateNotifiers: Array<(academyId?: number, message?: string) => void> = [];
  private substituteStaffMap: Map<number, {
    isDriverResting?: boolean;
    substituteDriver?: any;
    isTeacherResting?: boolean;
    substituteTeacher?: any;
    origDriverUserId?: number | null;
    origTeacherUserId?: number | null;
  }> = new Map();

  public registerRouteUpdateNotifier(fn: (academyId?: number, message?: string) => void) {
    this.routeUpdateNotifiers.push(fn);
  }

  private systemNotificationHandler?: (academyId: number | null, category: string, title: string, content: string, extra?: any) => Promise<any>;

  public registerSystemNotificationHandler(fn: (academyId: number | null, category: string, title: string, content: string, extra?: any) => Promise<any>) {
    this.systemNotificationHandler = fn;
  }

  private studentNotificationHandler?: (studentId: number, title: string, content: string, roles: string[], options?: any) => Promise<any>;

  public registerStudentNotificationHandler(fn: (studentId: number, title: string, content: string, roles: string[], options?: any) => Promise<any>) {
    this.studentNotificationHandler = fn;
  }

  private pushHandler?: (userIds: number[], title: string, body: string, data?: Record<string, any>, settingType?: any) => Promise<any>;

  /** ChatService 가 휴대폰 푸시(SNS) 보내는 함수를 등록한다 (모듈 순환 참조를 피하려고 함수로 받는다) */
  public registerPushHandler(fn: (userIds: number[], title: string, body: string, data?: Record<string, any>, settingType?: any) => Promise<any>) {
    this.pushHandler = fn;
  }

  /**
   * 새 알림장·게시물 휴대폰 푸시.
   * 전체 공개면 기관의 학부모·교사·기사, 반 공개면 그 반 원아의 학부모와 그 반 담임에게. 글쓴이는 뺀다.
   */
  private async pushNewBoardPost(post: BoardPost, academyId: number, authorUserId?: number) {
    if (!this.pushHandler) return;
    try {
      const ids = new Set<number>();
      const isClass = post.visibility === 'CLASS' && !!post.targetClass;
      const students = await this.studentRepository.find({
        where: { academy: { id: academyId } },
        relations: { parentUser: true },
      });
      for (const st of students) {
        if (isClass && !isSameClass(getStudentClassName(st), post.targetClass)) continue;
        if (st.parentUser?.id) ids.add(st.parentUser.id);
      }
      const isNotice = post.postType === 'NOTICE';
      // 알림장(NOTICE)은 학부모 및 담임교사에게만 발송 (차량교사/기사는 제외)
      // 일반 게시물(POST) 전체 공개 시에만 전 직원(담임, 차량, 기사) 포함
      const staffRoles = isClass
        ? [UserRole.HOMEROOM_TEACHER]
        : (isNotice ? [UserRole.HOMEROOM_TEACHER] : [UserRole.HOMEROOM_TEACHER, UserRole.SHUTTLE_TEACHER, UserRole.DRIVER]);
      const staff = await this.userRepository.find({
        where: {
          academyId,
          role: In(staffRoles),
        },
      });
      for (const u of staff) {
        if (isClass && !isSameClass(u.assignedClass, post.targetClass)) continue;
        ids.add(u.id);
      }
      if (authorUserId) ids.delete(authorUserId);
      await this.pushHandler(
        Array.from(ids),
        isNotice ? '새 알림장' : '새 게시물',
        post.title || (isNotice ? '새 알림장이 등록되었습니다.' : '새 게시물이 등록되었습니다.'),
        { type: isNotice ? 'notice' : 'board', postId: post.id },
        isNotice ? 'notice' : 'post',
      );
    } catch (err) {
      console.warn('[RoutingService] pushNewBoardPost error:', err);
    }
  }

  /** 원아와 연결된 사람(학부모·담임·차량 지도교사/기사·관리자)에게만 개인 알림 */
  public notifyStudentRelated(studentId: number, title: string, content: string, roles: Array<'PARENT' | 'HOMEROOM' | 'VEHICLE' | 'ADMIN'>, options?: any) {
    try {
      void this.studentNotificationHandler?.(studentId, title, content, roles, options);
    } catch {}
  }

  public notifySystemNotification(academyId: number | null, category: string, title: string, content: string, extra?: any) {
    try {
      this.systemNotificationHandler?.(academyId, category, title, content, extra);
    } catch {}
  }

  public notifyRouteUpdated(academyId?: number, message?: string) {
    for (const fn of this.routeUpdateNotifiers) {
      try {
        fn(academyId, message);
      } catch {}
    }
  }

  private getDistinctColor(): string {
    const color = this.colorPalette[this.colorIndex % this.colorPalette.length];
    this.colorIndex++;
    return color;
  }

  async getAcademy(academyId?: number, userId?: number): Promise<Academy | null> {
    if (academyId && !isNaN(Number(academyId))) {
      const acad = await this.academyRepository.findOne({
        where: { id: Number(academyId) },
        relations: { owner: true }
      });
      if (acad) return acad;
    }
    if (userId && !isNaN(Number(userId))) {
      const acad = await this.academyRepository.findOne({
        where: { owner: { id: Number(userId) } },
        relations: { owner: true }
      });
      if (acad) return acad;

      const user = await this.userRepository.findOne({
        where: { id: Number(userId) },
        relations: { academy: true }
      });
      if (user?.academy) return user.academy;
    }
    return null;
  }

  async getAllAcademies(reqUser?: any) {
    let whereCondition: any = {};
    if (reqUser && reqUser.role !== 'SUPER_ADMIN') {
      const targetAcademyId = reqUser.academyId;
      if (targetAcademyId) {
        whereCondition = { id: targetAcademyId };
      } else if (reqUser.sub) {
        whereCondition = { owner: { id: reqUser.sub } };
      } else {
        return [];
      }
    }
    const academies = await this.academyRepository.find({
      where: whereCondition,
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
        educationLevel: ac.educationLevel || 'KINDERGARTEN',
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

  async archiveCurrentZoneMapping(
    academyId?: number,
    userId?: number,
    academicYear = '전년도',
    title = '전년도 구역 매핑 이력',
    description?: string
  ): Promise<YearlyZoneMapping | null> {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return null;

    const vehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } },
      relations: { driverUser: true, teacherUser: true },
      order: { id: 'ASC' }
    });

    if (vehicles.length === 0) return null;

    const students = await this.studentRepository.find({
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true }
    });

    const vehicleMappings = vehicles.map(v => {
      let poly: any = [];
      try {
        poly = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : (v.polygonCoordinates || []);
      } catch (e) {
        poly = [];
      }

      const assignedStudents = students.filter(s => s.assignedVehicle?.id === v.id);
      return {
        vehicleId: v.id,
        busNumber: v.busNumber,
        plateNumber: v.plateNumber,
        driverName: v.driverName,
        driverUserId: v.driverUser?.id,
        teacherName: v.teacherName,
        teacherUserId: v.teacherUser?.id,
        capacity: v.capacity,
        colorHex: v.colorHex,
        polygonCoordinates: poly,
        studentCount: assignedStudents.length,
        studentsSummary: assignedStudents.slice(0, 50).map(s => ({
          id: s.id,
          name: s.name,
          address: s.address,
          boardingLocation: s.boardingLocation
        }))
      };
    });

    const hasAnyPolygon = vehicleMappings.some(vm => vm.polygonCoordinates && vm.polygonCoordinates.length > 0);
    if (!hasAnyPolygon) {
      return null;
    }

    const archive = this.yearlyZoneMappingRepository.create({
      academy,
      academicYear: academicYear || '전년도',
      title: title || '전년도 구역 매핑 이력',
      description: description || `호차 ${vehicles.length}대, 원아 ${students.length}명 매핑 스냅샷`,
      vehicleMappings,
      totalStudents: students.length,
      totalVehicles: vehicles.length,
      archivedAt: new Date()
    });

    return await this.yearlyZoneMappingRepository.save(archive);
  }

  async getYearlyZoneMappings(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return [];
    return this.yearlyZoneMappingRepository.find({
      where: { academy: { id: academy.id } },
      order: { id: 'DESC' }
    });
  }

  async restoreYearlyZoneMapping(mappingId: number, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    const archive = await this.yearlyZoneMappingRepository.findOne({
      where: { id: mappingId, academy: { id: academy.id } }
    });
    if (!archive) throw new BadRequestException('전년도 구역 매핑 데이터를 찾을 수 없습니다.');

    // 1. Snapshot current active mapping before restoring
    await this.archiveCurrentZoneMapping(
      academy.id,
      undefined,
      '복원 전 활성 구역',
      `${new Date().toLocaleDateString('ko-KR')} 복원 전 활성 구역 백업`,
      '전년도 구역 매핑 복원 직전의 활성 구역 스냅샷입니다.'
    );

    const vehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } },
      order: { id: 'ASC' }
    });

    const vehicleMap = new Map<string, Vehicle>();
    vehicles.forEach(v => {
      vehicleMap.set(v.busNumber, v);
      const numOnly = v.busNumber.replace(/[^0-9]/g, '');
      if (numOnly) vehicleMap.set(numOnly, v);
    });

    for (const vm of archive.vehicleMappings) {
      const numOnly = vm.busNumber?.replace(/[^0-9]/g, '');
      const targetVehicle = vehicleMap.get(vm.busNumber) || (numOnly ? vehicleMap.get(numOnly) : undefined);
      if (targetVehicle) {
        targetVehicle.polygonCoordinates = vm.polygonCoordinates;
        if (vm.colorHex) targetVehicle.colorHex = vm.colorHex;
        await this.vehicleRepository.save(targetVehicle);
      }
    }

    const existingStudents = await this.studentRepository.find({
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true }
    });

    const updatedVehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } }
    });

    const vehiclePolyList = updatedVehicles.map(v => {
      let pts: [number, number][] = [];
      try {
        pts = typeof v.polygonCoordinates === 'string' ? JSON.parse(v.polygonCoordinates) : (v.polygonCoordinates || []);
      } catch (e) {}
      return { vehicle: v, points: pts };
    });

    for (const student of existingStudents) {
      let targetVehicle: Vehicle | null = null;
      const sLat = student.latitude;
      const sLng = student.longitude;

      if (sLat && sLng && !isNaN(sLat) && !isNaN(sLng)) {
        for (const vp of vehiclePolyList) {
          if (vp.points.length >= 3 && this.isPointInPolygon([sLat, sLng], vp.points)) {
            targetVehicle = vp.vehicle;
            break;
          }
        }
      }
      if (targetVehicle) {
        student.assignedVehicle = targetVehicle;
      }
    }
    await this.studentRepository.save(existingStudents);

    this.notifyRouteUpdated(academy.id);
    return {
      success: true,
      message: `'${archive.title}'(${archive.academicYear}) 구역 매핑이 성공적으로 복원되었습니다.`
    };
  }

  async deleteYearlyZoneMapping(mappingId: number, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    const archive = await this.yearlyZoneMappingRepository.findOne({
      where: { id: mappingId, academy: { id: academy.id } }
    });
    if (!archive) throw new BadRequestException('해당 구역 매핑 이력을 찾을 수 없습니다.');

    await this.yearlyZoneMappingRepository.remove(archive);
    return { success: true, message: '전년도 구역 매핑 내역이 삭제되었습니다.' };
  }

  async resetActiveZones(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    // 1. Archive current active mapping before clearing
    await this.archiveCurrentZoneMapping(
      academy.id,
      undefined,
      '전년도',
      '전년도 구역 매핑 이력',
      '구역 매핑 초기화 전 자동 보관된 매핑 내역입니다.'
    );

    // 2. Clear polygon coordinates on all vehicles (Preserve vehicle ID, driver, teacher, and approval statuses!)
    const vehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } }
    });

    for (const v of vehicles) {
      v.polygonCoordinates = null;
      await this.vehicleRepository.save(v);
    }

    // 3. Reset student vehicle assignments to pending state
    await this.studentRepository.update(
      { academy: { id: academy.id } },
      { assignedVehicle: null as any }
    );

    this.notifyRouteUpdated(academy.id);

    return {
      success: true,
      message: '현재 구역 매핑이 전년도 구역 매핑 DB에 저장되었으며, 활성 구역 매핑이 초기화되었습니다. 새로운 엑셀 시트를 업로드하여 새 구역을 설정할 수 있습니다.'
    };
  }

  async initializeZones(vehicles: any[], parsedData: any[], academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    // 0. Auto-archive current active zone mapping before applying the new Excel sheet
    try {
      await this.archiveCurrentZoneMapping(
        academy.id,
        undefined,
        '전년도',
        '전년도 구역 매핑 (새 엑셀 업로드 전 자동 보관)',
        '새 엑셀 업로드 및 구역 재매핑 전 자동 백업된 구역 매핑입니다.'
      );
    } catch (e: any) {
      console.warn('Auto-archiving previous zone mapping skipped:', e?.message);
    }

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
          existing.teacherName = formatTeacherName(v.teacherName);
        } else if (hasExistingTeacher) {
          existing.teacherName = formatTeacherName(existing.teacherName);
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
          teacherName: v.teacherName ? formatTeacherName(v.teacherName) : '미정',
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

    // Preserve academy's registered vehicle count
    academy.vehicleCount = Math.max(savedVehicles.length, academy.vehicleCount || 1, existingVehicles.length);
    await this.academyRepository.save(academy);

    // Academy center coordinates and default region (e.g. '경기도 양주시')
    let centerLat = parseFloat(academy.latitude);
    let centerLng = parseFloat(academy.longitude);
    if (isNaN(centerLat) || isNaN(centerLng)) {
      centerLat = 37.8083;
      centerLng = 127.0717;
    }
    const academyCenter = { lat: centerLat, lng: centerLng };
    const defaultRegion = academy.roadAddress?.match(/^([가-힣]+(?:시|도)\s+[가-힣]+(?:구|군|시))/)?.[1] || '경기도 양주시';

    // Clear active polygon coordinates on all existing vehicles before computing new zones
    for (const ev of existingVehicles) {
      ev.polygonCoordinates = null;
      await this.vehicleRepository.save(ev);
    }

    // 3. Geocode Addresses and Associate with Vehicles (with caching & parallel batch pre-fetch)
    const geocodeCache = new Map<string, { lat: number, lng: number } | null>();

    const uniqueLocations = new Set<string>();
    for (const row of parsedData) {
      // Prioritize road address first!
      const road = row['도로명주소'] || row['주소'];
      const stop = row['탑승차량_승차지'] || row['승차지'] || row['등원지'] || row['탑승지'];
      const drop = row['탑승차량_하차지'] || row['하차지'] || row['하원지'];
      if (road && String(road).trim()) uniqueLocations.add(String(road).trim());
      else if (stop && String(stop).trim()) uniqueLocations.add(String(stop).trim());
      else if (drop && String(drop).trim()) uniqueLocations.add(String(drop).trim());
    }

    const locArray = Array.from(uniqueLocations);
    const BATCH_SIZE = 15;
    for (let i = 0; i < locArray.length; i += BATCH_SIZE) {
      const batch = locArray.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (addr) => {
        try {
          const res = await this.geocodeAddress(addr, defaultRegion, academyCenter);
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
      const res = await this.geocodeAddress(cleanAddr, defaultRegion, academyCenter);
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

    const resolveBusName = (row: any) => {
      const direct = row['등원차량'] || row['하원차량'] || row['차량'] || row['호차'] || row['등원_차량'] || row['하원_차량'];
      if (direct && String(direct).trim()) return String(direct).trim();
      const rawText = (row['탑승차량_승차지'] || row['승차지'] || row['탑승차량_하차지'] || row['하차지'] || row['비고'] || row['노선'] || row['코스'] || '').toString();
      const m = rawText.match(/([0-9]+)\s*(?:호차|코스|노선)/);
      return m ? `${m[1]}호차` : null;
    };

    const allGeocodedPoints: [number, number][] = [];

    for (const row of parsedData) {
      const busName = resolveBusName(row);
      const inTarget = busName ? findTargetVehicle(busName) : null;
      const inLocation = row['도로명주소'] || row['주소'] || row['탑승차량_승차지'] || row['승차지'] || row['등원지'] || row['탑승지'];

      if (inLocation) {
        const coords = await geocodeWithCache(inLocation.toString());
        if (coords) {
          allGeocodedPoints.push([coords.lat, coords.lng]);
          if (inTarget) {
            const exists = inTarget.points.some((p: any) => Math.abs(p[0] - coords.lat) < 0.0001 && Math.abs(p[1] - coords.lng) < 0.0001);
            if (!exists) inTarget.points.push([coords.lat, coords.lng]);
          }
        }
      }
    }

    // Fallback center coordinates if needed
    if ((isNaN(centerLat) || isNaN(centerLng)) && allGeocodedPoints.length > 0) {
      centerLat = allGeocodedPoints.reduce((sum, p) => sum + p[0], 0) / allGeocodedPoints.length;
      centerLng = allGeocodedPoints.reduce((sum, p) => sum + p[1], 0) / allGeocodedPoints.length;
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
      1.2 // 1.2km service buffer around real student stops for realistic neighborhood sectors
    );

    for (let i = 0; i < nVehicles; i++) {
      const v = savedVehicles[i];
      v.points = partitionedPolygons[i] || [];
      v.polygon = v.points;

      // Update DB with polygon points (TypeORM simple-json handles serialization)
      const vehicleToUpdate = await this.vehicleRepository.findOne({ where: { id: v.id } });
      if (vehicleToUpdate) {
        vehicleToUpdate.colorHex = v.color;
        vehicleToUpdate.polygonCoordinates = v.points && v.points.length >= 3 ? v.points : null;
        await this.vehicleRepository.save(vehicleToUpdate);
      }
    }

    // 5. Expand newly mapped vehicle zones toward registered students and auto-dispatch
    try {
      await this.expandZonesToStudents(academy.id, userId);
      const reloadedVehicles = await this.vehicleRepository.find({
        where: { academy: { id: academy.id } },
        order: { id: 'ASC' }
      });
      for (const v of savedVehicles) {
        const found = reloadedVehicles.find(rv => rv.id === v.id);
        if (found) {
          let pts = found.polygonCoordinates;
          while (typeof pts === 'string') {
            try { pts = JSON.parse(pts); } catch (e) { break; }
          }
          v.points = Array.isArray(pts) ? pts : [];
          v.polygon = v.points;
        }
      }
    } catch (err: any) {
      console.warn('[initializeZones] Auto-expansion to students failed:', err?.message || err);
    }

    this.notifyRouteUpdated(academy.id);
    return savedVehicles;
  }

  async expandZonesToStudents(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');
    }

    const vehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } },
      order: { id: 'ASC' }
    });

    if (!vehicles || vehicles.length === 0) {
      return { success: false, message: '등록된 차량이 없습니다.', count: 0, vehicles: [] };
    }

    // Load any past snapshot seed polygons in case some vehicles currently lack distinct polygons
    let pastMap: any[] = [];
    try {
      const pastMapping = await this.yearlyZoneMappingRepository.findOne({
        where: { academy: { id: academy.id } },
        order: { id: 'DESC' }
      });
      if (pastMapping && pastMapping.vehicleMappings) {
        pastMap = typeof pastMapping.vehicleMappings === 'string'
          ? JSON.parse(pastMapping.vehicleMappings)
          : pastMapping.vehicleMappings;
      }
    } catch (e) {}

    interface VehicleZoneState {
      vehicle: Vehicle;
      polygon: [number, number][];
      centroid: [number, number];
      allPoints: [number, number][];
      assignedStudents: any[];
    }

    const vehicleStates: VehicleZoneState[] = vehicles.map(v => {
      let poly: [number, number][] = [];
      try {
        let rawPts = v.polygonCoordinates;
        while (typeof rawPts === 'string') {
          try { rawPts = JSON.parse(rawPts); } catch (e) { break; }
        }
        if (Array.isArray(rawPts)) {
          poly = rawPts.filter(p => Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) as [number, number][];
        }
      } catch (e) {}

      // Fallback to snapshot points if poly is empty
      if (poly.length === 0 && pastMap.length > 0) {
        const snap = pastMap.find(m => m.busNumber === v.busNumber || m.vehicleId === v.id);
        if (snap && Array.isArray(snap.polygonCoordinates) && snap.polygonCoordinates.length > 0) {
          poly = snap.polygonCoordinates;
        }
      }

      let cLat = 0, cLng = 0;
      if (poly.length > 0) {
        cLat = poly.reduce((s, p) => s + p[0], 0) / poly.length;
        cLng = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      }

      return {
        vehicle: v,
        polygon: poly,
        centroid: [cLat, cLng],
        allPoints: [...poly],
        assignedStudents: []
      };
    });

    // Check if any two vehicles share identical centroids, and recover distinct seeds if available
    for (let i = 0; i < vehicleStates.length; i++) {
      for (let j = i + 1; j < vehicleStates.length; j++) {
        const vi = vehicleStates[i];
        const vj = vehicleStates[j];
        if (vi.centroid[0] !== 0 && vj.centroid[0] !== 0) {
          const dCent = this.getDistanceKm(vi.centroid[0], vi.centroid[1], vj.centroid[0], vj.centroid[1]);
          if (dCent < 0.001 && pastMap.length > 0) {
            const snapI = pastMap.find(m => m.busNumber === vi.vehicle.busNumber);
            const snapJ = pastMap.find(m => m.busNumber === vj.vehicle.busNumber);
            if (snapI?.polygonCoordinates?.length > 0) {
              vi.polygon = snapI.polygonCoordinates;
              vi.centroid = [
                vi.polygon.reduce((s, p) => s + p[0], 0) / vi.polygon.length,
                vi.polygon.reduce((s, p) => s + p[1], 0) / vi.polygon.length
              ];
              vi.allPoints = [...vi.polygon];
            }
            if (snapJ?.polygonCoordinates?.length > 0) {
              vj.polygon = snapJ.polygonCoordinates;
              vj.centroid = [
                vj.polygon.reduce((s, p) => s + p[0], 0) / vj.polygon.length,
                vj.polygon.reduce((s, p) => s + p[1], 0) / vj.polygon.length
              ];
              vj.allPoints = [...vj.polygon];
            }
          }
        }
      }
    }

    const students = await this.studentRepository.find({
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true }
    });

    if (students.length === 0) {
      return { success: true, count: 0, vehicles: vehicles.map(v => ({ id: v.id, busNumber: v.busNumber, studentCount: 0 })) };
    }

    // Geocode any students missing coordinates
    for (const student of students) {
      if ((student.latitude === undefined || student.latitude === null || isNaN(student.latitude) ||
           student.longitude === undefined || student.longitude === null || isNaN(student.longitude)) &&
          (student.address || student.boardingLocation)) {
        const addr = student.address || student.boardingLocation;
        const coords = await this.geocodeAddress(addr);
        if (coords) {
          student.latitude = coords.lat;
          student.longitude = coords.lng;
        }
      }
    }

    const validStudents = students.filter(s => s.latitude !== undefined && s.latitude !== null && !isNaN(s.latitude) &&
                                               s.longitude !== undefined && s.longitude !== null && !isNaN(s.longitude));

    // Vehicle matching helper
    const matchVehicle = (val: any): VehicleZoneState | null => {
      if (!val) return null;
      const str = String(val).trim();
      let found = vehicleStates.find(vs => vs.vehicle.busNumber === str || String(vs.vehicle.id) === str);
      if (found) return found;
      const digits = str.replace(/[^0-9]/g, '');
      if (digits) {
        found = vehicleStates.find(vs => vs.vehicle.busNumber.replace(/[^0-9]/g, '') === digits);
        if (found) return found;
      }
      return null;
    };

    // Assign students to vehicle zones:
    // 1. High priority: explicit vehicle in raw metadata (호차, 차량, 등원차량) or currently assignedVehicle
    // 2. If no explicit bus, check if student coordinate is already inside a vehicle's polygon
    // 3. Proximity to vehicle polygon / centroid
    for (const st of validStudents) {
      const sLat = Number(st.latitude);
      const sLng = Number(st.longitude);

      let parsedRaw: any = {};
      if (st.raw) {
        if (typeof st.raw === 'string') {
          try { parsedRaw = JSON.parse(st.raw); } catch (e) { parsedRaw = {}; }
        } else if (typeof st.raw === 'object') {
          parsedRaw = st.raw;
        }
      }

      let chosenVs: VehicleZoneState | null = null;

      // 1. Check containment inside existing vehicle polygons first!
      // If student is located inside an existing vehicle zone, assign to that vehicle immediately.
      for (const vs of vehicleStates) {
        if (vs.polygon.length >= 3 && this.isPointInPolygon([sLat, sLng], vs.polygon)) {
          chosenVs = vs;
          break;
        }
      }

      // 2. If outside existing polygons, check explicit raw bus (호차, 차량, assignedVehicle, 등원차량)
      if (!chosenVs) {
        const explicitBusStr = parsedRaw['호차'] || parsedRaw['차량'] || (st.assignedVehicle ? st.assignedVehicle.busNumber : null) || parsedRaw['등원차량'];
        if (explicitBusStr) {
          chosenVs = matchVehicle(explicitBusStr);
        }
      }

      // 3. If still not resolved, assign to nearest vehicle
      if (!chosenVs) {
        let minDist = Infinity;
        for (const vs of vehicleStates) {
          let dist = Infinity;
          if (vs.polygon.length > 0) {
            for (const pt of vs.polygon) {
              const d = this.getDistanceKm(sLat, sLng, pt[0], pt[1]);
              if (d < dist) dist = d;
            }
          } else if (vs.centroid[0] !== 0) {
            dist = this.getDistanceKm(sLat, sLng, vs.centroid[0], vs.centroid[1]);
          }
          if (dist < minDist) {
            minDist = dist;
            chosenVs = vs;
          }
        }
      }

      if (!chosenVs) {
        chosenVs = vehicleStates[0];
      }

      chosenVs.assignedStudents.push(st);
      chosenVs.allPoints.push([sLat, sLng]);
    }

    // Capacitated Cluster Balancing:
    // If a vehicle zone is overcrowded (> 25 students, e.g. 7호차 with 113 students),
    // prioritize the 25 most clustered students for this vehicle, and distribute surplus to nearby under-capacity vehicles!
    const CAPACITY = 25;
    for (const vs of vehicleStates) {
      if (vs.assignedStudents.length > CAPACITY) {
        const pts = vs.assignedStudents.map(s => [Number(s.latitude), Number(s.longitude)]);
        const avgLat = pts.reduce((sum, p) => sum + p[0], 0) / pts.length;
        const avgLng = pts.reduce((sum, p) => sum + p[1], 0) / pts.length;

        // Sort students by proximity to this vehicle cluster center
        vs.assignedStudents.sort((a, b) => {
          const dA = this.getDistanceKm(Number(a.latitude), Number(a.longitude), avgLat, avgLng);
          const dB = this.getDistanceKm(Number(b.latitude), Number(b.longitude), avgLat, avgLng);
          return dA - dB;
        });

        // Retain 25 closest students, spill surplus to nearest available vehicle within 5km
        const surplus = vs.assignedStudents.splice(CAPACITY);
        for (const st of surplus) {
          let bestNeighbor: VehicleZoneState | null = null;
          let minNeighborDist = Infinity;
          for (const otherVs of vehicleStates) {
            if (otherVs.assignedStudents.length < CAPACITY) {
              const oLat = otherVs.centroid[0] !== 0 ? otherVs.centroid[0] : avgLat;
              const oLng = otherVs.centroid[1] !== 0 ? otherVs.centroid[1] : avgLng;
              const d = this.getDistanceKm(Number(st.latitude), Number(st.longitude), oLat, oLng);
              if (d < minNeighborDist && d <= 5.0) {
                minNeighborDist = d;
                bestNeighbor = otherVs;
              }
            }
          }
          if (bestNeighbor) {
            bestNeighbor.assignedStudents.push(st);
          } else {
            // 정원 초과 또는 주변 5km 이내 여유 차량 없음 -> 증차 필요 상태로 설정하고 배차 해제
            st.needsExtraBus = true;
            st.unassignedReason = 'SURPLUS_NO_NEIGHBOR_5KM';
            st.assignedVehicle = null;
            st.assignedDepartureVehicle = null;
            await this.studentRepository.update(st.id, { assignedVehicle: null, assignedDepartureVehicle: null }).catch(() => {});
          }
        }
      }
    }

    // Now form dedicated, seamless, non-overlapping vehicle zones that touch along shared borders
    const studentPointsList = vehicleStates.map(vs => {
      const studentPts = vs.assignedStudents.map(s => [Number(s.latitude), Number(s.longitude)] as [number, number]);
      const basePts = vs.polygon.length > 0 ? vs.polygon : [];
      return studentPts.length > 0 ? studentPts : basePts;
    });

    const partitionedPolys = this.partitionVehicleZones(studentPointsList, 0.25);

    for (let i = 0; i < vehicleStates.length; i++) {
      const vs = vehicleStates[i];
      const poly = partitionedPolys[i];
      if (poly && poly.length >= 3) {
        vs.vehicle.polygonCoordinates = poly;
        await this.vehicleRepository.save(vs.vehicle);
      }
    }

    // Save student assignments and update raw metadata
    for (const vs of vehicleStates) {
      for (const st of vs.assignedStudents) {
        st.assignedVehicle = vs.vehicle;
        st.assignedDepartureVehicle = vs.vehicle;
        st.color = vs.vehicle.colorHex;
        if (!st.raw || typeof st.raw !== 'object') st.raw = {};
        st.raw['등원차량'] = vs.vehicle.busNumber;
        st.raw['하원차량'] = vs.vehicle.busNumber;
        st.raw['호차'] = vs.vehicle.busNumber;
        st.raw['차량'] = vs.vehicle.busNumber;
        if (academy.name && academy.name.trim()) {
          st.raw['유치원명'] = academy.name.trim();
          st.raw['학교명'] = academy.name.trim();
        }
        await this.studentRepository.save(st);

        // Update schedule assignedVehicleId
        await this.studentRepository.query(
          `UPDATE student_schedules SET "assignedVehicleId" = $1 WHERE "studentId" = $2`,
          [vs.vehicle.id, st.id]
        ).catch(() => {});
      }
    }

    // Notify connected clients via websocket
    this.notifyRouteUpdated(academy.id);

    const vehicleSummary = vehicleStates.map((vs, idx) => ({
      id: vs.vehicle.id,
      busNumber: vs.vehicle.busNumber,
      studentCount: vs.assignedStudents.length,
      capacity: vs.vehicle.capacity || 25,
      vertices: Array.isArray(vs.vehicle.polygonCoordinates) ? vs.vehicle.polygonCoordinates.length : 0
    }));

    return {
      success: true,
      count: validStudents.length,
      vehicles: vehicleSummary
    };
  }

  async getInitialState(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) {
      return { academy: null, buses: [], students: [] };
    }
    const vehicles = await this.vehicleRepository.find({ 
      where: { academy: { id: academy.id } },
      relations: { driverUser: true, teacherUser: true },
      order: { id: 'ASC' }
    });
    const formattedVehicles = vehicles.map(v => {
      let parsedPoints = v.polygonCoordinates;
      while (typeof parsedPoints === 'string') {
        try { parsedPoints = JSON.parse(parsedPoints); } catch(e) { break; }
      }
      if (!Array.isArray(parsedPoints)) parsedPoints = [];
      
      const subState = this.substituteStaffMap.get(v.id);
      return {
        id: v.id,
        name: v.busNumber,
        color: v.colorHex || this.getDistinctColor(),
        points: parsedPoints,
        polygon: parsedPoints,
        polygonCoordinates: parsedPoints,
        busNumber: v.busNumber,
        plateNumber: v.plateNumber,
        driverName: v.driverName,
        driverPhone: v.driverPhone,
        teacherName: v.teacherName ? formatTeacherName(v.teacherName) : '미정',
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
        isDriverResting: Boolean(subState?.isDriverResting),
        substituteDriver: subState?.substituteDriver || null,
        isTeacherResting: Boolean(subState?.isTeacherResting),
        substituteTeacher: subState?.substituteTeacher || null,
      };
    });
    
    const dbStudents = await this.studentRepository.find({ 
      where: { academy: { id: academy.id } },
      relations: { assignedVehicle: true, assignedDepartureVehicle: true, studentUser: true, parentUser: true, schedules: { assignedVehicle: true } } 
    });
    // Auto-rollback expired temporary rides (당일 1회 탑승 원아 익일 픽업으로 자동 원복)
    const todayStr = kstDateString();
    const expiredStudents: Student[] = [];
    for (const st of dbStudents) {
      let parsedRaw: any = {};
      try {
        parsedRaw = typeof st.raw === 'string' ? JSON.parse(st.raw) : (st.raw || {});
      } catch(e) {}
      if (parsedRaw && parsedRaw['담임명']) {
        parsedRaw['담임명'] = formatTeacherName(parsedRaw['담임명']);
      }
      if (parsedRaw.isTemporaryRide && parsedRaw.temporaryRideDate && parsedRaw.temporaryRideDate < todayStr) {
        st.assignedVehicle = null;
        st.boardingLocation = parsedRaw.originalBoardingLocation || null;
        st.isNotRiding = parsedRaw.originalIsNotRiding !== undefined ? parsedRaw.originalIsNotRiding : true;
        st.boardStatus = 'SELF_PICKUP';
        parsedRaw.isTemporaryRide = false;
        delete parsedRaw.temporaryRideDate;
        delete parsedRaw.originalIsNotRiding;
        delete parsedRaw.originalBoardingLocation;
        st.raw = parsedRaw;
        expiredStudents.push(st);
      }
    }
    if (expiredStudents.length > 0) {
      await this.studentRepository.save(expiredStudents).catch(err => console.error('Failed to rollback expired temporary rides:', err));
      const expiredIds = expiredStudents.map(s => s.id);
      await this.studentRepository.query(
        `UPDATE student_schedules SET "assignedVehicleId" = NULL WHERE "studentId" = ANY($1::int[])`,
        [expiredIds]
      ).catch(() => {});
    }

    // Query active overrides for today (일회성 탑승 및 당일 탑승지 변경 조회)
    const todayOverrides = await this.scheduleOverrideRepository.find({
      where: {
        startDate: LessThanOrEqual(todayStr),
        endDate: MoreThanOrEqual(todayStr),
      },
      relations: { student: true },
    }).catch(() => []);
    const overrideMap = new Map<number, ScheduleOverride>();
    for (const ov of todayOverrides) {
      if (ov.student?.id) overrideMap.set(ov.student.id, ov);
    }

    // Query pending approval requests for today
    const studentIds = dbStudents.map(s => s.id);
    const pendingApprovals: any[] = studentIds.length > 0 ? await this.studentRepository.query(`
      SELECT ar.id, ar."studentId", ar.type, ar."targetDate", ar.direction, ar."newAddress", ar."newLatitude", ar."newLongitude",
             ar."targetVehicleId", v."busNumber" as "busNumber"
      FROM approval_requests ar
      LEFT JOIN vehicles v ON ar."targetVehicleId" = v.id
      WHERE ar."studentId" = ANY($1::int[])
        AND ar.status = 'PENDING'
        AND ar."targetDate" = $2
    `, [studentIds, todayStr]).catch(() => []) : [];
    const pendingMap = new Map<number, any>();
    for (const p of pendingApprovals) {
      if (p.studentId) pendingMap.set(Number(p.studentId), p);
    }

    let formattedStudents = dbStudents.map(st => {
      let parsedRaw: any = {};
      try {
        parsedRaw = typeof st.raw === 'string' ? JSON.parse(st.raw) : (st.raw || {});
      } catch(e) {}
      if (parsedRaw && parsedRaw['담임명']) {
        parsedRaw['담임명'] = formatTeacherName(parsedRaw['담임명']);
      }

      const override = overrideMap.get(st.id);
      const pendingReq = pendingMap.get(st.id);
      // 승인 완료된 override 건만 실제 노선 및 탑승지에 적용 (PENDING 상태는 승인 전까지 노선에 선반영하지 않음)
      const isOneTimeBoarding = Boolean(override && override.overrideType === OverrideType.ONE_TIME_BOARDING);
      const isAbsence = Boolean(override && override.overrideType === OverrideType.ABSENCE);
      const isLateness = Boolean(override && override.overrideType === OverrideType.LATENESS);
      const isPickup = Boolean(override && (override.overrideType === OverrideType.PICKUP || override.overrideType === OverrideType.INDIVIDUAL_DISMISSAL));
      const isNoShuttle = Boolean(override && override.overrideType === OverrideType.NO_SHUTTLE);

      const isNotRiding = isOneTimeBoarding ? false : Boolean(st.isNotRiding || isAbsence || isNoShuttle || parsedRaw['미탑승'] || parsedRaw['차량미탑승']);
      const needsAddress = !isNotRiding && (!st.address || st.latitude === null || st.latitude === undefined || isNaN(st.latitude) || !st.longitude || isNaN(st.longitude) || !!parsedRaw['주소입력필요']);

      const isOneTimeRide = Boolean(
        isOneTimeBoarding ||
        (override && (override.overrideType === OverrideType.CHANGE_LOCATION || override.overrideType === OverrideType.PICKUP || override.overrideType === OverrideType.LATENESS || override.overrideType === OverrideType.INDIVIDUAL_DISMISSAL)) ||
        (parsedRaw.isTemporaryRide && (!parsedRaw.temporaryRideDate || parsedRaw.temporaryRideDate === todayStr)) ||
        (parsedRaw.rideType === 'TODAY_ONLY' && (!parsedRaw.temporaryRideDate || parsedRaw.temporaryRideDate === todayStr)) ||
        parsedRaw.isTemporaryLocation
      );

      let effectiveBusId = st.assignedVehicle ? st.assignedVehicle.id : null;
      if (isAbsence || isNoShuttle) {
        // 결석 또는 셔틀 미이용 시 해당 호차 탑승자 명단에서 완전 제외
        effectiveBusId = null;
      } else if (override && (override.overrideType === OverrideType.ONE_TIME_BOARDING || override.overrideType === OverrideType.CHANGE_LOCATION) && override.newVehicleId) {
        // 타 차량으로 변경 승인된 경우: 대상 차량으로 배정 변경 (기존 호차에서 빠지고 새 호차로 배정)
        effectiveBusId = override.newVehicleId;
      }

      const effectiveVehicle = effectiveBusId
        ? vehicles.find(v => v.id === effectiveBusId)
        : null;

      const dailyBoardingLocation = override?.newAddress || st.boardingLocation || '';
      const dailyDropoffLocation = st.dropoffLocation || parsedRaw['하차지'] || parsedRaw['하원지'] || '';
      const studentLat = (override && override.latitude) ? Number(override.latitude) : st.latitude;
      const studentLng = (override && override.longitude) ? Number(override.longitude) : st.longitude;

      return {
        id: st.id,
        name: st.adminDisplayName || st.name,
        realName: st.name,
        gender: st.gender || parsedRaw['성별'] || '',
        birthDate: st.birthDate || parsedRaw['생년월일'] || parsedRaw['생일'] || '',
        className: st.className || getStudentClassName(st),
        address: st.address || '',
        boardingLocation: dailyBoardingLocation,
        dropoffLocation: dailyDropoffLocation,
        dailyBoardingLocation,
        dailyDropoffLocation,
        lat: studentLat,
        lng: studentLng,
        isNotRiding,
        boardingType: parsedRaw['탑승구분'] || (isNotRiding ? 'NONE' : (st.assignedDepartureVehicle && !st.assignedVehicle ? 'AFTERNOON_ONLY' : (!st.assignedDepartureVehicle && st.assignedVehicle ? 'MORNING_ONLY' : 'BOTH'))),
        isOneTimeRide,
        overrideType: override?.overrideType || (pendingReq ? pendingReq.type : null),
        overrideReason: override?.reason || null,
        isLateness,
        isPickup,
        isAbsence,
        oneTimeType: override?.overrideType || (pendingReq ? pendingReq.type : (parsedRaw.isTemporaryLocation ? 'CHANGE_LOCATION' : (isOneTimeBoarding ? 'ONE_TIME_BOARDING' : null))),
        addressNeedsInput: needsAddress,
        assignedBusId: effectiveBusId,
        assignedDepartureBusId: st.assignedDepartureVehicle ? st.assignedDepartureVehicle.id : (isOneTimeBoarding ? effectiveBusId : null),
        assignedDepartureBusName: st.assignedDepartureVehicle ? st.assignedDepartureVehicle.busNumber : (isOneTimeBoarding && effectiveVehicle ? effectiveVehicle.busNumber : (parsedRaw['하원차량'] || '')),
        color: effectiveVehicle ? (effectiveVehicle.colorHex || '#64748b') : '#64748b',
        allergies: st.allergies || parsedRaw['알레르기'] || parsedRaw['알러지'] || '',
        raw: {
          ...parsedRaw,
          ...(pendingReq ? { approvalStatus: 'PENDING', isPendingApproval: true, pendingRequest: pendingReq } : {})
        },
        parentPhone: st.phone || st.parentUser?.phone || parsedRaw['부모연락처'] || parsedRaw['연락처'] || parsedRaw['보호자연락처'] || parsedRaw['보호자 연락처'] || parsedRaw['전화번호'] || parsedRaw['학부모전화번호'] || '',
        parentName: st.parentUser?.name || parsedRaw['보호자 성함'] || parsedRaw['학부모 성함'] || parsedRaw['학부모명'] || '',
        schedules: st.schedules,
        isRegistered: !!st.studentUser || !!st.parentUser,
        studentUserId: st.studentUser?.id || null,
        parentUserId: st.parentUser?.id || null,
        isLocked: !!(st.parentUser?.isLocked || st.studentUser?.isLocked),
        approvalStatus: pendingReq ? 'PENDING' : st.approvalStatus,
        teacherMemo: st.teacherMemo || '',
        boardStatus: st.boardStatus || 'WAITING'
      };
    });

    if (userId) {
      const callingUser = await this.userRepository.findOne({ where: { id: userId } });
      if (callingUser) {
        const role = callingUser.role as string;
        const isAdminOrDesk =
          role === 'ACADEMY_ADMIN' ||
          callingUser.role === UserRole.ACADEMY_ADMIN ||
          role === 'SUPER_ADMIN' ||
          callingUser.role === UserRole.SUPER_ADMIN ||
          role === 'DESK_STAFF' ||
          callingUser.role === UserRole.DESK_STAFF;

        const isHomeroom =
          role === 'HOMEROOM_TEACHER' || callingUser.role === UserRole.HOMEROOM_TEACHER;

        if (isHomeroom) {
          const assignedClass = callingUser.assignedClass;
          if (!hasAssignedClass(assignedClass)) {
            formattedStudents = [];
          } else {
            formattedStudents = formattedStudents.filter(s =>
              isSameClass(getStudentClassName(s), assignedClass),
            );
          }
        } else if (!isAdminOrDesk) {
          // 관리자·담당 담임교사 외(기사, 차량선생님 등)는 개인정보(전화번호·생년월일) 마스킹 처리
          formattedStudents = formattedStudents.map(s => ({
            ...s,
            parentPhone: null,
            birthDate: null,
            raw: {
              ...s.raw,
              부모연락처: undefined,
              연락처: undefined,
              학부모연락처: undefined,
              전화번호: undefined,
              생년월일: undefined,
              생일: undefined,
            },
          }));
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

  async approveStaff(vehicleId: number, role: 'DRIVER' | 'TEACHER' | 'SHUTTLE_TEACHER') {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');
    
    if (role === 'DRIVER') vehicle.driverApprovalStatus = 'APPROVED';
    if (role === 'TEACHER' || role === 'SHUTTLE_TEACHER') vehicle.teacherApprovalStatus = 'APPROVED';
    
    await this.vehicleRepository.save(vehicle);

    await this.logAudit({
      action: 'STAFF_APPROVE',
      targetType: 'VEHICLE_STAFF',
      targetId: String(vehicleId),
      details: `차량(${vehicle.busNumber || vehicleId}) 교직원 승인 (역할: ${role})`,
    });

    return { success: true };
  }

  async revokeStaff(vehicleId: number, role: 'DRIVER' | 'TEACHER' | 'SHUTTLE_TEACHER') {
    const vehicle = await this.vehicleRepository.findOne({ where: { id: vehicleId }, relations: { driverUser: true, teacherUser: true } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');
    
    let userToDelete = null;

    if (role === 'DRIVER') {
      userToDelete = vehicle.driverUser;
      vehicle.driverUser = null as any;
      vehicle.driverApprovalStatus = 'UNREGISTERED';
    } else if (role === 'TEACHER' || role === 'SHUTTLE_TEACHER') {
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
    const teacher = await this.userRepository.findOne({
      where: { id: teacherId, role: In([UserRole.TEACHER, UserRole.SHUTTLE_TEACHER, UserRole.HOMEROOM_TEACHER]) },
    });
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

  async setupAcademy(data: any, academyId?: number, userId?: number) {
    const targetAcademyId = data?.academyId || data?.id || academyId;
    let academy = await this.getAcademy(targetAcademyId, userId);

    const lat = data.lat !== undefined ? data.lat : (data.latitude !== undefined ? data.latitude : (academy?.latitude || 37.828456));
    const lng = data.lng !== undefined ? data.lng : (data.longitude !== undefined ? data.longitude : (academy?.longitude || 127.065123));
    const address = data.address !== undefined ? data.address : (data.roadAddress !== undefined ? data.roadAddress : (academy?.roadAddress || ''));
    const name = data.name || academy?.name || '새 유치원';

    let eduLevel = data.educationLevel;
    if (!eduLevel) {
      const nm = String(name).toLowerCase();
      if (nm.includes('초등') || nm.includes('elem')) eduLevel = 'ELEMENTARY';
      else if (nm.includes('중등') || nm.includes('고등') || nm.includes('middle') || nm.includes('high')) eduLevel = 'MIDDLE_HIGH';
      else eduLevel = 'KINDERGARTEN';
    }

    if (!academy) {
      let code = Math.random().toString(36).substring(2, 8).toUpperCase();
      while (await this.academyRepository.findOne({ where: { authCode: code } })) {
        code = Math.random().toString(36).substring(2, 8).toUpperCase();
      }
      academy = this.academyRepository.create({
        name: String(name),
        roadAddress: String(address),
        latitude: String(lat),
        longitude: String(lng),
        businessNumber: data.businessNumber || null,
        educationLevel: eduLevel
      });
    } else {
      academy.name = String(name);
      academy.roadAddress = String(address);
      academy.latitude = String(lat);
      academy.longitude = String(lng);
      if (data.businessNumber !== undefined) {
        academy.businessNumber = data.businessNumber;
      }
      if (data.educationLevel) {
        academy.educationLevel = data.educationLevel;
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
    const todayStr = kstDateString();
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

  public generateZonePolygon(points: [number, number][], bufferKm: number = 0): [number, number][] {
    if (!points || points.length === 0) return [];

    // Deduplicate points
    const pointMap = new Map<string, [number, number]>();
    for (const p of points) {
      if (Array.isArray(p) && p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) {
        pointMap.set(`${p[0].toFixed(6)},${p[1].toFixed(6)}`, [p[0], p[1]]);
      }
    }
    const uniquePoints = Array.from(pointMap.values());
    if (uniquePoints.length === 0) return [];
    if (uniquePoints.length === 1) {
      const [lat, lng] = uniquePoints[0];
      const d = 0.0008;
      return [
        [lat - d, lng - d],
        [lat - d, lng + d],
        [lat + d, lng + d],
        [lat + d, lng - d]
      ];
    }
    if (uniquePoints.length === 2) {
      const [p1, p2] = uniquePoints;
      const dy = p2[0] - p1[0];
      const dx = p2[1] - p1[1];
      const len = Math.sqrt(dy * dy + dx * dx) || 1e-6;
      const d = 0.0007; // ~70m corridor half-width along the route
      const perpY = (-dx / len) * d;
      const perpX = (dy / len) * d;
      return [
        [p1[0] + perpY, p1[1] + perpX],
        [p2[0] + perpY, p2[1] + perpX],
        [p2[0] - perpY, p2[1] - perpX],
        [p1[0] - perpY, p1[1] - perpX]
      ];
    }

    const hull = this.computeConvexHull(uniquePoints);
    return hull && hull.length >= 3 ? hull : uniquePoints.slice(0, 4);
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

    // 2. Generate tight polygon around each vehicle's actual student stops (default buffer 0.25km)
    // Connecting actual student stops tightly without ballooning into empty terrain where no one rides
    const initialPolygons = vehiclePointsList.map((pts, idx) => {
      if (!pts || pts.length === 0) {
        if (centroids[idx]) return this.generateZonePolygon([centroids[idx]!], bufferKm);
        return [];
      }
      return this.generateZonePolygon(pts, bufferKm);
    });

    // 3. Clip ONLY where adjacent vehicle polygons overlap along their shared bisector line
    // Mathematically guarantees:
    // - ZERO overlap between any two vehicle zones (interiors are disjoint)
    // - Adjacent zones TOUCH seamlessly along shared borderlines
    const clippedPolygons: [number, number][][] = [];
    for (let i = 0; i < n; i++) {
      let poly = [...initialPolygons[i]];
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
        classTeacherMap.set(t.assignedClass.trim(), formatTeacherName(t.name.trim()));
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
          rawObj['담임명'] = formatTeacherName(classTeacher);
        } else {
          const rawTeacher = rawObj['담임명'] || rawObj['담임'] || rawObj['담임교사'] || rawObj['선생님'] || rawObj['교사'] || '';
          rawObj['담임명'] = rawTeacher ? formatTeacherName(rawTeacher) : '';
        }
      }

      const allergyVal = rawObj ? (rawObj['알레르기'] || rawObj['알러지'] || rawObj['특이사항(알레르기)'] || '') : '';
      const hasCoords = st.lat !== undefined && st.lat !== null && !isNaN(parseFloat(st.lat)) &&
                        st.lng !== undefined && st.lng !== null && !isNaN(parseFloat(st.lng));
      const sLat = hasCoords ? parseFloat(st.lat) : (null as any);
      const sLng = hasCoords ? parseFloat(st.lng) : (null as any);
      const sAddr = hasCoords ? (st.address || '') : '';
      if (!hasCoords && rawObj) {
        rawObj['주소입력필요'] = true;
        if (st.address && !rawObj['실패주소']) rawObj['실패주소'] = st.address;
      }

      let depVehicle = st.assignedDepartureBusId ? vehicleMap.get(st.assignedDepartureBusId) : null;
      if (!depVehicle && rawObj && rawObj['하원차량']) {
        const dBusNum = String(rawObj['하원차량']).trim();
        depVehicle = vehicles.find(v => v.busNumber === dBusNum || v.busNumber.replace(/[^0-9]/g, '') === dBusNum.replace(/[^0-9]/g, '')) || null;
      }
      const isNotRiding = Boolean(st.isNotRiding || (rawObj && (rawObj['미탑승'] || rawObj['차량미탑승'])));
      const dropLocation = st.dropoffLocation || (rawObj && (rawObj['하차지'] || rawObj['하원지'])) || '';
      const cName = String(st.className || (rawObj && (rawObj['반명'] || rawObj['반'] || rawObj['학급'] || rawObj['className'])) || '').trim();
      if (rawObj) {
        rawObj['반명'] = cName;
        rawObj['반'] = cName;
        rawObj['className'] = cName;
      }

      return this.studentRepository.create({
        name: st.name,
        adminDisplayName,
        className: cName,
        address: sAddr,
        boardingLocation: hasCoords ? (st.boardingLocation || sAddr) : '',
        dropoffLocation: dropLocation,
        latitude: sLat,
        longitude: sLng,
        isNotRiding,
        allergies: allergyVal || st.allergies || '',
        raw: rawObj || st.raw,
        assignedVehicle: isNotRiding ? undefined : (vehicle || undefined),
        assignedDepartureVehicle: isNotRiding ? undefined : (depVehicle || undefined),
        academy: academy
      });
    });

    await this.studentRepository.save(newStudents);

    // Auto-expand vehicle zones to envelop all geocoded students
    try {
      await this.expandZonesToStudents(academy.id, userId);
    } catch (e: any) {
      console.warn('[saveStudents] Auto zone expansion failed:', e?.message || e);
    }

    this.notifyRouteUpdated(academy.id);

    const successCount = newStudents.filter(s => s.latitude && s.longitude).length;
    const failedAddressCount = newStudents.length - successCount;
    return {
      success: true,
      totalCount: newStudents.length,
      successCount,
      failedAddressCount,
      count: newStudents.length,
      message: `총 ${newStudents.length}명 등록 완료 (정상 배차: ${successCount}명, 주소 수동 입력 필요: ${failedAddressCount}명)`
    };
  }

  async updateStudent(studentId: number, data: any, academyId?: number, userId?: number) {
    const targetAcademyId = data?.academyId || academyId;
    let academy = await this.getAcademy(targetAcademyId, userId);

    let student = await this.studentRepository.findOne({
      where: academy ? { id: studentId, academy: { id: academy.id } } : { id: studentId },
      relations: { assignedVehicle: true, assignedDepartureVehicle: true, academy: true }
    });
    if (!student) {
      student = await this.studentRepository.findOne({
        where: { id: studentId },
        relations: { assignedVehicle: true, assignedDepartureVehicle: true, academy: true }
      });
    }
    if (!student) throw new NotFoundException('원아를 찾을 수 없습니다.');
    if (student.academy) {
      academy = student.academy;
    }
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    let parsedRaw: any = {};
    if (student.raw) {
      if (typeof student.raw === 'string') {
        try { parsedRaw = JSON.parse(student.raw); } catch (e) { parsedRaw = {}; }
      } else if (typeof student.raw === 'object') {
        parsedRaw = { ...student.raw };
      }
    }

    if (data.name !== undefined) {
      const cleanName = String(data.name).trim();
      student.name = cleanName;
      student.adminDisplayName = data.adminDisplayName !== undefined ? String(data.adminDisplayName).trim() : cleanName;
      parsedRaw['원아명'] = cleanName;
      parsedRaw['이름'] = cleanName;
      parsedRaw['학생이름/영문이름'] = cleanName;
    } else if (data.adminDisplayName !== undefined) {
      student.adminDisplayName = String(data.adminDisplayName).trim();
    }

    if (data.address !== undefined) {
      const trimmedAddress = String(data.address || '').trim();
      student.address = trimmedAddress;
      student.boardingLocation = String(data.boardingLocation || data.inLocation || trimmedAddress).trim();
      parsedRaw['도로명주소'] = trimmedAddress;
      parsedRaw['주소'] = trimmedAddress;
      parsedRaw['등원지'] = student.boardingLocation;
      parsedRaw['탑승지'] = student.boardingLocation;

      const providedLat = data.lat !== undefined && data.lat !== null && !isNaN(parseFloat(data.lat)) ? parseFloat(data.lat) : undefined;
      const providedLng = data.lng !== undefined && data.lng !== null && !isNaN(parseFloat(data.lng)) ? parseFloat(data.lng) : undefined;

      if (providedLat !== undefined && providedLng !== undefined) {
        student.latitude = providedLat;
        student.longitude = providedLng;
        delete parsedRaw['주소입력필요'];
        delete parsedRaw['실패주소'];
      } else if (trimmedAddress) {
        const coords = await this.geocodeAddress(trimmedAddress);
        if (coords) {
          student.latitude = coords.lat;
          student.longitude = coords.lng;
          delete parsedRaw['주소입력필요'];
          delete parsedRaw['실패주소'];
        } else if (!student.latitude || !student.longitude) {
          student.latitude = null as any;
          student.longitude = null as any;
          parsedRaw['주소입력필요'] = true;
          parsedRaw['실패주소'] = trimmedAddress;
        }
      } else {
        student.latitude = null as any;
        student.longitude = null as any;
        parsedRaw['주소입력필요'] = true;
      }
    } else if (data.boardingLocation !== undefined || data.inLocation !== undefined) {
      student.boardingLocation = String(data.boardingLocation || data.inLocation || '').trim();
      parsedRaw['등원지'] = student.boardingLocation;
      parsedRaw['탑승지'] = student.boardingLocation;
    }

    if (data.className !== undefined) {
      student.className = String(data.className).trim();
      parsedRaw['반명'] = student.className;
      parsedRaw['반'] = student.className;
      parsedRaw['학급'] = student.className;
    }
    if (data.age !== undefined) parsedRaw['연령'] = data.age;
    if (data.birthDate !== undefined) {
      student.birthDate = data.birthDate;
      parsedRaw['생년월일'] = data.birthDate;
    }
    if (data.gender !== undefined) {
      student.gender = data.gender;
      parsedRaw['성별'] = data.gender;
    }
    if (data.parentName !== undefined) {
      parsedRaw['보호자 성함'] = data.parentName;
      parsedRaw['보호자성함'] = data.parentName;
      parsedRaw['학부모성함'] = data.parentName;
      parsedRaw['보호자1 성함'] = data.parentName;
    }
    if (data.parentPhone !== undefined || data.phone !== undefined) {
      const ph = data.parentPhone !== undefined ? data.parentPhone : data.phone;
      student.phone = ph;
      parsedRaw['부모연락처'] = ph;
      parsedRaw['보호자연락처'] = ph;
      parsedRaw['학부모연락처'] = ph;
      parsedRaw['연락처'] = ph;
      parsedRaw['보호자1 연락처'] = ph;
    }
    if (data.parentRelation !== undefined) {
      parsedRaw['보호자 관계'] = data.parentRelation;
      parsedRaw['보호자1 관계'] = data.parentRelation;
    }
    if (data.parent2Name !== undefined) {
      parsedRaw['보호자2 성함'] = data.parent2Name;
      parsedRaw['보호자2성함'] = data.parent2Name;
    }
    if (data.parent2Phone !== undefined) {
      parsedRaw['보호자2 연락처'] = data.parent2Phone;
      parsedRaw['보호자2연락처'] = data.parent2Phone;
      parsedRaw['부모연락처2'] = data.parent2Phone;
      parsedRaw['비상연락처'] = data.parent2Phone;
    }
    if (data.parent2Relation !== undefined) {
      parsedRaw['보호자2 관계'] = data.parent2Relation;
      parsedRaw['보호자2관계'] = data.parent2Relation;
    }
    if (data.teacherName !== undefined) {
      parsedRaw['담임명'] = data.teacherName;
    }
    if (data.departureType !== undefined) {
      parsedRaw['하원구분'] = data.departureType;
    }
    if (data.inTime !== undefined) parsedRaw['등원시간'] = data.inTime;
    if (data.outTime !== undefined) parsedRaw['하원시간'] = data.outTime;
    if (data.allergies !== undefined) {
      student.allergies = data.allergies;
      parsedRaw['알레르기'] = data.allergies;
    }
    if (data.note !== undefined) {
      student.teacherMemo = data.note;
      parsedRaw['비고'] = data.note;
    }

    if (data.boardingType !== undefined) {
      parsedRaw['탑승구분'] = data.boardingType;
      if (data.boardingType === 'NONE') {
        student.isNotRiding = true;
        parsedRaw['차량미탑승'] = true;
        parsedRaw['미탑승'] = true;
        delete parsedRaw['주소입력필요'];
        delete parsedRaw['실패주소'];
        student.assignedVehicle = null as any;
        student.assignedDepartureVehicle = null as any;
      } else {
        student.isNotRiding = false;
        parsedRaw['차량미탑승'] = false;
        parsedRaw['미탑승'] = false;
        if (data.boardingType === 'MORNING_ONLY') {
          student.assignedDepartureVehicle = null as any;
          delete parsedRaw['하원차량'];
        } else if (data.boardingType === 'AFTERNOON_ONLY') {
          student.assignedVehicle = null as any;
          delete parsedRaw['등원차량'];
          delete parsedRaw['호차'];
          delete parsedRaw['차량'];
        }
      }
    } else if (data.isNotRiding !== undefined) {
      student.isNotRiding = Boolean(data.isNotRiding);
      parsedRaw['차량미탑승'] = student.isNotRiding;
      parsedRaw['미탑승'] = student.isNotRiding;
      if (student.isNotRiding) {
        parsedRaw['탑승구분'] = 'NONE';
        delete parsedRaw['주소입력필요'];
        delete parsedRaw['실패주소'];
        student.assignedVehicle = null as any;
        student.assignedDepartureVehicle = null as any;
      }
    }

    if (data.weeklySchedules !== undefined) {
      parsedRaw['요일별일정'] = data.weeklySchedules;
      parsedRaw.weeklySchedules = data.weeklySchedules;
    }

    if (data.dropoffLocation !== undefined || data.outLocation !== undefined) {
      const dropLoc = data.dropoffLocation !== undefined ? data.dropoffLocation : data.outLocation;
      student.dropoffLocation = dropLoc;
      parsedRaw['하차지'] = dropLoc;
      parsedRaw['하원지'] = dropLoc;
    }

    const inBus = data.assignedBusId !== undefined ? data.assignedBusId : (data.inBusId !== undefined ? data.inBusId : data.assignedVehicleId);
    let explicitVehicle: Vehicle | null = null;
    if (inBus) {
      const vehicle = await this.vehicleRepository.findOne({
        where: { id: Number(inBus), academy: { id: academy.id } }
      });
      if (vehicle) {
        explicitVehicle = vehicle;
        student.assignedVehicle = vehicle;
        parsedRaw['등원차량'] = vehicle.busNumber;
        parsedRaw['호차'] = vehicle.busNumber;
        parsedRaw['차량'] = vehicle.busNumber;
      }
    } else if (inBus === null) {
      student.assignedVehicle = null as any;
    }

    const outBus = data.assignedDepartureBusId !== undefined ? data.assignedDepartureBusId : (data.outBusId !== undefined ? data.outBusId : data.assignedDepartureVehicleId);
    let explicitDepVehicle: Vehicle | null = null;
    if (outBus !== undefined) {
      if (outBus) {
        const dVehicle = await this.vehicleRepository.findOne({
          where: { id: Number(outBus), academy: { id: academy.id } }
        });
        if (dVehicle) {
          explicitDepVehicle = dVehicle;
          student.assignedDepartureVehicle = dVehicle;
          parsedRaw['하원차량'] = dVehicle.busNumber;
        }
      } else {
        student.assignedDepartureVehicle = null as any;
      }
    }

    student.raw = parsedRaw;
    await this.studentRepository.save(student);

    // If student now has valid coordinates, auto-expand vehicle zone!
    if (student.latitude && student.longitude && !student.isNotRiding) {
      try {
        await this.expandZonesToStudents(academy.id, userId);
        // Preserve admin's explicit vehicle assignment if expandZonesToStudents altered it
        if (explicitVehicle) {
          student.assignedVehicle = explicitVehicle;
          if (explicitDepVehicle) student.assignedDepartureVehicle = explicitDepVehicle;
          await this.studentRepository.save(student);
        }
      } catch (e: any) {
        console.warn('Auto zone expansion on student update:', e?.message || e);
      }
    }

    this.notifyRouteUpdated(academy.id);
    return { success: true, student };
  }

  async addStudent(studentData: any, academyId?: number, userId?: number) {
    const existingId = studentData?.id || studentData?.editingStudentId || studentData?.studentId;
    if (existingId && !isNaN(Number(existingId))) {
      return this.updateStudent(Number(existingId), studentData, academyId, userId);
    }
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    let lat = studentData.lat !== undefined && studentData.lat !== null && !isNaN(parseFloat(studentData.lat)) ? parseFloat(studentData.lat) : undefined;
    let lng = studentData.lng !== undefined && studentData.lng !== null && !isNaN(parseFloat(studentData.lng)) ? parseFloat(studentData.lng) : undefined;

    if ((lat === undefined || lng === undefined) && (studentData.boardingLocation || studentData.inLocation || studentData.address)) {
      const targetLoc = (studentData.boardingLocation || studentData.inLocation || studentData.address);
      const coords = await this.geocodeAddress(targetLoc) || (studentData.address && studentData.address !== targetLoc ? await this.geocodeAddress(studentData.address) : null);
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
    const rawTeacherFromInput = studentData.teacherName || studentData.raw?.['담임명'] || studentData.raw?.['담임'] || studentData.raw?.['담임교사'] || studentData.raw?.['선생님'] || studentData.raw?.['교사'] || '';
    let teacherName = rawTeacherFromInput ? formatTeacherName(rawTeacherFromInput) : '';
    if (className) {
      const classTeacher = await this.userRepository.findOne({
        where: { academy: { id: academy.id }, assignedClass: className }
      });
      if (classTeacher && classTeacher.name) {
        teacherName = formatTeacherName(classTeacher.name); // Preserve existing teacher!
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
      '보호자1 성함': studentData.parentName || studentData.raw?.['보호자1 성함'] || studentData.raw?.['보호자 성함'] || '',
      '보호자 관계': studentData.parentRelation || studentData.raw?.['보호자 관계'] || '모',
      '보호자1 관계': studentData.parentRelation || studentData.raw?.['보호자1 관계'] || '모',
      '부모연락처': parentPhone,
      '보호자연락처': parentPhone,
      '보호자1 연락처': parentPhone,
      '보호자2 성함': studentData.parent2Name || studentData.raw?.['보호자2 성함'] || '',
      '보호자2 연락처': studentData.parent2Phone || studentData.raw?.['보호자2 연락처'] || studentData.raw?.['부모연락처2'] || studentData.raw?.['비상연락처'] || '',
      '보호자2 관계': studentData.parent2Relation || studentData.raw?.['보호자2 관계'] || '부',
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
    let depVehicle: Vehicle | null = null;
    if (studentData.assignedDepartureBusId) {
      depVehicle = vehicles.find(v => v.id === Number(studentData.assignedDepartureBusId)) || null;
    }
    const isNotRiding = Boolean(studentData.isNotRiding || raw['미탑승'] || raw['차량미탑승']);
    const dropoffLocation = studentData.dropoffLocation || studentData.outLocation || raw['하차지'] || raw['하원지'] || '';
    const cName = String(studentData.className || (raw && (raw['반명'] || raw['반'] || raw['학급'] || raw['className'])) || '').trim();
    if (raw) {
      raw['반명'] = cName;
      raw['반'] = cName;
      raw['className'] = cName;
    }

    const student = this.studentRepository.create({
      name: studentData.name,
      adminDisplayName,
      className: cName,
      address: studentData.address,
      boardingLocation: studentData.inLocation || studentData.boardingLocation || studentData.address,
      dropoffLocation,
      latitude: lat,
      longitude: lng,
      isNotRiding,
      allergies: studentData.allergies || studentData.raw?.['알레르기'] || '',
      raw,
      assignedVehicle: isNotRiding ? undefined : (vehicle || undefined),
      assignedDepartureVehicle: isNotRiding ? undefined : (depVehicle || undefined),
      academy
    });

    const saved = await this.studentRepository.save(student);

    if (lat !== undefined && lng !== undefined) {
      try {
        await this.expandZonesToStudents(academy.id, userId);
        zoneExpanded = true;
      } catch (e: any) {
        console.warn('Auto zone expansion on addStudent:', e?.message || e);
      }
    }

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

  async deleteVehicle(vehicleId: number, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    const vehicleToDelete = await this.vehicleRepository.findOne({
      where: { id: vehicleId, academy: { id: academy.id } }
    });
    if (!vehicleToDelete) throw new NotFoundException('삭제할 차량을 찾을 수 없습니다.');

    // 1. Find all remaining vehicles of this academy
    const remainingVehicles = await this.vehicleRepository.find({
      where: { academy: { id: academy.id } },
      order: { id: 'ASC' }
    });
    const otherVehicles = remainingVehicles.filter(v => v.id !== vehicleId);

    // 2. Reassign students of the deleted vehicle to the closest remaining vehicle
    const studentsOfVehicle = await this.studentRepository.find({
      where: [
        { academy: { id: academy.id }, assignedVehicle: { id: vehicleId } },
        { academy: { id: academy.id }, assignedDepartureVehicle: { id: vehicleId } }
      ]
    });

    if (otherVehicles.length > 0 && studentsOfVehicle.length > 0) {
      for (const st of studentsOfVehicle) {
        if (st.latitude && st.longitude) {
          let closestVeh = otherVehicles[0];
          let minDist = Infinity;
          for (const ov of otherVehicles) {
            let pts: [number, number][] = [];
            try {
              pts = typeof ov.polygonCoordinates === 'string' ? JSON.parse(ov.polygonCoordinates) : (ov.polygonCoordinates || []);
            } catch (e) {}
            if (pts.length > 0) {
              for (const pt of pts) {
                const d = this.getDistanceKm(st.latitude, st.longitude, pt[0], pt[1]);
                if (d < minDist) {
                  minDist = d;
                  closestVeh = ov;
                }
              }
            }
          }
          if (st.assignedVehicle?.id === vehicleId) {
            st.assignedVehicle = closestVeh;
            if (st.raw && typeof st.raw === 'object') st.raw['등원차량'] = closestVeh.busNumber;
          }
          if (st.assignedDepartureVehicle?.id === vehicleId) {
            st.assignedDepartureVehicle = closestVeh;
            if (st.raw && typeof st.raw === 'object') st.raw['하원차량'] = closestVeh.busNumber;
          }
        } else {
          if (st.assignedVehicle?.id === vehicleId) st.assignedVehicle = otherVehicles[0];
          if (st.assignedDepartureVehicle?.id === vehicleId) st.assignedDepartureVehicle = otherVehicles[0];
        }
        await this.studentRepository.save(st);
      }
    }

    // 3. Delete vehicle from DB
    await this.vehicleRepository.delete({ id: vehicleId, academy: { id: academy.id } });

    // 4. Update academy vehicleCount
    academy.vehicleCount = otherVehicles.length;
    await this.academyRepository.save(academy);

    // 5. Expand remaining vehicles' zones to absorb the reassigned students & area!
    if (otherVehicles.length > 0) {
      try {
        await this.expandZonesToStudents(academy.id, userId);
      } catch (e: any) {
        console.warn('Auto zone expansion after vehicle deletion:', e?.message || e);
      }
    }

    this.notifyRouteUpdated(academy.id);
    return {
      success: true,
      message: `${vehicleToDelete.busNumber} 차량이 삭제되었으며, 해당 구역과 원아들이 주변 차량들로 자연스럽게 확장 배정되었습니다.`,
      remainingCount: otherVehicles.length
    };
  }

  async geocodeBulk(addresses: string[]) {
    if (!Array.isArray(addresses)) return [];
    const cache = new Map<string, { lat: number, lng: number } | null>();

    const getBaseKey = (addr: string) => {
      let s = String(addr || '').trim();
      s = s.replace(/\([0-9]+\s*호차\)/g, '').replace(/\[[0-9]+\s*호차\]/g, '');
      s = s.replace(/\d+\s*동\s*\d+\s*호/g, '').replace(/\d+\s*동/g, '').replace(/\d+\s*호/g, '').replace(/\d+\s*-\s*\d+/g, '');
      return s.trim();
    };

    const validAddresses = Array.from(new Set(addresses.map(a => (a && typeof a === 'string') ? a.trim() : '').filter(Boolean)));
    const baseKeyToAddresses = new Map<string, string[]>();
    for (const addr of validAddresses) {
      const baseKey = getBaseKey(addr);
      if (!baseKeyToAddresses.has(baseKey)) {
        baseKeyToAddresses.set(baseKey, []);
      }
      baseKeyToAddresses.get(baseKey)!.push(addr);
    }

    const uniqueBaseKeys = Array.from(baseKeyToAddresses.keys());
    const BATCH_SIZE = 15;
    for (let i = 0; i < uniqueBaseKeys.length; i += BATCH_SIZE) {
      const batch = uniqueBaseKeys.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (baseKey) => {
        const sampleAddr = baseKeyToAddresses.get(baseKey)![0];
        try {
          const coords = await this.geocodeAddress(sampleAddr);
          for (const addr of baseKeyToAddresses.get(baseKey)!) {
            cache.set(addr, coords);
          }
          cache.set(baseKey, coords);
        } catch (e) {
          for (const addr of baseKeyToAddresses.get(baseKey)!) {
            cache.set(addr, null);
          }
          cache.set(baseKey, null);
        }
      }));
    }

    const results = [];
    for (const address of addresses) {
      if (!address || typeof address !== 'string' || !address.trim()) {
        results.push({ address: address || '', coords: null });
        continue;
      }
      const trimmed = address.trim();
      const coords = cache.get(trimmed) || cache.get(getBaseKey(trimmed)) || null;
      results.push({ address: trimmed, coords });
    }
    return results;
  }

  async reverseGeocode(lat: number, lng: number): Promise<{ address: string; roadAddress?: string }> {
    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      return { address: '위치 정보 없음' };
    }
    const apiKey = this.configService.get<string>('KAKAO_REST_API_KEY');
    if (apiKey) {
      try {
        const response = await firstValueFrom(
          this.httpService.get('https://dapi.kakao.com/v2/local/geo/coord2address.json', {
            params: { x: lng, y: lat },
            headers: { Authorization: `KakaoAK ${apiKey}` },
          })
        );
        const doc = response.data?.documents?.[0];
        if (doc) {
          const road = doc.road_address?.address_name;
          const jibun = doc.address?.address_name;
          const building = doc.road_address?.building_name;
          const display = building ? `${road || jibun} (${building})` : (road || jibun);
          return {
            address: display || `지정 좌표 (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
            roadAddress: road || undefined,
          };
        }
      } catch (err) {
        // Kakao reverse geocode error fallback
      }
    }
    return { address: `지정 좌표 (${lat.toFixed(5)}, ${lng.toFixed(5)})` };
  }

  async updateVehicle(id: number, data: Partial<Vehicle>) {
    const vehicle = await this.vehicleRepository.findOne({ where: { id } });
    if (!vehicle) throw new BadRequestException('차량을 찾을 수 없습니다.');

    Object.assign(vehicle, data);
    await this.vehicleRepository.save(vehicle);
    return vehicle;
  }

  async createVehicle(data: any, academyId?: number, userId?: number) {
    const targetAcademyId = data?.academyId || academyId;
    const academy = await this.getAcademy(targetAcademyId, userId);
    if (!academy) throw new BadRequestException('유치원 정보를 찾을 수 없습니다.');

    const busNumber = String(data.busNumber || data.name || '신규호차').trim();
    const vehicle = this.vehicleRepository.create({
      busNumber,
      plateNumber: data.plateNumber ? String(data.plateNumber).trim() : '',
      driverName: data.driverName ? String(data.driverName).trim() : '미정',
      driverPhone: data.driverPhone ? String(data.driverPhone).trim() : '000-0000-0000',
      teacherName: data.teacherName ? formatTeacherName(String(data.teacherName).trim()) : '미정',
      teacherPhone: data.teacherPhone ? String(data.teacherPhone).trim() : '000-0000-0000',
      capacity: Number(data.capacity) || 25,
      colorHex: data.color || data.colorHex || this.getDistinctColor(),
      polygonCoordinates: Array.isArray(data.polygonCoordinates) ? data.polygonCoordinates : [],
      academy,
    });

    const saved = await this.vehicleRepository.save(vehicle);
    const allCount = await this.vehicleRepository.count({ where: { academy: { id: academy.id } } });
    academy.vehicleCount = allCount;
    await this.academyRepository.save(academy).catch(() => {});

    this.notifyRouteUpdated(academy.id);
    return {
      id: saved.id,
      name: saved.busNumber,
      busNumber: saved.busNumber,
      plateNumber: saved.plateNumber,
      driverName: saved.driverName,
      driverPhone: saved.driverPhone,
      teacherName: saved.teacherName,
      teacherPhone: saved.teacherPhone,
      capacity: saved.capacity,
      color: saved.colorHex,
      points: [],
      polygon: [],
      polygonCoordinates: [],
      driverApprovalStatus: saved.driverApprovalStatus,
      teacherApprovalStatus: saved.teacherApprovalStatus,
    };
  }

  async saveSubstituteStaff(body: any, academyId?: number, userId?: number) {
    const busId = Number(body.busId || body.vehicleId);
    if (!busId) throw new BadRequestException('차량 ID가 필요합니다.');

    const vehicle = await this.vehicleRepository.findOne({
      where: { id: busId },
      relations: { academy: true, driverUser: true, teacherUser: true },
    });
    if (!vehicle) throw new BadRequestException('해당 차량을 찾을 수 없습니다.');

    const bcrypt = require('bcrypt');
    const prevState = this.substituteStaffMap.get(busId) || {};
    const origDriverUserId = prevState.origDriverUserId !== undefined ? prevState.origDriverUserId : (vehicle.driverUser?.id || null);
    const origTeacherUserId = prevState.origTeacherUserId !== undefined ? prevState.origTeacherUserId : (vehicle.teacherUser?.id || null);

    // Handle Substitute Driver Account
    if (body.substituteDriver?.email) {
      const subEmail = String(body.substituteDriver.email).trim().toLowerCase();
      const subPass = body.substituteDriver.password || 'password123!';
      const passHash = await bcrypt.hash(subPass, 10);
      let subUser = await this.userRepository.findOne({ where: { email: subEmail } });
      if (!subUser) {
        subUser = this.userRepository.create({
          email: subEmail,
          passwordHash: passHash,
          role: UserRole.DRIVER,
          name: body.substituteDriver.name || '대체 기사님',
          phone: body.substituteDriver.phone || '010-9999-1001',
          academy: vehicle.academy,
          academyId: vehicle.academy?.id,
          approvalStatus: 'APPROVED',
          isLocked: !body.isDriverResting,
        });
      } else {
        subUser.passwordHash = passHash;
        subUser.name = body.substituteDriver.name || subUser.name;
        subUser.phone = body.substituteDriver.phone || subUser.phone;
        subUser.academyId = vehicle.academy?.id || subUser.academyId;
        subUser.approvalStatus = 'APPROVED';
        subUser.isLocked = !body.isDriverResting;
        subUser.failedLoginAttempts = 0;
      }
      await this.userRepository.save(subUser);
    }

    // Handle Substitute Teacher Account
    if (body.substituteTeacher?.email) {
      const subEmail = String(body.substituteTeacher.email).trim().toLowerCase();
      const subPass = body.substituteTeacher.password || 'password123!';
      const passHash = await bcrypt.hash(subPass, 10);
      let subUser = await this.userRepository.findOne({ where: { email: subEmail } });
      if (!subUser) {
        subUser = this.userRepository.create({
          email: subEmail,
          passwordHash: passHash,
          role: UserRole.SHUTTLE_TEACHER,
          name: body.substituteTeacher.name || '대체 교사님',
          phone: body.substituteTeacher.phone || '010-9999-2001',
          academy: vehicle.academy,
          academyId: vehicle.academy?.id,
          approvalStatus: 'APPROVED',
          isLocked: !body.isTeacherResting,
        });
      } else {
        subUser.passwordHash = passHash;
        subUser.name = body.substituteTeacher.name || subUser.name;
        subUser.phone = body.substituteTeacher.phone || subUser.phone;
        subUser.academyId = vehicle.academy?.id || subUser.academyId;
        subUser.approvalStatus = 'APPROVED';
        subUser.isLocked = !body.isTeacherResting;
        subUser.failedLoginAttempts = 0;
      }
      await this.userRepository.save(subUser);
    }

    this.substituteStaffMap.set(busId, {
      isDriverResting: Boolean(body.isDriverResting),
      substituteDriver: body.substituteDriver || null,
      isTeacherResting: Boolean(body.isTeacherResting),
      substituteTeacher: body.substituteTeacher || null,
      origDriverUserId,
      origTeacherUserId,
    });

    return {
      success: true,
      busId,
      isDriverResting: Boolean(body.isDriverResting),
      substituteDriver: body.substituteDriver,
      isTeacherResting: Boolean(body.isTeacherResting),
      substituteTeacher: body.substituteTeacher,
    };
  }

  async saveDispatch(body: any, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (Array.isArray(body.buses)) {
      for (const b of body.buses) {
        if (!b.id) continue;
        const v = await this.vehicleRepository.findOne({ where: { id: Number(b.id) } });
        if (!v) continue;
        if (b.points || b.polygonCoordinates) {
          v.polygonCoordinates = b.points || b.polygonCoordinates;
        }
        if (b.driverName !== undefined) v.driverName = b.driverName;
        if (b.teacherName !== undefined) v.teacherName = b.teacherName;
        if (b.plateNumber !== undefined) v.plateNumber = b.plateNumber;
        if (b.capacity !== undefined) v.capacity = Number(b.capacity) || 25;
        await this.vehicleRepository.save(v);
      }
    }
    if (Array.isArray(body.students) && body.students.length > 0) {
      await this.batchUpdateStudents(
        body.students.map((s: any) => ({
          id: s.id,
          inBusId: s.assignedBusId,
          outBusId: s.assignedDepartureBusId !== undefined ? s.assignedDepartureBusId : s.assignedBusId,
          isNotRiding: s.isNotRiding,
          boardingLocation: s.boardingLocation,
        })),
        academy?.id || academyId,
        userId,
      );
    }
    if (academy?.id) {
      this.notifyRouteUpdated(academy.id);
    }
    return { success: true };
  }

  async getDailyLogs(date: string, vehicleId: number) {
    const logs = [];

    // 1. Get OperationLogs for the date and vehicle
    // 한국 날짜로 저장하게 되면서 같은 날 등원·하원 운행 일지가 함께 있을 수 있으니 모두 가져와 합친다
    const opLogs = await this.operationLogRepository.find({
      where: { dateString: date, vehicle: { id: vehicleId } },
      order: { id: 'ASC' },
    });

    const toSafeIsoString = (val: any) => {
      if (!val) return new Date().toISOString();
      const d = new Date(val);
      return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    };

    for (const opLog of opLogs) {
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

      let age = raw['연령'] || raw['학년'] || raw['나이'] || '';
      if (!age && student.birthDate) {
        const bYear = parseInt(String(student.birthDate).slice(0, 4), 10);
        if (!isNaN(bYear)) age = `${new Date().getFullYear() - bYear + 1}세`;
      }
      if (!age) age = '연령 미입력';

      return {
        className: student.className || raw['반명'] || raw['학급'] || raw['반'] || '반 미지정',
        name: student.adminDisplayName || student.name || raw['원아명'] || raw['학생이름/영문이름'] || raw['이름'] || '',
        kindergartenName: academy?.name || raw['유치원명'] || raw['소속원명'] || raw['학교명'] || '',
        age,
        gender: student.gender || raw['성별'] || '',
        parentName: student.parentUser?.name || raw['보호자 성함'] || raw['보호자1 성함'] || raw['학부모성함'] || '',
        parentPhone: student.phone || student.parentUser?.phone || raw['부모연락처'] || raw['보호자연락처'] || raw['보호자 연락처'] || '',
        address: student.address || raw['주소'] || '',
        inLocation: sched?.address || raw['등원지'] || raw['탑승지'] || student.boardingLocation || student.address || '',
        outLocation: raw['하원지'] || sched?.address || student.dropoffLocation || student.boardingLocation || student.address || '',
        teacherName: raw['담임명'] || '',
        departureType: getDepartureType(raw),
        inBus: sched?.assignedVehicle?.busNumber || raw['등원차량'] || student.assignedVehicle?.busNumber || '배정 대기',
        outBus: raw['하원차량'] || sched?.assignedVehicle?.busNumber || student.assignedDepartureVehicle?.busNumber || student.assignedVehicle?.busNumber || '배정 대기',
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

    return Buffer.from(buffer as any);
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
    if (!academy) return [];
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

  async getAdminMessages(academyId?: number, userId?: number) {
    const academy = await this.getAcademy(academyId, userId);
    if (!academy) return [];

    return this.parentMessageRepository.createQueryBuilder('msg')
      .leftJoinAndSelect('msg.student', 'student')
      .leftJoinAndSelect('msg.receiverUser', 'receiverUser')
      .where('msg.targetRoles LIKE :role', { role: '%ACADEMY_ADMIN%' })
      .andWhere('(student.academyId = :academyId OR receiverUser.academyId = :academyId OR receiverUser.id = :userId)', {
        academyId: academy.id,
        userId: userId || 0
      })
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
       dateString: kstDateString(),
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
    postType?: string;
  }) {
    const { academyId, userId, visibility, targetClass, search, postType } = params;
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

    if (postType && postType.trim()) {
      qb.andWhere('post.postType = :postType', { postType: postType.trim() });
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
          // 담임: 전체 공개 + 내 반 글
          applyBoardVisibility(qb, [assignedClass]);
        }
      } else if (callingUser && (callingUser.role === UserRole.PARENT || callingUser.role === UserRole.STUDENT)) {
        // 학부모/학생: 전체 공개 + 내 아이(본인) 반 글 (반이 없으면 전체 공개만)
        applyBoardVisibility(qb, await getLinkedClassNames(this.studentRepository, callingUser.id));
      }
    }

    if (search && search.trim()) {
      qb.andWhere('(post.title ILIKE :kw OR post.content ILIKE :kw OR post.authorName ILIKE :kw)', { kw: `%${search.trim()}%` });
    }

    const posts = await qb.getMany();

    // 작성자 계정(authorUserId)의 현재 역할로 authorRole 표출
    const authorUserIds = posts.map(p => p.authorUserId).filter(Boolean);
    if (authorUserIds.length > 0) {
      const authorUsers = await this.userRepository.find({ where: { id: In(authorUserIds) } });
      const roleMap = new Map<number, string>(authorUsers.map(u => [u.id, u.role]));
      for (const p of posts) {
        if (p.authorUserId && roleMap.has(p.authorUserId)) {
          p.authorRole = roleMap.get(p.authorUserId)!;
        }
      }
    }

    return Promise.all(posts.map(p => this.hydratePostMedia(p)));
  }

  private async hydratePostMedia(post: BoardPost): Promise<BoardPost> {
    if (!post) return post;
    const [resolvedImageUrl, resolvedImages] = await Promise.all([
      resolveMediaRef(post.imageUrl),
      resolveMediaRefs(post.images),
    ]);
    return {
      ...post,
      imageUrl: resolvedImageUrl,
      images: resolvedImages,
    } as BoardPost;
  }

  /** 글을 볼 수 있는 사용자인지 서버에서 검사 (다른 기관 / 다른 반 글 차단) */
  private async assertCanViewPost(post: BoardPost, viewer?: { sub?: number; role?: string; academyId?: number | null }) {
    if (!viewer || !viewer.sub || viewer.role === 'SUPER_ADMIN') return;
    const user = await this.userRepository.findOne({ where: { id: viewer.sub } });
    if (!user) throw new ForbiddenException('권한이 없습니다.');
    const postAcademyId = post.academy?.id;
    const userAcademyId = viewer.academyId ?? user.academyId;
    if (postAcademyId && userAcademyId && Number(postAcademyId) !== Number(userAcademyId)) {
      throw new ForbiddenException('다른 기관의 글은 볼 수 없습니다.');
    }
    if (user.role === UserRole.PARENT || user.role === UserRole.STUDENT) {
      const classes = await getLinkedClassNames(this.studentRepository, user.id);
      if (!canViewBoardPost(post, classes)) throw new ForbiddenException('다른 반 글은 볼 수 없습니다.');
    } else if ((user.role as string) === 'HOMEROOM_TEACHER') {
      if (!canViewBoardPost(post, [user.assignedClass])) throw new ForbiddenException('다른 반 글은 볼 수 없습니다.');
    }
  }

  async getBoardPostById(id: number, viewer?: { sub?: number; role?: string; academyId?: number | null }) {
    const post = await this.boardPostRepository.findOne({
      where: { id },
      relations: { comments: true, academy: true }
    });
    if (!post) throw new BadRequestException('게시글을 찾을 수 없습니다.');
    await this.assertCanViewPost(post, viewer);
    if (post.authorUserId) {
      const author = await this.userRepository.findOne({ where: { id: post.authorUserId } });
      if (author?.role) {
        post.authorRole = author.role;
      }
    }
    return this.hydratePostMedia(post);
  }

  /**
   * 학부모·학생이 글(알림장 포함)을 열었을 때 '읽음'으로 남긴다. 이미 읽은 글이면 아무 일도 하지 않는다.
   * - 글을 볼 수 있는 사람만 가능 (다른 기관·다른 반 글은 getBoardPostById 에서 막힌다)
   * - 교직원이 열어 본 것은 기록하지 않는다
   */
  async markBoardPostRead(id: number, viewer?: { sub?: number; role?: string; academyId?: number | null }) {
    const post = await this.getBoardPostById(id, viewer);
    const isFamily = viewer?.role === UserRole.PARENT || viewer?.role === UserRole.STUDENT;
    if (!viewer?.sub || !isFamily) return { read: false };
    const exists = await this.boardPostReadRepository.findOne({ where: { postId: post.id, userId: viewer.sub } });
    if (!exists) {
      try {
        await this.boardPostReadRepository.save(this.boardPostReadRepository.create({ postId: post.id, userId: viewer.sub }));
      } catch {
        // 동시에 두 번 눌려 이미 저장된 경우(중복 방지 키)는 무시한다
      }
    }
    return { read: true };
  }

  /**
   * 이 글을 누가 읽었는지 (교직원 전용)
   * - 글을 볼 수 있는 학부모(전체 공개 글이면 기관 전체, 반 글이면 그 반 학부모)가 대상이다.
   * - 학부모·학생은 볼 수 없다. (다른 학부모가 읽었는지는 교직원에게만 보인다)
   */
  async getBoardPostReaders(id: number, viewer?: { sub?: number; role?: string; academyId?: number | null }) {
    if (viewer?.role === UserRole.PARENT || viewer?.role === UserRole.STUDENT) {
      throw new ForbiddenException('읽음 명단은 교직원만 볼 수 있습니다.');
    }
    const post = await this.getBoardPostById(id, viewer);
    const academyId = post.academy?.id;
    const students = academyId
      ? await this.studentRepository.find({ where: { academy: { id: academyId } }, relations: { parentUser: true } })
      : [];

    // 이 글을 볼 수 있는 학부모(계정)별로 자녀 이름을 모은다
    const targets = new Map<number, { userId: number; name: string; childNames: string[] }>();
    for (const s of students) {
      const parent = s.parentUser;
      if (!parent) continue;
      if (!canViewBoardPost(post, [getStudentClassName(s)])) continue;
      const entry = targets.get(parent.id) ?? { userId: parent.id, name: parent.name || '학부모', childNames: [] };
      const child = s.adminDisplayName || s.name;
      if (child && !entry.childNames.includes(child)) entry.childNames.push(child);
      targets.set(parent.id, entry);
    }

    const reads = await this.boardPostReadRepository.find({ where: { postId: post.id }, order: { readAt: 'ASC' } });
    const readAtByUser = new Map<number, Date>(reads.map(r => [r.userId, r.readAt]));

    const readers = [...targets.values()]
      .filter(t => readAtByUser.has(t.userId))
      .map(t => ({ ...t, readAt: readAtByUser.get(t.userId) }))
      .sort((a, b) => new Date(a.readAt as Date).getTime() - new Date(b.readAt as Date).getTime());
    const unread = [...targets.values()].filter(t => !readAtByUser.has(t.userId));

    return { postId: post.id, total: targets.size, readCount: readers.length, readers, unread };
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
    postType?: string;
    academyId?: number;
  }, academyId?: number, userId?: number) {
    const academy = await this.getAcademy(body.academyId || academyId, userId);
    let targetClass = body.targetClass || null;
    let authorRole = body.authorRole || 'ADMIN';
    const postType = body.postType === 'NOTICE' ? 'NOTICE' : 'POST';
    // 공개 범위는 '전체 공개(ALL)' 또는 '나의 반/특정 반(CLASS)' 두 가지만 허용
    const visibility = body.visibility === 'CLASS' ? 'CLASS' : 'ALL';

    if (userId) {
      const callingUser = await this.userRepository.findOne({ where: { id: userId } });
      if (callingUser && ((callingUser.role as string) === 'HOMEROOM_TEACHER' || callingUser.role === UserRole.HOMEROOM_TEACHER)) {
        if (!hasAssignedClass(callingUser.assignedClass)) {
          throw new BadRequestException('관리자에게 반 배정을 요청하세요.');
        }
        // 담임은 '나의 반'이면 항상 자기 반으로 저장 (다른 반을 지정할 수 없다)
        targetClass = callingUser.assignedClass;
        authorRole = 'HOMEROOM_TEACHER';
      }
    }
    if (visibility === 'CLASS' && !targetClass) {
      throw new BadRequestException('나의 반 공개는 반 정보가 필요합니다. 관리자에게 반 배정을 요청하세요.');
    }

    const post = this.boardPostRepository.create({
      title: body.title,
      content: body.content,
      postType,
      imageUrl: toStoredMediaRef(body.imageUrl) || null,
      images: toStoredMediaRefs(body.images),
      authorName: body.authorName || '기관 관리자',
      authorRole,
      authorUserId: userId || null,
      visibility,
      targetClass,
      className: targetClass,
      academy: academy || undefined,
      likeCount: 0,
      likedUserIds: [],
    } as any);
    const saved = (await this.boardPostRepository.save(post)) as unknown as BoardPost;

    const rawRefs: string[] = [];
    if (saved.imageUrl) rawRefs.push(saved.imageUrl);
    if (Array.isArray(saved.images)) {
      for (const img of saved.images) {
        if (img && !rawRefs.includes(img)) rawRefs.push(img);
      }
    }

    if (rawRefs.length > 0 && academy?.id) {
      const sourceType = saved.postType === 'NOTICE' ? 'NOTICE' : 'BOARD';
      for (const ref of rawRefs) {
        const asset = this.mediaAssetRepository.create({
          academyId: academy.id,
          uploaderId: userId || 0,
          uploaderName: body.authorName || '작성자',
          uploaderRole: authorRole,
          storageKey: ref,
          filename: ref.split('/').pop() || 'photo.jpg',
          sourceType,
          postId: saved.id,
          className: saved.targetClass || null,
        });
        await this.mediaAssetRepository.save(asset);
      }
    }

    if (academy?.id) {
      const alertMsg = saved.postType === 'NOTICE' ? '새 알림장이 등록되었습니다.' : '새 게시물이 등록되었습니다.';
      this.notifyRouteUpdated(academy.id, alertMsg);
      void this.pushNewBoardPost(saved, academy.id, userId);
    }
    return this.hydratePostMedia(saved);
  }

  async updateBoardPost(id: number, body: {
    title?: string;
    content?: string;
    imageUrl?: string;
    images?: string[];
    visibility?: string;
    targetClass?: string;
    postType?: string;
  }, userId?: number, userRole?: string, academyId?: number) {
    const post = await this.boardPostRepository.findOne({ where: { id }, relations: { academy: true } });
    if (!post) throw new BadRequestException('게시글을 찾을 수 없습니다.');
    const isSuper = userRole === 'SUPER_ADMIN';
    const isAdmin = isSuper || userRole === 'ADMIN' || userRole === 'ACADEMY_ADMIN';

    // 테넌트 격리 검증: 타 기관 게시글 수정 원천 차단
    if (!isSuper && academyId && post.academy?.id && post.academy.id !== academyId) {
      throw new ForbiddenException('타 기관의 게시글은 수정할 수 없습니다.');
    }

    if (!isAdmin && userId && post.authorUserId && post.authorUserId !== userId) {
      throw new ForbiddenException('작성자 본인 또는 기관 관리자만 수정할 수 있습니다.');
    }
    if (body.title !== undefined) post.title = body.title;
    if (body.content !== undefined) post.content = body.content;
    if (body.imageUrl !== undefined) (post as any).imageUrl = toStoredMediaRef(body.imageUrl) || null;
    if (body.images !== undefined) post.images = toStoredMediaRefs(body.images);
    if (body.visibility !== undefined) post.visibility = body.visibility === 'CLASS' ? 'CLASS' : 'ALL';
    if (body.targetClass !== undefined) post.targetClass = body.targetClass;
    if (userId) {
      // 담임이 수정할 때 '나의 반'은 항상 자기 반으로 고정 (다른 반으로 바꿀 수 없다)
      const editor = await this.userRepository.findOne({ where: { id: userId } });
      if (editor && (editor.role as string) === 'HOMEROOM_TEACHER' && hasAssignedClass(editor.assignedClass)) {
        post.targetClass = editor.assignedClass;
        post.className = editor.assignedClass;
      }
    }
    if (post.visibility === 'CLASS' && !post.targetClass) {
      throw new BadRequestException('나의 반 공개는 반 정보가 필요합니다.');
    }
    if (body.postType !== undefined) {
      post.postType = body.postType === 'NOTICE' ? 'NOTICE' : 'POST';
      await this.mediaAssetRepository.update(
        { postId: post.id },
        { sourceType: post.postType === 'NOTICE' ? 'NOTICE' : 'BOARD' }
      );
    }
    const saved = (await this.boardPostRepository.save(post)) as unknown as BoardPost;
    return this.hydratePostMedia(saved);
  }

  async deleteBoardPost(id: number, userId?: number, userRole?: string, academyId?: number) {
    const post = await this.boardPostRepository.findOne({ where: { id }, relations: { academy: true } });
    if (!post) throw new BadRequestException('게시글을 찾을 수 없습니다.');
    const isSuper = userRole === 'SUPER_ADMIN';
    const isAdmin = isSuper || userRole === 'ADMIN' || userRole === 'ACADEMY_ADMIN';

    // 테넌트 격리 검증: 타 기관 게시글 삭제 원천 차단
    if (!isSuper && academyId && post.academy?.id && post.academy.id !== academyId) {
      throw new ForbiddenException('타 기관의 게시글은 삭제할 수 없습니다.');
    }

    if (!isAdmin && userId && post.authorUserId && post.authorUserId !== userId) {
      throw new ForbiddenException('작성자 본인 또는 기관 관리자만 삭제할 수 있습니다.');
    }
    const relatedMedia = await this.mediaAssetRepository.find({ where: { postId: id } });
    if (relatedMedia.length > 0) {
      await this.mediaAssetRepository.remove(relatedMedia);
    }
    await this.boardPostRepository.delete(id);
    return { success: true };
  }

  /**
   * 좋아요 누르기/취소
   * - 글을 볼 수 있는 사람만 가능 (다른 기관·다른 반 학부모는 getBoardPostById 에서 막힌다)
   * - 누른 사람은 로그인 계정으로 정한다 (앱이 보낸 userId 는 로그인 정보가 없을 때만 사용)
   */
  async toggleBoardPostLike(id: number, viewer?: { sub?: number; role?: string; academyId?: number | null }, fallbackUid?: string) {
    const post = await this.getBoardPostById(id, viewer);
    const uid = viewer?.sub ? String(viewer.sub) : (fallbackUid || 'admin');
    let liked = Array.isArray(post.likedUserIds) ? post.likedUserIds.map(String) : [];
    const exists = liked.includes(uid);
    let likeCount = post.likeCount || 0;
    if (exists) {
      liked = liked.filter(u => u !== uid);
      likeCount = Math.max(0, likeCount - 1);
    } else {
      liked.push(uid);
      likeCount += 1;
    }
    // getBoardPostById 는 사진 주소를 임시 주소로 바꿔 돌려주므로, 글 전체를 저장하지 않고 좋아요 칸만 고친다
    await this.boardPostRepository.update(id, { likedUserIds: liked, likeCount });
    return { likeCount, isLiked: !exists };
  }

  /**
   * 댓글 쓰기
   * - 글을 볼 수 있는 사람만 가능: 학부모는 전체 공개 글과 내 아이 반 글에만 쓸 수 있다
   * - 학부모·학생 댓글은 표시 역할을 앱이 보낸 값과 상관없이 PARENT/STUDENT 로 고정한다 (교직원 사칭 방지)
   */
  async addBoardComment(postId: number, body: {
    content: string;
    authorName?: string;
    authorRole?: string;
  }, viewer?: { sub?: number; role?: string; academyId?: number | null }) {
    const post = await this.getBoardPostById(postId, viewer);
    const content = String(body?.content ?? '').trim();
    if (!content) throw new BadRequestException('댓글 내용을 입력해 주세요.');
    if (content.length > 1000) throw new BadRequestException('댓글은 1000자까지 쓸 수 있습니다.');

    let authorName = (body?.authorName || '').toString().trim() || '원장선생님';
    let authorRole = (body?.authorRole || '').toString().trim() || 'ADMIN';
    if (viewer?.sub) {
      const user = await this.userRepository.findOne({ where: { id: viewer.sub } });
      if (user && (user.role === UserRole.PARENT || user.role === UserRole.STUDENT)) {
        authorRole = user.role === UserRole.PARENT ? 'PARENT' : 'STUDENT';
        authorName = ((body?.authorName || user.name || '학부모').toString().trim()).slice(0, 30);
      } else if (user) {
        if (!body?.authorName && user.name) authorName = user.name;
        if (!body?.authorRole && user.role) authorRole = String(user.role);
      }
    }

    const comment = this.boardCommentRepository.create({
      post: { id: post.id } as BoardPost,
      content,
      authorName: authorName.slice(0, 100),
      authorRole: authorRole.slice(0, 50),
      authorUserId: viewer?.sub ?? null,
    });
    return this.boardCommentRepository.save(comment);
  }

  /**
   * 댓글 지우기
   * - 학부모·학생: 본인이 쓴 댓글만
   * - 교직원: 같은 기관 글의 댓글만 (최고관리자는 모두)
   */
  async deleteBoardComment(commentId: number, viewer?: { sub?: number; role?: string; academyId?: number | null }) {
    const comment = await this.boardCommentRepository.findOne({
      where: { id: commentId },
      relations: { post: { academy: true } },
    });
    if (!comment) return { success: true };
    if (viewer?.sub && viewer.role !== 'SUPER_ADMIN') {
      const isFamily = viewer.role === UserRole.PARENT || viewer.role === UserRole.STUDENT;
      if (isFamily) {
        if (comment.authorUserId == null || Number(comment.authorUserId) !== Number(viewer.sub)) {
          throw new ForbiddenException('본인이 쓴 댓글만 지울 수 있습니다.');
        }
      } else {
        const postAcademyId = comment.post?.academy?.id;
        if (postAcademyId && viewer.academyId && Number(postAcademyId) !== Number(viewer.academyId)) {
          throw new ForbiddenException('다른 기관의 댓글은 지울 수 없습니다.');
        }
      }
    }
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
    const student = await this.studentRepository.findOne({ where: { id: studentId }, relations: { academy: true } });
    if (!student) throw new BadRequestException('원아를 찾을 수 없습니다.');
    const prevStatus = student.boardStatus;
    student.boardStatus = boardStatus;
    await this.studentRepository.save(student);

    // 원아 이름이 들어가는 알림은 그 원아와 연결된 사람에게만 보낸다 (기관 전체 공지 채널로 보내지 않는다)
    if (boardStatus === 'ABSENT') {
      this.notifyStudentRelated(
        student.id,
        '원생 결석 알림',
        `${student.name} 학생(원아)이(가) 오늘 결석 처리되었습니다.`,
        ['PARENT', 'HOMEROOM', 'VEHICLE'],
        { type: 'shuttle' },
      );
    } else if (boardStatus === 'SELF_PICKUP') {
      this.notifyStudentRelated(
        student.id,
        '개별 픽업 알림',
        `${student.name} 학생(원아)의 하원 방법이 보호자 직접 픽업으로 변경되었습니다.`,
        ['PARENT', 'HOMEROOM', 'VEHICLE'],
        { type: 'shuttle' },
      );
    } else if (boardStatus === 'WAITING' && prevStatus && prevStatus !== 'WAITING') {
      this.notifyStudentRelated(
        student.id,
        '셔틀 탑승 희망 알림',
        `${student.name} 학생(원아)이(가) 셔틀 탑승을 희망하여 탑승 대기로 변경되었습니다.`,
        ['HOMEROOM', 'VEHICLE'],
        { type: 'shuttle' },
      );
    }

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
    student.className = className || '';
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
      st.className = className || '';
    }
    await this.studentRepository.save(students);
    return { success: true, count: students.length, className };
  }

  async batchUpdateStudents(
    updates: any[],
    academyId?: number,
    userId?: number,
  ) {
    if (!Array.isArray(updates) || updates.length === 0) return { success: true, count: 0 };
    let academy = await this.getAcademy(academyId, userId);
    if (!academy && updates[0]?.id) {
      const sampleSt = await this.studentRepository.findOne({
        where: { id: updates[0].id },
        relations: { academy: true }
      });
      if (sampleSt?.academy) {
        academy = sampleSt.academy;
      }
    }
    if (!academy) throw new BadRequestException('기관 정보를 찾을 수 없습니다.');

    let updatedCount = 0;
    const scheduleRepo = this.studentRepository.manager.getRepository(StudentSchedule);
    for (const item of updates) {
      if (!item.id) continue;
      const student = await this.studentRepository.findOne({
        where: { id: item.id, academy: { id: academy.id } },
        relations: { schedules: { assignedVehicle: true }, assignedVehicle: true, assignedDepartureVehicle: true },
      });
      if (!student) continue;

      let rawObj: any = student.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch { rawObj = {}; }
      }
      if (!rawObj || typeof rawObj !== 'object') rawObj = {};

      if (item.name && item.name.trim()) {
        student.name = item.name.trim();
        student.adminDisplayName = item.name.trim();
        rawObj['원생명'] = item.name.trim();
        rawObj['학생이름/영문이름'] = item.name.trim();
      }
      if (item.gender !== undefined) {
        student.gender = item.gender;
        rawObj['성별'] = item.gender;
      }
      if (item.birthDate !== undefined) {
        student.birthDate = item.birthDate;
        rawObj['생년월일'] = item.birthDate;
      }
      if (item.className !== undefined) {
        student.className = item.className;
        rawObj['반명'] = item.className;
        rawObj['반'] = item.className;
      }
      if (item.phone !== undefined) {
        student.phone = item.phone;
        rawObj['학부모연락처'] = item.phone;
        rawObj['연락처'] = item.phone;
      }

      // 등원 차량 반영
      const inBus = item.inBusId !== undefined ? item.inBusId : (item.assignedBusId !== undefined ? item.assignedBusId : item.assignedVehicleId);
      if (inBus !== undefined) {
        const inVehicle = inBus ? await this.vehicleRepository.findOne({ where: { id: Number(inBus), academy: { id: academy.id } } }) : null;
        let inSched = student.schedules?.find(s => s.type === 'BOARDING');
        if (inSched) {
          inSched.assignedVehicle = inVehicle as any;
          await scheduleRepo.save(inSched);
        } else if (inVehicle) {
          const newSched = scheduleRepo.create({
            student,
            type: 'BOARDING',
            dayOfWeek: 'MON',
            address: student.address || '',
            assignedVehicle: inVehicle,
          });
          await scheduleRepo.save(newSched);
        }
        student.assignedVehicle = inVehicle || null as any;
        if (inVehicle) {
          rawObj['등원차량'] = inVehicle.busNumber;
          rawObj['호차'] = inVehicle.busNumber;
          rawObj['차량'] = inVehicle.busNumber;
        } else {
          delete rawObj['등원차량'];
        }
      }

      // 하원 차량 반영
      const outBus = item.outBusId !== undefined ? item.outBusId : item.assignedDepartureBusId;
      if (outBus !== undefined) {
        const outVehicle = outBus ? await this.vehicleRepository.findOne({ where: { id: Number(outBus), academy: { id: academy.id } } }) : null;
        let outSched = student.schedules?.find(s => s.type === 'ALIGHTING');
        if (outSched) {
          outSched.assignedVehicle = outVehicle as any;
          await scheduleRepo.save(outSched);
        } else if (outVehicle) {
          const newSched = scheduleRepo.create({
            student,
            type: 'ALIGHTING',
            dayOfWeek: 'MON',
            address: student.address || '',
            assignedVehicle: outVehicle,
          });
          await scheduleRepo.save(newSched);
        }
        student.assignedDepartureVehicle = outVehicle || null as any;
        if (outVehicle) {
          rawObj['하원차량'] = outVehicle.busNumber;
        } else {
          delete rawObj['하원차량'];
        }
      }

      if (item.isNotRiding !== undefined) {
        student.isNotRiding = Boolean(item.isNotRiding);
        rawObj['차량미탑승'] = student.isNotRiding;
        rawObj['미탑승'] = student.isNotRiding;
        if (student.isNotRiding) {
          student.assignedVehicle = null as any;
          student.assignedDepartureVehicle = null as any;
        }
      }

      if (item.address !== undefined) {
        student.address = item.address;
        rawObj['도로명주소'] = item.address;
        rawObj['주소'] = item.address;
      }
      if (item.boardingLocation !== undefined) {
        student.boardingLocation = item.boardingLocation;
        rawObj['등원지'] = item.boardingLocation;
        rawObj['탑승지'] = item.boardingLocation;
      }
      if (item.latitude !== undefined) student.latitude = item.latitude;
      if (item.longitude !== undefined) student.longitude = item.longitude;
      if (item.allergies !== undefined) {
        student.allergies = item.allergies;
        rawObj['알레르기'] = item.allergies;
      }
      if (item.note !== undefined || item.teacherMemo !== undefined) {
        student.teacherMemo = item.note || item.teacherMemo;
        rawObj['비고'] = student.teacherMemo;
      }

      student.raw = rawObj;
      await this.studentRepository.save(student);
      updatedCount++;
    }

    this.notifyRouteUpdated(academy.id);
    return { success: true, count: updatedCount };
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

    // Sharp 경량 썸네일 버퍼 생성 (폭 360px, JPEG 78%, 원본 대비 용량 95% 절감)
    let thumbBuffer: Buffer | null = null;
    try {
      const sharp = require('sharp');
      thumbBuffer = await sharp(buffer)
        .rotate()
        .resize({ width: 360, withoutEnlargement: true })
        .jpeg({ quality: 78, progressive: true })
        .toBuffer();
    } catch (sharpErr) {
      console.warn('[uploadMedia] Sharp thumbnail creation failed, fallback to original:', sharpErr);
    }

    // S3 사용 (AWS_S3_BUCKET + AWS_REGION): 파일 키를 돌려주고, 화면 표시용 서명 URL 은 조회할 때마다 새로 만든다.
    if (isS3Enabled()) {
      try {
        const s3Key = `board/${randomName}`;
        await uploadToS3(s3Key, buffer, detectedMime);

        let thumbS3Key: string | null = null;
        if (thumbBuffer) {
          thumbS3Key = `board/thumb_${randomName}`;
          await uploadToS3(thumbS3Key, thumbBuffer, 'image/jpeg');
        }

        return {
          success: true,
          ref: `${S3_REF_PREFIX}${s3Key}`, // DB 에 저장할 값
          url: await signS3Key(s3Key), // 바로 미리보기용 (1시간). 저장하지 말 것
          thumbnailRef: thumbS3Key ? `${S3_REF_PREFIX}${thumbS3Key}` : `${S3_REF_PREFIX}${s3Key}`,
          thumbnailUrl: thumbS3Key ? await signS3Key(thumbS3Key) : await signS3Key(s3Key),
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

    let thumbFileName: string | null = null;
    if (thumbBuffer) {
      thumbFileName = `thumb_${randomName}`;
      fs.writeFileSync(path.join(uploadsDir, thumbFileName), thumbBuffer);
    }

    const host = reqHost || 'takemesafely.com';
    const protocol = (host.includes('localhost') || host.includes('127.0.0.1') || host.includes(':3000')) ? 'http' : 'https';
    const url = `${protocol}://${host}/uploads/board/${randomName}`;
    const thumbnailUrl = thumbFileName ? `${protocol}://${host}/uploads/board/${thumbFileName}` : url;

    return {
      success: true,
      ref: url,
      url,
      thumbnailRef: thumbnailUrl,
      thumbnailUrl,
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
      name: t.name ? formatTeacherName(t.name) : '미등록 교사',
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
      const rawName = item.name ? String(item.name).trim() : '';
      if (!rawName) continue;
      const name = formatTeacherName(rawName);
      const baseName = cleanTeacherBaseName(rawName);
      const assignedClass = item.assignedClass ? String(item.assignedClass).trim() : '';
      const phone = item.phone ? String(item.phone).trim() : null;

      // 동명이인 교사 지원: 성함 및 담당 반명(또는 전화번호)으로 개별 교사 식별
      let teacher = await this.userRepository.findOne({
        where: [
          { name, assignedClass: assignedClass || undefined, academy: { id: academy.id } },
          { name: baseName, assignedClass: assignedClass || undefined, academy: { id: academy.id } }
        ]
      });

      if (teacher) {
        teacher.name = name;
        if (assignedClass && (!teacher.assignedClass || teacher.assignedClass === '미배정')) {
          teacher.assignedClass = assignedClass;
          if (phone && !teacher.phone) teacher.phone = phone;
          await this.userRepository.save(teacher);
        } else {
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
        name: formatTeacherName(teacher.name),
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
      academyName: teacher.academy?.name,
      educationLevel: teacher.academy?.educationLevel || 'KINDERGARTEN'
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
      const sub = submissions.find((s: any) => s.className === className);
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
        teacherName: sub?.teacherName ? formatTeacherName(sub.teacherName) : null,
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

  // ==================== CLOUD DOCUMENTS & LEGAL EXPIRIES ====================
  async getDocuments(academyId?: number, educationLevel?: string) {
    const qb = this.cloudDocumentRepository.createQueryBuilder('doc');
    if (academyId) {
      qb.andWhere('(doc.academyId = :academyId OR doc.academyId IS NULL)', { academyId });
    }
    if (educationLevel && educationLevel !== 'ALL') {
      qb.andWhere('doc.educationLevel = :educationLevel', { educationLevel });
    }
    qb.orderBy('doc.uploadedAt', 'DESC');
    return qb.getMany();
  }

  async uploadDocument(body: {
    academyId?: number;
    educationLevel?: string;
    title?: string;
    category?: string;
    note?: string;
    uploadedBy?: string;
    fileName: string;
    fileType?: string;
    fileBase64: string;
  }, reqHost?: string) {
    const { academyId, educationLevel, title, category, note, uploadedBy, fileName, fileType, fileBase64 } = body;
    if (!fileBase64 || !fileName) {
      throw new BadRequestException('파일 데이터와 파일명이 필요합니다.');
    }

    const base64Clean = fileBase64.replace(/^data:.*?;base64,/, '');
    const buffer = Buffer.from(base64Clean, 'base64');
    const MAX_SIZE = 30 * 1024 * 1024; // 30MB
    if (buffer.length > MAX_SIZE) {
      throw new BadRequestException('파일 크기는 30MB를 초과할 수 없습니다.');
    }

    const ext = fileName.split('.').pop()?.toLowerCase() || 'bin';
    const randomName = `doc_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${ext}`;

    const uploadsDir = path.join(process.cwd(), 'uploads', 'documents');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filePath = path.join(uploadsDir, randomName);
    fs.writeFileSync(filePath, buffer);

    const host = reqHost || 'takemesafely.com';
    const protocol = (host.includes('localhost') || host.includes('127.0.0.1') || host.includes(':3000')) ? 'http' : 'https';
    const fileUrl = `${protocol}://${host}/uploads/documents/${randomName}`;

    const doc = this.cloudDocumentRepository.create({
      academyId: academyId ? Number(academyId) : undefined,
      educationLevel: educationLevel || '유치원',
      title: title || fileName,
      category: category || 'etc',
      fileName,
      fileSize: buffer.length,
      fileType: fileType || 'application/octet-stream',
      fileUrl,
      uploadedBy: uploadedBy || '관리자',
      note: note || '',
    });

    const saved = await this.cloudDocumentRepository.save(doc);
    return saved;
  }

  async deleteDocument(id: string) {
    const doc = await this.cloudDocumentRepository.findOne({ where: { id } });
    if (!doc) {
      throw new NotFoundException('해당 서류를 찾을 수 없습니다.');
    }
    try {
      if (doc.fileUrl && doc.fileUrl.includes('/uploads/documents/')) {
        const fname = doc.fileUrl.split('/uploads/documents/').pop();
        if (fname) {
          const p = path.join(process.cwd(), 'uploads', 'documents', fname);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        }
      }
    } catch (e) {
      // ignore
    }
    await this.cloudDocumentRepository.delete(id);
    return { success: true };
  }

  async getLegalExpiries(academyId?: number, educationLevel?: string) {
    const qb = this.legalExpiryRepository.createQueryBuilder('exp')
      .leftJoinAndSelect('exp.vehicle', 'vehicle');
    if (academyId) {
      qb.andWhere('(exp.academyId = :academyId OR vehicle.academyId = :academyId)', { academyId });
    }
    if (educationLevel && educationLevel !== 'ALL') {
      if (educationLevel === '유치원' || educationLevel === '유치부') {
        qb.andWhere('exp.educationLevel IN (:...edus)', { edus: ['유치원', '유치부'] });
      } else {
        qb.andWhere('exp.educationLevel = :educationLevel', { educationLevel });
      }
    }
    const list = await qb.getMany();
    const result: Record<string, any> = {};
    for (const item of list) {
      result[String(item.vehicleId)] = {
        insuranceExpiry: item.insuranceExpiry || '',
        inspectionExpiry: item.inspectionExpiry || '',
        driverEduExpiry: item.driverEduExpiry || '',
        companionEduExpiry: item.companionEduExpiry || '',
      };
    }
    return result;
  }

  async saveLegalExpiry(vehicleId: number, data: {
    insuranceExpiry?: string;
    inspectionExpiry?: string;
    driverEduExpiry?: string;
    companionEduExpiry?: string;
    academyId?: number;
    educationLevel?: string;
  }) {
    let rec = await this.legalExpiryRepository.findOne({ where: { vehicleId } });
    if (!rec) {
      rec = this.legalExpiryRepository.create({
        vehicleId,
        academyId: data.academyId,
        educationLevel: data.educationLevel || '유치원',
      });
    }
    if (data.insuranceExpiry !== undefined) rec.insuranceExpiry = data.insuranceExpiry;
    if (data.inspectionExpiry !== undefined) rec.inspectionExpiry = data.inspectionExpiry;
    if (data.driverEduExpiry !== undefined) rec.driverEduExpiry = data.driverEduExpiry;
    if (data.companionEduExpiry !== undefined) rec.companionEduExpiry = data.companionEduExpiry;
    if (data.educationLevel) rec.educationLevel = data.educationLevel;
    if (data.academyId) rec.academyId = data.academyId;

    await this.legalExpiryRepository.save(rec);
    return { success: true, record: rec };
  }

  async resetAllAbsentStudents() {
    const res = await this.studentRepository.update(
      { boardStatus: 'ABSENT' },
      { boardStatus: 'WAITING' },
    );
    return {
      success: true,
      message: `${res.affected || 0}명의 결석 처리 원아를 탑승 대기(WAITING) 상태로 복구했습니다.`,
      affected: res.affected || 0,
    };
  }

  // --- 법정서류 및 안전교육 만료 자동 알림 스케줄러 & 즉시 발송 ---
  onModuleInit() {
    // 서버 기동 10초 후 첫 스케줄 체크 1회 시도
    setTimeout(() => {
      this.checkLegalExpirySchedule().catch((err) => {
        console.error('[LegalExpiryScheduler] 초기 체크 에러:', err);
      });
    }, 10000);

    // 15분 주기로 KST 기준 평일 오전 9:30 자동 검사
    setInterval(() => {
      this.checkLegalExpirySchedule().catch((err) => {
        console.error('[LegalExpiryScheduler] 정기 스케줄 에러:', err);
      });
    }, 15 * 60 * 1000);
  }

  private async checkLegalExpirySchedule() {
    const now = new Date();
    // KST = UTC + 9시간
    const kstOffset = 9 * 60;
    const kst = new Date(now.getTime() + (kstOffset + now.getTimezoneOffset()) * 60000);
    const dayOfWeek = kst.getDay(); // 0: 일, 1: 월, ..., 5: 금, 6: 토
    const hours = kst.getHours();
    const minutes = kst.getMinutes();
    const todayStr = kst.toISOString().split('T')[0];

    // 평일(월~금) 오전 09:30 이후 당일 1회 자동 실행
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isMorningTime = hours > 9 || (hours === 9 && minutes >= 30);

    if (isWeekday && isMorningTime && this.lastScheduledExpiryCheckDate !== todayStr) {
      console.log(`[LegalExpiryScheduler] ${todayStr} KST 평일 오전 9:30 법정 서류/안전교육 만료 검사 실행`);
      this.lastScheduledExpiryCheckDate = todayStr;
      await this.notifyLegalExpiries({ force: false });
    }
  }

  async notifyLegalExpiries(params: {
    vehicleId?: number;
    academyId?: number;
    notifications?: any[];
    force?: boolean;
  }) {
    const now = new Date();
    const kstOffset = 9 * 60;
    const kst = new Date(now.getTime() + (kstOffset + now.getTimezoneOffset()) * 60000);
    const todayStr = kst.toISOString().split('T')[0];
    const isMonday = kst.getDay() === 1;
    const force = !!params.force;

    let sentCount = 0;
    const logs: string[] = [];

    // 1. 웹 관리자 페이지에서 생성한 알림 목록이 명시적으로 전달된 경우
    if (Array.isArray(params.notifications) && params.notifications.length > 0) {
      for (const noti of params.notifications) {
        const vehicleId = Number(noti.busId);
        if (!vehicleId) continue;

        const vehicle = await this.vehicleRepository.findOne({
          where: { id: vehicleId },
          relations: { driverUser: true, teacherUser: true, academy: true },
        });
        if (!vehicle) continue;

        const targetRole = noti.targetRole; // 'driver' | 'teacher'
        let targetUser = targetRole === 'driver' ? vehicle.driverUser : vehicle.teacherUser;
        const fallbackRoleLabel = targetRole === 'driver' ? '운전기사' : '동승교사';

        // 기사/교사 미배정인 경우 -> 해당 학원/유치원 관리자에게 대체 전송하여 사각지대 방지
        if (!targetUser) {
          if (vehicle.academy?.id) {
            const adminUsers = await this.userRepository.find({
              where: {
                academy: { id: vehicle.academy.id },
                role: In([UserRole.ACADEMY_ADMIN, UserRole.ADMIN]),
              },
            });
            for (const admin of adminUsers) {
              const cdKey = `admin_${todayStr}_${vehicle.id}_${noti.itemKey}_${admin.id}`;
              if (!force && this.legalExpiryNotifiedCooldown.has(cdKey)) continue;

              const title = `[미배정 차량 주의] ${vehicle.busNumber || '차량'} ${noti.itemLabel} 만료 임박`;
              const body = `${vehicle.busNumber || '차량'}(${vehicle.plateNumber || '미등록'})에 ${fallbackRoleLabel}가 미배정 상태입니다. ${noti.itemLabel} 만료일(${noti.expiryDate})이 ${noti.daysRemaining < 0 ? '만료되었습니다' : `D-${noti.daysRemaining}일 남았습니다`}. 서류 갱신 및 배정을 확인해주세요.`;

              if (this.pushHandler) {
                await this.pushHandler(
                  [admin.id],
                  title,
                  body,
                  { type: 'safety_expiry', vehicleId: vehicle.id, itemKey: noti.itemKey, expiryDate: noti.expiryDate },
                  'notice',
                ).catch((err) => console.error('Push error (admin):', err));
              }

              const notiRecord = this.notificationRepository.create({
                recipient: admin,
                recipientRole: admin.role,
                type: 'VEHICLE_ALERT',
                vehicle,
                academy: vehicle.academy,
                message: `${title} - ${body}`,
              });
              await this.notificationRepository.save(notiRecord).catch(() => {});

              this.legalExpiryNotifiedCooldown.set(cdKey, new Date().toISOString());
              sentCount++;
              logs.push(`원장/관리자 대체 발송: ${vehicle.busNumber}호 ${noti.itemLabel} -> ${admin.name || admin.email}`);
            }
          }
          continue;
        }

        // 대상 기사 또는 교사가 배정된 경우
        const cdKey = `${todayStr}_${vehicle.id}_${noti.itemKey}_${targetUser.id}`;
        if (!force && this.legalExpiryNotifiedCooldown.has(cdKey)) {
          continue; // 오늘 이미 발송 완료
        }

        const title = `${noti.titlePrefix || '[만료 임박]'} ${vehicle.busNumber || ''}호 ${noti.itemLabel}`;
        const body = noti.message || `${vehicle.busNumber || ''}호 ${noti.itemLabel} 만료일이 도래했습니다. 확인 바랍니다.`;

        if (this.pushHandler) {
          await this.pushHandler(
            [targetUser.id],
            title,
            body,
            { type: 'safety_expiry', vehicleId: vehicle.id, itemKey: noti.itemKey, expiryDate: noti.expiryDate },
            'notice',
          ).catch((err) => console.error('Push error (staff):', err));
        }

        const notiRecord = this.notificationRepository.create({
          recipient: targetUser,
          recipientRole: targetUser.role,
          type: 'VEHICLE_ALERT',
          vehicle,
          academy: vehicle.academy,
          message: `${title} - ${body}`,
        });
        await this.notificationRepository.save(notiRecord).catch(() => {});

        this.legalExpiryNotifiedCooldown.set(cdKey, new Date().toISOString());
        sentCount++;
        logs.push(`${targetRole === 'driver' ? '기사' : '교사'} 발송: ${vehicle.busNumber}호 ${noti.itemLabel} -> ${targetUser.name || targetUser.email}`);
      }

      return {
        success: true,
        sentCount,
        message: `${sentCount}건의 법정 서류/안전 교육 푸시 알림이 발송되었습니다.`,
        logs,
      };
    }

    // 2. 스케줄러 자동 검사 또는 DB 기반 직접 계산 검사
    const qb = this.legalExpiryRepository.createQueryBuilder('exp')
      .leftJoinAndSelect('exp.vehicle', 'vehicle')
      .leftJoinAndSelect('vehicle.driverUser', 'driverUser')
      .leftJoinAndSelect('vehicle.teacherUser', 'teacherUser')
      .leftJoinAndSelect('vehicle.academy', 'academy');

    if (params.vehicleId) {
      qb.andWhere('exp.vehicleId = :vId', { vId: params.vehicleId });
    }
    if (params.academyId) {
      qb.andWhere('(exp.academyId = :acId OR vehicle.academyId = :acId)', { acId: params.academyId });
    }

    const expList = await qb.getMany();

    const itemsConfig = [
      { key: 'insuranceExpiry', label: '종합보험', roles: ['driver', 'teacher'] },
      { key: 'inspectionExpiry', label: '정기안전검사', roles: ['driver', 'teacher'] },
      { key: 'driverEduExpiry', label: '운전자 안전교육', roles: ['driver'] },
      { key: 'companionEduExpiry', label: '동승자 안전교육', roles: ['teacher'] },
    ];

    for (const exp of expList) {
      const vehicle = exp.vehicle;
      if (!vehicle) continue;

      for (const item of itemsConfig) {
        const dateStr = (exp as any)[item.key];
        if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

        const targetDate = new Date(`${dateStr}T00:00:00+09:00`);
        const todayDate = new Date(`${todayStr}T00:00:00+09:00`);
        const days = Math.ceil((targetDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

        let shouldNotify = false;
        let urgency = 'info';
        let titlePrefix = '';

        if (days < 0) {
          // 만료 경과 (매일 알림)
          shouldNotify = true;
          urgency = 'expired';
          titlePrefix = `[법정서류 만료 (+${Math.abs(days)}일)]`;
        } else if (days <= 14) {
          // 2주 이내: 매일 알림
          shouldNotify = true;
          urgency = days === 0 ? 'dday' : 'urgent';
          titlePrefix = days === 0 ? '[법정서류 D-Day 오늘 만료]' : `[긴급 매일알림 D-${days}]`;
        } else if (days <= 30) {
          // 1개월 이내: 주 1회(월요일) 발송 (강제 발송 시 즉시 발송)
          shouldNotify = isMonday || force;
          urgency = 'warning';
          titlePrefix = `[만료임박 주간알림 D-${days}]`;
        } else if (days <= 60) {
          // 2개월 이내: 주 1회(월요일) 발송 (강제 발송 시 즉시 발송)
          shouldNotify = isMonday || force;
          urgency = 'notice';
          titlePrefix = `[주의 주간알림 D-${days}]`;
        }

        if (!shouldNotify) continue;

        const message = `${titlePrefix} ${vehicle.busNumber || '차량'}(${vehicle.plateNumber || '미등록'}) ${item.label} 만료일(${dateStr})이 ${days < 0 ? `지났습니다(+${Math.abs(days)}일)` : days === 0 ? '오늘입니다' : `${days}일 남았습니다`}. 서류 갱신 및 이수를 확인해주세요.`;

        // 대상 역할별 발송
        for (const role of item.roles) {
          const targetUser = role === 'driver' ? vehicle.driverUser : vehicle.teacherUser;
          const fallbackRoleLabel = role === 'driver' ? '운전기사' : '동승교사';

          if (!targetUser) {
            // 미배정 시 원장/관리자 대체 발송
            if (vehicle.academy?.id) {
              const adminUsers = await this.userRepository.find({
                where: {
                  academy: { id: vehicle.academy.id },
                  role: In([UserRole.ACADEMY_ADMIN, UserRole.ADMIN]),
                },
              });
              for (const admin of adminUsers) {
                const cdKey = `admin_${todayStr}_${vehicle.id}_${item.key}_${admin.id}`;
                if (!force && this.legalExpiryNotifiedCooldown.has(cdKey)) continue;

                const title = `[미배정 차량 주의] ${vehicle.busNumber || '차량'} ${item.label} 만료 임박`;
                const adminBody = `${vehicle.busNumber || '차량'}(${vehicle.plateNumber || '미등록'})에 ${fallbackRoleLabel}가 미배정 상태입니다. ${item.label} 만료일(${dateStr})이 ${days < 0 ? '만료되었습니다' : `D-${days}일 남았습니다`}. 갱신 및 배정을 확인해주세요.`;

                if (this.pushHandler) {
                  await this.pushHandler(
                    [admin.id],
                    title,
                    adminBody,
                    { type: 'safety_expiry', vehicleId: vehicle.id, itemKey: item.key, expiryDate: dateStr },
                    'notice',
                  ).catch(() => {});
                }

                const notiRecord = this.notificationRepository.create({
                  recipient: admin,
                  recipientRole: admin.role,
                  type: 'VEHICLE_ALERT',
                  vehicle,
                  academy: vehicle.academy,
                  message: `${title} - ${adminBody}`,
                });
                await this.notificationRepository.save(notiRecord).catch(() => {});

                this.legalExpiryNotifiedCooldown.set(cdKey, new Date().toISOString());
                sentCount++;
              }
            }
          } else {
            // 기사/교사 발송
            const cdKey = `${todayStr}_${vehicle.id}_${item.key}_${targetUser.id}`;
            if (!force && this.legalExpiryNotifiedCooldown.has(cdKey)) continue;

            const title = `${titlePrefix} ${vehicle.busNumber || '차량'} ${item.label}`;

            if (this.pushHandler) {
              await this.pushHandler(
                [targetUser.id],
                title,
                message,
                { type: 'safety_expiry', vehicleId: vehicle.id, itemKey: item.key, expiryDate: dateStr },
                'notice',
              ).catch(() => {});
            }

            const notiRecord = this.notificationRepository.create({
              recipient: targetUser,
              recipientRole: targetUser.role,
              type: 'VEHICLE_ALERT',
              vehicle,
              academy: vehicle.academy,
              message: `${title} - ${message}`,
            });
            await this.notificationRepository.save(notiRecord).catch(() => {});

            this.legalExpiryNotifiedCooldown.set(cdKey, new Date().toISOString());
            sentCount++;
          }
        }
      }
    }

    return {
      success: true,
      sentCount,
      message: `${sentCount}건의 법정 서류/안전 교육 푸시 알림이 발송되었습니다.`,
    };
  }
}
