import { Entity, PrimaryGeneratedColumn, ManyToOne, CreateDateColumn } from 'typeorm';
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

  @CreateDateColumn()
  joinedAt: Date;
}
