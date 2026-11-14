/**
 * 개발용 로컬 DB 전용: board_posts 테이블의 authorRole을
 * 작성자 계정(authorUserId)의 실제 현재 역할(user.role)로 정정하는 마이그레이션 스크립트
 *
 * [주의] 운영 DB에서는 실행하지 마십시오.
 *
 * 실행 방법 (shuttle-backend 디렉터리에서):
 * $ npx ts-node -r dotenv/config scripts/migrate_board_author_role.ts dotenv_config_path=.env.development
 */
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { BoardPost } from '../src/entities/board-post.entity';
import { BoardComment } from '../src/entities/board-comment.entity';
import { User } from '../src/entities/user.entity';
import { Academy } from '../src/entities/academy.entity';
import { Vehicle } from '../src/entities/vehicle.entity';
import { Student } from '../src/entities/student.entity';
import { StudentSchedule } from '../src/entities/student-schedule.entity';
import { ScheduleOverride } from '../src/entities/schedule-override.entity';
import { Notification } from '../src/entities/notification.entity';
import { OperationLog } from '../src/entities/operation-log.entity';
import { ParentMessage } from '../src/entities/parent-message.entity';
import { AcademyHoliday } from '../src/entities/academy-holiday.entity';
import { PickupPoint } from '../src/entities/pickup-point.entity';
import { ChatRoom } from '../src/entities/chat-room.entity';
import { ChatRoomMember } from '../src/entities/chat-room-member.entity';
import { ChatMessage } from '../src/entities/chat-message.entity';
import { ApprovalRequest } from '../src/entities/approval-request.entity';
import { AuditLog } from '../src/entities/audit-log.entity';
import { Attendance } from '../src/entities/attendance.entity';
import { AttendanceSubmission } from '../src/entities/attendance-submission.entity';

dotenv.config({ path: path.resolve(__dirname, '../.env.development') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function run() {
  const host = process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const username = process.env.DB_USERNAME || 'postgres';
  const password = process.env.DB_PASSWORD || 'postgres';
  const database = process.env.DB_NAME || 'takeme_dev';

  console.log(`[마이그레이션] 대상 DB 연결 시도: ${host}:${port}/${database}`);

  const dataSource = new DataSource({
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    entities: [
      BoardPost,
      BoardComment,
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
      AuditLog,
      Attendance,
      AttendanceSubmission,
    ],
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    console.log('[마이그레이션] DB 연결 성공.');

    const postRepo = dataSource.getRepository(BoardPost);
    const userRepo = dataSource.getRepository(User);

    const posts = await postRepo.find();
    console.log(`[마이그레이션] 총 ${posts.length}개의 게시글 확인 중...`);

    let updatedCount = 0;
    for (const post of posts) {
      if (!post.authorUserId) {
        continue;
      }

      const user = await userRepo.findOne({ where: { id: post.authorUserId } });
      if (!user) {
        console.warn(`[주의] 게시글 #${post.id}의 작성자(ID: ${post.authorUserId})를 찾을 수 없습니다.`);
        continue;
      }

      if (post.authorRole !== user.role) {
        console.log(
          `[정정] 게시글 #${post.id} ("${post.title}"): '${post.authorRole}' -> '${user.role}' (작성자: ${user.name || user.email})`
        );
        post.authorRole = user.role;
        await postRepo.save(post);
        updatedCount++;
      }
    }

    console.log(`[마이그레이션 완료] 총 ${posts.length}건 중 ${updatedCount}건의 authorRole을 정정했습니다.`);
  } catch (err) {
    console.error('[마이그레이션 실패]', err);
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

run();
