import { Controller, Post, Body, Delete, Query, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('email/send')
  sendEmail(@Body('email') email: string, @Body('type') type?: 'register' | 'withdraw') {
    return this.authService.sendEmailVerification(email, type);
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
  async verifyOtpSetup(@Body() body: { userId: number, token: string }) {
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
}
