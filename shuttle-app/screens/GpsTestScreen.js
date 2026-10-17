import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { io } from 'socket.io-client';

// .env 에 EXPO_PUBLIC_SERVER_URL=http://PC의_IPv4주소:3000 형식으로 넣기 (localhost 아님)
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL;

export default function GpsTestScreen() {
  const [vehicleId, setVehicleId] = useState('1');
  const [running, setRunning] = useState(false);
  const [socketState, setSocketState] = useState('연결 안 됨');
  const [myPos, setMyPos] = useState(null);       // 휴대폰 GPS에서 읽은 값
  const [echo, setEcho] = useState(null);         // 서버를 거쳐 다시 돌아온 값
  const [sentCount, setSentCount] = useState(0);
  const [logs, setLogs] = useState([]);

  const socketRef = useRef(null);
  const watchRef = useRef(null);

  const log = (msg) =>
    setLogs((prev) => [`${new Date().toLocaleTimeString()}  ${msg}`, ...prev].slice(0, 30));

  const start = async () => {
    if (!SERVER_URL) {
      log('EXPO_PUBLIC_SERVER_URL이 .env에 없어요.');
      return;
    }
    const vid = Number(vehicleId);

    // 1) 위치 권한
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      log('위치 권한이 거부됐어요. 휴대폰 설정에서 Expo Go 위치 권한을 허용하세요.');
      return;
    }
    log('위치 권한 허용됨');

    // 2) 소켓 연결 + 차량 방 입장 (같은 방에 있어야 서버가 돌려준 위치를 받을 수 있음)
    const socket = io(SERVER_URL, { transports: ['websocket'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      setSocketState('연결됨');
      log(`서버 연결 성공 (${SERVER_URL})`);
      socket.emit('joinVehicleRoom', { vehicleId: vid });
    });
    socket.on('connect_error', (e) => {
      setSocketState('연결 실패');
      log(`서버 연결 실패: ${e.message}`);
    });
    socket.on('disconnect', () => setSocketState('연결 끊김'));
    socket.on('locationUpdated', (data) => {
      setEcho(data);
      log(`서버 수신 확인: ${data.lat.toFixed(6)}, ${data.lng.toFixed(6)}`);
    });

    // 3) GPS 추적 시작 → 위치가 바뀔 때마다 서버로 전송
    watchRef.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 2000, distanceInterval: 0 },
      (loc) => {
        const { latitude, longitude, accuracy, speed } = loc.coords;
        setMyPos({ lat: latitude, lng: longitude, accuracy, speed, time: loc.timestamp });
        if (socket.connected) {
          socket.emit('driverLocationUpdate', { vehicleId: vid, lat: latitude, lng: longitude });
          setSentCount((c) => c + 1);
        }
      }
    );
    setRunning(true);
    log('GPS 추적 시작');
  };

  const stop = () => {
    watchRef.current?.remove();
    watchRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRunning(false);
    setSocketState('연결 안 됨');
    log('테스트 중지');
  };

  useEffect(() => stop, []); // 화면을 벗어나면 정리

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.title}>GPS 테스트</Text>
      <Text style={styles.desc}>
        휴대폰 GPS → 서버(driverLocationUpdate) → 서버가 같은 차량 방에 다시 전송(locationUpdated)까지 확인해요.
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>차량 ID</Text>
        <TextInput
          style={styles.input}
          value={vehicleId}
          onChangeText={setVehicleId}
          keyboardType="number-pad"
          editable={!running}
        />
      </View>

      <Pressable style={[styles.btn, running && styles.btnStop]} onPress={running ? stop : start}>
        <Text style={styles.btnText}>{running ? '테스트 중지' : '테스트 시작'}</Text>
      </Pressable>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>① 휴대폰 GPS</Text>
        {myPos ? (
          <>
            <Text>위도 {myPos.lat.toFixed(6)} / 경도 {myPos.lng.toFixed(6)}</Text>
            <Text>정확도 약 {Math.round(myPos.accuracy)}m · 속도 {myPos.speed != null && myPos.speed >= 0 ? (myPos.speed * 3.6).toFixed(1) : '-'} km/h</Text>
            <Text>측정 시각 {new Date(myPos.time).toLocaleTimeString()}</Text>
          </>
        ) : <Text style={styles.muted}>아직 없음</Text>}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>② 서버 연결 · 전송</Text>
        <Text>소켓 상태: {socketState}</Text>
        <Text>보낸 횟수: {sentCount}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>③ 서버에서 돌아온 위치</Text>
        {echo ? (
          <>
            <Text>위도 {echo.lat.toFixed(6)} / 경도 {echo.lng.toFixed(6)}</Text>
            <Text>서버 시각 {new Date(echo.timestamp).toLocaleTimeString()}</Text>
            <Text style={styles.ok}>✓ GPS → 서버 → 앱 왕복 성공</Text>
          </>
        ) : <Text style={styles.muted}>아직 없음</Text>}
      </View>

      <Text style={styles.cardTitle}>로그</Text>
      {logs.map((l, i) => <Text key={i} style={styles.log}>{l}</Text>)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  desc: { color: '#555' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontWeight: '600' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 80 },
  btn: { backgroundColor: '#F2B705', padding: 14, borderRadius: 24, alignItems: 'center' },
  btnStop: { backgroundColor: '#ddd' },
  btnText: { fontWeight: '700', color: '#222' },
  card: { borderWidth: 1, borderColor: '#e3e3e3', borderRadius: 12, padding: 12, gap: 4 },
  cardTitle: { fontWeight: '700', marginBottom: 2 },
  muted: { color: '#999' },
  ok: { color: '#1E8E4E', fontWeight: '700', marginTop: 4 },
  log: { fontSize: 12, color: '#444' },
});
