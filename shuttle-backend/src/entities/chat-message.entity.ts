import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { ChatRoom } from './chat-room.entity';
import { User } from './user.entity';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChatRoom, room => room.messages, { onDelete: 'CASCADE' })
  room: ChatRoom;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  sender: User;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'simple-array', nullable: true })
  readBy: number[]; // Array of User IDs

  @CreateDateColumn()
  createdAt: Date;
}
