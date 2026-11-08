import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, Unique, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Student } from './student.entity';
import { User } from './user.entity';

export enum AttendanceStatus {
  PRESENT = 'PRESENT',
  ABSENT = 'ABSENT',
  LATE = 'LATE',
  EARLY_LEAVE = 'EARLY_LEAVE',
}

@Entity('attendances')
@Unique(['student', 'date'])
export class Attendance {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  student: Student;

  @Column({ type: 'varchar', length: 10 })
  date: string; // YYYY-MM-DD

  @Column({ type: 'varchar', length: 20, default: AttendanceStatus.PRESENT })
  status: AttendanceStatus;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  recordedBy: User;

  @Column({ type: 'varchar', length: 100, nullable: true })
  recordedByName: string;

  @Column({ type: 'varchar', nullable: true })
  memo: string;

  @CreateDateColumn()
  recordedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
