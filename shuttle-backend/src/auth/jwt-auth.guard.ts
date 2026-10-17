import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ROLES_KEY, JwtPayload } from './auth-user.decorator';

/**
 * Authorization: Bearer <토큰> 헤더를 검사해서 req.user 에 로그인 사용자 정보를 넣는다.
 * @Roles(...) 가 붙어 있으면 역할까지 확인한다.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
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
    req.user = payload;

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && roles.length > 0 && !roles.includes(payload.role)) {
      throw new ForbiddenException('이 기능을 사용할 권한이 없습니다.');
    }
    return true;
  }
}
