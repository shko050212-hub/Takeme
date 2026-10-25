import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { API_HOST } from '../lib/api';

// API Host for development testing (Mobile needs IP instead of localhost)

export default function RegisterScreen() {
  const router = useRouter();
  
  // UI States for Email Verification
  const [authCode, setAuthCode] = useState('');
  const [role, setRole] = useState('STUDENT');
  const [name, setName] = useState('');
  const [parentName, setParentName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [isEmailVerified, setIsEmailVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSendVerification = async () => {
    if (!email.includes('@')) return showAlert('오류', '유효한 이메일을 입력해주세요.');
    setIsLoading(true);
    
    try {
      const res = await fetch(`${API_HOST}/auth/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      
      if (res.ok) {
        setIsEmailSent(true);
        // Show preview URL so the user can easily see the Ethereal test email in dev mode
        showAlert('안내', data.previewUrl ? data.previewUrl : '인증 코드가 이메일로 전송되었습니다. 메일함을 확인해주세요.');
      } else {
        showAlert('오류', data.message);
      }
    } catch (err) {
      showAlert('오류', '서버 연결에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode) return showAlert('오류', '인증코드를 입력해주세요.');
    setIsLoading(true);
    
    try {
      const res = await fetch(`${API_HOST}/auth/email/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: verificationCode })
      });
      
      if (res.ok) {
        setIsEmailVerified(true);
        showAlert('성공', '이메일 인증이 완료되었습니다!');
      } else {
        showAlert('오류', '인증 실패. 다시 시도해주세요.');
      }
    } catch (err) {
      showAlert('오류', '서버 연결에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  const validatePassword = (pw) => {
    // English + Number + Special Char, min 8 chars
    const regex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/;
    return regex.test(pw);
  };

  const handleRegister = async () => {
    if (!isEmailVerified) return showAlert('오류', '먼저 이메일 인증을 완료해주세요.');
    if (!authCode) return showAlert('오류', '원 인증코드를 입력해주세요.');
    if (!name) return showAlert('오류', role === 'PARENT' || role === 'STUDENT' ? '원아 이름을 입력해주세요.' : '이름을 입력해주세요.');
    if (role === 'PARENT' && !parentName) return showAlert('오류', '학부모 본인 이름을 입력해주세요.');
    if (!validatePassword(password)) return showAlert('오류', '비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.');

    try {
      const payloadName = role === 'PARENT' ? parentName : name;
      const res = await fetch(`${API_HOST}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: payloadName, targetName: name, authCode, role })
      });
      const data = await res.json();
      
      if (res.ok) {
        showAlert('성공', data.message);
        router.replace('/');
      } else {
        showAlert('가입 실패', data.message);
      }
    } catch (err) {
      showAlert('오류', '서버 연결에 실패했습니다.');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>← 뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>회원가입</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.infoCard}>
          <Text style={styles.infoEmoji}>🔑</Text>
          <Text style={styles.infoTitle}>원장선생님이 발급하신</Text>
          <Text style={styles.infoTitle}>원 인증코드가 필요합니다.</Text>
          <Text style={styles.infoSub}>안전한 관리를 위해 인증된 학부모만 가입할 수 있습니다.</Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>가입 역할 선택</Text>
            <View style={styles.roleRow}>
              {['STUDENT', 'PARENT', 'TEACHER', 'DRIVER'].map(r => (
                <TouchableOpacity 
                  key={r} 
                  onPress={() => setRole(r)} 
                  style={[styles.roleButton, role === r && styles.roleButtonActive]}
                >
                  <Text style={[styles.roleText, role === r && styles.roleTextActive]}>
                    {r === 'STUDENT' ? '학생' : r === 'PARENT' ? '학부모' : r === 'TEACHER' ? '지도교사' : '기사님'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>원 인증코드</Text>
            <TextInput 
              style={styles.input} 
              placeholder="예: TAKEME123"
              placeholderTextColor="#94a3b8"
              value={authCode}
              onChangeText={setAuthCode}
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>
              {role === 'STUDENT' || role === 'PARENT' ? '원아 이름' : role === 'TEACHER' ? '지도 교사 이름' : '기사님 이름'}
            </Text>
            <TextInput 
              style={styles.input} 
              placeholder={role === 'STUDENT' || role === 'PARENT' ? '유치원에 등록된 원아 이름 (예: 홍길동)' : '유치원에 등록된 통학차량 담당자 이름 (예: 김기사)'}
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
            />
          </View>

          {role === 'PARENT' && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>학부모 본인 이름</Text>
              <TextInput 
                style={styles.input} 
                placeholder="학부모님의 이름을 입력해주세요 (예: 김철수)"
                placeholderTextColor="#94a3b8"
                value={parentName}
                onChangeText={setParentName}
              />
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>로그인용 이메일</Text>
            <View style={styles.row}>
              <TextInput 
                style={[styles.input, { flex: 1 }]} 
                placeholder="example@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor="#94a3b8"
                value={email}
                onChangeText={setEmail}
                editable={!isEmailVerified}
              />
              <TouchableOpacity 
                style={[styles.verifyButton, (isEmailVerified || !email) && styles.verifyButtonDisabled]}
                onPress={handleSendVerification}
                disabled={isEmailVerified || !email || isLoading}
              >
                {isLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.verifyButtonText}>{isEmailSent ? '재전송' : '인증'}</Text>}
              </TouchableOpacity>
            </View>
          </View>

          {isEmailSent && !isEmailVerified && (
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>인증코드 6자리</Text>
              <View style={styles.row}>
                <TextInput 
                  style={[styles.input, { flex: 1 }]} 
                  placeholder="123456"
                  keyboardType="number-pad"
                  placeholderTextColor="#94a3b8"
                  value={verificationCode}
                  onChangeText={setVerificationCode}
                />
                <TouchableOpacity 
                  style={[styles.verifyButton, { backgroundColor: '#10b981' }]}
                  onPress={handleVerifyCode}
                  disabled={isLoading}
                >
                  <Text style={styles.verifyButtonText}>확인</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>비밀번호</Text>
            <TextInput 
              style={styles.input} 
              placeholder="영문, 숫자, 특수문자 포함 8자 이상"
              secureTextEntry
              placeholderTextColor="#94a3b8"
              value={password}
              onChangeText={setPassword}
            />
          </View>
        </View>

        <TouchableOpacity 
          style={[styles.submitButton, !isEmailVerified && styles.submitButtonDisabled]}
          onPress={handleRegister}
          disabled={!isEmailVerified}
        >
          <Text style={styles.submitButtonText}>가입 완료</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backButton: {
    padding: 8,
    marginLeft: -8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e293b',
  },
  scrollContent: {
    padding: 24,
  },
  infoCard: {
    backgroundColor: '#eff6ff',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    marginBottom: 32,
  },
  infoEmoji: {
    fontSize: 32,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e40af',
    marginBottom: 4,
  },
  infoSub: {
    fontSize: 14,
    color: '#3b82f6',
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 20,
  },
  formContainer: {
    marginBottom: 32,
  },
  roleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  roleButtonActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6',
  },
  roleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  roleTextActive: {
    color: '#2563eb',
    fontWeight: '800',
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#0f172a',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
  },
  verifyButton: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 20,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  verifyButtonDisabled: {
    backgroundColor: '#cbd5e1',
  },
  verifyButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  submitButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#94a3b8',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  }
});
