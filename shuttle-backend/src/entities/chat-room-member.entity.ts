import { Entity, PrimaryGeneratedColumn, ManyToOne, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ChatRoom } from './chat-room.entity';
import { User } from './user.entity';

@Entity('chat_room_members')
export class ChatRoomMember {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChatRoom, room => room.members, { onDelete: 'CASCADE' })
  room: ChatRoom;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'timestamp', nullable: true })
  lastReadAt: Date;

  @CreateDateColumn()
  joinedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
