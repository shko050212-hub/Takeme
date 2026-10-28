import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { User } from '../entities/user.entity';
import { Academy } from '../entities/academy.entity';
import { Student } from '../entities/student.entity';
import { Vehicle } from '../entities/vehicle.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, Academy, Student, Vehicle]),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET') || process.env.JWT_SECRET || 'TakemeJwtSecretKey2026!@#$%^';
        return { secret, signOptions: { expiresIn: '15m' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, TypeOrmModule],
})
export class AuthModule {}
