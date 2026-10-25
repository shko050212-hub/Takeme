const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'shuttle_db.sqlite');
const db = new Database(dbPath);

console.log('Seeding dummy data for shko0502@daum.net...');

const passwordHash = '$2b$10$TR7iiJNN3ns5s10IrNYsVuuh3GAD7WWM/0UGpJbB8LT.Gi4rUKQGG'; // 1234
const now = new Date().toISOString();

// 1. Get or create shko0502@daum.net admin user
let adminUser = db.prepare("SELECT * FROM users WHERE email = 'shko0502@daum.net'").get();
if (!adminUser) {
  const insertUser = db.prepare(`
    INSERT INTO users (email, passwordHash, role, name, isOtpEnabled, createdAt, updatedAt)
    VALUES ('shko0502@daum.net', ?, 'ACADEMY_ADMIN', '고상현', 0, ?, ?)
  `);
  const info = insertUser.run(passwordHash, now, now);
  adminUser = { id: info.lastInsertRowid, email: 'shko0502@daum.net' };
}
console.log('Admin User ID:', adminUser.id);

// 2. Ensure Academy exists and is linked to adminUser
let academy = db.prepare("SELECT * FROM academies WHERE id = 12").get();
if (!academy) {
  academy = db.prepare("SELECT * FROM academies LIMIT 1").get();
}
if (academy) {
  db.prepare(`
    UPDATE academies
    SET name = '마곡 에듀 학원', ownerId = ?, vehicleCount = 8, authCode = 'EOAUH2', updatedAt = ?
    WHERE id = ?
  `).run(adminUser.id, now, academy.id);
} else {
  const info = db.prepare(`
    INSERT INTO academies (name, vehicleCount, roadAddress, latitude, longitude, authCode, ownerId, createdAt, updatedAt)
    VALUES ('마곡 에듀 학원', 8, '마곡중앙로 33', '37.5580501033167', '126.824080226482', 'EOAUH2', ?, ?, ?)
  `).run(adminUser.id, now, now);
  academy = { id: info.lastInsertRowid };
}
const academyId = academy.id;

// 3. Map vehicle numbers to IDs
const existingVehicles = db.prepare("SELECT id, busNumber FROM vehicles").all();
const busMap = {};
for (const v of existingVehicles) {
  busMap[v.busNumber] = v.id;
}
console.log('Vehicle Map:', busMap);

// 4. Setup Staff Users and update Vehicles
const staffData = [
  { busNum: '1호차', plate: '77가 1024', driverName: '김철수', driverPhone: '010-3124-5678', driverEmail: 'driver1@daum.net', teacherName: '이지은', teacherPhone: '010-8765-4321', teacherEmail: 'teacher1@daum.net', status: 'APPROVED' },
  { busNum: '2호차', plate: '77가 2048', driverName: '박영호', driverPhone: '010-2345-6789', driverEmail: 'driver2@daum.net', teacherName: '최수진', teacherPhone: '010-7654-3210', teacherEmail: 'teacher2@daum.net', status: 'APPROVED' },
  { busNum: '3호차', plate: '77가 3072', driverName: '정도현', driverPhone: '010-3456-7890', driverEmail: 'driver3@daum.net', teacherName: '한미래', teacherPhone: '010-6543-2109', teacherEmail: 'teacher3@daum.net', status: 'APPROVED' },
  { busNum: '4호차', plate: '77가 4096', driverName: '강태석', driverPhone: '010-4567-8901', driverEmail: 'driver4@daum.net', teacherName: '윤서연', teacherPhone: '010-5432-1098', teacherEmail: 'teacher4@daum.net', status: 'APPROVED' },
  { busNum: '5호차', plate: '77가 5120', driverName: '조민기', driverPhone: '010-5678-9012', driverEmail: 'driver5@daum.net', teacherName: '백하늘', teacherPhone: '010-4321-0987', teacherEmail: 'teacher5@daum.net', status: 'APPROVED' },
  { busNum: '6호차', plate: '77가 6144', driverName: '오성훈', driverPhone: '010-6789-0123', driverEmail: 'driver6@daum.net', teacherName: '송예원', teacherPhone: '010-3210-9876', teacherEmail: 'teacher6@daum.net', status: 'PENDING' },
  { busNum: '7호차', plate: '77가 7168', driverName: '서준혁', driverPhone: '010-7890-1234', driverEmail: 'driver7@daum.net', teacherName: '안소희', teacherPhone: '010-2109-8765', teacherEmail: 'teacher7@daum.net', status: 'APPROVED' },
  { busNum: '8호차', plate: '77가 8192', driverName: '황재우', driverPhone: '010-8901-2345', driverEmail: 'driver8@daum.net', teacherName: '문가영', teacherPhone: '010-1098-7654', teacherEmail: 'teacher8@daum.net', status: 'APPROVED' },
];

