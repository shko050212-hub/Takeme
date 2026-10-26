import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, Image, Modal, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin, Navigation, Settings, Bell, CalendarClock, QrCode } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import AbsenceModal from '../components/AbsenceModal';
import TeacherDashboard from '../components/TeacherDashboard';
import { CameraView, useCameraPermissions } from 'expo-camera';
import io from 'socket.io-client';
import { API_HOST, authFetch, socketOptions } from '../lib/api';

import KakaoMap from '../components/KakaoMap';


export default function HomeScreen() {
  const router = useRouter();
  const { email, role, name, token } = useLocalSearchParams();
  const [activeTab, setActiveTab] = useState('goto');
  const [hasStarted, setHasStarted] = useState(false);
  const [isAbsenceModalVisible, setIsAbsenceModalVisible] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [routeData, setRouteData] = useState({ vehicleId: null, stops: [], routePoints: [], academy: null });
  const [busLocation, setBusLocation] = useState(null);
  const socketRef = require('react').useRef(null);

  // Child & Allergy state
  const [childInfo, setChildInfo] = useState<any>(null);
  const [isAllergyModalVisible, setIsAllergyModalVisible] = useState(false);
  const [allergyInput, setAllergyInput] = useState('');
  const [isSavingAllergy, setIsSavingAllergy] = useState(false);

  // Camera state for student boarding
  const [permission, requestPermission] = useCameraPermissions();
  const [isScanning, setIsScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (role === 'PARENT' || role === 'STUDENT' || !role) {
      fetchNotifications();
      fetchRoute();
      fetchChildInfo();
    }
  }, [role]);

  const fetchChildInfo = async () => {
    try {
      const res = await authFetch(`${API_HOST}/parent/my-child?email=${email}`);
      if (res.ok) {
        const data = await res.json();
        setChildInfo(data);
        if (data && data.allergies) {
          setAllergyInput(data.allergies);
        }
      }
    } catch (e) {
      console.log('Failed to fetch child info', e);
    }
  };

  const commonAllergies = ['땅콩', '견과류', '우유', '복숭아', '계란', '갑각류', '대두', '밀가루', '생선'];

  const toggleAllergyChip = (chip: string) => {
    let current = allergyInput ? allergyInput.split(',').map(s => s.trim()).filter(Boolean) : [];
    if (current.includes(chip)) {
      current = current.filter(c => c !== chip);
    } else {
      current.push(chip);
    }
    setAllergyInput(current.join(', '));
  };

  const handleSaveAllergy = async () => {
    setIsSavingAllergy(true);
    try {
      const res = await authFetch(`${API_HOST}/parent/my-child/allergies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, allergies: allergyInput.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setChildInfo((prev: any) => prev ? { ...prev, allergies: allergyInput.trim() } : prev);
        setIsAllergyModalVisible(false);
        if (Platform.OS === 'web') {
          window.alert('알레르기 정보가 저장되었습니다.');
        } else {
          Alert.alert('저장 완료', '알레르기 정보가 저장되었습니다.');
        }
      } else {
        const msg = data.message || '저장에 실패했습니다.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('오류', msg);
      }
    } catch (e) {
      if (Platform.OS === 'web') window.alert('서버 통신에 실패했습니다.');
      else Alert.alert('오류', '서버 통신에 실패했습니다.');
    } finally {
      setIsSavingAllergy(false);
    }
  };

  const fetchRoute = async () => {
    try {
      const res = await authFetch(`${API_HOST}/parent/route?email=${email}`);
      const data = await res.json();
      if (res.ok) {
        setRouteData(data);
        if (data.vehicleId) {
          if (!socketRef.current) {
            socketRef.current = io(API_HOST, socketOptions());
            socketRef.current.on('locationUpdated', (locData) => {
              setBusLocation({ latitude: locData.lat, longitude: locData.lng });
            });
          }
          socketRef.current.emit('joinVehicleRoom', { vehicleId: data.vehicleId });
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
      const res = await authFetch(`${API_HOST}/parent/notifications?email=${email}`);
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
      const res = await authFetch(`${API_HOST}/teacher/student-board`, {
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
          <Text style={[styles.tabText, activeTab === 'goto' && styles.activeTabText]}>등원</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'gohome' && styles.activeTab]}
          onPress={() => setActiveTab('gohome')}
        >
          <Text style={[styles.tabText, activeTab === 'gohome' && styles.activeTabText]}>하원</Text>
        </TouchableOpacity>
      </View>

      {/* Child & Allergy Info Card */}
      {role !== 'STUDENT' && childInfo && (
        <View style={styles.childCard}>
          <View style={styles.childHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.childName}>
                {childInfo.name} 원아{childInfo.className ? ` (${childInfo.className})` : ''}
              </Text>
              <Text style={styles.childSub}>
                {childInfo.academyName || '소속 원'} · {childInfo.vehicleName}
              </Text>
            </View>
            <TouchableOpacity 
              style={styles.allergyEditBtn} 
              onPress={() => {
                setAllergyInput(childInfo.allergies || '');
                setIsAllergyModalVisible(true);
              }}
            >
              <Text style={styles.allergyEditBtnText}>
                {childInfo.allergies ? '알레르기 수정' : '알레르기 등록'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.allergyBox, childInfo.allergies ? styles.allergyBoxAlert : styles.allergyBoxSafe]}>
            <Text style={styles.allergyLabel}>알레르기 정보</Text>
            <Text style={[styles.allergyValue, childInfo.allergies ? styles.allergyValueAlert : styles.allergyValueSafe]}>
              {childInfo.allergies ? childInfo.allergies : '등록된 알레르기가 없습니다.'}
            </Text>
          </View>
        </View>
      )}

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
        <KakaoMap
          routePoints={routeData?.routePoints || []}
          stops={routeData?.stops || []}
          busLocation={busLocation}
          academy={routeData?.academy}
        />
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
            <Text style={styles.actionBtnText}>탑승 QR 스캔하기</Text>
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

      {/* Allergy Edit Modal */}
      <Modal visible={isAllergyModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>원아 알레르기 관리</Text>
            <Text style={styles.modalSub}>
              식품이나 약품 등 주의해야 할 알레르기를 등록해주세요. 버스 지도교사 및 기사님께 실시간 공유됩니다.
            </Text>

            <Text style={styles.modalSectionLabel}>빠른 선택 태그</Text>
            <View style={styles.chipRow}>
              {commonAllergies.map(chip => {
                const isSelected = allergyInput.split(',').map(s => s.trim()).includes(chip);
                return (
                  <TouchableOpacity
                    key={chip}
                    onPress={() => toggleAllergyChip(chip)}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {chip}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.modalSectionLabel}>상세 알레르기 및 유의사항</Text>
            <TextInput
              style={styles.modalInput}
              value={allergyInput}
              onChangeText={setAllergyInput}
              placeholder="직접 입력 (예: 복숭아 먹으면 두드러기, 견과류 절대 금지 등)"
              placeholderTextColor="#94a3b8"
              multiline
              numberOfLines={3}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsAllergyModalVisible(false)}
                disabled={isSavingAllergy}
              >
                <Text style={styles.modalCancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveAllergy}
                disabled={isSavingAllergy}
              >
                {isSavingAllergy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.modalSaveBtnText}>알레르기 저장</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
    <TeacherDashboard email={email} name={name} role="DRIVER" token={token} />
  );

  // ----------------------------------------------------
  // TEACHER HOME
  // ----------------------------------------------------
  const renderTeacherHome = () => (
    <TeacherDashboard email={email} name={name} role="TEACHER" token={token} />
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
  },
  childCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 24,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  childHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  childName: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  childSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '500',
  },
  allergyEditBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  allergyEditBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  allergyBox: {
    padding: 10,
    borderRadius: 12,
  },
  allergyBoxAlert: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  allergyBoxSafe: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  allergyLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 2,
  },
  allergyValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  allergyValueAlert: {
    color: '#dc2626',
  },
  allergyValueSafe: {
    color: '#10b981',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 4,
  },
  modalSub: {
    fontSize: 12,
    color: '#64748b',
    marginBottom: 16,
    lineHeight: 18,
  },
  modalSectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  chipTextSelected: {
    color: '#2563eb',
    fontWeight: '700',
  },
  modalInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    padding: 12,
    fontSize: 13,
    color: '#1e293b',
    minHeight: 70,
    textAlignVertical: 'top',
    marginBottom: 18,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  modalSaveBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#ffffff',
  }
});
