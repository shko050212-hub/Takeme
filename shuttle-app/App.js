import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './lib/AuthContext';
import LoginScreen from './screens/LoginScreen';
import StaffHomeScreen from './screens/StaffHomeScreen';
import { C } from './lib/theme';
import ParentHomeScreen from './screens/ParentHomeScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

// 로그인 여부와 역할에 따라 첫 화면 결정
function Root() {
  const { loading, token, user, logout } = useAuth();

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={C.blue600} /></View>;
  }
  if (!token) return <LoginScreen />;

  switch (user?.role) {
    case 'DRIVER':
    case 'TEACHER':
      return <StaffHomeScreen />;
    case 'PARENT':
    case 'STUDENT':
      return <ParentHomeScreen />;
    default:
      return (
        <View style={styles.center}>
          <Text style={{ marginBottom: 12, color: C.slate600 }}>원장·관리자 계정은 관리자 웹을 이용해주세요.</Text>
          <Pressable onPress={logout}><Text style={{ color: C.blue600 }}>로그아웃</Text></Pressable>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: C.slate100 },
});
