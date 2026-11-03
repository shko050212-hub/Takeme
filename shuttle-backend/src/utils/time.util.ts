/**
 * 한국 표준시 (KST, UTC+9) 기준 날짜 및 시간 유틸리티
 * 서버가 UTC 환경(EC2, Docker 등)에서 실행되더라도 오전 7~9시 운행 기록이
 * 전날 날짜로 잘못 기록되는 문제를 원천 방지합니다.
 */

export function getKstNow(): Date {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + (9 * 60 * 60 * 1000));
}

export function getKstDateString(date?: Date): string {
  const d = date || new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 60 * 60 * 1000));
  
  const year = kst.getFullYear();
  const month = String(kst.getMonth() + 1).padStart(2, '0');
  const day = String(kst.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getKstTimeString(date?: Date): string {
  const d = date || new Date();
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 60 * 60 * 1000));
  
  const hours = String(kst.getHours()).padStart(2, '0');
  const minutes = String(kst.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

