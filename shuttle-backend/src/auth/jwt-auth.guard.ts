import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ROLES_KEY, JwtPayload } from './auth-user.decorator';
import { User } from '../entities/user.entity';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('로그인이 필요합니다.');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(header.slice(7));
    } catch {
      throw new UnauthorizedException('로그인이 만료되었거나 올바르지 않습니다. 다시 로그인해 주세요.');
    }

    // 1. Database User validation & Single Session / Lock check
    const user = await this.usersRepository.findOne({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('존재하지 않는 사용자입니다.');
    }

    // 2. Account lock check
    if (user.isLocked) {
      throw new ForbiddenException('로그인 또는 인증번호 5회 실패로 계정이 잠겼습니다. 원장님에게 잠금 해제를 요청해 주세요.');
    }

    // 3. Single session (Concurrent login prevention) check
    if (payload.sessionId && user.currentSessionToken && payload.sessionId !== user.currentSessionToken) {
      throw new UnauthorizedException('다른 기기 또는 브라우저에서 로그인되어 현재 접속이 종료되었습니다. 다시 로그인해 주세요.');
    }

    req.user = payload;
    req.dbUser = user;

    // 4. Role-based Access Control (RBAC)
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0 && !roles.includes(payload.role)) {
      if (roles.includes('TEACHER') && (payload.role === 'HOMEROOM_TEACHER' || payload.role === 'SHUTTLE_TEACHER')) {
        // Allow both homeroom and shuttle teachers for teacher endpoints
      } else {
        throw new ForbiddenException('이 기능을 사용할 권한이 없습니다.');
      }
    }

    return true;
  }
}
