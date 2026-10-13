import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from './entities/user.entity';
import { Academy } from './entities/academy.entity';
import { Vehicle } from './entities/vehicle.entity';
import { Student } from './entities/student.entity';
import { StudentSchedule } from './entities/student-schedule.entity';
import { PickupPoint } from './entities/pickup-point.entity';

const VEHICLE_POLYGONS: Record<string, any[]> = {
  '1호차': [[37.56876, 126.84081], [37.56570, 126.84763], [37.56375, 126.85928], [37.56173, 126.86158], [37.55880, 126.84109], [37.57222, 126.83841], [37.56285, 126.85082], [37.55933, 126.84034], [37.56453, 126.84712], [37.56221, 126.85852], [37.56876, 126.84081]],
  '2호차': [[37.56009, 126.83830], [37.56298, 126.83920], [37.56632, 126.84017], [37.55811, 126.83977], [37.55826, 126.84432], [37.55768, 126.83893], [37.54472, 126.86159], [37.54766, 126.86271], [37.55846, 126.85481], [37.56152, 126.85506], [37.54983, 126.86343]],
  '3호차': [[37.55303, 126.84851], [37.55096, 126.84953], [37.55390, 126.85163], [37.54782, 126.83343], [37.54145, 126.83662], [37.54426, 126.84219]],
  '4호차': [[37.55347, 126.82644], [37.54716, 126.83679], [37.54826, 126.84098], [37.54976, 126.82476]],
  '5호차': [[37.57474, 126.82019], [37.55707, 126.81220], [37.56147, 126.81105], [37.56131, 126.81588], [37.55639, 126.81544]],
  '6호차': [[37.56699, 126.81705], [37.56939, 126.81150], [37.57744, 126.81243], [37.56355, 126.81049], [37.56711, 126.81256], [37.57101, 126.81079], [37.56555, 126.81330], [37.57533, 126.81113]],
  '7호차': [[37.56455, 126.82383], [37.56768, 126.82597], [37.56930, 126.82559]],
  '8호차': [[37.55805, 126.82408], [37.55741, 126.82702], [37.55855, 126.82715], [37.56039, 126.82750], [37.55900, 126.82392], [37.55997, 126.83380], [37.55847, 126.82570], [37.55946, 126.82443], [37.55909, 126.82799], [37.55882, 126.83100]],
};

async function bootstrap() {
  console.log('Connecting to database and verifying production state...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const userRepo: Repository<User> = app.get(getRepositoryToken(User));
  const academyRepo: Repository<Academy> = app.get(getRepositoryToken(Academy));
  const vehicleRepo: Repository<Vehicle> = app.get(getRepositoryToken(Vehicle));
  const studentRepo: Repository<Student> = app.get(getRepositoryToken(Student));

  // 1. Verify Director User exists
  const adminUser = await userRepo.findOne({ where: { email: 'shko0502@daum.net' } });
  if (!adminUser) {
    console.error('Director user not found.');
    await app.close();
    return;
  }
  console.log('Director verified:', adminUser.email, adminUser.name);

  // 2. Ensure Academy is linked to Director
  let academy = await academyRepo.findOne({ where: { owner: { id: adminUser.id } } });
  if (!academy) {
    academy = await academyRepo.findOne({ where: {} });
    if (academy) {
      academy.owner = adminUser;
      await academyRepo.save(academy);
    }
  }
  console.log('Production Academy verified:', academy?.name, 'AuthCode:', academy?.authCode);

  // 3. Reset vehicle links so real staff register themselves
  await vehicleRepo.update({}, {
    driverUser: null as any,
    teacherUser: null as any,
    driverApprovalStatus: 'UNREGISTERED',
    teacherApprovalStatus: 'UNREGISTERED'
  });

  // 4. Reset student links so real parents/students register themselves
  await studentRepo.update({}, {
    studentUser: null as any,
    parentUser: null as any,
    approvalStatus: 'UNREGISTERED'
  });

  // 5. Clean up any dummy user accounts
  await userRepo.createQueryBuilder()
    .delete()
    .where('email != :email', { email: 'shko0502@daum.net' })
    .execute();

  console.log('Production database cleaned and verified.');
  await app.close();
}

bootstrap().catch(console.error);
