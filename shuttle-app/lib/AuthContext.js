import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearSession, loadSession, saveSession, setAuthToken, setUnauthorizedHandler } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, token: null, user: null });

  const logout = useCallback(async () => {
    setAuthToken(null);
    await clearSession();
    setState({ loading: false, token: null, user: null });
  }, []);

  // 앱 시작 시 저장된 로그인 정보 복원
  useEffect(() => {
    setUnauthorizedHandler(logout);
    (async () => {
      try {
        const session = await loadSession();
        if (session) {
          setAuthToken(session.token);
          setState({ loading: false, ...session });
          return;
        }
      } catch {}
      setState({ loading: false, token: null, user: null });
    })();
  }, [logout]);

  /**
   * 반환값 status
   *  ok        : 로그인 완료
   *  otp       : OTP 6자리 입력 필요 (원장 계정)
   *  otpSetup  : OTP 최초 등록 필요 → 웹에서 등록
   *  pending   : 원장 승인 대기
   */
  const login = useCallback(async (email, password, otpToken) => {
    const data = await api('/auth/login', {
      method: 'POST',
      body: { email: email.trim(), password, ...(otpToken ? { otpToken } : {}) },
    });
    if (data?.requireOtpSetup) return { status: 'otpSetup' };
    if (data?.requireOtp) return { status: 'otp' };
    if (data?.requireApproval) return { status: 'pending', user: data.user };
    if (data?.accessToken) {
      await saveSession(data.accessToken, data.user);
      setAuthToken(data.accessToken);
      setState({ loading: false, token: data.accessToken, user: data.user });
      return { status: 'ok' };
    }
    throw new Error('로그인 응답이 올바르지 않아요. 서버에 토큰 인증이 적용됐는지 확인하세요.');
  }, []);

  return <AuthContext.Provider value={{ ...state, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