function getOrCreateUser(email, name, role) {
  let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) {
    const info = db.prepare(`
      INSERT INTO users (email, passwordHash, role, name, isOtpEnabled, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 0, ?, ?)
    `).run(email, passwordHash, role, name, now, now);
    return info.lastInsertRowid;
  }
  return user.id;
}

for (const staff of staffData) {
  const vId = busMap[staff.busNum];
  if (!vId) continue;
  const driverUserId = getOrCreateUser(staff.driverEmail, staff.driverName, 'DRIVER');
  const teacherUserId = getOrCreateUser(staff.teacherEmail, staff.teacherName, 'TEACHER');

  db.prepare(`
    UPDATE vehicles
    SET academyId = ?, plateNumber = ?, driverName = ?, driverPhone = ?, teacherName = ?, teacherPhone = ?,
        driverUserId = ?, teacherUserId = ?, driverApprovalStatus = ?, teacherApprovalStatus = ?
    WHERE id = ?
  `).run(
    academyId, staff.plate, staff.driverName, staff.driverPhone, staff.teacherName, staff.teacherPhone,
    driverUserId, teacherUserId, staff.status, staff.status, vId
  );
}
console.log('Vehicles and Staff seeded.');

// 5. Students & Parents Dummy Data
db.prepare("DELETE FROM student_schedules").run();
db.prepare("DELETE FROM students").run();

const studentsList = [
  { name: '김민준', busNum: '1호차', address: '서울 강서구 마곡서로 101', pickup: '마곡엠밸리 7단지 701동 앞', lat: 37.5645, lng: 126.8285, parentEmail: 'parent_minjun@daum.net', studentEmail: 'student_minjun@daum.net', parentPhone: '010-9111-1001', status: 'APPROVED' },
  { name: '이서아', busNum: '3호차', address: '서울 강서구 남부순환로 123', pickup: '수명산파크 3단지 정문', lat: 37.5515, lng: 126.8335, parentEmail: 'parent_seoa@daum.net', studentEmail: 'student_seoa@daum.net', parentPhone: '010-9111-1002', status: 'APPROVED' },
  { name: '박도윤', busNum: '3호차', address: '서울 강서구 강서로 260', pickup: '우장산역 1번 출구', lat: 37.5480, lng: 126.8360, parentEmail: 'parent_doyun@daum.net', studentEmail: 'student_doyun@daum.net', parentPhone: '010-9111-1003', status: 'APPROVED' },
  { name: '최지우', busNum: '2호차', address: '서울 강서구 강서로 56길', pickup: '발산역 3번 출구 NC백화점 앞', lat: 37.5585, lng: 126.8395, parentEmail: 'parent_jiwoo@daum.net', studentEmail: 'student_jiwoo@daum.net', parentPhone: '010-9111-1004', status: 'APPROVED' },
  { name: '정하은', busNum: '7호차', address: '서울 강서구 마곡중앙5로 9', pickup: '마곡나루역 2번 출구', lat: 37.5670, lng: 126.8280, parentEmail: 'parent_haeun@daum.net', studentEmail: 'student_haeun@daum.net', parentPhone: '010-9111-1005', status: 'APPROVED' },
  { name: '강시우', busNum: '8호차', address: '서울 강서구 마곡동 740', pickup: '공진초등학교 정문', lat: 37.5615, lng: 126.8310, parentEmail: 'parent_siwoo@daum.net', studentEmail: 'student_siwoo@daum.net', parentPhone: '010-9111-1006', status: 'APPROVED' },
  { name: '윤예준', busNum: '5호차', address: '서울 강서구 마곡중앙로 55', pickup: '마곡 힐스테이트 정문', lat: 37.5630, lng: 126.8210, parentEmail: 'parent_yejun@daum.net', studentEmail: 'student_yejun@daum.net', parentPhone: '010-9111-1007', status: 'PENDING' },
  { name: '임수아', busNum: '6호차', address: '서울 강서구 방화동 250', pickup: '방화동 신동아아파트 입구', lat: 37.5720, lng: 126.8150, parentEmail: 'parent_sua@daum.net', studentEmail: 'student_sua@daum.net', parentPhone: '010-9111-1008', status: 'PENDING' },
  { name: '한유준', busNum: '4호차', address: '서울 강서구 수명로 68', pickup: '마곡수명산파크 5단지 상가 앞', lat: 37.5505, lng: 126.8290, parentEmail: 'parent_yujun@daum.net', studentEmail: 'student_yujun@daum.net', parentPhone: '010-9111-1009', status: 'APPROVED' },
  { name: '오채원', busNum: '1호차', address: '서울 강서구 공항대로 45길', pickup: '등촌3동 주공아파트 정류장', lat: 37.5605, lng: 126.8450, parentEmail: 'parent_chaewon@daum.net', studentEmail: 'student_chaewon@daum.net', parentPhone: '010-9111-1010', status: 'APPROVED' },
  { name: '송민성', busNum: '2호차', address: '서울 강서구 양천로 431', pickup: '가양역 7번 출구 홈플러스 앞', lat: 37.5620, lng: 126.8540, parentEmail: 'parent_minseong@daum.net', studentEmail: 'student_minseong@daum.net', parentPhone: '010-9111-1011', status: 'APPROVED' },
  { name: '배서윤', busNum: '6호차', address: '서울 강서구 금낭화로 135', pickup: '송화초등학교 후문', lat: 37.5680, lng: 126.8180, parentEmail: 'parent_seoyun@daum.net', studentEmail: 'student_seoyun@daum.net', parentPhone: '010-9111-1012', status: 'APPROVED' },
];

