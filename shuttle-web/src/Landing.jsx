import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from './config';

export default function Landing() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'otp' | 'otp-setup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('ACADEMY_ADMIN');
  const [otpToken, setOtpToken] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [userId, setUserId] = useState(null);
  
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
      alert('인증이 완료되었습니다.');
      setIsEmailVerified(true);
    } else alert('인증 실패. 다시 시도해주세요.');
  };

  const validatePassword = (pw) => {
    // English + Number + Special Char
    const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    return regex.test(pw);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!isEmailVerified) return alert('이메일 인증을 완료해주세요.');
    if (!role) return alert('역할을 선택해주세요.');
    if (!validatePassword(password)) return alert('비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.');

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
      alert('OTP 연동이 완료되었습니다! 로그인해주세요.');
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
        localStorage.setItem('takeme_user', JSON.stringify(data.user));
        navigate('/dashboard');
      }
    } else {
      alert(data.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center relative overflow-hidden">
      {/* Background emojis */}
      <div className="absolute top-10 left-10 text-6xl opacity-20">🚌</div>
      <div className="absolute top-20 right-20 text-6xl opacity-20">🏫</div>
      <div className="absolute bottom-20 left-1/4 text-6xl opacity-20">📚</div>
      <div className="absolute bottom-10 right-10 text-6xl opacity-20">✏️</div>

      <div className="landing-glass w-full max-w-md p-8 relative z-10">
        <h1 className="text-3xl font-bold text-center mb-2 text-blue-600">Takeme</h1>
        <p className="text-center text-slate-500 mb-8">스마트한 학원 셔틀 시스템</p>

        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <input type="email" placeholder="이메일" value={email} onChange={e=>setEmail(e.target.value)} className="form-input" required />
            <input type="password" placeholder="비밀번호" value={password} onChange={e=>setPassword(e.target.value)} className="form-input" required />
            <button type="submit" className="btn-primary w-full py-3">로그인</button>
            <div className="text-center mt-4">
              <button type="button" onClick={() => setMode('signup')} className="text-sm text-blue-600 hover:underline">회원가입</button>
            </div>
          </form>
        )}

        {mode === 'otp' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <p className="text-sm text-center text-slate-600 mb-4">Google OTP 앱을 열고 6자리 코드를 입력해주세요.</p>
            <input type="text" placeholder="6자리 OTP 번호" maxLength={6} value={otpToken} onChange={e=>setOtpToken(e.target.value)} className="form-input text-center text-2xl tracking-widest" required />
            <button type="submit" className="btn-primary w-full py-3">인증하기</button>
            <button type="button" onClick={() => setMode('login')} className="w-full text-slate-500 text-sm mt-2">뒤로가기</button>
          </form>
        )}

        {mode === 'otp-setup' && (
          <form onSubmit={handleOtpSetup} className="space-y-4">
            <h3 className="font-bold text-center">Google OTP 연동</h3>
            <p className="text-xs text-slate-500 text-center">아래 QR코드를 Google Authenticator 앱에서 스캔하세요.</p>
            <div className="flex justify-center my-4">
              {qrCodeUrl && <img src={qrCodeUrl} alt="OTP QR Code" className="w-48 h-48 border rounded" />}
            </div>
            <input type="text" placeholder="앱에 표시된 6자리 번호" maxLength={6} value={otpToken} onChange={e=>setOtpToken(e.target.value)} className="form-input text-center tracking-widest" required />
            <button type="submit" className="btn-primary w-full py-3">연동 완료하기</button>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignup} className="space-y-4">
            <p className="text-center text-sm font-bold text-blue-600 bg-blue-50 py-2 rounded-xl border border-blue-100">원장님 전용 회원가입</p>

            <div className="flex gap-2">
              <input type="email" placeholder="이메일" value={email} onChange={e=>setEmail(e.target.value)} className="form-input" required disabled={isEmailVerified || isEmailSending}/>
              <button 
                type="button" 
                onClick={handleSendEmail} 
                disabled={isEmailVerified || isEmailSending} 
                className="px-4 py-2 bg-slate-200 text-sm rounded-xl font-medium shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isEmailSending ? '전송중...' : '인증 발송'}
              </button>
            </div>
            
            {isEmailSent && !isEmailVerified && (
              <div className="flex gap-2">
                <input type="text" placeholder="인증코드 6자리" value={emailCode} onChange={e=>setEmailCode(e.target.value)} className="form-input" required />
                <button type="button" onClick={handleVerifyEmail} className="px-4 py-2 bg-blue-100 text-blue-700 text-sm rounded-xl font-medium shrink-0">확인</button>
              </div>
            )}

            <input type="text" placeholder="이름" value={name} onChange={e=>setName(e.target.value)} className="form-input" required />
            
            <div>
              <input type="password" placeholder="비밀번호 (영문, 숫자, 특수문자)" value={password} onChange={e=>setPassword(e.target.value)} className="form-input" required />
              {password && !validatePassword(password) && (
                <p className="text-xs text-red-500 mt-1 pl-1">영문, 숫자, 특수문자를 모두 포함해야 합니다.</p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full py-3" disabled={!isEmailVerified || !validatePassword(password)}>회원가입</button>
            <div className="text-center mt-4">
              <button type="button" onClick={() => setMode('login')} className="text-sm text-slate-500 hover:underline">뒤로가기</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
