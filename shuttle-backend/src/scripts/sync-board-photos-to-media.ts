import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardPost } from '../entities/board-post.entity';
import { MediaAsset } from '../entities/media-asset.entity';
import { resolveMediaRef } from '../utils/s3.util';

async function bootstrap() {
  console.log('게시글 사진 -> 사진 보관함 동기화 작업 시작...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const boardPostRepo: Repository<BoardPost> = app.get(getRepositoryToken(BoardPost));
  const mediaRepo: Repository<MediaAsset> = app.get(getRepositoryToken(MediaAsset));

  const posts = await boardPostRepo.find({ relations: { academy: true } });
  console.log(`총 ${posts.length}개의 게시글을 확인합니다.`);

  let createdCount = 0;

  for (const post of posts) {
    if (!post.academy?.id) continue;

    const refs: string[] = [];
    if (post.imageUrl) refs.push(post.imageUrl);
    if (Array.isArray(post.images)) {
      for (const img of post.images) {
        if (img && !refs.includes(img)) refs.push(img);
      }
    }

    if (refs.length === 0) continue;

    const sourceType = post.targetClass ? 'NOTICE' : 'BOARD';

    for (const ref of refs) {
      const existing = await mediaRepo.findOne({
        where: { postId: post.id, storageKey: ref },
      });
      if (!existing) {
        const asset = mediaRepo.create({
          academyId: post.academy.id,
          uploaderId: post.authorUserId || 0,
          uploaderName: post.authorName || '작성자',
          uploaderRole: post.authorRole || 'ADMIN',
          storageKey: ref,
          filename: ref.split('/').pop() || 'photo.jpg',
          sourceType,
          postId: post.id,
          className: post.targetClass || null,
          createdAt: post.createdAt || new Date(),
        });
        await mediaRepo.save(asset);
        createdCount++;
      }
    }
  }

  console.log(`동기화 완료: ${createdCount}개의 사진 기록이 생성되었습니다.`);
  await app.close();
}

bootstrap().catch(err => {
  console.error('동기화 실패:', err);
  process.exit(1);
});
