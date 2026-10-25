import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TeacherService } from './teacher.service';
import { TeacherController } from './teacher.controller';
import { LocationGateway } from './location.gateway';
import { Student } from '../entities/student.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Notification } from '../entities/notification.entity';
import { User } from '../entities/user.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { OperationLog } from '../entities/operation-log.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { ScheduleOverride } from '../entities/schedule-override.entity';
import { AcademyHoliday } from '../entities/academy-holiday.entity';
import { RoutingModule } from '../routing/routing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Student, StudentSchedule, Vehicle, Notification, User, ParentMessage, OperationLog, ScheduleOverride, AcademyHoliday]),
    RoutingModule
  ],
  controllers: [TeacherController],
  providers: [TeacherService, LocationGateway]
})
export class TeacherModule {}
