import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Academy } from './academy.entity';

@Entity()
export class PickupPoint {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column('float')
  latitude: number;

  @Column('float')
  longitude: number;

  @ManyToOne(() => Academy, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'academy_id' })
  academy: Academy;

  @CreateDateColumn()
  createdAt: Date;
}
