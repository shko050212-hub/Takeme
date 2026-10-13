import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import KakaoMap from './components/KakaoMap';
import GpsTestScreen from './screens/GpsTestScreen';

const KAKAO_JS_KEY = process.env.EXPO_PUBLIC_KAKAO_JS_KEY;

// 테스트용 샘플 경로 (서울 강서구 일대). 나중에 실제 노선 좌표로 교체
const ROUTE = [
  { lat: 37.5585, lng: 126.8352 },
  { lat: 37.5592, lng: 126.8381 },
  { lat: 37.5601, lng: 126.8410 },
  { lat: 37.5615, lng: 126.8426 },
  { lat: 37.5632, lng: 126.8441 },
  { lat: 37.5648, lng: 126.8462 },
  { lat: 37.5660, lng: 126.8490 },
];
const TICK = 2000; // 실제 GPS처럼 2초마다 새 좌표가 온다고 가정

export default function App() {
  return (
    <SafeAreaProvider>
      <TestSwitcher />
    </SafeAreaProvider>
  );
}

// 테스트 화면 전환 (로그인·내비게이션 붙이기 전까지 임시)
function TestSwitcher() {
  const [tab, setTab] = useState('gps');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['top', 'bottom']}>
      <View style={styles.tabs}>
        {[['gps', 'GPS 테스트'], ['map', '지도 테스트']].map(([key, label]) => (
          <Pressable key={key} style={[styles.tab, tab === key && styles.tabOn]} onPress={() => setTab(key)}>
            <Text style={styles.btnText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }}>{tab === 'gps' ? <GpsTestScreen /> : <MapTestScreen />}</View>
    </SafeAreaView>
  );
}

function MapTestScreen() {
  const mapRef = useRef(null);
  const [status, setStatus] = useState('지도 불러오는 중…');
  const [ready, setReady] = useState(false);
  const [index, setIndex] = useState(0);
  const [auto, setAuto] = useState(false);

  const goTo = (i) => {
    const p = ROUTE[i];
    mapRef.current?.moveBus(p.lat, p.lng, TICK * 0.9);
    setIndex(i);
  };

  const next = () => goTo((index + 1) % ROUTE.length);

  // 자동 이동: TICK마다 다음 좌표로
  useEffect(() => {
    if (!auto || !ready) return;
    const id = setInterval(() => {
      setIndex((prev) => {
        const i = (prev + 1) % ROUTE.length;
        const p = ROUTE[i];
        mapRef.current?.moveBus(p.lat, p.lng, TICK * 0.9);
        return i;
      });
    }, TICK);
    return () => clearInterval(id);
  }, [auto, ready]);

  if (!KAKAO_JS_KEY) {
    return (
      <SafeAreaView style={styles.center} edges={[]}>
        <Text style={styles.error}>.env 파일에 EXPO_PUBLIC_KAKAO_JS_KEY를 넣고 앱을 다시 실행하세요.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={[]}>
      <StatusBar style="dark" />
      <View style={styles.mapBox}>
        <KakaoMap
          ref={mapRef}
          appKey={KAKAO_JS_KEY}
          center={ROUTE[0]}
          route={ROUTE}
          onReady={() => { setReady(true); setStatus('지도 준비 완료'); }}
          onError={(msg) => setStatus(`오류: ${msg}`)}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.status}>{status}  ·  위치 {index + 1}/{ROUTE.length}</Text>
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={next} disabled={!ready}>
            <Text style={styles.btnText}>다음 위치</Text>
          </Pressable>
          <Pressable style={[styles.btn, auto && styles.btnOn]} onPress={() => setAuto((a) => !a)} disabled={!ready}>
            <Text style={styles.btnText}>{auto ? '자동 이동 멈춤' : '자동 이동 시작'}</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={() => mapRef.current?.followBus()} disabled={!ready}>
            <Text style={styles.btnText}>버스로 이동</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  mapBox: { flex: 1 },
  panel: { padding: 16, borderTopWidth: 1, borderColor: '#ddd' },
  status: { marginBottom: 10, color: '#444' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#eee' },
  btnOn: { backgroundColor: '#F2B705' },
  btnText: { fontWeight: '600', color: '#222' },
  tabs: { flexDirection: 'row', gap: 8, padding: 10, borderBottomWidth: 1, borderColor: '#eee' },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 20, backgroundColor: '#eee', alignItems: 'center' },
  tabOn: { backgroundColor: '#F2B705' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { color: '#c0392b', textAlign: 'center' },
});
