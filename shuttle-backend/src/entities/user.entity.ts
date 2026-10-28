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

  @Column({ nullable: true, transformer: encryptionTransformer })
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

  @Column({ type: 'varchar', nullable: true })
  currentSessionToken: string | null;

  @Column({ type: 'varchar', nullable: true })
  refreshToken: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
