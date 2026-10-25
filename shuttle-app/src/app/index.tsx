import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, TextInput, Alert, ActivityIndicator, Platform } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withTiming, 
  withDelay,
  withSequence,
  Easing,
  runOnJS
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { API_HOST, setAccessToken } from '../lib/api';

const { height, width } = Dimensions.get('window');


const showAlert = (title, message) => {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

// ----------------------------------------------------
// 1. Splash Sequence (Logo Only)
// ----------------------------------------------------
const SplashSequence = ({ onFinish, loginOpacity }) => {
  const logoY = useSharedValue(-height);

  useEffect(() => {
    // 1. Logo comes from top to center, waits 1s, drops to bottom
    logoY.value = withSequence(
      withTiming(0, { duration: 800, easing: Easing.out(Easing.exp) }),
      withDelay(1000, withTiming(height, { duration: 800, easing: Easing.in(Easing.exp) }))
    );

    // 2. Login screen fades in while Logo is dropping
    setTimeout(() => {
      loginOpacity.value = withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) });
    }, 1800);

    // 3. Cleanup splash overlay
    setTimeout(() => {
      runOnJS(onFinish)();
    }, 3000);
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: logoY.value }],
    position: 'absolute',
    width: '100%',
    height: '100%',
  }));

  return (
    <View style={styles.overlayContainer}>
      <Animated.View style={[styles.overlayScreen, logoStyle]}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoEmoji}>🚌</Text>
        </View>
        <Text style={styles.logoText}>takeme</Text>
        <Text style={styles.logoSubText}>스마트 셔틀 시스템</Text>
      </Animated.View>
    </View>
  );
};

// ----------------------------------------------------
// 2. Welcome Sequence (Post-Login)
// ----------------------------------------------------
const WelcomeSequence = ({ userName, role, onFinish }) => {
  const welcomeY = useSharedValue(-height);

  useEffect(() => {
    // 1. Welcome comes from top to center, waits 1s, drops to bottom
    welcomeY.value = withSequence(
      withTiming(0, { duration: 800, easing: Easing.out(Easing.exp) }),
      withDelay(1000, withTiming(height, { duration: 800, easing: Easing.in(Easing.exp) }, (isFinished) => {
        if (isFinished) {
          runOnJS(onFinish)();
        }
      }))
    );
  }, []);

  const welcomeStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: welcomeY.value }],
    position: 'absolute',
    width: '100%',
    height: '100%',
  }));

  const roleLabel = role === 'PARENT' ? '학부모님' : role === 'TEACHER' ? '선생님' : role === 'DRIVER' ? '기사님' : '학생';

  return (
    <View style={styles.overlayContainer}>
      <Animated.View style={[styles.overlayScreen, welcomeStyle]}>
        <View style={styles.welcomeCard}>
          <Text style={styles.welcomeEmoji}>👋</Text>
          <Text style={styles.welcomeText}><Text style={styles.boldText}>{userName}</Text> {roleLabel}</Text>
          <Text style={styles.welcomeText}>환영합니다!</Text>
        </View>
      </Animated.View>
    </View>
  );
};

