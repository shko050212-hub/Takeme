/**
 * 테스트 계정 만들기 (한 번 실행)
 *
 * 인증코드로 유치원을 찾아, 같은 호차에 연결된 테스트 계정을 만든다.
 *   - 학부모 (그 호차 원아 1명과 연결)
 *   - 기사 (그 호차 기사로 지정)
 *   - 차량선생님 (그 호차 동승 교사로 지정)
 *   - 담임교사 (그 원아의 반 담임)
 *
 * 실행 (서버의 shuttle-backend 폴더에서):
 *   TEST_ACCOUNT_PASSWORD='원하는비밀번호' npm run seed:test-accounts
 * 선택:
 *   AUTH_CODE=ZRF1DD   유치원 인증코드 (기본 ZRF1DD)
 *   BUS=3              호차 번호를 직접 고를 때
 *   FORCE=1            고른 호차에 이미 기사/차량선생님이 있어도 테스트 계정으로 바꿀 때
 *
 * - 비밀번호는 실행할 때 직접 넣는다(코드·로그에 남기지 않는다). 모든 테스트 계정이 같은 비밀번호를 쓴다.
 * - 여러 번 실행해도 계정이 중복으로 생기지 않는다(같은 이메일이면 갱신).
 * - 이미 실제 기사/차량선생님이 배정된 호차는 FORCE 없이 바꾸지 않는다.
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../app.module';
import { Academy } from '../entities/academy.entity';
import { Vehicle } from '../entities/vehicle.entity';
import { Student } from '../entities/student.entity';
import { User, UserRole } from '../entities/user.entity';

function studentClass(s: Student): string {
  let raw: any = s.raw;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  raw = raw && typeof raw === 'object' ? raw : {};
  return (s.className || raw['반명'] || raw['반'] || '').toString().trim();
}

async function main() {
  const password = process.env.TEST_ACCOUNT_PASSWORD || '';
  const authCode = (process.env.AUTH_CODE || 'ZRF1DD').trim();
  const busArg = (process.env.BUS || '').trim();
  const force = process.env.FORCE === '1';

  if (password.length < 8) {
    console.error('TEST_ACCOUNT_PASSWORD 에 8자 이상 비밀번호를 넣어 실행해 주세요.');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const academyRepo: Repository<Academy> = app.get(getRepositoryToken(Academy));
    const vehicleRepo: Repository<Vehicle> = app.get(getRepositoryToken(Vehicle));
    const studentRepo: Repository<Student> = app.get(getRepositoryToken(Student));
    const userRepo: Repository<User> = app.get(getRepositoryToken(User));

    const academy = await academyRepo.findOne({ where: { authCode } });
    if (!academy) {
      console.error(`인증코드 ${authCode} 인 유치원을 찾지 못했습니다.`);
      process.exit(1);
    }
    console.log(`유치원: ${academy.name} (id ${academy.id}, 인증코드 ${authCode})`);

    const vehicles = await vehicleRepo.find({
      where: { academy: { id: academy.id } },
      relations: { driverUser: true, teacherUser: true },
      order: { id: 'ASC' },
    });
    if (vehicles.length === 0) {
      console.error('이 유치원에 등록된 호차가 없습니다. 원장 웹에서 호차를 먼저 만들어 주세요.');
      process.exit(1);
    }

    // 호차별: 학부모 계정이 아직 없는 원아(위치 있는 아이) 수
    const candidates: Array<{ v: Vehicle; free: Student[] }> = [];
    for (const v of vehicles) {
      const free = await studentRepo.find({
        where: { assignedVehicle: { id: v.id }, parentUser: IsNull() },
        relations: { parentUser: true },
        order: { name: 'ASC' },
      });
      candidates.push({ v, free: free.filter(s => s.latitude && s.longitude) });
    }

    let pick: { v: Vehicle; free: Student[] } | undefined;
    if (busArg) {
      pick = candidates.find(c => (c.v.busNumber || '').replace(/호차|호/g, '').trim() === busArg.replace(/호차|호/g, '').trim());
      if (!pick) {
        console.error(`BUS=${busArg} 호차를 찾지 못했습니다. 있는 호차: ${vehicles.map(v => v.busNumber).join(', ')}`);
        process.exit(1);
      }
    } else {
      // 기사·차량선생님이 비어 있고, 연결할 원아가 있는 호차를 우선
      const usable = candidates.filter(c => c.free.length > 0);
      pick =
        usable.find(c => !c.v.driverUser && !c.v.teacherUser) ||
        (force ? usable[0] : undefined);
      if (!pick) {
        console.error('기사·차량선생님이 비어 있고 연결할 원아가 있는 호차가 없습니다.');
        for (const c of candidates) {
          console.error(`  ${c.v.busNumber}호차 · 기사 ${c.v.driverUser?.name || '없음'} · 차량선생님 ${c.v.teacherUser?.name || '없음'} · 연결 가능한 원아 ${c.free.length}명`);
        }
        console.error('BUS=호차번호 로 고르고, 기존 기사/차량선생님을 바꿔도 되면 FORCE=1 을 함께 주세요.');
        process.exit(1);
      }
    }

    const { v: vehicle, free } = pick;
    if ((vehicle.driverUser || vehicle.teacherUser) && !force) {
      console.error(`${vehicle.busNumber}호차에는 이미 기사(${vehicle.driverUser?.name || '없음'})/차량선생님(${vehicle.teacherUser?.name || '없음'})이 있습니다. 바꿔도 되면 FORCE=1 로 다시 실행해 주세요.`);
      process.exit(1);
    }
    const child = free[0];
    if (!child) {
      console.error(`${vehicle.busNumber}호차에 학부모 계정을 연결할 원아(위치가 등록된 아이)가 없습니다.`);
      process.exit(1);
    }
    const cls = studentClass(child);

    const hash = await bcrypt.hash(password, 10);
    const tag = authCode.toLowerCase();
    const upsert = async (email: string, role: UserRole, name: string, extra: Partial<User> = {}) => {
      let u = await userRepo.findOne({ where: { email } });
      if (!u) u = userRepo.create({ email });
      Object.assign(u, {
        role,
        name,
        passwordHash: hash,
        academyId: academy.id,
        academy,
        approvalStatus: 'APPROVED',
        isLocked: false,
        failedLoginAttempts: 0,
        ...extra,
      });
      return userRepo.save(u);
    };

    const parent = await upsert(`test.parent.${tag}@takeme.test`, UserRole.PARENT, '테스트 학부모', { phone: '010-0000-0001' });
    const driver = await upsert(`test.driver.${tag}@takeme.test`, UserRole.DRIVER, '테스트 기사', { phone: '010-0000-0002' });
    const shuttle = await upsert(`test.teacher.${tag}@takeme.test`, UserRole.SHUTTLE_TEACHER, '테스트 차량선생님', { phone: '010-0000-0003' });
    const homeroom = cls
      ? await upsert(`test.homeroom.${tag}@takeme.test`, UserRole.HOMEROOM_TEACHER, '테스트 담임', { assignedClass: cls })
      : null;

    // 이 계정이 다른 호차에 이미 지정돼 있으면 풀어 준다(기사·차량선생님은 호차 하나에만)
    for (const other of vehicles) {
      if (other.id === vehicle.id) continue;
      let changed = false;
      if (other.driverUser?.id === driver.id) { other.driverUser = null as any; changed = true; }
      if (other.teacherUser?.id === shuttle.id) { other.teacherUser = null as any; changed = true; }
      if (changed) await vehicleRepo.save(other);
    }
    vehicle.driverUser = driver;
    vehicle.teacherUser = shuttle;
    vehicle.driverApprovalStatus = 'APPROVED';
    vehicle.teacherApprovalStatus = 'APPROVED';
    await vehicleRepo.save(vehicle);

    child.parentUser = parent;
    child.approvalStatus = 'APPROVED';
    await studentRepo.save(child);

    console.log('');
    console.log('테스트 계정을 만들었습니다 (비밀번호는 실행할 때 넣은 값):');
    console.log(`  호차: ${vehicle.busNumber}호차`);
    console.log(`  학부모   ${parent.email}  → 원아 ${child.adminDisplayName || child.name}${cls ? ` (${cls})` : ''}`);
    console.log(`  기사     ${driver.email}  → ${vehicle.busNumber}호차 기사`);
    console.log(`  차량선생님 ${shuttle.email}  → ${vehicle.busNumber}호차 동승`);
    if (homeroom) console.log(`  담임     ${homeroom.email}  → ${cls} 담임`);
    else console.log('  담임     (원아의 반 정보가 없어 만들지 않음)');
  } finally {
    await app.close();
  }
}

main().catch(err => {
  console.error('테스트 계정 만들기 실패:', err?.message || err);
  process.exit(1);
});
