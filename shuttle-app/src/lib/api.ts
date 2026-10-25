import { Platform } from 'react-native';

/**
 * 서버 주소 (모든 화면 공통)
 * shuttle-app/.env 의 EXPO_PUBLIC_API_URL 을 사용. 예) http://192.168.35.161:3000
 */
export const API_HOST =
  Platform.OS === 'web'
    ? 'http://localhost:3000'
    : process.env.EXPO_PUBLIC_API_URL || 'http://192.168.35.233:3000';

/**
 * 로그인 토큰 (JWT)
 * 서버의 /parent, /teacher API와 실시간 위치 소켓은 토큰이 있어야 동작한다.
 * 로그인 성공 시 setAccessToken 으로 저장하고, 로그아웃·탈퇴 시 null 로 지운다.
 */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

/** fetch 와 사용법은 같고, 로그인 토큰을 Authorization 헤더에 자동으로 붙인다. */
export function authFetch(url: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(url, { ...init, headers });
}

/** 실시간 위치 소켓 연결 옵션 (토큰 포함) */
export const socketOptions = () => ({ auth: { token: accessToken } });
