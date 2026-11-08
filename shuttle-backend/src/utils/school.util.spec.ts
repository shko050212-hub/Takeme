import {
  getStudentClassName,
  hasAssignedClass,
  isSameClass,
  isValidDateString,
  kstDateString,
  kstTimeString,
} from './school.util';

describe('school.util', () => {
  it('kstDateString: UTC 15시 이후는 한국 시간으로 다음 날', () => {
    expect(kstDateString(new Date('2026-11-08T14:59:59Z'))).toBe('2026-11-08');
    expect(kstDateString(new Date('2026-11-08T15:00:00Z'))).toBe('2026-11-09');
    expect(kstDateString(new Date('2026-12-31T16:00:00Z'))).toBe('2027-01-01');
  });

  it('kstTimeString: 한국 시간 HH:mm', () => {
    expect(kstTimeString(new Date('2026-11-08T06:05:00Z'))).toBe('15:05');
    expect(kstTimeString(new Date('2026-11-08T15:30:00Z'))).toBe('00:30');
  });

  it('isValidDateString: 형식·실제 날짜 검사', () => {
    expect(isValidDateString('2026-11-08')).toBe(true);
    expect(isValidDateString('2026-02-30')).toBe(false);
    expect(isValidDateString('2026-1-8')).toBe(false);
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString(undefined)).toBe(false);
  });

  it('getStudentClassName: raw 가 문자열이든 객체든 반 이름을 읽는다', () => {
    expect(getStudentClassName({ raw: { 반명: ' 햇살반 ' } } as any)).toBe('햇살반');
    expect(getStudentClassName({ raw: JSON.stringify({ 반: '열매반' }) } as any)).toBe('열매반');
    expect(getStudentClassName({ raw: '깨진 json' } as any)).toBe('');
    expect(getStudentClassName({ raw: null } as any)).toBe('');
  });

  it('isSameClass / hasAssignedClass', () => {
    expect(isSameClass('햇살반', ' 햇살반')).toBe(true);
    expect(isSameClass('햇살반', '열매반')).toBe(false);
    expect(isSameClass('', '')).toBe(false);
    expect(isSameClass(undefined, '햇살반')).toBe(false);
    expect(hasAssignedClass('햇살반')).toBe(true);
    expect(hasAssignedClass('미배정')).toBe(false);
    expect(hasAssignedClass(null)).toBe(false);
  });
});

