import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  userId: number;

  @Column({ nullable: true })
  userEmail: string;

  @Column({ nullable: true })
  userName: string;

  @Column()
  action: string; // 'EXCEL_EXPORT', 'ACCOUNT_UNLOCK', 'STUDENT_APPROVE', 'STUDENT_REVOKE', 'STAFF_APPROVE', 'STAFF_REVOKE', etc.

  @Column({ nullable: true })
  targetType: string;

  @Column({ nullable: true })
  targetId: string;

  @Column({ nullable: true })
  ipAddress: string;

  @Column({ type: 'text', nullable: true })
  details: string;

  @CreateDateColumn()
  createdAt: Date;
}
