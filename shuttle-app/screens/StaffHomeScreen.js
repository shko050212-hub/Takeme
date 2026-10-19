import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, RefreshControl, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { useDriverLocation } from '../lib/useDriverLocation';
import { C, btnPrimary, btnPrimaryText, card, badge, badgeGreen, badgeOrange, badgeSlate } from '../lib/theme';

const ROLE_LABEL = { DRIVER: '기사', TEACHER: '지도교사' };

/** 기사·지도교사 홈: 운행 시작/종료, GPS 전송 상태, 오늘 탑승 명단 */
export default function StaffHomeScreen() {
  const { user, token, logout } = useAuth();
  const [vehicle, setVehicle] = useState(null);
  const [students, setStudents] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [operating, setOperating] = useState(false);
  const [busyId, setBusyId] = useState(null); // 처리 중인 버튼

  const gps = useDriverLocation({ token, vehicleId: vehicle?.id, active: operating });

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const v = await api('/teacher/my-vehicle');
      setVehicle(v);
      setStudents((await api('/teacher/students')) || []);
    } catch (e) {
      setLoadError(e.message === 'Assigned vehicle not found' ? '배정된 차량이 없어요. 원장님께 차량 배정을 요청하세요.' : e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const toggleOperation = () => {
    if (!operating) return runOperation('start-operation', true);
    Alert.alert('운행 종료', '운행을 종료하고 위치 전송을 멈출까요?', [
      { text: '취소', style: 'cancel' },
      { text: '종료', style: 'destructive', onPress: () => runOperation('end-operation', false) },
    ]);
  };

  const runOperation = async (path, next) => {
    setBusyId('op');
    try {
      await api(`/teacher/${path}`, { method: 'POST' });
      setOperating(next);
      await load();
    } catch (e) {
      Alert.alert('오류', e.message);
    } finally {
      setBusyId(null);
    }
  };

  const mark = async (student, action) => {
    setBusyId(student.id);
    try {
      await api(`/teacher/${action === 'board' ? 'board' : 'skip-student'}`, { method: 'POST', body: { studentId: student.id } });
      await load();
    } catch (e) {
      Alert.alert('오류', e.message);
    } finally {
      setBusyId(null);
    }
  };

  const activeStudents = students.filter((s) => !s.absent);
  const boardedCount = students.filter((s) => s.boarded).length;
  const vehicleLabel = vehicle ? (String(vehicle.name).includes('호차') ? vehicle.name : `${vehicle.name}호차`) : null;

  const InfoRow = ({ label, children }) => (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{children}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <StatusBar style="light" />
      {/* 웹 사이드바와 같은 파란 헤더 */}
      <SafeAreaView edges={['top']} style={styles.headerWrap}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Takeme</Text>
            <Text style={styles.academy}>{user?.academyName || '셔틀 운행'}</Text>
          </View>
          <Pressable onPress={logout} hitSlop={8}><Text style={styles.logout}>로그아웃</Text></Pressable>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.pageTitle}>오늘 운행</Text>
        {loadError && <View style={styles.errorBox}><Text style={styles.errorText}>{loadError}</Text></View>}

        {/* 차량 카드 (웹 '차량 구역 현황' 목록과 같은 모양) */}
        <View style={[card, styles.vehicleCard]}>
          <View style={styles.dot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.vehicleName}>{vehicleLabel || '차량 정보 불러오는 중'}</Text>
            <Text style={styles.small}>{user?.name || user?.email} · {ROLE_LABEL[user?.role] || ''}</Text>
          </View>
          <Text style={[badge, operating ? badgeGreen : badgeSlate]}>{operating ? '운행 중' : '대기'}</Text>
        </View>

        <Pressable
          style={[operating ? styles.stopBtn : [btnPrimary, styles.bigBtn], (!vehicle || busyId === 'op') && { opacity: 0.5 }]}
          onPress={toggleOperation}
          disabled={!vehicle || busyId === 'op'}
        >
          {busyId === 'op'
            ? <ActivityIndicator color={operating ? C.red600 : C.white} />
            : <Text style={operating ? styles.stopText : [btnPrimaryText, styles.bigText]}>{operating ? '운행 종료' : '운행 시작'}</Text>}
        </Pressable>

        <View style={card}>
          <Text style={styles.sectionTitle}>위치 전송</Text>
          <InfoRow label="상태">{operating ? '전송 중' : '운행 시작 시 전송'}</InfoRow>
          <InfoRow label="서버">{gps.socketStatus}</InfoRow>
          <InfoRow label="전송">{gps.sentCount}회</InfoRow>
          {gps.lastPosition && (
            <InfoRow label="좌표">
              {gps.lastPosition.lat.toFixed(5)}, {gps.lastPosition.lng.toFixed(5)} (±{Math.round(gps.lastPosition.accuracy)}m)
            </InfoRow>
          )}
          {gps.error && <Text style={styles.errorSmall}>{gps.error}</Text>}
          {operating && <Text style={styles.hint}>앱을 화면에 켜둔 상태에서만 전송됩니다.</Text>}
        </View>

        <View style={card}>
          <View style={styles.listHead}>
            <Text style={styles.sectionTitle}>탑승 명단</Text>
            <Text style={[badge, badgeSlate]}>{boardedCount}/{activeStudents.length}명</Text>
          </View>

          {students.length === 0 && <Text style={styles.empty}>오늘 탑승할 원생이 없습니다.</Text>}

          {students.map((s) => (
            <View key={s.id} style={styles.studentRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.studentName}>{s.name} <Text style={styles.small}>{s.expectedTime}</Text></Text>
                <Text style={styles.small} numberOfLines={1}>{s.address}</Text>
                {s.teacherMemo ? <Text style={styles.memo}>메모: {s.teacherMemo}</Text> : null}
              </View>
              {s.absent ? <Text style={[badge, badgeSlate]}>결석</Text>
                : s.boarded ? <Text style={[badge, badgeGreen]}>탑승완료</Text>
                : (
                  <View style={styles.actions}>
                    <Text style={[badge, badgeOrange]}>대기</Text>
                    <Pressable style={styles.approveBtn} onPress={() => mark(s, 'board')} disabled={busyId === s.id}>
                      <Text style={styles.approveText}>탑승</Text>
                    </Pressable>
                    <Pressable style={styles.grayBtn} onPress={() => mark(s, 'skip')} disabled={busyId === s.id}>
                      <Text style={styles.grayText}>미탑승</Text>
                    </Pressable>
                  </View>
                )}
            </View>
          ))}
        </View>
      </ScrollView>
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
  body: { padding: 16, gap: 12 },
  pageTitle: { fontSize: 20, fontWeight: '700', color: C.slate800, marginBottom: 4 },
  vehicleCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: C.blue600 },
  vehicleName: { fontWeight: '700', color: C.slate700, fontSize: 16 },
  bigBtn: { paddingVertical: 18 },
  bigText: { fontSize: 18, fontWeight: '700' },
  stopBtn: { backgroundColor: C.white, borderWidth: 1, borderColor: C.red200, borderRadius: 12, paddingVertical: 18, alignItems: 'center' },
  stopText: { color: C.red600, fontSize: 18, fontWeight: '700' },
  sectionTitle: { fontWeight: '700', color: C.slate700, fontSize: 15, marginBottom: 8 },
  infoRow: { flexDirection: 'row', paddingVertical: 3 },
  infoLabel: { color: C.slate400, width: 56, fontSize: 14 },
  infoValue: { color: C.slate700, fontSize: 14, flex: 1 },
  listHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  studentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: 1, borderColor: C.slate100 },
  studentName: { fontWeight: '700', color: C.slate700, fontSize: 15 },
  small: { fontSize: 12, color: C.slate500, marginTop: 2 },
  memo: { fontSize: 12, color: C.orange700, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // 웹 승인/거절 버튼과 같은 모양
  approveBtn: { backgroundColor: C.green600, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 6 },
  approveText: { color: C.white, fontSize: 12, fontWeight: '700' },
  grayBtn: { backgroundColor: C.slate200, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 6 },
  grayText: { color: C.slate600, fontSize: 12, fontWeight: '700' },
  empty: { color: C.slate400, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  hint: { color: C.slate500, fontSize: 12, marginTop: 6 },
  errorBox: { backgroundColor: C.red50, borderWidth: 1, borderColor: C.red200, borderRadius: 12, padding: 12 },
  errorText: { color: C.red700, fontSize: 13, fontWeight: '700' },
  errorSmall: { color: C.red600, fontSize: 12, marginTop: 6 },
});
