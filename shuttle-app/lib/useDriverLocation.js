import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { io } from 'socket.io-client';
import { SERVER_URL } from './api';

/**
 * 기사·지도교사 위치 전송
 * - 로그인 토큰으로 소켓에 연결 (서버가 이 차량 담당자인지 확인)
 * - active 가 true(운행 중)일 때만 GPS를 읽어서 3초마다 서버로 전송
 * - 현재는 앱이 화면에 떠 있을 때만 동작. 백그라운드 전송은 다음 단계
 */
export function useDriverLocation({ token, vehicleId, active }) {
  const [socketStatus, setSocketStatus] = useState('연결 안 됨');
  const [lastPosition, setLastPosition] = useState(null);
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  // 1) 소켓 연결
  useEffect(() => {
    if (!token || !SERVER_URL) return;
    const socket = io(SERVER_URL, { transports: ['websocket'], auth: { token } });
    socketRef.current = socket;
    socket.on('connect', () => { setSocketStatus('연결됨'); setError(null); });
    socket.on('disconnect', () => setSocketStatus('연결 끊김'));
    socket.on('connect_error', (e) => { setSocketStatus('연결 실패'); setError(e.message); });
    socket.on('authError', (e) => setError(e?.message || '위치 전송 권한이 없어요.'));
    return () => { socket.disconnect(); socketRef.current = null; };
  }, [token]);

  // 2) 운행 중일 때만 GPS 추적 + 전송
  useEffect(() => {
    if (!active || !vehicleId) return;
    let sub = null;
    let cancelled = false;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('위치 권한이 거부됐어요. 설정에서 허용해 주세요.'); return; }
      if (cancelled) return;
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          const { latitude, longitude, accuracy, speed } = loc.coords;
          setLastPosition({ lat: latitude, lng: longitude, accuracy, speed, time: loc.timestamp });
          const socket = socketRef.current;
          if (socket?.connected) {
            socket.emit('driverLocationUpdate', { vehicleId, lat: latitude, lng: longitude });
            setSentCount((c) => c + 1);
          }
        }
      );
      if (cancelled) sub.remove();
    })();
    return () => { cancelled = true; sub?.remove(); };
  }, [active, vehicleId]);

  return { socketStatus, lastPosition, sentCount, error };
}
