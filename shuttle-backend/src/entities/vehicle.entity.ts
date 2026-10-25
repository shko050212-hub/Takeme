import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToOne, JoinColumn } from 'typeorm';
import { Academy } from './academy.entity';
import { User } from './user.entity';
import { encryptionTransformer } from '../utils/crypto.util';

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  busNumber: string;

  @Column({ nullable: true })
  plateNumber: string;

  @Column({ default: '미정' })
  driverName: string;

  @Column({ default: '000-0000-0000', transformer: encryptionTransformer })
  driverPhone: string;

  @Column({ default: '미정' })
  teacherName: string;

  @Column({ default: '000-0000-0000', transformer: encryptionTransformer })
  teacherPhone: string;

  @Column({ type: 'int', default: 25 })
  capacity: number; // Seats available

  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  driverUser: User;

  @OneToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn()
  teacherUser: User;

  @Column({ nullable: true })
  colorHex: string; // Polygon color #ef4444

  @Column({ default: 'UNREGISTERED' })
  driverApprovalStatus: string; // PENDING, APPROVED, UNREGISTERED

  @Column({ default: 'UNREGISTERED' })
  teacherApprovalStatus: string; // PENDING, APPROVED, UNREGISTERED

  @Column({ type: 'simple-json', nullable: true })
  polygonCoordinates: any; // e.g. [[lat, lng], [lat, lng]]

  @ManyToOne(() => Academy, (academy) => academy.id, { onDelete: 'CASCADE' })
  academy: Academy;
}
