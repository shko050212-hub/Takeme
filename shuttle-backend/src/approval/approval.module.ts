import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { ApprovalRequest } from '../entities/approval-request.entity';
import { Student } from '../entities/student.entity';
import { ScheduleOverride } from '../entities/schedule-override.entity';
import { PickupPoint } from '../entities/pickup-point.entity';
import { User } from '../entities/user.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Academy } from '../entities/academy.entity';
import { Notification } from '../entities/notification.entity';
import { AcademyHoliday } from '../entities/academy-holiday.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { TeacherModule } from '../teacher/teacher.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRequest,
      Student,
      ScheduleOverride,
      PickupPoint,
      User,
      Vehicle,
      Academy,
      Notification,
      AcademyHoliday,
      StudentSchedule,
    ]),
    forwardRef(() => TeacherModule),
    forwardRef(() => ChatModule),
  ],
  controllers: [ApprovalController],
  providers: [ApprovalService],
  exports: [ApprovalService, TypeOrmModule],
})
export class ApprovalModule {}
