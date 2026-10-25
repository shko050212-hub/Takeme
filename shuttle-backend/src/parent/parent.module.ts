import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParentController } from './parent.controller';
import { ParentService } from './parent.service';
import { ScheduleOverride } from '../entities/schedule-override.entity';
import { Notification } from '../entities/notification.entity';
import { Student } from '../entities/student.entity';
import { User } from '../entities/user.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { StudentSchedule } from '../entities/student-schedule.entity';
import { RoutingModule } from '../routing/routing.module';
import { PickupPoint } from '../entities/pickup-point.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ScheduleOverride, Notification, Student, StudentSchedule, User, Vehicle, ParentMessage, PickupPoint]), RoutingModule],
  controllers: [ParentController],
  providers: [ParentService],
})
export class ParentModule {}
