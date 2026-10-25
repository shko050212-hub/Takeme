import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User, UserRole } from './src/entities/user.entity';
import { Student } from './src/entities/student.entity';
import { Vehicle } from './src/entities/vehicle.entity';
import { Academy } from './src/entities/academy.entity';
import * as bcrypt from 'bcrypt';
import * as speakeasy from 'speakeasy';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  
  const userRepository = app.get(getRepositoryToken(User));
  const studentRepository = app.get(getRepositoryToken(Student));
  const vehicleRepository = app.get(getRepositoryToken(Vehicle));
  const academyRepository = app.get(getRepositoryToken(Academy));

  // Find academy
  const academy = await academyRepository.findOne({ where: { authCode: 'CYQKYZ' } });
  if (!academy) {
    console.log("Academy with authCode CYQKYZ not found.");
    process.exit(1);
  }

  // Helper to create user
  const createUser = async (email: string, role: UserRole, name: string) => {
    let user = await userRepository.findOne({ where: { email } });
    if (!user) {
      const hashedPassword = await bcrypt.hash('1234', 10);
      user = userRepository.create({
        email,
        passwordHash: hashedPassword,
        name,
        role,
        isOtpEnabled: false,
        otpSecret: speakeasy.generateSecret().base32
      });
      await userRepository.save(user);
    }
    return user;
  };

  // 1. Create student record
  let student = await studentRepository.findOne({ where: { name: '테스트원생', academy: { id: academy.id } } });
  if (!student) {
    student = studentRepository.create({
      name: '테스트원생',
      age: 10,
      parentPhone: '010-0000-0000',
      address: '테스트 주소',
      academy,
      approvalStatus: 'PENDING'
    });
    await studentRepository.save(student);
  }

  // Create Student User (test1)
  const studentUser = await createUser('test1test', UserRole.STUDENT, '테스트원생');
  student.studentUser = studentUser;
  student.approvalStatus = 'APPROVED';
  await studentRepository.save(student);

  // Create Parent User (test2)
  const parentUser = await createUser('test2', UserRole.PARENT, '테스트원생'); // test2 is parent of '테스트원생'
  student.parentUser = parentUser;
  await studentRepository.save(student);

  // 2. Create vehicle record
  let vehicle = await vehicleRepository.findOne({ where: { busNumber: '1호차', academy: { id: academy.id } } });
  if (!vehicle) {
    vehicle = vehicleRepository.create({
      busNumber: '1호차',
      plateNumber: '12가3456',
      driverName: '테스트기사',
      driverPhone: '010-1111-1111',
      teacherName: '테스트교사',
      teacherPhone: '010-2222-2222',
      academy,
      driverApprovalStatus: 'PENDING',
      teacherApprovalStatus: 'PENDING'
    });
    await vehicleRepository.save(vehicle);
  }

  // Create Driver User (test3)
  const driverUser = await createUser('test3', UserRole.DRIVER, '테스트기사');
  vehicle.driverUser = driverUser;
  vehicle.driverApprovalStatus = 'APPROVED';
  await vehicleRepository.save(vehicle);

  // Create Teacher User (test4)
  const teacherUser = await createUser('test4', UserRole.TEACHER, '테스트교사');
  vehicle.teacherUser = teacherUser;
  vehicle.teacherApprovalStatus = 'APPROVED';
  await vehicleRepository.save(vehicle);

  console.log("All accounts created successfully! password is '1234'. test1test, test2, test3, test4");
  await app.close();
}

bootstrap();
