import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { TeacherService } from './teacher.service';
import { Student } from '../entities/student.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Notification } from '../entities/notification.entity';
import { User, UserRole } from '../entities/user.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { OperationLog } from '../entities/operation-log.entity';
import { ScheduleOverride } from '../entities/schedule-override.entity';
import { AcademyHoliday } from '../entities/academy-holiday.entity';
import { LocationGateway } from './location.gateway';
import { PickupPoint } from '../entities/pickup-point.entity';

describe('TeacherService - Escort Teacher (동승 교사) Features', () => {
  let service: TeacherService;

  const mockUser: User = {
    id: 10,
    email: 'shuttle_teacher@test.com',
    name: '김인솔',
    role: UserRole.SHUTTLE_TEACHER,
    passwordHash: 'hashed',
    phone: '010-1234-5678',
    assignedClass: '',
    academy: { id: 1, name: '테스트유치원' } as any,
  } as User;

  const mockVehicle: Vehicle = {
    id: 5,
    busNumber: '1호차',
    plateNumber: '77가 1234',
    driverName: '이기사',
    teacherName: '김인솔',
    teacherUser: mockUser,
    academy: { id: 1, name: '테스트유치원', owner: { id: 1 } } as any,
  } as Vehicle;

  const mockStudent1: Student = {
    id: 101,
    name: '원아일',
    adminDisplayName: '원아일',
    address: '서울특별시 강서구 123',
    boardingLocation: '101동 정문 앞',
    boardStatus: 'BOARDED',
    assignedVehicle: mockVehicle,
    parentUser: { id: 50, email: 'parent1@test.com', name: '학부모일', phone: '010-9999-1111' } as any,
  } as Student;

  const mockStudent2: Student = {
    id: 102,
    name: '원아이',
    adminDisplayName: '원아이',
    address: '서울특별시 강서구 456',
    boardingLocation: '102동 후문 앞',
    boardStatus: 'WAITING',
    assignedVehicle: mockVehicle,
    parentUser: { id: 51, email: 'parent2@test.com', name: '학부모이', phone: '010-9999-2222' } as any,
  } as Student;

  let studentRepo: any;
  let vehicleRepo: any;
  let userRepo: any;
  let operationLogRepo: any;
  let notificationRepo: any;
  let messageRepo: any;
  let locationGateway: any;

  beforeEach(async () => {
    studentRepo = {
      find: jest.fn().mockResolvedValue([mockStudent1, mockStudent2]),
      findOne: jest.fn().mockImplementation(({ where }) => {
        if (where.id === 101) return Promise.resolve({ ...mockStudent1 });
        if (where.id === 102) return Promise.resolve({ ...mockStudent2 });
        return Promise.resolve(null);
      }),
      save: jest.fn().mockImplementation(st => Promise.resolve(st)),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      }),
    };

    vehicleRepo = {
      findOne: jest.fn().mockResolvedValue(mockVehicle),
      find: jest.fn().mockResolvedValue([mockVehicle]),
      save: jest.fn().mockImplementation(v => Promise.resolve(v)),
    };

    userRepo = {
      findOne: jest.fn().mockResolvedValue(mockUser),
    };

    operationLogRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 1,
        vehicle: mockVehicle,
        dateString: '2026-11-02',
        boardingRecords: [],
      }),
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockImplementation(dto => Promise.resolve(dto)),
      find: jest.fn().mockResolvedValue([]),
    };

    notificationRepo = {
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockImplementation(dto => Promise.resolve(dto)),
    };

    messageRepo = {
      create: jest.fn().mockImplementation(dto => dto),
      save: jest.fn().mockImplementation(dto => Promise.resolve(dto)),
      find: jest.fn().mockResolvedValue([]),
    };

    locationGateway = {
      broadcastDepartSignal: jest.fn(),
      broadcastStudentStatusUpdated: jest.fn(),
      broadcastOperationStatus: jest.fn(),
      broadcastRouteUpdated: jest.fn(),
      broadcastTeacherPush: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeacherService,
        { provide: getRepositoryToken(Student), useValue: studentRepo },
        { provide: getRepositoryToken(StudentSchedule), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(Vehicle), useValue: vehicleRepo },
        { provide: getRepositoryToken(Notification), useValue: notificationRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(ParentMessage), useValue: messageRepo },
        { provide: getRepositoryToken(OperationLog), useValue: operationLogRepo },
        { provide: getRepositoryToken(ScheduleOverride), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: getRepositoryToken(AcademyHoliday), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: getRepositoryToken(PickupPoint), useValue: { find: jest.fn().mockResolvedValue([]) } },
        { provide: LocationGateway, useValue: locationGateway },
      ],
    }).compile();

    service = module.get<TeacherService>(TeacherService);
  });

  describe('1. 하차 및 보호자 인계 (Drop-off & Handover)', () => {
    it('하차 및 보호자 인계 완료 시 상태가 DROPPED_OFF로 변경되고 일지/알림/소켓이 발송된다', async () => {
      const res = await service.dropoffStudent(mockUser.email, 101);

      expect(res.success).toBe(true);
      expect(res.boardStatus).toBe('DROPPED_OFF');
      expect(studentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 101, boardStatus: 'DROPPED_OFF' }),
      );
      expect(operationLogRepo.save).toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalled();
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRoles: ['PARENT'],
          message: expect.stringContaining('안전하게 하차하여 보호자님께 인계되었습니다'),
        }),
      );
      expect(locationGateway.broadcastStudentStatusUpdated).toHaveBeenCalledWith(
        mockVehicle.id,
        expect.objectContaining({ studentId: 101, boardStatus: 'DROPPED_OFF' }),
      );
    });

    it('보호자 미인계 시 상태가 HANDOVER_FAILED로 변경되고 재탑승 알림이 기록된다', async () => {
      const res = await service.handoverFailed(mockUser.email, 101, '보호자 연락 두절');

      expect(res.success).toBe(true);
      expect(res.boardStatus).toBe('HANDOVER_FAILED');
      expect(studentRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 101, boardStatus: 'HANDOVER_FAILED' }),
      );
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('보호자 미인계'),
        }),
      );
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          targetRoles: ['PARENT'],
          message: expect.stringContaining('차량에 재탑승'),
        }),
      );
      expect(locationGateway.broadcastStudentStatusUpdated).toHaveBeenCalledWith(
        mockVehicle.id,
        expect.objectContaining({ studentId: 101, boardStatus: 'HANDOVER_FAILED' }),
      );
    });
  });

  describe('2. 정류장 인원 확인 후 기사에게 출발 신호', () => {
    it('readyToDepart 호출 시 해당 차량 방에만 출발 신호를 브로드캐스트한다', async () => {
      const res = await service.readyToDepart(mockUser.email, '101동 정문 앞');

      expect(res.success).toBe(true);
      expect(locationGateway.broadcastDepartSignal).toHaveBeenCalledWith(mockVehicle.id, '101동 정문 앞');
      expect(operationLogRepo.save).toHaveBeenCalled();
    });
  });

  describe('3. 동승 시작 및 종료 (잔류 아동 검사 + 맨 뒷좌석 확인)', () => {
    it('startEscort 호출 시 동승교사 이름과 시각이 운행 일지에 기록된다', async () => {
      const res = await service.startEscort(mockUser.email);

      expect(res.success).toBe(true);
      expect(res.teacherName).toBe('김인솔');
      expect(operationLogRepo.save).toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('동승 교사(김인솔) 탑승 및 동승 시작'),
        }),
      );
    });

    it('맨 뒷좌석 확인 체크를 하지 않으면 동승 종료가 거부된다', async () => {
      await expect(service.endEscort(mockUser.email, false)).rejects.toThrow(BadRequestException);
    });

    it('차량에 아직 하차하지 않은 원아(BOARDED)가 남아있으면 동승 종료가 거부되고 경고가 발생한다', async () => {
      studentRepo.find.mockResolvedValueOnce([mockStudent1]); // mockStudent1 has status 'BOARDED'

      await expect(service.endEscort(mockUser.email, true)).rejects.toThrow(
        /아직 하차하지 않은 원아가 1명 남아있습니다/,
      );
    });

    it('모든 원아가 하차(또는 결석) 완료되고 맨 뒷좌석 확인 체크가 되면 정상 종료된다', async () => {
      studentRepo.find.mockResolvedValueOnce([
        { ...mockStudent1, boardStatus: 'DROPPED_OFF' },
        { ...mockStudent2, boardStatus: 'ABSENT' },
      ]);

      const res = await service.endEscort(mockUser.email, true, '이상 없음');
      expect(res.success).toBe(true);
      expect(operationLogRepo.save).toHaveBeenCalled();
      expect(notificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('차량 내부 잔류 아동 확인 완료'),
        }),
      );
    });
  });

  describe('4. 원아 목록 조회 시 학부모 연락처 및 상태값 제공', () => {
    it('getStudents 조회 시 parentPhone, className, boardStatus가 올바르게 반환된다', async () => {
      const list = await service.getStudents(mockUser.email);

      expect(list.length).toBe(2);
      expect(list[0].id).toBe(101);
      expect(list[0].boarded).toBe(true);
      expect(list[0].boardStatus).toBe('BOARDED');
      expect(list[0].parentPhone).toBe('010-9999-1111');
      expect(list[0].parentName).toBe('학부모일');
    });
  });
});
