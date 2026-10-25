import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { Academy } from './academy.entity';

@Entity('academy_holidays')
export class AcademyHoliday {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  startDate: string; // YYYY-MM-DD

  @Column({ type: 'date' })
  endDate: string; // YYYY-MM-DD

  @Column({ type: 'text', nullable: true })
  reason: string;

  @ManyToOne(() => Academy, { nullable: true, onDelete: 'CASCADE' })
  academy: Academy;

  @CreateDateColumn()
  createdAt: Date;
}
