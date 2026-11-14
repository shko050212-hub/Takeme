import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { encryptionTransformer } from '../utils/crypto.util';
import { Academy } from './academy.entity';

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ACADEMY_ADMIN = 'ACADEMY_ADMIN',
  STUDENT = 'STUDENT',
  PARENT = 'PARENT',
  DRIVER = 'DRIVER',
  TEACHER = 'TEACHER',
  HOMEROOM_TEACHER = 'HOMEROOM_TEACHER',
  SHUTTLE_TEACHER = 'SHUTTLE_TEACHER',
  DESK_STAFF = 'DESK_STAFF',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', default: UserRole.STUDENT })
  role: UserRole;

  @Column({ nullable: true })
  name: string;

  @Column({ type: 'varchar', nullable: true, transformer: encryptionTransformer })
  phone: string | null;

  @Column({ nullable: true })
  assignedClass: string; // 유치원 담당 반 (예: 햇살반)

  @ManyToOne(() => Academy, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'academyId' })
  academy: Academy;

  @Column({ nullable: true })
  academyId: number;

  @Column({ nullable: true, transformer: encryptionTransformer })
  otpSecret: string; // Google OTP secret (AES-256-GCM encrypted)

  @Column({ default: false })
  isOtpEnabled: boolean;

  @Column({ default: 0 })
  failedLoginAttempts: number;

  @Column({ default: false })
  isLocked: boolean;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt: Date | null;

  @Column({ default: 'APPROVED' })
  approvalStatus: string; // PENDING, APPROVED, UNREGISTERED

  @Column({ type: 'varchar', nullable: true })
  currentSessionToken: string | null;

  @Column({ type: 'varchar', nullable: true })
  refreshToken: string | null;

  @Column({ type: 'simple-array', nullable: true })
  readNotificationKeys: string[];

  @Column({ default: true })
  notifyShuttleOperation: boolean; // 기사 운행 알림 수신 여부 (기본 켜짐)

  @Column({ default: true })
  notifyBoardPost: boolean; // 기존 알림장/게시물 통합 알림 수신 여부 (호환용)

  @Column({ default: true })
  notifyNotice: boolean; // 새 알림장 알림 수신 여부 (기본 켜짐)

  @Column({ default: true })
  notifyPost: boolean; // 새 게시물 알림 수신 여부 (기본 켜짐)

  @Column({ type: 'simple-json', nullable: true })
  notificationSettings: Record<string, boolean> | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
