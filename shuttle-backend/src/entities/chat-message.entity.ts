import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { ChatRoom } from './chat-room.entity';
import { User } from './user.entity';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => ChatRoom, room => room.messages, { onDelete: 'CASCADE' })
  room: ChatRoom;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  sender: User | null;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', default: 'TEXT' })
  type: string; // 'TEXT' | 'PAYMENT_REQUEST'

  @Column({ type: 'simple-json', nullable: true })
  payload: any;

  @Column({ type: 'simple-array', nullable: true })
  readBy: number[]; // Array of User IDs

  @Column({ length: 50, nullable: true })
  messageType?: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: any;

  @CreateDateColumn()
  createdAt: Date;
}
