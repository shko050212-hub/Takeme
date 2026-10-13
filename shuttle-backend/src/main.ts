import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

  const webDistPath = join(process.cwd(), '..', 'shuttle-web', 'dist');
  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    app.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        if (
          req.method === 'GET' &&
          !req.path.startsWith('/routing') &&
          !req.path.startsWith('/auth') &&
          !req.path.startsWith('/parent')
        ) {
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

