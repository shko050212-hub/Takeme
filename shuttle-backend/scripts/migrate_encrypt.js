const { Client } = require('pg');
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const MASTER_SECRET = process.env.ENCRYPTION_KEY || 'TakemeSecureMasterKey2026!@#$';
const KEY = crypto.createHash('sha256').update(MASTER_SECRET).digest();

function encrypt(data) {
  if (data === null || data === undefined) return data;
  const text = typeof data === 'object' ? JSON.stringify(data) : String(data);
  if (!text) return text;
  if (text.startsWith('enc:')) return text; // already encrypted

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return 'enc:' + iv.toString('hex') + ':' + tag + ':' + encrypted;
}

const client = new Client({
  host: 'database-1.cl0cmogqigis.ap-southeast-2.rds.amazonaws.com',
  port: 5432,
  user: 'postgres',
  password: 'root1357..',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to RDS PostgreSQL');

  // 1. Users otpSecret
  const users = await client.query('SELECT id, "otpSecret" FROM users WHERE "otpSecret" IS NOT NULL');
  let usersUpdated = 0;
  for (const u of users.rows) {
    if (u.otpSecret && !u.otpSecret.startsWith('enc:')) {
      const enc = encrypt(u.otpSecret);
      await client.query('UPDATE users SET "otpSecret" = $1 WHERE id = $2', [enc, u.id]);
      usersUpdated++;
    }
  }
  console.log(`Users encrypted: ${usersUpdated} / ${users.rows.length}`);

  // 2. Vehicles driverPhone, teacherPhone
  const vehicles = await client.query('SELECT id, "driverPhone", "teacherPhone" FROM vehicles');
  let vehiclesUpdated = 0;
  for (const v of vehicles.rows) {
    let changed = false;
    let encDriver = v.driverPhone;
    let encTeacher = v.teacherPhone;
    if (v.driverPhone && !v.driverPhone.startsWith('enc:')) {
      encDriver = encrypt(v.driverPhone);
      changed = true;
    }
    if (v.teacherPhone && !v.teacherPhone.startsWith('enc:')) {
      encTeacher = encrypt(v.teacherPhone);
      changed = true;
    }
    if (changed) {
      await client.query('UPDATE vehicles SET "driverPhone" = $1, "teacherPhone" = $2 WHERE id = $3', [encDriver, encTeacher, v.id]);
      vehiclesUpdated++;
    }
  }
  console.log(`Vehicles updated: ${vehiclesUpdated} / ${vehicles.rows.length}`);

  // 3. Students raw data
  const students = await client.query('SELECT id, raw FROM students WHERE raw IS NOT NULL');
  let studentsUpdated = 0;
  for (const s of students.rows) {
    if (s.raw && !s.raw.startsWith('enc:')) {
      const enc = encrypt(s.raw);
      await client.query('UPDATE students SET raw = $1 WHERE id = $2', [enc, s.id]);
      studentsUpdated++;
    }
  }
  console.log(`Students updated: ${studentsUpdated} / ${students.rows.length}`);

  await client.end();
  console.log('ALL MIGRATION TASKS FINISHED SUCCESSFULLY!');
}

run().catch((err) => {
  console.error('Migration error:', err);
  process.exit(1);
});
