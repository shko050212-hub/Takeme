import { normalizePhone, maskPhone, sendSmsNotification } from '../utils/sms.util';
import { Injectable, BadRequestException, UnauthorizedException, HttpException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { User, UserRole } from '../entities/user.entity';
import { Academy } from '../entities/academy.entity';
import { Student } from '../entities/student.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  private verificationCodes = new Map<string, { code: string, expiresAt: number }>();
  private emailRateLimits = new Map<string, { count: number, resetAt: number }>();
  private smsVerificationCodes = new Map<string, { code: string; phone: string; expiresAt: number }>();
  private transporter: any = null;

  constructor(
    @InjectRepository(User) private usersRepository: Repository<User>,
    @InjectRepository(Academy) private academyRepository: Repository<Academy>,
    @InjectRepository(Student) private studentRepository: Repository<Student>,
    @InjectRepository(Vehicle) private vehicleRepository: Repository<Vehicle>,
    private readonly jwtService: JwtService,
  ) {}

  private async getTransporter() {
    if (!this.transporter) {
      const nodemailer = require('nodemailer');
      if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_PASS,
          },
        });
        console.log('Gmail SMTP transport initialized');
      } else {
        const testAccount = await nodemailer.createTestAccount();
        this.transporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: { user: testAccount.user, pass: testAccount.pass },
        });
        console.log('Ethereal Email account created:', testAccount.user);
      }
    }
    return this.transporter;
  }

  async sendEmailVerification(email: string, clientIp: string = '127.0.0.1', type: 'register' | 'withdraw' = 'register') {
    // IP 기반 발송 빈도 제한 (15분 동안 동일 IP당 최대 10회)
    const now = Date.now();
    const windowMs = 15 * 60 * 1000;
    const limit = 10;

    const ipRecord = this.emailRateLimits.get(clientIp);
    if (ipRecord) {
      if (now < ipRecord.resetAt) {
        if (ipRecord.count >= limit) {
          const remainingMinutes = Math.max(1, Math.ceil((ipRecord.resetAt - now) / 60000));
          throw new HttpException(
            `해당 IP에서 단시간에 너무 많은 이메일 인증 요청이 발생했습니다. ${remainingMinutes}분 후 다시 시도해 주세요.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        ipRecord.count += 1;
      } else {
        this.emailRateLimits.set(clientIp, { count: 1, resetAt: now + windowMs });
      }
    } else {
      this.emailRateLimits.set(clientIp, { count: 1, resetAt: now + windowMs });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 3 * 60 * 1000;
    this.verificationCodes.set(email, { code, expiresAt });

    const nodemailer = require('nodemailer');

    try {
      const transporter = await this.getTransporter();
      const info = await transporter.sendMail({
        from: '"Takeme System" <noreply@takeme.com>',
        to: email,
        subject: 'Takeme 회원가입 인증 코드입니다.',
        html: `
          <div style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
            <div style="padding: 32px; background-color: #ffffff;">
              <h2 style="color: #1e40af; margin-top: 0; font-size: 24px;">환영합니다!</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">
                Takeme에 가입을 진행해 주셔서 감사합니다.<br/>원장선생님의 유치원 안심 통학차량 관리를 스마트하고 안전하게 돕겠습니다.
              </p>
              <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 24px; text-align: center; margin: 32px 0;">
                <p style="margin: 0; color: #64748b; font-size: 14px; margin-bottom: 8px;">인증코드 6자리</p>
                <h1 style="margin: 0; color: #0f172a; font-size: 36px; letter-spacing: 4px;">${code}</h1>
              </div>
              <p style="color: #dc2626; font-size: 14px; text-align: center; font-weight: bold;">
                [안내] 본 코드는 3분 안에 입력해주셔야 합니다.
              </p>
              <p style="color: #475569; font-size: 15px; text-align: center; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 24px;">
                Takeme의 가족이 된 것을 다시 한 번 진심으로 감사드립니다!<br/>
                <span style="font-size: 13px; color: #94a3b8;">© 2026 Takeme Shuttle Service</span>
              </p>
            </div>
          </div>
        `
      });
      
      const testUrl = nodemailer.getTestMessageUrl(info);
      if (testUrl) {
        console.log(`[TEST EMAIL URL]: ${testUrl}`);
      }
    } catch (e) {
      console.error('Email send failed', e);
    }
    
    return { 
      success: true, 
      message: '인증 코드가 발송되었습니다. 메일함을 확인해주세요.'
    };
  }

  async verifyEmailCode(email: string, code: string) {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (user && user.isLocked) {
      if (user.role === UserRole.ACADEMY_ADMIN || user.role === UserRole.SUPER_ADMIN) {
        throw new BadRequestException('인증번호 5회 연속 실패로 원장님 계정이 잠겼습니다. 등록된 원장님 이메일 인증을 완료하시면 잠금이 즉시 해제됩니다.');
      } else {
        throw new BadRequestException('인증번호 5회 연속 실패로 계정이 잠겼습니다. 원장님(관리자)에게 잠금 해제를 요청해 주세요.');
      }
    }

    const record = this.verificationCodes.get(email);
    if (!record) throw new BadRequestException('인증 코드가 없습니다.');
    if (Date.now() > record.expiresAt) throw new BadRequestException('인증 코드가 만료되었습니다.');
    if (record.code !== code) {
      if (user) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= 5) {
          user.isLocked = true;
          user.lockedAt = new Date();
          await this.usersRepository.save(user);
          if (user.role === UserRole.ACADEMY_ADMIN || user.role === UserRole.SUPER_ADMIN) {
            throw new BadRequestException('인증번호를 5회 연속 잘못 입력하여 원장님 계정이 잠겼습니다. 등록된 원장님 이메일 인증을 완료하시면 잠금이 즉시 해제됩니다.');
          } else {
            throw new BadRequestException('인증번호를 5회 연속 잘못 입력하여 계정이 잠겼습니다. 원장님(관리자)에게 잠금 해제를 요청해 주세요.');
          }
        }
        await this.usersRepository.save(user);
        const remaining = 5 - user.failedLoginAttempts;
        throw new BadRequestException(`유효하지 않은 인증 코드입니다. (남은 기회: ${remaining}회)`);
      }
      throw new BadRequestException('유효하지 않은 인증 코드입니다.');
    }

    if (user) {
      user.failedLoginAttempts = 0;
      await this.usersRepository.save(user);
    }
    this.verificationCodes.delete(email);
    return { success: true, message: '이메일 인증이 완료되었습니다.' };
  }

  async verifyAuthCode(authCode: string) {
    if (!authCode) throw new BadRequestException('유치원 인증코드를 입력해주세요.');
    const cleanAuthCode = authCode.trim().toUpperCase();
    const academy = await this.academyRepository.findOne({ where: { authCode: cleanAuthCode } });
    if (!academy) {
      throw new BadRequestException('유효하지 않은 원 인증코드입니다. 원장선생님께 확인해주세요.');
    }

    const students = await this.studentRepository.find({
      where: { academy: { id: academy.id } }
    });

    const classSet = new Set();
    students.forEach(st => {
      let raw = st.raw;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) { raw = {}; }
      }
      const cls = raw?.['반명'] || raw?.반명 || raw?.['반'] || raw?.반;
      if (cls && typeof cls === 'string' && cls.trim()) {
        classSet.add(cls.trim());
      }
    });

    const classes = Array.from(classSet);
    if (classes.length === 0) {
      classes.push('햇살반', '열매반', '풀잎반', '새싹반');
    }

    return {
      success: true,
      academyId: academy.id,
      academyName: academy.name,
      classes,
    };
  }

  async verifyOtpSetup(userId: number, token: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    const verified = speakeasy.totp.verify({
      secret: user.otpSecret,
      encoding: 'base32',
      token
    });

    if (verified) {
      user.isOtpEnabled = true;
      await this.usersRepository.save(user);
      return { success: true, message: 'OTP 연동 완료!' };
    }
    throw new BadRequestException('OTP 번호가 올바르지 않습니다.');
  }

  async login(data: any) {
    const { email, password, otpToken } = data;
    const user = await this.usersRepository.findOne({ where: { email } });

    if (!user) {
      throw new BadRequestException('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 1. 계정 잠김 확인
    if (user.isLocked) {
      if (user.role === UserRole.ACADEMY_ADMIN || user.role === UserRole.SUPER_ADMIN) {
        throw new BadRequestException('원장님 계정이 5회 연속 실패로 잠겼습니다. 등록된 휴대폰 SMS 또는 이메일 인증을 완료하시면 즉시 잠금이 해제됩니다.');
      } else {
        throw new BadRequestException('로그인 5회 연속 실패로 계정이 잠겼습니다. 보안 규정상 원장님(관리자)에게 잠금 해제를 요청해 주세요.');
      }
    }

    // 2. 비밀번호 검증 및 실패 횟수 처리
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 5) {
        user.isLocked = true;
        user.lockedAt = new Date();
        await this.usersRepository.save(user);
        if (user.role === UserRole.ACADEMY_ADMIN || user.role === UserRole.SUPER_ADMIN) {
          throw new BadRequestException('비밀번호를 5회 연속 잘못 입력하여 원장님 계정이 잠겼습니다. 등록된 휴대폰 SMS 또는 이메일 인증을 완료하시면 즉시 잠금이 해제됩니다.');
        } else {
          throw new BadRequestException('비밀번호를 5회 연속 잘못 입력하여 계정이 잠겼습니다. 원장님(관리자)에게 잠금 해제를 요청해 주세요.');
        }
      }
      await this.usersRepository.save(user);
      const remaining = 5 - user.failedLoginAttempts;
      throw new BadRequestException(`이메일 또는 비밀번호가 올바르지 않습니다. (남은 기회: ${remaining}회)`);
    }

    if (user.role === UserRole.ACADEMY_ADMIN) {
      if (user.isOtpEnabled) {
        if (!otpToken) return { success: false, requireOtp: true, userId: user.id };
        
        const verified = speakeasy.totp.verify({
          secret: user.otpSecret,
          encoding: 'base32',
          token: otpToken,
          window: 1
        });
        if (!verified) {
          user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
          if (user.failedLoginAttempts >= 5) {
            user.isLocked = true;
            user.lockedAt = new Date();
            await this.usersRepository.save(user);
            throw new BadRequestException('OTP 인증번호를 5회 연속 잘못 입력하여 원장님 계정이 잠겼습니다. 등록된 휴대폰 SMS 또는 이메일 인증을 완료하시면 즉시 잠금이 해제됩니다.');
          }
          await this.usersRepository.save(user);
          const remaining = 5 - user.failedLoginAttempts;
          throw new UnauthorizedException(`OTP 번호가 올바르지 않습니다. (남은 기회: ${remaining}회)`);
        }
      } else {
        // Force OTP setup
        let qrCodeUrl = '';
        if (!user.otpSecret) {
          const secret = speakeasy.generateSecret({ name: `Takeme (${email})` });
          user.otpSecret = secret.base32;
          await this.usersRepository.save(user);
          qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url || '');
        } else {
          const otpauth_url = `otpauth://totp/Takeme%20(${encodeURIComponent(email)})?secret=${user.otpSecret}`;
          qrCodeUrl = await qrcode.toDataURL(otpauth_url);
        }
        return { success: false, requireOtpSetup: true, userId: user.id, qrCodeUrl };
      }
    }

    if (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) {
      const student = await this.studentRepository.findOne({ 
        where: user.role === UserRole.STUDENT ? { studentUser: { id: user.id } } : { parentUser: { id: user.id } } 
      });
      if (student && student.approvalStatus === 'PENDING') {
        return {
          success: true,
          requireApproval: true,
          user: { id: user.id, email: user.email, role: user.role, name: user.name }
        };
      }
    }

    if (user.role === UserRole.DRIVER) {
      const vehicle = await this.vehicleRepository.findOne({ 
        where: { driverUser: { id: user.id } }
      });
      if (vehicle && vehicle.driverApprovalStatus === 'PENDING') {
        return {
          success: true,
          requireApproval: true,
          user: { id: user.id, email: user.email, role: user.role, name: user.name }
        };
      }
    }

    let academyId: number | null = null;
    let academyName: string | null = null;
    if (user.role === UserRole.SUPER_ADMIN) {
      academyId = null;
      academyName = '통합 플랫폼 관리자';
    } else if (user.role === UserRole.ACADEMY_ADMIN) {
      let academy = await this.academyRepository.findOne({ where: { owner: { id: user.id } } });
      if (!academy) {
        // Find if there is an academy without owner or create a fresh one
        const unowned = await this.academyRepository.findOne({ where: { owner: undefined } });
        if (unowned && !unowned.owner) {
          unowned.owner = user;
          await this.academyRepository.save(unowned);
          academy = unowned;
        } else {
          let authCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          while (await this.academyRepository.findOne({ where: { authCode } })) {
            authCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          }
          academy = this.academyRepository.create({
            name: user.name ? `${user.name} 유치원` : '신규 유치원',
            owner: user,
            authCode,
            vehicleCount: 0
          });
          await this.academyRepository.save(academy);
        }
      }
      academyId = academy.id;
      academyName = academy.name;
    } else if (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) {
      const student = await this.studentRepository.findOne({
        where: user.role === UserRole.STUDENT ? { studentUser: { id: user.id } } : { parentUser: { id: user.id } },
        relations: { academy: true }
      });
      if (student?.academy) {
        academyId = student.academy.id;
        academyName = student.academy.name;
      }
    } else if (user.role === UserRole.TEACHER) {
      const teacherUser = await this.usersRepository.findOne({
        where: { id: user.id },
        relations: { academy: true }
      });
      if (teacherUser?.academy) {
        academyId = teacherUser.academy.id;
        academyName = teacherUser.academy.name;
      }
    } else if (user.role === UserRole.DRIVER) {
      const vehicle = await this.vehicleRepository.findOne({
        where: { driverUser: { id: user.id } },
        relations: { academy: true }
      });
      if (vehicle?.academy) {
        academyId = vehicle.academy.id;
        academyName = vehicle.academy.name;
      }
    }

    // 로그인 성공: 실패 횟수 초기화, 단일 세션 갱신 및 리프레시 토큰 발급
    user.failedLoginAttempts = 0;
    const sessionId = Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
    user.currentSessionToken = sessionId;

    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    user.refreshToken = await bcrypt.hash(rawRefreshToken, 10);
    await this.usersRepository.save(user);

    // 승인까지 끝난 사용자에게만 토큰 발급 (승인 대기·OTP 미통과는 위에서 이미 return 됨)
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      academyId,
      sessionId,
    });

    return {
      success: true,
      accessToken,
      refreshToken: `${user.id}.${rawRefreshToken}`,
      user: { 
        id: user.id, 
        email: user.email, 
        role: user.role, 
        name: user.name,
        assignedClass: user.assignedClass || null,
        academyId,
        academyName
      }
    };
  }

  async refreshToken(tokenStr: string) {
    if (!tokenStr || typeof tokenStr !== 'string') {
      throw new UnauthorizedException('리프레시 토큰이 필요합니다.');
    }
    const [userIdStr, rawToken] = tokenStr.split('.');
    const userId = parseInt(userIdStr, 10);
    if (!userId || !rawToken) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰 형식입니다.');
    }

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('유효하지 않은 리프레시 토큰입니다.');
    }

    if (user.isLocked) {
      throw new UnauthorizedException('계정이 잠겨있어 토큰을 갱신할 수 없습니다.');
    }

    const isMatch = await bcrypt.compare(rawToken, user.refreshToken);
    if (!isMatch) {
      throw new UnauthorizedException('리프레시 토큰이 일치하지 않습니다.');
    }

    let academyId: number | null = null;
    let academyName: string | null = null;
    if (user.role === UserRole.SUPER_ADMIN) {
      academyName = '통합 플랫폼 관리자';
    } else if (user.role === UserRole.ACADEMY_ADMIN) {
      const academy = await this.academyRepository.findOne({ where: { owner: { id: user.id } } });
      if (academy) {
        academyId = academy.id;
        academyName = academy.name;
      }
    } else if (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) {
      const student = await this.studentRepository.findOne({
        where: user.role === UserRole.STUDENT ? { studentUser: { id: user.id } } : { parentUser: { id: user.id } },
        relations: { academy: true }
      });
      if (student?.academy) {
        academyId = student.academy.id;
        academyName = student.academy.name;
      }
    } else if (user.role === UserRole.TEACHER) {
      const teacherUser = await this.usersRepository.findOne({
        where: { id: user.id },
        relations: { academy: true }
      });
      if (teacherUser?.academy) {
        academyId = teacherUser.academy.id;
        academyName = teacherUser.academy.name;
      }
    } else if (user.role === UserRole.DRIVER) {
      const vehicle = await this.vehicleRepository.findOne({
        where: { driverUser: { id: user.id } },
        relations: { academy: true }
      });
      if (vehicle?.academy) {
        academyId = vehicle.academy.id;
        academyName = vehicle.academy.name;
      }
    }

    // Refresh: 새 리프레시 토큰 발급 (RTR - Refresh Token Rotation)
    const newRawRefreshToken = crypto.randomBytes(32).toString('hex');
    user.refreshToken = await bcrypt.hash(newRawRefreshToken, 10);
    // 세션 ID는 기존 활성 세션을 보존하여 동시성 요청 및 탭 간 세션 끊김 충돌을 방지합니다.
    let sessionId = user.currentSessionToken;
    if (!sessionId) {
      sessionId = Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
      user.currentSessionToken = sessionId;
    }
    await this.usersRepository.save(user);

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      academyId,
      sessionId,
    });

    return {
      success: true,
      accessToken,
      refreshToken: `${user.id}.${newRawRefreshToken}`,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        assignedClass: user.assignedClass || null,
        academyId,
        academyName,
      }
    };
  }

  async register(data: any) {
    const { email, password, name, authCode, role, targetName, phone } = data;
    const searchName = targetName || name;

    // 0. 비밀번호 복잡도 검증 (영문, 숫자 포함 최소 8자리 이상, 공백 제외 모든 특수문자 허용)
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)\S{8,}$/;
    if (!password || !passwordRegex.test(password)) {
      throw new BadRequestException('비밀번호는 영문자와 숫자를 포함하여 최소 8자리 이상이어야 합니다.');
    }
    
    // 1. Verify academy auth code (Required for staff & students, skip for admins)
    let targetAcademy: Academy | null = null;
    if (role !== UserRole.ACADEMY_ADMIN && role !== UserRole.SUPER_ADMIN) {
      const cleanAuthCode = authCode ? authCode.trim().toUpperCase() : '';
      targetAcademy = await this.academyRepository.findOne({ where: { authCode: cleanAuthCode } });
      if (!targetAcademy) {
        throw new BadRequestException('유효하지 않은 원 인증코드입니다.');
      }
    }

    if (await this.usersRepository.findOne({ where: { email } })) {
      throw new BadRequestException('이미 가입된 이메일입니다.');
    }

    // 2. Create User account
    const hashedPassword = await bcrypt.hash(password, 10);
    const userRole = role || UserRole.STUDENT;
    
    const user = this.usersRepository.create({
      email,
      passwordHash: hashedPassword,
      name,
      role: userRole,
      isOtpEnabled: false,
    });
    
    const savedUser = await this.usersRepository.save(user);

    try {
      // 3. Link User to Entity based on Role
      if (userRole === UserRole.ACADEMY_ADMIN) {
        // Check if an existing academy is unowned or create a dedicated academy for this director
        let authCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        while (await this.academyRepository.findOne({ where: { authCode } })) {
          authCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        }
        const academy = this.academyRepository.create({
          name: name ? `${name} 유치원` : '신규 유치원',
          owner: savedUser,
          authCode,
          vehicleCount: 0,
        });
        await this.academyRepository.save(academy);
      } else if (userRole === UserRole.STUDENT || userRole === UserRole.PARENT) {
        if (!targetAcademy) throw new BadRequestException('소속 유치원 정보를 찾을 수 없습니다.');
        const student = await this.studentRepository.createQueryBuilder('student')
          .leftJoinAndSelect('student.studentUser', 'studentUser')
          .leftJoinAndSelect('student.parentUser', 'parentUser')
          .where('TRIM(student.name) = :name', { name: searchName.trim() })
          .andWhere('student.academyId = :academyId', { academyId: targetAcademy.id })
          .getOne();
          
        if (!student) {
          throw new BadRequestException('해당 유치원에서 일치하는 이름의 원아 정보를 찾을 수 없습니다.');
        }
        
        if (userRole === UserRole.STUDENT) {
          if (student.studentUser) throw new BadRequestException('이 원생은 이미 학생 계정과 연동되어 있습니다.');
          student.studentUser = savedUser;
        } else {
          if (student.parentUser) throw new BadRequestException('이 원생은 이미 학부모 계정과 연동되어 있습니다.');
          student.parentUser = savedUser;
        }
        
        if (data.allergies) {
          student.allergies = String(data.allergies).trim();
          let rawObj: any = student.raw;
          if (typeof rawObj === 'string') {
            try { rawObj = JSON.parse(rawObj); } catch(e) { rawObj = {}; }
          }
          if (!rawObj || typeof rawObj !== 'object') rawObj = {};
          rawObj['알레르기'] = student.allergies;
          student.raw = rawObj;
        }

        student.approvalStatus = 'PENDING';
        await this.studentRepository.save(student);
        
      } else if (userRole === UserRole.TEACHER) {
        if (!targetAcademy) throw new BadRequestException('소속 유치원 정보를 찾을 수 없습니다.');
        savedUser.academy = targetAcademy;
        savedUser.academyId = targetAcademy.id;
        savedUser.assignedClass = data.assignedClass || '';
        await this.usersRepository.save(savedUser);

        return {
          success: true,
          message: `${targetAcademy.name} 교사로 등록되었습니다. 원장선생님의 반 배정 후 이용 가능합니다.`,
          userId: savedUser.id,
          role: UserRole.TEACHER,
          assignedClass: savedUser.assignedClass || '',
          academyName: targetAcademy.name,
        };
      } else if (userRole === UserRole.DRIVER) {
        if (!targetAcademy) throw new BadRequestException('소속 유치원 정보를 찾을 수 없습니다.');
        const vehicle = await this.vehicleRepository.createQueryBuilder('vehicle')
          .leftJoinAndSelect('vehicle.driverUser', 'driverUser')
          .where('TRIM(vehicle.driverName) = :name', { name: searchName.trim() })
          .andWhere('vehicle.academyId = :academyId', { academyId: targetAcademy.id })
          .getOne();
          
        if (!vehicle) {
          throw new BadRequestException('해당 유치원에 등록된 통학차량 정보를 찾을 수 없습니다.');
        }

        if (vehicle.driverUser) throw new BadRequestException('해당 차량은 이미 기사님 계정과 연동되어 있습니다.');
        vehicle.driverUser = savedUser;
        vehicle.driverApprovalStatus = 'PENDING';
        await this.vehicleRepository.save(vehicle);
      }

      // 4. Generate OTP Secret
      const secret = speakeasy.generateSecret({ name: `Takeme (${email})` });
      savedUser.otpSecret = secret.base32;
      await this.usersRepository.save(savedUser);
      
      const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url || '');

      return {
        success: true,
        message: '회원가입 및 연동이 완료되었습니다.',
        userId: savedUser.id,
        qrCodeUrl,
      };
    } catch (e) {
      await this.usersRepository.remove(savedUser);
      throw e;
    }
  }

  async deleteAccount(email: string) {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) {
      throw new BadRequestException('회원을 찾을 수 없습니다.');
    }

    // If Academy Admin, delete their Academy first (this will cascade delete students, vehicles, etc.)
    if (user.role === UserRole.ACADEMY_ADMIN) {
      const academy = await this.academyRepository.findOne({ where: { owner: { id: user.id } } });
      if (academy) {
        await this.academyRepository.remove(academy);
      }
    }

    // Find if the user is linked to a student
    if (user.role === UserRole.STUDENT || user.role === UserRole.PARENT) {
      const student = await this.studentRepository.findOne({ 
        where: user.role === UserRole.STUDENT ? { studentUser: { id: user.id } } : { parentUser: { id: user.id } } 
      });
      if (student) {
        if (user.role === UserRole.STUDENT) student.studentUser = null as any;
        if (user.role === UserRole.PARENT) student.parentUser = null as any;
        if (!student.studentUser && !student.parentUser) {
          student.approvalStatus = 'UNREGISTERED';
        }
        await this.studentRepository.save(student);
      }
    } else if (user.role === UserRole.DRIVER || user.role === UserRole.TEACHER) {
      const vehicle = await this.vehicleRepository.findOne({ 
        where: user.role === UserRole.DRIVER ? { driverUser: { id: user.id } } : { teacherUser: { id: user.id } } 
      });
      if (vehicle) {
        if (user.role === UserRole.DRIVER) {
          vehicle.driverUser = null as any;
          vehicle.driverApprovalStatus = 'UNREGISTERED';
        }
        if (user.role === UserRole.TEACHER) {
          vehicle.teacherUser = null as any;
          vehicle.teacherApprovalStatus = 'UNREGISTERED';
        }
        await this.vehicleRepository.save(vehicle);
      }
    }

    // Delete the user account entirely
    await this.usersRepository.remove(user);

    return { success: true, message: '회원 탈퇴 처리가 완료되었습니다.' };
  }

  async sendSelfUnlockCode(email: string, clientIp: string = '127.0.0.1') {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) {
      throw new BadRequestException('가입되지 않은 이메일입니다.');
    }
    if (!user.isLocked) {
      return { success: true, message: '해당 계정은 잠겨있지 않습니다. 바로 로그인해 주세요.' };
    }
    // 원장님(ACADEMY_ADMIN, SUPER_ADMIN)만 이메일 인증으로 직접 잠금 해제 가능
    if (user.role !== UserRole.ACADEMY_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('선생님, 기사님, 학부모님 계정은 보안 규정상 원장님이 관리자 대시보드에서 직접 잠금을 해제해주셔야 합니다.');
    }
    return this.sendEmailVerification(email, clientIp, 'register');
  }

  async verifySelfUnlockCode(email: string, code: string) {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) {
      throw new BadRequestException('가입되지 않은 이메일입니다.');
    }
    if (user.role !== UserRole.ACADEMY_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('선생님, 기사님, 학부모님 계정은 보안 규정상 원장님이 관리자 대시보드에서 직접 잠금을 해제해주셔야 합니다.');
    }
    const record = this.verificationCodes.get(email);
    if (!record) throw new BadRequestException('인증 코드가 없습니다.');
    if (Date.now() > record.expiresAt) throw new BadRequestException('인증 코드가 만료되었습니다.');
    if (record.code !== code) {
      throw new BadRequestException('유효하지 않은 인증 코드입니다.');
    }

    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockedAt = null as any;
    await this.usersRepository.save(user);
    this.verificationCodes.delete(email);

    return { success: true, message: '원장님 계정 잠금이 성공적으로 해제되었습니다. 이제 로그인해 주세요.' };
  }

  async sendSelfUnlockSmsCode(email: string, phoneInput?: string, clientIp: string = '127.0.0.1') {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) {
      throw new BadRequestException('가입되지 않은 이메일입니다.');
    }
    if (!user.isLocked) {
      return { success: true, message: '해당 계정은 잠겨있지 않습니다. 바로 로그인해 주세요.' };
    }
    // 원장님만 직접 잠금 해제 가능
    if (user.role !== UserRole.ACADEMY_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('선생님, 기사님, 학부모님 계정은 보안 규정상 원장님이 관리자 대시보드에서 직접 잠금을 해제해주셔야 합니다.');
    }

    let targetPhone = user.phone;
    if (phoneInput && phoneInput.trim()) {
      const clean = phoneInput.replace(/\D/g, '');
      if (clean.length < 10 || clean.length > 11 || !clean.startsWith('01')) {
        throw new BadRequestException('올바른 휴대폰 번호 형식을 입력해주세요. (예: 010-1234-5678)');
      }
      targetPhone = normalizePhone(phoneInput);
      if (!user.phone) {
        user.phone = targetPhone;
        await this.usersRepository.save(user);
      }
    }

    if (!targetPhone) {
      throw new BadRequestException('등록된 원장님 휴대폰 번호가 없습니다. 본인 확인을 위해 휴대폰 번호를 함께 입력해 주세요.');
    }

    const now = Date.now();
    const rateLimit = this.emailRateLimits.get(clientIp);
    if (rateLimit && now < rateLimit.resetAt) {
      if (rateLimit.count >= 10) {
        const remainingMinutes = Math.ceil((rateLimit.resetAt - now) / 60000);
        throw new HttpException(
          `단기간에 너무 많은 요청이 발생했습니다. ${remainingMinutes}분 후 다시 시도해 주세요.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      rateLimit.count++;
    } else {
      this.emailRateLimits.set(clientIp, { count: 1, resetAt: now + 10 * 60 * 1000 });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    this.smsVerificationCodes.set(email, {
      code,
      phone: targetPhone,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    const smsText = `[Takeme] 원장님 계정 잠금 해제 인증번호는 [${code}] 입니다. (5분 이내 입력)`;
    const smsResult = await sendSmsNotification(targetPhone, smsText);

    return {
      success: true,
      message: `원장님 휴대폰(${maskPhone(targetPhone)})으로 인증번호가 전송되었습니다.`,
      maskedPhone: maskPhone(targetPhone),
      devCode: smsResult.mode === 'mock' ? code : undefined,
    };
  }

  async verifySelfUnlockSmsCode(email: string, code: string) {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (!user) {
      throw new BadRequestException('가입되지 않은 이메일입니다.');
    }
    if (user.role !== UserRole.ACADEMY_ADMIN && user.role !== UserRole.SUPER_ADMIN) {
      throw new BadRequestException('선생님, 기사님, 학부모님 계정은 보안 규정상 원장님이 관리자 대시보드에서 직접 잠금을 해제해주셔야 합니다.');
    }

    const record = this.smsVerificationCodes.get(email);
    if (!record) {
      throw new BadRequestException('인증 코드가 발송되지 않았거나 만료되었습니다.');
    }
    if (Date.now() > record.expiresAt) {
      this.smsVerificationCodes.delete(email);
      throw new BadRequestException('인증 코드가 만료되었습니다. 다시 발송해 주세요.');
    }
    if (record.code !== code) {
      throw new BadRequestException('인증번호가 일치하지 않습니다.');
    }

    user.isLocked = false;
    user.failedLoginAttempts = 0;
    user.lockedAt = null as any;
    await this.usersRepository.save(user);
    this.smsVerificationCodes.delete(email);

    return {
      success: true,
      message: '원장님 계정 잠금이 성공적으로 해제되었습니다. 이제 로그인해 주세요.',
    };
  }

}
