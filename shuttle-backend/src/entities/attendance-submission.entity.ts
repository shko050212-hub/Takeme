import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Unique, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Academy } from './academy.entity';
import { User } from './user.entity';

@Entity('attendance_submissions')
@Unique(['academy', 'className', 'date'])
export class AttendanceSubmission {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Academy, { onDelete: 'CASCADE' })
  academy: Academy;

  @Column({ type: 'varchar', length: 100 })
  className: string;

  @Column({ type: 'varchar', length: 10 })
  date: string; // YYYY-MM-DD

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  teacher: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  teacherName: string;

  @Column({ type: 'int', default: 0 })
  totalCount: number;

  @Column({ type: 'int', default: 0 })
  presentCount: number;

  @Column({ type: 'int', default: 0 })
  absentCount: number;

  @Column({ type: 'int', default: 0 })
  lateCount: number;

  @Column({ type: 'int', default: 0 })
  earlyLeaveCount: number;

  @CreateDateColumn()
  submittedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
