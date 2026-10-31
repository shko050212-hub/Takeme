import React from 'react';

/**
 * 전화번호 포맷 정제 (e.g. 01012345678 -> 010-1234-5678)
 */
export function formatPhoneClean(phone) {
  if (!phone) return '';
  const str = String(phone).trim();
  const digits = str.replace(/[^0-9]/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    if (digits.startsWith('02')) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
    }
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return str;
}

/**
 * 학생 동명이인 판별 및 표기 포맷
 * 학생이 동명이인 = 김민수(부모님 전화번호)
 */
export function getStudentDisambiguation(student, allStudents = []) {
  if (!student || (!student.name && !student.realName)) {
    return { isDuplicate: false, displayName: '', rawName: '', phone: '' };
  }

  // 괄호 안에 이미 들어간 정보나 접미사가 있을 경우 기본 이름만 추출
  const rawName = String(student.realName || student.name).replace(/\([^\)]*\)/g, '').trim();
  if (!rawName) {
    return { isDuplicate: false, displayName: '', rawName: '', phone: '' };
  }

  const duplicates = (allStudents || []).filter(s => {
    if (!s) return false;
    const otherName = String(s.realName || s.name).replace(/\([^\)]*\)/g, '').trim();
    return otherName === rawName;
  });
  const isDuplicate = duplicates.length > 1;

  if (!isDuplicate) {
    return { isDuplicate: false, displayName: rawName, rawName, phone: '' };
  }

  const phone = student.parentPhone ||
    student.phone ||
    student.parentUser?.phone ||
    student.raw?.['부모연락처'] ||
    student.raw?.['연락처'] ||
    student.raw?.['보호자연락처'] ||
    student.raw?.['보호자 연락처'] ||
    student.raw?.['전화번호'] ||
    student.raw?.['학부모전화번호'] ||
    student.raw?.['휴대폰번호'] ||
    '';

  const cleanPhone = phone && phone !== '000-0000-0000'
    ? formatPhoneClean(phone)
    : '부모님 전화번호 미등록';

  return {
    isDuplicate: true,
    displayName: `${rawName}(${cleanPhone})`,
    rawName,
    phone: cleanPhone
  };
}

/**
 * 교사 동명이인 판별 및 표기 포맷
 * 교사가 동명이인 = 김민수(전화번호,~반 담임)
 */
export function getTeacherDisambiguation(teacher, allTeachers = []) {
  if (!teacher || !teacher.name) {
    return { isDuplicate: false, displayName: '', rawName: '', phone: '', cls: '' };
  }

  const rawName = String(teacher.name).replace(/\([^\)]*\)/g, '').trim();
  if (!rawName) {
    return { isDuplicate: false, displayName: '', rawName: '', phone: '', cls: '' };
  }

  const duplicates = (allTeachers || []).filter(t => {
    if (!t || !t.name) return false;
    const otherName = String(t.name).replace(/\([^\)]*\)/g, '').trim();
    return otherName === rawName;
  });
  const isDuplicate = duplicates.length > 1;

  if (!isDuplicate) {
    return { isDuplicate: false, displayName: rawName, rawName, phone: '', cls: '' };
  }

  const phone = teacher.phone && teacher.phone !== '000-0000-0000'
    ? formatPhoneClean(teacher.phone)
    : '';

  const assignedClass = teacher.assignedClass && String(teacher.assignedClass).trim() && teacher.assignedClass.trim() !== '미배정'
    ? teacher.assignedClass.trim()
    : '';
  const cls = assignedClass ? `${assignedClass} 담임` : '반 미배정';

  const details = [phone, cls].filter(Boolean).join(', ') || '정보 미등록';
  return {
    isDuplicate: true,
    displayName: `${rawName}(${details})`,
    rawName,
    phone,
    cls
  };
}

/**
 * 기사 및 지도교사 동명이인 판별 및 표기 포맷
 * 기사 및 지도교사가 동명이인 = 김민수(전화번호,~호차 기사,지도교사)
 */
