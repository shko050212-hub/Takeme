import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Vehicle } from './vehicle.entity';

@Entity('operation_logs')
export class OperationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Vehicle, { onDelete: 'CASCADE' })
  vehicle: Vehicle;

  @Column({ type: 'date' })
  dateString: string; // YYYY-MM-DD

  @Column({ type: 'timestamp', nullable: true })
  startTime: Date;

  @Column({ type: 'timestamp', nullable: true })
  endTime: Date;

  @Column({ type: 'simple-json', nullable: true })
  boardingRecords: any; // e.g. [{ studentId, studentName, boardTime, method }]
}
