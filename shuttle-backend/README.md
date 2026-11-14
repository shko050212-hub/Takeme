<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## 개발용 로컬 데이터베이스 (PostgreSQL) 분리 안내

팀 공용 실제 운영 DB(AWS RDS)는 `synchronize: true` 설정 시 엔티티 변경에 따라 스키마가 즉시 변경될 위험이 있습니다. 따라서 **로컬 개발 시에는 개발용 PostgreSQL(Docker 또는 로컬 설치)을 사용**합니다.

### 1. 개발용 DB 실행 방법 (Docker Compose 활용)
```bash
# shuttle-backend 디렉터리에서 로컬 PostgreSQL 컨테이너 시작
$ docker compose -f docker-compose.dev.yml up -d
```
또는 직접 Docker 명령 실행:
```bash
$ docker run --name takeme-dev-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=takeme_dev -p 5432:5432 -d postgres:15-alpine
```

### 2. .env.development 파일 생성 및 적용
`shuttle-backend/.env.development.example` 파일을 복사하여 `.env.development`를 만듭니다:
```bash
$ cp .env.development.example .env.development
```

### 3. 기존 게시글 사진을 사진 보관함(MediaAsset)으로 동기화 마이그레이션
기존 알림장 및 게시판에 업로드되었던 사진들을 사진 보관함(MediaAsset)으로 동기화하려면 다음 명령어를 실행합니다:
```bash
# shuttle-backend 디렉터리에서 실행
$ npm run sync:board-media
```
* 이 작업은 중복 삽입을 방지하며, 아직 보관함에 등록되지 않은 게시글 사진들만 `sourceType`('NOTICE' 또는 'BOARD')과 함께 안전하게 마이그레이션합니다.


내용 예시:
```env
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=takeme_dev
DB_SSL=false
```

NestJS 실행 시 `.env.development` 파일이 있으면 실제 RDS 접속 정보 대신 로컬 개발 DB를 최우선으로 바라보므로 안전하게 엔티티 및 스키마 변경 작업을 진행할 수 있습니다.

### 3. 개발 DB 데이터 마이그레이션 스크립트 (개발 전용)

> [!CAUTION]
> 아래 마이그레이션 스크립트는 **로컬 개발용 DB(`takeme_dev`)에서만 확인 및 실행**해야 합니다. 운영 DB(Production RDS)에는 직접 실행하지 마십시오.

#### 알림장 게시글 작성자 역할(authorRole) 정정 스크립트
과거 게시글의 `authorRole`이 '지도교사' 등으로 저장된 경우, 작성자 계정(`authorUserId`)의 실제 현재 역할(`user.role`)로 정정합니다:
```bash
# shuttle-backend 디렉터리에서 로컬 개발 DB 대상으로 실행
$ npx ts-node -r dotenv/config scripts/migrate_board_author_role.ts dotenv_config_path=.env.development
```

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
