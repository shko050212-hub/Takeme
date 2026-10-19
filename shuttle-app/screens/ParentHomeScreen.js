import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../lib/AuthContext';
import { C, card } from '../lib/theme';

/** 학부모·학생 홈 (다음 단계에서 버스 실시간 위치 지도, 결석 신청 추가 예정) */
export default function ParentHomeScreen() {
  const { user, logout } = useAuth();
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StatusBar style="light" />
      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Takeme</Text>
            <Text style={styles.academy}>{user?.academyName || '학부모'}</Text>
          </View>
          <Pressable onPress={logout} hitSlop={8}><Text style={styles.logout}>로그아웃</Text></Pressable>
        </View>
      </SafeAreaView>
      <View style={styles.body}>
        <View style={card}>
          <Text style={styles.title}>{user?.name || user?.email}님</Text>
          <Text style={styles.sub}>학부모 화면은 준비 중입니다.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.slate100 },
  headerWrap: { backgroundColor: C.blue700 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  brand: { color: C.white, fontWeight: '700', fontSize: 18 },
  academy: { color: C.blue200, fontSize: 12, marginTop: 2 },
  logout: { color: C.blue100, fontSize: 14 },
  body: { padding: 16 },
  title: { fontSize: 18, fontWeight: '700', color: C.slate800 },
  sub: { color: C.slate500, marginTop: 6 },
});
