import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform, ActivityIndicator, TextInput } from 'react-native';
import { Users, QrCode, MessageSquare, Inbox, ArrowLeft, Send, Calendar } from 'lucide-react-native';
import QRCode from 'react-native-qrcode-svg';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import io from 'socket.io-client';
import { API_HOST, authFetch, socketOptions } from '../lib/api';

let MapView, Marker, Polyline;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Polyline = Maps.Polyline;
}


const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const p1 = lat1 * Math.PI/180;
  const p2 = lat2 * Math.PI/180;
  const dp = (lat2-lat1) * Math.PI/180;
  const dl = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export default function TeacherDashboard({ email, name, role }) {
  const [activeView, setActiveView] = useState(role === 'DRIVER' ? 'passengers' : 'dashboard'); // dashboard, passengers, scanner, send_message, inbox
  const [students, setStudents] = useState([]);
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [operationLogs, setOperationLogs] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const [customMessage, setCustomMessage] = useState('');
  const [selectedStudents, setSelectedStudents] = useState(new Set());
  const [selectedParents, setSelectedParents] = useState(new Set());
  const [staffData, setStaffData] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(new Set());
  const [messageTargetTab, setMessageTargetTab] = useState('STUDENT'); // 'STUDENT' or 'STAFF'
  const socketRef = useRef(null);
  const locationSubRef = useRef(null);
  const mapRef = useRef(null);
  const [vehicleId, setVehicleId] = useState(null);
  const [currentRunNumber, setCurrentRunNumber] = useState(1);
  
  // Driver specific state
  const routeDataRef = useRef({ stops: [] });
  const ttsAnnouncedRef = useRef(new Set());
  const [isOperating, setIsOperating] = useState(false);
  const [reasonPrompt, setReasonPrompt] = useState(null); // { id, name, text }
  const [memoPrompt, setMemoPrompt] = useState(null); // { id, name, parentMessage, teacherMemo }

  useEffect(() => {
    // 소켓 연결
    socketRef.current = io(API_HOST, socketOptions());
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  useEffect(() => {
    
    // 위치 권한 요청 및 추적 시작
    const startTracking = async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 오류', '위치 권한이 필요합니다.');
        return;
      }
      
      // 서버에서 차량 ID를 가져온 후 위치 전송 (임시로 1이라고 가정, 실서비스에선 /teacher/vehicle-info 등으로 가져와야 함)
      // fetchPassengers() 시 vehicle 정보를 가져오는 것으로 로직 변경 가능. 일단 1로 세팅 후 통신.
      
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (loc) => {
          const lat = loc.coords.latitude;
          const lng = loc.coords.longitude;
          setCurrentLoc({ latitude: lat, longitude: lng });

          // 차량 ID를 받은 뒤에만 전송 (서버가 내 배정 차량인지 토큰으로 확인)
          if (socketRef.current && vehicleId) {
            socketRef.current.emit('driverLocationUpdate', {
              vehicleId, 
              lat,
              lng
            });
          }

          // Proximity TTS Logic for Driver
          if (role === 'DRIVER') {
            const stops = routeDataRef.current.stops;
            const announced = ttsAnnouncedRef.current;
            stops.forEach(stop => {
              if (stop.latitude && stop.longitude && !announced.has(stop.id)) {
                const dist = haversineDistance(lat, lng, stop.latitude, stop.longitude);
                if (dist <= 500) {
                  // Trigger TTS: Intro once, student info twice
                  const intro = "지금부터 탑승지 안내를 시작하겠습니다.";
                  const studentInfo = `${stop.name} 원아 ${stop.expectedTime}까지 ${stop.address}에서 탑승 예정입니다.`;
                  Speech.speak(`${intro} ${studentInfo} ${studentInfo}`);
                  const newAnnounced = new Set(announced).add(stop.id);
                  ttsAnnouncedRef.current = newAnnounced;
                  setTtsAnnounced(newAnnounced);
                }
              }
            });
          }
        }
      );
    };

    if (Platform.OS !== 'web' && isOperating) {
      startTracking();
    }

    return () => {
      if (locationSubRef.current) {
         locationSubRef.current.remove();
         locationSubRef.current = null;
      }
    };
  }, [vehicleId, isOperating]);

  useEffect(() => {
    if (activeView === 'passengers' || activeView === 'passengers_all' || activeView === 'send_message') fetchPassengers();
    if (activeView === 'send_message') fetchStaffList();
    if (activeView === 'inbox') fetchInbox();
    if (activeView === 'calendar') fetchOperationLogs();
    if (role === 'DRIVER') fetchRoute();
  }, [activeView, currentMonth]);

  const fetchStaffList = async () => {
    try {
      const res = await authFetch(`${API_HOST}/teacher/staff`);
      const data = await res.json();
      if (res.ok) setStaffData(data);
    } catch(e) {}
  };

  const fetchOperationLogs = async () => {
    setIsLoading(true);
    try {
      const monthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      const res = await authFetch(`${API_HOST}/teacher/operation-logs?email=${email}&month=${monthStr}`);
      const data = await res.json();
      if (res.ok) {
        setOperationLogs(data);
      }
    } catch(e) {
      console.log('Failed to fetch logs', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOperation = async () => {
    try {
      const res = await authFetch(`${API_HOST}/teacher/start-operation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (res.ok) {
        setIsOperating(true);
        Alert.alert('운행 시작', '위치 공유와 안전 운행 관제가 시작되었습니다.');
        Speech.speak('운행을 시작합니다. 오늘도 안전 운행 부탁드립니다.');
        if (activeView === 'calendar') fetchOperationLogs();
      }
    } catch(e) {
      Alert.alert('오류', '운행 시작 처리에 실패했습니다.');
    }
  };

  const handleEndOperation = async () => {
    try {
      const res = await authFetch(`${API_HOST}/teacher/end-operation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (res.ok) {
        setIsOperating(false);
        Alert.alert('운행 종료', '위치 공유가 종료되었습니다. 수고하셨습니다.');
        Speech.speak('운행이 종료되었습니다. 수고하셨습니다.');
        if (activeView === 'calendar') fetchOperationLogs();
      }
    } catch(e) {
      Alert.alert('오류', '운행 종료 처리에 실패했습니다.');
    }
  };

  const fetchRoute = async () => {
    try {
      const res = await authFetch(`${API_HOST}/teacher/route?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setRouteData(data);
        routeDataRef.current = data;
        if (data.vehicleId) setVehicleId(data.vehicleId);
        
        // Fit map bounds
        if (mapRef.current && data.routePoints.length > 0 && Platform.OS !== 'web') {
          setTimeout(() => {
            mapRef.current.fitToCoordinates(data.routePoints, {
              edgePadding: { top: 50, right: 50, bottom: 50, left: 50 },
              animated: true,
            });
          }, 1000);
        }
      }
    } catch (e) {
      console.log('Failed to fetch route', e);
    }
  };

  const fetchPassengers = async () => {
    setIsLoading(true);
    try {
      const res = await authFetch(`${API_HOST}/teacher/students?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        const sortedData = [...data].sort((a, b) => (a.expectedTime || '').localeCompare(b.expectedTime || ''));
        setStudents(sortedData);
      }
    } catch (e) {
      console.log('Failed to fetch passengers', e);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchInbox = async () => {
    setIsLoading(true);
    try {
      const res = await authFetch(`${API_HOST}/teacher/inbox?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        // [테스트용 임시 메세지 삽입]
        const dummyMessage = {
          id: 9999,
          message: '아이가 화장실에 가서 5분 정도 늦을 것 같습니다. 죄송합니다!',
          createdAt: new Date().toISOString(),
          isRead: false,
          student: { id: 999, name: '테스트학생(지각)' }
        };
        setMessages([dummyMessage, ...data]);
      }
    } catch (e) {
      console.log('Failed to fetch inbox', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualBoard = (studentId, studentName) => {
    setReasonPrompt({ id: studentId, name: studentName, text: '' });
  };

  const executeManualBoard = async () => {
    if (!reasonPrompt) return;
    const { id, name, text } = reasonPrompt;
    setReasonPrompt(null);
    try {
      const res = await authFetch(`${API_HOST}/teacher/board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, studentId: id, reason: text })
      });
      if (res.ok) {
        if (role === 'DRIVER') {
          const nextStudent = students.find(s => s.id !== id && !s.boarded && !s.absent);
          let nextMessage = "";
          if (nextStudent) {
              const nextInfo = `다음 원아는 ${nextStudent.name} 원아 도착지는 ${nextStudent.address} 입니다.`;
              nextMessage = ` ${nextInfo} ${nextInfo}`;
          }
          Speech.speak(`${name} 원생, 탑승 완료.${nextMessage}`);
        }
        Alert.alert('탑승 처리 완료', '성공적으로 처리되었습니다.');
        fetchPassengers(); // Refresh list
      } else {
        Alert.alert('오류', '처리에 실패했습니다.');
      }
    } catch (e) {
      console.log('Failed to board', e);
      Alert.alert('오류', '네트워크 오류가 발생했습니다.');
    }
  };

  const executeSaveMemo = async () => {
    if (!memoPrompt) return;
    const { id, teacherMemo } = memoPrompt;

    // 더미 데이터 처리 삭제


    try {
      const res = await authFetch(`${API_HOST}/teacher/student/${id}/memo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, memo: teacherMemo || '' })
      });
      if (res.ok) {
        setMemoPrompt(null);
        Alert.alert('저장 완료', '원장선생님께 공유되는 교사 메모가 저장되었습니다.');
        fetchPassengers(); // Refresh list to get updated memo
      } else {
        Alert.alert('오류', '메모 저장에 실패했습니다.');
      }
    } catch (e) {
      console.log('Failed to save memo', e);
      Alert.alert('오류', '네트워크 오류가 발생했습니다.');
    }
  };

  const handleSkipStudent = async (studentId, studentName) => {
    try {
      const res = await authFetch(`${API_HOST}/teacher/skip-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, studentId })
      });
      if (res.ok) {
        Speech.speak(`${studentName} 원생 결석 처리. 경로가 재탐색되었습니다. 다음 목적지로 안내를 시작합니다.`);
        Alert.alert('성공', '결석(건너뛰기) 처리되었습니다.');
        fetchPassengers();
      } else {
        Alert.alert('오류', '처리에 실패했습니다.');
      }
    } catch (e) {
      Alert.alert('오류', '통신 중 오류가 발생했습니다.');
    }
  };



  const renderDashboard = () => (
    <View style={[styles.viewContainer, { flex: 1 }]}>
      {role === 'DRIVER' && (
        <View style={styles.viewHeader}>
          <TouchableOpacity onPress={() => setActiveView('passengers')} style={styles.backBtn}>
            <ArrowLeft size={24} color="#1e293b" />
          </TouchableOpacity>
          <Text style={styles.viewTitle}>메뉴</Text>
        </View>
      )}
      <View style={styles.grid}>
        <TouchableOpacity style={styles.card} onPress={() => setActiveView('passengers_all')}>
          <Users size={48} color="#2563eb" style={styles.cardIcon} />
          <Text style={styles.cardTitle}>탑승 명단</Text>
          <Text style={styles.cardSub}>회차별 명단 보기</Text>
        </TouchableOpacity>

      {role !== 'DRIVER' && (
        <TouchableOpacity style={styles.card} onPress={() => setActiveView('scanner')}>
          <QrCode size={48} color="#16a34a" style={styles.cardIcon} />
          <Text style={styles.cardTitle}>우리차량 QR</Text>
          <Text style={styles.cardSub}>원아용 스캔 화면</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.card} onPress={() => setActiveView('send_message')}>
        <Send size={48} color="#eab308" style={styles.cardIcon} />
        <Text style={styles.cardTitle}>메세지</Text>
        <Text style={styles.cardSub}>공지/지연 안내</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.card} onPress={() => setActiveView('inbox')}>
        <Inbox size={48} color="#8b5cf6" style={styles.cardIcon} />
        <Text style={styles.cardTitle}>메세지함</Text>
        <Text style={styles.cardSub}>받은 공지 확인</Text>
      </TouchableOpacity>
    </View>
  </View>
);

  const renderPassengers = () => {
    const ts = 1; // Text scale multiplier
    const runs = [...new Set(students.map(s => s.runNumber || 1))].sort((a,b) => a - b);
    
    // Set initial run number if not set
    if (runs.length > 0 && !runs.includes(currentRunNumber)) {
      setCurrentRunNumber(runs[0]);
    }

    const isAllView = activeView === 'passengers_all';
    
    return (
      <View style={[styles.viewContainer, { flex: 1 }]}>
        {(role !== 'DRIVER' || isAllView) && (
          <View style={styles.viewHeader}>
            <TouchableOpacity onPress={() => setActiveView('dashboard')} style={styles.backBtn}>
              <ArrowLeft size={24} color="#1e293b" />
            </TouchableOpacity>
            <Text style={styles.viewTitle}>{isAllView ? '전체 탑승 명단' : '탑승 명단'}</Text>
          </View>
        )}

        {!isAllView && role === 'DRIVER' && (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingBottom: 16 }}>
            <TouchableOpacity 
              style={{ flex: 1, marginRight: 12, backgroundColor: isOperating ? '#ef4444' : '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 4, elevation: 2 }}
              onPress={isOperating ? handleEndOperation : handleStartOperation}
            >
              <Text style={{ color: 'white', fontWeight: '900', fontSize: 18 }}>
                {isOperating ? '⏹ 운행 종료 (위치 끄기)' : '▶ 운행 시작 (위치 켜기)'}
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={{ backgroundColor: '#0ea5e9', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, alignItems: 'center', flexDirection: 'row', gap: 8 }}
              onPress={() => setActiveView('calendar')}
            >
              <Calendar size={20} color="white" />
              <Text style={{ fontWeight: 'bold', fontSize: 16, color: 'white' }}>
                운행 일지
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {!isAllView && role === 'DRIVER' && MapView && (
          <View style={{ height: '35%', backgroundColor: '#f1f5f9', borderBottomWidth: 1, borderColor: '#cbd5e1' }}>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFillObject}
              initialRegion={{
                latitude: routeData.academy?.latitude || 37.558,
                longitude: routeData.academy?.longitude || 126.824,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              }}
            >
              {routeData.routePoints.length > 0 && (
                <Polyline
                  coordinates={routeData.routePoints.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                  strokeColor="#2563eb"
                  strokeWidth={5}
                />
              )}
              {routeData.stops.map((stop, index) => (
                <Marker key={index} coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}>
                  <View style={[styles.markerContainer, { backgroundColor: ttsAnnounced.has(stop.id) ? '#94a3b8' : '#3b82f6' }]}>
                    <Text style={styles.markerText}>{index + 1}</Text>
                  </View>
                </Marker>
              ))}
              {currentLoc && (
                <Marker coordinate={currentLoc} title="내 차량 (기사님 위치)">
                  <View style={[styles.markerContainer, { backgroundColor: '#ef4444', borderColor: '#b91c1c' }]}>
                    <Text style={[styles.markerText, { fontSize: 16 }]}>🚌</Text>
                  </View>
                </Marker>
              )}
            </MapView>
          </View>
        )}

        {!isAllView && role === 'DRIVER' && !MapView && (
          <View style={{ height: '35%', backgroundColor: '#f1f5f9', borderBottomWidth: 1, borderColor: '#cbd5e1', justifyContent: 'center', alignItems: 'center' }}>
            <Text style={{ color: '#64748b', fontSize: 16 }}>지도는 모바일(iOS/Android) 기기에서만 렌더링됩니다.</Text>
            <Text style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>웹 브라우저에서는 노출되지 않습니다.</Text>
          </View>
        )}

        {/* RUN TABS (only for main view) */}
        {!isAllView && runs.length > 0 && (
          <View style={{flexDirection: 'row', padding: 12, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#e2e8f0'}}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
              {runs.map(run => (
                <TouchableOpacity 
                  key={run}
                  onPress={() => setCurrentRunNumber(run)}
                  style={{
                    paddingHorizontal: 16, 
                    paddingVertical: 8, 
                    borderRadius: 20,
                    backgroundColor: currentRunNumber === run ? '#2563eb' : '#f1f5f9'
                  }}
                >
                  <Text style={{
                    color: currentRunNumber === run ? 'white' : '#64748b',
                    fontWeight: 'bold'
                  }}>{run}번 타임</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {isLoading ? <ActivityIndicator size="large" color="#2563eb" style={{marginTop: 50}} /> : (
          <ScrollView style={styles.scrollContent}>
            
            {/* TABLE HEADER FOR TEACHER */}
            {role === 'TEACHER' && students.length > 0 && (
              <View style={{flexDirection: 'row', paddingHorizontal: 4, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#cbd5e1', marginBottom: 8}}>
                <Text style={{width: 32, fontWeight: 'bold', color: '#64748b', textAlign: 'center'}}>탑승</Text>
                <Text style={{flex: 1, fontWeight: 'bold', color: '#64748b', marginLeft: 8}}>이름</Text>
                <Text style={{width: 50, fontWeight: 'bold', color: '#64748b', textAlign: 'center'}}>예정</Text>
                <Text style={{width: 60, fontWeight: 'bold', color: '#64748b', textAlign: 'center'}}>QR시간</Text>
                <Text style={{width: 24, fontWeight: 'bold', color: '#64748b', textAlign: 'center'}}>!</Text>
              </View>
            )}

            {runs.map(run => {
              const runStudents = isAllView ? students.filter(s => (s.runNumber || 1) === run) : students.filter(s => (s.runNumber || 1) === currentRunNumber && run === currentRunNumber);
              
              if (runStudents.length === 0) return null;

              return (
                <View key={`run-group-${run}`} style={{marginBottom: isAllView ? 24 : 0}}>
                  {isAllView && (
                    <View style={{backgroundColor: '#e2e8f0', paddingVertical: 8, paddingHorizontal: 16, marginBottom: 8}}>
                      <Text style={{fontWeight: 'bold', color: '#475569', fontSize: 16}}>{run}번 타임 탑승 명단</Text>
                    </View>
                  )}

                  {runStudents.map((st, i) => {
                    if (role === 'TEACHER') {
                      return (
                        <View key={st.id} style={{flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', backgroundColor: 'white', marginBottom: 4, borderRadius: 8}}>
                          {/* 탑승 여부 (체크박스) */}
                          <TouchableOpacity 
                            style={{width: 32, alignItems: 'center', justifyContent: 'center'}}
                            onPress={() => !st.boarded && !st.absent && handleManualBoard(st.id, st.name)}
                          >
                            <Text style={{fontSize: 20}}>{st.boarded ? '✅' : st.absent ? '❌' : '🔲'}</Text>
                          </TouchableOpacity>
                          
                          {/* 이름 및 위치 */}
                          <View style={{flex: 1, marginLeft: 8}}>
                            <Text style={{fontSize: 15, fontWeight: 'bold', color: '#1e293b'}} numberOfLines={1}>{st.name}</Text>
                            <Text style={{fontSize: 11, color: '#64748b', marginTop: 2}} numberOfLines={1}>{st.address}</Text>
                            {st.boardingLocation && (
                              <Text style={{fontSize: 11, color: '#2563eb', fontWeight: 'bold', marginTop: 1}} numberOfLines={1}>📍 {st.boardingLocation}</Text>
                            )}
                          </View>
                          
                          {/* 예정 시간 */}
                          <Text style={{width: 50, fontSize: 13, color: '#64748b', textAlign: 'center'}}>{st.expectedTime || '--:--'}</Text>
                          
                          {/* QR(실탑승) 시간 */}
                          <Text style={{width: 60, fontSize: 13, color: '#2563eb', fontWeight: 'bold', textAlign: 'center'}}>
                            {st.actualBoardTime ? new Date(st.actualBoardTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'}
                          </Text>
                          
                          {/* ! (메세지 & 메모) */}
                          <View style={{width: 24, alignItems: 'center'}}>
                            {(st.parentMessage || st.teacherMemo) ? (
                              <TouchableOpacity 
                                style={{backgroundColor: '#ef4444', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center'}}
                                onPress={() => setMemoPrompt({ id: st.id, name: st.name, parentMessage: st.parentMessage, teacherMemo: st.teacherMemo || '' })}
                              >
                                <Text style={{color: 'white', fontWeight: 'bold', fontSize: 12}}>!</Text>
                              </TouchableOpacity>
                            ) : (
                              <TouchableOpacity 
                                style={{backgroundColor: '#e2e8f0', width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center'}}
                                onPress={() => setMemoPrompt({ id: st.id, name: st.name, parentMessage: null, teacherMemo: '' })}
                              >
                                <Text style={{color: '#94a3b8', fontSize: 12}}>📝</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>
                      );
                    }

                    // DRIVER VIEW
                    return (
                      <View key={st.id} style={[styles.listItem, { padding: 16 * ts }]}>
                        <View style={[styles.listInfo, { flex: 1 }]}>
                          <View style={{flexDirection: 'row', alignItems: 'center'}}>
                            <Text style={[styles.listName, { fontSize: 16 * ts }]}>{st.name}</Text>
                            {st.parentMessage && (
                              <TouchableOpacity 
                                style={{marginLeft: 8, backgroundColor: '#ef4444', width: 22 * ts, height: 22 * ts, borderRadius: 11 * ts, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.2, shadowRadius: 1}}
                                onPress={() => Alert.alert(`${st.name} 학부모님 메세지`, st.parentMessage)}
                              >
                                <Text style={{color: 'white', fontWeight: '900', fontSize: 14 * ts}}>!</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          <Text style={[styles.listSub, { fontSize: 13 * ts }]}>{st.address}</Text>
                          {st.boardingLocation && (
                            <Text style={[styles.listSub, { fontSize: 13 * ts, color: '#2563eb', fontWeight: 'bold', marginTop: 4 }]}>📍 {st.boardingLocation}</Text>
                          )}
                        </View>
                        
                        {st.boarded ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: '#dcfce7', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8}}>
                            <Text style={{color: '#16a34a', fontWeight: 'bold', fontSize: 14 * ts}}>✅ 탑승완료</Text>
                          </View>
                        ) : st.absent ? (
                          <View style={{flexDirection: 'row', alignItems: 'center', backgroundColor: '#fee2e2', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8}}>
                            <Text style={{color: '#ef4444', fontWeight: 'bold', fontSize: 14 * ts}}>❌ 결석처리</Text>
                          </View>
                        ) : (
                          <View style={{flexDirection: 'row', gap: 8}}>
                            <TouchableOpacity 
                              style={[styles.actionBtn, { paddingHorizontal: 12 * ts, paddingVertical: 8 * ts }]} 
                              onPress={() => handleManualBoard(st.id, st.name)}
                            >
                              <Text style={[styles.actionBtnText, { fontSize: 14 * ts }]}>탑승체크</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                              style={[styles.actionBtn, {backgroundColor: '#ef4444', paddingHorizontal: 12 * ts, paddingVertical: 8 * ts }]} 
                              onPress={() => handleSkipStudent(st.id, st.name)}
                            >
                              <Text style={[styles.actionBtnText, { fontSize: 14 * ts }]}>건너뛰기</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            
            {students.length === 0 && <Text style={[styles.emptyText, { fontSize: 15 * ts }]}>배정된 원생이 없습니다.</Text>}
            {role === 'DRIVER' && <View style={{height: 100}} />}
          </ScrollView>
        )}
      </View>
    );
  };

  const renderScanner = () => {
    // Generate QR payload containing teacher's email so backend knows which vehicle to board the student to.
    const qrPayload = JSON.stringify({ type: 'boarding_qr', teacherEmail: email });

    return (
      <View style={styles.viewContainer}>
        <View style={styles.viewHeader}>
          <TouchableOpacity onPress={() => setActiveView('dashboard')} style={styles.backBtn}>
            <ArrowLeft size={24} color="#1e293b" />
          </TouchableOpacity>
          <Text style={styles.viewTitle}>우리 차량 QR 탑승코드</Text>
        </View>
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20}}>
          <Text style={{fontSize: 20, fontWeight: 'bold', marginBottom: 30, color: '#1e293b'}}>원아 또는 학부모님께 이 화면을 보여주세요</Text>
          <View style={{padding: 20, backgroundColor: 'white', borderRadius: 24, shadowColor: '#000', shadowOffset: {width: 0, height: 10}, shadowOpacity: 0.1, shadowRadius: 20, elevation: 5}}>
            {Platform.OS === 'web' ? (
              <Text style={{color: 'red'}}>웹 버전에서는 QR 라이브러리 프리뷰가 지원되지 않을 수 있습니다.</Text>
            ) : (
              <QRCode
                value={qrPayload}
                size={250}
                color="black"
                backgroundColor="white"
              />
            )}
          </View>
          <Text style={{fontSize: 14, color: '#64748b', marginTop: 30, textAlign: 'center'}}>
            학생 앱의 [탑승 QR 스캔하기] 버튼을 눌러 이 코드를 찍으면{'\n'}탑승이 자동 완료되며 학부모님께 알림이 전송됩니다.
          </Text>
        </View>
      </View>
    );
  };

  const toggleStudentSelection = (id) => {
    const newSet = new Set(selectedStudents);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedStudents(newSet);
  };

  const toggleParentSelection = (id) => {
    const newSet = new Set(selectedParents);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedParents(newSet);
  };

  const toggleStaffSelection = (id) => {
    const newSet = new Set(selectedStaff);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedStaff(newSet);
  };

  const handleSelectAllStudents = () => {
    if (selectedStudents.size === students.length && students.length > 0) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(students.map(s => s.id)));
    }
  };

  const handleSelectAllParents = () => {
    if (selectedParents.size === students.length && students.length > 0) {
      setSelectedParents(new Set());
    } else {
      setSelectedParents(new Set(students.map(s => s.id)));
    }
  };

  const handleSendMessage = async () => {
    if (!customMessage.trim()) {
      Alert.alert('알림', '메세지 내용을 입력해주세요.');
      return;
    }
    if (selectedStudents.size === 0 && selectedParents.size === 0 && selectedStaff.size === 0) {
      Alert.alert('알림', '받을 대상을 1명 이상 선택해주세요.');
      return;
    }

    try {
      const res = await authFetch(`${API_HOST}/teacher/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          studentIds: Array.from(selectedStudents),
          parentIds: Array.from(selectedParents),
          staffUserIds: Array.from(selectedStaff),
          message: customMessage
        })
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert(
          '전송 완료', 
          `${data.sentCount}명(건)에게 메세지를 발송했습니다.`,
          [
            { 
              text: '확인', 
              onPress: () => {
                setCustomMessage('');
                setSelectedStudents(new Set());
                setSelectedParents(new Set());
                setSelectedStaff(new Set());
                setActiveView('dashboard');
              }
            }
          ]
        );
      } else {
        Alert.alert('전송 실패', data.message || '메세지 전송 중 오류가 발생했습니다.');
      }
    } catch (e) {
      Alert.alert('네트워크 오류', '전송에 실패했습니다.');
    }
  };

  const renderSendMessage = () => {
    const allSelected = students.length > 0 && selectedStudents.size === students.length;
    
    return (
      <View style={styles.viewContainer}>
        <View style={styles.viewHeader}>
          <TouchableOpacity onPress={() => setActiveView('dashboard')} style={styles.backBtn}>
            <ArrowLeft size={24} color="#1e293b" />
          </TouchableOpacity>
          <Text style={styles.viewTitle}>맞춤 메세지 발송</Text>
        </View>
        <View style={{flex: 1}}>
          <View style={{padding: 20, backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#e2e8f0'}}>
            <TextInput
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: 12,
                padding: 16,
                fontSize: 16,
                minHeight: 120,
                textAlignVertical: 'top',
                borderWidth: 1,
                borderColor: '#e2e8f0',
                color: '#1e293b'
              }}
              placeholder="학부모님께 보낼 메세지를 직접 입력하세요. (예: 오늘 비가 많이 와서 도착이 10분 지연될 예정입니다.)"
              placeholderTextColor="#94a3b8"
              multiline
              value={customMessage}
              onChangeText={setCustomMessage}
            />
          </View>
          
          <View style={{flexDirection: 'row'}}>
            <TouchableOpacity 
              style={{flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: messageTargetTab === 'STUDENT' ? '#2563eb' : 'transparent', backgroundColor: messageTargetTab === 'STUDENT' ? 'white' : '#f8fafc'}}
              onPress={() => setMessageTargetTab('STUDENT')}
            >
              <Text style={{fontWeight: 'bold', color: messageTargetTab === 'STUDENT' ? '#2563eb' : '#64748b'}}>학부모/원아</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={{flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: messageTargetTab === 'STAFF' ? '#2563eb' : 'transparent', backgroundColor: messageTargetTab === 'STAFF' ? 'white' : '#f8fafc'}}
              onPress={() => setMessageTargetTab('STAFF')}
            >
              <Text style={{fontWeight: 'bold', color: messageTargetTab === 'STAFF' ? '#2563eb' : '#64748b'}}>교직원</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{flex: 1}}>
            {messageTargetTab === 'STUDENT' ? (
              <>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#f1f5f9'}}>
                  <Text style={{fontWeight: 'bold', color: '#475569'}}>받는 사람 선택</Text>
                  <View style={{flexDirection: 'row', gap: 12}}>
                <TouchableOpacity onPress={handleSelectAllStudents} style={{padding: 4}}>
                  <Text style={{color: '#2563eb', fontWeight: 'bold'}}>{selectedStudents.size === students.length && students.length > 0 ? '원아 선택 해제' : '원아 전체선택'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleSelectAllParents} style={{padding: 4}}>
                  <Text style={{color: '#10b981', fontWeight: 'bold'}}>{selectedParents.size === students.length && students.length > 0 ? '학부모 선택 해제' : '학부모 전체선택'}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{padding: 12}}>
              {students.map((st, i) => (
                <View 
                  key={i} 
                  style={{
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    padding: 16, 
                    backgroundColor: 'white', 
                    borderRadius: 12, 
                    marginBottom: 8,
                    borderWidth: 1,
                    borderColor: (selectedStudents.has(st.id) || selectedParents.has(st.id)) ? '#2563eb' : '#e2e8f0'
                  }}
                >
                  <View style={{flex: 1}}>
                    <Text style={{fontWeight: 'bold', fontSize: 15, color: '#1e293b'}}>{st.name} <Text style={{color: '#64748b', fontSize: 13, fontWeight: 'normal'}}>({st.expectedTime})</Text></Text>
                    <Text style={{fontSize: 12, color: '#94a3b8', marginTop: 2}}>{st.address}</Text>
                    {st.boardingLocation && (
                      <Text style={{fontSize: 12, color: '#2563eb', fontWeight: 'bold', marginTop: 2}}>📍 {st.boardingLocation}</Text>
                    )}
                  </View>
                  
                  <View style={{flexDirection: 'row', gap: 16}}>
                    <TouchableOpacity onPress={() => toggleStudentSelection(st.id)} style={{alignItems: 'center'}}>
                      <View style={{
                        width: 24, height: 24, borderRadius: 12, borderWidth: 2, 
                        borderColor: selectedStudents.has(st.id) ? '#2563eb' : '#cbd5e1',
                        backgroundColor: selectedStudents.has(st.id) ? '#2563eb' : 'transparent',
                        justifyContent: 'center', alignItems: 'center'
                      }}>
                        {selectedStudents.has(st.id) && <View style={{width: 10, height: 10, backgroundColor: 'white', borderRadius: 5}} />}
                      </View>
                      <Text style={{fontSize: 10, color: '#64748b', marginTop: 4}}>원아</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => toggleParentSelection(st.id)} style={{alignItems: 'center'}}>
                      <View style={{
                        width: 24, height: 24, borderRadius: 12, borderWidth: 2, 
                        borderColor: selectedParents.has(st.id) ? '#10b981' : '#cbd5e1',
                        backgroundColor: selectedParents.has(st.id) ? '#10b981' : 'transparent',
                        justifyContent: 'center', alignItems: 'center'
                      }}>
                        {selectedParents.has(st.id) && <View style={{width: 10, height: 10, backgroundColor: 'white', borderRadius: 5}} />}
                      </View>
                      <Text style={{fontSize: 10, color: '#64748b', marginTop: 4}}>학부모</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
                  <View style={{height: 100}} />
                </ScrollView>
              </>
            ) : (
              <ScrollView style={{padding: 12, backgroundColor: '#f8fafc'}}>
                {staffData?.admin && (
                  <View style={{marginBottom: 16}}>
                    <Text style={{fontWeight: 'bold', color: '#475569', marginBottom: 8, paddingHorizontal: 4}}>원장선생님</Text>
                    <TouchableOpacity 
                      style={{flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: selectedStaff.has(staffData.admin.id) ? '#2563eb' : '#e2e8f0'}}
                      onPress={() => toggleStaffSelection(staffData.admin.id)}
                    >
                      <View style={{flex: 1}}>
                        <Text style={{fontWeight: 'bold', fontSize: 16, color: '#1e293b'}}>{staffData.admin.name} <Text style={{fontSize: 12, color: '#64748b'}}>(원장선생님)</Text></Text>
                      </View>
                      <View style={{width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selectedStaff.has(staffData.admin.id) ? '#2563eb' : '#cbd5e1', backgroundColor: selectedStaff.has(staffData.admin.id) ? '#2563eb' : 'transparent', justifyContent: 'center', alignItems: 'center'}}>
                        {selectedStaff.has(staffData.admin.id) && <View style={{width: 10, height: 10, backgroundColor: 'white', borderRadius: 5}} />}
                      </View>
                    </TouchableOpacity>
                  </View>
                )}

                {staffData?.vehicles?.map(v => (
                  <View key={`veh-${v.id}`} style={{marginBottom: 16}}>
                    <Text style={{fontWeight: 'bold', color: '#475569', marginBottom: 8, paddingHorizontal: 4}}>{v.busNumber}호차</Text>
                    {v.driver && (
                      <TouchableOpacity 
                        style={{flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: selectedStaff.has(v.driver.id) ? '#2563eb' : '#e2e8f0', marginBottom: 8}}
                        onPress={() => toggleStaffSelection(v.driver.id)}
                      >
                        <View style={{flex: 1}}>
                          <Text style={{fontWeight: 'bold', fontSize: 16, color: '#1e293b'}}>{v.driver.name} <Text style={{fontSize: 12, color: '#64748b'}}>(기사님)</Text></Text>
                        </View>
                        <View style={{width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selectedStaff.has(v.driver.id) ? '#2563eb' : '#cbd5e1', backgroundColor: selectedStaff.has(v.driver.id) ? '#2563eb' : 'transparent', justifyContent: 'center', alignItems: 'center'}}>
                          {selectedStaff.has(v.driver.id) && <View style={{width: 10, height: 10, backgroundColor: 'white', borderRadius: 5}} />}
                        </View>
                      </TouchableOpacity>
                    )}
                    {v.teacher && (
                      <TouchableOpacity 
                        style={{flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: selectedStaff.has(v.teacher.id) ? '#2563eb' : '#e2e8f0'}}
                        onPress={() => toggleStaffSelection(v.teacher.id)}
                      >
                        <View style={{flex: 1}}>
                          <Text style={{fontWeight: 'bold', fontSize: 16, color: '#1e293b'}}>{v.teacher.name} <Text style={{fontSize: 12, color: '#64748b'}}>(지도교사)</Text></Text>
                        </View>
                        <View style={{width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selectedStaff.has(v.teacher.id) ? '#2563eb' : '#cbd5e1', backgroundColor: selectedStaff.has(v.teacher.id) ? '#2563eb' : 'transparent', justifyContent: 'center', alignItems: 'center'}}>
                          {selectedStaff.has(v.teacher.id) && <View style={{width: 10, height: 10, backgroundColor: 'white', borderRadius: 5}} />}
                        </View>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
                <View style={{height: 100}} />
              </ScrollView>
            )}
          </View>
        </View>

        <View style={{padding: 20, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#e2e8f0'}}>
          <TouchableOpacity 
            style={[styles.actionBtn, {width: '100%', alignItems: 'center', paddingVertical: 16, opacity: (customMessage.trim() && (selectedStudents.size > 0 || selectedParents.size > 0 || selectedStaff.size > 0)) ? 1 : 0.5}]}
            onPress={handleSendMessage}
            disabled={!customMessage.trim() || (selectedStudents.size === 0 && selectedParents.size === 0 && selectedStaff.size === 0)}
          >
            <Text style={{color: 'white', fontWeight: 'bold', fontSize: 16}}>메세지 보내기</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderInbox = () => (
    <View style={styles.viewContainer}>
      <View style={styles.viewHeader}>
        <TouchableOpacity onPress={() => setActiveView('dashboard')} style={styles.backBtn}>
          <ArrowLeft size={24} color="#1e293b" />
        </TouchableOpacity>
        <Text style={styles.viewTitle}>받은 메세지함</Text>
      </View>
      {isLoading ? <ActivityIndicator size="large" color="#2563eb" style={{marginTop: 50}} /> : (
        <ScrollView style={styles.scrollContent}>
          {messages.map((m, i) => (
            <View key={i} style={styles.msgCard}>
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4}}>
                <View>
                  <Text style={{fontSize: 14, fontWeight: 'bold', color: '#1e293b'}}>
                    {m.student ? `${m.student.name} 원아 학부모님` : '원장선생님 (관리자)'}
                  </Text>
                  <Text style={[styles.msgTime, {marginTop: 2}]}>{new Date(m.createdAt).toLocaleTimeString()}</Text>
                </View>
                {m.student && (
                  <TouchableOpacity 
                    style={{backgroundColor: '#f1f5f9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1'}}
                    onPress={() => {
                      const st = students.find(s => s.id === m.student.id);
                      setMemoPrompt({ 
                        id: m.student.id, 
                        name: m.student.name, 
                        parentMessage: m.message, 
                        teacherMemo: st ? (st.teacherMemo || '') : '' 
                      });
                    }}
                  >
                    <Text style={{fontSize: 12, color: '#334155', fontWeight: 'bold'}}>📝 메모 작성</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.msgText}>{m.message}</Text>
            </View>
          ))}
          {messages.length === 0 && <Text style={styles.emptyText}>수신된 메세지가 없습니다.</Text>}
        </ScrollView>
      )}
    </View>
  );

  const renderCalendar = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startingDay = firstDay.getDay(); 
    const daysInMonth = lastDay.getDate();
    
    const days = [];
    for (let i = 0; i < startingDay; i++) days.push(null);
    for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i, 12, 0, 0));

    const selectedLogs = operationLogs.filter(log => log.dateString === selectedDate);

    return (
      <View style={styles.viewContainer}>
        <View style={styles.viewHeader}>
          <TouchableOpacity onPress={() => setActiveView(role === 'DRIVER' ? 'passengers' : 'dashboard')} style={styles.backBtn}>
            <ArrowLeft size={24} color="#1e293b" />
          </TouchableOpacity>
          <Text style={styles.viewTitle}>운행 일지 캘린더</Text>
        </View>
        
        <View style={{padding: 20, backgroundColor: 'white'}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20}}>
            <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month - 1, 1))}>
              <Text style={{fontSize: 24, color: '#2563eb'}}>◀</Text>
            </TouchableOpacity>
            <Text style={{fontSize: 20, fontWeight: 'bold', color: '#1e293b'}}>{year}년 {month + 1}월</Text>
            <TouchableOpacity onPress={() => setCurrentMonth(new Date(year, month + 1, 1))}>
              <Text style={{fontSize: 24, color: '#2563eb'}}>▶</Text>
            </TouchableOpacity>
          </View>
          
          <View style={{flexDirection: 'row', marginBottom: 10}}>
            {['일','월','화','수','목','금','토'].map(d => <Text key={d} style={{flex: 1, textAlign: 'center', color: d==='일'?'#ef4444':d==='토'?'#3b82f6':'#64748b', fontWeight: 'bold'}}>{d}</Text>)}
          </View>
          
          <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
            {days.map((d, i) => {
              if (!d) return <View key={`empty-${i}`} style={{width: '14.28%', height: 50}} />;
              const dateStr = d.toISOString().split('T')[0];
              const isSelected = dateStr === selectedDate;
              const hasLog = operationLogs.some(log => log.dateString === dateStr);
              return (
                <TouchableOpacity 
                  key={i} 
                  style={{width: '14.28%', height: 50, alignItems: 'center', justifyContent: 'center'}}
                  onPress={() => setSelectedDate(dateStr)}
                >
                  <View style={{width: 36, height: 36, borderRadius: 18, backgroundColor: isSelected ? '#2563eb' : 'transparent', alignItems: 'center', justifyContent: 'center'}}>
                    <Text style={{color: isSelected ? 'white' : '#1e293b', fontWeight: isSelected ? 'bold' : 'normal'}}>{d.getDate()}</Text>
                  </View>
                  {hasLog && !isSelected && <View style={{width: 6, height: 6, borderRadius: 3, backgroundColor: '#10b981', position: 'absolute', bottom: 2}} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <ScrollView style={{flex: 1, padding: 20, backgroundColor: '#f1f5f9'}}>
          <Text style={{fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginBottom: 16}}>{selectedDate} 운행 기록</Text>
          
          {selectedLogs.length === 0 ? (
            <Text style={{color: '#64748b', textAlign: 'center', marginTop: 40}}>해당 날짜의 운행 기록이 없습니다.</Text>
          ) : (
            selectedLogs.map((log, index) => (
              <View key={log.id} style={{backgroundColor: 'white', borderRadius: 16, padding: 20, marginBottom: 20, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3}}>
                <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingBottom: 12}}>
                  <Text style={{fontSize: 16, fontWeight: 'bold', color: '#1e293b'}}>{index + 1}회차 운행</Text>
                  <Text style={{fontSize: 14, color: '#64748b', marginLeft: 'auto'}}>
                    {log.startTime ? new Date(log.startTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '--:--'} ~ {log.endTime ? new Date(log.endTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '운행중'}
                  </Text>
                </View>
                
                {log.boardingRecords && log.boardingRecords.length > 0 ? (
                  log.boardingRecords.map((br, j) => (
                    <View key={j} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
                      <View style={{flexDirection: 'row', alignItems: 'center'}}>
                        <Text style={{fontSize: 18, marginRight: 10}}>{br.method === 'QR' ? '📱' : '👋'}</Text>
                        <Text style={{fontSize: 15, color: '#334155', fontWeight: '500'}}>{br.studentName}</Text>
                      </View>
                      <Text style={{fontSize: 14, color: '#64748b', fontWeight: 'bold'}}>
                        {new Date(br.boardTime).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                      </Text>
                    </View>
                  ))
                ) : (
                  <Text style={{color: '#94a3b8', fontSize: 14, textAlign: 'center', marginVertical: 10}}>탑승한 원생이 없습니다.</Text>
                )}
              </View>
            ))
          )}
          <View style={{height: 100}} />
        </ScrollView>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerArea}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
          <View>
            <Text style={styles.welcomeTitle}>{name} {role === 'DRIVER' ? '기사님' : '지도교사님'},</Text>
            <Text style={styles.welcomeSub}>오늘도 안전운행을 부탁드립니다!</Text>
          </View>
          {role === 'DRIVER' && activeView === 'passengers' && (
            <TouchableOpacity onPress={() => setActiveView('dashboard')} style={{padding: 8}}>
              <Text style={{fontSize: 24, fontWeight: 'bold', color: '#1e293b'}}>⋮</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      
      {activeView === 'dashboard' && renderDashboard()}
      {activeView === 'passengers' && renderPassengers()}
      {activeView === 'scanner' && renderScanner()}
      {activeView === 'send_message' && renderSendMessage()}
      {activeView === 'inbox' && renderInbox()}
      {activeView === 'calendar' && renderCalendar()}

      {/* Manual Board Reason Modal (Overlay) */}
      {reasonPrompt && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }]}>
          <View style={{ width: '80%', backgroundColor: 'white', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, elevation: 5 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginBottom: 8 }}>{reasonPrompt.name} 수동 탑승 처리</Text>
            <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 16 }}>수동 탑승 사유를 간단히 적어주세요. (예: QR 미소지 등)</Text>
            
            <TextInput 
              style={{ backgroundColor: '#f1f5f9', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 20 }}
              placeholder="사유 입력 (선택사항)"
              value={reasonPrompt.text}
              onChangeText={(t) => setReasonPrompt({...reasonPrompt, text: t})}
              autoFocus
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
              <TouchableOpacity onPress={() => setReasonPrompt(null)} style={{ padding: 12 }}>
                <Text style={{ color: '#64748b', fontWeight: 'bold' }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={executeManualBoard} style={{ backgroundColor: '#2563eb', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 }}>
                <Text style={{ color: 'white', fontWeight: 'bold' }}>확인 및 탑승처리</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Memo Prompt Modal (Overlay) */}
      {memoPrompt && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }]}>
          <View style={{ width: '85%', backgroundColor: 'white', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, elevation: 5 }}>
            <Text style={{ fontSize: 18, fontWeight: 'bold', color: '#1e293b', marginBottom: 12 }}>{memoPrompt.name} 원생 교사 메모</Text>
            
            <Text style={{ fontSize: 14, color: '#64748b', marginBottom: 8, fontWeight: 'bold' }}>교사 메모 (원장선생님 실시간 공유)</Text>
            
            <TextInput 
              style={{ backgroundColor: '#f1f5f9', borderRadius: 8, padding: 12, fontSize: 16, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 20, minHeight: 80, textAlignVertical: 'top', color: '#1e293b' }}
              placeholder="여기에 메모를 추가하거나 수정하세요..."
              value={memoPrompt.teacherMemo}
              onChangeText={(t) => setMemoPrompt({...memoPrompt, teacherMemo: t})}
              multiline
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
              <TouchableOpacity onPress={() => setMemoPrompt(null)} style={{ padding: 12 }}>
                <Text style={{ color: '#64748b', fontWeight: 'bold' }}>닫기</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={executeSaveMemo} style={{ backgroundColor: '#2563eb', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8 }}>
                <Text style={{ color: 'white', fontWeight: 'bold' }}>저장하기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerArea: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 20,
  },
  welcomeTitle: {
    fontSize: 24,
    fontWeight: '900',
    color: '#1e293b',
  },
  welcomeSub: {
    fontSize: 14,
    color: '#64748b',
    marginTop: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 16,
    justifyContent: 'center',
  },
  card: {
    width: '45%',
    backgroundColor: '#ffffff',
    paddingVertical: 32,
    paddingHorizontal: 16,
    borderRadius: 24,
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  cardIcon: {
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1e293b',
    marginBottom: 4,
  },
  cardSub: {
    fontSize: 12,
    color: '#94a3b8',
  },
  viewContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  viewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    padding: 8,
    marginRight: 12,
  },
  viewTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  scrollContent: {
    flex: 1,
    padding: 20,
  },
  listItem: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  listName: {
    fontWeight: 'bold',
    fontSize: 16,
    color: '#1e293b',
  },
  listSub: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 4,
  },
  actionBtn: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
  },
  actionBtnDone: {
    backgroundColor: '#e2e8f0',
  },
  actionBtnText: {
    color: 'white',
    fontWeight: 'bold',
  },
  actionBtnTextDone: {
    color: '#94a3b8',
  },
  emptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 40,
  },
  scannerContainer: {
    flex: 1,
    backgroundColor: 'black',
    position: 'relative',
  },
  scanOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: '#2563eb',
    padding: 16,
    borderRadius: 12,
    margin: 20,
  },
  quickBtn: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  quickBtnText: {
    fontSize: 15,
    color: '#1e293b',
    fontWeight: '500',
  },
  msgCard: {
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  msgTime: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 6,
  },
  msgText: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
  },
  markerContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  markerText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  }
});
