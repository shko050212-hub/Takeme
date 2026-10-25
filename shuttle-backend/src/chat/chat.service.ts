import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ChatRoom, ChatRoomType } from '../entities/chat-room.entity';
import { ChatRoomMember } from '../entities/chat-room-member.entity';
import { ChatMessage } from '../entities/chat-message.entity';
import { User, UserRole } from '../entities/user.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRoom) private roomRepo: Repository<ChatRoom>,
    @InjectRepository(ChatRoomMember) private memberRepo: Repository<ChatRoomMember>,
    @InjectRepository(ChatMessage) private messageRepo: Repository<ChatMessage>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  async getRoomsByEmail(email: string, type?: string) {
    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) return [];
    const userId = user.id;

    const query = this.roomRepo.createQueryBuilder('room')
      .innerJoin('room.members', 'member')
      .leftJoinAndSelect('room.members', 'allMembers')
      .leftJoinAndSelect('allMembers.user', 'user')
      .where('member.userId = :userId', { userId });
      
    if (type) {
      query.andWhere('room.type = :type', { type });
    }

    const rooms = await query.getMany();

    // Attach latest message for each room
    for (const room of rooms) {
      const latestMessage = await this.messageRepo.findOne({
        where: { room: { id: room.id } },
        order: { createdAt: 'DESC' },
        relations: { sender: true },
      });
      (room as any).latestMessage = latestMessage;
    }

    return rooms;
  }

  async getMessages(roomId: number) {
    return this.messageRepo.find({
      where: { room: { id: roomId } },
      order: { createdAt: 'ASC' },
      relations: { sender: true },
    });
  }

  async createRoomByEmail(name: string, type: ChatRoomType, userIds: number[], creatorEmail: string) {
    userIds = userIds || [];
    
    if (userIds.length === 0) {
      const admin = await this.userRepo.findOne({ where: { role: UserRole.ACADEMY_ADMIN } });
      if (admin) {
        userIds.push(admin.id);
      }
    }

    const creator = await this.userRepo.findOne({ where: { email: creatorEmail } });
    if (creator && !userIds.includes(creator.id)) {
      userIds.push(creator.id);
    }

    // Check if it's a 1:1 chat and if it already exists
    if (userIds.length === 2) {
      const existingRooms = await this.roomRepo.createQueryBuilder('room')
        .innerJoin('room.members', 'm1', 'm1.userId = :u1', { u1: userIds[0] })
        .innerJoin('room.members', 'm2', 'm2.userId = :u2', { u2: userIds[1] })
        .where('room.type = :type', { type })
        .getMany();
        
      if (existingRooms.length > 0) {
        // Just check if it has exactly 2 members
        for (const room of existingRooms) {
          const membersCount = await this.memberRepo.count({ where: { room: { id: room.id } } });
          if (membersCount === 2) {
            return room;
          }
        }
      }
    }

    const room = this.roomRepo.create({ name, type });
    await this.roomRepo.save(room);

    const members = userIds.map(userId => this.memberRepo.create({
      room,
      user: { id: userId },
    }));
    await this.memberRepo.save(members);

    return room;
  }

  async sendMessage(roomId: number, senderId: number, text: string) {
    const message = this.messageRepo.create({
      room: { id: roomId },
      sender: { id: senderId },
      text,
      readBy: [senderId],
    });
    return this.messageRepo.save(message);
  }

  async sendMessageByEmail(roomId: number, senderEmail: string, text: string) {
    const user = await this.userRepo.findOne({ where: { email: senderEmail } });
    if (!user) return null;
    const message = this.messageRepo.create({
      room: { id: roomId },
      sender: { id: user.id },
      text,
      readBy: [user.id],
    });
    return this.messageRepo.save(message);
  }
}
