import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Polygon, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import * as XLSX from 'xlsx';
import { useRef } from 'react';
import io from 'socket.io-client';
import LogViewer from './LogViewer';
import MessagePanel from './MessagePanel';
import DocumentManager from './documents/DocumentManager';
import DocumentSidebar from './documents/DocumentSidebar';
import { getOverallExpirySummary } from './documents/documentStorage';
import BoardViewer from './board/BoardViewer';
import BoardSidebar from './board/BoardSidebar';
import { API_BASE_URL } from './config';
import TeacherDashboard from './TeacherDashboard';
import ClassManager from './classes/ClassManager';


// Fix Leaflet default icon issue
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Helper to generate a random bright color
const getRandomColor = () => {
  const hues = [0, 30, 60, 120, 200, 280, 320]; // Red, Orange, Yellow, Green, Blue, Purple, Pink
  const randomHue = hues[Math.floor(Math.random() * hues.length)];
  return `hsl(${randomHue}, 70%, 50%)`;
};

function MapBoundsFit({ buses, academy }) {
  const map = useMap();
  useEffect(() => {
    const allPoints = [];
    if (academy && !isNaN(academy.lat) && !isNaN(academy.lng)) {
      allPoints.push([academy.lat, academy.lng]);
    }
    buses.forEach(bus => {
      if (bus.points) {
        bus.points.forEach(pt => allPoints.push(pt));
      }
    });
    
    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [buses, academy, map]);
  return null;
}

function ZoneEditEvents({ isAddingPoint, onAddPoint }) {
  useMapEvents({
    click(e) {
      if (isAddingPoint) {
        onAddPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

function PickupPointEvents({ isAddingPickupPoint, onAddPickupPoint }) {
  useMapEvents({
    click(e) {
      if (isAddingPickupPoint) {
        onAddPickupPoint([e.latlng.lat, e.latlng.lng]);
      }
    },
  });
  return null;
}

export default function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Multi-tenant User Context
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('takeme_user') || '{}');
    } catch (e) {
      return {};
    }
  })();
  const isAuthenticated = Boolean(currentUser && currentUser.id && currentUser.role);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const [allAcademies, setAllAcademies] = useState([]);
  const [selectedAcademyId, setSelectedAcademyId] = useState(
    Number(localStorage.getItem('takeme_selected_academy_id')) || currentUser.academyId || null
  );

  const [buses, setBuses] = useState([]);
  const [students, setStudents] = useState([]); // Array of { name, address, lat, lng, assignedBusId, color }
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [activeTab, setActiveTab] = useState('status'); // 'status', 'buses', 'students', 'classes', 'auth', 'log', 'messages', 'documents', 'board', 'settings'
  const [isLogClosing, setIsLogClosing] = useState(false);
  const [isMessageClosing, setIsMessageClosing] = useState(false);
  const [isDocumentsClosing, setIsDocumentsClosing] = useState(false);
  const [isBoardClosing, setIsBoardClosing] = useState(false);
  const [isClassesClosing, setIsClassesClosing] = useState(false);
  const [boardSelectedClass, setBoardSelectedClass] = useState('ALL');
  const [boardSearchKeyword, setBoardSearchKeyword] = useState('');
  const [isCreatingBoardPost, setIsCreatingBoardPost] = useState(false);
  const [boardPosts, setBoardPosts] = useState([]);
  const [editingBus, setEditingBus] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacherClasses, setSelectedTeacherClasses] = useState({});
  const [isAssigningClass, setIsAssigningClass] = useState(false);

  // Custom Created Classes State (persisted per academy)
  const [customClasses, setCustomClasses] = useState(() => {
    try {
      const saved = localStorage.getItem(`takeme_custom_classes_${selectedAcademyId || 'default'}`);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return ['햇살반', '열매반', '새싹반'];
  });

  // Dynamic Kindergarten Classes Extractor
  const availableClasses = useMemo(() => {
    const classSet = new Set(customClasses || []);
    students.forEach(st => {
      let raw = st?.raw;
      if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch(e) {}
      }
      if (raw && raw['반명'] && String(raw['반명']).trim() && raw['반명'] !== '미배정') {
        classSet.add(String(raw['반명']).trim());
      }
      if (raw && raw['반'] && String(raw['반']).trim() && raw['반'] !== '미배정') {
        classSet.add(String(raw['반']).trim());
      }
    });
    teachers.forEach(t => {
      if (t.assignedClass && String(t.assignedClass).trim() && t.assignedClass !== '미배정') {
        classSet.add(String(t.assignedClass).trim());
      }
    });
    if (classSet.size === 0) return ['햇살반', '열매반', '새싹반'];
    return Array.from(classSet).sort();
  }, [students, teachers, customClasses]);

  // Messaging States
  const [msgSelectedBusId, setMsgSelectedBusId] = useState(null);
  const [msgTargetDriver, setMsgTargetDriver] = useState(false);
  const [msgTargetTeacher, setMsgTargetTeacher] = useState(false);
  const [msgTargetStudents, setMsgTargetStudents] = useState([]); // array of student IDs

  // Legal Expiry Urgent Count State
  const [urgentExpiryCount, setUrgentExpiryCount] = useState(0);

  useEffect(() => {
    const updateExpiryStatus = () => {
      try {
        const summary = getOverallExpirySummary(buses);
        setUrgentExpiryCount(summary.urgentCount);
      } catch (e) {
        console.error('만료 현황 확인 실패:', e);
      }
    };
    updateExpiryStatus();
    window.addEventListener('takeme_expiry_changed', updateExpiryStatus);
    return () => window.removeEventListener('takeme_expiry_changed', updateExpiryStatus);
  }, [buses]);


  const handleTabChange = (newTab) => {
    if (activeTab === 'log' && newTab !== 'log') {
      setIsLogClosing(true);
      setTimeout(() => {
        setIsLogClosing(false);
        setActiveTab(newTab);
      }, 300);
    } else if (activeTab === 'messages' && newTab !== 'messages') {
      setIsMessageClosing(true);
      setTimeout(() => {
        setIsMessageClosing(false);
        setActiveTab(newTab);
      }, 300);
    } else if (activeTab === 'documents' && newTab !== 'documents') {
      setIsDocumentsClosing(true);
      setTimeout(() => {
        setIsDocumentsClosing(false);
        setActiveTab(newTab);
      }, 300);
    } else if (activeTab === 'board' && newTab !== 'board') {
      setIsBoardClosing(true);
      setTimeout(() => {
        setIsBoardClosing(false);
        setActiveTab(newTab);
      }, 300);
    } else if (activeTab === 'classes' && newTab !== 'classes') {
      setIsClassesClosing(true);
      setTimeout(() => {
        setIsClassesClosing(false);
        setActiveTab(newTab);
      }, 300);
    } else {
      setActiveTab(newTab);
    }
  };
  
  const [academy, setAcademy] = useState(null);
  const [showAcademyModal, setShowAcademyModal] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [isInitializing, setIsInitializing] = useState(true);
  const [academyForm, setAcademyForm] = useState({ name: '', address: '' });
  const [isResettingZones, setIsResettingZones] = useState(false);
  const resetFileInputRef = useRef(null);
  const setupFileInputRef = useRef(null);
  const [isChangingAcademy, setIsChangingAcademy] = useState(false);
  const [academyChangeForm, setAcademyChangeForm] = useState({ name: '', address: '' });
  
  // Zone Editing State
  const [isZoneEditingMode, setIsZoneEditingMode] = useState(false);
  const [editingZoneBusId, setEditingZoneBusId] = useState(null);
  const [editingPolygon, setEditingPolygon] = useState([]);
  const [isAddingPoint, setIsAddingPoint] = useState(false);
  
  // Pickup Point State
  const [pickupPoints, setPickupPoints] = useState([]);
  const [showPickupPoints, setShowPickupPoints] = useState(false);
  const [isAddingPickupPoint, setIsAddingPickupPoint] = useState(false);
  
  // Log Viewer State
  const [logTab, setLogTab] = useState('LOG'); // 'LOG', 'ABSENCE', 'HOLIDAY'

  // Day Filter State
  const [selectedDay, setSelectedDay] = useState('ALL'); // 'ALL', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'

  const [busLocations, setBusLocations] = useState({});

  // Student Addition Modal State
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [studentForm, setStudentForm] = useState({
    name: '',
    address: '',
    inLocation: '',
    outLocation: '',
    className: '',
    kindergartenName: '',
    age: '',
    gender: '남',
    parentName: '',
    parentPhone: '',
    teacherName: '',
    departureType: '정규하원',
    assignedBusId: '',
    inTime: '',
    outTime: '',
    note: ''
  });

  // Student Filter & Grouping Accordion State
  const [studentFilterMode, setStudentFilterMode] = useState('ALL'); // 'ALL', 'CLASS', 'AGE', 'BUS'
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [expandedStudentDetailIds, setExpandedStudentDetailIds] = useState(new Set());

  const toggleStudentDetail = (id) => {
    setExpandedStudentDetailIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupCollapse = (key) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const getStudentRaw = (st) => {
    let raw = st?.raw;
    if (typeof raw === 'string') {
      try { raw = JSON.parse(raw); } catch(e) { raw = {}; }
    }
    return raw || {};
  };

  const getGroupedStudents = () => {
    if (studentFilterMode === 'CLASS') {
      const groups = {};
      students.forEach(st => {
        const raw = getStudentRaw(st);
        const val = raw['반명'];
        const key = val !== undefined && val !== null && String(val).trim() ? String(val).trim() : '반 미지정';
        if (!groups[key]) groups[key] = [];
        groups[key].push(st);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => ({
        key: `class_${name}`,
        name,
        list
      }));
    }
    if (studentFilterMode === 'AGE') {
      const groups = {};
      students.forEach(st => {
        const raw = getStudentRaw(st);
        const rawAge = raw['연령'] !== undefined && raw['연령'] !== null ? raw['연령'] : raw['학년'];
        const key = rawAge !== undefined && rawAge !== null && String(rawAge).trim() ? String(rawAge).trim() : '연령 미입력';
        if (!groups[key]) groups[key] = [];
        groups[key].push(st);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([name, list]) => ({
        key: `age_${name}`,
        name,
        list
      }));
    }
    if (studentFilterMode === 'BUS') {
      const groups = {};
      buses.forEach(b => {
        groups[b.name] = { bus: b, list: [] };
      });
      groups['배정 대기'] = { bus: null, list: [] };

      students.forEach(st => {
        const bus = buses.find(b => b.id === st.assignedBusId);
        const key = bus ? bus.name : '배정 대기';
        if (!groups[key]) groups[key] = { bus, list: [] };
        groups[key].list.push(st);
      });
      return Object.entries(groups).map(([name, data]) => ({
        key: `bus_${name}`,
        name,
        bus: data.bus,
        list: data.list
      }));
    }
    return [];
  };

  const handleToggleAllGroups = () => {
    const groups = getGroupedStudents();
    const anyOpen = groups.some(g => !collapsedGroups[g.key]);
    const next = {};
    groups.forEach(g => {
      next[g.key] = anyOpen; // if any open, collapse all; else open all
    });
    setCollapsedGroups(next);
  };

  const socketRef = useRef(null);

  useEffect(() => {
    let token = localStorage.getItem('takeme_token');
    if (!token) {
      try {
        const u = JSON.parse(localStorage.getItem('takeme_user') || '{}');
        token = u?.accessToken;
      } catch (e) {}
    }

    const socket = io(API_BASE_URL, {
      auth: { token },
      transports: ['websocket', 'polling']
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Manager socket connected:', socket.id);
      if (buses && buses.length > 0) {
        buses.forEach(b => {
          socket.emit('joinVehicleRoom', { vehicleId: Number(b.id) });
        });
      }
    });

    socket.on('locationUpdated', (data) => {
      console.log('Real-time bus location received:', data);
      setBusLocations(prev => ({
        ...prev,
        [data.vehicleId]: {
          lat: parseFloat(data.lat),
          lng: parseFloat(data.lng),
          timestamp: data.timestamp
        }
      }));
    });

    socket.on('authError', (err) => {
      console.warn('Manager socket auth error:', err);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && buses && buses.length > 0) {
      buses.forEach(b => {
        socketRef.current.emit('joinVehicleRoom', { vehicleId: Number(b.id) });
      });
    }
  }, [buses]);

  const handleLogout = () => {
    if (window.confirm('로그아웃 하시겠습니까?')) {
      localStorage.removeItem('takeme_user');
      localStorage.removeItem('takeme_selected_academy_id');
      localStorage.removeItem('takeme_academy');
      localStorage.removeItem('takeme_buses');
      navigate('/');
    }
  };

  useEffect(() => {
    if (isSuperAdmin) {
      fetch(`${API_BASE_URL}/routing/academies`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data) && data.length > 0) {
            setAllAcademies(data);
            if (!selectedAcademyId) {
              setSelectedAcademyId(data[0].id);
              localStorage.setItem('takeme_selected_academy_id', String(data[0].id));
            }
          }
        })
        .catch(err => console.error('Failed to load academies', err));
    }
  }, [isSuperAdmin]);

  const handleSwitchAcademy = (newAcademyId) => {
    setSelectedAcademyId(newAcademyId);
    localStorage.setItem('takeme_selected_academy_id', String(newAcademyId));
    loadInitialState(newAcademyId);
  };

  const handleGenerateAuthCode = async () => {
    if (!window.confirm('새로운 원 인증코드를 발급하시겠습니까? 기존 코드는 사용할 수 없게 됩니다.')) return;
    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/generate-auth-code`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academyId: targetAcademyId })
      });
      const data = await res.json();
      if (res.ok && data.authCode) {
        setAcademy(prev => {
          const updated = { ...prev, authCode: data.authCode };
          localStorage.setItem('takeme_academy', JSON.stringify(updated));
          return updated;
        });
        alert('새로운 인증코드가 발급되었습니다!');
      } else {
        alert(data.message || '인증코드 발급에 실패했습니다. 유치원 정보를 먼저 설정해주세요.');
      }
    } catch (e) {
      console.error(e);
      alert('오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveStudent = async (studentId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/routing/approve-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId })
      });
      if (res.ok) {
        setStudents(students.map(s => s.id === studentId ? { ...s, approvalStatus: 'APPROVED' } : s));
      }
    } catch (e) {
      console.error(e);
      alert('승인 처리 중 오류가 발생했습니다.');
    }
  };

  const handleRevokeStudent = async (studentId, isPending = false) => {
    if (!window.confirm(isPending ? '가입 승인을 거절하시겠습니까?' : '이 원아의 앱 접근 권한을 해제(탈퇴)하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/routing/revoke-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId })
      });
      if (res.ok) {
        setStudents(students.map(s => s.id === studentId ? { ...s, approvalStatus: 'UNREGISTERED', isRegistered: false } : s));
      }
    } catch (e) {
      console.error(e);
      alert('처리 중 오류가 발생했습니다.');
    }
  };

  const handleApproveStaff = async (vehicleId, role) => {
    try {
      const res = await fetch(`${API_BASE_URL}/routing/approve-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, role })
      });
      if (res.ok) {
        setBuses(buses.map(b => {
          if (b.id !== vehicleId) return b;
          return role === 'DRIVER' ? { ...b, driverApprovalStatus: 'APPROVED' } : { ...b, teacherApprovalStatus: 'APPROVED' };
        }));
      }
    } catch (e) {
      console.error(e);
      alert('승인 처리 중 오류가 발생했습니다.');
    }
  };

  const handleRevokeStaff = async (vehicleId, role, isPending = false) => {
    if (!window.confirm(isPending ? '가입 승인을 거절하시겠습니까?' : '이 직원의 앱 접근 권한을 해제(탈퇴)하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/routing/revoke-staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicleId, role })
      });
      if (res.ok) {
        setBuses(buses.map(b => {
          if (b.id !== vehicleId) return b;
          return role === 'DRIVER' 
            ? { ...b, driverApprovalStatus: 'UNREGISTERED', isDriverRegistered: false } 
            : { ...b, teacherApprovalStatus: 'UNREGISTERED', isTeacherRegistered: false };
        }));
      }
    } catch (e) {
      console.error(e);
      alert('처리 중 오류가 발생했습니다.');
    }
  };

  const fetchTeachers = async () => {
    const targetAcademyId = selectedAcademyId || currentUser.academyId;
    if (!targetAcademyId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/routing/teachers?academyId=${targetAcademyId}`);
      if (res.ok) {
        const data = await res.json();
        setTeachers(data);
      }
    } catch (e) {
      console.error('Failed to fetch teachers', e);
    }
  };

  const refreshAllData = async () => {
    try {
      if (typeof loadInitialState === 'function') await loadInitialState();
      if (typeof fetchTeachers === 'function') await fetchTeachers();
    } catch (e) {
      console.error('Refresh all data failed', e);
    }
  };

  const handleAssignClass = async (teacherId) => {
    const assignedClass = selectedTeacherClasses[teacherId];
    if (!assignedClass) {
      alert('배정할 반을 선택해주세요.');
      return;
    }
    setIsAssigningClass(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/teacher/assign-class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId, assignedClass })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(`담당 반이 [${assignedClass}] (으)로 배정되었습니다.`);
        fetchTeachers();
      } else {
        alert(result.message || '반 배정에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('반 배정 처리 중 오류가 발생했습니다.');
    } finally {
      setIsAssigningClass(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'auth' || activeTab === 'classes') {
      fetchTeachers();
    }
  }, [activeTab, selectedAcademyId]);

  const handleDeleteAcademy = async () => {
    if (!window.confirm('정말 유치원 계정을 탈퇴(삭제)하시겠습니까?\n원아 명단, 통학차량 정보 등 모든 데이터가 영구적으로 삭제됩니다.')) return;
    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/delete-academy`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academyId: targetAcademyId })
      });
      if (res.ok) {
        localStorage.removeItem('takeme_academy');
        localStorage.removeItem('takeme_buses');
        localStorage.removeItem('takeme_user');
        setAcademy(null);
        setBuses([]);
        setStudents([]);
        setActiveTab('status');
        setShowAcademyModal(true);
        alert('유치원 회원 탈퇴 및 데이터 초기화가 완료되었습니다. 로그인 화면으로 돌아갑니다.');
        navigate('/');
      } else {
        alert('탈퇴 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('처리 중 서버 통신 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddPickupPoint = async (latlng) => {
    const name = window.prompt('탑승지 이름을 입력하세요 (예: 한신아파트 정문):');
    if (!name) {
      setIsAddingPickupPoint(false);
      return;
    }
    
    setIsProcessing(true);
    try {
      const targetAcademyId = selectedAcademyId || currentUser.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/pickup-point`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, latitude: latlng[0], longitude: latlng[1], academyId: targetAcademyId })
      });
      if (res.ok) {
        const newPoint = await res.json();
        setPickupPoints([...pickupPoints, newPoint]);
        setShowPickupPoints(true);
        alert('탑승지가 추가되었습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
      setIsAddingPickupPoint(false);
    }
  };

  const handleDeletePickupPoint = async (id) => {
    if (!window.confirm('이 탑승지를 삭제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/routing/pickup-point/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setPickupPoints(pickupPoints.filter(p => p.id !== id));
      }
    } catch (e) {}
  };

  const handleUpdateBus = async (e) => {
    e.preventDefault();
    if (!editingBus) return;
    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/vehicle/${editingBus.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          busNumber: editingBus.busNumber,
          plateNumber: editingBus.plateNumber,
          driverName: editingBus.driverName,
          driverPhone: editingBus.driverPhone,
          teacherName: editingBus.teacherName,
          teacherPhone: editingBus.teacherPhone,
          capacity: parseInt(editingBus.capacity) || 25,
        })
      });
      const data = await res.json();
      if (res.ok) {
        alert('버스 정보가 성공적으로 수정되었습니다.');
        // Update local buses array
        const updatedBuses = buses.map(b => b.id === data.id ? { ...b, ...data } : b);
        setBuses(updatedBuses);
        localStorage.setItem('takeme_buses', JSON.stringify(updatedBuses));
        setEditingBus(null);
      } else {
        alert(data.message || '오류가 발생했습니다.');
      }
    } catch (err) {
      console.error(err);
      alert('서버 통신 오류');
    } finally {
      setIsProcessing(false);
    }
  };

  const formatPhoneNumber = (value) => {
    if (!value) return '';
    const onlyNums = value.replace(/[^\d]/g, '');
    if (onlyNums.length <= 3) return onlyNums;
    if (onlyNums.length <= 7) return `${onlyNums.slice(0, 3)}-${onlyNums.slice(3)}`;
    return `${onlyNums.slice(0, 3)}-${onlyNums.slice(3, 7)}-${onlyNums.slice(7, 11)}`;
  };

  const maskPhoneNumber = (value) => {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/(\d{2,3})[-.]?(\d{3,4})[-.]?(\d{4})/, '$1-****-$3');
  };

  // Custom icon for Academy
  const academyIcon = L.divIcon({
    html: '<div style="font-size: 36px; line-height: 1; text-align: center; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.3));">🏫</div>',
    className: 'bg-transparent',
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36]
  });

  const computePolygons = (busArray) => {
    return busArray.map(bus => {
      if (!bus.points || bus.points.length < 3) return { ...bus, polygon: [] };
      
      const turfPoints = turf.featureCollection(
        bus.points.map(p => turf.point([p[1], p[0]]))
      );
      const hull = turf.convex(turfPoints);
      if (!hull) return { ...bus, polygon: [] };
      
      const leafletCoords = hull.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
      return { ...bus, polygon: leafletCoords, turfPolygon: hull };
    });
  };

  const loadInitialState = async (overrideAcademyId) => {
    if (!isAuthenticated) return;
    try {
      setIsInitializing(true);
      const targetAcademyId = overrideAcademyId !== undefined ? overrideAcademyId : (selectedAcademyId || currentUser.academyId);
      const url = targetAcademyId 
        ? `${API_BASE_URL}/routing/initial-state?academyId=${targetAcademyId}`
        : `${API_BASE_URL}/routing/initial-state`;
      const res = await fetch(url);
      const data = await res.json();
      
      if (data.academy && data.academy.name && data.academy.roadAddress && !isNaN(parseFloat(data.academy.latitude))) {
        const formattedAcademy = {
          id: data.academy.id,
          name: data.academy.name,
          address: data.academy.roadAddress,
          lat: parseFloat(data.academy.latitude),
          lng: parseFloat(data.academy.longitude),
          authCode: data.academy.authCode
        };
        setAcademy(formattedAcademy);
        setAcademyForm({
          name: formattedAcademy.name,
          address: formattedAcademy.address
        });
      } else {
        setAcademy(null);
      }
      
      if (data.buses && data.buses.length > 0) {
        setBuses(computePolygons(data.buses));
        setShowAcademyModal(false);
      } else if (location.state && location.state.buses && location.state.buses.length > 0) {
        setBuses(computePolygons(location.state.buses));
        setShowAcademyModal(false);
      } else {
        setBuses([]);
        if (currentUser.role !== 'TEACHER') {
          setShowAcademyModal(true);
          setSetupStep(1);
        } else {
          setShowAcademyModal(false);
        }
      }
      
      if (data.students && data.students.length > 0) {
        setStudents(data.students);
      } else {
        setStudents([]);
      }
      
      try {
        const ptRes = await fetch(`${API_BASE_URL}/routing/pickup-points`);
        if (ptRes.ok) {
          setPickupPoints(await ptRes.json());
        }
      } catch (e) {
        console.error('Failed to fetch pickup points', e);
      }
    } catch (err) {
      console.error('Failed to load initial state', err);
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    loadInitialState();
  }, [location.state]);

  const handleAcademySubmit = async (e) => {
    e.preventDefault();
    if (!academyForm.name || !academyForm.address) return alert('유치원명과 주소를 입력해주세요.');

    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: [academyForm.address] })
      });
      const geocoded = await res.json();
      
      if (geocoded.length > 0 && geocoded[0].coords && !isNaN(geocoded[0].coords.lat) && !isNaN(geocoded[0].coords.lng)) {
        const newAcademy = {
          name: academyForm.name,
          address: academyForm.address,
          lat: geocoded[0].coords.lat,
          lng: geocoded[0].coords.lng
        };
        
        // Save to backend
        try {
          const targetAcademyId = selectedAcademyId || currentUser.academyId;
          await fetch(`${API_BASE_URL}/routing/setup-academy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...newAcademy, academyId: targetAcademyId })
          });
        } catch (e) {
          console.error('Failed to save academy to backend', e);
        }
        
        setAcademy(newAcademy);
        localStorage.setItem('takeme_academy', JSON.stringify(newAcademy));
        setShowAcademyModal(false);
      } else {
        alert('주소를 좌표로 변환할 수 없습니다. (카카오 API 키가 만료되었거나 일일 한도를 초과했을 수 있습니다.)');
      }
    } catch (err) {
      alert('주소 변환 중 에러가 발생했습니다.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleChangeAcademySubmit = async (e) => {
    e.preventDefault();
    if (!academyChangeForm.name || !academyChangeForm.address) return alert('유치원명과 주소를 입력해주세요.');

    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: [academyChangeForm.address] })
      });
      const geocoded = await res.json();
      
      if (geocoded.length > 0 && geocoded[0].coords && !isNaN(geocoded[0].coords.lat) && !isNaN(geocoded[0].coords.lng)) {
        const newAcademy = {
          name: academyChangeForm.name,
          address: academyChangeForm.address,
          lat: geocoded[0].coords.lat,
          lng: geocoded[0].coords.lng
        };
        
        try {
          const targetAcademyId = selectedAcademyId || currentUser.academyId;
          await fetch(`${API_BASE_URL}/routing/setup-academy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...newAcademy, academyId: targetAcademyId })
          });
        } catch (err) {
          console.error('Failed to save academy to backend', err);
        }
        
        setAcademy(newAcademy);
        localStorage.setItem('takeme_academy', JSON.stringify(newAcademy));
        setIsChangingAcademy(false);
        alert('유치원 위치가 성공적으로 변경되었습니다!');
      } else {
        alert('주소를 좌표로 변환할 수 없습니다. 정확한 주소를 입력해주세요.');
      }
    } catch (err) {
      alert('주소 변환 중 에러가 발생했습니다.');
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

// Kindergarten Excel 2-Row Header Parser
const parseKindergartenExcelSheet = (sheet) => {
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length === 0) return [];

  const row0 = rows[0] || [];
  const row1 = rows[1] || [];

  // Check if row 1 contains sub-headers like '정규하원', '방과후하원', '종일반하원'
  const isTwoRowHeader = row1.some(cell => 
    cell && typeof cell === 'string' && (cell.includes('하원') || cell.includes('정규') || cell.includes('종일'))
  );

  let headerRowIndex = 0;
  let headers = [];

  if (isTwoRowHeader) {
    headerRowIndex = 2; // Data rows start at index 2
    for (let c = 0; c < Math.max(row0.length, row1.length); c++) {
      const top = row0[c] ? String(row0[c]).trim() : '';
      const sub = row1[c] ? String(row1[c]).trim() : '';
      if (sub) {
        headers.push(sub);
      } else if (top) {
        headers.push(top);
      } else {
        headers.push(`COL_${c}`);
      }
    }
  } else {
    headerRowIndex = 1;
    headers = row0.map((c, idx) => c ? String(c).trim() : `COL_${idx}`);
  }

  const result = [];
  for (let r = headerRowIndex; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;
    if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === '')) continue;
    
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = row[idx] !== undefined && row[idx] !== null ? String(row[idx]).trim() : '';
    });

    // Detect departure type
    let depType = obj['하원구분'] || obj['하원정보'] || '';
    if (!depType) {
      if (obj['정규하원'] && String(obj['정규하원']).trim()) depType = '정규하원';
      else if (obj['방과후하원'] && String(obj['방과후하원']).trim()) depType = '방과후하원';
      else if (obj['종일반하원'] && String(obj['종일반하원']).trim()) depType = '종일반하원';
    }
    obj['하원구분'] = depType || '정규하원';

    // Normalize field aliases
    const name = obj['원아명'] || obj['학생이름/영문이름'] || obj['이름'] || obj['원생명'] || obj['학생명'] || obj['원생이름'] || '';
    const kindergartenName = obj['유치원명'] || obj['소속원명'] || obj['학교명'] || '';
    const age = obj['연령'] || obj['학년'] || '';
    const parentPhone = obj['부모연락처'] || obj['보호자연락처'] || obj['보호자 연락처'] || '';
    const address = obj['등원지'] || obj['탑승지'] || obj['승차지'] || obj['주소'] || obj['도로명주소'] || '';

    obj['원아명'] = name;
    obj['이름'] = name;
    obj['유치원명'] = kindergartenName;
    obj['학교명'] = kindergartenName;
    obj['연령'] = age;
    obj['부모연락처'] = parentPhone;
    obj['보호자연락처'] = parentPhone;
    obj['주소'] = address;

    result.push(obj);
  }
  return result;
};

  const handleStudentUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        
        let data = [];
        wb.SheetNames.forEach(sheetName => {
          const sheet = wb.Sheets[sheetName];
          const sheetData = parseKindergartenExcelSheet(sheet);
          if (Array.isArray(sheetData) && sheetData.length > 0) {
            const hasRelevantColumns = sheetData.some(r => 
              r['원아명'] || r['학생이름/영문이름'] || r['이름'] || r['주소'] || r['등원지'] || r['탑승지'] || r['반명']
            );
            if (hasRelevantColumns) {
              data = data.concat(sheetData);
            }
          }
        });

        if (data.length === 0 && wb.SheetNames.length > 0) {
          data = parseKindergartenExcelSheet(wb.Sheets[wb.SheetNames[0]]) || [];
        }

        if (data.length === 0) {
          alert('엑셀 파일에서 유효한 원아 명단 데이터를 찾을 수 없습니다.');
          setIsProcessing(false);
          return;
        }

        const addressMap = data.map((row, idx) => {
          const name = row['학생이름/영문이름'] || row['이름'] || row['원생명'] || row['학생명'] || row['원생이름'] || `원생${idx + 1}`;
          const address = row['등원지'] || row['탑승지'] || row['승차지'] || row['승차지(주소)'] || row['주소'] || row['도로명주소'] || row['실탑승지'] || '';
          const boardingLocation = row['등원지'] || row['탑승지'] || row['승차지'] || address;
          return {
            name: name.toString().trim(),
            address: address.toString().trim(),
            boardingLocation: boardingLocation.toString().trim(),
            raw: row
          };
        }).filter(item => item.address);

        if (addressMap.length === 0) {
          alert('유효한 주소(등원지, 탑승지, 주소 등)가 입력된 원아 행을 찾을 수 없습니다.');
          setIsProcessing(false);
          return;
        }

        const res = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ addresses: addressMap.map(a => a.address) })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || '지오코딩 처리 실패');
        }
        const geocoded = await res.json();
        
        // Point-in-Polygon Assignment
        const newStudents = [];
        geocoded.forEach((item, idx) => {
          if (!item.coords) return;
          
          const pt = turf.point([item.coords.lng, item.coords.lat]);
          let assignedBus = null;
          let minDistance = Infinity;

          for (const bus of buses) {
            // 1. Check if inside polygon
            if (bus.turfPolygon && turf.booleanPointInPolygon(pt, bus.turfPolygon)) {
              assignedBus = bus;
              minDistance = 0;
              break;
            }
            
            // 2. Fallback: calculate distance to closest known point of this bus
            if (bus.points && bus.points.length > 0) {
              for (const bPt of bus.points) {
                // Leaflet uses [lat, lng], Turf uses [lng, lat]
                const busNode = turf.point([bPt[1], bPt[0]]);
                const dist = turf.distance(pt, busNode);
                if (dist < minDistance) {
                  minDistance = dist;
                  assignedBus = bus;
                }
              }
            }
          }

          newStudents.push({
            id: idx + 1,
            name: addressMap[idx].name,
            address: item.address,
            boardingLocation: addressMap[idx].boardingLocation,
            lat: item.coords.lat,
            lng: item.coords.lng,
            assignedBusId: assignedBus ? assignedBus.id : null,
            color: assignedBus ? assignedBus.color : '#64748b', // Slate for unassigned
            raw: addressMap[idx].raw
          });
        });

        // Save to backend
        const targetAcademyId = selectedAcademyId || currentUser.academyId;
        const saveRes = await fetch(`${API_BASE_URL}/routing/save-students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ students: newStudents, academyId: targetAcademyId })
        });
        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          throw new Error(errData.message || '원생 데이터 저장 실패');
        }

        // Refresh initial state so DB-assigned IDs and relations are fresh
        const stateRes = await fetch(`${API_BASE_URL}/routing/initial-state?academyId=${targetAcademyId}`);
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          if (Array.isArray(stateData.buses)) {
            setBuses(computePolygons(stateData.buses));
          }
          if (Array.isArray(stateData.students)) {
            setStudents(stateData.students);
          } else {
            setStudents(newStudents);
          }
        } else {
          setStudents(newStudents);
        }
        
        alert(`총 ${newStudents.length}명의 원생 등록 및 구역 배차가 완료되었습니다!`);
      } catch (err) {
        alert(`원생 명단 처리 중 에러가 발생했습니다: ${err.message}`);
        console.error(err);
      } finally {
        setIsProcessing(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleZoneResetUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      
      // Multi-sheet support: extract data across sheets or first non-empty sheet
      let data = [];
      wb.SheetNames.forEach(sheetName => {
        const sheet = wb.Sheets[sheetName];
        const sheetData = parseKindergartenExcelSheet(sheet);
        if (Array.isArray(sheetData) && sheetData.length > 0) {
          const hasRelevantColumns = sheetData.some(r => 
            r['등원차량'] || r['하원차량'] || r['차량'] || r['호차'] || r['등원지'] || r['주소'] || r['승차지'] || r['원아명'] || r['학생이름/영문이름'] || r['이름']
          );
          if (hasRelevantColumns) {
            data = data.concat(sheetData);
          }
        }
      });

      if (data.length === 0 && wb.SheetNames.length > 0) {
        data = parseKindergartenExcelSheet(wb.Sheets[wb.SheetNames[0]]) || [];
      }

      if (data.length === 0) {
        alert('엑셀 파일에서 유효한 원아/배차 데이터 행을 찾을 수 없습니다. 시트에 내용이 입력되어 있는지 확인해주세요.');
        setIsProcessing(false);
        return;
      }
      
      const busSet = new Set();
      data.forEach(row => {
        const b1 = row['등원차량'] || row['차량'] || row['호차'];
        const b2 = row['하원차량'];
        if (b1) busSet.add(b1.toString().trim());
        if (b2) busSet.add(b2.toString().trim());
      });

      const busList = Array.from(busSet).sort((a, b) => {
        const na = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
        return na - nb;
      });

      const count = busList.length > 0 ? busList.length : 1;
      const vehicles = Array.from({ length: count }).map((_, i) => ({
        id: i + 1,
        busNumber: busList[i] || `${i + 1}호차`,
        plateNumber: '',
        driverName: '미정',
        driverPhone: '000-0000-0000',
        teacherName: '미정',
        teacherPhone: '000-0000-0000',
        capacity: 25
      }));

      try {
        const targetAcademyId = selectedAcademyId || currentUser.academyId;
        const res = await fetch(`${API_BASE_URL}/routing/init-zones`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vehicles, parsedData: data, academyId: targetAcademyId })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || '서버 처리 실패');
        }
        const geocodedBuses = await res.json();
        
        // Process polygons before updating state
        const processedBuses = computePolygons(geocodedBuses);
        
        // Immediately update state, map, and localStorage
        setBuses(processedBuses);
        localStorage.setItem('takeme_buses', JSON.stringify(geocodedBuses));
        
        setStudents([]); // clear old students
        
        if (showAcademyModal) {
          alert('구역 세팅이 완료되었습니다!\n왼쪽 메뉴의 [버스 정보 관리] 탭에서 기사님과 교사님 정보를 등록해주세요.');
          setSetupStep(2); // Go to Academy Info Input
        } else {
          setIsResettingZones(false);
          alert('구역 세팅이 완료되었습니다!');
        }
      } catch (e) {
        alert(`구역 리셋에 실패했습니다: ${e.message}`);
        console.error(e);
      } finally {
        setIsProcessing(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const enforceConvexHull = (points) => {
    if (points.length < 3) return points;
    const turfPoints = turf.featureCollection(
      points.map(p => turf.point([p[1], p[0]]))
    );
    const hull = turf.convex(turfPoints);
    if (!hull) return points;
    const leafletCoords = hull.geometry.coordinates[0].map(coord => [coord[1], coord[0]]);
    // Remove duplicate last coordinate to prevent overlapping markers
    if (leafletCoords.length > 1) {
      const first = leafletCoords[0];
      const last = leafletCoords[leafletCoords.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        leafletCoords.pop();
      }
    }
    return leafletCoords;
  };

  const handleSelectEditBus = (busId) => {
    setEditingZoneBusId(busId);
    setIsAddingPoint(false);
    const bus = buses.find(b => b.id === busId);
    if (bus && bus.polygon) {
      setEditingPolygon(enforceConvexHull([...bus.polygon]));
    } else {
      setEditingPolygon([]);
    }
  };

  const handleDragEndPoint = (index, e) => {
    const newPos = [e.target.getLatLng().lat, e.target.getLatLng().lng];
    setEditingPolygon(prev => {
      const copy = [...prev];
      copy[index] = newPos;
      // Option: to keep it strictly convex even on drag, uncomment below:
      // return enforceConvexHull(copy);
      return copy;
    });
  };

  const handleAddPoint = (latlng) => {
    setEditingPolygon(prev => enforceConvexHull([...prev, latlng]));
    setIsAddingPoint(false); // turn off add mode after 1 click
  };

  const handleDeletePoint = (index) => {
    setEditingPolygon(prev => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy;
    });
  };

  const handleSavePolygon = async () => {
    if (!editingZoneBusId) return;
    try {
      setIsProcessing(true);
      const res = await fetch(`${API_BASE_URL}/routing/vehicle/${editingZoneBusId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ polygonCoordinates: editingPolygon })
      });
      if (res.ok) {
        const updatedBus = await res.json();
        // Because backend saves polygonCoordinates as array of [lat, lng],
        // and we might need to compute the hull again? 
        // Wait, if user explicitly defines the polygon, we should NOT convex hull it!
        // We just save it and use it as the polygon.
        
        const updated = buses.map(b => {
          if (b.id === editingZoneBusId) {
            return { ...b, polygon: editingPolygon, points: editingPolygon }; // Use exact polygon
          }
          return b;
        });
        setBuses(updated);
        localStorage.setItem('takeme_buses', JSON.stringify(updated));
        alert('구역이 저장되었습니다.');
        setEditingZoneBusId(null);
      } else {
        alert('구역 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('구역 저장 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportExcel = async () => {
    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/export-excel${targetAcademyId ? `?academyId=${targetAcademyId}` : ''}`);
      if (!res.ok) throw new Error('다운로드 실패');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `유치원_원아_명단_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSearchAddress = () => {
    const triggerPostcode = () => {
      new window.daum.Postcode({
        oncomplete: (data) => {
          const selectedAddr = data.roadAddress || data.jibunAddress || data.address;
          setStudentForm(prev => ({
            ...prev,
            address: selectedAddr,
            inLocation: prev.inLocation ? prev.inLocation : selectedAddr,
            outLocation: prev.outLocation ? prev.outLocation : selectedAddr,
          }));
        }
      }).open();
    };

    if (window.daum && window.daum.Postcode) {
      triggerPostcode();
    } else {
      const script = document.createElement('script');
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = triggerPostcode;
      document.head.appendChild(script);
    }
  };

  const handleAddStudentSubmit = async (e) => {
    e.preventDefault();
    if (!studentForm.name.trim()) {
      alert('원아 이름을 입력해주세요.');
      return;
    }
    if (!studentForm.address.trim()) {
      alert('도로명 주소를 입력해주세요.');
      return;
    }

    setIsProcessing(true);
    try {
      const targetAcademyId = selectedAcademyId || currentUser.academyId;

      // 1. Geocode address via backend geocode-bulk endpoint
      const geoRes = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: [studentForm.address.trim()] })
      });
      if (!geoRes.ok) throw new Error('주소 좌표 변환(지오코딩)에 실패했습니다.');
      const geocoded = await geoRes.json();
      const coords = geocoded[0]?.coords;

      let assignedBusId = studentForm.assignedBusId ? Number(studentForm.assignedBusId) : null;
      let assignedBus = buses.find(b => b.id === assignedBusId);

      // 2. Auto-assign vehicle by zone polygon if not manually selected
      if (!assignedBusId && coords) {
        const pt = turf.point([coords.lng, coords.lat]);
        let minDistance = Infinity;

        for (const bus of buses) {
          if (bus.turfPolygon && turf.booleanPointInPolygon(pt, bus.turfPolygon)) {
            assignedBus = bus;
            assignedBusId = bus.id;
            break;
          }
          if (bus.points && bus.points.length > 0) {
            for (const bPt of bus.points) {
              const busNode = turf.point([bPt[1], bPt[0]]);
              const dist = turf.distance(pt, busNode);
              if (dist < minDistance) {
                minDistance = dist;
                assignedBus = bus;
                assignedBusId = bus.id;
              }
            }
          }
        }
      }

      // 3. Prepare payload matching all 17 Excel columns
      const inLoc = studentForm.inLocation?.trim() || studentForm.address.trim();
      const outLoc = studentForm.outLocation?.trim() || studentForm.address.trim();

      const payload = {
        name: studentForm.name.trim(),
        address: studentForm.address.trim(),
        boardingLocation: inLoc,
        lat: coords ? coords.lat : undefined,
        lng: coords ? coords.lng : undefined,
        assignedBusId: assignedBusId,
        className: studentForm.className.trim(),
        kindergartenName: studentForm.kindergartenName?.trim() || academy?.name || '',
        schoolName: studentForm.kindergartenName?.trim() || academy?.name || '',
        age: studentForm.age.trim(),
        gender: studentForm.gender,
        parentName: studentForm.parentName.trim(),
        parentPhone: studentForm.parentPhone.trim(),
        teacherName: studentForm.teacherName.trim(),
        departureType: studentForm.departureType || '정규하원',
        inLocation: inLoc,
        outLocation: outLoc,
        inBus: assignedBus?.name || '',
        outBus: assignedBus?.name || '',
        inTime: studentForm.inTime.trim(),
        outTime: studentForm.outTime.trim(),
        note: studentForm.note.trim(),
        academyId: targetAcademyId
      };

      const res = await fetch(`${API_BASE_URL}/routing/add-student`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || '원생 등록 실패');
      }

      const resData = await res.json();
      
      // Refresh students and buses from initial-state to keep everything synced with DB
      const stateRes = await fetch(`${API_BASE_URL}/routing/initial-state?academyId=${targetAcademyId}`);
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        if (Array.isArray(stateData.buses)) {
          setBuses(computePolygons(stateData.buses));
        }
        if (Array.isArray(stateData.students)) {
          setStudents(stateData.students);
        }
      } else if (resData.student) {
        setStudents(prev => [...prev, resData.student]);
      }

      const busName = assignedBus?.name || (resData.student?.assignedBusId ? buses.find(b => b.id === resData.student.assignedBusId)?.name : '');
      const busInfo = busName 
        ? `[${busName}]에 배정되었으며, 차량 운행 구역이 원아 위치까지 자동으로 확장되었습니다!`
        : '(구역 미배정)';
      alert(`'${studentForm.name}' 원아가 성공적으로 추가되었습니다!\n${busInfo}`);
      setShowAddStudentModal(false);
      setStudentForm({
        name: '',
        address: '',
        inLocation: '',
        outLocation: '',
        className: '',
        kindergartenName: '',
        age: '',
        gender: '남',
        parentName: '',
        parentPhone: '',
        teacherName: '',
        departureType: '정규하원',
        assignedBusId: '',
        inTime: '',
        outTime: '',
        note: ''
      });
    } catch (err) {
      console.error(err);
      alert(`원생 추가 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteStudent = async (student) => {
    if (!window.confirm(`'${student.name}' 원생을 삭제하시겠습니까?`)) return;
    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/student/${student.id}${targetAcademyId ? `?academyId=${targetAcademyId}` : ''}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('삭제 실패');
      setStudents(prev => prev.filter(s => s.id !== student.id));
      alert(`'${student.name}' 원생이 삭제되었습니다.`);
    } catch (e) {
      console.error(e);
      alert('원생 삭제 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  if (isInitializing) {
    return (
      <div className="flex h-screen bg-slate-50 items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4 mx-auto"></div>
          <div className="font-bold text-slate-500 text-lg">데이터를 불러오는 중입니다...</div>
        </div>
      </div>
    );
  }

  // Dedicated Teacher Dashboard Mode
  if (currentUser.role === 'TEACHER') {
    return (
      <TeacherDashboard
        currentUser={currentUser}
        academy={academy}
        buses={buses}
        students={students}
        availableClasses={availableClasses}
        selectedAcademyId={selectedAcademyId}
        onLogout={handleLogout}
        onRefreshData={() => {
          loadInitialState(selectedAcademyId);
        }}
        boardPosts={boardPosts}
        setBoardPosts={setBoardPosts}
      />
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans relative">
      {/* Academy Registration Modal Overlay */}
      {showAcademyModal && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 transform transition-all">
            {setupStep === 1 && (
              <>
                <div className="text-center mb-6">
                  <div className="text-5xl mb-4">🗺️</div>
                  <h2 className="text-2xl font-bold text-slate-800">초기 구역 설정</h2>
                  <p className="text-slate-500 text-sm mt-2">전년도 배차 기준 파일을 업로드하여 기본 구역을 세팅해주세요.</p>
                </div>
                
                <div className="p-3 bg-red-100/50 rounded-lg mb-4 text-left">
                  <p className="text-xs text-red-800 font-bold">💡 작성 안내</p>
                  <p className="text-xs text-red-700 mt-1">
                    아래에서 양식을 다운로드한 후, <b>하이라이트 표시된 필수 항목(등원지, 하원지, 차량)</b>만 채워주시면 됩니다.<br/>해당 장소들을 바탕으로 자동으로 픽업/드랍 구역이 나뉩니다.
                  </p>
                </div>

                <a href="/전년도_자료_입력_시트_양식.xlsx" download="전년도_자료_입력_시트_양식.xlsx" className="w-full py-3 mb-3 bg-white text-slate-700 rounded-xl text-sm font-bold border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center">
                  ⬇️ 전년도 양식 다운로드
                </a>
                
                <input type="file" accept=".xlsx, .xls" className="hidden" ref={setupFileInputRef} onChange={handleZoneResetUpload} />
                <button 
                  onClick={() => setupFileInputRef.current.click()}
                  disabled={isProcessing}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50"
                >
                  {isProcessing ? '구역 세팅 중...' : '⬆️ 엑셀 업로드 및 시작하기'}
                </button>
              </>
            )}
            
            {setupStep === 2 && (
              <>
                <div className="text-center mb-6">
                  <div className="text-5xl mb-4">🏫</div>
                  <h2 className="text-2xl font-bold text-slate-800">유치원 위치 확인</h2>
                  <p className="text-slate-500 text-sm mt-2">지도의 중심이 될 유치원의 위치를 등록해주세요.</p>
                </div>
                
                <form onSubmit={handleAcademySubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">유치원명</label>
                    <input 
                      type="text" 
                      value={academyForm.name} 
                      onChange={e => setAcademyForm({...academyForm, name: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="예: 해솔 유치원"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">원 도로명 주소</label>
                    <input 
                      type="text" 
                      value={academyForm.address} 
                      onChange={e => setAcademyForm({...academyForm, address: e.target.value})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                      placeholder="예: 서울 강남구 역삼로 123"
                      required
                    />
                  </div>
                  <button 
                    type="submit" 
                    disabled={isProcessing}
                    className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors mt-6 disabled:opacity-50"
                  >
                    {isProcessing ? '위치 확인 및 완료 중...' : '모든 설정 완료하고 메인으로'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bookmark Rail (Left Navigation) */}
      <div className="w-20 bg-blue-700 flex flex-col items-center py-8 gap-6 z-20 shadow-xl">
        <div className="text-white font-bold text-xs mb-1">Takeme</div>
        <div className="text-[10px] text-blue-200 text-center truncate max-w-[70px] mb-4 font-medium" title={currentUser.name}>
          {isSuperAdmin ? '플랫폼관리' : (currentUser.name ? `${currentUser.name} 원장선생님` : '원장선생님')}
        </div>
        <button onClick={() => handleTabChange('status')} className={`p-4 rounded-2xl transition-all ${activeTab === 'status' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="차량 구역 현황">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>
        </button>
        <button onClick={() => handleTabChange('buses')} className={`p-4 rounded-2xl transition-all ${activeTab === 'buses' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="버스 정보 관리">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /><path d="M4 15h2v5h12V4H6v5" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} /></svg>
        </button>
        <button onClick={() => handleTabChange('students')} className={`p-4 rounded-2xl transition-all ${activeTab === 'students' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="원생 정보">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
        </button>
        <button onClick={() => handleTabChange('classes')} className={`p-4 rounded-2xl transition-all ${activeTab === 'classes' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="반 관리">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
        </button>
        <button onClick={() => handleTabChange('auth')} className={`p-4 rounded-2xl transition-all ${activeTab === 'auth' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="인증 관리">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
        </button>
        <button onClick={() => handleTabChange('log')} className={`p-4 rounded-2xl transition-all ${activeTab === 'log' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="캘린더 및 로그보기">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('messages')} className={`p-4 rounded-2xl transition-all ${activeTab === 'messages' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="메세지함">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        </button>
        <button onClick={() => handleTabChange('documents')} className={`relative p-4 rounded-2xl transition-all ${activeTab === 'documents' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="행정 및 안전 서류 관리">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          {urgentExpiryCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-blue-700 animate-pulse shadow-sm">
              {urgentExpiryCount}
            </span>
          )}
        </button>
        <button 
          onClick={() => handleTabChange('board')} 
          className={`relative p-4 rounded-2xl transition-all ${activeTab === 'board' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} 
          title="원아 앨범 & 게시판"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        <button onClick={() => handleTabChange('settings')} className={`p-4 rounded-2xl transition-all mt-auto ${activeTab === 'settings' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="환경설정">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
      </div>

      {/* Sidebar Content Panel */}
      <div className={`bg-white shadow-lg z-10 flex flex-col transition-all duration-300 ease-in-out ${activeTab === 'auth' ? 'w-[520px]' : activeTab === 'students' ? 'w-[380px]' : 'w-80'}`}>
        {activeTab === 'status' && (
          <div className="p-6 h-full flex flex-col">
            <h2 className="text-xl font-bold text-slate-800 mb-4">차량 구역 현황</h2>
            <button 
              onClick={() => setShowPickupPoints(!showPickupPoints)} 
              className={`mb-2 w-full py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${showPickupPoints ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-inner' : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-orange-600 shadow-sm'}`}
            >
              {showPickupPoints ? '탑승지 숨기기' : '탑승지 보기'}
            </button>
            <button 
              onClick={() => setIsAddingPickupPoint(!isAddingPickupPoint)} 
              className={`mb-4 w-full py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${isAddingPickupPoint ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-inner' : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300 hover:text-purple-600 shadow-sm'}`}
            >
              {isAddingPickupPoint ? '지도에서 탑승지 위치를 클릭하세요' : '+ 새 탑승지 추가'}
            </button>
            <div className="space-y-3 overflow-y-auto">
              {buses.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-10">위저드에서 전년도 엑셀을 업로드하여 구역을 생성해주세요.</div>
              ) : (
                buses.map(bus => {
                  const isSelected = selectedBusId === bus.id;
                  const busStudents = students.filter(st => st.assignedBusId === bus.id);
                  return (
                    <div 
                      key={bus.id} 
                      className={`p-4 border shadow-sm rounded-xl transition-all cursor-pointer ${isSelected ? 'border-blue-500 bg-blue-50/30' : 'border-slate-100 hover:border-blue-200'}`}
                      onClick={() => setSelectedBusId(isSelected ? null : bus.id)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-4 h-4 rounded-full shadow-inner flex-shrink-0" style={{ backgroundColor: bus.color }}></div>
                        <div className="flex-1">
                          <div className="font-bold text-slate-800 flex items-center justify-between">
                            {bus.name} 
                            {busStudents.length > 0 && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{busStudents.length}명</span>}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {bus.polygon && bus.polygon.length > 0 ? '구역 설정됨' : '좌표만 인식됨 (구역 불가)'}
                          </div>
                        </div>
                      </div>
                      
                      {isSelected && busStudents.length > 0 && (
                        <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                          {busStudents.map(st => (
                            <div key={st.id} className="text-xs flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                              <span className="font-bold text-slate-700">{st.name}</span>
                              <span className="text-slate-400 truncate max-w-[120px] text-right" title={st.address}>{st.address}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {isSelected && busStudents.length === 0 && (
                        <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400 text-center">배정된 원아가 없습니다.</div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'messages' && (
          <div className="p-6 h-full flex flex-col">
            <h2 className="text-xl font-bold text-slate-800 mb-2">메세지 수신 선택</h2>
            <p className="text-xs text-slate-500 mb-6">메세지를 보낼 호차와 수신자를 선택해주세요.</p>
            
            <div className="space-y-3 overflow-y-auto pr-2">
              {buses.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-10">등록된 버스가 없습니다.</div>
              ) : (
                buses.map(bus => {
                  const isSelected = msgSelectedBusId === bus.id;
                  const busStudents = students.filter(st => st.assignedBusId === bus.id);
                  return (
                    <div 
                      key={bus.id} 
                      className={`p-4 border shadow-sm rounded-xl transition-all ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-slate-100 hover:border-blue-200 bg-white'}`}
                    >
                      <div 
                        className="flex items-center gap-4 cursor-pointer"
                        onClick={() => {
                          if (isSelected) {
                            setMsgSelectedBusId(null);
                            setMsgTargetStudents([]);
                          } else {
                            setMsgSelectedBusId(bus.id);
                            setMsgTargetDriver(false);
                            setMsgTargetTeacher(false);
                            setMsgTargetStudents([]);
                          }
                        }}
                      >
                        <div className="w-4 h-4 rounded-full shadow-inner flex-shrink-0" style={{ backgroundColor: bus.color }}></div>
                        <div className="flex-1 font-bold text-slate-800">
                          {bus.name}
                        </div>
                      </div>
                      
                      {isSelected && (
                        <div className="mt-4 border-t border-slate-200 pt-3 space-y-3">
                          <div className="flex gap-2">
                            <label className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all ${msgTargetDriver ? 'border-blue-500 bg-blue-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                              <input type="checkbox" className="hidden" checked={msgTargetDriver} onChange={() => setMsgTargetDriver(!msgTargetDriver)} />
                              <span className={`font-bold text-sm ${msgTargetDriver ? 'text-blue-700' : 'text-slate-600'}`}>기사님</span>
                            </label>
                            <label className={`flex-1 flex items-center justify-center gap-2 p-2 rounded-lg border-2 cursor-pointer transition-all ${msgTargetTeacher ? 'border-green-500 bg-green-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                              <input type="checkbox" className="hidden" checked={msgTargetTeacher} onChange={() => setMsgTargetTeacher(!msgTargetTeacher)} />
                              <span className={`font-bold text-sm ${msgTargetTeacher ? 'text-green-700' : 'text-slate-600'}`}>지도교사</span>
                            </label>
                          </div>
                          
                          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                            <div className="bg-slate-50 px-3 py-2 flex justify-between items-center border-b border-slate-200">
                              <span className="text-xs font-bold text-slate-600">원아 학부모님 ({msgTargetStudents.length}/{busStudents.length})</span>
                              <button 
                                onClick={() => {
                                  if (msgTargetStudents.length === busStudents.length) setMsgTargetStudents([]);
                                  else setMsgTargetStudents(busStudents.map(s => s.id));
                                }}
                                className="text-[10px] bg-white border border-slate-300 px-2 py-1 rounded hover:bg-slate-100 font-bold"
                              >전체 선택</button>
                            </div>
                            <div className="max-h-40 overflow-y-auto p-2 space-y-1">
                              {busStudents.map(st => (
                                <label key={st.id} className={`flex items-center gap-2 p-1.5 rounded cursor-pointer ${msgTargetStudents.includes(st.id) ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                                  <input 
                                    type="checkbox" 
                                    checked={msgTargetStudents.includes(st.id)}
                                    onChange={() => {
                                      if (msgTargetStudents.includes(st.id)) setMsgTargetStudents(msgTargetStudents.filter(id => id !== st.id));
                                      else setMsgTargetStudents([...msgTargetStudents, st.id]);
                                    }}
                                    className="w-3.5 h-3.5 rounded text-blue-600"
                                  />
                                  <span className="text-xs font-bold text-slate-700">{st.name} <span className="font-normal text-slate-400">({st.raw?.['보호자 성함'] || '학부모'})</span></span>
                                </label>
                              ))}
                              {busStudents.length === 0 && <div className="text-center text-xs text-slate-400 py-2">배정된 원아가 없습니다.</div>}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'buses' && (
          <div className="p-6 h-full flex flex-col">
            <h2 className="text-xl font-bold text-slate-800 mb-6">버스 정보 관리</h2>
            <div className="space-y-3 overflow-y-auto pr-2">
              {buses.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-10">등록된 버스가 없습니다.</div>
              ) : (
                buses.map(bus => (
                  <div key={bus.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: bus.color }}></div>
                        <h3 className="font-bold text-slate-800 text-lg">{bus.name}</h3>
                      </div>
                      <button 
                        onClick={() => setEditingBus(bus)}
                        className="text-xs bg-blue-50 text-blue-600 font-bold px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                      >
                        상세 수정
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div><span className="text-slate-400 inline-block w-16">호차:</span> {bus.busNumber || '미지정'}</div>
                      <div><span className="text-slate-400 inline-block w-16">차량번호:</span> {bus.plateNumber || '미등록'}</div>
                      <div><span className="text-slate-400 inline-block w-16">기사님:</span> {bus.driverName || '미지정'}</div>
                      <div><span className="text-slate-400 inline-block w-16">교사님:</span> {bus.teacherName || '미지정'}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'students' && (
          <div className="p-4 h-full flex flex-col">
            <h2 className="text-lg font-bold text-slate-800 mb-1 text-center">원아 정보</h2>
            <p className="text-xs text-slate-500 mb-3 text-center">
              원아를 직접 추가하거나 엑셀 파일로 일괄 등록 및 다운로드할 수 있습니다.
            </p>

            <input 
              type="file" 
              accept=".xlsx, .xls" 
              className="hidden" 
              ref={fileInputRef} 
              onChange={handleStudentUpload} 
            />

            {/* Primary Action Button: 원생 추가 */}
            <button
              onClick={() => setShowAddStudentModal(true)}
              className="w-full py-2.5 px-3 mb-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-xs sm:text-sm active:scale-[0.99]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              원아 추가
            </button>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="w-full py-2.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl border border-slate-200 transition-colors disabled:opacity-50 text-center text-xs sm:text-sm flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                </svg>
                {isProcessing ? '처리 중...' : '원아 엑셀 업로드'}
              </button>
              
              <button 
                onClick={handleExportExcel}
                disabled={isProcessing}
                className="w-full py-2.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-sm transition-colors disabled:opacity-50 text-center text-xs sm:text-sm flex items-center justify-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {isProcessing ? '준비 중...' : '엑셀 다운로드'}
              </button>
            </div>

            <a 
              href="/원아_정보_입력_시트.xlsx" 
              download="원아_정보_입력_시트.xlsx" 
              className="w-full py-2 mb-3 bg-white text-slate-600 rounded-xl text-xs font-semibold border border-slate-200 shadow-xs hover:bg-slate-50 transition-colors text-center flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              원아 등록 양식 다운로드
            </a>

            {students.length > 0 ? (
              <div className="mt-1 flex-1 flex flex-col min-h-0">
                {/* Header with Title and Count */}
                <div className="flex justify-between items-center mb-2 border-b pb-1.5 shrink-0">
                  <h3 className="font-bold text-slate-700 text-xs">등록 원아 목록</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      총 {students.length}명
                    </span>
                  </div>
                </div>

                {/* Filter Mode Selector: 전체 / 반별 / 연령별 / 차량별 */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl mb-2 shrink-0 text-xs font-bold">
                  <button 
                    type="button" 
                    onClick={() => setStudentFilterMode('ALL')} 
                    className={`py-1.5 rounded-lg transition-all text-center ${studentFilterMode === 'ALL' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    전체
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setStudentFilterMode('CLASS')} 
                    className={`py-1.5 rounded-lg transition-all text-center ${studentFilterMode === 'CLASS' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    반별
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setStudentFilterMode('AGE')} 
                    className={`py-1.5 rounded-lg transition-all text-center ${studentFilterMode === 'AGE' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    연령별
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setStudentFilterMode('BUS')} 
                    className={`py-1.5 rounded-lg transition-all text-center ${studentFilterMode === 'BUS' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    차량별
                  </button>
                </div>

                {/* Group Accordion Controls (when not ALL) */}
                {studentFilterMode !== 'ALL' && (
                  <div className="flex justify-between items-center px-1 mb-1.5 shrink-0">
                    <span className="text-[11px] font-bold text-slate-500">
                      {studentFilterMode === 'CLASS' && '반별 분류'}
                      {studentFilterMode === 'AGE' && '연령별 분류'}
                      {studentFilterMode === 'BUS' && '차량별 분류'}
                    </span>
                    <button 
                      type="button"
                      onClick={handleToggleAllGroups}
                      className="text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-0.5"
                    >
                      {getGroupedStudents().some(g => collapsedGroups[g.key]) ? '+ 모두 펼치기' : '− 모두 접기'}
                    </button>
                  </div>
                )}

                {/* Students Content Area */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {studentFilterMode === 'ALL' ? (
                    // Flat List with Student Detail Toggle (+)
                    students.map(st => {
                      const isExpanded = expandedStudentDetailIds.has(st.id);
                      const bus = buses.find(b => b.id === st.assignedBusId);
                      return (
                        <div key={st.id} className="p-2.5 bg-white border border-slate-200 rounded-xl shadow-xs hover:shadow-md transition-all group">
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st.color || bus?.color || '#64748b' }}></div>
                              <span className="font-bold text-slate-800 text-xs shrink-0">{st.name}</span>
                              <div className="flex items-center gap-1 overflow-hidden truncate">
                                {st.raw?.['반명'] && (
                                  <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-1.5 py-0.5 rounded border border-blue-100 shrink-0">
                                    {st.raw['반명']}
                                  </span>
                                )}
                                {(st.raw?.['연령'] !== undefined && st.raw?.['연령'] !== null ? st.raw['연령'] : st.raw?.['학년']) && (
                                  <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                    {st.raw['연령'] !== undefined && st.raw['연령'] !== null ? st.raw['연령'] : st.raw['학년']}
                                  </span>
                                )}
                                {st.raw?.['하원구분'] && (
                                  <span className="text-[10px] bg-amber-50 text-amber-700 font-semibold px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                                    {st.raw['하원구분']}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-1">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); toggleStudentDetail(st.id); }}
                                className="w-5 h-5 flex items-center justify-center rounded-md bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-black transition-colors"
                                title={isExpanded ? '상세 접기' : '상세 정보 펼쳐보기 (+)'}
                              >
                                {isExpanded ? '−' : '+'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteStudent(st); }}
                                className="text-slate-300 hover:text-red-500 p-0.5 rounded transition-colors opacity-80 group-hover:opacity-100"
                                title="원아 삭제"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            </div>
                          </div>

                          <div className="text-xs text-slate-600 truncate mb-1" title={st.address}>
                            {st.address}
                          </div>

                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 text-[11px]">
                              {st.raw?.['보호자 성함'] ? `${st.raw?.['보호자 성함']} ` : ''}
                              {maskPhoneNumber(st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['보호자 연락처'])}
                            </span>
                            <span className="font-bold text-[11px] px-2 py-0.5 rounded-md" style={{ color: st.color || bus?.color || '#64748b', backgroundColor: `${st.color || bus?.color || '#64748b'}15` }}>
                              {bus ? bus.name : '배정 대기'}
                            </span>
                          </div>

                          {/* Expandable Details via (+) */}
                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-[11px] text-slate-600 space-y-1 bg-slate-50/70 p-2 rounded-lg animate-fade-in">
                              {st.raw?.['유치원명'] && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">소속 유치원:</span>
                                  <span className="font-semibold text-slate-700">{st.raw['유치원명']}</span>
                                </div>
                              )}
                              {(st.boardingLocation || st.raw?.['등원지']) && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">등원지:</span>
                                  <span className="font-semibold text-slate-700 truncate max-w-[150px]">{st.raw?.['등원지'] || st.boardingLocation}</span>
                                </div>
                              )}
                              {st.raw?.['하원지'] && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">하원지:</span>
                                  <span className="font-semibold text-slate-700 truncate max-w-[150px]">{st.raw['하원지']}</span>
                                </div>
                              )}
                              {(st.raw?.['등원시간'] || st.raw?.['하원시간']) && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">등/하원시간:</span>
                                  <span className="font-semibold text-slate-700">{st.raw?.['등원시간'] || '-'} / {st.raw?.['하원시간'] || '-'}</span>
                                </div>
                              )}
                              {st.raw?.['담임명'] && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">담임 교사:</span>
                                  <span className="font-semibold text-slate-700">{st.raw['담임명']}</span>
                                </div>
                              )}
                              {st.raw?.['비고'] && (
                                <div className="flex justify-between">
                                  <span className="text-slate-400">비고:</span>
                                  <span className="font-semibold text-slate-700 truncate max-w-[160px]">{st.raw['비고']}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    // Grouped Accordion List (반별, 연령별, 차량별)
                    getGroupedStudents().map(group => {
                      const isCollapsed = Boolean(collapsedGroups[group.key]);
                      return (
                        <div key={group.key} className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-xs">
                          <div 
                            onClick={() => toggleGroupCollapse(group.key)}
                            className="p-2.5 bg-slate-50 hover:bg-slate-100 flex items-center justify-between cursor-pointer transition-colors border-b border-slate-100 select-none"
                          >
                            <div className="flex items-center gap-2">
                              {group.bus && (
                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: group.bus.color }}></div>
                              )}
                              <span className="text-xs font-bold text-slate-800">{group.name}</span>
                              <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                {group.list.length}명
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-slate-400">
                                {isCollapsed ? '펼치기' : '접기'}
                              </span>
                              <span className="w-5 h-5 flex items-center justify-center rounded-md bg-white border border-slate-200 text-xs font-black text-slate-600 shadow-2xs">
                                {isCollapsed ? '+' : '−'}
                              </span>
                            </div>
                          </div>

                          {!isCollapsed && (
                            <div className="p-2 space-y-2 bg-slate-50/40">
                              {group.list.length === 0 ? (
                                <div className="text-[11px] text-slate-400 text-center py-2">배정된 원아가 없습니다.</div>
                              ) : (
                                group.list.map(st => {
                                  const isExpanded = expandedStudentDetailIds.has(st.id);
                                  const bus = buses.find(b => b.id === st.assignedBusId);
                                  return (
                                    <div key={st.id} className="p-2.5 bg-white border border-slate-200 rounded-xl shadow-xs hover:shadow-md transition-all group">
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st.color || bus?.color || '#64748b' }}></div>
                                          <span className="font-bold text-slate-800 text-xs shrink-0">{st.name}</span>
                                          <div className="flex items-center gap-1 overflow-hidden truncate">
                                            {studentFilterMode !== 'CLASS' && st.raw?.['반명'] && (
                                              <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-1.5 py-0.5 rounded border border-blue-100 shrink-0">
                                                {st.raw['반명']}
                                              </span>
                                            )}
                                            {studentFilterMode !== 'AGE' && (st.raw?.['연령'] !== undefined && st.raw?.['연령'] !== null ? st.raw['연령'] : st.raw?.['학년']) && (
                                              <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                                {st.raw['연령'] !== undefined && st.raw['연령'] !== null ? st.raw['연령'] : st.raw['학년']}
                                              </span>
                                            )}
                                            {st.raw?.['하원구분'] && (
                                              <span className="text-[10px] bg-amber-50 text-amber-700 font-semibold px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                                                {st.raw['하원구분']}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-1">
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); toggleStudentDetail(st.id); }}
                                            className="w-5 h-5 flex items-center justify-center rounded-md bg-blue-50 hover:bg-blue-100 text-blue-600 text-xs font-black transition-colors"
                                            title={isExpanded ? '상세 접기' : '상세 정보 펼쳐보기 (+)'}
                                          >
                                            {isExpanded ? '−' : '+'}
                                          </button>
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteStudent(st); }}
                                            className="text-slate-300 hover:text-red-500 p-0.5 rounded transition-colors opacity-80 group-hover:opacity-100"
                                            title="원아 삭제"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                          </button>
                                        </div>
                                      </div>

                                      <div className="text-xs text-slate-600 truncate mb-1" title={st.address}>
                                        {st.address}
                                      </div>

                                      <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-400 text-[11px]">
                                          {st.raw?.['보호자 성함'] ? `${st.raw?.['보호자 성함']} ` : ''}
                                          {maskPhoneNumber(st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['보호자 연락처'])}
                                        </span>
                                        {studentFilterMode !== 'BUS' && (
                                          <span className="font-bold text-[11px] px-2 py-0.5 rounded-md" style={{ color: st.color || bus?.color || '#64748b', backgroundColor: `${st.color || bus?.color || '#64748b'}15` }}>
                                            {bus ? bus.name : '배정 대기'}
                                          </span>
                                        )}
                                      </div>

                                      {/* Expandable Details via (+) */}
                                      {isExpanded && (
                                        <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-[11px] text-slate-600 space-y-1 bg-slate-50/70 p-2 rounded-lg animate-fade-in">
                                          {st.raw?.['유치원명'] && (
                                            <div className="flex justify-between">
                                              <span className="text-slate-400">소속 유치원:</span>
                                              <span className="font-semibold text-slate-700">{st.raw['유치원명']}</span>
                                            </div>
                                          )}
                                          {(st.boardingLocation || st.raw?.['등원지']) && (
                                            <div className="flex justify-between">
                                              <span className="text-slate-400">등원지:</span>
                                              <span className="font-semibold text-slate-700 truncate max-w-[150px]">{st.raw?.['등원지'] || st.boardingLocation}</span>
                                            </div>
                                          )}
                                          {st.raw?.['하원지'] && (
                                            <div className="flex justify-between">
                                              <span className="text-slate-400">하원지:</span>
                                              <span className="font-semibold text-slate-700 truncate max-w-[150px]">{st.raw['하원지']}</span>
                                            </div>
                                          )}
                                          {(st.raw?.['등원시간'] || st.raw?.['하원시간']) && (
                                            <div className="flex justify-between">
                                              <span className="text-slate-400">등/하원시간:</span>
                                              <span className="font-semibold text-slate-700">{st.raw?.['등원시간'] || '-'} / {st.raw?.['하원시간'] || '-'}</span>
                                            </div>
                                          )}
                                          {st.raw?.['담임명'] && (
                                            <div className="flex justify-between">
                                              <span className="text-slate-400">담임 교사:</span>
                                              <span className="font-semibold text-slate-700">{st.raw['담임명']}</span>
                                            </div>
                                          )}
                                          {st.raw?.['비고'] && (
                                            <div className="flex justify-between">
                                              <span className="text-slate-400">비고:</span>
                                              <span className="font-semibold text-slate-700 truncate max-w-[160px]">{st.raw['비고']}</span>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-2 flex-1 flex flex-col items-center justify-center text-center p-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <h4 className="font-bold text-slate-700 text-xs mb-1 text-center">등록된 원생이 없습니다</h4>
                <p className="text-[11px] text-slate-500 mb-3 text-center max-w-xs leading-relaxed">
                  [원생 추가] 버튼을 눌러 직접 등록하거나, 엑셀 파일을 업로드하여 구역에 맞추어 자동으로 배차해보세요.
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setShowAddStudentModal(true)}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 shadow-sm transition text-center"
                  >
                    원생 추가하기
                  </button>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm transition text-center"
                  >
                    엑셀 파일 업로드
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'classes' && (
          <div className="p-6 h-full flex flex-col">
            <h2 className="text-xl font-bold text-slate-800 mb-1">반 및 분반 관리</h2>
            <p className="text-xs text-slate-500 mb-4">
              학원원장이 새로운 반을 개설하고, 원아들을 드래그하여 반에 넣고 담당 담임교사를 배정할 수 있습니다.
            </p>

            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4 text-xs space-y-2">
              <div className="flex justify-between font-bold">
                <span className="text-blue-900">개설된 반:</span>
                <span className="text-blue-700">{availableClasses.length}개 반</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">전체 원아:</span>
                <span className="font-bold text-slate-800">{students.length}명</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-600">담임 교사:</span>
                <span className="font-bold text-slate-800">{teachers.filter(t => t.assignedClass).length}명 배정</span>
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-700">개설된 반 목록</h3>
                <span className="text-[11px] text-slate-400">총 {availableClasses.length}개</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {availableClasses.map(cls => {
                  const count = students.filter(st => (st.raw?.['반명'] || st.raw?.['반'] || '').trim() === cls.trim()).length;
                  const teacher = teachers.find(t => t.assignedClass && t.assignedClass.trim() === cls.trim());

                  return (
                    <div key={cls} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 hover:border-slate-300 transition-colors">
                      <div className="flex items-center justify-between font-bold text-xs text-slate-900">
                        <span>{cls}</span>
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[11px] font-black">{count}명</span>
                      </div>
                      <div className="text-[11px] text-slate-500 flex justify-between">
                        <span>담당 교사:</span>
                        <span className="font-semibold text-slate-700">{teacher ? `${teacher.name} 선생님` : '미배정'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'auth' && (
          <div className="p-6 h-full flex flex-col">
            <h2 className="text-xl font-bold text-slate-800 mb-6">원아·학부모 앱 가입 현황</h2>
            
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6 text-center shadow-sm">
              <h3 className="text-blue-800 font-bold mb-2">원 인증코드</h3>
              {academy?.authCode ? (
                <div className="text-3xl font-black text-blue-600 tracking-widest">{academy.authCode}</div>
              ) : (
                <div className="text-slate-500 mb-3 text-sm">현재 발급된 코드가 없습니다.</div>
              )}
              <button 
                onClick={handleGenerateAuthCode}
                disabled={isProcessing}
                className="mt-4 px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition shadow-sm text-sm"
              >
                {academy?.authCode ? '인증코드 재발급' : '인증코드 발급받기'}
              </button>
              <p className="text-xs text-blue-600/80 mt-3">학부모님들이 앱에 가입할 때 이 코드를 입력해야 합니다.</p>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex flex-col gap-2 mb-4">
                <h3 className="font-bold text-slate-700">전체 원생 ({students.length}명)</h3>
                <div className="flex flex-wrap gap-3 text-xs font-medium">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500"></span>승인 {students.filter(s => s.approvalStatus === 'APPROVED').length}명</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500"></span>대기 {students.filter(s => s.approvalStatus === 'PENDING').length}명</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300"></span>미가입 {students.filter(s => !s.approvalStatus || s.approvalStatus === 'UNREGISTERED').length}명</span>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {students.map(st => (
                  <div key={st.id} className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between gap-3 hover:border-slate-300 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-slate-800 flex items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 whitespace-nowrap">{st.name}</span>
                        {st.className && (
                          <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100 font-medium whitespace-nowrap shrink-0">
                            {st.className}
                          </span>
                        )}
                        {st.approvalStatus === 'APPROVED' ? (
                          <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full border border-green-200 font-bold whitespace-nowrap shrink-0">
                            승인완료
                          </span>
                        ) : st.approvalStatus === 'PENDING' ? (
                          <span className="text-[11px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full border border-orange-200 font-bold whitespace-nowrap shrink-0">
                            승인대기
                          </span>
                        ) : (
                          <span className="text-[11px] bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-200 font-medium whitespace-nowrap shrink-0">
                            미가입
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 mt-1 truncate" title={`${st.assignedBusId ? buses.find(b=>b.id===st.assignedBusId)?.name : '배정 안됨'} • ${st.address}`}>
                        <span className="font-medium text-slate-600">{st.assignedBusId ? buses.find(b=>b.id===st.assignedBusId)?.name : '배정 안됨'}</span>
                        {st.address && <span className="text-slate-400"> • {st.address}</span>}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1.5 shrink-0">
                      {st.approvalStatus === 'PENDING' && (
                        <>
                          <button onClick={() => handleApproveStudent(st.id)} className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-green-700 transition whitespace-nowrap shrink-0">승인</button>
                          <button onClick={() => handleRevokeStudent(st.id, true)} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200 transition whitespace-nowrap shrink-0">거절</button>
                        </>
                      )}
                      {st.approvalStatus === 'APPROVED' && (
                        <button onClick={() => handleRevokeStudent(st.id, false)} className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition whitespace-nowrap shrink-0">연동 해제</button>
                      )}
                    </div>
                  </div>
                ))}
                {students.length === 0 && (
                  <div className="text-center text-slate-400 py-10 text-sm">먼저 원생 명단을 업로드해주세요.</div>
                )}
              </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden mt-6">
              <div className="flex flex-col gap-2 mb-4">
                <h3 className="font-bold text-slate-700">차량 스태프 (기사/교사) 가입 현황</h3>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {buses.map(bus => (
                  <div key={bus.id} className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs flex flex-col gap-3">
                    <div className="font-bold text-slate-800 text-sm border-b pb-2">{bus.name} ({bus.plateNumber})</div>
                    
                    <div className="flex flex-col gap-2">
                      <div className="text-sm flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-500 text-xs w-14 shrink-0 whitespace-nowrap">기사님</span>
                          <span className="font-bold text-slate-800 whitespace-nowrap text-sm">{bus.driverName || '미지정'}</span>
                          {bus.driverApprovalStatus === 'APPROVED' ? (
                            <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full border border-green-200 font-bold whitespace-nowrap shrink-0">승인완료</span>
                          ) : bus.driverApprovalStatus === 'PENDING' ? (
                            <span className="text-[11px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full border border-orange-200 font-bold whitespace-nowrap shrink-0">승인대기</span>
                          ) : (
                            <span className="text-[11px] bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-200 font-medium whitespace-nowrap shrink-0">미가입</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {bus.driverApprovalStatus === 'PENDING' && (
                            <>
                              <button onClick={() => handleApproveStaff(bus.id, 'DRIVER')} className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-green-700 transition whitespace-nowrap shrink-0">승인</button>
                              <button onClick={() => handleRevokeStaff(bus.id, 'DRIVER', true)} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200 transition whitespace-nowrap shrink-0">거절</button>
                            </>
                          )}
                          {bus.driverApprovalStatus === 'APPROVED' && (
                            <button onClick={() => handleRevokeStaff(bus.id, 'DRIVER', false)} className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition whitespace-nowrap shrink-0">연동 해제</button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 pt-2.5 border-t border-slate-100">
                      <div className="text-sm flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-slate-500 text-xs w-14 shrink-0 whitespace-nowrap">지도교사</span>
                          <span className="font-bold text-slate-800 whitespace-nowrap text-sm">{bus.teacherName || '미지정'}</span>
                          {bus.teacherApprovalStatus === 'APPROVED' ? (
                            <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full border border-green-200 font-bold whitespace-nowrap shrink-0">승인완료</span>
                          ) : bus.teacherApprovalStatus === 'PENDING' ? (
                            <span className="text-[11px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full border border-orange-200 font-bold whitespace-nowrap shrink-0">승인대기</span>
                          ) : (
                            <span className="text-[11px] bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-full border border-slate-200 font-medium whitespace-nowrap shrink-0">미가입</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {bus.teacherApprovalStatus === 'PENDING' && (
                            <>
                              <button onClick={() => handleApproveStaff(bus.id, 'TEACHER')} className="px-3 py-1.5 bg-green-600 text-white text-xs font-bold rounded-lg shadow-sm hover:bg-green-700 transition whitespace-nowrap shrink-0">승인</button>
                              <button onClick={() => handleRevokeStaff(bus.id, 'TEACHER', true)} className="px-3 py-1.5 bg-slate-100 text-slate-600 text-xs font-bold rounded-lg hover:bg-slate-200 transition whitespace-nowrap shrink-0">거절</button>
                            </>
                          )}
                          {bus.teacherApprovalStatus === 'APPROVED' && (
                            <button onClick={() => handleRevokeStaff(bus.id, 'TEACHER', false)} className="px-3 py-1.5 border border-red-200 text-red-600 text-xs font-bold rounded-lg hover:bg-red-50 transition whitespace-nowrap shrink-0">연동 해제</button>
                          )}
                        </div>
                      </div>
                    </div>

                  </div>
                ))}
              </div>
            </div>

            {/* 유치원 담당 교사 가입 및 승인 현황 섹션 */}
            <div className="flex-1 flex flex-col overflow-hidden mt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-bold text-slate-700 text-base">유치원 교사 가입 및 승인 현황 ({teachers.length}명)</h3>
                  <p className="text-xs text-slate-500 mt-0.5">교사 계정의 가입 및 승인 상태를 확인합니다. 담당 반 분반 및 배정은 [반 관리] 메뉴에서 진행하세요.</p>
                </div>
                <button
                  onClick={fetchTeachers}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold flex items-center gap-1 transition shadow-sm"
                >
                  새로고침
                </button>
              </div>

              <div className="flex-1 overflow-y-auto overflow-x-hidden space-y-2.5 pr-1">
                {teachers.map(teacher => {
                  const currentClass = teacher.assignedClass;

                  return (
                    <div key={teacher.id} className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between gap-3 hover:border-slate-300 transition-colors">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-sm shrink-0 shadow-xs">
                          {teacher.name?.[0] || '교'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-800 text-sm whitespace-nowrap">{teacher.name} 선생님</span>
                            <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full font-bold border border-green-200 whitespace-nowrap shrink-0">
                              가입 승인됨
                            </span>
                            {currentClass && currentClass !== '미배정' ? (
                              <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md font-bold border border-blue-100 whitespace-nowrap shrink-0">
                                {currentClass} 담임
                              </span>
                            ) : (
                              <span className="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md font-medium border border-slate-200 whitespace-nowrap shrink-0">
                                반 미배정
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate" title={`${teacher.email}${teacher.phone ? ` • ${teacher.phone}` : ''}`}>
                            <span>{teacher.email}</span>
                            {teacher.phone && <span className="text-slate-400"> • {teacher.phone}</span>}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleTabChange('classes')}
                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg text-xs font-bold transition whitespace-nowrap shrink-0 shadow-2xs"
                      >
                        반 배정 이동
                      </button>
                    </div>
                  );
                })}

                {teachers.length === 0 && (
                  <div className="text-center text-slate-400 py-8 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    아직 가입된 유치원 교사가 없습니다.<br />
                    <span className="text-xs text-slate-400 mt-1 inline-block">교사가 회원가입 화면에서 '유치원 교사'를 선택하고 원 인증코드로 가입하면 여기에 표시됩니다.</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-6 h-full flex flex-col">
            <h2 className="text-xl font-bold text-slate-800 mb-6">환경설정</h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-100 transition-all">
                <h3 className="font-bold text-blue-700 mb-1">구역 맵핑(Zone) 수정</h3>
                <p className="text-xs text-blue-600 mb-3 opacity-80">지도에서 직접 각 호차의 배차 구역을 정밀하게 다듬습니다.</p>
                <button onClick={() => {
                  setIsZoneEditingMode(!isZoneEditingMode);
                  if (isZoneEditingMode) setEditingZoneBusId(null);
                }} className={`w-full py-2 bg-white rounded-lg text-sm font-bold border shadow-sm transition-colors ${isZoneEditingMode ? 'border-blue-600 text-blue-700 bg-blue-100' : 'text-blue-600 border-blue-200 hover:bg-blue-600 hover:text-white'}`}>
                  {isZoneEditingMode ? '구역 수정 모드 종료' : '구역 수정 모드 진입'}
                </button>
              </div>

              <div className="p-4 bg-red-50 rounded-xl border border-red-100 transition-all">
                <h3 className="font-bold text-red-700 mb-1">전년도 구역 초기화</h3>
                <p className="text-xs text-red-600 mb-3 opacity-80">현재 설정된 모든 버스와 배차 구역이 영구적으로 삭제됩니다.</p>
                
                {!isResettingZones ? (
                  <button onClick={() => setIsResettingZones(true)} className="w-full py-2 bg-white text-red-600 rounded-lg text-sm font-bold border border-red-200 shadow-sm hover:bg-red-600 hover:text-white transition-colors">
                    구역 리셋 모드 진입
                  </button>
                ) : (
                  <div className="space-y-3 mt-4 pt-4 border-t border-red-200">
                    <div className="p-3 bg-red-100/50 rounded-lg">
                      <p className="text-xs text-red-800 font-bold">💡 작성 안내</p>
                      <p className="text-xs text-red-700 mt-1">
                        다운로드한 양식에서 <b>하이라이트 표시된 필수 항목(등원지, 하원지, 차량)</b>만 채워주시면 됩니다. 해당 장소들을 바탕으로 자동으로 픽업/드랍 구역이 나뉩니다.
                      </p>
                    </div>
                    
                    <a href="/전년도_자료_입력_시트_양식.xlsx" download="전년도_자료_입력_시트_양식.xlsx" className="w-full py-2 bg-white text-slate-700 rounded-lg text-sm border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center font-medium">
                      ⬇️ 전년도 양식 다운로드
                    </a>
                    
                    <input type="file" accept=".xlsx, .xls" className="hidden" ref={resetFileInputRef} onChange={handleZoneResetUpload} />
                    <button 
                      onClick={() => resetFileInputRef.current.click()} 
                      disabled={isProcessing}
                      className="w-full py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      {isProcessing ? '초기화 및 지오코딩 중...' : '⬆️ 새 엑셀 업로드 및 리셋'}
                    </button>
                    
                    <button onClick={() => setIsResettingZones(false)} className="w-full py-2 mt-2 bg-transparent text-red-600 rounded-lg text-xs hover:underline">
                      취소
                    </button>
                  </div>
                )}
              </div>

              <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 transition-all">
                <h3 className="font-bold text-orange-700 mb-1">유치원 위치 변경</h3>
                <p className="text-xs text-orange-600 mb-3 opacity-80">유치원이 이전한 경우 새 주소와 이름을 입력하세요.</p>
                
                {!isChangingAcademy ? (
                  <button onClick={() => {
                    setAcademyChangeForm({ name: academy?.name || '', address: academy?.address || '' });
                    setIsChangingAcademy(true);
                  }} className="w-full py-2 bg-white text-orange-600 rounded-lg text-sm font-bold border border-orange-200 shadow-sm hover:bg-orange-600 hover:text-white transition-colors">
                    유치원 위치 변경 모드
                  </button>
                ) : (
                  <form onSubmit={handleChangeAcademySubmit} className="space-y-3 mt-4 pt-4 border-t border-orange-200">
                    <div>
                      <label className="block text-xs font-bold text-orange-800 mb-1">새 유치원명</label>
                      <input 
                        type="text" 
                        value={academyChangeForm.name} 
                        onChange={e => setAcademyChangeForm({...academyChangeForm, name: e.target.value})}
                        className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm outline-none"
                        placeholder="유치원명"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-orange-800 mb-1">새 원 주소 (도로명/지번)</label>
                      <input 
                        type="text" 
                        value={academyChangeForm.address} 
                        onChange={e => setAcademyChangeForm({...academyChangeForm, address: e.target.value})}
                        className="w-full px-3 py-2 bg-white border border-orange-200 rounded-lg text-sm outline-none"
                        placeholder="주소"
                        required
                      />
                    </div>
                    <button 
                      type="submit" 
                      disabled={isProcessing}
                      className="w-full py-2 bg-orange-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-orange-700 disabled:opacity-50 transition-colors"
                    >
                      {isProcessing ? '변경 중...' : '변경 완료'}
                    </button>
                    <button type="button" onClick={() => setIsChangingAcademy(false)} className="w-full py-2 mt-1 bg-transparent text-orange-600 rounded-lg text-xs hover:underline">
                      취소
                    </button>
                  </form>
                )}
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 mt-auto space-y-2">
                <h3 className="font-bold text-slate-700 mb-1">계정 관리</h3>
                <button 
                  onClick={handleLogout}
                  className="w-full py-2 bg-white text-slate-700 rounded-lg text-sm font-bold border border-slate-300 shadow-sm hover:bg-slate-100 transition-colors"
                >
                  로그아웃
                </button>
                <button 
                  onClick={handleDeleteAcademy}
                  disabled={isProcessing}
                  className="w-full py-2 bg-white text-slate-500 rounded-lg text-sm font-bold border border-slate-300 shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-colors"
                >
                  {isProcessing ? '처리 중...' : '유치원 데이터 삭제 및 탈퇴'}
                </button>
              </div>
              </div>
            </div>
        )}

          {activeTab === 'log' && (
            <div className="flex flex-col h-full">
              <div className="p-5 border-b border-slate-100 bg-white">
                <h2 className="text-xl font-black text-slate-800 mb-2 flex items-center gap-2">
                  <span>📅</span> 캘린더 및 로그
                </h2>
                <p className="text-sm text-slate-500 font-medium">원생의 출결과 로그를 확인하세요.</p>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <button onClick={() => setLogTab('LOG')} className={`w-full py-3 rounded-xl font-bold transition-all ${logTab === 'LOG' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>로그보기</button>
                <button onClick={() => setLogTab('ABSENCE')} className={`w-full py-3 rounded-xl font-bold transition-all ${logTab === 'ABSENCE' ? 'bg-red-500 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>원생 결석관리</button>
                <button onClick={() => setLogTab('HOLIDAY')} className={`w-full py-3 rounded-xl font-bold transition-all ${logTab === 'HOLIDAY' ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>🎉 휴업일 설정</button>
              </div>
            </div>
          )}

          {activeTab === 'documents' && (
            <DocumentSidebar 
              academyId={selectedAcademyId} 
              academyName={academy?.name}
              currentUser={currentUser}
              buses={buses}
              students={students}
            />
          )}

          {activeTab === 'board' && (
            <BoardSidebar 
              selectedClass={boardSelectedClass}
              setSelectedClass={setBoardSelectedClass}
              availableClasses={availableClasses}
              searchKeyword={boardSearchKeyword}
              setSearchKeyword={setBoardSearchKeyword}
              onOpenNewPost={() => setIsCreatingBoardPost(true)}
              posts={boardPosts}
            />
          )}
        </div>

      {/* Map Area */}
      <div className="flex-1 relative z-0 overflow-hidden">
        
        {activeTab === 'log' && (
          <LogViewer 
            buses={buses} 
            students={students}
            currentTab={logTab} 
            isClosing={isLogClosing}
          />
        )}

        {activeTab === 'messages' && (
          <MessagePanel 
            buses={buses} 
            students={students} 
            isClosing={isMessageClosing}
            msgSelectedBusId={msgSelectedBusId}
            msgTargetDriver={msgTargetDriver}
            msgTargetTeacher={msgTargetTeacher}
            msgTargetStudents={msgTargetStudents}
            resetSelections={() => {
              setMsgSelectedBusId(null);
              setMsgTargetDriver(false);
              setMsgTargetTeacher(false);
              setMsgTargetStudents([]);
            }}
          />
        )}

        {activeTab === 'documents' && (
          <DocumentManager 
            academyId={selectedAcademyId} 
            academyName={academy?.name}
            currentUser={currentUser}
            isClosing={isDocumentsClosing}
            buses={buses}
            students={students}
          />
        )}

        {activeTab === 'board' && (
          <BoardViewer 
            isClosing={isBoardClosing}
            currentUser={currentUser}
            selectedAcademyId={selectedAcademyId}
            availableClasses={availableClasses}
            selectedClass={boardSelectedClass}
            setSelectedClass={setBoardSelectedClass}
            searchKeyword={boardSearchKeyword}
            setSearchKeyword={setBoardSearchKeyword}
            isCreatingPost={isCreatingBoardPost}
            setIsCreatingPost={setIsCreatingBoardPost}
            posts={boardPosts}
            setPosts={setBoardPosts}
          />
        )}

        {activeTab === 'classes' && (
          <ClassManager 
            academyId={selectedAcademyId} 
            academy={academy}
            currentUser={currentUser}
            students={students}
            setStudents={setStudents}
            teachers={teachers}
            setTeachers={setTeachers}
            availableClasses={availableClasses}
            customClasses={customClasses}
            setCustomClasses={setCustomClasses}
            onRefreshData={refreshAllData}
            isClosing={isClassesClosing}
            onClose={() => handleTabChange('status')}
          />
        )}

        {/* Zone Editing Overlay */}
        {isZoneEditingMode && (
          <div className="absolute top-4 left-16 z-[1000] bg-white/95 backdrop-blur-sm p-4 rounded-2xl shadow-xl border border-blue-100 flex flex-col gap-3 min-w-[200px]">
            <h3 className="font-bold text-slate-800 text-sm">구역 수정할 호차 선택</h3>
            <div className="flex flex-col gap-1">
              {buses.map(bus => (
                <button
                  key={bus.id}
                  onClick={() => handleSelectEditBus(bus.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold transition-all ${editingZoneBusId === bus.id ? 'bg-blue-50 border-blue-200 shadow-inner text-blue-800' : 'hover:bg-slate-50 border-transparent text-slate-600'} border`}
                >
                  <span className="w-3 h-3 rounded-full shadow-sm" style={{ backgroundColor: bus.color }}></span>
                  {bus.name}
                </button>
              ))}
            </div>
            {editingZoneBusId && (
              <div className="mt-1 pt-3 border-t border-slate-200 flex flex-col gap-2">
                <button 
                  onClick={() => setIsAddingPoint(!isAddingPoint)}
                  className={`w-full py-2.5 rounded-lg text-xs font-bold transition-colors ${isAddingPoint ? 'bg-blue-600 text-white shadow-inner' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {isAddingPoint ? '지도 빈곳 클릭 시 점 추가' : '+ 새 꼭짓점 추가'}
                </button>
                <button 
                  onClick={handleSavePolygon}
                  disabled={isProcessing}
                  className="w-full py-2.5 bg-green-600 text-white rounded-lg text-xs font-bold shadow-md hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {isProcessing ? '저장 중...' : '✅ 수정 내역 저장'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Top-Right Controls: SuperAdmin Switcher & Day Filter & Logout */}
        <div className="absolute top-4 right-4 z-[1000] flex items-center gap-2">
          {isSuperAdmin && (
            <div className="flex items-center gap-2 bg-indigo-700 text-white px-3 py-1.5 rounded-lg shadow-lg text-xs font-bold border border-indigo-500">
              <span className="whitespace-nowrap">유치원 선택:</span>
              <select
                value={selectedAcademyId || ''}
                onChange={(e) => handleSwitchAcademy(Number(e.target.value))}
                className="bg-white text-slate-800 px-2 py-1 rounded font-bold text-xs outline-none cursor-pointer"
              >
                {allAcademies.map(ac => (
                  <option key={ac.id} value={ac.id}>
                    {ac.name} ({ac.vehicleCount}대 / {ac.studentCount}명)
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex bg-white rounded-lg shadow-lg border border-slate-200 overflow-hidden text-sm font-bold">
            {[
              { id: 'ALL', label: '전체' },
              { id: 'MON', label: '월' },
              { id: 'TUE', label: '화' },
              { id: 'WED', label: '수' },
              { id: 'THU', label: '목' },
              { id: 'FRI', label: '금' },
              { id: 'SAT', label: '토' },
              { id: 'SUN', label: '일' },
            ].map(day => (
              <button
                key={day.id}
                onClick={() => setSelectedDay(day.id)}
                className={`px-3 py-2 transition-colors ${selectedDay === day.id ? 'bg-blue-600 text-white' : 'hover:bg-slate-50 text-slate-700 border-l first:border-l-0 border-slate-200'}`}
              >
                {day.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleLogout}
            className="px-3 py-2 bg-white text-slate-700 hover:text-red-600 rounded-lg shadow-lg border border-slate-200 text-xs font-bold transition-colors whitespace-nowrap"
            title="로그아웃"
          >
            로그아웃
          </button>
        </div>

        <MapContainer 
          center={academy && !isNaN(academy.lat) && !isNaN(academy.lng) ? [academy.lat, academy.lng] : [37.5650, 126.9750]} 
          zoom={14} 
          className="w-full h-full"
          key={academy && !isNaN(academy.lat) && !isNaN(academy.lng) ? `${academy.lat}-${academy.lng}` : 'default-map'} // Re-center map when academy updates
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <MapBoundsFit buses={buses} academy={academy} />

          {/* Draw Academy Marker */}
          {academy && !isNaN(academy.lat) && !isNaN(academy.lng) && (
            <Marker position={[academy.lat, academy.lng]} icon={academyIcon}>
              <Popup>
                <div className="font-bold text-lg text-center text-blue-700">{academy.name}</div>
                <div className="text-xs text-slate-500 mt-1">{academy.address}</div>
              </Popup>
            </Marker>
          )}
          
          <ZoneEditEvents isAddingPoint={isAddingPoint} onAddPoint={handleAddPoint} />
          <PickupPointEvents isAddingPickupPoint={isAddingPickupPoint} onAddPickupPoint={handleAddPickupPoint} />

          {/* Draw Pickup Points */}
          {showPickupPoints && (() => {
            const allPickupPoints = [];
            const uniqueNames = new Set();
            
            pickupPoints.forEach(p => {
              uniqueNames.add(p.name);
              allPickupPoints.push({ ...p, isDb: true });
            });

            students.forEach(st => {
              const locName = st.boardingLocation || st.address;
              if (locName && st.lat && st.lng && !uniqueNames.has(locName)) {
                uniqueNames.add(locName);
                allPickupPoints.push({
                  id: `st-${st.id}`,
                  name: locName,
                  latitude: st.lat,
                  longitude: st.lng
                });
              }
            });

            const visiblePickupPoints = allPickupPoints.filter(p => {
              if (selectedBusId) {
                const bus = buses.find(b => b.id === selectedBusId);
                if (!bus) return false;
                const poly = (isZoneEditingMode && editingZoneBusId === bus.id) ? editingPolygon : bus.polygon;
                if (!poly || poly.length < 3) return false;
                
                try {
                  const coords = poly.map(coord => [coord[1], coord[0]]);
                  coords.push(coords[0]); // close polygon
                  const polygon = turf.polygon([coords]);
                  const pt = turf.point([p.longitude, p.latitude]);
                  return turf.booleanPointInPolygon(pt, polygon);
                } catch (e) {
                  return false;
                }
              }
              return true;
            });

            return visiblePickupPoints.map(p => {
            const ptIcon = L.divIcon({
              className: 'pickup-marker',
              html: `<div style="font-size: 24px; text-shadow: 1px 1px 2px rgba(0,0,0,0.3);">🚏</div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 24]
            });
            return (
              <Marker key={`pickup-${p.id}`} position={[p.latitude, p.longitude]} icon={ptIcon}>
                <Popup>
                  <div className="text-left p-1 w-40 max-h-48 overflow-y-auto">
                    <div className="font-bold text-sm text-slate-800 border-b pb-1 mb-1">{p.name}</div>
                    
                    <div className="text-xs text-slate-600 mb-2">
                      <div className="font-bold text-slate-500 mb-1">
                        탑승원아 ({(() => {
                          const boardingStudents = students.filter(st => (st.boardingLocation || st.address) === p.name);
                          return boardingStudents.length;
                        })()}명)
                      </div>
                      {(() => {
                        const boardingStudents = students.filter(st => (st.boardingLocation || st.address) === p.name);
                        if (boardingStudents.length > 0) {
                          return (
                            <ul className="list-disc pl-4 space-y-0.5">
                              {boardingStudents.map(st => <li key={st.id}>{st.name}</li>)}
                            </ul>
                          );
                        } else {
                          return <span className="text-slate-400">없음</span>;
                        }
                      })()}
                    </div>
                    
                    {p.isDb && (
                      <div className="text-right border-t pt-1 mt-1">
                        <button onClick={() => handleDeletePickupPoint(p.id)} className="w-full py-1 bg-red-50 text-red-600 border border-red-200 text-xs font-bold rounded shadow-sm hover:bg-red-500 hover:text-white transition-colors">삭제</button>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })})()}
          
          {/* Draw Convex Hull Polygon */}
          {(selectedBusId ? buses.filter(b => b.id === selectedBusId) : buses).map(bus => {
            const isEditingThis = isZoneEditingMode && editingZoneBusId === bus.id;
            const polygonPoints = isEditingThis ? editingPolygon : bus.polygon;
            
            return (
            <Fragment key={bus.id}>
              {polygonPoints && polygonPoints.length > 0 ? (
                <>
                  <Polygon 
                    positions={polygonPoints} 
                    pathOptions={{ 
                      color: bus.color, 
                      fillColor: bus.color, 
                      fillOpacity: isEditingThis ? 0.1 : 0.3,
                      weight: isEditingThis ? 3 : 2,
                      dashArray: isEditingThis ? '5, 10' : null
                    }} 
                  />
                  {isEditingThis && polygonPoints.map((pt, i) => {
                    const editIcon = L.divIcon({
                      className: 'edit-marker',
                      html: `<div style="background-color: white; width: 16px; height: 16px; border-radius: 50%; border: 4px solid ${bus.color}; box-shadow: 0 2px 4px rgba(0,0,0,0.3); cursor: move;"></div>`,
                      iconSize: [16, 16],
                      iconAnchor: [8, 8]
                    });
                    return (
                      <Marker 
                        key={`edit-pt-${i}`} 
                        position={pt} 
                        icon={editIcon}
                        draggable={true}
                        eventHandlers={{
                          dragend: (e) => handleDragEndPoint(i, e)
                        }}
                      >
                        <Popup>
                          <div className="text-center p-1">
                            <p className="text-xs text-slate-500 mb-2">이 꼭짓점을 지우시겠습니까?</p>
                            <button onClick={() => handleDeletePoint(i)} className="px-3 py-1 bg-red-500 text-white text-xs font-bold rounded shadow-sm hover:bg-red-600">삭제</button>
                          </div>
                        </Popup>
                      </Marker>
                    );
                  })}
                </>
              ) : (
                /* Fallback markers if polygon cannot be formed */
                !isEditingThis && bus.points && bus.points.map((pt, i) => {
                  const fallbackIcon = L.divIcon({
                    className: 'fallback-marker',
                    html: `<div style="background-color: ${bus.color}; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold;">${bus.name.replace(/[^0-9]/g, '')}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                  });
                  return (
                    <Marker key={i} position={pt} icon={fallbackIcon}>
                      <Popup><b style={{color: bus.color}}>{bus.name}</b><br/>구역(도형)을 생성하려면 최소 3개 이상의 다른 위치가 필요합니다.</Popup>
                    </Marker>
                  );
                })
              )}
            </Fragment>
          )})}

          {/* Draw New Students */}
          {(selectedBusId ? students.filter(s => s.assignedBusId === selectedBusId) : students).map(st => {
            let displayLat = st.lat;
            let displayLng = st.lng;
            let displayBusId = st.assignedBusId;
            let showStudent = true;

            if (selectedDay !== 'ALL') {
              // Check if they have a schedule for this day
              const sched = st.schedules?.find(s => s.dayOfWeek === selectedDay);
              if (sched && sched.latitude && sched.longitude) {
                displayLat = sched.latitude;
                displayLng = sched.longitude;
                displayBusId = sched.assignedVehicle ? sched.assignedVehicle.id : null;
              } else if (!st.lat || !st.lng) {
                showStudent = false; // no fallback and no schedule
              }
            }
            
            if (!showStudent || !displayLat || !displayLng) return null;

            const stColor = displayBusId ? (buses.find(b=>b.id===displayBusId)?.color || '#64748b') : '#64748b';

            const studentIcon = L.divIcon({
              className: 'custom-student-marker',
              html: `<div style="background-color: ${stColor}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4);"></div>`,
              iconSize: [14, 14],
              iconAnchor: [7, 7]
            });
            return (
              <Marker key={st.id} position={[displayLat, displayLng]} icon={studentIcon}>
                <Popup className="student-popup">
                <div className="font-bold text-lg mb-1">{st.name} <span className="text-sm font-normal text-slate-500">{st.raw?.['성별']} / {st.raw?.['연령'] || st.raw?.['학년'] || ''}</span></div>
                <div className="text-sm text-slate-700 mb-2">{st.raw?.['유치원명'] || st.raw?.['학교명']} {st.raw?.['반명'] ? `(${st.raw?.['반명']})` : ''} {st.raw?.['하원구분'] ? `[${st.raw?.['하원구분']}]` : ''}</div>
                
                <div className="bg-slate-50 p-2 rounded border border-slate-100 text-xs mb-2">
                  <div className="mb-1"><b>주소:</b> {st.address}</div>
                  <div className="mb-1"><b>학부모:</b> {st.raw?.['보호자 성함']} ({maskPhoneNumber(st.raw?.['보호자연락처'])})</div>
                  <div><b>담임:</b> {st.raw?.['담임명']}</div>
                </div>
                
                <div className="text-sm font-bold text-center p-2 rounded" style={{ backgroundColor: stColor + '20', color: stColor }}>
                  {displayBusId ? `배차: ${buses.find(b=>b.id===displayBusId)?.name}` : '배차 없음 (구역 밖)'}
                </div>
              </Popup>
            </Marker>
            );
          })}

          {/* Draw Real-Time Bus Locations */}
          {Object.entries(busLocations).map(([vid, loc]) => {
            const bus = buses.find(b => b.id.toString() === vid.toString());
            if (!bus || (selectedBusId && bus.id !== selectedBusId)) return null;
            const busIcon = L.divIcon({
              className: 'custom-bus-marker',
              html: `<div style="background-color: ${bus.color || '#ef4444'}; font-size: 14px; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2px solid white; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">🚌</div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            });
            return (
              <Marker key={`realtime-bus-${vid}`} position={[loc.lat, loc.lng]} icon={busIcon}>
                <Popup className="font-bold">{bus.name} 실시간 위치</Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
            {/* Student Addition Modal */}
      {showAddStudentModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-fade-in border border-slate-100">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-lg font-bold text-slate-800">원아 직접 추가</h3>
                <p className="text-xs text-slate-500 mt-0.5">유치원 엑셀 양식 항목을 작성하여 원아를 등록합니다. (추가 시 차량 구역 자동 확장)</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStudentModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddStudentSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Section 1: 유치원 및 원아 기본 정보 */}
              <div>
                <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                  기본 인적사항
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      원아 이름 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="예: 김민수"
                      value={studentForm.name}
                      onChange={e => setStudentForm({ ...studentForm, name: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">성별</label>
                    <select
                      value={studentForm.gender}
                      onChange={e => setStudentForm({ ...studentForm, gender: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="남">남</option>
                      <option value="여">여</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">연령</label>
                    <input
                      type="text"
                      placeholder="예: 만 4세 (6세반)"
                      value={studentForm.age}
                      onChange={e => setStudentForm({ ...studentForm, age: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">소속 유치원명</label>
                    <input
                      type="text"
                      placeholder={academy?.name || '예: 해솔유치원'}
                      value={studentForm.kindergartenName}
                      onChange={e => setStudentForm({ ...studentForm, kindergartenName: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">반명</label>
                    <input
                      type="text"
                      placeholder="예: 햇살반, 열매반"
                      value={studentForm.className}
                      onChange={e => setStudentForm({ ...studentForm, className: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">담임명</label>
                    <input
                      type="text"
                      placeholder="예: 박선생님"
                      value={studentForm.teacherName}
                      onChange={e => setStudentForm({ ...studentForm, teacherName: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: 보호자 및 하원 구분 */}
              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                  보호자 및 하원 구분
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">보호자 성함</label>
                    <input
                      type="text"
                      placeholder="예: 김영희"
                      value={studentForm.parentName}
                      onChange={e => setStudentForm({ ...studentForm, parentName: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">부모연락처</label>
                    <input
                      type="text"
                      placeholder="010-0000-0000"
                      value={studentForm.parentPhone}
                      onChange={e => setStudentForm({ ...studentForm, parentPhone: formatPhoneNumber(e.target.value) })}
                      maxLength={13}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">하원구분</label>
                    <select
                      value={studentForm.departureType}
                      onChange={e => setStudentForm({ ...studentForm, departureType: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="정규하원">정규하원</option>
                      <option value="방과후하원">방과후하원</option>
                      <option value="종일반하원">종일반하원</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Section 3: 주소 및 탑승 장소 */}
              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                  주소 및 승하차 위치
                </h4>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    도로명 주소 <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="주소 검색 버튼을 눌러 도로명 주소를 선택하세요"
                      value={studentForm.address}
                      onChange={e => setStudentForm({ ...studentForm, address: e.target.value })}
                      className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSearchAddress}
                      className="px-3.5 py-2 bg-slate-800 text-white text-xs font-semibold rounded-lg hover:bg-slate-700 transition shrink-0 shadow-xs"
                    >
                      주소 검색
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      등원지 (미입력 시 도로명 주소 적용)
                    </label>
                    <input
                      type="text"
                      placeholder="예: 101동 앞 정문"
                      value={studentForm.inLocation}
                      onChange={e => setStudentForm({ ...studentForm, inLocation: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      하원지 (미입력 시 도로명 주소 적용)
                    </label>
                    <input
                      type="text"
                      placeholder="예: 101동 앞 정문"
                      value={studentForm.outLocation}
                      onChange={e => setStudentForm({ ...studentForm, outLocation: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: 배차 및 시간 */}
              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                  배차 및 운행 일정
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">배정 차량</label>
                    <select
                      value={studentForm.assignedBusId}
                      onChange={e => setStudentForm({ ...studentForm, assignedBusId: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                    >
                      <option value="">자동 배정 (구역 기반)</option>
                      {buses.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">등원 시간</label>
                    <input
                      type="text"
                      placeholder="예: 08:30"
                      value={studentForm.inTime}
                      onChange={e => setStudentForm({ ...studentForm, inTime: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">하원 시간</label>
                    <input
                      type="text"
                      placeholder="예: 17:00"
                      value={studentForm.outTime}
                      onChange={e => setStudentForm({ ...studentForm, outTime: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">비고</label>
                  <input
                    type="text"
                    placeholder="특이사항, 승하차 유의사항 등"
                    value={studentForm.note}
                    onChange={e => setStudentForm({ ...studentForm, note: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddStudentModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isProcessing}
                  className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>등록 중...</span>
                    </>
                  ) : (
                    <span>원생 등록하기</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

{/* Bus Editing Modal */}
      {editingBus && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold text-slate-800 mb-6">{editingBus.name} 상세 정보 수정</h2>
            <form onSubmit={handleUpdateBus} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">호차</label>
                  <input type="text" value={editingBus.busNumber || ''} onChange={e => setEditingBus({...editingBus, busNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="예: 1호차" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">차량번호</label>
                  <input type="text" value={editingBus.plateNumber || ''} onChange={e => setEditingBus({...editingBus, plateNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="예: 12가 3456" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">기사님 성함</label>
                  <input type="text" value={editingBus.driverName || ''} onChange={e => setEditingBus({...editingBus, driverName: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="기사님 이름" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">기사님 연락처</label>
                  <input type="text" value={editingBus.driverPhone || ''} onChange={e => setEditingBus({...editingBus, driverPhone: formatPhoneNumber(e.target.value)})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="010-0000-0000" maxLength={13} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">지도교사님 성함</label>
                  <input type="text" value={editingBus.teacherName || ''} onChange={e => setEditingBus({...editingBus, teacherName: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="교사 이름" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">지도교사 연락처</label>
                  <input type="text" value={editingBus.teacherPhone || ''} onChange={e => setEditingBus({...editingBus, teacherPhone: formatPhoneNumber(e.target.value)})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="010-0000-0000" maxLength={13} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">차량 정원 (명)</label>
                <input type="number" value={editingBus.capacity || 25} onChange={e => setEditingBus({...editingBus, capacity: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="25" />
              </div>
              <div className="flex gap-3 mt-6">
                <button type="button" onClick={() => setEditingBus(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">취소</button>
                <button type="submit" disabled={isProcessing} className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-50">저장하기</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
