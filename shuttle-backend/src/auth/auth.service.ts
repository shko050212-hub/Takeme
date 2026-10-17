import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
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

  async sendEmailVerification(email: string, type: 'register' | 'withdraw' = 'register') {
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
              <h2 style="color: #1e40af; margin-top: 0; font-size: 24px;">환영합니다! 🎉</h2>
              <p style="color: #475569; font-size: 16px; line-height: 1.6;">
                Takeme에 가입을 진행해 주셔서 감사합니다.<br/>원장님의 학원 차량 관리를 스마트하고 안전하게 돕겠습니다.
              </p>
              <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 24px; text-align: center; margin: 32px 0;">
                <p style="margin: 0; color: #64748b; font-size: 14px; margin-bottom: 8px;">인증코드 6자리</p>
                <h1 style="margin: 0; color: #0f172a; font-size: 36px; letter-spacing: 4px;">${code}</h1>
              </div>
              <p style="color: #dc2626; font-size: 14px; text-align: center; font-weight: bold;">
                ⏰ 본 코드는 3분 안에 입력해주셔야 합니다.
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

  verifyEmailCode(email: string, code: string) {
    const record = this.verificationCodes.get(email);
    if (!record) throw new BadRequestException('인증 코드가 없습니다.');
    if (Date.now() > record.expiresAt) throw new BadRequestException('인증 코드가 만료되었습니다.');
    if (record.code !== code) throw new BadRequestException('유효하지 않은 인증 코드입니다.');
    this.verificationCodes.delete(email);
    return { success: true, message: '이메일 인증이 완료되었습니다.' };
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
    
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new BadRequestException('이메일 또는 비밀번호가 올바르지 않습니다.');
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
        if (!verified) throw new UnauthorizedException('OTP 번호가 올바르지 않습니다.');
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

    if (user.role === UserRole.DRIVER || user.role === UserRole.TEACHER) {
      const vehicle = await this.vehicleRepository.findOne({ 
        where: user.role === UserRole.DRIVER ? { driverUser: { id: user.id } } : { teacherUser: { id: user.id } } 
      });
      if (vehicle) {
        const isPending = user.role === UserRole.DRIVER 
          ? vehicle.driverApprovalStatus === 'PENDING' 
          : vehicle.teacherApprovalStatus === 'PENDING';
        
        if (isPending) {
          return {
            success: true,
            requireApproval: true,
            user: { id: user.id, email: user.email, role: user.role, name: user.name }
          };
        }
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
            name: user.name ? `${user.name} 학원` : '신규 학원',
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
    } else if (user.role === UserRole.DRIVER || user.role === UserRole.TEACHER) {
      const vehicle = await this.vehicleRepository.findOne({
        where: user.role === UserRole.DRIVER ? { driverUser: { id: user.id } } : { teacherUser: { id: user.id } },
        relations: { academy: true }
      });
      if (vehicle?.academy) {
        academyId = vehicle.academy.id;
        academyName = vehicle.academy.name;
      }
    }

    // 승인까지 끝난 사용자에게만 토큰 발급 (승인 대기·OTP 미통과는 위에서 이미 return 됨)
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      academyId,
    });

    return {
      success: true,
      accessToken,
      user: { 
        id: user.id, 
        email: user.email, 
        role: user.role, 
        name: user.name,
        academyId,
        academyName
      }
    };
  }

  async register(data: any) {
    const { email, password, name, authCode, role, targetName } = data;
    const searchName = targetName || name;
    
    // 1. Verify academy auth code (Required for staff & students, skip for admins)
    let targetAcademy: Academy | null = null;
    if (role !== UserRole.ACADEMY_ADMIN && role !== UserRole.SUPER_ADMIN) {
      const cleanAuthCode = authCode ? authCode.trim().toUpperCase() : '';
      targetAcademy = await this.academyRepository.findOne({ where: { authCode: cleanAuthCode } });
      if (!targetAcademy) {
        throw new BadRequestException('유효하지 않은 학원 인증코드입니다.');
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
          name: name ? `${name} 학원` : '신규 학원',
          owner: savedUser,
          authCode,
          vehicleCount: 0,
        });
        await this.academyRepository.save(academy);
      } else if (userRole === UserRole.STUDENT || userRole === UserRole.PARENT) {
        if (!targetAcademy) throw new BadRequestException('소속 학원 정보를 찾을 수 없습니다.');
        const student = await this.studentRepository.createQueryBuilder('student')
          .leftJoinAndSelect('student.studentUser', 'studentUser')
          .leftJoinAndSelect('student.parentUser', 'parentUser')
          .where('TRIM(student.name) = :name', { name: searchName.trim() })
          .andWhere('student.academyId = :academyId', { academyId: targetAcademy.id })
          .getOne();
          
        if (!student) {
          throw new BadRequestException('해당 학원에서 일치하는 이름의 원생 정보를 찾을 수 없습니다.');
        }
        
        if (userRole === UserRole.STUDENT) {
          if (student.studentUser) throw new BadRequestException('이 원생은 이미 학생 계정과 연동되어 있습니다.');
          student.studentUser = savedUser;
        } else {
          if (student.parentUser) throw new BadRequestException('이 원생은 이미 학부모 계정과 연동되어 있습니다.');
          student.parentUser = savedUser;
        }
        
        student.approvalStatus = 'PENDING';
        await this.studentRepository.save(student);
        
      } else if (userRole === UserRole.DRIVER || userRole === UserRole.TEACHER) {
        if (!targetAcademy) throw new BadRequestException('소속 학원 정보를 찾을 수 없습니다.');
        const vehicle = await this.vehicleRepository.createQueryBuilder('vehicle')
          .leftJoinAndSelect('vehicle.driverUser', 'driverUser')
          .leftJoinAndSelect('vehicle.teacherUser', 'teacherUser')
          .where(userRole === UserRole.DRIVER ? 'TRIM(vehicle.driverName) = :name' : 'TRIM(vehicle.teacherName) = :name', { name: searchName.trim() })
          .andWhere('vehicle.academyId = :academyId', { academyId: targetAcademy.id })
          .getOne();
          
        if (!vehicle) {
          throw new BadRequestException('해당 학원에 등록된 배차 차량 정보를 찾을 수 없습니다.');
        }

        if (userRole === UserRole.DRIVER) {
          if (vehicle.driverUser) throw new BadRequestException('해당 차량은 이미 기사님 계정과 연동되어 있습니다.');
          vehicle.driverUser = savedUser;
          vehicle.driverApprovalStatus = 'PENDING';
        } else {
          if (vehicle.teacherUser) throw new BadRequestException('해당 차량은 이미 지도 교사 계정과 연동되어 있습니다.');
          vehicle.teacherUser = savedUser;
          vehicle.teacherApprovalStatus = 'PENDING';
        }
        
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
}
