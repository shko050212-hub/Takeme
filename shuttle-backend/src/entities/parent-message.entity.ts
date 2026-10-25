import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Student } from './student.entity';

import { User } from './user.entity';

@Entity('parent_messages')
export class ParentMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE', nullable: true })
  student: Student;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  receiverUser: User;

  @Column({ type: 'simple-array' })
  targetRoles: string[]; // e.g. ['ACADEMY_ADMIN', 'DRIVER', 'TEACHER']

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'boolean', default: false })
  isRead: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
