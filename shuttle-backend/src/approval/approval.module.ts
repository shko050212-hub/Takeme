import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { ApprovalRequest } from '../entities/approval-request.entity';
import { Student } from '../entities/student.entity';
import { ScheduleOverride } from '../entities/schedule-override.entity';
import { PickupPoint } from '../entities/pickup-point.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalRequest, Student, ScheduleOverride, PickupPoint])],
  controllers: [ApprovalController],
  providers: [ApprovalService],
})
export class ApprovalModule {}
