import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { Academy } from './academy.entity';
import { BoardComment } from './board-comment.entity';

@Entity('board_posts')
export class BoardPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  imageUrl: string;

  @Column({ type: 'json', nullable: true })
  images: string[];

  @Column({ type: 'varchar', length: 100, default: '원장선생님' })
  authorName: string;

  @Column({ type: 'varchar', length: 50, default: 'ADMIN' })
  authorRole: string;

  @Column({ type: 'varchar', length: 20, default: 'ALL' })
  visibility: string; // 'ALL' | 'CLASS'

  @Column({ type: 'varchar', length: 100, nullable: true })
  targetClass: string; // e.g. '햇살반'

  @Column({ type: 'int', default: 0 })
  likeCount: number;

  @Column({ type: 'json', nullable: true })
  likedUserIds: string[];

  @OneToMany(() => BoardComment, (comment) => comment.post, { cascade: true, onDelete: 'CASCADE' })
  comments: BoardComment[];

  @ManyToOne(() => Academy, { nullable: true, onDelete: 'CASCADE' })
  academy: Academy;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
