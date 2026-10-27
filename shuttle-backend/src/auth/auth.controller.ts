import { Controller, Post, Body, Delete, Query, BadRequestException, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/send')
  sendEmail(@Req() req: Request, @Body('email') email: string, @Body('type') type?: 'register' | 'withdraw') {
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || '127.0.0.1';
    return this.authService.sendEmailVerification(email, rawIp, type);
  }

  @Post('email/verify')
  verifyEmail(@Body() body: { email: string; code: string }) {
    return this.authService.verifyEmailCode(body.email, body.code);
  }

  @Post('verify-auth-code')
  verifyAuthCode(@Body('authCode') authCode: string) {
    return this.authService.verifyAuthCode(authCode);
  }

  @Post('register')
  register(@Body() body: any) {
    return this.authService.register(body);
  }

  @Post('otp/verify')
  async verifyOtpSetup(@Body() body: { userId: number; token: string }) {
    return this.authService.verifyOtpSetup(body.userId, body.token);
  }

  @Delete('account')
  async deleteAccount(@Query('email') email: string) {
    if (!email) throw new BadRequestException('이메일이 필요합니다.');
    return this.authService.deleteAccount(email);
  }

  @Post('login')
  login(@Body() body: any) {
    return this.authService.login(body);
  }

  @Post('refresh')
  refresh(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @Post('self-unlock/send')
  sendSelfUnlock(@Req() req: Request, @Body('email') email: string) {
    const rawIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || '127.0.0.1';
    return this.authService.sendSelfUnlockCode(email, rawIp);
  }

  @Post('self-unlock/verify')
  verifySelfUnlock(@Body() body: { email: string; code: string }) {
    return this.authService.verifySelfUnlockCode(body.email, body.code);
  }
}
