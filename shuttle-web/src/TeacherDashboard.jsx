import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import BoardViewer from './board/BoardViewer';
import MessagePanel from './MessagePanel';
import LogViewer from './LogViewer';
import { API_BASE_URL } from './config';
import { formatTeacherName } from './utils/teacherUtil';

// Haversine Distance Helper
function getDistanceKm(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Leaflet Bus & School Icons
const schoolIcon = L.divIcon({
  className: 'custom-school-icon',
  html: '<div style="background-color:#2563eb;color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,0.3);font-size:11px;font-weight:bold;">유치원</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

const busIcon = L.divIcon({
  className: 'custom-bus-icon',
  html: '<div style="background-color:#f59e0b;color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,0.3);font-size:11px;font-weight:bold;">셔틀</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

export default function TeacherDashboard({
  currentUser = {},
  academy = {},
  buses = [],
  students = [],
  availableClasses = ['햇살반', '열매반', '풀잎반', '새싹반'],
  selectedAcademyId,
  socket,
  onLogout,
  onRefreshData,
  boardPosts = [],
  setBoardPosts,
}) {
  // Navigation State on Left Rail: 'home' | 'shuttle' | 'board' | 'cloud'
  const [activeNavTab, setActiveNavTab] = useState('home');

  // Homeroom shuttle status state
  const [homeroomStatus, setHomeroomStatus] = useState(null);
  const [isHomeroomLoading, setIsHomeroomLoading] = useState(false);

  const fetchHomeroomStatus = useCallback(async () => {
    try {
      let token = localStorage.getItem('takeme_token');
      if (!token) {
        try {
          const u = JSON.parse(localStorage.getItem('takeme_user') || '{}');
          token = u?.accessToken;
        } catch (_) {}
      }
      const res = await fetch(`${API_BASE_URL}/teacher/homeroom/shuttle-status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setHomeroomStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch homeroom shuttle status:', e);
    } finally {
      setIsHomeroomLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeNavTab === 'shuttle') {
      setIsHomeroomLoading(true);
      fetchHomeroomStatus();
      const interval = setInterval(fetchHomeroomStatus, 30000); // 30초마다 자동 갱신
      return () => clearInterval(interval);
    }
  }, [activeNavTab, fetchHomeroomStatus]);

  // Attendance Management State
  const [attendanceDate, setAttendanceDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [attendanceData, setAttendanceData] = useState(null);
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false);

  const fetchAttendance = useCallback(async (date) => {
    const targetDate = date || attendanceDate;
    try {
      setIsAttendanceLoading(true);
      let token = localStorage.getItem('takeme_token');
      if (!token) {
        try {
          const userStr = localStorage.getItem('takeme_user');
          if (userStr) token = JSON.parse(userStr).token;
        } catch (_) {}
      }
      const res = await fetch(`${API_BASE_URL}/teacher/homeroom/attendance?date=${targetDate}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setAttendanceData(data);
      }
    } catch (e) {
      console.error('Failed to fetch attendance:', e);
    } finally {
      setIsAttendanceLoading(false);
    }
  }, [attendanceDate]);

  useEffect(() => {
    if (activeNavTab === 'attendance') {
      fetchAttendance();
    }
  }, [activeNavTab, attendanceDate, fetchAttendance]);

  const handleAttendanceStatusChange = (studentId, status) => {
    if (!attendanceData?.students) return;
    setAttendanceData(prev => ({
      ...prev,
      students: prev.students.map(s => s.studentId === studentId ? { ...s, status } : s)
    }));
  };

  const handleAllPresent = () => {
    if (!attendanceData?.students) return;
    setAttendanceData(prev => ({
      ...prev,
      students: prev.students.map(s => ({ ...s, status: 'PRESENT' }))
    }));
  };

  const handleSubmitAttendance = async () => {
    if (!attendanceData?.students || attendanceData.students.length === 0) {
      alert('출석을 체크할 원아가 없습니다.');
      return;
    }
    try {
      setIsSubmittingAttendance(true);
      let token = localStorage.getItem('takeme_token');
      if (!token) {
        try {
          const userStr = localStorage.getItem('takeme_user');
          if (userStr) token = JSON.parse(userStr).token;
        } catch (_) {}
      }
      const payload = {
        date: attendanceDate,
        attendances: attendanceData.students.map(s => ({
          studentId: s.studentId,
          status: s.status,
          memo: s.memo,
        })),
      };
      const res = await fetch(`${API_BASE_URL}/teacher/homeroom/attendance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || '출석부가 성공적으로 제출되었습니다!');
        fetchAttendance(attendanceDate);
      } else {
        alert(data.message || '출석부 제출에 실패했습니다.');
      }
    } catch (e) {
      alert('출석부 제출 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingAttendance(false);
    }
  };

  // Temporary Cloud Storage State
  const cloudStorageKey = `takeme_teacher_cloud_${currentUser?.id || 'default'}`;
  const [cloudPhotos, setCloudPhotos] = useState(() => {
    try {
      const saved = localStorage.getItem(cloudStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return [
      {
        id: 'sample-1',
        name: '가을 소풍 단체 활동.jpg',
        url: 'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=800&auto=format&fit=crop&q=80',
        size: '1.40 MB',
        uploadedAt: '오늘 10:30'
      },
      {
        id: 'sample-2',
        name: '미술 시간 블록 쌓기.jpg',
        url: 'https://images.unsplash.com/photo-1544717305-2782549b5136?w=800&auto=format&fit=crop&q=80',
        size: '2.10 MB',
        uploadedAt: '어제 15:40'
      }
    ];
  });

  const [isUploadingToCloud, setIsUploadingToCloud] = useState(false);
  const [isDraggingOverCloud, setIsDraggingOverCloud] = useState(false);
  const cloudFileInputRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(cloudStorageKey, JSON.stringify(cloudPhotos));
    } catch (e) {
      console.error('Failed to save cloud photos', e);
    }
  }, [cloudPhotos, cloudStorageKey]);

  const processCloudFiles = async (files) => {
    if (!files || files.length === 0) return;
    setIsUploadingToCloud(true);

    const newPhotos = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 20 * 1024 * 1024) {
        alert(`${file.name}: 20MB 이하의 이미지만 업로드 가능합니다.`);
        continue;
      }

      try {
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        let finalUrl = base64Data;
        try {
          const res = await fetch(`${API_BASE_URL}/routing/board/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64Data,
              filename: file.name,
              mimeType: file.type
            })
          });
          const data = await res.json();
          if (res.ok && data.url) {
            finalUrl = data.url;
          }
        } catch (netErr) {
          console.warn('Server upload fallback to local data', netErr);
        }

        newPhotos.unshift({
          id: `${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          url: finalUrl,
          size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
          uploadedAt: '방금 전'
        });
      } catch (err) {
        console.error('Failed to process file', file.name, err);
      }
    }

    if (newPhotos.length > 0) {
      setCloudPhotos(prev => [...newPhotos, ...prev]);
    }
    setIsUploadingToCloud(false);
  };

  const handleCloudFileChange = (e) => {
    processCloudFiles(e.target.files);
    e.target.value = '';
  };

  const handleDeleteCloudPhoto = (photoId) => {
    if (window.confirm('이 사진을 임시 보관함에서 삭제하시겠습니까?')) {
      setCloudPhotos(prev => prev.filter(p => p.id !== photoId));
    }
  };

  const handleClearAllCloudPhotos = () => {
    if (cloudPhotos.length === 0) return;
    if (window.confirm('임시 보관함에 보관된 모든 사진을 삭제하시겠습니까?')) {
      setCloudPhotos([]);
    }
  };

  const handleDownloadCloudPhoto = (photo) => {
    const a = document.createElement('a');
    a.href = photo.url;
    a.download = photo.name || 'activity_photo.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Teacher Profile & Class State
  const [localTeacherUser, setLocalTeacherUser] = useState(currentUser);
  const teacherClass = localTeacherUser?.assignedClass || '';
  const isAssigned = Boolean(teacherClass && teacherClass !== '미배정');

  // Refresh Teacher Profile (check if Director assigned a class)
  const [isCheckingProfile, setIsCheckingProfile] = useState(false);
  const handleCheckProfile = async () => {
    if (!currentUser?.id) return;
    setIsCheckingProfile(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/teacher/profile/${currentUser.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.assignedClass) {
          const updatedUser = { ...localTeacherUser, assignedClass: data.assignedClass };
          setLocalTeacherUser(updatedUser);
          localStorage.setItem('takeme_user', JSON.stringify(updatedUser));
          alert(`[${data.assignedClass}] 담임으로 배정되었습니다!`);
        } else {
          alert('아직 담당 반이 배정되지 않았습니다. 관리자님께 문의해주세요.');
        }
      }
    } catch (e) {
      alert('프로필 정보를 확인하는 중 오류가 발생했습니다.');
    } finally {
      setIsCheckingProfile(false);
      if (onRefreshData) onRefreshData();
    }
  };

  // Filter students belonging to this teacher's assigned class
  const myStudents = useMemo(() => {
    if (!isAssigned) return [];
    return students.filter(st => {
      const cls = st.raw?.['반명'] || st.raw?.['반'] || '';
      return cls.trim() === teacherClass.trim();
    });
  }, [students, teacherClass, isAssigned]);

  // Search and status filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'SHUTTLE' | 'PICKUP' | 'ABSENT'

  // Memo Modal State
  const [selectedStudentForMemo, setSelectedStudentForMemo] = useState(null);
  const [memoInput, setMemoInput] = useState('');
  const [viewMode, setViewMode] = useState('cell'); // 'cell' (default) | 'card'
  const [localBoardStatusOverrides, setLocalBoardStatusOverrides] = useState({});
  const [showApprovalHistory, setShowApprovalHistory] = useState(false);
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  // Shuttle Map Modal State
  const [selectedBusForMap, setSelectedBusForMap] = useState(null);

  // Board Specific State
  const [boardSelectedClass, setBoardSelectedClass] = useState(teacherClass || 'ALL');
  const [boardSearchKeyword, setBoardSearchKeyword] = useState('');
  const [isCreatingBoardPost, setIsCreatingBoardPost] = useState(false);
  const [boardInitialPostType, setBoardInitialPostType] = useState('ALL');

  // Shuttle Ride Request & Payment States
  const [rideRequests, setRideRequests] = useState({});
  const [quickRequestModal, setQuickRequestModal] = useState(null); // { student, targetBus, distanceLabel, remainingSeats, capacity, allEvaluatedBuses }
  const [quickRequestRideType, setQuickRequestRideType] = useState('TODAY_ONLY'); // 'TODAY_ONLY' | 'REGULAR'
  const [quickRequestMode, setQuickRequestMode] = useState('ONE_ON_ONE'); // 'ONE_ON_ONE' | 'CONTEST'
  const [isSendingQuickRequest, setIsSendingQuickRequest] = useState(false);
  const [isDecidingRequest, setIsDecidingRequest] = useState(null);

  // Helper: Non-shuttle student check
  const checkIsNonShuttle = (st) => {
    if (!st) return false;
    if (st.isNotRiding) return true;
    const raw = st.raw || {};
    if (raw['미탑승'] === true || raw['미탑승'] === 'O' || raw['미탑승'] === 'true' || raw['미탑승'] === '미탑승') return true;
    if (raw['차량미탑승'] === true || raw['차량미탑승'] === 'O' || raw['차량미탑승'] === 'true' || raw['차량미탑승'] === '미탑승') return true;
    if (!st.assignedBusId && !st.assignedDepartureBusId) return true;
    return false;
  };

  // Helper: Effective Board Status (Non-shuttle defaults to SELF_PICKUP)
  const getStudentEffectiveBoardStatus = (st) => {
    if (st && localBoardStatusOverrides[st.id]) return localBoardStatusOverrides[st.id];
    if (st?.boardStatus) return st.boardStatus;
    if (checkIsNonShuttle(st)) return 'SELF_PICKUP';
    return 'WAITING';
  };

  // Helper: Bus Proximity Calculation
  const getBusProximityInfo = (bus, student, allStudents) => {
    const sLat = student?.latitude || student?.lat;
    const sLng = student?.longitude || student?.lng;
    if (!sLat || !sLng) return { distance: 999999, label: '위치 정보 없음' };

    let minDist = 999999;
    const poly = bus.polygon || bus.polygonCoordinates || [];
    if (Array.isArray(poly)) {
      poly.forEach(pt => {
        const pLat = Array.isArray(pt) ? pt[0] : pt?.lat;
        const pLng = Array.isArray(pt) ? pt[1] : pt?.lng;
        if (pLat && pLng) {
          const d = getDistanceKm(sLat, sLng, pLat, pLng);
          if (d < minDist) minDist = d;
        }
      });
    }

    (allStudents || []).forEach(other => {
      if (other.id !== student.id && (other.assignedBusId === bus.id || other.assignedDepartureBusId === bus.id)) {
        const oLat = other.latitude || other.lat;
        const oLng = other.longitude || other.lng;
        if (oLat && oLng) {
          const d = getDistanceKm(sLat, sLng, oLat, oLng);
          if (d < minDist) minDist = d;
        }
      }
    });

    let label = '';
    if (minDist === 999999) {
      label = '구역 정보';
    } else if (minDist < 1) {
      label = `약 ${Math.round(minDist * 1000)}m 근접`;
    } else {
      label = `약 ${minDist.toFixed(1)}km 근접`;
    }

    return { distance: minDist, label };
  };

  // Fetch Payment Requests from Payment System Chat Room
  const fetchRideRequests = async () => {
    try {
      const token = localStorage.getItem('takeme_token');
      const email = localTeacherUser?.email || currentUser?.email || '';
      const res = await fetch(`${API_BASE_URL}/chat/rooms?email=${encodeURIComponent(email)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!res.ok) return;
      const rooms = await res.json();
      const paymentRoom = rooms.find(r => r.type === 'PAYMENT_SYSTEM' || r.name === '결제 시스템 방');
      if (!paymentRoom) return;

      const msgRes = await fetch(`${API_BASE_URL}/chat/rooms/${paymentRoom.id}/messages`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!msgRes.ok) return;
      const messages = await msgRes.json();

      const map = {};
      messages.forEach(msg => {
        if (msg.type === 'PAYMENT_REQUEST' && msg.payload?.studentId) {
          const stId = Number(msg.payload.studentId);
          map[stId] = {
            messageId: msg.id,
            status: msg.payload.status || 'PENDING',
            vehicleId: msg.payload.vehicleId,
            busNumber: msg.payload.busNumber,
            teacherName: msg.payload.teacherName,
            driverName: msg.payload.driverName,
            boardingLocation: msg.payload.boardingLocation,
            note: msg.payload.note,
            counterProposal: msg.payload.counterProposal,
            counterNote: msg.payload.counterNote,
            counterProposedBy: msg.payload.counterProposedBy,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt
          };
        }
      });
      setRideRequests(map);
    } catch (e) {
      console.warn('Failed to load ride requests', e);
    }
  };

  useEffect(() => {
    fetchRideRequests();
  }, [localTeacherUser?.email, currentUser?.email, selectedAcademyId]);

  // Real-time socket sync for payment approvals
  useEffect(() => {
    if (!socket) return;

    const handleChatMessage = (msg) => {
      if (msg?.type === 'PAYMENT_REQUEST' && msg.payload?.studentId) {
        const stId = Number(msg.payload.studentId);
        setRideRequests(prev => ({
          ...prev,
          [stId]: {
            messageId: msg.id,
            status: msg.payload.status || 'PENDING',
            vehicleId: msg.payload.vehicleId,
            busNumber: msg.payload.busNumber,
            teacherName: msg.payload.teacherName,
            driverName: msg.payload.driverName,
            boardingLocation: msg.payload.boardingLocation,
            note: msg.payload.note,
            counterProposal: msg.payload.counterProposal,
            counterNote: msg.payload.counterNote,
            counterProposedBy: msg.payload.counterProposedBy,
            createdAt: msg.createdAt,
            updatedAt: msg.updatedAt
          }
        }));
        if (msg.payload.status === 'APPROVED' && onRefreshData) {
          onRefreshData();
        }
      }
    };

    const handleRouteUpdated = () => {
      fetchRideRequests();
      if (onRefreshData) onRefreshData();
    };

    socket.on('chatMessage', handleChatMessage);
    socket.on('paymentDecision', handleChatMessage);
    socket.on('routeUpdated', handleRouteUpdated);

    return () => {
      socket.off('chatMessage', handleChatMessage);
      socket.off('paymentDecision', handleChatMessage);
      socket.off('routeUpdated', handleRouteUpdated);
    };
  }, [socket, onRefreshData]);

  // Helper: Count active passengers for a bus
  const getBusPassengerCount = (busId) => {
    return (students || []).filter(st => {
      const isAssigned = (st.assignedBusId === busId || st.assignedVehicle?.id === busId || st.assignedDepartureBusId === busId || st.assignedDepartureVehicle?.id === busId);
      const isNotRiding = checkIsNonShuttle(st);
      const isAbsent = st.boardStatus === 'ABSENT' || st.boardStatus === '결석';
      const isPickup = st.boardStatus === 'SELF_PICKUP' || st.boardStatus === '부모님직접픽업';
      return isAssigned && !isNotRiding && !isAbsent && !isPickup;
    }).length;
  };

  // 1-Click: Automatically detect closest vehicle prioritizing available seats first (2번) and prevent duplicates (6번)
  const handlePromptShuttleRideRequest = (student) => {
    // 6번: 중복 신청 방지 체크 (원아 상태 락)
    const existingReq = rideRequests[student.id];
    if (existingReq && (existingReq.status === 'PENDING' || existingReq.status === 'RE_REQUESTED')) {
      alert(`이미 [${student.name}] 원아에 대한 결제/탑승 승인 요청이 진행 중입니다.\n현재 상태: ${existingReq.status === 'RE_REQUESTED' ? '새 위치 제안 검토 중' : '승인 대기 중'}`);
      return;
    }

    // 2번: 가까이 있는 차량 중 좌석이 있는 차량 순으로 정렬
    const evaluatedBuses = [...buses].map(b => {
      const passengers = getBusPassengerCount(b.id);
      const cap = b.capacity || 15;
      const remainingSeats = Math.max(0, cap - passengers);
      const hasSeats = remainingSeats > 0;
      const proximity = getBusProximityInfo(b, student, students);
      return {
        bus: b,
        passengers,
        capacity: cap,
        remainingSeats,
        hasSeats,
        distance: proximity.distance,
        label: proximity.label,
      };
    });

    // 1순위: 좌석 있는 차량 우선 (hasSeats === true), 2순위: 최단 거리 순
    evaluatedBuses.sort((a, b) => {
      if (a.hasSeats !== b.hasSeats) {
        return a.hasSeats ? -1 : 1;
      }
      return a.distance - b.distance;
    });

    const autoBus = evaluatedBuses.length > 0 ? evaluatedBuses[0].bus : null;
    const initialSeatsInfo = evaluatedBuses.length > 0 ? evaluatedBuses[0] : null;

    setQuickRequestRideType('TODAY_ONLY');
    setQuickRequestModal({
      student,
      targetBus: autoBus,
      distanceLabel: initialSeatsInfo?.label || '',
      remainingSeats: initialSeatsInfo?.remainingSeats ?? 0,
      capacity: initialSeatsInfo?.capacity ?? 15,
      allEvaluatedBuses: evaluatedBuses,
    });
  };

  // Execute quick ride request
  const handleExecuteQuickRideRequest = async () => {
    if (!quickRequestModal || !quickRequestModal.student) return;
    const { student, targetBus } = quickRequestModal;

    if (!targetBus) {
      alert('배차 가능한 셔틀 차량 정보가 없습니다. 관리자님께 문의해주세요.');
      return;
    }

    setIsSendingQuickRequest(true);
    try {
      const token = localStorage.getItem('takeme_token');
      const email = localTeacherUser?.email || currentUser?.email;
      const dropoffLocation = student.address || (student.raw && student.raw['도로명주소']) || '원아 등록 거주지';
      const isTodayOnly = quickRequestRideType === 'TODAY_ONLY';

      const res = await fetch(`${API_BASE_URL}/chat/payment-request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          studentId: student.id,
          studentName: student.name,
          vehicleId: Number(targetBus.id),
          boardingLocation: dropoffLocation,
          address: student.address || dropoffLocation,
          latitude: student.latitude || student.lat,
          longitude: student.longitude || student.lng,
          rideType: quickRequestRideType,
          requestDate: new Date().toISOString().split('T')[0],
          note: isTodayOnly ? '오늘 하루 하원 셔틀 탑승 희망 (하차 결재 신청, 익일 자동 픽업 원복)' : '정규 셔틀 탑승 등록 희망 (하차 결재 신청 및 구역 편입)',
          requesterEmail: email
        })
      });

      if (res.ok) {
        const data = await res.json();
        setRideRequests(prev => ({
          ...prev,
          [student.id]: {
            messageId: data.id,
            status: 'PENDING',
            vehicleId: targetBus?.id,
            busNumber: targetBus?.name || targetBus?.busNumber,
            teacherName: targetBus?.teacherName || targetBus?.teacherUser?.name || '담당 지도교사',
            driverName: targetBus?.driverName || '기사님',
            boardingLocation: dropoffLocation,
            rideType: quickRequestRideType,
            note: isTodayOnly ? '오늘 하루 탑승 희망 (익일 자동 원복)' : '정규 셔틀 등록 희망'
          }
        }));

        alert(`[${student.name}] 원아의 ${isTodayOnly ? '당일 1회' : '정규'} 탑승 결제 요청이 ${targetBus.name} ${targetBus.teacherName || ''} 지도교사님께 자동으로 발송되었습니다.\n지도교사 수락 시 카드가 초록색으로 변경됩니다.`);
        setQuickRequestModal(null);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || '결제 요청 전송에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('서버 연결 중 오류가 발생했습니다.');
    } finally {
      setIsSendingQuickRequest(false);
    }
  };

  // Homeroom Teacher accepts or rejects the Guide Teacher's counter-proposal (재결재 새로운 위치 요청)
  const handleDecidePaymentRequest = async (messageId, decision) => {
    if (!messageId || isDecidingRequest) return;
    const actionText = decision === 'APPROVED' ? '지도교사가 새로 제안한 위치로 탑승을 수락' : '탑승 요청을 반려하고 원래대로 픽업';
    if (!window.confirm(`${actionText}하시겠습니까?`)) return;

    setIsDecidingRequest(messageId);
    try {
      const token = localStorage.getItem('takeme_token');
      const email = localTeacherUser?.email || currentUser?.email;
      const res = await fetch(`${API_BASE_URL}/chat/payment-request/${messageId}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          decision,
          decidedByEmail: email
        })
      });

      if (res.ok) {
        alert(decision === 'APPROVED' ? '새로 제안된 위치로 셔틀 탑승이 최종 확정되었습니다!' : '탑승 요청이 반려 처리되었습니다.');
        fetchRideRequests();
        if (onRefreshData) onRefreshData();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || '처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      alert('서버 연결 중 오류가 발생했습니다.');
    } finally {
      setIsDecidingRequest(null);
    }
  };

  useEffect(() => {
    if (teacherClass) {
      setBoardSelectedClass(teacherClass);
    }
  }, [teacherClass]);

  // Daily Schedule Preset (Kindergarten daily timeline)
  const defaultSchedulePreset = [
    { id: 1, time: '09:00 ~ 09:30', title: '등원 및 자유놀이', desc: '밝은 인사와 함께 원아 맞이 및 체온 점검' },
    { id: 2, time: '09:30 ~ 10:10', title: '오전 간식 & 아침 모임', desc: '제철 과일 간식 및 일과 소개' },
    { id: 3, time: '10:10 ~ 11:20', title: '가을 숲 생태 탐색 활동', desc: '야외 놀이터 자연물 관찰 활동' },
    { id: 4, time: '11:20 ~ 12:30', title: '점심 식사 및 양치 지도', desc: '식사 지도 및 올바른 양치 습관 형성' },
    { id: 5, time: '12:30 ~ 14:00', title: '낮잠 및 휴식 시간', desc: '정적인 실내 휴식 및 낮잠' },
    { id: 6, time: '14:00 ~ 15:00', title: '오후 간식 및 신체 율동 놀이', desc: '간식 섭취 및 신체 율동 시간' },
    { id: 7, time: '15:00 ~ 16:00', title: '1차 셔틀 하원 인솔', desc: '개인 물품 정리 및 1차 통학 차량 탑승' },
    { id: 8, time: '16:30 ~ 17:30', title: '2차 셔틀 하원 및 통합 보육', desc: '2차 하원 차량 탑승 및 연장 보육반 인계' },
  ];

  const scheduleStorageKey = `takeme_schedule_${teacherClass || 'default'}`;
  const [scheduleItems, setScheduleItems] = useState(() => {
    try {
      const saved = localStorage.getItem(scheduleStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return defaultSchedulePreset;
  });

  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [editingScheduleList, setEditingScheduleList] = useState([]);

  useEffect(() => {
    try {
      localStorage.setItem(scheduleStorageKey, JSON.stringify(scheduleItems));
    } catch (e) {
      console.error(e);
    }
  }, [scheduleItems, scheduleStorageKey]);

  const handleSaveSchedule = () => {
    setScheduleItems(editingScheduleList);
    setIsScheduleModalOpen(false);
  };

  const handleAddScheduleItem = () => {
    setEditingScheduleList(prev => [
      ...prev,
      {
        id: Date.now(),
        time: '14:00 ~ 14:30',
        title: '새 일과 활동',
        desc: '일과 활동 내용을 입력하세요.'
      }
    ]);
  };

  const handleDeleteScheduleItem = (index) => {
    setEditingScheduleList(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleResetSchedulePreset = () => {
    if (window.confirm('기본 표준 유치원 일과로 초기화하시겠습니까?')) {
      setEditingScheduleList(defaultSchedulePreset);
    }
  };

  // Latest NOTICE for class banner (connected to official BoardPost system)
  const latestClassNotice = useMemo(() => {
    return boardPosts.find(p => p.postType === 'NOTICE' && (!p.targetClass || p.targetClass === teacherClass)) || null;
  }, [boardPosts, teacherClass]);

  const currentHourMinute = useMemo(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }, []);

  // Summary counts
  const summary = useMemo(() => {
    let shuttleCount = 0;
    let pickupCount = 0;
    let absentCount = 0;

    myStudents.forEach(st => {
      const status = getStudentEffectiveBoardStatus(st);
      const rideReq = rideRequests[st.id];
      const isRideApproved = rideReq && rideReq.status === 'APPROVED';

      if (status === 'ABSENT' || status === '결석') {
        absentCount++;
      } else if (isRideApproved) {
        shuttleCount++;
      } else if (status === 'SELF_PICKUP' || status === '부모님직접픽업') {
        pickupCount++;
      } else {
        shuttleCount++;
      }
    });

    return {
      total: myStudents.length,
      shuttle: shuttleCount,
      pickup: pickupCount,
      absent: absentCount,
    };
  }, [myStudents, rideRequests]);

  // Filtered Students
  const displayedStudents = useMemo(() => {
    return myStudents.filter(st => {
      const name = st.name || '';
      const phone = st.raw?.['학부모전화번호'] || st.raw?.['연락처'] || '';
      const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || phone.includes(searchQuery);

      if (!matchesSearch) return false;

      const status = getStudentEffectiveBoardStatus(st);
      const rideReq = rideRequests[st.id];
      const isRideApproved = rideReq && rideReq.status === 'APPROVED';

      if (filterMode === 'SHUTTLE') {
        return (status !== 'SELF_PICKUP' && status !== '부모님직접픽업' && status !== 'ABSENT' && status !== '결석') || isRideApproved;
      }
      if (filterMode === 'PICKUP') {
        return (status === 'SELF_PICKUP' || status === '부모님직접픽업') && !isRideApproved;
      }
      if (filterMode === 'ABSENT') {
        return status === 'ABSENT' || status === '결석';
      }
      return true;
    });
  }, [myStudents, searchQuery, filterMode, rideRequests]);

  // Pinned Changes & Pending Approvals (오늘 변동사항 및 결재 진행 학생)
  const changedStudents = useMemo(() => {
    return displayedStudents.filter(st => {
      const rideReq = rideRequests[st.id];
      const hasReq = rideReq && (rideReq.status === 'PENDING' || rideReq.status === 'RE_REQUESTED' || rideReq.status === 'APPROVED');
      const eff = getStudentEffectiveBoardStatus(st);
      const isAbsent = eff === 'ABSENT' || eff === '결석';
      const isPickup = eff === 'SELF_PICKUP' || eff === '부모님직접픽업';
      const isTemp = Boolean(st.isTemporaryRide || st.raw?.['isTemporaryRide']);
      return hasReq || isAbsent || isPickup || isTemp;
    });
  }, [displayedStudents, rideRequests]);

  // Regular Students (일반 원아)
  const regularStudents = useMemo(() => {
    return displayedStudents.filter(st => !changedStudents.some(cs => cs.id === st.id));
  }, [displayedStudents, changedStudents]);

  // Group regular students by age and sort by gender (남, 여 살짝 띄워서)
  const groupedRegularStudents = useMemo(() => {
    const groups = {};
    regularStudents.forEach(st => {
      const rawAge = st.raw?.['만나이'] || st.raw?.['나이'] || st.age;
      const ageKey = rawAge ? `${rawAge}세` : '연령 미지정';
      if (!groups[ageKey]) {
        groups[ageKey] = { boys: [], girls: [] };
      }
      const gender = (st.raw?.['성별'] || st.gender || '').trim();
      if (gender === '여' || gender === '여자' || gender === 'F' || gender === 'female') {
        groups[ageKey].girls.push(st);
      } else {
        groups[ageKey].boys.push(st);
      }
    });

    // Sort alphabetically within gender
    Object.keys(groups).forEach(k => {
      groups[k].boys.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
      groups[k].girls.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ko'));
    });

    return groups;
  }, [regularStudents]);

  // Render Table Row for Cell View
  const renderStudentRow = (st, i, isPinned = false) => {
    const rideReq = rideRequests[st.id];
    const isRidePending = rideReq && rideReq.status === 'PENDING';
    const isRideApproved = rideReq && rideReq.status === 'APPROVED';
    const isRideReRequested = rideReq && rideReq.status === 'RE_REQUESTED';
    const effectiveStatus = getStudentEffectiveBoardStatus(st);
    const isAbsent = effectiveStatus === 'ABSENT' || effectiveStatus === '결석';
    const isPickup = (effectiveStatus === 'SELF_PICKUP' || effectiveStatus === '부모님직접픽업') && !isRideApproved;
    const isShuttle = (!isPickup && !isAbsent) || isRideApproved;

    const amBus = buses.find(b => b.id === (st.assignedBusId || st.assignedVehicle?.id || st.assignedVehicleId));
    const pmBus = buses.find(b => b.id === (st.assignedDepartureBusId || st.assignedDepartureVehicle?.id || st.assignedDepartureVehicleId));
    const amBusName = amBus?.name || amBus?.busNumber || st.raw?.['등원차량'] || (st.assignedVehicle?.busNumber ? `${st.assignedVehicle.busNumber}호차` : '미배정');
    const pmBusName = pmBus?.name || pmBus?.busNumber || st.raw?.['하원차량'] || (st.assignedDepartureVehicle?.busNumber ? `${st.assignedDepartureVehicle.busNumber}호차` : '미배정');

    const genderStr = st.raw?.['성별'] || st.gender || '-';
    const ageStr = st.raw?.['만나이'] || st.raw?.['나이'] || st.age || '-';
    const birthStr = st.birthDate || st.raw?.['생년월일'] || st.raw?.['생일'] || st.raw?.['학생생일'] || '-';
    const phoneStr = st.raw?.['학부모전화번호'] || st.raw?.['보호자연락처'] || st.raw?.['연락처'] || st.raw?.['부모연락처'] || st.parentPhone || st.parentUser?.phone || '-';
    const allergyStr = st.allergies || st.raw?.['알레르기'] || st.raw?.['알러지'] || st.raw?.['특이사항(알레르기)'] || '';
    const isNonShuttle = checkIsNonShuttle(st);

    return (
      <tr 
        key={st.id} 
        className={`border-b transition-colors ${
          isPinned ? 'bg-amber-50/50 hover:bg-amber-100/60' : 'hover:bg-slate-50/80'
        }`}
      >
        <td className="py-2.5 px-3 text-center text-xs text-slate-400 font-mono">{i + 1}</td>

        {/* 1. 학생명 */}
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-extrabold text-slate-900 text-xs sm:text-sm">{st.name}</span>
            {genderStr && genderStr !== '-' && (
              <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${genderStr === '남' ? 'bg-blue-50 text-blue-700' : 'bg-pink-50 text-pink-700'}`}>
                {genderStr}
              </span>
            )}
            {ageStr && ageStr !== '-' && (
              <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1 py-0.2 rounded">
                {ageStr}세
              </span>
            )}
          </div>
        </td>

        {/* 2. 학부모 전화번호 */}
        <td className="py-2.5 px-3 text-xs font-mono">
          {phoneStr && phoneStr !== '-' ? (
            <a href={`tel:${phoneStr}`} className="text-blue-600 hover:underline font-bold flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <span>{phoneStr}</span>
            </a>
          ) : (
            <span className="text-slate-400 font-mono">-</span>
          )}
        </td>

        {/* 3. 생일 */}
        <td className="py-2.5 px-3 text-xs text-slate-700 font-mono font-medium">
          {birthStr}
        </td>

        {/* 4. 등원차량 */}
        <td className="py-2.5 px-3">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
            amBusName !== '미배정'
              ? 'bg-blue-50 text-blue-700 border border-blue-200'
              : 'text-slate-400 bg-slate-50'
          }`}>
            {amBusName}
          </span>
        </td>

        {/* 5. 하원차량 */}
        <td className="py-2.5 px-3">
          <div className="flex items-center gap-1 flex-wrap">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
              pmBusName !== '미배정'
                ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                : 'text-slate-400 bg-slate-50'
            }`}>
              {pmBusName}
            </span>
            {isRidePending && (
              <span className="text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.2 rounded-md animate-pulse">
                결재 대기
              </span>
            )}
            {isRideApproved && (
              <span className="text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.2 rounded-md">
                승인 완료
              </span>
            )}
          </div>
        </td>

        {/* 6. 알레르기 */}
        <td className="py-2.5 px-3">
          {allergyStr && allergyStr !== '없음' && allergyStr !== '-' ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-black bg-rose-50 text-rose-700 border border-rose-200 shadow-2xs">
              <svg className="w-3 h-3 text-rose-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span>{allergyStr}</span>
            </span>
          ) : (
            <span className="text-xs text-slate-400">없음</span>
          )}
        </td>

        {/* 7. 결석 / 셔틀 탑승 / 픽업 (버튼) */}
        <td className="py-2.5 px-3">
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            {/* 결석 버튼 */}
            <button
              type="button"
              onClick={() => handleUpdateBoardStatus(st.id, 'ABSENT')}
              className={`px-2.5 py-1 text-xs font-black rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                isAbsent
                  ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-200'
                  : 'bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200'
              }`}
              title="오늘 결석 처리"
            >
              <span>결석</span>
            </button>

            {/* 셔틀 탑승 버튼 */}
            <button
              type="button"
              onClick={() => {
                if (isNonShuttle && !isRideApproved && !isRidePending) {
                  handlePromptShuttleRideRequest(st);
                  return;
                }
                handleUpdateBoardStatus(st.id, 'WAITING');
              }}
              className={`px-2.5 py-1 text-xs font-black rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                isShuttle
                  ? 'bg-blue-600 text-white shadow-xs ring-2 ring-blue-200'
                  : 'bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-700 border border-slate-200'
              }`}
              title="셔틀 탑승 처리"
            >
              <span>셔틀 탑승</span>
              {isNonShuttle && !isRideApproved && !isRidePending && (
                <span className="text-[10px] font-normal opacity-80">(신청)</span>
              )}
            </button>

            {/* 픽업 버튼 */}
            <button
              type="button"
              onClick={() => handleUpdateBoardStatus(st.id, 'SELF_PICKUP')}
              className={`px-2.5 py-1 text-xs font-black rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
                isPickup
                  ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-200'
                  : 'bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200'
              }`}
              title="보호자 직접 픽업 (개별 하원)"
            >
              <span>픽업</span>
            </button>

            {/* 1:1 알림장 메모 버튼 */}
            <button
              type="button"
              onClick={() => {
                setSelectedStudentForMemo(st);
                setMemoInput(st.attendanceMemo || st.teacherMemo || '');
              }}
              className="ml-0.5 px-2 py-1 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 text-slate-500 rounded-lg text-xs font-bold border border-slate-200 transition cursor-pointer"
              title="1:1 알림장 메모 작성"
            >
              알림장
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // Update Student Boarding Mode
  const handleUpdateBoardStatus = async (studentId, newStatus) => {
    setLocalBoardStatusOverrides(prev => ({ ...prev, [studentId]: newStatus }));
    try {
      const res = await fetch(`${API_BASE_URL}/routing/student/${studentId}/board-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardStatus: newStatus })
      });
      if (res.ok) {
        if (onRefreshData) onRefreshData();
      } else {
        alert('상태 변경에 실패했습니다.');
      }
    } catch (e) {
      alert('서버 연결 실패');
    }
  };

  // Open Memo Modal
  const handleOpenMemoModal = (student) => {
    setSelectedStudentForMemo(student);
    setMemoInput(student.teacherMemo || '');
  };

  // Save Memo
  const handleSaveMemo = async () => {
    if (!selectedStudentForMemo) return;
    setIsSavingMemo(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/student/${selectedStudentForMemo.id}/note`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo: memoInput })
      });
      if (res.ok) {
        setSelectedStudentForMemo(null);
        if (onRefreshData) onRefreshData();
      } else {
        alert('알림장 저장에 실패했습니다.');
      }
    } catch (e) {
      alert('서버 연결 실패');
    } finally {
      setIsSavingMemo(false);
    }
  };

  const todayStr = useMemo(() => {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
  }, []);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* ======================================================== */}
      {/* 1. Left Navigation Rail (Matching Director Dashboard Layout) */}
      {/* ======================================================== */}
      <div className="w-20 bg-blue-700 flex flex-col items-center py-8 gap-6 z-20 shadow-xl shrink-0">
        <div className="text-white font-bold text-xs mb-1">Takeme</div>
        <div className="text-[10px] text-blue-200 text-center truncate max-w-[70px] mb-4 font-medium" title={localTeacherUser?.name}>
          {teacherClass ? `${localTeacherUser?.name || '교사'} (${teacherClass})` : (localTeacherUser?.name || '교사')}
        </div>

        {/* Tab 1: 교실 홈 */}
        <button
          onClick={() => setActiveNavTab('home')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'home'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
            }`}
          title="우리 반 교실 홈"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>

        {/* Tab 2: 오늘 셔틀 현황 */}
        <button
          onClick={() => setActiveNavTab('shuttle')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'shuttle'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
            }`}
          title="오늘 셔틀 현황"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-9 8h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v11a2 2 0 002 2zm1-2a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
          </svg>
        </button>

        {/* Tab: 캘린더 & 일정 관리 */}
        <button
          onClick={() => setActiveNavTab('calendar')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'calendar'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
            }`}
          title="반 및 학원 캘린더 & 일정"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        {/* Tab: 출석부 관리 */}
        <button
          onClick={() => setActiveNavTab('attendance')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'attendance'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
            }`}
          title="출석부 관리"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </button>

        {/* Tab 3: 알림장 & 게시판 */}
        <button
          onClick={() => setActiveNavTab('board')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'board'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
            }`}
          title="알림장 & 앨범"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        {/* Tab 4: 사진 보관함 */}
        <button
          onClick={() => setActiveNavTab('cloud')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'cloud'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
            }`}
          title="사진 보관함"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </button>

        {/* Tab 4: 실시간 메시지 & 결재 승인 */}
        <button
          onClick={() => setActiveNavTab('messages')}
          className={`p-4 rounded-2xl transition-all ${activeNavTab === 'messages' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`}
          title="실시간 메시지 & 결재 승인"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>

        {/* Bottom: 로그아웃 */}
        <button
          onClick={onLogout}
          className="p-4 rounded-2xl text-blue-200 hover:bg-blue-600 transition-all mt-auto"
          title="로그아웃"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>

      {/* ======================================================== */}
      {/* 2. Main Area (To the right of the Left Rail) */}
      {/* ======================================================== */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* VIEW: Integrated Calendar Mode */}
        {activeNavTab === 'calendar' ? (
          <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-slate-50">
            <LogViewer
              buses={buses}
              students={students}
              currentTab="ALL"
              currentUser={localTeacherUser}
              availableClasses={teacherClass ? [teacherClass, ...availableClasses] : availableClasses}
              academyId={selectedAcademyId || academy?.id}
            />
          </div>
        ) : activeNavTab === 'shuttle' ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-bold shadow-xs">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-9 8h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v11a2 2 0 002 2zm1-2a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-black text-slate-800 tracking-tight">
                      {homeroomStatus?.assignedClass || teacherClass || '담임 반'} 오늘 셔틀 현황
                    </h1>
                    <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200">
                      30초 자동 갱신
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    우리 반 원아들의 오늘 셔틀 호차 및 실시간 탑승 현황을 확인합니다.
                  </p>
                </div>
              </div>

              {/* Stats and Refresh */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200 text-xs font-bold">
                  <span className="px-2.5 py-1 rounded-lg bg-white text-slate-700 shadow-xs">
                    전체 {homeroomStatus?.summary?.total || 0}명
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                    탑승 {homeroomStatus?.summary?.boarded || 0}명
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 border border-amber-200">
                    대기 {homeroomStatus?.summary?.waiting || 0}명
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200">
                    결석 {homeroomStatus?.summary?.absent || 0}명
                  </span>
                </div>

                <button
                  type="button"
                  onClick={fetchHomeroomStatus}
                  disabled={isHomeroomLoading}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
                  title="새로고침"
                >
                  <svg className={`w-4 h-4 ${isHomeroomLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>새로고침</span>
                </button>
              </div>
            </div>

            {/* Student Cards Grid */}
            <div className="flex-1 overflow-y-auto p-8">
              {homeroomStatus?.students && homeroomStatus.students.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {homeroomStatus.students.map(st => {
                    const isBoarded = st.status === 'BOARDED';
                    const isAbsent = st.status === 'ABSENT';

                    return (
                      <div
                        key={st.id}
                        className={`bg-white rounded-2xl p-5 border shadow-xs transition-all flex flex-col justify-between ${
                          isBoarded
                            ? 'border-emerald-300 bg-emerald-50/20'
                            : isAbsent
                            ? 'border-red-300 bg-red-50/20'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-base font-extrabold text-slate-800">{st.name}</span>
                            <span
                              className={`px-2.5 py-1 rounded-full text-xs font-extrabold ${
                                isBoarded
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                  : isAbsent
                                  ? 'bg-red-100 text-red-800 border border-red-200'
                                  : 'bg-amber-100 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {isBoarded ? '✓ 탑승 완료' : isAbsent ? '✕ 결석 (미탑승)' : '⏳ 탑승 대기'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1.5 rounded-xl border border-blue-100 mb-3">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-9 8h10a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v11a2 2 0 002 2zm1-2a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
                            </svg>
                            <span>배정: {st.vehicle}</span>
                          </div>

                          <div className="space-y-1.5 text-xs text-slate-600">
                            <div className="truncate text-slate-500" title={st.address}>
                              📍 {st.address || '주소 미입력'}
                            </div>
                            {st.parentPhone && (
                              <div className="flex items-center gap-1 text-slate-700 font-semibold">
                                <span>📞 {st.parentPhone}</span>
                              </div>
                            )}
                            {st.allergies && (
                              <div className="text-red-600 font-bold bg-red-50 px-2 py-0.5 rounded text-[11px] border border-red-100 inline-block">
                                ⚠️ 알레르기: {st.allergies}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Footer Status Time */}
                        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                          <span>상태 확인</span>
                          <span className="font-bold text-slate-600">
                            {isBoarded && st.boardedAt
                              ? `${new Date(st.boardedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 탑승`
                              : st.statusText}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-24 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                  <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 mx-auto flex items-center justify-center mb-3">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <h4 className="font-bold text-slate-700 text-sm mb-1">
                    {homeroomStatus?.assignedClass ? `${homeroomStatus.assignedClass}에 등록된 원아가 없습니다` : '담당 반 정보가 설정되지 않았습니다'}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    담임교사 계정 설정에서 담당 반이 지정되어 있는지 확인해 주세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : activeNavTab === 'attendance' ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Attendance Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-xs">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-black text-slate-800 tracking-tight">
                      {attendanceData?.assignedClass || teacherClass || '우리 반'} 일일 출석부
                    </h1>
                    {attendanceData?.isSubmitted ? (
                      <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200">
                        제출 완료
                      </span>
                    ) : (
                      <span className="text-xs bg-amber-50 text-amber-700 px-2.5 py-0.5 rounded-full font-bold border border-amber-200">
                        미제출 (체크 후 제출)
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    원아별 출석 상태를 확인하고 출석부를 제출합니다. 관리자 웹으로 실시간 전송됩니다.
                  </p>
                </div>
              </div>

              {/* Actions & Date */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500">날짜:</span>
                  <input
                    type="date"
                    value={attendanceDate}
                    onChange={(e) => {
                      setAttendanceDate(e.target.value);
                      fetchAttendance(e.target.value);
                    }}
                    className="bg-transparent text-xs font-bold text-slate-700 border-none outline-hidden cursor-pointer"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAllPresent}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5"
                >
                  전원 출석
                </button>

                <button
                  type="button"
                  onClick={handleSubmitAttendance}
                  disabled={isSubmittingAttendance}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-500/20 transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmittingAttendance ? '제출 중...' : attendanceData?.isSubmitted ? '출석부 수정 제출' : '출석부 제출'}
                </button>
              </div>
            </div>

            {/* Attendance Summary Bar */}
            <div className="bg-white border-b border-slate-200 px-8 py-3 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-600">출석 요약:</span>
                <span className="px-2 py-0.5 bg-slate-100 rounded-md font-bold text-slate-700">전체 {attendanceData?.summary?.total || 0}명</span>
                <span className="px-2 py-0.5 bg-emerald-100 rounded-md font-bold text-emerald-800">출석 {attendanceData?.summary?.present || 0}명</span>
                <span className="px-2 py-0.5 bg-red-100 rounded-md font-bold text-red-800">결석 {attendanceData?.summary?.absent || 0}명</span>
                <span className="px-2 py-0.5 bg-amber-100 rounded-md font-bold text-amber-800">지각 {attendanceData?.summary?.late || 0}명</span>
                <span className="px-2 py-0.5 bg-purple-100 rounded-md font-bold text-purple-800">조퇴 {attendanceData?.summary?.earlyLeave || 0}명</span>
              </div>
              {attendanceData?.submission?.submittedAt && (
                <span className="text-xs text-slate-400">
                  최종 제출: {new Date(attendanceData.submission.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({attendanceData.submission.teacherName})
                </span>
              )}
            </div>

            {/* Students List */}
            <div className="flex-1 overflow-y-auto p-8">
              {isAttendanceLoading ? (
                <div className="flex items-center justify-center py-20">
                  <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : attendanceData?.students && attendanceData.students.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[...attendanceData.students].sort((a, b) => {
                    const aChanged = a.boardStatus === 'ABSENT' || a.status === 'ABSENT' || a.status === 'LATE' || a.status === 'EARLY_LEAVE' || a.boardStatus === 'SELF_PICKUP' ? 1 : 0;
                    const bChanged = b.boardStatus === 'ABSENT' || b.status === 'ABSENT' || b.status === 'LATE' || b.status === 'EARLY_LEAVE' || b.boardStatus === 'SELF_PICKUP' ? 1 : 0;
                    return bChanged - aChanged;
                  }).map((st) => {
                    return (
                      <div
                        key={st.studentId}
                        className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col justify-between gap-3"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-black text-slate-800 text-base">{st.name}</h3>
                              {st.boardStatus === 'BOARDED' && (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold rounded-md">
                                  셔틀탑승 완료
                                </span>
                              )}
                              {st.boardStatus === 'ABSENT' && (
                                <span className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold rounded-md">
                                  결석 신청
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 mt-1">배정차량: {st.vehicleName || '미지정'}</p>
                          </div>
                        </div>

                        {/* 4 Status Buttons: 출석 / 결석 / 지각 / 조퇴 */}
                        <div className="grid grid-cols-4 gap-1.5 pt-2 border-t border-slate-100">
                          <button
                            type="button"
                            onClick={() => handleAttendanceStatusChange(st.studentId, 'PRESENT')}
                            className={`py-2 text-xs font-bold rounded-xl transition ${
                              st.status === 'PRESENT'
                                ? 'bg-emerald-600 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                          >
                            출석
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAttendanceStatusChange(st.studentId, 'ABSENT')}
                            className={`py-2 text-xs font-bold rounded-xl transition ${
                              st.status === 'ABSENT'
                                ? 'bg-red-600 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                          >
                            결석
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAttendanceStatusChange(st.studentId, 'LATE')}
                            className={`py-2 text-xs font-bold rounded-xl transition ${
                              st.status === 'LATE'
                                ? 'bg-amber-500 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                          >
                            지각
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAttendanceStatusChange(st.studentId, 'EARLY_LEAVE')}
                            className={`py-2 text-xs font-bold rounded-xl transition ${
                              st.status === 'EARLY_LEAVE'
                                ? 'bg-purple-600 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                            }`}
                          >
                            조퇴
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-24 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                  <h4 className="font-bold text-slate-700 text-sm mb-1">
                    등록된 원아가 없습니다
                  </h4>
                  <p className="text-xs text-slate-400">
                    관리자에게 담당 반 배정을 요청하거나 원아 등록 여부를 확인해 주세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : activeNavTab === 'board' ? (
          <div className="flex-1 relative z-0 overflow-hidden h-full w-full">
            <BoardViewer
              isClosing={false}
              currentUser={localTeacherUser}
              selectedAcademyId={selectedAcademyId}
              availableClasses={availableClasses}
              selectedClass={teacherClass || 'ALL'}
              setSelectedClass={setBoardSelectedClass}
              searchKeyword={boardSearchKeyword}
              setSearchKeyword={setBoardSearchKeyword}
              isCreatingPost={isCreatingBoardPost}
              setIsCreatingPost={setIsCreatingBoardPost}
              posts={boardPosts}
              setPosts={setBoardPosts}
              initialPostType={boardInitialPostType}
            />
          </div>
        ) : activeNavTab === 'messages' ? (
          /* VIEW B: Messages & Payment Request Management */
          <div className="flex-1 flex overflow-hidden h-full w-full">
            <MessagePanel
              currentUser={localTeacherUser}
              selectedAcademyId={selectedAcademyId}
              socket={socket}
              isClosing={false}
            />
          </div>
        ) : activeNavTab === 'cloud' ? (
          /* VIEW C: Temporary Photo Cloud Mode */
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Cloud Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-black text-slate-800 tracking-tight">임시 사진 보관함</h1>
                  <span className="text-xs bg-blue-50 text-blue-700 px-3 py-1 rounded-full font-bold border border-blue-200">
                    총 {cloudPhotos.length}장 보관 중
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  모바일 앱이나 PC에서 촬영한 사진을 임시 보관하고, 원아 앨범 게시판 작성 및 알림장 작성 시 바로 다운로드하거나 활용할 수 있습니다.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  ref={cloudFileInputRef}
                  onChange={handleCloudFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => cloudFileInputRef.current?.click()}
                  disabled={isUploadingToCloud}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-2 disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>{isUploadingToCloud ? '업로드 중...' : '사진 여러장 올리기'}</span>
                </button>
                {cloudPhotos.length > 0 && (
                  <button
                    onClick={handleClearAllCloudPhotos}
                    className="px-3 py-2 bg-white border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200 rounded-xl text-xs font-semibold shadow-xs transition"
                  >
                    전체 비우기
                  </button>
                )}
              </div>
            </div>

            {/* Cloud Content Body */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {/* Drag & Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOverCloud(true); }}
                onDragLeave={() => setIsDraggingOverCloud(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOverCloud(false);
                  processCloudFiles(e.dataTransfer.files);
                }}
                onClick={() => cloudFileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${isDraggingOverCloud
                    ? 'border-blue-500 bg-blue-50/80 scale-[1.01]'
                    : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/20 shadow-xs'
                  }`}
              >
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 mx-auto flex items-center justify-center mb-2 shadow-xs">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-slate-700">
                  {isDraggingOverCloud ? '사진을 여기에 놓으세요' : '사진을 마우스로 끌어다 놓거나 여기를 클릭하여 선택하세요'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  JPG, PNG, WEBP 등 다중 사진 선택 지원 (최대 20MB)
                </p>
              </div>

              {/* Photos Gallery */}
              {cloudPhotos.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-700">임시 보관 사진 ({cloudPhotos.length})</h3>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {cloudPhotos.map(photo => (
                      <div
                        key={photo.id}
                        className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs hover:shadow-md hover:border-slate-300 transition-all group flex flex-col"
                      >
                        {/* Thumbnail */}
                        <div className="aspect-square relative bg-slate-100 overflow-hidden">
                          <img
                            src={photo.url}
                            alt={photo.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            loading="lazy"
                          />
                          {/* Hover Action Overlay */}
                          <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-between p-2.5">
                            <div className="flex justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleDeleteCloudPhoto(photo.id); }}
                                className="w-7 h-7 bg-white/90 hover:bg-red-500 hover:text-white text-slate-700 rounded-lg flex items-center justify-center transition shadow-xs"
                                title="사진 삭제"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleDownloadCloudPhoto(photo); }}
                              className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm transition flex items-center justify-center gap-1"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              <span>다운로드</span>
                            </button>
                          </div>
                        </div>

                        {/* File Details */}
                        <div className="p-2.5 bg-white flex flex-col gap-0.5 min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate" title={photo.name}>
                            {photo.name}
                          </p>
                          <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                            <span>{photo.size}</span>
                            <span>{photo.uploadedAt}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="py-16 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                  <div className="w-16 h-16 rounded-full bg-slate-50 text-slate-400 mx-auto flex items-center justify-center mb-3">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h4 className="font-bold text-slate-700 text-sm mb-1">임시 보관된 사진이 없습니다</h4>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    위 영역을 클릭하거나 사진 파일을 끌어다 놓아 사진 보관함에 사진을 저장해보세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* VIEW B: Classroom Home Mode */
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Condition: Unassigned Teacher Screen (아무 화면 없게 나오고 관리자가 배정하는 시스템) */}
            {!isAssigned ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50">
                <div className="max-w-md w-full bg-white rounded-3xl p-8 border border-slate-200 shadow-xl space-y-5 animate-fade-in">
                  <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto border border-blue-200 shadow-sm">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight mb-2">
                      담당 반이 배정되지 않았습니다
                    </h2>
                    <div className="inline-block px-3 py-1.5 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-bold mb-3">
                      관리자에게 반 배정을 요청하세요
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      <strong>{formatTeacherName(localTeacherUser?.name)}</strong>, 환영합니다.<br />
                      현재 <strong>{academy?.name || '소속 유치원'}</strong>에 정상 등록되었으며,
                      <strong>관리자님께서 담당 반을 배정</strong>하시면 교실 수업 일정 및 우리 반 원아 명단이 자동으로 활성화됩니다.
                    </p>
                  </div>

                  <div className="pt-2 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleCheckProfile}
                      disabled={isCheckingProfile}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-blue-500/20 flex items-center justify-center gap-1.5"
                    >
                      <svg className={`w-4 h-4 ${isCheckingProfile ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      <span>{isCheckingProfile ? '배정 상태 확인 중...' : '배정 상태 새로고침'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveNavTab('board')}
                      className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5"
                    >
                      <span>유치원 게시판 바로가기</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Assigned Teacher: Full Classroom Dashboard */
              <div className="flex-1 p-6 lg:p-8 space-y-6">
                {/* Header Banner */}
                <section className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg shadow-blue-500/10">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-black tracking-tight mb-1">
                        {academy?.name || '우리 유치원'} · {teacherClass} 교실
                      </h2>
                      <p className="text-blue-100 text-xs sm:text-sm">
                        {todayStr} · <strong>{formatTeacherName(localTeacherUser?.name)}</strong>, 오늘 하루도 안전하고 행복한 보육 되세요!
                      </p>
                    </div>

                    {/* Summary Counts */}
                    <div className="grid grid-cols-4 gap-2 sm:gap-3">
                      <div className="bg-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/15">
                        <p className="text-[11px] text-blue-200 font-medium">우리 반 전체</p>
                        <p className="text-lg sm:text-2xl font-black">{summary.total}명</p>
                      </div>
                      <div className="bg-white/15 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/20">
                        <p className="text-[11px] text-blue-100 font-medium">셔틀 탑승</p>
                        <p className="text-lg sm:text-2xl font-black text-amber-300">{summary.shuttle}명</p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/15">
                        <p className="text-[11px] text-blue-200 font-medium">직접 픽업</p>
                        <p className="text-lg sm:text-2xl font-black text-emerald-300">{summary.pickup}명</p>
                      </div>
                      <div className="bg-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/15">
                        <p className="text-[11px] text-blue-200 font-medium">결석 / 사유</p>
                        <p className="text-lg sm:text-2xl font-black text-rose-300">{summary.absent}명</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 2-Column Upper Grid: [Schedule] + [Shuttle] */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left Column: 수업 일정 & 하루 일과 타임라인 */}
                  <section className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                      <div className="flex items-center gap-2">
                        <h3 className="font-extrabold text-slate-900 text-base">오늘의 수업 및 일과 일정</h3>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingScheduleList([...scheduleItems]);
                            setIsScheduleModalOpen(true);
                          }}
                          className="px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200"
                        >
                          일정 수정
                        </button>
                      </div>
                      <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-1 rounded-lg">
                        현재 시각: {currentHourMinute}
                      </span>
                    </div>

                    <div className="space-y-3 overflow-y-auto max-h-[360px] pr-1">
                      {scheduleItems.map((item, idx) => {
                        const [start, end] = item.time.split(' ~ ');
                        const isCurrent = currentHourMinute >= start && currentHourMinute <= end;

                        return (
                          <div
                            key={idx}
                            className={`flex items-start gap-3 p-3 rounded-xl transition-all border ${isCurrent
                                ? 'bg-blue-50/80 border-blue-300 shadow-sm'
                                : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-50'
                              }`}
                          >
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${isCurrent ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'
                              }`}>
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className={`text-sm font-bold ${isCurrent ? 'text-blue-900' : 'text-slate-800'}`}>
                                  {item.title}
                                </h4>
                                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-semibold shrink-0 ${isCurrent ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
                                  }`}>
                                  {item.time}
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{item.desc}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Right Column: 오늘 셔틀 현황 & 차량 위치 간이 확인 */}
                  <section className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col">
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                      <h3 className="font-extrabold text-slate-900 text-base">오늘 우리 반 셔틀 현황</h3>
                      <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded-lg">
                        실시간 연동
                      </span>
                    </div>

                    {buses.length === 0 ? (
                      <div className="text-center py-10 text-slate-400">
                        <p className="text-xs">배정된 셔틀 차량이 없습니다.</p>
                      </div>
                    ) : (
                      <div className="space-y-3 flex-1 overflow-y-auto max-h-[360px] pr-1">
                        {buses.map(bus => {
                          const ridingCount = myStudents.filter(
                            st => st.assignedBusId === bus.id && st.boardStatus !== 'SELF_PICKUP' && st.boardStatus !== 'ABSENT'
                          ).length;

                          return (
                            <div
                              key={bus.id}
                              className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl hover:border-slate-300 transition-all"
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-3.5 h-3.5 rounded-full shadow-sm shrink-0"
                                    style={{ backgroundColor: bus.colorHex || '#f59e0b' }}
                                  />
                                  <span className="font-extrabold text-sm text-slate-900">{bus.name}</span>
                                  <span className="text-xs text-slate-500 font-mono">({bus.licensePlate || '차량번호 미등록'})</span>
                                </div>
                                <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                  우리 반 {ridingCount}명 탑승
                                </span>
                              </div>

                              <div className="text-xs text-slate-600 space-y-1 mb-3">
                                <div className="flex justify-between">
                                  <span className="text-slate-400">기사님:</span>
                                  <span className="font-medium text-slate-700">{bus.driverName || '미배정'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span className="text-slate-400">정원:</span>
                                  <span className="font-medium text-slate-700">{bus.capacity || 15}인승</span>
                                </div>
                              </div>

                              <button
                                onClick={() => setSelectedBusForMap(bus)}
                                className="w-full py-2 bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                <span>실시간 버스 위치 확인 (지도)</span>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                </div>

                {/* Lower Section: 원아 명단 & 출결 / 알림장 관리 */}
                <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                    <div>
                      <h3 className="text-lg font-black text-slate-900 tracking-tight">
                        {teacherClass} 학원생 정보
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        학원생별 기본 정보(전화번호, 생일, 등하원 차량, 알레르기)를 확인하고, 하원 방법(결석 / 셔틀 탑승 / 픽업)을 원클릭으로 변경하세요.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setBoardSelectedClass(teacherClass || 'ALL');
                          setBoardInitialPostType('NOTICE');
                          setIsCreatingBoardPost(true);
                          setActiveNavTab('board');
                        }}
                        className="px-3.5 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold rounded-xl transition-all shadow-sm shadow-orange-500/20 flex items-center justify-center gap-1.5 shrink-0"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                        </svg>
                        <span>우리 반 전체 알림장 작성</span>
                      </button>

                      <div className="relative">
                        <input
                          type="text"
                          placeholder="원아명 또는 연락처 검색"
                          value={searchQuery}
                          onChange={e => setSearchQuery(e.target.value)}
                          className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-52"
                        />
                        <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>

                      <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold">
                        <button
                          onClick={() => setFilterMode('ALL')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${filterMode === 'ALL' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                          전체 ({myStudents.length})
                        </button>
                        <button
                          onClick={() => setFilterMode('SHUTTLE')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${filterMode === 'SHUTTLE' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                          셔틀 ({summary.shuttle})
                        </button>
                        <button
                          onClick={() => setFilterMode('PICKUP')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${filterMode === 'PICKUP' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                          픽업 ({summary.pickup})
                        </button>
                        <button
                          onClick={() => setFilterMode('ABSENT')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${filterMode === 'ABSENT' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                          결석 ({summary.absent})
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Class-wide Notice Banner (connected to official BoardPost NOTICE) */}
                  {latestClassNotice && (
                    <div className="bg-orange-50/70 border border-orange-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-extrabold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-md border border-orange-200">
                              우리 반 최신 알림장
                            </span>
                            <span className="text-xs text-slate-400 font-medium">
                              {latestClassNotice.createdAt ? new Date(latestClassNotice.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-900 mt-1">{latestClassNotice.title}</h4>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed line-clamp-2">{latestClassNotice.content}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setBoardSelectedClass(teacherClass || 'ALL');
                          setBoardInitialPostType('NOTICE');
                          setActiveNavTab('board');
                        }}
                        className="self-end sm:self-center px-3 py-1.5 bg-white hover:bg-orange-50 border border-orange-200 text-orange-700 text-xs font-bold rounded-xl transition-colors shrink-0 shadow-2xs"
                      >
                        알림장 게시판에서 보기
                      </button>
                    </div>
                  )}

                  {/* Re-request Notice Banner for Teacher */}
                  {Object.entries(rideRequests).some(([_, r]) => r && r.status === 'RE_REQUESTED') && (
                    <div className="bg-purple-50 border-2 border-purple-300 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-extrabold text-purple-800 bg-purple-100 px-2 py-0.5 rounded-md border border-purple-200">
                              지도교사 새 위치 제안 도착
                            </span>
                            <span className="text-xs text-purple-700 font-bold">
                              {Object.entries(rideRequests).filter(([_, r]) => r && r.status === 'RE_REQUESTED').length}건 확인 필요
                            </span>
                          </div>
                          <p className="text-xs text-purple-900 mt-1 font-semibold leading-relaxed">
                            지도교사님이 안전한 승하차를 위해 새로운 위치를 제안했습니다. 아래 보라색 원아 카드에서 새 위치를 확인하시고 [새 위치로 수락] 또는 [픽업 유지]를 선택해주세요.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveNavTab('messages')}
                        className="self-end sm:self-center px-3.5 py-2 bg-purple-600 hover:bg-purple-700 active:scale-95 text-white text-xs font-black rounded-xl transition shadow-xs shrink-0 flex items-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                        <span>메시지함 지도 비교</span>
                      </button>
                    </div>
                  )}

                  
                  {/* View Mode Switcher and Approval History Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-4 bg-white p-3 rounded-2xl border border-slate-200 shadow-2xs">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-700">학원생 정보 보기 모드:</span>
                      <div className="bg-slate-100 p-1 rounded-xl flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setViewMode('cell')}
                          className={`px-3 py-1 text-xs font-black rounded-lg transition-all ${
                            viewMode === 'cell'
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          셀(테이블) 형식
                        </button>
                        <button
                          type="button"
                          onClick={() => setViewMode('card')}
                          className={`px-3 py-1 text-xs font-black rounded-lg transition-all ${
                            viewMode === 'card'
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          카드 형식
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowApprovalHistory(true)}
                        className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-black rounded-xl border border-indigo-200 transition-all flex items-center gap-1.5 shadow-2xs"
                      >
                        <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>결재 내역 히스토리</span>
                      </button>
                    </div>
                  </div>

                  {displayedStudents.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <p className="text-sm font-semibold">해당하는 원아가 없습니다.</p>
                    </div>
                  ) : viewMode === 'cell' ? (
                    /* Cell / Table View */
                    <div className="space-y-6">
                      {/* Pinned Changes & Pending Approvals Section */}
                      {changedStudents.length > 0 && (
                        <div className="bg-amber-50/50 border-2 border-amber-300 rounded-2xl overflow-hidden shadow-xs">
                          <div className="bg-amber-100/80 px-4 py-2.5 border-b border-amber-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping"></span>
                              <h4 className="font-black text-amber-950 text-sm">
                                오늘 변동사항 및 결재 진행 학생 ({changedStudents.length}명)
                              </h4>
                            </div>
                            <span className="text-[11px] font-bold text-amber-800">우선 관리 대상</span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                              <thead>
                                <tr className="bg-amber-100/40 text-[11px] font-extrabold text-amber-900 border-b border-amber-200 uppercase">
                                  <th className="py-2.5 px-3 text-center w-12">No</th>
                                  <th className="py-2.5 px-3">학생명</th>
                                  <th className="py-2.5 px-3">학부모 전화번호</th>
                                  <th className="py-2.5 px-3">생일</th>
                                  <th className="py-2.5 px-3">등원차량</th>
                                  <th className="py-2.5 px-3">하원차량</th>
                                  <th className="py-2.5 px-3">알레르기</th>
                                  <th className="py-2.5 px-3 text-center">하원 상태 (결석 / 셔틀 탑승 / 픽업)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {changedStudents.map((st, i) => renderStudentRow(st, i, true))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Regular Students Grouped by Age and Sorted by Gender (남, 여 살짝 띄워서) */}
                      {Object.keys(groupedRegularStudents).map(ageKey => {
                        const { boys, girls } = groupedRegularStudents[ageKey];
                        if (boys.length === 0 && girls.length === 0) return null;

                        return (
                          <div key={ageKey} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                            <div className="bg-slate-100/80 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                              <h4 className="font-black text-slate-800 text-sm">
                                {ageKey} 학원생 명단 (총 {boys.length + girls.length}명: 남 {boys.length}명, 여 {girls.length}명)
                              </h4>
                              <span className="text-xs font-semibold text-slate-500">{teacherClass}</span>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse">
                                <thead>
                                  <tr className="bg-slate-50 text-[11px] font-extrabold text-slate-600 border-b border-slate-200 uppercase">
                                    <th className="py-2.5 px-3 text-center w-12">No</th>
                                    <th className="py-2.5 px-3">학생명</th>
                                  <th className="py-2.5 px-3">학부모 전화번호</th>
                                  <th className="py-2.5 px-3">생일</th>
                                  <th className="py-2.5 px-3">등원차량</th>
                                  <th className="py-2.5 px-3">하원차량</th>
                                  <th className="py-2.5 px-3">알레르기</th>
                                  <th className="py-2.5 px-3 text-center">하원 상태 (결석 / 셔틀 탑승 / 픽업)</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {/* Boys Section */}
                                  {boys.map((st, i) => renderStudentRow(st, i))}

                                  {/* Slight spacing / Divider between Boys and Girls per requirement */}
                                  {boys.length > 0 && girls.length > 0 && (
                                    <tr className="bg-slate-100/50">
                                      <td colSpan={8} className="py-1 px-4 text-[10px] font-bold text-slate-400 text-center border-y border-dashed border-slate-200">
                                        남아 / 여아 구분
                                      </td>
                                    </tr>
                                  )}

                                  {/* Girls Section */}
                                  {girls.map((st, i) => renderStudentRow(st, boys.length + i))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Existing Card View */
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

                      {sortedDisplayedStudents.map(student => {
                        const isNonShuttle = checkIsNonShuttle(student);
                        const effectiveStatus = getStudentEffectiveBoardStatus(student);
                        const rideReq = rideRequests[student.id];
                        const isRidePending = rideReq && rideReq.status === 'PENDING';
                        const isRideApproved = rideReq && rideReq.status === 'APPROVED';
                        const isRideReRequested = rideReq && rideReq.status === 'RE_REQUESTED';

                        const isAbsent = effectiveStatus === 'ABSENT' || effectiveStatus === '결석';
                        const isPickup = (effectiveStatus === 'SELF_PICKUP' || effectiveStatus === '부모님직접픽업') && !isRideApproved;
                        const isShuttle = (!isPickup && !isAbsent) || isRideApproved;

                        // Target Bus info
                        const targetBusId = rideReq?.vehicleId || student.assignedBusId || student.assignedDepartureBusId;
                        const bus = buses.find(b => b.id === Number(targetBusId));
                        const busNameDisplay = rideReq?.busNumber || bus?.name || (targetBusId ? `${targetBusId}호차` : '배정 대기');
                        const departureTimeDisplay = bus?.departureTime || (busNameDisplay?.includes('2') ? '16:30 하원 출발' : '15:30 하원 출발');

                        const parentPhone = student.raw?.['학부모전화번호'] || student.raw?.['연락처'] || '';
                        const age = student.raw?.['연령'] || '';
                        const gender = student.raw?.['성별'] || '';

                        return (
                          <div
                            key={student.id}
                            className={`rounded-2xl p-4 border transition-all flex flex-col justify-between ${isRideApproved
                                ? 'bg-emerald-50/80 border-2 border-emerald-500 ring-2 ring-emerald-100 shadow-md'
                                : isRideReRequested
                                  ? 'bg-purple-50/90 border-2 border-purple-400 ring-2 ring-purple-100 shadow-md animate-pulse-subtle'
                                  : isRidePending
                                    ? 'bg-amber-50/90 border-2 border-amber-400 ring-2 ring-amber-100 shadow-md'
                                    : isAbsent
                                      ? 'bg-slate-100/70 border-slate-300 opacity-75'
                                      : isPickup
                                        ? 'bg-amber-50/30 border border-amber-200'
                                        : 'bg-white border-slate-200 shadow-xs hover:border-blue-300'
                              }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-xs ${isRideApproved
                                      ? 'bg-emerald-600 text-white ring-2 ring-emerald-200'
                                      : isRidePending
                                        ? 'bg-amber-500 text-white ring-2 ring-amber-200 animate-pulse'
                                        : isAbsent
                                          ? 'bg-slate-300 text-slate-600'
                                          : isPickup
                                            ? 'bg-amber-100 text-amber-800'
                                            : 'bg-blue-100 text-blue-800'
                                    }`}>
                                    {student.name.substring(0, 1)}
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <h4 className="font-extrabold text-slate-900 text-base">{student.name}</h4>
                                      {gender && (
                                        <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${gender === '남' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                          }`}>
                                          {gender}
                                        </span>
                                      )}
                                      {age && (
                                        <span className="text-[11px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                                          {age}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-500 truncate max-w-[200px]" title={student.address}>
                                      {student.address || '주소 미등록'}
                                    </p>
                                  </div>
                                </div>

                                {/* Status Badges */}
                                {isRideApproved ? (
                                  <span className="text-[11px] font-black px-2.5 py-1 rounded-full shrink-0 border bg-emerald-100 text-emerald-800 border-emerald-300 flex items-center gap-1">
                                    <svg className="w-3.5 h-3.5 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                    탑승 승인 완료
                                  </span>
                                ) : isRideReRequested ? (
                                  <span className="text-[11px] font-black px-2.5 py-1 rounded-full shrink-0 border bg-purple-100 text-purple-800 border-purple-300 flex items-center gap-1 animate-pulse">
                                    <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                                    새 위치 제안됨 (재결재 요청)
                                  </span>
                                ) : isRidePending ? (
                                  <span className="text-[11px] font-black px-2.5 py-1 rounded-full shrink-0 border bg-amber-100 text-amber-800 border-amber-300 flex items-center gap-1 animate-pulse">
                                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                                    승인 대기 중
                                  </span>
                                ) : (
                                  <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full shrink-0 border ${isAbsent
                                      ? 'bg-rose-100 text-rose-700 border-rose-200'
                                      : isPickup
                                        ? 'bg-amber-100 text-amber-800 border-amber-200'
                                        : 'bg-blue-100 text-blue-800 border-blue-200'
                                    }`}>
                                    {isAbsent ? '결석' : isPickup ? '직접 픽업' : '셔틀 하원'}
                                  </span>
                                )}
                              </div>

                              {/* Card Middle Info Box: APPROVED vs RE_REQUESTED vs PENDING vs Normal */}
                              {isRideApproved ? (
                                <div className="bg-emerald-100/70 rounded-xl p-2.5 my-2.5 text-xs space-y-1.5 border border-emerald-300 shadow-2xs">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-emerald-900">탑승 버스:</span>
                                    <span className="font-black text-emerald-950 bg-white px-2 py-0.5 rounded border border-emerald-200">
                                      {busNameDisplay} {bus?.licensePlate ? `(${bus.licensePlate})` : ''}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-emerald-900">출발 시간:</span>
                                    <span className="font-extrabold text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200">
                                      {departureTimeDisplay}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-emerald-800">지도교사:</span>
                                    <span className="font-bold text-emerald-950">
                                      {rideReq?.teacherName || bus?.teacherName || '배정 지도교사'}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-emerald-800">하차 위치:</span>
                                    <span className="font-semibold text-emerald-950 truncate max-w-[170px]" title={rideReq?.boardingLocation || student.address}>
                                      {rideReq?.boardingLocation || student.address || '원아 거주지'}
                                    </span>
                                  </div>
                                </div>
                              ) : isRideReRequested ? (
                                <div className="bg-purple-50 rounded-xl p-3 my-2.5 text-xs space-y-2 border-2 border-purple-300 shadow-2xs">
                                  <div className="flex items-center gap-1.5 font-black text-purple-900">
                                    <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span>지도교사 새 위치 제안</span>
                                  </div>
                                  <div className="bg-white p-2 rounded-lg border border-purple-200">
                                    <span className="text-[10px] text-purple-600 font-bold block">새 하차 희망 위치:</span>
                                    <span className="font-black text-purple-950 block">
                                      {rideReq.counterProposal?.suggestedLocation?.boardingLocation || rideReq.boardingLocation}
                                    </span>
                                    {rideReq.counterProposal?.note && (
                                      <p className="text-[11px] text-slate-600 mt-1 italic">
                                        사유: "{rideReq.counterProposal.note}"
                                      </p>
                                    )}
                                  </div>
                                  <div className="flex gap-1.5 pt-1">
                                    <button
                                      type="button"
                                      disabled={isDecidingRequest === rideReq.messageId}
                                      onClick={() => handleDecidePaymentRequest(rideReq.messageId, 'APPROVED')}
                                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-black text-[11px] shadow-2xs transition disabled:opacity-50"
                                    >
                                      새 위치로 수락
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isDecidingRequest === rideReq.messageId}
                                      onClick={() => handleDecidePaymentRequest(rideReq.messageId, 'REJECTED')}
                                      className="py-1.5 px-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 rounded-lg font-bold text-[11px] transition disabled:opacity-50"
                                    >
                                      픽업 유지
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setActiveNavTab('messages')}
                                      className="py-1.5 px-2 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg font-bold text-[11px] transition"
                                      title="메시지함에서 지도 확인"
                                    >
                                      지도비교
                                    </button>
                                  </div>
                                </div>
                              ) : isRidePending ? (
                                <div className="bg-amber-100/80 rounded-xl p-2.5 my-2.5 text-xs space-y-1.5 border border-amber-300 shadow-2xs">
                                  <div className="flex items-center justify-between">
                                    <span className="font-bold text-amber-900">신청 차량:</span>
                                    <span className="font-black text-amber-950">
                                      {busNameDisplay}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-amber-800">담당 지도교사:</span>
                                    <span className="font-bold text-amber-950">
                                      {rideReq?.teacherName || '지도교사 승인 대기'}
                                    </span>
                                  </div>
                                  <div className="pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setActiveNavTab('messages')}
                                      className="w-full py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold text-[11px] shadow-2xs transition flex items-center justify-center gap-1"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                      </svg>
                                      <span>메시지함에서 결제 확인하기</span>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="bg-slate-50 rounded-xl p-2.5 my-2.5 text-xs space-y-1.5 border border-slate-100">
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-400">하원 구분:</span>
                                    <span className="font-bold text-slate-700">
                                      {isNonShuttle ? '직접 픽업 (미탑승 원아)' : (bus ? `${bus.name} (${bus.licensePlate || '1차'})` : '배정 대기')}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span className="text-slate-400">보호자 연락처:</span>
                                    {parentPhone ? (
                                      <a
                                        href={`tel:${parentPhone}`}
                                        className="font-bold text-blue-600 hover:underline flex items-center gap-1"
                                      >
                                        <span>{parentPhone}</span>
                                      </a>
                                    ) : (
                                      <span className="text-slate-400">미등록</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {student.teacherMemo ? (
                                <div
                                  onClick={() => handleOpenMemoModal(student)}
                                  className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 mb-3 cursor-pointer hover:bg-amber-100/70 transition-colors"
                                  title="클릭하여 개별 알림장 수정"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-bold text-amber-800">
                                      개별 알림장 (1:1)
                                    </span>
                                    <span className="text-[10px] text-amber-600 font-semibold">수정</span>
                                  </div>
                                  <p className="text-xs text-amber-950 font-medium line-clamp-2 leading-relaxed">
                                    {student.teacherMemo}
                                  </p>
                                </div>
                              ) : null}
                            </div>

                            <div className="space-y-2 pt-2 border-t border-slate-100">
                              <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isNonShuttle) {
                                      if (isRidePending) {
                                        alert(`[${student.name}] 원아는 이미 ${rideReq?.busNumber || '셔틀 차량'} 지도교사님께 탑승 및 결재 승인 요청 중입니다.`);
                                        return;
                                      }
                                      if (isRideApproved) {
                                        handleUpdateBoardStatus(student.id, 'WAITING');
                                        return;
                                      }
                                      if (isRideReRequested) {
                                        // Open messages or prompt
                                        setActiveNavTab('messages');
                                        return;
                                      }
                                      handlePromptShuttleRideRequest(student);
                                      return;
                                    }
                                    handleUpdateBoardStatus(student.id, 'WAITING');
                                  }}
                                  className={`py-1.5 rounded-lg transition-all flex items-center justify-center font-bold ${isRideApproved
                                      ? 'bg-emerald-600 text-white shadow-xs font-black'
                                      : isRidePending
                                        ? 'bg-amber-500 text-white shadow-xs font-black'
                                        : isShuttle && !isNonShuttle
                                          ? 'bg-white text-blue-700 shadow-xs'
                                          : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                  셔틀 {isNonShuttle && !isRideApproved && !isRidePending ? '(신청)' : ''}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleUpdateBoardStatus(student.id, 'SELF_PICKUP')}
                                  className={`py-1.5 rounded-lg transition-all flex items-center justify-center font-bold ${isPickup ? 'bg-white text-emerald-700 shadow-xs font-black' : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                  픽업 {isNonShuttle ? '(기본)' : ''}
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleUpdateBoardStatus(student.id, 'ABSENT')}
                                  className={`py-1.5 rounded-lg transition-all flex items-center justify-center font-bold ${isAbsent ? 'bg-white text-rose-700 shadow-xs font-black' : 'text-slate-500 hover:text-slate-800'
                                    }`}
                                >
                                  결석
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleOpenMemoModal(student)}
                                className="w-full py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center transition-colors"
                              >
                                {student.teacherMemo ? '개별 알림장 수정' : '+ 개별 알림장 작성'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        )}
      </div>

      {/* --- MODAL 1: Individual Student Memo Modal (1:1 개별 알림장) --- */}
      {selectedStudentForMemo && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[11px] font-extrabold rounded-md">
                    1:1 개별 전달
                  </span>
                  <h3 className="font-black text-slate-900 text-base">
                    {selectedStudentForMemo.name} 원아 개별 알림장
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  이 알림장은 <strong>{selectedStudentForMemo.name} 원아의 학부모님께만 1:1로 전달</strong>됩니다.
                </p>
              </div>
              <button
                onClick={() => setSelectedStudentForMemo(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-600 mb-1.5">자주 쓰는 문구 추가</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '처방약 12:30 복용 완료',
                  '점심 식사 맛있게 완식함',
                  '낮잠 편안하게 푹 잠',
                  '가벼운 긁힘(연고 도포)',
                  '오늘 친구들과 양보하며 활동 잘함'
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setMemoInput(prev => (prev ? `${prev}\n${preset}` : preset));
                    }}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg font-medium transition-colors"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">개별 알림장 내용</label>
              <textarea
                rows={4}
                value={memoInput}
                onChange={e => setMemoInput(e.target.value)}
                placeholder="예: 오늘 기분 좋게 등원하여 점심도 잘 먹었습니다. 오후 놀이시간에도 친구들과 사이좋게 활동했습니다."
                className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedStudentForMemo(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveMemo}
                disabled={isSavingMemo}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-500/20 disabled:opacity-50"
              >
                {isSavingMemo ? '저장 중...' : '개별 알림장 저장 완료'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 2: Shuttle Map Modal --- */}
      {selectedBusForMap && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-up flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-900 text-base">
                  {selectedBusForMap.name} 실시간 운행 위치
                </h3>
                <p className="text-xs text-slate-500">
                  기사님: {selectedBusForMap.driverName || '미지정'} · 차량번호: {selectedBusForMap.licensePlate || '미등록'}
                </p>
              </div>
              <button
                onClick={() => setSelectedBusForMap(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="w-full h-80 rounded-xl overflow-hidden border border-slate-200 relative">
              {(() => {
                const academyLat = Number(academy?.lat || academy?.latitude) || 37.5665;
                const academyLng = Number(academy?.lng || academy?.longitude) || 126.9780;
                const busLat = Number(selectedBusForMap.currentLat || academyLat);
                const busLng = Number(selectedBusForMap.currentLng || academyLng);

                return (
                  <MapContainer
                    center={[busLat, busLng]}
                    zoom={14}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <Marker position={[academyLat, academyLng]} icon={schoolIcon}>
                      <Popup>
                        <div className="font-bold text-xs">{academy?.name || '우리 유치원'}</div>
                      </Popup>
                    </Marker>

                    <Marker position={[busLat, busLng]} icon={busIcon}>
                      <Popup>
                        <div className="text-xs">
                          <p className="font-bold">{selectedBusForMap.name}</p>
                          <p className="text-slate-500">{selectedBusForMap.licensePlate}</p>
                        </div>
                      </Popup>
                    </Marker>
                  </MapContainer>
                );
              })()}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedBusForMap(null)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 4: Schedule Edit Modal (일과 및 수업 일정 수정) --- */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-up flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-900 text-base">
                  오늘의 수업 및 일과 일정 편집 ({teacherClass})
                </h3>
                <p className="text-xs text-slate-500">
                  시간대별 일과 제목 및 세부 활동 내용을 자유롭게 수정하거나 추가할 수 있습니다.
                </p>
              </div>
              <button
                onClick={() => setIsScheduleModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleAddScheduleItem}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-xl border border-blue-200 transition-colors flex items-center gap-1"
              >
                <span>+ 새 일정 추가</span>
              </button>
              <button
                type="button"
                onClick={handleResetSchedulePreset}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-xl transition-colors"
              >
                표준 일과로 초기화
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {editingScheduleList.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="w-6 h-6 rounded-md bg-blue-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={item.time}
                      onChange={e => {
                        const newTime = e.target.value;
                        setEditingScheduleList(prev =>
                          prev.map((it, i) => (i === idx ? { ...it, time: newTime } : it))
                        );
                      }}
                      placeholder="09:00 ~ 10:00"
                      className="text-xs font-mono font-bold bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 w-36 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <input
                      type="text"
                      value={item.title}
                      onChange={e => {
                        const newTitle = e.target.value;
                        setEditingScheduleList(prev =>
                          prev.map((it, i) => (i === idx ? { ...it, title: newTitle } : it))
                        );
                      }}
                      placeholder="일과 제목"
                      className="text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 flex-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteScheduleItem(idx)}
                      className="text-xs text-rose-500 hover:text-rose-700 p-1 font-bold shrink-0"
                      title="삭제"
                    >
                      ✕
                    </button>
                  </div>
                  <input
                    type="text"
                    value={item.desc}
                    onChange={e => {
                      const newDesc = e.target.value;
                      setEditingScheduleList(prev =>
                        prev.map((it, i) => (i === idx ? { ...it, desc: newDesc } : it))
                      );
                    }}
                    placeholder="세부 활동 내용"
                    className="w-full text-xs text-slate-600 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsScheduleModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSaveSchedule}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-500/20"
              >
                일정 저장 완료
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. 1-Step Confirmation Modal ("1번 더 물어보고 신청하기") */}
      {/* ======================================================== */}
      {quickRequestModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full overflow-hidden shadow-2xl flex flex-col border border-slate-200 animate-scale-up">
            {/* Header */}
            <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center font-black">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-black">셔틀 탑승 결재 신청 확인</h3>
                  <p className="text-[11px] text-blue-100">하차 위치 기준 담당 차량으로 자동 매칭됩니다.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setQuickRequestModal(null)}
                className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">신청 원아:</span>
                  <span className="text-sm font-black text-blue-950">
                    {quickRequestModal.student.name} ({quickRequestModal.student.raw?.['반명'] || teacherClass || '원아'})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">하차 희망 위치:</span>
                  <span className="text-xs font-bold text-slate-800 truncate max-w-[200px]" title={quickRequestModal.student.address}>
                    {quickRequestModal.student.address || '원아 등록 주소'}
                  </span>
                </div>
              </div>

              {/* Ride Type Selection (1번: 당일 1회 vs 정규 등록) */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-2">
                <label className="text-xs font-black text-slate-700 block">
                  탑승 구분 선택
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setQuickRequestRideType('TODAY_ONLY')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      quickRequestRideType === 'TODAY_ONLY'
                        ? 'bg-blue-50/90 border-2 border-blue-500 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black text-blue-950">오늘 하루만 탑승</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">권장</span>
                    </div>
                    <span className="text-[10px] text-slate-500 leading-tight">오늘 하원 1회 탑승 (내일은 기존 픽업으로 자동 원복)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setQuickRequestRideType('REGULAR')}
                    className={`p-2.5 rounded-xl border text-left transition flex flex-col justify-between ${
                      quickRequestRideType === 'REGULAR'
                        ? 'bg-indigo-50/90 border-2 border-indigo-500 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-black text-indigo-950">정규 셔틀 등록</span>
                    </div>
                    <span className="text-[10px] text-slate-500 leading-tight">원아 정보 및 통학버스 운행 노선에 영구 편입</span>
                  </button>
                </div>
              </div>

              {/* 2번: 배차 추천 차량 (1:1 모드일 때 표시) */}
              {quickRequestMode !== 'CONTEST' && (
                quickRequestModal.targetBus ? (
                  <div className="bg-indigo-50/80 border-2 border-indigo-200 rounded-2xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-indigo-900">추천 배차 차량:</span>
                      <div className="flex items-center gap-1.5">
                        {quickRequestModal.remainingSeats > 0 ? (
                          <span className="text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-300">
                            잔여 {quickRequestModal.remainingSeats}석 ({quickRequestModal.capacity}인승)
                          </span>
                        ) : (
                          <span className="text-xs font-black text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md border border-rose-300">
                            만차 (0/{quickRequestModal.capacity}석)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Vehicle selector dropdown */}
                    {quickRequestModal.allEvaluatedBuses && quickRequestModal.allEvaluatedBuses.length > 1 ? (
                      <div>
                        <select
                          value={quickRequestModal.targetBus.id}
                          onChange={(e) => {
                            const chosenId = Number(e.target.value);
                            const matched = quickRequestModal.allEvaluatedBuses.find(item => item.bus.id === chosenId);
                            if (matched) {
                              setQuickRequestModal(prev => ({
                                ...prev,
                                targetBus: matched.bus,
                                distanceLabel: matched.label,
                                remainingSeats: matched.remainingSeats,
                                capacity: matched.capacity,
                              }));
                            }
                          }}
                          className="w-full px-3 py-2 text-xs font-bold bg-white border border-indigo-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          {quickRequestModal.allEvaluatedBuses.map(item => (
                            <option key={item.bus.id} value={item.bus.id}>
                              {item.bus.name} {item.hasSeats ? `(잔여 ${item.remainingSeats}/${item.capacity}석)` : `[만차 0/${item.capacity}석]`} - {item.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="font-extrabold text-sm text-indigo-950 bg-white px-3 py-1.5 rounded-xl border border-indigo-200">
                        {quickRequestModal.targetBus.name} {quickRequestModal.targetBus.licensePlate ? `(${quickRequestModal.targetBus.licensePlate})` : ''}
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-500 font-bold">담당 지도교사:</span>
                      <span className="font-extrabold text-slate-800">
                        {quickRequestModal.targetBus.teacherName || quickRequestModal.targetBus.teacherUser?.name || '담당 지도교사'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500 font-bold">거리 근접도:</span>
                      <span className="font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {quickRequestModal.distanceLabel || '가장 가까운 하차 구역'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-bold">
                    배차 가능한 차량을 찾을 수 없습니다. 오픈 공모로 신청하시거나 관리자님께 문의해주세요.
                  </div>
                )
              )}

              {/* Full Capacity Warning Alert */}
              {quickRequestMode !== 'CONTEST' && quickRequestModal.allEvaluatedBuses?.every(b => !b.hasSeats) && (
                <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-800 font-bold leading-relaxed">
                  주의: 모든 통학버스가 만차(승차 정원 초과) 상태입니다. 원장님 및 담당 지도교사님과 사전 상의 후 신청해주세요.
                </div>
              )}

              <p className="text-xs text-slate-600 font-medium leading-relaxed text-center px-2">
                위 원아의 하차 위치를 담당하는 <strong className="text-indigo-600">{quickRequestModal.targetBus?.name} {quickRequestModal.targetBus?.teacherName || ''} 지도교사님</strong>께 {quickRequestRideType === 'TODAY_ONLY' ? '오늘 하루 하원 탑승' : '정규 셔틀 등록'} 결제를 신청하시겠습니까?
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={isSendingQuickRequest}
                onClick={() => setQuickRequestModal(null)}
                className="px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isSendingQuickRequest || !quickRequestModal.targetBus}
                onClick={handleExecuteQuickRideRequest}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-md shadow-blue-500/20 transition flex items-center gap-1.5 disabled:opacity-50"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                <span>{isSendingQuickRequest ? '신청 전송 중...' : '신청하기'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL 6: Approval History Modal (결재 내역 히스토리) --- */}
      {showApprovalHistory && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-4xl w-full p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] animate-scale-up">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-900 text-lg flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  셔틀 탑승 전자 결재 히스토리
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  담임교사 및 지도교사 간 진행된 모든 셔틀 결재 신청 및 승인/반려 이력을 조회합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowApprovalHistory(false)}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-sm transition"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4">
              {Object.keys(rideRequests).length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <p className="text-sm font-semibold">진행되거나 기록된 결재 내역이 없습니다.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-extrabold border-b border-slate-200 uppercase">
                        <th className="py-2.5 px-3">원아명</th>
                        <th className="py-2.5 px-3">탑승 희망 차량</th>
                        <th className="py-2.5 px-3">하차 / 탑승 위치</th>
                        <th className="py-2.5 px-3">담당 지도교사</th>
                        <th className="py-2.5 px-3">결재 상태</th>
                        <th className="py-2.5 px-3">신청 / 처리 일시</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {Object.values(rideRequests).map((req, i) => (
                        <tr key={req.messageId || i} className="hover:bg-slate-50">
                          <td className="py-3 px-3 font-black text-slate-900">
                            {req.studentName}
                          </td>
                          <td className="py-3 px-3 font-bold text-blue-700">
                            {req.busNumber || '차량 미지정'}
                          </td>
                          <td className="py-3 px-3 text-slate-600 max-w-[200px] truncate" title={req.boardingLocation}>
                            {req.boardingLocation || '위치 정보 없음'}
                          </td>
                          <td className="py-3 px-3 text-slate-700 font-semibold">
                            {req.teacherName || '배정 지도교사'}
                          </td>
                          <td className="py-3 px-3">
                            {req.status === 'APPROVED' ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                                승인 완료
                              </span>
                            ) : req.status === 'RE_REQUESTED' ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-purple-100 text-purple-800 border border-purple-300">
                                새 위치 제안
                              </span>
                            ) : req.status === 'REJECTED' ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-100 text-rose-800 border border-rose-300">
                                반려
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                승인 대기 중
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-slate-400 font-medium whitespace-nowrap">
                            {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '최근'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowApprovalHistory(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
