import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Student } from './student.entity';

export enum ApprovalDirection {
  PARENT_TO_TEACHER = 'PARENT_TO_TEACHER',
  TEACHER_TO_PARENT = 'TEACHER_TO_PARENT',
}

export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('approval_requests')
export class ApprovalRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  student: Student;

  @Column({ type: 'float' })
  latitude: number;

  @Column({ type: 'float' })
  longitude: number;

  @Column({ type: 'varchar' })
  address: string;

  @Column({ type: 'varchar', nullable: true })
  zipCode: string;

  @Column({ type: 'varchar', nullable: true })
  time: string;

  @Column({ type: 'text', nullable: true })
  message: string;

  @Column({ type: 'date', nullable: true })
  startDate: string; // YYYY-MM-DD

  @Column({ type: 'date', nullable: true })
  endDate: string; // YYYY-MM-DD

  @Column({ type: 'varchar' })
  direction: ApprovalDirection;

  @Column({ type: 'varchar', default: ApprovalStatus.PENDING })
  status: ApprovalStatus;

  @CreateDateColumn()
  createdAt: Date;
}
