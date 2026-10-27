import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { RoutingModule } from './routing/routing.module';
import { User } from './entities/user.entity';
import { Academy } from './entities/academy.entity';
import { Vehicle } from './entities/vehicle.entity';
import { Student } from './entities/student.entity';
import { ScheduleOverride } from './entities/schedule-override.entity';
import { Notification } from './entities/notification.entity';
import { OperationLog } from './entities/operation-log.entity';
import { ParentMessage } from './entities/parent-message.entity';
import { StudentSchedule } from './entities/student-schedule.entity';
import { AcademyHoliday } from './entities/academy-holiday.entity';
import { PickupPoint } from './entities/pickup-point.entity';
import { ChatRoom } from './entities/chat-room.entity';
import { ChatRoomMember } from './entities/chat-room-member.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { BoardPost } from './entities/board-post.entity';
import { BoardComment } from './entities/board-comment.entity';
import { AuditLog } from './entities/audit-log.entity';
import { ParentModule } from './parent/parent.module';
import { TeacherModule } from './teacher/teacher.module';
import { ChatModule } from './chat/chat.module';
import { ApprovalRequest } from './entities/approval-request.entity';
import { ApprovalModule } from './approval/approval.module';
import { DirectionsModule } from './directions/directions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'database-1.cl0cmogqigis.ap-southeast-2.rds.amazonaws.com'),
        port: parseInt(config.get<string>('DB_PORT', '5432'), 10),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', ''),
        database: config.get<string>('DB_NAME', 'postgres'),
        entities: [
          User,
          Academy,
          Vehicle,
          Student,
          StudentSchedule,
          ScheduleOverride,
          Notification,
          OperationLog,
          ParentMessage,
          AcademyHoliday,
          PickupPoint,
          ChatRoom,
          ChatRoomMember,
          ChatMessage,
          ApprovalRequest,
          BoardPost,
          BoardComment,
          AuditLog,
        ],
        synchronize: true,
        ssl: config.get<string>('DB_SSL') === 'true' ? { rejectUnauthorized: false } : false,
      }),
    }),
    AuthModule,
    RoutingModule,
    ParentModule,
    TeacherModule,
    ChatModule,
    ApprovalModule,
    DirectionsModule,
  ],
})
export class AppModule {}
