import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Student } from './student.entity';
import { Vehicle } from './vehicle.entity';

@Entity('student_schedules')
export class StudentSchedule {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => Student, student => student.schedules, { onDelete: 'CASCADE' })
  student: Student;

  @Column()
  type: string; // 'BOARDING' | 'ALIGHTING'

  @Column()
  dayOfWeek: string; // 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'

  @Column()
  address: string;

  @Column({ type: 'float', nullable: true })
  latitude: number;

  @Column({ type: 'float', nullable: true })
  longitude: number;

  @Column({ default: false })
  isCustomLocation: boolean; // Indicates if this is a parent-requested custom location

  @ManyToOne(() => Vehicle, { nullable: true, onDelete: 'SET NULL' })
  assignedVehicle: Vehicle;
}