export function getDriverDisambiguation(bus, allBuses = []) {
  const driverName = bus && bus.driverName ? String(bus.driverName).replace(/\([^\)]*\)/g, '').trim() : '';
  if (!driverName || ['미정', '미등록'].includes(driverName)) {
    return { isDuplicate: false, displayName: driverName || '미등록', rawName: '', phone: '' };
  }

  // 기사 및 지도교사 전체에서 동일 이름 발생 여부 집계
  let count = 0;
  (allBuses || []).forEach(b => {
    if (!b) return;
    const d = b.driverName ? String(b.driverName).replace(/\([^\)]*\)/g, '').trim() : '';
    const t = b.teacherName ? String(b.teacherName).replace(/\([^\)]*\)/g, '').trim() : '';
    if (d && !['미정', '미등록'].includes(d) && d === driverName) count++;
    if (t && !['미정', '미등록'].includes(t) && t === driverName) count++;
  });

  const isDuplicate = count > 1;
  if (!isDuplicate) {
    return { isDuplicate: false, displayName: driverName, rawName: driverName, phone: '' };
  }

  const phone = (bus.driverPhone && bus.driverPhone !== '000-0000-0000' ? bus.driverPhone : bus.driverUser?.phone) || '';
  const cleanPhone = phone ? formatPhoneClean(phone) : '';
  const roleText = `${bus.busNumber || bus.name || '호차'} 기사`;
  const details = [cleanPhone, roleText].filter(Boolean).join(', ');

  return {
    isDuplicate: true,
    displayName: `${driverName}(${details})`,
    rawName: driverName,
    phone: cleanPhone
  };
}

export function getShuttleTeacherDisambiguation(bus, allBuses = []) {
  const teacherName = bus && bus.teacherName ? String(bus.teacherName).replace(/\([^\)]*\)/g, '').trim() : '';
  if (!teacherName || ['미정', '미등록'].includes(teacherName)) {
    return { isDuplicate: false, displayName: teacherName || '미등록', rawName: '', phone: '' };
  }

  // 기사 및 지도교사 전체에서 동일 이름 발생 여부 집계
  let count = 0;
  (allBuses || []).forEach(b => {
    if (!b) return;
    const d = b.driverName ? String(b.driverName).replace(/\([^\)]*\)/g, '').trim() : '';
    const t = b.teacherName ? String(b.teacherName).replace(/\([^\)]*\)/g, '').trim() : '';
    if (d && !['미정', '미등록'].includes(d) && d === teacherName) count++;
    if (t && !['미정', '미등록'].includes(t) && t === teacherName) count++;
  });

  const isDuplicate = count > 1;
  if (!isDuplicate) {
    return { isDuplicate: false, displayName: teacherName, rawName: teacherName, phone: '' };
  }

  const phone = (bus.teacherPhone && bus.teacherPhone !== '000-0000-0000' ? bus.teacherPhone : bus.teacherUser?.phone) || '';
  const cleanPhone = phone ? formatPhoneClean(phone) : '';
  const roleText = `${bus.busNumber || bus.name || '호차'} 지도교사`;
  const details = [cleanPhone, roleText].filter(Boolean).join(', ');

  return {
    isDuplicate: true,
    displayName: `${teacherName}(${details})`,
    rawName: teacherName,
    phone: cleanPhone
  };
}

/**
 * 노란색 이름 표시 뱃지 컴포넌트
 * 동명이인일 시 눈에 잘 띄는 노란색 배경 및 테두리로 이름 칸 표시
 */
export function DisambiguatedNameTag({ info, className = '', defaultColor = 'text-slate-800' }) {
  if (!info) return null;
  if (info.isDuplicate) {
    return (
      <span
        title="동명이인 - 세부 정보(전화번호/소속)로 구분 표기"
        className={`inline-flex items-center gap-1 bg-yellow-300 text-yellow-950 font-extrabold px-2 py-0.5 rounded border border-yellow-500 shadow-xs text-xs sm:text-sm ${className}`}
      >
        {info.displayName}
      </span>
    );
  }
  return <span className={`${defaultColor} ${className}`}>{info.displayName}</span>;
}
