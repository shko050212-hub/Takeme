import * as SecureStore from 'expo-secure-store';

// .env 의 EXPO_PUBLIC_SERVER_URL (예: http://3.25.147.47:3000)
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || process.env.EXPO_PUBLIC_API_URL || 'http://3.25.147.47:3000';

const TOKEN_KEY = 'takeme_token';
const USER_KEY = 'takeme_user';

let currentToken = null;
let onUnauthorized = null;

export const setAuthToken = (token) => { currentToken = token; };
export const getAuthToken = () => currentToken;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// 로그인 정보는 휴대폰의 암호화 저장소에 보관 (앱을 껐다 켜도 로그인 유지)
export async function saveSession(token, user) {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}
export async function loadSession() {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  const user = await SecureStore.getItemAsync(USER_KEY);
  return token && user ? { token, user: JSON.parse(user) } : null;
}
export async function clearSession() {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(USER_KEY);
}

/** 모든 API 요청은 이 함수로: 토큰을 자동으로 붙이고, 오류 메시지를 한국어로 정리 */
export async function api(path, { method = 'GET', body } = {}) {
  if (!SERVER_URL) throw new Error('.env 에 EXPO_PUBLIC_SERVER_URL 이 없어요.');

  let res;
  try {
    res = await fetch(SERVER_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(currentToken ? { Authorization: `Bearer ${currentToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('서버에 연결할 수 없어요. 서버 주소와 와이파이를 확인하세요.');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (res.status === 401 && currentToken && onUnauthorized) onUnauthorized(); // 토큰 만료 → 로그아웃
  if (!res.ok) {
    const msg = data && (Array.isArray(data.message) ? data.message.join(', ') : data.message);
    throw new Error(msg || `요청 실패 (${res.status})`);
  }
  if (typeof data === 'string' && data.trim().startsWith('<')) {
    throw new Error('API 대신 웹 화면이 응답했어요. 서버 주소(포트 3000)를 확인하세요.');
  }
  return data;
}
