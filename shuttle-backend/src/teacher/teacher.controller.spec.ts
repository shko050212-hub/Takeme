import { Test, TestingModule } from '@nestjs/testing';
import { TeacherController } from './teacher.controller';
import { TeacherService } from './teacher.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Reflector } from '@nestjs/core';

describe('TeacherController', () => {
  let controller: TeacherController;
  let service: any;

  beforeEach(async () => {
    service = {
      getStudents: jest.fn().mockResolvedValue([]),
      getMyVehicle: jest.fn().mockResolvedValue({ id: 1, busNumber: '1호차' }),
      getRoute: jest.fn().mockResolvedValue({ stops: [], routePoints: [] }),
      dropoffStudent: jest.fn().mockResolvedValue({ success: true, boardStatus: 'DROPPED_OFF' }),
      handoverFailed: jest.fn().mockResolvedValue({ success: true, boardStatus: 'HANDOVER_FAILED' }),
      readyToDepart: jest.fn().mockResolvedValue({ success: true, message: '출발 신호 전송' }),
      startEscort: jest.fn().mockResolvedValue({ success: true, teacherName: '김선생' }),
      endEscort: jest.fn().mockResolvedValue({ success: true, message: '동승 종료' }),
      triggerEmergency: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeacherController],
      providers: [
        { provide: TeacherService, useValue: service },
        { provide: Reflector, useValue: new Reflector() },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TeacherController>(TeacherController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('dropoffStudent calls service', async () => {
    const res = await controller.dropoffStudent('test@test.com', { studentId: 101 });
    expect(res.success).toBe(true);
    expect(service.dropoffStudent).toHaveBeenCalledWith('test@test.com', 101);
  });

  it('handoverFailed calls service', async () => {
    const res = await controller.handoverFailed('test@test.com', { studentId: 101, reason: '보호자 부재' });
    expect(res.success).toBe(true);
    expect(service.handoverFailed).toHaveBeenCalledWith('test@test.com', 101, '보호자 부재');
  });

  it('readyToDepart calls service', async () => {
    const res = await controller.readyToDepart('test@test.com', { stopName: '정문 앞' });
    expect(res.success).toBe(true);
    expect(service.readyToDepart).toHaveBeenCalledWith('test@test.com', '정문 앞');
  });

  it('startEscort and endEscort call service', async () => {
    await controller.startEscort('test@test.com');
    expect(service.startEscort).toHaveBeenCalledWith('test@test.com');

    await controller.endEscort('test@test.com', { checkedBackSeats: true });
    expect(service.endEscort).toHaveBeenCalledWith('test@test.com', true, undefined);
  });
});
