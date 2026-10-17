import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  // API 명세 자동 문서: http://서버주소:3000/api-docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Takeme API')
    .setDescription('학원·유치원 셔틀버스 관리 API (앱·웹 공용)')
    .setVersion('1.0')
    .addBearerAuth() // 문서 화면 오른쪽 위 Authorize 버튼에 토큰을 넣고 테스트 가능
    .build();
  SwaggerModule.setup('api-docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const webDistPath = join(process.cwd(), '..', 'shuttle-web', 'dist');
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        // API 경로는 웹 화면(index.html)으로 넘기지 않음
        // (기존에는 /teacher, /chat, /approval 의 GET 요청까지 index.html 이 응답되던 문제 수정)
        const apiPrefixes = ['/routing', '/auth', '/parent', '/teacher', '/chat', '/approval', '/api-docs', '/socket.io', '/directions'];
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

