import { Student } from '../entities/student.entity';

export const HOMEROOM_ROLE = 'HOMEROOM_TEACHER';
export const ADMIN_ROLES = ['SUPER_ADMIN', 'ACADEMY_ADMIN'];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간(KST) 기준 오늘 날짜 (YYYY-MM-DD). 서버 시간대와 상관없이 동작한다. */
export function kstDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 한국 시간 HH:mm */
export function kstTimeString(date: Date = new Date()): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(11, 16);
}

/** YYYY-MM-DD 형식이면서 실제로 존재하는 날짜인지 */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 학생 raw(암호화 컬럼: 문자열 또는 객체) → 객체 */
export function parseStudentRaw(student: Pick<Student, 'raw'>): Record<string, any> {
  let raw: any = student?.raw;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

/** 원아 반 이름 (raw 의 '반명' → '반' → '학급'). 없으면 빈 문자열 */
export function getStudentClassName(student: Pick<Student, 'raw'>): string {
  const raw = parseStudentRaw(student);
  return String(raw['반명'] ?? raw['반'] ?? raw['학급'] ?? '').trim();
}

/** 두 반 이름이 같은지 (공백 제거 후 비교, 둘 다 비어 있으면 다른 것으로 본다) */
export function isSameClass(a?: string | null, b?: string | null): boolean {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  return x.length > 0 && x === y;
}

/** 반이 실제로 지정된 값인지 ('미배정' 은 지정 안 된 것) */
export function hasAssignedClass(value?: string | null): boolean {
  const v = String(value ?? '').trim();
  return v.length > 0 && v !== '미배정';
}

