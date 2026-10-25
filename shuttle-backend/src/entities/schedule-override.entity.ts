import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, CreateDateColumn } from 'typeorm';
import { Student } from './student.entity';

export enum OverrideType {
  ABSENCE = 'ABSENCE',
  CHANGE_LOCATION = 'CHANGE_LOCATION',
}

@Entity('schedule_overrides')
export class ScheduleOverride {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, { onDelete: 'CASCADE' })
  student: Student;

  @Column({ type: 'date' })
  startDate: string; // YYYY-MM-DD

  @Column({ type: 'date' })
  endDate: string; // YYYY-MM-DD

  @Column({ type: 'varchar' })
  overrideType: OverrideType;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ type: 'varchar', nullable: true })
  newAddress: string;

  @Column({ type: 'float', nullable: true })
  latitude: number;

  @Column({ type: 'float', nullable: true })
  longitude: number;

  @Column({ type: 'int', nullable: true })
  newVehicleId: number;

  @CreateDateColumn()
  createdAt: Date;
}
