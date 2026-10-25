import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { BoardPost } from './board-post.entity';

@Entity('board_comments')
export class BoardComment {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => BoardPost, (post) => post.comments, { onDelete: 'CASCADE' })
  post: BoardPost;

  @Column({ type: 'varchar', length: 100, default: '원장선생님' })
  authorName: string;

  @Column({ type: 'varchar', length: 50, default: 'ADMIN' })
  authorRole: string;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}
