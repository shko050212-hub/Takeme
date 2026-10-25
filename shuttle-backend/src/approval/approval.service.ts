import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalRequest, ApprovalDirection, ApprovalStatus } from '../entities/approval-request.entity';
import { Student } from '../entities/student.entity';
import { ScheduleOverride, OverrideType } from '../entities/schedule-override.entity';
import { PickupPoint } from '../entities/pickup-point.entity';

@Injectable()
export class ApprovalService {
  constructor(
    @InjectRepository(ApprovalRequest)
    private approvalRepo: Repository<ApprovalRequest>,
    @InjectRepository(Student)
    private studentRepo: Repository<Student>,
    @InjectRepository(ScheduleOverride)
    private overrideRepo: Repository<ScheduleOverride>,
    @InjectRepository(PickupPoint)
    private pickupPointRepo: Repository<PickupPoint>
  ) {}

  async createRequest(data: any) {
    const student = await this.studentRepo.findOne({ where: { id: data.studentId } });
    if (!student) throw new NotFoundException('Student not found');

    const req = this.approvalRepo.create({
      student,
      latitude: data.latitude,
      longitude: data.longitude,
      address: data.address,
      zipCode: data.zipCode,
      time: data.time,
      message: data.message,
      startDate: data.startDate,
      endDate: data.endDate,
      direction: data.direction,
    });
    return this.approvalRepo.save(req);
  }

  async getPendingRequests(email: string, role: string) {
    const query = this.approvalRepo.createQueryBuilder('req')
      .leftJoinAndSelect('req.student', 'student')
      .leftJoinAndSelect('student.parentUser', 'parentUser')
      .where('req.status = :status', { status: ApprovalStatus.PENDING });
      
    if (role === 'PARENT') {
      query.andWhere('req.direction = :dir', { dir: ApprovalDirection.TEACHER_TO_PARENT })
           .andWhere('parentUser.email = :email', { email });
    } else {
      query.andWhere('req.direction = :dir', { dir: ApprovalDirection.PARENT_TO_TEACHER });
    }
    
    return query.orderBy('req.createdAt', 'DESC').getMany();
  }

  async decideRequest(id: number, decision: ApprovalStatus) {
    const req = await this.approvalRepo.findOne({ where: { id }, relations: { student: true } });
    if (!req) throw new NotFoundException('Request not found');

    req.status = decision;
    await this.approvalRepo.save(req);

    if (decision === ApprovalStatus.APPROVED) {
      if (req.startDate && req.endDate) {
        // Temporary override
        const override = this.overrideRepo.create({
          student: req.student,
          startDate: req.startDate,
          endDate: req.endDate,
          overrideType: OverrideType.CHANGE_LOCATION,
          reason: req.message,
          newAddress: req.address,
          latitude: req.latitude,
          longitude: req.longitude
        });
        await this.overrideRepo.save(override);
      } else {
        // Permanent change
        req.student.boardingLocation = req.address;
        req.student.address = req.address;
        req.student.latitude = req.latitude;
        req.student.longitude = req.longitude;
        await this.studentRepo.save(req.student);
      }
      
      // Auto register pickup point if not exist
      const existingPt = await this.pickupPointRepo.findOne({ where: { name: req.address } });
      if (!existingPt) {
        const pt = this.pickupPointRepo.create({
          name: req.address,
          latitude: req.latitude,
          longitude: req.longitude
        });
        await this.pickupPointRepo.save(pt);
      }
    }
    return req;
  }
}
