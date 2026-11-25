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

  // 댓글을 쓴 계정 (본인 댓글만 지울 수 있게 확인용). 예전 댓글은 비어 있다.
  @Column({ type: 'int', nullable: true })
  authorUserId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
