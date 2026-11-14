import { Injectable, BadRequestException, ForbiddenException, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ChatRoom, ChatRoomType } from '../entities/chat-room.entity';
import { ChatRoomMember } from '../entities/chat-room-member.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { User, UserRole } from '../entities/user.entity';
import { Student } from '../entities/student.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Academy } from '../entities/academy.entity';
import { PickupPoint } from '../entities/pickup-point.entity';
import { ParentMessage } from '../entities/parent-message.entity';
import { Notification } from '../entities/notification.entity';
import { ChatGateway } from './chat.gateway';
import { RoutingService } from '../routing/routing.service';
import { ApprovalService } from '../approval/approval.service';
import { formatTeacherName } from '../utils/teacher.util';
import { isNotificationEnabled } from '../utils/notification.util';

/** 개인 알림방 이름 (NOTIFICATION_SYSTEM 타입, 사용자 1명 전용) */
export const PERSONAL_NOTI_ROOM_NAME = 'TakeMe 알림';
/** 기관 공지 채널 이름 (NOTIFICATION_SYSTEM 타입, 기관 전체 공유) */
export const ACADEMY_NOTI_ROOM_NAME = '실시간 알림 채널';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRoom) private roomRepo: Repository<ChatRoom>,
    @InjectRepository(ChatRoomMember) private memberRepo: Repository<ChatRoomMember>,
    @InjectRepository(ChatMessage) private messageRepo: Repository<ChatMessage>,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Student) private studentRepo: Repository<Student>,
    @InjectRepository(Vehicle) private vehicleRepo: Repository<Vehicle>,
    @InjectRepository(Academy) private academyRepo: Repository<Academy>,
    @InjectRepository(PickupPoint) private pickupPointRepo: Repository<PickupPoint>,
    @InjectRepository(ParentMessage) private parentMessageRepo: Repository<ParentMessage>,
    @InjectRepository(Notification) private notificationRepo: Repository<Notification>,
    @Inject(forwardRef(() => ChatGateway))
    private readonly chatGateway: ChatGateway,
    @Inject(forwardRef(() => RoutingService))
    private readonly routingService: RoutingService,
  ) {
    this.routingService.registerSystemNotificationHandler(
      (academyId: number | null, category: string, title: string, content: string, extra?: any) => {
        return this.sendSystemNotification(academyId, category as any, title, content, extra);
      }
    );
  }

  async getAcademyUsers(academyId?: number, currentUserEmail?: string, educationLevel?: string) {
    let currentUser: User | null = null;
    if (currentUserEmail) {
      currentUser = await this.userRepo.findOne({ where: { email: currentUserEmail } });
    }
    const targetAcademyId = academyId || currentUser?.academyId;
    if (!targetAcademyId) {
      return { drivers: [], teachers: [], parents: [], students: [], admins: [] };
    }

    // 1. 차량 정보 조회 (기사 및 동승교사 매핑)
    const vehicles = await this.vehicleRepo.find({
      where: { academy: { id: targetAcademyId } },
      relations: { driverUser: true, teacherUser: true },
    });

    const driverVehicleMap = new Map<number, string>();
    const teacherVehicleMap = new Map<number, string>();
    const vehicleUserIds = new Set<number>();

    for (const v of vehicles) {
      if (v.driverUser) {
        driverVehicleMap.set(v.driverUser.id, v.busNumber ? `${v.busNumber} 기사` : '셔틀 기사');
        vehicleUserIds.add(v.driverUser.id);
      }
      if (v.teacherUser) {
        teacherVehicleMap.set(v.teacherUser.id, v.busNumber ? `${v.busNumber} 동승교사` : '동승교사');
        vehicleUserIds.add(v.teacherUser.id);
      }
    }

    // 2. 원생 정보 조회 (학부모 및 학생 계정 매핑)
    const students = await this.studentRepo.find({
      where: { academy: { id: targetAcademyId } },
      relations: { parentUser: true, studentUser: true },
    });

    const parentChildMap = new Map<number, string>();
    const parentUserIds = new Set<number>();
    const studentUserMap = new Map<number, string>();
    const studentUserIds = new Set<number>();

    for (const s of students) {
      if (s.parentUser) {
        const existing = parentChildMap.get(s.parentUser.id);
        const childName = s.name || '원아';
        parentChildMap.set(s.parentUser.id, existing ? `${existing}, ${childName}` : `${childName} 학부모`);
        parentUserIds.add(s.parentUser.id);
      }
      if (s.studentUser) {
        studentUserMap.set(s.studentUser.id, `${s.className ? s.className + ' · ' : ''}${s.name || '학생'}`);
        studentUserIds.add(s.studentUser.id);
      }
    }

    // 3. 사용자 목록 조회 (해당 유치원/학원 소속 사용자만 엄격 격리)
    const vIds = vehicleUserIds.size > 0 ? Array.from(vehicleUserIds) : [0];
    const pIds = parentUserIds.size > 0 ? Array.from(parentUserIds) : [0];
    const sIds = studentUserIds.size > 0 ? Array.from(studentUserIds) : [0];
    const userQuery = this.userRepo.createQueryBuilder('u')
      .where(
        '(u.academyId = :targetAcademyId OR u.id IN (:...vIds) OR u.id IN (:...pIds) OR u.id IN (:...sIds))',
        { targetAcademyId, vIds, pIds, sIds }
      );
    const allUsers = await userQuery.getMany();

    const isKindergarten = educationLevel === '유치원';
    const drivers: any[] = [];
    const teachers: any[] = [];
    const parents: any[] = [];
    const studentsList: any[] = [];
    const admins: any[] = [];

    for (const u of allUsers) {
      if (currentUser && u.id === currentUser.id) continue;

      if (u.role === UserRole.DRIVER) {
        const sub = driverVehicleMap.get(u.id) || '셔틀 기사';
        drivers.push({
          id: u.id,
          name: u.name || '기사님',
          role: u.role,
          email: u.email,
          subText: sub,
        });
      } else if (
        u.role === UserRole.TEACHER ||
        u.role === UserRole.HOMEROOM_TEACHER ||
        u.role === UserRole.SHUTTLE_TEACHER
      ) {
        const sub = u.assignedClass ? `${u.assignedClass} 담임` : teacherVehicleMap.get(u.id) || '교사';
        teachers.push({
          id: u.id,
          name: u.name || '선생님',
          role: u.role,
          email: u.email,
          subText: sub,
        });
      } else if (u.role === UserRole.STUDENT) {
        // 유치원에서는 학생이 스마트폰 앱을 사용하지 않으므로 제외! 초등부와 중등부에서는 포함!
        if (!isKindergarten) {
          const sub = studentUserMap.get(u.id) || u.assignedClass || '학생';
          studentsList.push({
            id: u.id,
            name: u.name ? (u.name.includes('학생') ? u.name : `${u.name} 학생`) : '학생',
            role: u.role,
            email: u.email,
            subText: sub,
          });
        }
      } else if (u.role === UserRole.PARENT) {
        const sub = parentChildMap.get(u.id) || '학부모';
        parents.push({
          id: u.id,
          name: u.name || '학부모님',
          role: u.role,
          email: u.email,
          subText: sub,
        });
      } else if (u.role === UserRole.ACADEMY_ADMIN || u.role === UserRole.SUPER_ADMIN) {
        admins.push({
          id: u.id,
          name: u.name || '원장선생님',
          role: u.role,
          email: u.email,
          subText: u.role === UserRole.SUPER_ADMIN ? '통합 관리자' : '원장',
        });
      }
    }

    const sortFn = (a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'ko');
    drivers.sort(sortFn);
    teachers.sort(sortFn);
    parents.sort(sortFn);
    studentsList.sort(sortFn);
    admins.sort(sortFn);

    return { drivers, teachers, parents, students: studentsList, admins };
  }

  /** 대화방 참여자 목록을 조회해서 해당 방 참여자에게만 메시지 전송 */
  private async broadcastToRoom(roomId: number, message: any) {
    const room = await this.roomRepo.findOne({ where: { id: roomId }, relations: { members: { user: true } } });
    const ids = (room?.members || []).map(m => m.user?.id).filter(Boolean) as number[];
    this.chatGateway.broadcastMessageToRoom(roomId, message, ids);
  }

  /** WebSocket 메시지 전송용: 사용자 ID 기준 (참여자 검증 포함) */
  async sendMessage(roomId: number, senderId: number, text: string) {
    const sender = await this.userRepo.findOne({ where: { id: senderId } });
    if (!sender) throw new BadRequestException('사용자를 찾을 수 없습니다.');
    return this.sendMessageAndBroadcast(roomId, sender.email, text);
  }

  /** 대화방 참여 여부 확인 */
  async isUserRoomMember(roomId: number, userId: number): Promise<boolean> {
    const member = await this.memberRepo.findOne({
      where: { room: { id: roomId }, user: { id: userId } },
    });
    return !!member;
  }

  /**
   * 사용자의 개인 알림방("TakeMe 알림", NOTIFICATION_SYSTEM) 조회 또는 생성.
   * 기관 공지 채널(실시간 알림 채널)과는 이름과 참여자(1명)로 구분한다.
   */
  async getOrCreateNotificationRoom(userId: number): Promise<ChatRoom> {
    const existingMember = await this.memberRepo.findOne({
      where: {
        user: { id: userId },
        room: { type: ChatRoomType.NOTIFICATION_SYSTEM, name: PERSONAL_NOTI_ROOM_NAME },
      },
      relations: { room: true },
    });
    if (existingMember?.room) return existingMember.room;

    const newRoom = this.roomRepo.create({
      name: PERSONAL_NOTI_ROOM_NAME,
      type: ChatRoomType.NOTIFICATION_SYSTEM,
    });
    const savedRoom = await this.roomRepo.save(newRoom);
    await this.memberRepo.save(this.memberRepo.create({ room: savedRoom, user: { id: userId } }));
    return savedRoom;
  }

  /**
   * 개인 알림 발송 (메신저 "TakeMe 알림" 방으로 전송)
   * - 알림 수신 설정(isNotificationEnabled)에서 꺼진 종류는 발송하지 않음
   */
  async sendSystemNotificationToUser(
    userId: number,
    title: string,
    message: string,
    options?: {
      type?: 'change_request' | 'chat' | 'notice' | 'escort' | 'shuttle' | 'board' | string;
      metadata?: any;
      actionUrl?: string;
    },
  ) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    if (options?.type && !isNotificationEnabled(user, options.type as any)) {
      return null;
    }

    const room = await this.getOrCreateNotificationRoom(userId);
    const chatMsg = this.messageRepo.create({
      room,
      sender: undefined,
      text: `[${title}]\n${message}`,
      type: 'TEXT',
      payload: {
        isSystemAlert: true,
        senderLabel: PERSONAL_NOTI_ROOM_NAME,
        category: options?.type,
        title,
        content: message,
        ...(options?.metadata || { type: options?.type, actionUrl: options?.actionUrl }),
      },
      readBy: [],
    });
    const saved = await this.messageRepo.save(chatMsg);
    await this.roomRepo.update(room.id, { updatedAt: new Date() });

    if (this.chatGateway?.server) {
      this.chatGateway.broadcastMessageToRoom(room.id, saved, [userId]);
      this.chatGateway.server.to(`user_${userId}`).emit('roomUpdated', { roomId: room.id });
      this.chatGateway.server.to(`user_${userId}`).emit('notificationReceived', {
        type: options?.type || 'SYSTEM',
        title,
        message,
        roomId: room.id,
        createdAt: saved.createdAt,
      });
    }
    return saved;
  }

  /** 여러 사용자에게 개인 알림 발송 */
  async sendSystemNotificationToUsers(
    userIds: number[],
    title: string,
    message: string,
    options?: {
      type?: 'change_request' | 'chat' | 'notice' | 'escort' | 'shuttle' | 'board' | string;
      metadata?: any;
      actionUrl?: string;
    },
  ) {
    const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
    const results = [];
    for (const uid of uniqueIds) {
      const res = await this.sendSystemNotificationToUser(uid, title, message, options);
      if (res) results.push(res);
    }
    return results;
  }

  /** 대화방 읽음 처리 */
  async markRoomAsRead(roomId: number, userId: number) {
    if (!(await this.isUserRoomMember(roomId, userId))) {
      throw new ForbiddenException('대화방 참여자만 읽음 처리할 수 있습니다.');
    }
    const messages = await this.messageRepo.find({
      where: { room: { id: roomId } },
      relations: { sender: true },
    });
    for (const m of messages) {
      const readByList = (m.readBy || []).map(Number);
      if (!readByList.includes(userId) && (!m.sender || m.sender.id !== userId)) {
        readByList.push(userId);
        m.readBy = readByList;
        await this.messageRepo.save(m);
      }
    }
    await this.memberRepo.update(
      { room: { id: roomId }, user: { id: userId } },
      { lastReadAt: new Date() },
    ).catch(() => {});
    this.chatGateway.broadcastReadStatus(roomId, userId);
    return { success: true };
  }

  async sendSystemNotification(
    academyId: number | null,
    category: 'ABSENT' | 'SHUTTLE_REQUEST' | 'PICKUP' | 'PAYMENT_REQUEST' | 'PAYMENT_DECISION' | 'GENERAL',
    title: string,
    content: string,
    extraData?: any,
  ) {
    try {
      let notiRoom = await this.roomRepo.findOne({
        where: {
          type: ChatRoomType.NOTIFICATION_SYSTEM,
          name: ACADEMY_NOTI_ROOM_NAME,
          ...(academyId ? { academyId } : {}),
        },
        relations: { members: { user: true } },
      });

      if (!notiRoom) {
        notiRoom = this.roomRepo.create({
          name: '실시간 알림 채널',
          type: ChatRoomType.NOTIFICATION_SYSTEM,
          academyId: academyId || null,
        });
        notiRoom = await this.roomRepo.save(notiRoom);
      }

      let senderUser: User | null = null;
      if (academyId) {
        senderUser = await this.userRepo.findOne({
          where: { academyId, role: In([UserRole.ACADEMY_ADMIN, UserRole.SUPER_ADMIN]) },
        });
      }
      if (!senderUser) {
        senderUser = await this.userRepo.findOne({
          where: { role: UserRole.SUPER_ADMIN },
        });
      }

      const message = this.messageRepo.create({
        room: notiRoom,
        sender: senderUser || undefined,
        text: `[${title}] ${content}`,
        type: 'TEXT',
        payload: {
          isSystemAlert: true,
          category,
          title,
          content,
          extraData,
          createdAt: new Date().toISOString(),
        },
        readBy: senderUser ? [senderUser.id] : [],
      });

      const saved = await this.messageRepo.save(message);
      await this.roomRepo.update(notiRoom.id, { updatedAt: new Date() });

      this.chatGateway.broadcastMessageToRoom(notiRoom.id, saved, (notiRoom.members || []).map(m => m.user?.id).filter(Boolean) as number[]);
      this.chatGateway.server?.to(`chat_${notiRoom.id}`).emit('roomUpdated', { roomId: notiRoom.id });
      if (academyId) this.chatGateway.server?.to(`academy_${academyId}`).emit('roomUpdated', { roomId: notiRoom.id });

      const alertPayload = {
        id: saved.id,
        category,
        title,
        message: content,
        timestamp: new Date().toISOString(),
        data: extraData,
      };

      if (academyId && this.chatGateway?.server) {
        this.chatGateway.server.to(`academy_${academyId}`).emit('directorAlert', alertPayload);
        this.chatGateway.server.to(`academy_${academyId}`).emit('notificationReceived', {
          type: 'DIRECTOR_ALERT',
          data: alertPayload,
        });
      }
      // 전체 전송 대신 통합 관리자 개인 방으로만 전달
      const superAdmins = await this.userRepo.find({ where: { role: UserRole.SUPER_ADMIN } });
      for (const sa of superAdmins) {
        this.chatGateway?.server?.to(`user_${sa.id}`).emit('globalDirectorAlert', alertPayload);
      }

      return saved;
    } catch (err) {
      console.error('Failed to send system notification:', err);
    }
  }

  async getRoomsByEmail(email: string, educationLevel?: string) {
    if (!email) return [];
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return [];
    const userId = user.id;

    const targetAcademyId = user.academyId || null;

    // Ensure '실시간 알림 채널' exists and user is member
    let notiSystemRoom = await this.roomRepo.findOne({
      where: {
        type: ChatRoomType.NOTIFICATION_SYSTEM,
        name: ACADEMY_NOTI_ROOM_NAME,
        ...(targetAcademyId ? { academyId: targetAcademyId } : {}),
      },
      relations: { members: { user: true } },
    });

    if (!notiSystemRoom) {
      notiSystemRoom = this.roomRepo.create({
        name: '실시간 알림 채널',
        type: ChatRoomType.NOTIFICATION_SYSTEM,
        academyId: targetAcademyId,
      });
      notiSystemRoom = await this.roomRepo.save(notiSystemRoom);
    }

    const isNotiMember = (notiSystemRoom.members || []).some(m => m.user?.id === userId);
    if (!isNotiMember) {
      const notiMember = this.memberRepo.create({
        room: notiSystemRoom,
        user: { id: userId },
      });
      await this.memberRepo.save(notiMember);
    }

    // 개인 알림방 보장 ("TakeMe 알림")
    await this.getOrCreateNotificationRoom(userId);

    // Fetch all rooms the user is a member of
    const query = this.roomRepo.createQueryBuilder('room')
      .innerJoin('room.members', 'myMember', 'myMember.userId = :userId', { userId })
      .leftJoinAndSelect('room.members', 'allMembers')
      .leftJoinAndSelect('allMembers.user', 'memberUser');

    if (targetAcademyId) {
      query.andWhere('(room.academyId = :targetAcademyId OR room.academyId IS NULL)', { targetAcademyId });
    }

    const rooms = await query.getMany();

    for (const room of rooms) {
      const latestMessage = await this.messageRepo.findOne({
        where: { room: { id: room.id } },
        order: { createdAt: 'DESC' },
        relations: { sender: true },
      });
      (room as any).latestMessage = latestMessage || null;

      // 안 읽은 메시지 수 계산
      const allMsgs = await this.messageRepo.find({
        where: { room: { id: room.id } },
        relations: { sender: true },
      });
      let unread = 0;
      for (const m of allMsgs) {
        if (m.sender && m.sender.id !== userId) {
          const reads = (m.readBy || []).map(Number);
          if (!reads.includes(userId)) {
            unread++;
          }
        }
      }
      (room as any).unreadCount = unread;
    }

    // 결재 전용 방 제외 및 알림 채널 단 1개 유지
    const seenSpecialTypes = new Set<string>();
    const deduplicatedRooms: ChatRoom[] = [];
    for (const room of rooms) {
      // 결재 전용 채널은 제거 (일반 1:1 및 그룹 대화방에서 결재 진행)
      if (room.type === ChatRoomType.PAYMENT_SYSTEM) {
        continue;
      }
      // 학제 격리: 방의 학제 정보가 지정되어 있고 현재 학제와 다르면 제외
      if ((room as any).educationLevel && educationLevel && (room as any).educationLevel !== educationLevel) {
        continue;
      }
      if (room.type === ChatRoomType.NOTIFICATION_SYSTEM) {
        // 개인 알림방(TakeMe 알림) 1개 + 기관 공지 채널(실시간 알림 채널) 1개만 유지
        const key = room.name === PERSONAL_NOTI_ROOM_NAME ? 'PERSONAL' : 'ACADEMY';
        if (seenSpecialTypes.has(key)) continue;
        seenSpecialTypes.add(key);
        room.name = key === 'PERSONAL' ? PERSONAL_NOTI_ROOM_NAME : ACADEMY_NOTI_ROOM_NAME;
      }
      deduplicatedRooms.push(room);
    }

    // 실시간 알림 채널 최상단 고정, 나머지 최신 메시지 순 정렬
    deduplicatedRooms.sort((a: any, b: any) => {
      const aPin = a.type === ChatRoomType.NOTIFICATION_SYSTEM;
      const bPin = b.type === ChatRoomType.NOTIFICATION_SYSTEM;
      if (aPin && bPin) return a.name === PERSONAL_NOTI_ROOM_NAME ? -1 : 1; // 내 알림 -> 기관 공지
      if (aPin) return -1;
      if (bPin) return 1;
      const timeA = a.latestMessage ? new Date(a.latestMessage.createdAt).getTime() : new Date(a.updatedAt || a.createdAt).getTime();
      const timeB = b.latestMessage ? new Date(b.latestMessage.createdAt).getTime() : new Date(b.updatedAt || b.createdAt).getTime();
      return timeB - timeA;
    });

    return deduplicatedRooms;
  }

  async getMessages(roomId: number, currentUserId?: number) {
    if (currentUserId) {
      const isMember = await this.isUserRoomMember(roomId, currentUserId);
      if (!isMember) {
        throw new ForbiddenException('대화방 참여자만 메시지를 조회할 수 있습니다.');
      }
    }

    const room = await this.roomRepo.findOne({
      where: { id: roomId },
      relations: { members: { user: true } },
    });
    const memberCount = room?.members?.length || 2;

    const messages = await this.messageRepo.find({
      where: { room: { id: roomId } },
      order: { createdAt: 'ASC' },
      relations: { sender: true },
    });

    let hasNewRead = false;
    for (const m of messages) {
      const readByList = (m.readBy || []).map(Number);
      if (currentUserId && m.sender && m.sender.id !== currentUserId && !readByList.includes(currentUserId)) {
        readByList.push(currentUserId);
        m.readBy = readByList;
        await this.messageRepo.save(m);
        hasNewRead = true;
      }
      (m as any).unreadCount = Math.max(0, memberCount - (m.readBy ? m.readBy.length : 0));
    }

    if (hasNewRead && currentUserId) {
      await this.memberRepo.update(
        { room: { id: roomId }, user: { id: currentUserId } },
        { lastReadAt: new Date() }
      ).catch(() => {});
      this.chatGateway.broadcastReadStatus(roomId, currentUserId);
    }

    return messages;
  }

  async createRoomByEmail(name: string | undefined, type: string | undefined, userIds: number[], creatorEmail: string) {
    userIds = userIds || [];
    const creator = await this.userRepo.findOne({ where: { email: creatorEmail } });
    if (!creator) throw new BadRequestException('생성자 계정을 찾을 수 없습니다.');

    if (!userIds.includes(creator.id)) {
      userIds.push(creator.id);
    }

    const isDirect = userIds.length === 2;
    const roomType = isDirect ? ChatRoomType.DIRECT : ((type as any) || ChatRoomType.GROUP);

    // 1:1 대화인 경우 동일 2명으로 구성된 기존 방이 있는지 확인
    if (isDirect) {
      const u1 = userIds[0];
      const u2 = userIds[1];
      const existingQuery = this.roomRepo.createQueryBuilder('room')
        .innerJoin('room.members', 'm1', 'm1.userId = :u1', { u1 })
        .innerJoin('room.members', 'm2', 'm2.userId = :u2', { u2 })
        .leftJoinAndSelect('room.members', 'allMembers')
        .leftJoinAndSelect('allMembers.user', 'user');

      if (creator.academyId) {
        existingQuery.andWhere('(room.academyId = :cadId OR room.academyId IS NULL)', { cadId: creator.academyId });
      }
      const existingRooms = await existingQuery.getMany();

      for (const r of existingRooms) {
        if (r.members && r.members.length === 2 && r.type !== ChatRoomType.PAYMENT_SYSTEM) {
          return r;
        }
      }
    }

    const targetUsers = await this.userRepo.find({ where: { id: In(userIds) } });
    let roomName = name?.trim();
    if (!roomName) {
      const otherNames = targetUsers.filter(u => u.id !== creator.id).map(u => u.name || u.email);
      if (isDirect) {
        roomName = otherNames[0] || '1:1 대화';
      } else {
        const preview = otherNames.slice(0, 3).join(', ');
        roomName = `${preview}${otherNames.length > 3 ? ' 외' : ''} (${targetUsers.length}명)`;
      }
    }

    const room = this.roomRepo.create({
      name: roomName,
      type: roomType,
      academyId: creator.academyId || null,
    });
    const savedRoom = await this.roomRepo.save(room);

    const members = userIds.map(uid => this.memberRepo.create({
      room: savedRoom,
      user: { id: uid },
    }));
    await this.memberRepo.save(members);

    for (const uid of userIds) {
      this.chatGateway?.server?.to(`user_${uid}`).emit('roomUpdated', { roomId: savedRoom.id });
    }

    return this.roomRepo.findOne({
      where: { id: savedRoom.id },
      relations: { members: { user: true } },
    });
  }

  async sendMessageAndBroadcast(roomId: number, senderEmail: string, text: string) {
    const user = await this.userRepo.findOne({ where: { email: senderEmail } });
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    if (!(await this.isUserRoomMember(roomId, user.id))) {
      throw new ForbiddenException('대화방 참여자만 메시지를 보낼 수 있습니다.');
    }
    const targetRoom = await this.roomRepo.findOne({ where: { id: roomId } });
    if (targetRoom?.type === ChatRoomType.NOTIFICATION_SYSTEM) {
      const isAdmin = user.role === UserRole.ACADEMY_ADMIN || user.role === UserRole.SUPER_ADMIN;
      if (targetRoom.name === PERSONAL_NOTI_ROOM_NAME || !isAdmin) {
        throw new ForbiddenException('알림 채널에는 답장을 보낼 수 없습니다.');
      }
    }

    const message = this.messageRepo.create({
      room: { id: roomId },
      sender: user,
      text: text.trim(),
      type: 'TEXT',
      readBy: [user.id],
    });
    const saved = await this.messageRepo.save(message);

    await this.roomRepo.update(roomId, { updatedAt: new Date() });

    const fullMessage = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: { sender: true },
    });

    if (fullMessage) {
      const roomForBroadcast = await this.roomRepo.findOne({ where: { id: roomId }, relations: { members: { user: true } } });
      this.chatGateway.broadcastMessageToRoom(
        roomId,
        fullMessage,
        (roomForBroadcast?.members || []).map(m => m.user?.id).filter(Boolean) as number[],
      );
    }

    // [교사/기사 앱 수신함 즉시 동기화]
    // 관리자(원장님) 또는 다른 사용자가 메시지를 보냈을 때,
    // 이 방의 다른 멤버들(교사, 기사 등)의 앱 수신함(ParentMessage)으로 자동 전달!
    try {
      const room = await this.roomRepo.findOne({
        where: { id: roomId },
        relations: { members: { user: true } },
      });
      if (room && room.members) {
        const isSenderAdmin = user.role === 'ACADEMY_ADMIN' || user.role === 'SUPER_ADMIN';
        const isDirect = room.type === ChatRoomType.DIRECT || room.members.length <= 2;
        const prefix = isSenderAdmin
          ? (isDirect ? '[원장님 1:1 개인 메세지]' : '[원장님 공지]')
          : `[${user.name || '알림'}]`;

        for (const m of room.members) {
          if (m.user && m.user.id !== user.id) {
            const receiverRole = m.user.role || '';
            const targetRoles: string[] = [String(receiverRole)];
            if (
              receiverRole.includes('TEACHER') ||
              receiverRole === 'HOMEROOM_TEACHER' ||
              receiverRole === 'SHUTTLE_TEACHER'
            ) {
              targetRoles.push('TEACHER', 'HOMEROOM_TEACHER', 'SHUTTLE_TEACHER');
            }

            const pMsg = this.parentMessageRepo.create({
              receiverUser: m.user,
              targetRoles: targetRoles,
              message: `${prefix} ${text.trim()}`,
              isRead: false,
            });
            await this.parentMessageRepo.save(pMsg);
          }
        }
      }
    } catch (bridgeErr) {
      console.warn('[ChatService] ParentMessage sync error:', bridgeErr);
    }

    return fullMessage;
  }

  // ============================================================
  // 결재 및 탑승 신청 관련 메서드
  // ============================================================

  async getPaymentContext(academyId?: number, userEmail?: string) {
    let aId = academyId;
    if (!aId && userEmail) {
      const u = await this.userRepo.findOne({ where: { email: userEmail } });
      if (u?.academyId) aId = u.academyId;
    }

    if (!aId) {
      return { vehicles: [], students: [], pickupPoints: [] };
    }

    const vehicles = await this.vehicleRepo.find({
      where: { academy: { id: aId } },
      relations: { driverUser: true, teacherUser: true },
    });

    const students = await this.studentRepo.find({
      where: { academy: { id: aId } },
      relations: { assignedVehicle: true, parentUser: true },
    });

    const pickupPoints = await this.pickupPointRepo.find({
      where: { academy: { id: aId } },
    });

    return {
      vehicles: vehicles.map(v => ({
        id: v.id,
        busNumber: v.busNumber,
        driverName: v.driverUser?.name || v.driverName || '기사님',
        driverPhone: v.driverPhone,
        teacherName: v.teacherUser?.name || v.teacherName || '지도교사',
        teacherPhone: v.teacherPhone,
        colorHex: v.colorHex || '#3b82f6',
      })),
      students: students.map(s => {
        let raw: any = {};
        if (typeof s.raw === 'string') {
          try { raw = JSON.parse(s.raw); } catch (e) {}
        } else if (typeof s.raw === 'object' && s.raw) {
          raw = s.raw;
        }
        return {
          id: s.id,
          name: s.adminDisplayName || s.name,
          address: s.address,
          boardingLocation: s.boardingLocation || s.address,
          lat: s.latitude,
          lng: s.longitude,
          assignedBusId: s.assignedVehicle?.id || null,
          assignedBusNumber: s.assignedVehicle?.busNumber || '미배정',
          className: raw.반 || raw['반명'] || raw.className || '',
          birthDate: raw.생년월일 || raw.birthDate || '',
          gender: raw.성별 || '',
          parentName: s.parentUser?.name || raw['보호자 성함'] || raw.보호자명 || raw.parentName || '',
          parentPhone: s.parentUser?.phone || raw['보호자연락처'] || raw.보호자연락처 || raw.parentPhone || '',
          allergies: s.allergies || raw.알레르기 || raw.allergies || '없음',
          dropoffLocation: raw.하차지 || raw.dropoffLocation || s.address || '',
          isNotRiding: s.isNotRiding,
          boardStatus: s.boardStatus,
        };
      }),
      pickupPoints: pickupPoints.map(p => ({
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    };
  }

  async getPaymentRequests(academyId?: number) {
    const qb = this.messageRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.room', 'room')
      .leftJoinAndSelect('m.sender', 'sender')
      .where("m.type = 'PAYMENT_REQUEST'");

    if (academyId) {
      qb.andWhere('(room.academyId = :aId OR room.academyId IS NULL)', { aId: Number(academyId) });
    }

    const messages = await qb.orderBy('m.createdAt', 'DESC').getMany();

    return messages.map((m) => {
      const payload = m.payload || {};
      return {
        id: m.id,
        messageId: m.id,
        ...payload,
        senderName: m.sender?.name || m.sender?.email,
        senderEmail: m.sender?.email,
        createdAt: m.createdAt,
      };
    });
  }

  async createPaymentRequest(
    data: {
      roomId?: number;
      studentId?: number;
      studentName?: string;
      vehicleId?: number;
      rideType?: 'TODAY_ONLY' | 'REGULAR';
      boardingLocation: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      requestDate?: string;
      note?: string;
    },
    requesterEmail: string,
  ) {
    if (!requesterEmail) throw new BadRequestException('신청자 정보가 필요합니다.');
    const requester = await this.userRepo.findOne({ where: { email: requesterEmail } });
    if (!requester) throw new BadRequestException('신청자 계정을 찾을 수 없습니다.');

    // 학부모는 결재 신청 불가
    if (requester.role === UserRole.PARENT) {
      throw new ForbiddenException('학부모 계정은 결재 신청 기능을 이용할 수 없습니다.');
    }

    let vehicle: Vehicle | null = null;
    if (data.vehicleId) {
      vehicle = await this.vehicleRepo.findOne({
        where: { id: Number(data.vehicleId) },
        relations: { teacherUser: true, driverUser: true, academy: true },
      });
    }

    if (!vehicle) {
      throw new BadRequestException('결재 신청을 위한 지정 차량을 찾을 수 없습니다.');
    }

    if (vehicle?.academy?.id && requester.academyId && vehicle.academy.id !== requester.academyId) {
      throw new ForbiddenException('다른 유치원의 차량에는 신청할 수 없습니다.');
    }

    let studentName = data.studentName;
    let studentObj: Student | null = null;
    let studentRaw: any = {};
    if (data.studentId) {
      studentObj = await this.studentRepo.findOne({
        where: { id: Number(data.studentId) },
        relations: { parentUser: true, assignedVehicle: true },
      });
      if (studentObj) {
        studentName = studentObj.adminDisplayName || studentObj.name;
        if (typeof studentObj.raw === 'string') {
          try { studentRaw = JSON.parse(studentObj.raw); } catch (e) {}
        } else if (typeof studentObj.raw === 'object' && studentObj.raw) {
          studentRaw = studentObj.raw;
        }
      }

      // Check if an active payment request already exists for this student (중복 신청 방지 원아 락)
      const existingPending = await this.messageRepo
        .createQueryBuilder('m')
        .where("m.type = 'PAYMENT_REQUEST'")
        .andWhere("m.payload->>'studentId' = :sId", { sId: String(data.studentId) })
        .andWhere("m.payload->>'status' IN ('PENDING', 'RE_REQUESTED')")
        .getOne();

      if (existingPending) {
        const reqName = existingPending.payload?.requesterName || '다른 교직원';
        const reqStatus = existingPending.payload?.status === 'RE_REQUESTED' ? '새 위치 제안 검토 중' : '승인 대기 중';
        throw new BadRequestException(
          `이미 해당 원아(${studentName})에 대한 결제/탑승 승인 요청이 진행 중입니다. (신청자: ${reqName}, 상태: ${reqStatus})`
        );
      }
    }
    studentName = studentName || '신규 원생';

    const targetAcademyId = vehicle?.academy?.id || requester.academyId;

    // 결재를 진행할 1:1 또는 그룹 대화방 찾기
    let targetRoom: ChatRoom | null = null;
    if (data.roomId) {
      targetRoom = await this.roomRepo.findOne({
        where: { id: Number(data.roomId) },
        relations: { members: { user: true } },
      });
    }

    if (!targetRoom && vehicle?.teacherUser?.id) {
      targetRoom = (await this.createRoomByEmail(
        undefined,
        'DIRECT',
        [requester.id, vehicle.teacherUser.id],
        requester.email,
      )) as ChatRoom;
    }

    if (!targetRoom) {
      const adminUser = await this.userRepo.findOne({
        where: {
          academyId: targetAcademyId || requester.academyId,
          role: In([UserRole.ACADEMY_ADMIN, UserRole.SUPER_ADMIN]),
        },
      });
      if (adminUser && adminUser.id !== requester.id) {
        targetRoom = (await this.createRoomByEmail(
          undefined,
          'DIRECT',
          [requester.id, adminUser.id],
          requester.email,
        )) as ChatRoom;
      }
    }

    if (!targetRoom) {
      throw new BadRequestException('결재를 진행할 1:1 또는 그룹 대화방을 찾을 수 없습니다.');
    }

    const rideType = data.rideType || 'TODAY_ONLY'; // 'TODAY_ONLY' | 'REGULAR'

    const payload = {
      studentId: data.studentId ? Number(data.studentId) : (studentObj?.id || null),
      studentName,
      className: studentRaw['반명'] || studentRaw.반 || studentRaw.className || '',
      parentName: studentObj?.parentUser?.name || studentRaw['보호자 성함'] || studentRaw.보호자명 || '',
      parentPhone: studentObj?.parentUser?.phone || studentRaw['보호자연락처'] || '',
      allergies: studentObj?.allergies || studentRaw.알레르기 || '',
      vehicleId: vehicle.id,
      busNumber: vehicle.busNumber,
      teacherName: vehicle.teacherUser?.name || vehicle.teacherName || '담당 지도교사',
      teacherEmail: vehicle.teacherUser?.email || null,
      driverName: vehicle.driverUser?.name || vehicle.driverName || '기사님',
      isPublicContest: false,
      requestType: 'ONE_ON_ONE',
      targetTeacherId: vehicle.teacherUser?.id || null,
      targetTeacherEmail: vehicle.teacherUser?.email || null,
      targetTeacherName: vehicle.teacherUser?.name || vehicle.teacherName || '담당 지도교사',
      requesterId: requester.id,
      requesterEmail: requester.email,
      requesterName: requester.name || requester.email,
      requesterRole: requester.role,
      boardingLocation: data.boardingLocation || '지정 탑승지',
      address: data.address || data.boardingLocation || '',
      latitude: data.latitude ? Number(data.latitude) : (studentObj?.latitude || vehicle?.academy?.latitude || 37.842),
      longitude: data.longitude ? Number(data.longitude) : (studentObj?.longitude || vehicle?.academy?.longitude || 127.123),
      locationType: (data as any).locationType || 'PIN',
      rideType,
      requestDate: data.requestDate || new Date().toISOString().split('T')[0],
      note: data.note || (rideType === 'TODAY_ONLY' ? '오늘 하루 하원 셔틀 탑승 희망 (익일 자동 픽업 원복)' : '정규 셔틀 탑승 및 구역 편입 희망'),
      status: 'PENDING',
    };

    const requestMsgText = rideType === 'TODAY_ONLY'
      ? `[당일 1회 탑승 신청] ${studentName} 원아 - ${vehicle.busNumber} 하원 탑승 요청 (내일 자동 원복)`
      : `[정규 셔틀 신청] ${studentName} 원아 - ${vehicle.busNumber} 정규 노선 편입 요청`;

    const message = this.messageRepo.create({
      room: targetRoom,
      sender: requester,
      text: requestMsgText,
      type: 'PAYMENT_REQUEST',
      payload,
      readBy: [requester.id],
    });

    const saved = await this.messageRepo.save(message);
    await this.roomRepo.update(targetRoom.id, { updatedAt: new Date() });

    // 학생 학부모에게 결재 신청 안내 발송
    if (studentObj?.parentUser) {
      const parentMsg = this.parentMessageRepo.create({
        student: studentObj,
        receiverUser: studentObj.parentUser,
        targetRoles: ['PARENT'],
        message: `[통학 셔틀 결재 신청 접수] ${studentName} 원아의 [${payload.busNumber}] ${rideType === 'TODAY_ONLY' ? '당일 탑승' : '정규 탑승'} 결재 신청이 접수되어 지도교사 승인 대기 중입니다. (탑승 희망지: ${payload.boardingLocation})`,
      });
      await this.parentMessageRepo.save(parentMsg).catch(() => {});
    }

    // 실시간 알림 채널에 결재 신청 알림 전송 (원장 및 전 교직원이 확인 가능)
    await this.sendSystemNotification(
      targetAcademyId || null,
      'PAYMENT_REQUEST',
      '신규 결재 신청',
      `[신규 결재 신청] ${requester.name || requester.email}님이 ${studentName} 원아의 [${payload.busNumber}] 탑승 결재를 신청하였습니다. (탑승지: ${payload.boardingLocation})`,
      {
        messageId: saved.id,
        roomId: targetRoom.id,
        studentName,
        busNumber: payload.busNumber,
        requesterName: requester.name || requester.email,
        boardingLocation: payload.boardingLocation,
      }
    );

    const fullMessage = await this.messageRepo.findOne({
      where: { id: saved.id },
      relations: { sender: true },
    });

    if (fullMessage) {
      await this.broadcastToRoom(targetRoom.id, fullMessage);
    }

    return fullMessage;
  }

  async decidePaymentRequest(
    messageId: number,
    decision: 'APPROVED' | 'REJECTED',
    decidedByEmail: string,
    vehicleId?: number,
  ) {
    if (!decidedByEmail) throw new BadRequestException('승인자 정보가 필요합니다.');
    const decider = await this.userRepo.findOne({ where: { email: decidedByEmail } });
    if (!decider) throw new BadRequestException('승인자 계정을 찾을 수 없습니다.');

    // 학부모는 승인 또는 거절 권한 없음
    if (decider.role === UserRole.PARENT) {
      throw new ForbiddenException('학부모 계정은 결재 승인/거절 권한이 없습니다.');
    }

    const message = await this.messageRepo.findOne({
      where: { id: Number(messageId) },
      relations: { room: true, sender: true },
    });
    if (!message || message.type !== 'PAYMENT_REQUEST') {
      throw new BadRequestException('결재 신청 메시지를 찾을 수 없습니다.');
    }

    if (decider.role !== UserRole.SUPER_ADMIN && message.room?.academyId && decider.academyId && message.room.academyId !== decider.academyId) {
      throw new ForbiddenException('다른 유치원의 결재 신청을 처리할 수 없습니다.');
    }

    const payload = message.payload || {};

    // 1. 이미 결재 완료된 건 추가 결재 차단
    if (payload.status && payload.status !== 'PENDING' && payload.status !== 'RE_REQUESTED') {
      const alreadyDecidedBy = payload.decidedBy || '다른 담당자';
      const alreadyDecidedBus = payload.busNumber || '';
      throw new BadRequestException(
        `이미 ${alreadyDecidedBy} 지도교사에 의해 결재가 완료되었습니다. (${alreadyDecidedBus}) 추가 결재가 불가능합니다.`
      );
    }

    // 2. 자가 승인 금지: 신청자 본인은 자신이 올린 결재 건을 결재할 수 없음
    const isRequester =
      (message.sender && message.sender.id === decider.id) ||
      (payload.requesterEmail && payload.requesterEmail.toLowerCase() === decider.email.toLowerCase()) ||
      (payload.requesterId && Number(payload.requesterId) === decider.id);

    if (isRequester) {
      throw new ForbiddenException(
        '본인이 직접 신청한 결재 건은 본인이 결재할 수 없습니다. 상대방(담당 지도교사 또는 원장님)만 결재 가능합니다.'
      );
    }

    // 3. 1:1 결재 시 상대방(지정된 지도교사 또는 관리자)만 결재 가능
    const isAdmin = decider.role === UserRole.ACADEMY_ADMIN || decider.role === UserRole.SUPER_ADMIN;
    const isDesignatedTeacher =
      (payload.targetTeacherId && Number(payload.targetTeacherId) === decider.id) ||
      (payload.targetTeacherEmail && payload.targetTeacherEmail.toLowerCase() === decider.email.toLowerCase()) ||
      (payload.teacherEmail && payload.teacherEmail.toLowerCase() === decider.email.toLowerCase());

    if (!isDesignatedTeacher && !isAdmin) {
      throw new ForbiddenException('해당 1:1 결재 건은 지정된 담당 지도교사 또는 원장님만 결재할 수 있습니다.');
    }

    if (decision === 'APPROVED') {
      // 4. 차량 결정 및 배정
      let vehicle: Vehicle | null = null;
      if (vehicleId) {
        vehicle = await this.vehicleRepo.findOne({
          where: { id: Number(vehicleId) },
          relations: { academy: true, teacherUser: true, driverUser: true },
        });
      } else if (payload.vehicleId) {
        vehicle = await this.vehicleRepo.findOne({
          where: { id: Number(payload.vehicleId) },
          relations: { academy: true, teacherUser: true, driverUser: true },
        });
      }

      if (!vehicle) {
        throw new BadRequestException('배정할 통학 차량을 찾을 수 없습니다. 배정 차량을 지정해주세요.');
      }

      let student: Student | null = null;
      if (payload.studentId) {
        student = await this.studentRepo.findOne({
          where: { id: Number(payload.studentId) },
          relations: { academy: true },
        });
      }

      const finalLocation = payload.counterProposal?.suggestedLocation || payload;
      const finalLat = Number(finalLocation.latitude || payload.latitude);
      const finalLng = Number(finalLocation.longitude || payload.longitude);
      const finalBoardingLocation = finalLocation.boardingLocation || payload.boardingLocation;
      const finalAddress = finalLocation.address || payload.address || finalBoardingLocation;

      if (!student) {
        const academy = vehicle.academy || (await this.academyRepo.findOne({ where: { id: decider.academyId } }));
        student = this.studentRepo.create({
          name: payload.studentName,
          adminDisplayName: payload.studentName,
          address: finalAddress,
          boardingLocation: finalBoardingLocation,
          latitude: finalLat,
          longitude: finalLng,
          academy,
          approvalStatus: 'APPROVED',
        });
      }

      const isTodayOnly = (payload.rideType || 'TODAY_ONLY') === 'TODAY_ONLY';
      const todayStr = new Date().toISOString().split('T')[0];

      let rawObj = student.raw;
      if (typeof rawObj === 'string') {
        try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
      }
      if (!rawObj || typeof rawObj !== 'object') rawObj = {};

      if (isTodayOnly) {
        // Backup original state before temporary ride
        rawObj.isTemporaryRide = true;
        rawObj.temporaryRideDate = todayStr;
        if (rawObj.originalIsNotRiding === undefined) {
          rawObj.originalIsNotRiding = student.isNotRiding;
        }
        if (rawObj.originalBoardingLocation === undefined) {
          rawObj.originalBoardingLocation = student.boardingLocation || null;
        }
        rawObj['하차지'] = finalBoardingLocation;
      } else {
        // Regular ride: clear temporary ride flags
        rawObj.isTemporaryRide = false;
        delete rawObj.temporaryRideDate;
        delete rawObj.originalIsNotRiding;
        delete rawObj.originalBoardingLocation;
      }
      student.raw = rawObj;

      student.assignedVehicle = vehicle;
      student.boardingLocation = finalBoardingLocation;
      student.address = finalAddress;
      if (finalLat) student.latitude = finalLat;
      if (finalLng) student.longitude = finalLng;
      student.approvalStatus = 'APPROVED';
      student.isNotRiding = false;
      student.boardStatus = 'WAITING';
      const savedStudent = await this.studentRepo.save(student);

      // Sync student_schedules
      await this.studentRepo.query(
        `UPDATE student_schedules SET "assignedVehicleId" = $1 WHERE "studentId" = $2`,
        [vehicle.id, savedStudent.id],
      ).catch(() => {});

      // 2. Expand Vehicle Zone Polygon (정규 셔틀 등록인 경우에만 구역 영구 확장)
      if (!isTodayOnly) {
        try {
          const busStudents = await this.studentRepo.find({
            where: { assignedVehicle: { id: vehicle.id } },
          });
          const points: [number, number][] = [];
          for (const bs of busStudents) {
            if (bs.latitude && bs.longitude) {
              points.push([Number(bs.latitude), Number(bs.longitude)]);
            }
          }
          if (payload.latitude && payload.longitude) {
            points.push([Number(payload.latitude), Number(payload.longitude)]);
          }

          const expandedPolygon = this.routingService.generateZonePolygon(points);
          if (expandedPolygon && expandedPolygon.length >= 3) {
            vehicle.polygonCoordinates = JSON.stringify(expandedPolygon);
            await this.vehicleRepo.save(vehicle);
          }
        } catch (err) {
          console.error('Zone polygon expansion error:', err);
        }
      }

      // 3. Notify Route Updated (노선에 자동 반영)
      const targetAcadId = vehicle.academy?.id || student.academy?.id || decider.academyId;
      if (targetAcadId) {
        const updateTitle = isTodayOnly
          ? `[당일 임시 탑승 승인] ${payload.studentName} 원아가 오늘 하루 ${vehicle.busNumber} 노선에 추가되었습니다. (내일 자동 원복)`
          : `[정규 셔틀 탑승 승인] ${payload.studentName} 원아가 ${vehicle.busNumber} 정규 노선에 등록되었습니다.`;
        this.routingService.notifyRouteUpdated(targetAcadId, updateTitle);
      }

      // 4. Update Message Payload
      payload.status = 'APPROVED';
      payload.decidedBy = decider.name || decider.email;
      payload.decidedAt = new Date().toISOString();
      payload.vehicleId = vehicle.id;
      payload.busNumber = vehicle.busNumber;
      payload.teacherName = formatTeacherName(decider.name || vehicle.teacherUser?.name) || '지도교사';
      payload.teacherEmail = decider.email;
      payload.driverName = vehicle.driverUser?.name || vehicle.driverName || '기사님';

      message.payload = payload;
      await this.messageRepo.save(message);

      // 5. Send automated confirmation chat message in the room
      const isCounterApproved = Boolean(payload.counterProposal);
      let confText = '';
      if (isCounterApproved) {
        confText = `✓ [재결재 수락 완료] 지도교사 제안 탑승지(${finalBoardingLocation})로 최종 승인되었습니다. (${payload.studentName} 원아 -> ${payload.busNumber}, ${isTodayOnly ? '오늘 하루 탑승' : '정규 등록'})`;
      } else {
        confText = isTodayOnly
          ? `✓ [당일 탑승 수락 완료] 오늘 하루만 ${payload.studentName} 원아가 ${payload.busNumber}에 임시 탑승합니다. (익일 자정 픽업으로 자동 원복, 담당: ${decider.name || '선생님'})`
          : `✓ [정규 셔틀 등록 완료] ${payload.studentName} 원아가 ${payload.busNumber} 정규 운행 구역 및 노선에 편입되었습니다. (담당: ${decider.name || '선생님'})`;
      }

      const confirmationMsg = this.messageRepo.create({
        room: message.room,
        sender: decider,
        text: confText,
        type: 'TEXT',
        readBy: [decider.id],
      });
      const savedConf = await this.messageRepo.save(confirmationMsg);

      await this.broadcastToRoom(message.room.id, message);
      await this.broadcastToRoom(message.room.id, savedConf);

      const notifyTitle = '결재 승인 완료 알림';
      const notifyText = `[결재 승인 완료] ${payload.studentName} 원아의 [${vehicle.busNumber}] ${isTodayOnly ? '당일 임시' : '정규'} 탑승 결재가 ${formatTeacherName(decider.name)} 지도교사에 의해 최종 승인 완료되었습니다. (탑승지: ${finalBoardingLocation})`;

      await this.sendSystemNotification(
        targetAcadId || null,
        'PAYMENT_DECISION',
        notifyTitle,
        notifyText,
        {
          messageId: message.id,
          roomId: message.room.id,
          studentName: payload.studentName,
          decision,
          decidedBy: formatTeacherName(decider.name),
          busNumber: vehicle.busNumber,
          boardingLocation: finalBoardingLocation,
        }
      );

      // 6. Automatically push notification to parent
      try {
        await this.pushParentNotification(message.id, decider.email);
      } catch (err) {
        console.error('Auto push parent notification error:', err);
      }
    } else {
      // REJECTED
      payload.status = 'REJECTED';
      payload.decidedBy = decider.name || decider.email;
      payload.decidedAt = new Date().toISOString();
      message.payload = payload;
      await this.messageRepo.save(message);

      const rejectMsg = this.messageRepo.create({
        room: message.room,
        sender: decider,
        text: `✕ [결재 반려] ${payload.studentName} 원아의 탑승 요청이 반려되었습니다. (처리: ${formatTeacherName(decider.name)})`,
        type: 'TEXT',
        readBy: [decider.id],
      });
      const savedReject = await this.messageRepo.save(rejectMsg);

      await this.broadcastToRoom(message.room.id, message);
      await this.broadcastToRoom(message.room.id, savedReject);

      const targetAcadId = payload.vehicleId ? (await this.vehicleRepo.findOne({ where: { id: payload.vehicleId } }))?.academy?.id : decider.academyId;
      await this.sendSystemNotification(
        targetAcadId || null,
        'PAYMENT_DECISION',
        '결재 반려 알림',
        `[결재 반려] ${payload.studentName} 원아의 탑승 요청이 ${formatTeacherName(decider.name)} 지도교사에 의해 반려되었습니다.`,
        {
          messageId: message.id,
          roomId: message.room.id,
          studentName: payload.studentName,
          decision: 'REJECTED',
          decidedBy: formatTeacherName(decider.name),
        }
      );
    }

    return message;
  }

  async reRequestPayment(
    messageId: number,
    data: {
      suggestedLocation: {
        boardingLocation: string;
        address?: string;
        latitude: number;
        longitude: number;
      };
      note: string;
    },
    proposerEmail: string,
  ) {
    if (!proposerEmail) throw new BadRequestException('제안자 정보가 필요합니다.');
    const proposer = await this.userRepo.findOne({ where: { email: proposerEmail } });
    if (!proposer) throw new BadRequestException('제안자 계정을 찾을 수 없습니다.');

    if (proposer.role === UserRole.PARENT) {
      throw new ForbiddenException('학부모 계정은 재결재 요청 권한이 없습니다.');
    }

    const message = await this.messageRepo.findOne({
      where: { id: Number(messageId) },
      relations: { room: true, sender: true },
    });
    if (!message || message.type !== 'PAYMENT_REQUEST') {
      throw new BadRequestException('결재 신청 메시지를 찾을 수 없습니다.');
    }

    if (message.payload?.status && message.payload.status === 'APPROVED') {
      throw new BadRequestException('이미 승인 완료된 결제 건은 위치를 변경할 수 없습니다.');
    }

    const payload = message.payload || {};
    const originalLocation = {
      boardingLocation: payload.boardingLocation || '원장 지정 탑승지',
      address: payload.address || payload.boardingLocation || '',
      latitude: Number(payload.latitude) || 37.842,
      longitude: Number(payload.longitude) || 127.123,
    };

    const suggested = data.suggestedLocation || {};
    const newLat = Number(suggested.latitude) || originalLocation.latitude;
    const newLng = Number(suggested.longitude) || originalLocation.longitude;
    const newBoardingLocation = suggested.boardingLocation || '지도교사 제안 탑승지';
    const newAddress = suggested.address || newBoardingLocation;

    payload.status = 'RE_REQUESTED';
    payload.counterProposal = {
      originalLocation,
      suggestedLocation: {
        boardingLocation: newBoardingLocation,
        address: newAddress,
        latitude: newLat,
        longitude: newLng,
      },
      note: data.note || '운행 편의 및 안전을 위해 탑승 위치 변경을 제안합니다.',
      proposedBy: proposer.name || proposer.email,
      proposedAt: new Date().toISOString(),
    };

    // Update target coordinates to suggested ones
    payload.boardingLocation = newBoardingLocation;
    payload.address = newAddress;
    payload.latitude = newLat;
    payload.longitude = newLng;
    payload.counterNote = data.note;
    payload.counterProposedBy = proposer.name || proposer.email;

    message.payload = payload;
    message.text = `[탑승지 변경 재결재 요청] ${payload.studentName} 원아 - ${payload.busNumber} 탑승 위치 수정 제안`;
    await this.messageRepo.save(message);

    // Send notification chat message in the room
    const notifyMsg = this.messageRepo.create({
      room: message.room,
      sender: proposer,
      text: `🔄 [탑승지 변경 재결재 요청] ${payload.studentName} 원아 탑승지를 ${proposer.name} 지도교사가 수정 제안하였습니다.\n(사유: ${data.note || '위치 변경'})`,
      type: 'TEXT',
      readBy: [proposer.id],
    });
    const savedNotify = await this.messageRepo.save(notifyMsg);

    await this.broadcastToRoom(message.room.id, message);
    await this.broadcastToRoom(message.room.id, savedNotify);

    return { success: true, message };
  }

  async pushParentNotification(messageId: number, senderEmail?: string) {
    const message = await this.messageRepo.findOne({
      where: { id: Number(messageId) },
      relations: { room: true },
    });
    if (!message || message.type !== 'PAYMENT_REQUEST') {
      throw new BadRequestException('결재 신청 메시지를 찾을 수 없습니다.');
    }

    const payload = message.payload || {};
    const studentId = payload.studentId;
    if (!studentId) {
      throw new BadRequestException('연결된 원아 정보가 없습니다.');
    }

    const student = await this.studentRepo.findOne({
      where: { id: Number(studentId) },
      relations: { parentUser: true, assignedVehicle: true },
    });
    if (!student) {
      throw new BadRequestException('원아를 찾을 수 없습니다.');
    }

    const finalLocation = payload.counterProposal?.suggestedLocation?.boardingLocation || payload.boardingLocation || student.boardingLocation || '지정 하차지';
    const busName = payload.busNumber || student.assignedVehicle?.busNumber || '셔틀 차량';
    const teacherName = payload.teacherName || '담당 지도교사';
    const isTodayOnly = (payload.rideType || 'TODAY_ONLY') === 'TODAY_ONLY';

    let notiText = '';
    if (payload.status === 'RE_REQUESTED' || payload.counterProposal) {
      const reason = payload.counterProposal?.note || '안전 승하차 위치 조정';
      notiText = `[통학 셔틀 하차지 안내] 오늘 ${student.adminDisplayName || student.name} 원아는 [${busName}]을(를) 이용하여 [${finalLocation}]에서 하차합니다. (사유: ${reason}, 지도교사: ${teacherName})`;
    } else {
      notiText = isTodayOnly
        ? `[오늘 하원 셔틀 안내] 오늘 ${student.adminDisplayName || student.name} 원아가 [${busName}]에 임시 탑승하여 [${finalLocation}]에서 하차할 예정입니다. (지도교사: ${teacherName})`
        : `[정규 셔틀 탑승 안내] ${student.adminDisplayName || student.name} 원아가 [${busName}] 정규 셔틀을 이용하며 [${finalLocation}]에서 하차 예정입니다. (지도교사: ${teacherName})`;
    }

    // 1. Create ParentMessage
    if (student.parentUser) {
      const parentMsg = this.parentMessageRepo.create({
        student,
        receiverUser: student.parentUser,
        targetRoles: ['PARENT'],
        message: notiText,
      });
      await this.parentMessageRepo.save(parentMsg);
    }

    // 2. Create Vehicle Notification
    const vehicle = student.assignedVehicle || (payload.vehicleId ? await this.vehicleRepo.findOne({ where: { id: Number(payload.vehicleId) } }) : null);
    if (vehicle) {
      const vNoti = this.notificationRepo.create({
        vehicle,
        message: notiText,
      });
      await this.notificationRepo.save(vNoti);
    }

    // 3. Mark parentPushedAt on payment message
    payload.parentPushedAt = new Date().toISOString();
    payload.parentPushText = notiText;
    message.payload = payload;
    await this.messageRepo.save(message);

    // 4. Broadcast updated message
    if (message.room) {
      await this.broadcastToRoom(message.room.id, message);
    }

    return {
      success: true,
      message: '학부모 알림 푸시가 성공적으로 전송되었습니다.',
      pushedAt: payload.parentPushedAt,
      pushText: notiText,
      hasParentAccount: !!student.parentUser,
    };
  }
}
