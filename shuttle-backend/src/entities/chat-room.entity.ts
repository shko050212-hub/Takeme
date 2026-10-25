import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ChatRoomMember } from './chat-room-member.entity';
import { ChatMessage } from './chat-message.entity';

export enum ChatRoomType {
  STAFF = 'STAFF',
  STUDENT = 'STUDENT',
}

@Entity('chat_rooms')
export class ChatRoom {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column({ type: 'varchar', default: ChatRoomType.STAFF })
  type: ChatRoomType;

  @OneToMany(() => ChatRoomMember, member => member.room, { cascade: true })
  members: ChatRoomMember[];

  @OneToMany(() => ChatMessage, message => message.room, { cascade: true })
  messages: ChatMessage[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
