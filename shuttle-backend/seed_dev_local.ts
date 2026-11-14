/**
 * 로컬 개발 DB 전용 시드 (실제 RDS 에 실행하지 말 것)
 * 실행: DB_HOST=localhost DB_NAME=takeme_dev DB_PASSWORD=postgres DB_SSL=false npx ts-node -r tsconfig-paths/register seed_dev_local.ts
 * 모든 계정 비밀번호: Test1234
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from './src/app.module';
import { User, UserRole } from './src/entities/user.entity';
import { Student } from './src/entities/student.entity';
import { Vehicle } from './src/entities/vehicle.entity';
import { Academy } from './src/entities/academy.entity';

async function main() {
  if (!['localhost', '127.0.0.1'].includes(process.env.DB_HOST || '')) {
    console.error('DB_HOST 가 localhost 가 아니라서 중단합니다 (실제 DB 보호).');
    process.exit(1);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const users = app.get(getRepositoryToken(User));
  const students = app.get(getRepositoryToken(Student));
  const vehicles = app.get(getRepositoryToken(Vehicle));
  const academies = app.get(getRepositoryToken(Academy));
  const hash = await bcrypt.hash('Test1234', 10);

  const mk = async (email: string, role: UserRole, name: string, extra: any = {}) => {
    let u = await users.findOne({ where: { email } });
    if (!u) {
      u = users.create({ email, passwordHash: hash, name, role, isOtpEnabled: false, approvalStatus: 'APPROVED', ...extra });
      u = await users.save(u);
    }
    return u;
  };

  const admin = await mk('admin@dev.test', UserRole.ACADEMY_ADMIN, '테스트원장');
  let academy = await academies.findOne({ where: { owner: { id: admin.id } } });
  if (!academy) {
    academy = await academies.save(
      academies.create({
        name: '테스트유치원',
        owner: admin,
        authCode: 'DEV001',
        vehicleCount: 1,
        latitude: '37.5665',
        longitude: '126.9780',
      }),
    );
  }
  const base = { academy, academyId: academy.id };
  const teacher = await mk('teacher@dev.test', UserRole.HOMEROOM_TEACHER, '김담임', { ...base, assignedClass: '햇살반' });
  const shuttle = await mk('shuttle@dev.test', UserRole.SHUTTLE_TEACHER, '이지도', base);
  const driver = await mk('driver@dev.test', UserRole.DRIVER, '박기사', base);
  const parent = await mk('parent@dev.test', UserRole.PARENT, '최학부모', base);

  let vehicle = await vehicles.findOne({ where: { busNumber: '1호차', academy: { id: academy.id } } });
  if (!vehicle) {
    vehicle = await vehicles.save(
      vehicles.create({
        busNumber: '1호차',
        academy,
        driverName: driver.name,
        teacherName: shuttle.name,
        driverUser: driver,
        teacherUser: shuttle,
        driverApprovalStatus: 'APPROVED',
        teacherApprovalStatus: 'APPROVED',
      }),
    );
  }

  let student = await students.findOne({ where: { name: '최아이', academy: { id: academy.id } } });
  if (!student) {
    await students.save(
      students.create({
        name: '최아이',
        className: '햇살반',
        address: '서울 중구 세종대로 110',
        latitude: 37.5663,
        longitude: 126.9779,
        academy,
        assignedVehicle: vehicle,
        parentUser: parent,
        approvalStatus: 'APPROVED',
        raw: { 반명: '햇살반', 학부모연락처: '010-0000-0000' },
      }),
    );
  }

  console.log('시드 완료. 유치원 인증코드: DEV001, 비밀번호: Test1234');
  console.log('원장 admin@dev.test / 담임 teacher@dev.test / 지도교사 shuttle@dev.test / 기사 driver@dev.test / 학부모 parent@dev.test');
  await app.close();
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