const days = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

for (const s of studentsList) {
  const vId = busMap[s.busNum];
  const pUserId = getOrCreateUser(s.parentEmail, `${s.name} 학부모`, 'PARENT');
  const sUserId = getOrCreateUser(s.studentEmail, s.name, 'STUDENT');

  const insertStudent = db.prepare(`
    INSERT INTO students (
      name, adminDisplayName, address, boardingLocation, latitude, longitude,
      academyId, assignedVehicleId, studentUserId, parentUserId, runNumber,
      approvalStatus, boardStatus, raw
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, 1,
      ?, 'WAITING', ?
    )
  `);

  const rawJson = JSON.stringify({
    '원생명': s.name,
    '주소': s.address,
    '탑승지': s.pickup,
    '학부모연락처': s.parentPhone,
    '등원차량': s.busNum,
    '하원차량': s.busNum
  });

  const res = insertStudent.run(
    s.name, s.name, s.address, s.pickup, s.lat, s.lng,
    academyId, vId, sUserId, pUserId,
    s.status, rawJson
  );

  const studentId = res.lastInsertRowid;

  // Insert Schedules (Mon-Fri Boarding & Alighting)
  const insertSchedule = db.prepare(`
    INSERT INTO student_schedules (studentId, type, dayOfWeek, address, latitude, longitude, isCustomLocation, assignedVehicleId)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `);

  for (const d of days) {
    insertSchedule.run(studentId, 'BOARDING', d, s.pickup, s.lat, s.lng, vId);
    insertSchedule.run(studentId, 'ALIGHTING', d, s.pickup, s.lat, s.lng, vId);
  }
}
console.log('12 Students and Mon-Fri Schedules seeded.');

// 6. Seed Pickup Points if table exists
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('All DB Tables:', tables);

const pickupTable = tables.find(t => t.includes('pickup'));
if (pickupTable) {
  db.prepare(`DELETE FROM ${pickupTable}`).run();
  const pickupPoints = [
    { name: '마곡엠밸리 7단지 앞', lat: 37.5645, lng: 126.8285 },
    { name: '수명산파크 3단지 정문', lat: 37.5515, lng: 126.8335 },
    { name: '우장산역 1번 출구', lat: 37.5480, lng: 126.8360 },
    { name: '발산역 NC백화점 앞', lat: 37.5585, lng: 126.8395 },
    { name: '마곡나루역 2번 출구', lat: 37.5670, lng: 126.8280 },
    { name: '공진초등학교 정문', lat: 37.5615, lng: 126.8310 },
    { name: '마곡 힐스테이트 앞', lat: 37.5630, lng: 126.8210 },
    { name: '가양역 7번 출구', lat: 37.5620, lng: 126.8540 }
  ];

  const cols = db.prepare(`PRAGMA table_info(${pickupTable})`).all().map(c => c.name);
  const hasAcademyId = cols.includes('academy_id') || cols.includes('academyId');
  const academyColName = cols.includes('academy_id') ? 'academy_id' : 'academyId';

  for (const p of pickupPoints) {
    if (hasAcademyId) {
      db.prepare(`INSERT INTO ${pickupTable} (name, latitude, longitude, ${academyColName}, createdAt) VALUES (?, ?, ?, ?, ?)`).run(p.name, p.lat, p.lng, academyId, now);
    } else {
      db.prepare(`INSERT INTO ${pickupTable} (name, latitude, longitude, createdAt) VALUES (?, ?, ?, ?)`).run(p.name, p.lat, p.lng, now);
    }
  }
  console.log(`Pickup Points seeded in ${pickupTable}.`);
}

console.log('All dummy data successfully created!');
