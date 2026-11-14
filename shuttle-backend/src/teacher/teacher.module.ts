import { Module, forwardRef } from '@nestjs/common';
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
import { PickupPoint } from '../entities/pickup-point.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { ChatRoom } from '../entities/chat-room.entity';
import { ChatRoomMember } from '../entities/chat-room-member.entity';
import { Attendance } from '../entities/attendance.entity';
import { AttendanceSubmission } from '../entities/attendance-submission.entity';
import { RoutingModule } from '../routing/routing.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Student,
      StudentSchedule,
      Vehicle,
      Notification,
      User,
      ParentMessage,
      OperationLog,
      ScheduleOverride,
      AcademyHoliday,
      PickupPoint,
      ChatMessage,
      ChatRoom,
      ChatRoomMember,
      Attendance,
      AttendanceSubmission,
    ]),
    RoutingModule,
    forwardRef(() => ChatModule),
  ],
  controllers: [TeacherController],
  providers: [TeacherService, LocationGateway],
  exports: [TeacherService, LocationGateway],
})
export class TeacherModule {}
