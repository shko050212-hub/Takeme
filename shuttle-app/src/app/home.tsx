import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Navigation, Settings, Bell, CalendarClock, QrCode } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AbsenceModal from '../components/AbsenceModal';
import TeacherDashboard from '../components/TeacherDashboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import io from 'socket.io-client';

let MapView, Marker, Polyline;
if (Platform.OS !== 'web') {
  const Maps = require('react-native-maps');
  MapView = Maps.default;
  Marker = Maps.Marker;
  Polyline = Maps.Polyline;
}

const API_HOST = process.env.EXPO_PUBLIC_API_URL || 'http://52.63.245.203:3000';

export default function HomeScreen() {
  const router = useRouter();
  const { email, role, name } = useLocalSearchParams();
  const [activeTab, setActiveTab] = useState('goto');
  const [hasStarted, setHasStarted] = useState(false);
  const [isAbsenceModalVisible, setIsAbsenceModalVisible] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [routeData, setRouteData] = useState({ vehicleId: null, stops: [], routePoints: [], academy: null });
  const [busLocation, setBusLocation] = useState(null);
  const socketRef = require('react').useRef(null);

  // Camera state for student boarding
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (role === 'PARENT' || role === 'STUDENT' || !role) {
      fetchNotifications();
      fetchRoute();
    }
  }, [role]);

  const fetchRoute = async () => {
    try {
      const res = await fetch(`${API_HOST}/parent/route?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setRouteData(data);
        if (data.vehicleId) {
          if (!socketRef.current) {
            socketRef.current = io(API_HOST);
            socketRef.current.on('locationUpdated', (locData) => {
              setBusLocation({ latitude: locData.lat, longitude: locData.lng });
            });
          }
          socketRef.current.emit('joinVehicleRoom', data.vehicleId);
        }
      }
    } catch (e) {
      console.log('Failed to fetch route', e);
    }
  };

  useEffect(() => {
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
    };
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await fetch(`${API_HOST}/parent/notifications?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setNotifications(data);
      }
    } catch (e) {
      console.log('Failed to fetch notifications', e);
    }
  };

  const handleStudentScanQR = async ({ type, data }) => {
    setScanned(true);
    let teacherEmail;
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'boarding_qr') {
        teacherEmail = parsed.teacherEmail;
      }
    } catch (e) {
      console.log('Invalid QR format');
    }

    if (!teacherEmail) {
      alert('유효하지 않은 탑승 QR 코드입니다.');
      setScanned(false);
      return;
    }

    try {
      const res = await fetch(`${API_HOST}/teacher/student-board`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentEmail: email, teacherEmail })
      });
      const result = await res.json();
      if (res.ok) {
        alert('탑승 처리가 완료되었습니다!');
        setIsScanning(false);
      } else {
        alert(result.message || '탑승 처리에 실패했습니다.');
        setScanned(false);
      }
    } catch (e) {
      alert('네트워크 오류가 발생했습니다.');
      setScanned(false);
    }
  };

  // ----------------------------------------------------
  // STUDENT & PARENT HOME
  // ----------------------------------------------------
  const renderStudentParentHome = () => {
    if (isScanning) {
      if (!permission) return <View style={styles.mainContainer} />;
      if (!permission.granted) {
        return (
          <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
            <Text style={{marginBottom: 20}}>카메라 권한이 필요합니다.</Text>
            <TouchableOpacity style={styles.actionBtn} onPress={requestPermission}>
              <Text style={styles.actionBtnText}>권한 요청하기</Text>
            </TouchableOpacity>
          </View>
        );
      }
      return (
        <View style={{flex:1, backgroundColor:'black'}}>
          <View style={{padding:20, paddingTop:50, flexDirection:'row', justifyContent:'space-between', alignItems:'center', zIndex:10}}>
            <Text style={{color:'white', fontSize: 20, fontWeight: 'bold'}}>탑승 QR 스캔</Text>
            <TouchableOpacity onPress={() => setIsScanning(false)} style={{padding: 10, backgroundColor:'rgba(255,255,255,0.2)', borderRadius:20}}>
              <Text style={{color:'white', fontWeight:'bold'}}>닫기 ✕</Text>
            </TouchableOpacity>
          </View>
          <CameraView
            onBarcodeScanned={scanned ? undefined : handleStudentScanQR}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={{position:'absolute', bottom: 50, width:'100%', alignItems:'center'}}>
            <Text style={{color:'white', backgroundColor:'rgba(0,0,0,0.6)', padding: 16, borderRadius:20, overflow:'hidden'}}>
              지도교사님의 폰에 띄워진 QR을 사각형 안에 맞춰주세요.
            </Text>
          </View>
        </View>
      );
    }

    return (
      <>
        <View style={styles.tabContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'goto' && styles.activeTab]}
          onPress={() => setActiveTab('goto')}
        >
          <Text style={[styles.tabText, activeTab === 'goto' && styles.activeTabText]}>🏫 등원</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'gohome' && styles.activeTab]}
          onPress={() => setActiveTab('gohome')}
        >
          <Text style={[styles.tabText, activeTab === 'gohome' && styles.activeTabText]}>🏠 하원</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.guideCard}>
        <MapPin size={24} color="#2563eb" />
        <View style={styles.guideTextContainer}>
          <Text style={styles.guideText}>
            2027년 7월 19일 15시 30분
          </Text>
          <Text style={styles.guideTextBold}>
            래미안 1단지 정문 앞 탑승 예정
          </Text>
        </View>
      </View>

      <View style={styles.mapContainer}>
        {Platform.OS === 'web' ? (
          <View style={styles.mapPlaceholder}>
            <Navigation size={48} color="#94a3b8" style={{ opacity: 0.5 }} />
            <Text style={styles.mapPlaceholderText}>웹 브라우저에서는 지도를 표시할 수 없습니다.</Text>
            <Text style={styles.mapPlaceholderText}>Expo Go 앱에서 확인해주세요.</Text>
          </View>
        ) : MapView ? (
          <MapView
            style={StyleSheet.absoluteFillObject}
            initialRegion={{
              latitude: routeData.academy?.latitude || 37.558,
              longitude: routeData.academy?.longitude || 126.824,
              latitudeDelta: 0.03,
              longitudeDelta: 0.03,
            }}
          >
            {routeData.routePoints.length > 0 && (
              <Polyline
                coordinates={routeData.routePoints.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
                strokeColor="#2563eb"
                strokeWidth={4}
              />
            )}
            
            {routeData.academy && (
              <Marker
                coordinate={{ latitude: routeData.academy.latitude, longitude: routeData.academy.longitude }}
                title="유치원"
                pinColor="red"
              />
            )}

            {routeData.stops.map((stop, index) => (
              <Marker 
                key={index} 
                coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
                title={stop.name}
                description={stop.address}
              >
                <View style={styles.markerContainer}>
                  <Text style={styles.markerText}>{index + 1}</Text>
                </View>
              </Marker>
            ))}

            {busLocation && (
              <Marker coordinate={busLocation} title="셔틀버스 현재 위치">
                <View style={[styles.markerContainer, { backgroundColor: '#ef4444', borderColor: '#b91c1c' }]}>
                  <Text style={[styles.markerText, { fontSize: 16 }]}>🚌</Text>
                </View>
              </Marker>
            )}
          </MapView>
        ) : null}
      </View>

      {role !== 'STUDENT' ? (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => setIsAbsenceModalVisible(true)}>
            <CalendarClock size={20} color="#2563eb" />
            <Text style={styles.actionBtnText}>결석 / 탑승지 변경 / 메시지</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => { setScanned(false); setIsScanning(true); }}>
            <QrCode size={20} color="#2563eb" />
            <Text style={styles.actionBtnText}>📷 탑승 QR 스캔하기</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.notiSection}>
        <Text style={styles.notiTitle}><Bell size={18} color="#0f172a" /> 수신함</Text>
        <ScrollView style={styles.notiScroll} showsVerticalScrollIndicator={false}>
          {notifications.length === 0 ? (
            <Text style={styles.noNotiText}>새로운 공지가 없습니다.</Text>
          ) : (
            notifications.map((n, i) => (
              <View key={i} style={styles.notiCard}>
                <Text style={styles.notiTime}>{new Date(n.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</Text>
                <Text style={styles.notiMessage}>{n.message}</Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      <AbsenceModal 
        visible={isAbsenceModalVisible} 
        onClose={() => setIsAbsenceModalVisible(false)} 
        email={email} 
      />
    </>
  )};

  // ----------------------------------------------------
  // DRIVER HOME
  // ----------------------------------------------------
  const renderDriverHome = () => (
    <TeacherDashboard email={email} name={name} role="DRIVER" />
  );

  // ----------------------------------------------------
  // TEACHER HOME
  // ----------------------------------------------------
  const renderTeacherHome = () => (
    <TeacherDashboard email={email} name={name} role="TEACHER" />
  );

  return (
    <SafeAreaView style={styles.mainContainer}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>TAKEME</Text>
        <TouchableOpacity onPress={() => router.push({ pathname: '/settings', params: { email } })}>
          <Settings size={28} color="#475569" />
        </TouchableOpacity>
      </View>
      
      {role === 'DRIVER' && renderDriverHome()}
      {role === 'TEACHER' && renderTeacherHome()}
      {(role === 'STUDENT' || role === 'PARENT' || !role) && renderStudentParentHome()}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '900',
    color: '#2563eb',
    letterSpacing: -0.5,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: '#f8fafc',
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: '#e2e8f0',
  },
  activeTab: {
    borderBottomColor: '#2563eb',
  },
  tabText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#94a3b8',
  },
  activeTabText: {
    color: '#2563eb',
  },
  guideCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    marginHorizontal: 24,
    padding: 24,
    borderRadius: 24,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 5,
  },
  guideTextContainer: {
    marginLeft: 18,
    flex: 1, // Fix overflow issue
  },
  guideText: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 4,
  },
  guideTextBold: {
    fontWeight: '800',
    color: '#1e293b',
    fontSize: 16,
  },
  mapContainer: {
    marginHorizontal: 24,
    height: 220,
    borderRadius: 24,
    backgroundColor: '#f1f5f9',
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 24,
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapPlaceholderText: {
    marginTop: 16,
    color: '#94a3b8',
    fontWeight: '600',
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glassCard: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingVertical: 32,
    paddingHorizontal: 40,
    borderRadius: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 5,
  },
  glassCardIcon: {
    fontSize: 40,
    marginBottom: 16,
  },
  glassCardTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#334155',
    marginBottom: 8,
  },
  glassCardSub: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  actionRow: {
    paddingHorizontal: 20,
    marginTop: -10, // Bring it closer to the map
    marginBottom: 20,
  },
  actionBtn: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
    borderRadius: 20,
    gap: 10,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  actionBtnText: {
    color: '#2563eb',
    fontSize: 16,
    fontWeight: '800',
  },
  notiSection: {
    flex: 1,
    paddingHorizontal: 24,
  },
  notiTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 16,
  },
  markerContainer: {
    backgroundColor: '#3b82f6',
    padding: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 12,
  },
  notiScroll: {
    flex: 1,
  },
  notiCard: {
    backgroundColor: '#ffffff',
    padding: 18,
    borderRadius: 20,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  notiTime: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 4,
  },
  notiMessage: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
  },
  noNotiText: {
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 15,
  }
});
