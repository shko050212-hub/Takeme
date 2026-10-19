import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../lib/AuthContext';
import FormInput from '../lib/FormInput';
import { C, btnPrimary, btnPrimaryText } from '../lib/theme';

/** 관리자 웹 로그인 화면(Landing.jsx)과 같은 구성: 로그인 → (원장) OTP 인증 */
export default function LoginScreen() {
  const { login } = useAuth();
  const [step, setStep] = useState('login'); // login | otp
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) { setError('이메일과 비밀번호를 입력해주세요.'); return; }
    if (step === 'otp' && otp.length !== 6) { setError('6자리 코드를 입력해주세요.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await login(email, password, step === 'otp' ? otp : undefined);
      if (r.status === 'otp') setStep('otp');
      if (r.status === 'otpSetup') setNotice('OTP 연동이 필요합니다. 관리자 웹에서 먼저 연동해주세요.');
      if (r.status === 'pending') setNotice('원장님의 승인을 기다리고 있습니다. 승인 후 다시 로그인해주세요.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const Button = ({ label }) => (
    <Pressable style={[btnPrimary, busy && { opacity: 0.5 }]} onPress={submit} disabled={busy}>
      {busy ? <ActivityIndicator color={C.white} /> : <Text style={btnPrimaryText}>{label}</Text>}
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.center} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.glass}>
          <Text style={styles.logo}>Takeme</Text>
          <Text style={styles.sub}>스마트한 학원 셔틀 시스템</Text>

          {step === 'login' ? (
            <View style={styles.form}>
              <FormInput placeholder="이메일" autoCapitalize="none" keyboardType="email-address"
                value={email} onChangeText={setEmail} editable={!busy} />
              <FormInput placeholder="비밀번호" secureTextEntry
                value={password} onChangeText={setPassword} editable={!busy} />
              {notice && <Text style={styles.notice}>{notice}</Text>}
              {error && <Text style={styles.error}>{error}</Text>}
              <Button label="로그인" />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.otpGuide}>Google OTP 앱을 열고 6자리 코드를 입력해주세요.</Text>
              <FormInput style={styles.otpInput} keyboardType="number-pad" maxLength={6}
                value={otp} onChangeText={setOtp} editable={!busy} />
              {error && <Text style={styles.error}>{error}</Text>}
              <Button label="인증하기" />
              <Pressable onPress={() => { setStep('login'); setOtp(''); setError(null); }}>
                <Text style={styles.back}>뒤로가기</Text>
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.slate100 },
  center: { flex: 1, justifyContent: 'center', padding: 20 },
  // 웹 .landing-glass
  glass: {
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    padding: 32, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 4,
  },
  logo: { fontSize: 30, fontWeight: '700', textAlign: 'center', color: C.blue600, marginBottom: 8 },
  sub: { textAlign: 'center', color: C.slate500, marginBottom: 32 },
  form: { gap: 16 },
  otpGuide: { fontSize: 14, textAlign: 'center', color: C.slate600 },
  otpInput: { textAlign: 'center', fontSize: 24, letterSpacing: 8 },
  back: { textAlign: 'center', color: C.slate500, fontSize: 14, marginTop: 4 },
  notice: { fontSize: 14, color: C.blue700, backgroundColor: C.blue50, borderWidth: 1, borderColor: C.blue100, borderRadius: 12, padding: 10, textAlign: 'center' },
  error: { fontSize: 14, color: C.red600, textAlign: 'center' },
});
