import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // API 명세 자동 문서: http://서버주소:3000/api-docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Takeme API')
    .setDescription('학원·유치원 셔틀버스 관리 API (앱·웹 공용)')
    .setVersion('1.0')
    .addBearerAuth() // 문서 화면 오른쪽 위 Authorize 버튼에 토큰을 넣고 테스트 가능
    .build();
  SwaggerModule.setup('api-docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  // 정적 클라우드 미디어 업로드 서빙 (/uploads/*)
  const uploadsPath = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsPath)) {
    mkdirSync(uploadsPath, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsPath));

  const webDistPath = join(process.cwd(), '..', 'shuttle-web', 'dist');
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        // API 및 정적 업로드 경로는 웹 화면(index.html)으로 넘기지 않음
        const apiPrefixes = ['/routing', '/auth', '/parent', '/teacher', '/chat', '/approval', '/api-docs', '/socket.io', '/directions', '/uploads'];
        if (req.method === 'GET' && !apiPrefixes.some((p) => req.path.startsWith(p))) {
          res.sendFile(join(webDistPath, 'index.html'));
        } else {
          next();
        }
      },
    );
  }

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