// ----------------------------------------------------
// 3. Login Screen
// ----------------------------------------------------
const LoginScreen = ({ onLoginSuccess, onPending }) => {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      showAlert('오류', '이메일과 비밀번호를 입력해주세요.');
      return;
    }
    
    setIsLoading(true);
    try {
      const res = await fetch(`${API_HOST}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      
      if (!res.ok) {
        showAlert('로그인 실패', data.message || '이메일 또는 비밀번호를 확인해주세요.');
        return;
      }
      
      if (!data.success || !data.user) {
        showAlert('로그인 불가', data.message || '웹 대시보드 전용 계정이거나 인증이 필요합니다. (원장선생님은 PC웹을 이용해주세요)');
        return;
      }
      
      if (data.requireApproval) {
        setAccessToken(null); // 승인 대기 중에는 토큰이 발급되지 않음
        onPending(data.user.name, email, data.user.role);
      } else {
        setAccessToken(data.accessToken || null); // 이후 모든 API·소켓 요청에 사용
        onLoginSuccess(data.user.name, email, data.user.role);
      }
    } catch (e) {
      console.error(e);
      showAlert('오류', '서버에 연결할 수 없습니다. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.loginContainer}>
      <View style={styles.loginContent}>
        <View style={styles.loginHeader}>
          <Text style={styles.loginEmoji}>🚌</Text>
          <Text style={styles.loginTitle}>takeme</Text>
          <Text style={styles.loginSub}>스마트 셔틀 시스템</Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>이메일</Text>
            <TextInput 
              style={styles.realInput}
              placeholder="example@email.com"
              placeholderTextColor="#94a3b8"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>
          
          <View style={styles.inputContainer}>
            <Text style={styles.inputLabel}>비밀번호</Text>
            <TextInput 
              style={styles.realInput}
              placeholder="********"
              placeholderTextColor="#94a3b8"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity 
            style={styles.loginButton}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.loginButtonText}>로그인</Text>
            )}
          </TouchableOpacity>

          <View style={styles.dividerContainer}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>또는</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity 
            style={styles.registerButton}
            onPress={() => router.push('/register')}
          >
            <Text style={styles.registerButtonText}>회원가입</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

// ----------------------------------------------------
// ----------------------------------------------------
// 4. Pending Approval Screen
// ----------------------------------------------------
const PendingScreen = ({ userName, role, onLogout, onSettings }) => {
  const roleLabel = role === 'PARENT' ? '학부모님' : role === 'TEACHER' ? '선생님' : role === 'DRIVER' ? '기사님' : '학생';
  
  return (
    <View style={styles.overlayContainer}>
      <View style={[styles.overlayScreen, { padding: 32 }]}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoEmoji}>⏳</Text>
        </View>
        <Text style={styles.welcomeText}><Text style={styles.boldText}>{userName}</Text> {roleLabel},</Text>
        <Text style={[styles.welcomeText, { fontSize: 24, marginTop: 12 }]}>가입 승인 대기 중입니다</Text>
        
        <View style={{ marginTop: 32, backgroundColor: '#f8fafc', padding: 24, borderRadius: 16, width: '100%' }}>
          <Text style={{ textAlign: 'center', color: '#64748b', fontSize: 15, lineHeight: 24 }}>
            원장선생님께서 앱 연동을 승인해 주셔야{'\n'}앱 기능을 사용할 수 있습니다.
          </Text>
          <Text style={{ textAlign: 'center', color: '#ef4444', fontSize: 13, marginTop: 16, fontWeight: 'bold' }}>
            유치원으로 승인을 요청해 주세요.
          </Text>
        </View>

        <TouchableOpacity 
          style={[styles.loginButton, { marginTop: 40, width: '100%', backgroundColor: '#f1f5f9' }]}
          onPress={onLogout}
        >
          <Text style={[styles.loginButtonText, { color: '#64748b' }]}>로그인 화면으로 돌아가기</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={{ marginTop: 16 }} onPress={onSettings}>
          <Text style={{ color: '#94a3b8', fontSize: 14 }}>계정 관리 / 환경 설정</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

// ----------------------------------------------------
// 5. Root Component
// ----------------------------------------------------
export default function AppIndex() {
  const router = useRouter();
  const [appState, setAppState] = useState('splash'); // 'splash' | 'login' | 'welcome' | 'pending'
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userRole, setUserRole] = useState('STUDENT');
  const loginOpacity = useSharedValue(0);

  const loginStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity: loginOpacity.value
  }));

  const handleLoginSuccess = (name, email, role) => {
    setUserName(name);
    setUserEmail(email);
    setUserRole(role);
    setAppState('welcome');
  };

  const handleWelcomeFinish = () => {
    // Navigate to home immediately after welcome animation finishes dropping
    router.replace(`/home?email=${encodeURIComponent(userEmail)}&name=${encodeURIComponent(userName)}&role=${userRole}`);
  };

  return (
    <View style={styles.root}>
      {/* Login Screen wrapped in Animated.View for fade-in effect after Splash */}
      <Animated.View style={loginStyle}>
        <LoginScreen 
          onLoginSuccess={handleLoginSuccess} 
          onPending={(name, email, role) => {
            setUserName(name);
            setUserEmail(email);
            setUserRole(role);
            setAppState('pending');
          }}
        />
      </Animated.View>
      
      {appState === 'splash' && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          <SplashSequence 
            onFinish={() => setAppState('login')} 
            loginOpacity={loginOpacity} 
          />
        </View>
      )}

      {appState === 'welcome' && (
        <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
          {/* We set a white background overlay to cover the login screen while Welcome plays */}
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#ffffff' }]} />
          <WelcomeSequence 
            userName={userName} 
            role={userRole}
            onFinish={handleWelcomeFinish} 
          />
        </View>
      )}

      {appState === 'pending' && (
        <PendingScreen 
          userName={userName}
          role={userRole}
          onLogout={() => { setAccessToken(null); setAppState('login'); }}
          onSettings={() => router.push({ pathname: '/settings', params: { email: userEmail } })}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------
// Styles
// ----------------------------------------------------
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  overlayContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  overlayScreen: {
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoEmoji: {
    fontSize: 48,
  },
  logoText: {
    fontSize: 42,
    fontWeight: '900',
    color: '#2563eb',
    letterSpacing: -1,
  },
  logoSubText: {
    fontSize: 16,
    color: '#64748b',
    marginTop: 8,
    fontWeight: '600',
  },
  welcomeCard: {
    alignItems: 'center',
  },
  welcomeEmoji: {
    fontSize: 56,
    marginBottom: 24,
  },
  welcomeText: {
    fontSize: 28,
    color: '#334155',
    marginBottom: 8,
  },
  boldText: {
    fontWeight: '800',
    color: '#2563eb',
  },
  
  // Login Screen Styles
  loginContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loginContent: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  loginHeader: {
    alignItems: 'center',
    marginBottom: 48,
  },
  loginTitle: {
    fontSize: 36,
    fontWeight: '900',
    color: '#2563eb',
    letterSpacing: -1,
  },
  loginSub: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
    marginTop: 4,
  },
  formContainer: {
    width: '100%',
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  inputBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
  },
  realInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#1e293b',
  },
  inputTextPlaceholder: {
    color: '#94a3b8',
    fontSize: 16,
  },
  loginButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 32,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    marginHorizontal: 16,
    color: '#94a3b8',
    fontSize: 14,
  },
  registerButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  registerButtonText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '600',
  }
});
