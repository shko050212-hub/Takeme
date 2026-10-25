import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './config';

export default function Landing() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'otp' | 'otp-setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('ACADEMY_ADMIN'); // 'ACADEMY_ADMIN' | 'TEACHER'
  const [otpToken, setOtpToken] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [userId, setUserId] = useState(null);
  
  // Teacher Registration Specific State
  const [authCode, setAuthCode] = useState('');
  const [isAuthCodeVerified, setIsAuthCodeVerified] = useState(false);
  const [isVerifyingAuthCode, setIsVerifyingAuthCode] = useState(false);
  const [verifiedAcademyName, setVerifiedAcademyName] = useState('');

  // Email Verification
  const [emailCode, setEmailCode] = useState('');
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isEmailSending, setIsEmailSending] = useState(false);

  const navigate = useNavigate();

  const handleSendEmail = async () => {
    if (!email.includes('@')) return alert('유효한 이메일을 입력해주세요.');
    setIsEmailSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (res.ok) {
        alert('인증 코드가 이메일로 전송되었습니다. 메일함을 확인해주세요.');
        setIsEmailSent(true);
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('서버 연결에 실패했습니다.');
    } finally {
      setIsEmailSending(false);
    }
  };

  const handleVerifyEmail = async () => {
    const res = await fetch(`${API_BASE_URL}/auth/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: emailCode })
    });
    if (res.ok) {
      alert('이메일 인증이 완료되었습니다.');
      setIsEmailVerified(true);
    } else alert('인증 실패. 다시 시도해주세요.');
  };

  const handleVerifyAuthCode = async () => {
    if (!authCode || !authCode.trim()) return alert('원 인증코드를 입력해주세요.');
    setIsVerifyingAuthCode(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/verify-auth-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authCode: authCode.trim().toUpperCase() })
      });
      const data = await res.json();
      if (res.ok) {
        setIsAuthCodeVerified(true);
        setVerifiedAcademyName(data.academyName);
        alert(`[${data.academyName}] 소속 인증이 완료되었습니다.`);
      } else {
        alert(data.message || '원 인증코드 확인에 실패했습니다.');
      }
    } catch (err) {
      alert('인증코드 확인 중 서버 오류가 발생했습니다.');
    } finally {
      setIsVerifyingAuthCode(false);
    }
  };

  const validatePassword = (pw) => {
    const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    return regex.test(pw);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!isEmailVerified) return alert('이메일 인증을 완료해주세요.');
    if (!role) return alert('역할을 선택해주세요.');
    if (!validatePassword(password)) return alert('비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.');

    if (role === 'TEACHER') {
      if (!isAuthCodeVerified) return alert('원 인증코드를 먼저 확인해주세요.');

      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          password, 
          name, 
          role: 'TEACHER', 
          authCode: authCode.trim().toUpperCase()
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert(data.message || '교사 회원가입이 완료되었습니다! 원장선생님의 반 배정 후 이용 가능합니다.');
        setMode('login');
        setPassword('');
      } else {
        alert(data.message || '회원가입에 실패했습니다.');
      }
      return;
    }

    // ACADEMY_ADMIN
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role })
    });
    const data = await res.json();
    if (res.ok) {
      setUserId(data.userId);
      setQrCodeUrl(data.qrCodeUrl);
      setMode('otp-setup');
    } else {
      alert(data.message);
    }
  };

  const handleOtpSetup = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token: otpToken })
    });
    if (res.ok) {
      alert('OTP 연동이 완료되었습니다. 로그인해주세요.');
      setMode('login');
      setPassword('');
      setOtpToken('');
    } else {
      alert('OTP 코드가 올바르지 않습니다.');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, otpToken: mode === 'otp' ? otpToken : undefined })
    });
    const data = await res.json();
    
    if (res.ok) {
      if (data.requireOtp) {
        setMode('otp');
      } else if (data.requireOtpSetup) {
        setUserId(data.userId);
        setQrCodeUrl(data.qrCodeUrl);
        setMode('otp-setup');
      } else {
        localStorage.removeItem('takeme_academy');
        localStorage.removeItem('takeme_buses');
        if (data.accessToken) {
          localStorage.setItem('takeme_token', data.accessToken);
        }
        localStorage.setItem('takeme_user', JSON.stringify({
          ...data.user,
          accessToken: data.accessToken || null
        }));
        navigate('/dashboard');
      }
    } else {
      alert(data.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center relative overflow-hidden py-8 px-4">
      <div className="landing-glass w-full max-w-md p-8 relative z-10 bg-white/95 backdrop-blur-md rounded-2xl shadow-xl border border-slate-200">
        <h1 className="text-3xl font-extrabold text-center mb-1 text-blue-600 tracking-tight">Takeme</h1>
        <p className="text-center text-slate-500 mb-6 text-sm">유치원 안심 통학 셔틀 & 원아 안심 케어 시스템</p>

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">이메일</label>
              <input type="email" placeholder="user@example.com" value={email} onChange={e=>setEmail(e.target.value)} className="form-input" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">비밀번호</label>
              <input type="password" placeholder="비밀번호 입력" value={password} onChange={e=>setPassword(e.target.value)} className="form-input" required />
            </div>
            <button type="submit" className="btn-primary w-full py-3 text-base font-bold shadow-md shadow-blue-500/20">로그인</button>
            <div className="text-center mt-4">
              <button type="button" onClick={() => { setMode('signup'); setRole('ACADEMY_ADMIN'); }} className="text-sm font-medium text-blue-600 hover:underline">
                회원가입
              </button>
            </div>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <p className="text-sm text-center text-slate-600 mb-4">Google OTP 앱을 열고 6자리 코드를 입력해주세요.</p>
            <input type="text" placeholder="6자리 OTP 번호" maxLength={6} value={otpToken} onChange={e=>setOtpToken(e.target.value)} className="form-input text-center text-2xl tracking-widest font-mono" required />
            <button type="submit" className="btn-primary w-full py-3 font-bold">인증하기</button>
            <button type="button" onClick={() => setMode('login')} className="w-full text-slate-500 text-sm mt-2">뒤로가기</button>
          </form>
        )}

        {mode === 'otp-setup' && (
          <form onSubmit={handleOtpSetup} className="space-y-4">
            <h3 className="font-bold text-center text-slate-800">Google OTP 2단계 보안 연동</h3>
            <p className="text-xs text-slate-500 text-center">아래 QR코드를 Google Authenticator 앱에서 스캔하세요.</p>
            <div className="flex justify-center my-4">
              {qrCodeUrl && <img src={qrCodeUrl} alt="OTP QR Code" className="w-48 h-48 border rounded-xl shadow-sm" />}
            </div>
            <input type="text" placeholder="앱에 표시된 6자리 번호" maxLength={6} value={otpToken} onChange={e=>setOtpToken(e.target.value)} className="form-input text-center tracking-widest font-mono text-xl" required />
            <button type="submit" className="btn-primary w-full py-3 font-bold">연동 완료하기</button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignup} className="space-y-4">
            {/* Role Switcher */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">가입 유형 선택</label>
              <div className="flex bg-slate-100 p-1 rounded-xl gap-1 border border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setRole('ACADEMY_ADMIN');
                    setIsAuthCodeVerified(false);
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    role === 'ACADEMY_ADMIN'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span>원장선생님</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRole('TEACHER');
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    role === 'TEACHER'
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <span>유치원 교사</span>
                </button>
              </div>
            </div>

            {role === 'ACADEMY_ADMIN' ? (
              <p className="text-xs font-medium text-blue-700 bg-blue-50 py-2 px-3 rounded-lg border border-blue-100">
                가입 즉시 새로운 유치원 관리 대시보드가 생성됩니다.
              </p>
            ) : (
              <p className="text-xs font-medium text-emerald-700 bg-emerald-50 py-2 px-3 rounded-lg border border-emerald-100">
                원장선생님께 전달받은 <strong>원 인증코드</strong>를 입력해주세요.
              </p>
            )}

            {/* Teacher Specific: Kindergarten Auth Code */}
            {role === 'TEACHER' && (
              <div className="space-y-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  원 인증코드 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="원 인증코드 6자리 (예: EOAUH2)"
                    value={authCode}
                    onChange={e => {
                      setAuthCode(e.target.value.toUpperCase());
                      setIsAuthCodeVerified(false);
                    }}
                    disabled={isAuthCodeVerified || isVerifyingAuthCode}
                    className="form-input uppercase tracking-wider font-mono font-semibold"
                    maxLength={10}
                    required
                  />
                  <button
                    type="button"
                    onClick={handleVerifyAuthCode}
                    disabled={isAuthCodeVerified || isVerifyingAuthCode}
                    className={`px-3 py-2 text-xs font-bold rounded-xl shrink-0 transition-colors ${
                      isAuthCodeVerified 
                        ? 'bg-emerald-100 text-emerald-800' 
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isVerifyingAuthCode ? '확인 중...' : isAuthCodeVerified ? '인증완료' : '코드 확인'}
                  </button>
                </div>
                {isAuthCodeVerified && (
                  <div className="text-xs font-semibold text-emerald-600 pt-0.5">
                    소속: <strong>{verifiedAcademyName}</strong> (가입 후 원장선생님께서 담당 반을 배정합니다)
                  </div>
                )}
              </div>
            )}

            {/* Email + Verification */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">이메일 계정</label>
              <div className="flex gap-2">
                <input 
                  type="email" 
                  placeholder="user@example.com" 
                  value={email} 
                  onChange={e=>setEmail(e.target.value)} 
                  className="form-input" 
                  required 
                  disabled={isEmailVerified || isEmailSending}
                />
                <button 
                  type="button" 
                  onClick={handleSendEmail} 
                  disabled={isEmailVerified || isEmailSending} 
                  className="px-3 py-2 bg-slate-200 text-xs font-bold rounded-xl shrink-0 hover:bg-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isEmailSending ? '전송중...' : isEmailVerified ? '인증완료' : '인증 발송'}
                </button>
              </div>
            </div>
            
            {isEmailSent && !isEmailVerified && (
              <div className="flex gap-2 p-2 bg-blue-50/60 rounded-xl border border-blue-100">
                <input 
                  type="text" 
                  placeholder="메일 인증코드 6자리" 
                  value={emailCode} 
                  onChange={e=>setEmailCode(e.target.value)} 
                  className="form-input text-center font-mono font-bold" 
                  required 
                />
                <button 
                  type="button" 
                  onClick={handleVerifyEmail} 
                  className="px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl shrink-0 hover:bg-blue-700"
                >
                  확인
                </button>
              </div>
            )}

            {/* Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                {role === 'ACADEMY_ADMIN' ? '원장선생님 성함' : '선생님 성함'}
              </label>
              <input 
                type="text" 
                placeholder={role === 'ACADEMY_ADMIN' ? '홍길동' : '김선생'} 
                value={name} 
                onChange={e=>setName(e.target.value)} 
                className="form-input" 
                required 
              />
            </div>
            
            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">비밀번호</label>
              <input 
                type="password" 
                placeholder="영문, 숫자, 특수문자 포함 8자 이상" 
                value={password} 
                onChange={e=>setPassword(e.target.value)} 
                className="form-input" 
                required 
              />
              {password && !validatePassword(password) && (
                <p className="text-xs text-red-500 mt-1 pl-1">영문, 숫자, 특수문자를 모두 포함(8자 이상)해야 합니다.</p>
              )}
            </div>

            <button 
              type="submit" 
              className="btn-primary w-full py-3 font-bold text-sm shadow-md shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed" 
              disabled={!isEmailVerified || !validatePassword(password) || (role === 'TEACHER' && !isAuthCodeVerified)}
            >
              {role === 'ACADEMY_ADMIN' ? '원장선생님 가입 완료' : '유치원 교사 가입 완료'}
            </button>
            <div className="text-center mt-3">
              <button type="button" onClick={() => setMode('login')} className="text-xs font-semibold text-slate-500 hover:underline">
                이미 계정이 있으신가요? 로그인하기
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
