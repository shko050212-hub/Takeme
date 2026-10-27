import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

/** 토큰 안에 들어가는 정보 */
export interface JwtPayload {
  sub: number; // user id
  email: string;
  role: string;
  academyId: number | null;
  sessionId?: string;
}

export const ROLES_KEY = 'roles';
/** @Roles('PARENT', 'STUDENT') 처럼 접근 가능한 역할 지정 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** 토큰에서 꺼낸 로그인 사용자 전체 정보 */
export const AuthUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => ctx.switchToHttp().getRequest().user,
);

/** 토큰에서 꺼낸 로그인 사용자 이메일 (기존 @Body('email') / @Query('email') 대체) */
export const AuthEmail = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest().user?.email,
);
