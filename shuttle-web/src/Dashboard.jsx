import React, { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
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
import AuthViewer from './auth/AuthViewer';


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

// 사업자 등록번호 10자리 자동 하이픈 포맷터 (000-00-00000)
const formatBusinessNumber = (value) => {
  if (!value) return '';
  const nums = value.replace(/\D/g, '').slice(0, 10);
  if (nums.length <= 3) return nums;
  if (nums.length <= 5) return `${nums.slice(0, 3)}-${nums.slice(3)}`;
  return `${nums.slice(0, 3)}-${nums.slice(3, 5)}-${nums.slice(5, 10)}`;
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

function MapFocusEffect({ target }) {
  const map = useMap();
  useEffect(() => {
    if (target && target[0] && target[1]) {
      map.setView(target, 16, { animate: true });
    }
  }, [target, map]);
  return null;
}

export default function Dashboard({ initialEducationLevel } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // 현재 교육 부문 (유치원, 초등부, 중,고등부)
  const activeEducationLevel = useMemo(() => {
    if (location.pathname.includes('/elementary')) return '초등부';
    if (location.pathname.includes('/middle-high')) return '중,고등부';
    if (location.pathname.includes('/kindergarten')) return '유치원';
    return initialEducationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  }, [location.pathname, initialEducationLevel]);

  // Multi-tenant User Context
  const currentUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('takeme_user') || '{}');
    } catch (e) {
      return {};
    }
  })();
  const isAuthenticated = Boolean(currentUser && currentUser.id && currentUser.role);
  const isTeacherRole = currentUser.role === 'TEACHER' || currentUser.role === 'HOMEROOM_TEACHER' || currentUser.role === 'SHUTTLE_TEACHER';
  const isWebAdmin = currentUser.role === 'ACADEMY_ADMIN' || currentUser.role === 'SUPER_ADMIN';
  const isWebAllowedUser = isWebAdmin || isTeacherRole;

  useEffect(() => {
    if (!isAuthenticated || !isWebAllowedUser) {
      localStorage.removeItem('takeme_token');
      localStorage.removeItem('takeme_refresh_token');
      localStorage.removeItem('takeme_user');
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, isWebAllowedUser, navigate]);

  // 동시 접속 감지 주기적 세션 체크 (10초 주기)
  useEffect(() => {
    if (!isAuthenticated || !isWebAllowedUser) return;
    const sessionTimer = setInterval(async () => {
      const token = localStorage.getItem('takeme_token');
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE_URL}/auth/session-check`);
        if (res.status === 401) {
          localStorage.removeItem('takeme_token');
          localStorage.removeItem('takeme_refresh_token');
          localStorage.removeItem('takeme_user');
          alert('다른 기기 또는 브라우저에서 로그인되어 현재 접속이 종료되었습니다. 다시 로그인해 주세요.');
          window.location.href = '/';
        }
      } catch (err) {
        // network error
      }
    }, 10000);

    return () => clearInterval(sessionTimer);
  }, [isAuthenticated, isWebAdmin]);
  const isSuperAdmin = currentUser.role === 'SUPER_ADMIN';
  const [allAcademies, setAllAcademies] = useState([]);
  const [selectedAcademyId, setSelectedAcademyId] = useState(
    isSuperAdmin
      ? (Number(localStorage.getItem('takeme_selected_academy_id')) || currentUser.academyId || null)
      : (currentUser.academyId || null)
  );

  useEffect(() => {
    if (!isSuperAdmin) {
      localStorage.removeItem('takeme_selected_academy_id');
      if (currentUser?.academyId && selectedAcademyId !== currentUser.academyId) {
        setSelectedAcademyId(currentUser.academyId);
      }
    }
  }, [isSuperAdmin, currentUser?.academyId]);

  const [buses, setBuses] = useState([]);
  const [students, setStudents] = useState([]); // Array of { name, address, lat, lng, assignedBusId, color }
  const [emergencyAlert, setEmergencyAlert] = useState(null);
  const [escortToast, setEscortToast] = useState(null);
  const [attendanceToast, setAttendanceToast] = useState(null);
  const [adminAttendanceDate, setAdminAttendanceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [adminAttendanceData, setAdminAttendanceData] = useState(null);
  const [isAdminAttendanceLoading, setIsAdminAttendanceLoading] = useState(false);
  const [isAttendanceClosing, setIsAttendanceClosing] = useState(false);
  const [mapFocusTarget, setMapFocusTarget] = useState(null);
  const [selectedBusId, setSelectedBusId] = useState(null);
  const [activeTab, setActiveTab] = useState('status'); // 'status', 'buses', 'students', 'classes', 'attendance', 'auth', 'log', 'messages', 'documents', 'board', 'settings'
  const [isLogClosing, setIsLogClosing] = useState(false);
  const [isMessageClosing, setIsMessageClosing] = useState(false);
  const [isDocumentsClosing, setIsDocumentsClosing] = useState(false);
  const [isBoardClosing, setIsBoardClosing] = useState(false);
  const [isClassesClosing, setIsClassesClosing] = useState(false);
  const [isAuthClosing, setIsAuthClosing] = useState(false);
  const [authTab, setAuthTab] = useState('STUDENT'); // 'STUDENT' | 'STAFF' | 'TEACHER'
  const [boardSelectedClass, setBoardSelectedClass] = useState('ALL');
  const [boardSearchKeyword, setBoardSearchKeyword] = useState('');
  const [isCreatingBoardPost, setIsCreatingBoardPost] = useState(false);
  const [boardPosts, setBoardPosts] = useState([]);
  const [editingBus, setEditingBus] = useState(null);
  const [showAddBusModal, setShowAddBusModal] = useState(false);
  const [newBusForm, setNewBusForm] = useState({
    name: '',
    busNumber: '',
    plateNumber: '',
    driverName: '',
    driverPhone: '',
    teacherName: '',
    teacherPhone: '',
    capacity: 25,
    color: '#2563eb',
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [selectedTeacherClasses, setSelectedTeacherClasses] = useState({});
  const [isAssigningClass, setIsAssigningClass] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // 명단 엑셀 다운로드 대상 선택 및 OTP 인증 모달 상태
  const [exportTargets, setExportTargets] = useState({
    students: true,
    teachers: true,
    drivers: true,
  });
  const [isOtpModalOpen, setIsOtpModalOpen] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpError, setOtpError] = useState('');
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);

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

  // Sort Buses numerically by vehicle number or name (e.g., 1호차, 2호차, 10호차)
  const sortedBuses = useMemo(() => {
    return [...buses].sort((a, b) => {
      const matchA = (a.name || '').match(/\d+/);
      const matchB = (b.name || '').match(/\d+/);
      const numA = matchA ? parseInt(matchA[0], 10) : (Number(a.busNumber) || 999999);
      const numB = matchB ? parseInt(matchB[0], 10) : (Number(b.busNumber) || 999999);

      if (numA !== numB) {
        return numA - numB;
      }
      return (a.name || '').localeCompare(b.name || '', 'ko-KR', { numeric: true });
    });
  }, [buses]);

  // Batch messaging selections helpers
  const isMsgAllSelected = useMemo(() => {
    const isStudentsAll = students.length === 0 || msgTargetStudents.length === students.length;
    return msgTargetDriver && msgTargetTeacher && isStudentsAll;
  }, [msgTargetDriver, msgTargetTeacher, msgTargetStudents, students]);

  const isMsgAllParentsSelected = useMemo(() => {
    return students.length > 0 && msgTargetStudents.length === students.length;
  }, [msgTargetStudents, students]);

  const handleToggleSelectAllMsg = () => {
    if (isMsgAllSelected) {
      setMsgTargetDriver(false);
      setMsgTargetTeacher(false);
      setMsgTargetStudents([]);
      setMsgSelectedBusId(null);
    } else {
      setMsgTargetDriver(true);
      setMsgTargetTeacher(true);
      setMsgTargetStudents(students.map(s => s.id));
      setMsgSelectedBusId('ALL');
    }
  };

  const handleToggleAllDriversMsg = () => {
    if (msgTargetDriver) {
      setMsgTargetDriver(false);
      if (!msgTargetTeacher && msgTargetStudents.length === 0) {
        setMsgSelectedBusId(null);
      }
    } else {
      setMsgTargetDriver(true);
      if (!msgSelectedBusId) {
        setMsgSelectedBusId('ALL');
      }
    }
  };

  const handleToggleAllTeachersMsg = () => {
    if (msgTargetTeacher) {
      setMsgTargetTeacher(false);
      if (!msgTargetDriver && msgTargetStudents.length === 0) {
        setMsgSelectedBusId(null);
      }
    } else {
      setMsgTargetTeacher(true);
      if (!msgSelectedBusId) {
        setMsgSelectedBusId('ALL');
      }
    }
  };

  const handleToggleAllParentsMsg = () => {
    if (isMsgAllParentsSelected) {
      setMsgTargetStudents([]);
      if (!msgTargetDriver && !msgTargetTeacher) {
        setMsgSelectedBusId(null);
      }
    } else {
      setMsgTargetStudents(students.map(s => s.id));
      if (!msgSelectedBusId) {
        setMsgSelectedBusId('ALL');
      }
    }
  };

  const handleResetMsgSelections = () => {
    setMsgTargetDriver(false);
    setMsgTargetTeacher(false);
    setMsgTargetStudents([]);
    setMsgSelectedBusId(null);
  };

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
    const targetTab = newTab === 'buses' ? 'status' : newTab;
    if (activeTab === 'log' && targetTab !== 'log') {
      setIsLogClosing(true);
      setTimeout(() => {
        setIsLogClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else if (activeTab === 'messages' && targetTab !== 'messages') {
      setIsMessageClosing(true);
      setTimeout(() => {
        setIsMessageClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else if (activeTab === 'documents' && targetTab !== 'documents') {
      setIsDocumentsClosing(true);
      setTimeout(() => {
        setIsDocumentsClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else if (activeTab === 'board' && targetTab !== 'board') {
      setIsBoardClosing(true);
      setTimeout(() => {
        setIsBoardClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else if (activeTab === 'classes' && targetTab !== 'classes') {
      setIsClassesClosing(true);
      setTimeout(() => {
        setIsClassesClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else if (activeTab === 'attendance' && targetTab !== 'attendance') {
      setIsAttendanceClosing(true);
      setTimeout(() => {
        setIsAttendanceClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else if (activeTab === 'auth' && targetTab !== 'auth') {
      setIsAuthClosing(true);
      setTimeout(() => {
        setIsAuthClosing(false);
        setActiveTab(targetTab);
      }, 300);
    } else {
      setActiveTab(targetTab);
    }
  };
  
  const [academy, setAcademy] = useState(null);
  const [showAcademyModal, setShowAcademyModal] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [isInitializing, setIsInitializing] = useState(true);
  const [academyForm, setAcademyForm] = useState({ name: '', address: '', businessNumber: '' });
  const [isResettingZones, setIsResettingZones] = useState(false);
  const resetFileInputRef = useRef(null);
  const setupFileInputRef = useRef(null);
  const [isChangingAcademy, setIsChangingAcademy] = useState(false);
  const [academyChangeForm, setAcademyChangeForm] = useState({ name: '', address: '', businessNumber: '' });
  
  // Zone Editing State
  const [isZoneEditingMode, setIsZoneEditingMode] = useState(false);
  const [editingZoneBusId, setEditingZoneBusId] = useState(null);
  const [editingPolygon, setEditingPolygon] = useState([]);
  const [isAddingPoint, setIsAddingPoint] = useState(false);
  
  // Pickup Point State
  const [pickupPoints, setPickupPoints] = useState([]);
  const [showPickupPoints, setShowPickupPoints] = useState(false);
  const [isAddingPickupPoint, setIsAddingPickupPoint] = useState(false);
  
  // Yearly Zone Mapping State (전년도 구역 매핑 이력 및 보관함)
  const [yearlyZoneMappings, setYearlyZoneMappings] = useState([]);
  const [showYearlyMappingModal, setShowYearlyMappingModal] = useState(false);
  const [selectedYearlyMapping, setSelectedYearlyMapping] = useState(null);
  const [isLoadingYearlyMappings, setIsLoadingYearlyMappings] = useState(false);
  
  // Log Viewer State
  const [logTab, setLogTab] = useState('LOG'); // 'LOG', 'ABSENCE', 'HOLIDAY'

  // Day Filter State
  const [selectedDay, setSelectedDay] = useState('ALL'); // 'ALL', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'

  const [busLocations, setBusLocations] = useState({});
  const [operatingBuses, setOperatingBuses] = useState({}); // { [busId]: boolean }

  // Student Addition Modal State
  const [showAddStudentModal, setShowAddStudentModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState(null);
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
    assignedDepartureBusId: '',
    isNotRiding: false,
    dropoffLocation: '',
    inTime: '',
    outTime: '',
    allergies: '',
    note: ''
  });

  // Student Filter & Grouping Accordion State
  const [studentFilterMode, setStudentFilterMode] = useState('ALL'); // 'ALL', 'CLASS', 'AGE', 'BUS'
  const [studentSortBy, setStudentSortBy] = useState('NAME'); // 'NAME' (이름순), 'AGE' (나이순), 'CLASS' (반 순서)
  const [studentSearchKeyword, setStudentSearchKeyword] = useState('');
  const [studentClassFilter, setStudentClassFilter] = useState('ALL');
  const [selectedPaymentStudent, setSelectedPaymentStudent] = useState(null);
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

  // Sort students list based on current sort criterion: 이름순, 나이순, 반 순서
  const sortStudentsList = useCallback((list) => {
    return [...list].sort((a, b) => {
      const rawA = getStudentRaw(a);
      const rawB = getStudentRaw(b);

      if (studentSortBy === 'NAME') {
        return (a.name || '').localeCompare(b.name || '', 'ko-KR');
      }

      if (studentSortBy === 'AGE') {
        const ageA = rawA['연령'] !== undefined && rawA['연령'] !== null ? rawA['연령'] : rawA['학년'];
        const ageB = rawB['연령'] !== undefined && rawB['연령'] !== null ? rawB['연령'] : rawB['학년'];

        const matchA = String(ageA || '').match(/\d+/);
        const matchB = String(ageB || '').match(/\d+/);
        const numA = matchA ? parseInt(matchA[0], 10) : null;
        const numB = matchB ? parseInt(matchB[0], 10) : null;

        if (numA !== null && numB !== null) {
          if (numA !== numB) return numA - numB;
        } else if (numA !== null) {
          return -1;
        } else if (numB !== null) {
          return 1;
        } else if (ageA && ageB) {
          const cmp = String(ageA).localeCompare(String(ageB), 'ko-KR', { numeric: true });
          if (cmp !== 0) return cmp;
        } else if (ageA) {
          return -1;
        } else if (ageB) {
          return 1;
        }

        // 나이가 같거나 정보가 없으면 이름순
        return (a.name || '').localeCompare(b.name || '', 'ko-KR');
      }

      if (studentSortBy === 'CLASS') {
        const classA = rawA['반명'] ? String(rawA['반명']).trim() : '';
        const classB = rawB['반명'] ? String(rawB['반명']).trim() : '';

        if (classA && classB) {
          const cmp = classA.localeCompare(classB, 'ko-KR', { numeric: true });
          if (cmp !== 0) return cmp;
        } else if (classA) {
          return -1;
        } else if (classB) {
          return 1;
        }

        // 반명이 같으면 이름순
        return (a.name || '').localeCompare(b.name || '', 'ko-KR');
      }

      return 0;
    });
  }, [studentSortBy]);

  // Filter students based on search keyword and class filter
  const filteredStudents = useMemo(() => {
    return students.filter(st => {
      // 1. Class Filter
      if (studentClassFilter !== 'ALL') {
        const raw = getStudentRaw(st);
        const cls = String(raw['반명'] || raw['반'] || '').trim();
        if (cls !== studentClassFilter) return false;
      }
      // 2. Student Search Keyword (Name or Phone)
      if (studentSearchKeyword.trim()) {
        const kw = studentSearchKeyword.trim().toLowerCase();
        const name = (st.name || '').toLowerCase();
        const raw = getStudentRaw(st);
        const phone = String(st.phone || raw['학부모전화번호'] || raw['연락처'] || raw['부모연락처'] || raw['보호자연락처'] || '').toLowerCase();
        if (!name.includes(kw) && !phone.includes(kw)) return false;
      }
      return true;
    });
  }, [students, studentSearchKeyword, studentClassFilter]);

  const getGroupedStudents = () => {
    if (studentFilterMode === 'CLASS') {
      const groups = {};
      filteredStudents.forEach(st => {
        const raw = getStudentRaw(st);
        const val = raw['반명'];
        const key = val !== undefined && val !== null && String(val).trim() ? String(val).trim() : '반 미지정';
        if (!groups[key]) groups[key] = [];
        groups[key].push(st);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0])).map(([name, list]) => ({
        key: `class_${name}`,
        name,
        list: sortStudentsList(list)
      }));
    }
    if (studentFilterMode === 'AGE') {
      const groups = {};
      filteredStudents.forEach(st => {
        const raw = getStudentRaw(st);
        const rawAge = raw['연령'] !== undefined && raw['연령'] !== null ? raw['연령'] : raw['학년'];
        const key = rawAge !== undefined && rawAge !== null && String(rawAge).trim() ? String(rawAge).trim() : '연령 미입력';
        if (!groups[key]) groups[key] = [];
        groups[key].push(st);
      });
      return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([name, list]) => ({
        key: `age_${name}`,
        name,
        list: sortStudentsList(list)
      }));
    }
    if (studentFilterMode === 'BUS') {
      const groups = {};
      sortedBuses.forEach(b => {
        groups[b.name] = { bus: b, list: [] };
      });
      groups['배정 대기'] = { bus: null, list: [] };

      filteredStudents.forEach(st => {
        const bus = buses.find(b => b.id === st.assignedBusId);
        const key = bus ? bus.name : '배정 대기';
        if (!groups[key]) groups[key] = { bus, list: [] };
        groups[key].list.push(st);
      });
      return Object.entries(groups).map(([name, data]) => ({
        key: `bus_${name}`,
        name,
        bus: data.bus,
        list: sortStudentsList(data.list)
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

  const fetchAdminAttendance = useCallback(async (date) => {
    const targetDate = date || adminAttendanceDate;
    const targetAcademyId = selectedAcademyId || currentUser?.academyId;
    try {
      setIsAdminAttendanceLoading(true);
      const url = targetAcademyId
        ? `${API_BASE_URL}/routing/attendance?date=${targetDate}&academyId=${targetAcademyId}`
        : `${API_BASE_URL}/routing/attendance?date=${targetDate}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setAdminAttendanceData(data);
      }
    } catch (e) {
      console.error('Failed to fetch admin attendance:', e);
    } finally {
      setIsAdminAttendanceLoading(false);
    }
  }, [adminAttendanceDate, selectedAcademyId, currentUser]);

  useEffect(() => {
    if (activeTab === 'attendance') {
      fetchAdminAttendance();
    }
  }, [activeTab, adminAttendanceDate, fetchAdminAttendance]);

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
      if (selectedAcademyId) {
        socket.emit('joinAcademyRoom', { academyId: Number(selectedAcademyId), token });
      }
      if (buses && buses.length > 0) {
        buses.forEach(b => {
          socket.emit('joinVehicleRoom', { vehicleId: Number(b.id) });
        });
      }
    });

    socket.on('emergencyAlert', (data) => {
      console.warn('🚨 Emergency alert received on manager dashboard:', data);
      setEmergencyAlert(data);
      if (data && data.lat && data.lng) {
        setMapFocusTarget([parseFloat(data.lat), parseFloat(data.lng)]);
      }

      // Audio Alarm using Web Audio API
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          const playBeep = (freq, duration, delay) => {
            setTimeout(() => {
              try {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
                osc.start();
                osc.stop(audioCtx.currentTime + duration);
              } catch (_) {}
            }, delay);
          };
          playBeep(880, 0.25, 0);
          playBeep(660, 0.25, 250);
          playBeep(880, 0.25, 500);
          playBeep(660, 0.35, 750);
        }
      } catch (e) {
        console.warn('Audio alarm playback error:', e);
      }

      // Browser Notification API
      if ('Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification('🚨 긴급 사고·고장 비상 알림', {
            body: `${data.vehicleName} (${data.driverName}) 비상 알림이 발생했습니다.`,
          });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(p => {
            if (p === 'granted') {
              new Notification('🚨 긴급 사고·고장 비상 알림', {
                body: `${data.vehicleName} (${data.driverName}) 비상 알림이 발생했습니다.`,
              });
            }
          });
        }
      }
    });

    socket.on('escortStarted', (data) => {
      console.log('Escort started received:', data);
      setEscortToast(data);
      setTimeout(() => {
        setEscortToast(prev => (prev?.time === data?.time ? null : prev));
      }, 5000);
    });

    socket.on('attendanceSubmitted', (data) => {
      console.log('Attendance submitted socket received on manager web:', data);
      setAttendanceToast(data);
      setTimeout(() => {
        setAttendanceToast(prev => (prev?.submittedAt === data?.submittedAt ? null : prev));
      }, 7000);
      fetchAdminAttendance();
    });

    socket.on('allVehicleOperatingStatus', (statusMap) => {
      console.log('All vehicle operating status:', statusMap);
      if (statusMap) {
        setOperatingBuses(prev => ({ ...prev, ...statusMap }));
        setBusLocations(prev => {
          const next = { ...prev };
          Object.entries(statusMap).forEach(([vid, isOp]) => {
            if (!isOp) {
              delete next[vid];
              delete next[Number(vid)];
            }
          });
          return next;
        });
      }
    });

    socket.on('vehicleOperatingStatus', (data) => {
      console.log('Vehicle operating status update:', data);
      if (data && data.vehicleId) {
        const isOp = Boolean(data.isOperating);
        const vidNum = Number(data.vehicleId);
        const vidStr = data.vehicleId.toString();
        setOperatingBuses(prev => ({
          ...prev,
          [vidNum]: isOp,
          [vidStr]: isOp
        }));

        if (!isOp) {
          // Immediately remove bus marker from map in real-time
          setBusLocations(prev => {
            const next = { ...prev };
            delete next[vidNum];
            delete next[vidStr];
            return next;
          });
        }
      }
    });

    socket.on('locationUpdated', (data) => {
      console.log('Real-time bus location received:', data);
      if (data && data.vehicleId) {
        const vidNum = Number(data.vehicleId);
        const vidStr = data.vehicleId.toString();
        setOperatingBuses(prev => ({
          ...prev,
          [vidNum]: true,
          [vidStr]: true
        }));
        setBusLocations(prev => ({
          ...prev,
          [vidNum]: {
            lat: parseFloat(data.lat),
            lng: parseFloat(data.lng),
            timestamp: data.timestamp
          }
        }));
      }
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

  useEffect(() => {
    if (socketRef.current && socketRef.current.connected && selectedAcademyId) {
      const token = localStorage.getItem('takeme_token');
      socketRef.current.emit('joinAcademyRoom', { academyId: Number(selectedAcademyId), token });
    }
  }, [selectedAcademyId]);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // 60-second Stale Timeout for real-time bus GPS markers
  useEffect(() => {
    const staleInterval = setInterval(() => {
      const now = Date.now();
      const STALE_TIMEOUT_MS = 60 * 1000;
      setBusLocations(prev => {
        let changed = false;
        const next = { ...prev };
        Object.entries(prev).forEach(([vid, loc]) => {
          if (loc && loc.timestamp) {
            const locTime = typeof loc.timestamp === 'number' ? loc.timestamp : new Date(loc.timestamp).getTime();
            if (now - locTime > STALE_TIMEOUT_MS) {
              delete next[vid];
              changed = true;
            }
          }
        });
        return changed ? next : prev;
      });
    }, 15000);

    return () => clearInterval(staleInterval);
  }, []);

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

  const handleRevokeTeacher = async (teacherId) => {
    if (!window.confirm('이 교사의 앱 연동 권한을 해제(탈퇴)하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/routing/revoke-teacher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teacherId })
      });
      if (res.ok) {
        setTeachers(prev => prev.filter(t => t.id !== teacherId));
        if (typeof refreshAllData === 'function') {
          await refreshAllData();
        }
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.message || '교사 연동 해제 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('처리 중 오류가 발생했습니다.');
    }
  };

  const handleUnlockUser = async (userId) => {
    if (!userId) {
      alert('연동된 사용자 계정 정보를 찾을 수 없습니다.');
      return;
    }
    if (!window.confirm('이 사용자의 계정 잠금을 해제하시겠습니까?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/routing/unlock-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert(data.message || '계정 잠금이 성공적으로 해제되었습니다.');
        if (typeof refreshAllData === 'function') {
          await refreshAllData();
        }
        if (typeof fetchTeachers === 'function') {
          await fetchTeachers();
        }
      } else {
        alert(data.message || '잠금 해제 처리 중 오류가 발생했습니다.');
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
    if (activeTab === 'auth' || activeTab === 'classes' || activeTab === 'settings') {
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

  // 엑셀 다운로드 시작 (대상 검증 후 OTP 인증 모달 띄우기)
  const handleInitiateExcelExport = () => {
    const hasTarget = exportTargets.students || exportTargets.teachers || exportTargets.drivers;
    if (!hasTarget) {
      alert('다운로드할 항목(원생, 교사, 기사)을 1개 이상 선택해주세요.');
      return;
    }
    if (!currentUser || !currentUser.id) {
      alert('사용자 계정 정보가 확인되지 않습니다. 다시 로그인해주세요.');
      return;
    }
    setOtpCode('');
    setOtpError('');
    setIsOtpModalOpen(true);
  };

  // OTP 인증 검증 후 실제 엑셀 파일 생성 실행
  const handleVerifyOtpAndExport = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!otpCode || otpCode.trim().length !== 6) {
      setOtpError('Google OTP 6자리 번호를 정확히 입력해주세요.');
      return;
    }
    setIsVerifyingOtp(true);
    setOtpError('');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          token: otpCode.trim()
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setOtpError(data.message || 'OTP 번호가 올바르지 않습니다. 다시 입력해주세요.');
        return;
      }

      // OTP 검증 성공 시 모달 닫고 실제 엑셀 생성 및 다운로드 수행
      setIsOtpModalOpen(false);
      setOtpCode('');
      await handleExportMasterExcel();
    } catch (err) {
      console.error('OTP 인증 통신 오류:', err);
      setOtpError('OTP 인증 서버 통신 중 오류가 발생했습니다.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleExportMasterExcel = async () => {
    try {
      setIsExportingExcel(true);

      // 최신 교사 목록 동기화 시도 (교사가 선택된 경우)
      let currentTeachers = teachers;
      const targetAcademyId = selectedAcademyId || currentUser.academyId;
      if (exportTargets.teachers && targetAcademyId) {
        try {
          const res = await fetch(`${API_BASE_URL}/routing/teachers?academyId=${targetAcademyId}`);
          if (res.ok) {
            currentTeachers = await res.json();
            setTeachers(currentTeachers);
          }
        } catch (fetchErr) {
          console.warn('최신 교사 목록 조회 실패, 기존 캐시 사용:', fetchErr);
        }
      }

      // 1. 학생(원생) 데이터 - '원아_정보_입력_시트.xlsx' 2행 헤더 공식 규격 적용
      const aoaData = [
        // Row 0 (헤더 1행)
        ['반명', '학생이름/영문이름', '유치원명', '연령', '성별', '보호자 성함', '부모연락처', '주소', '담임명', '하원정보', '', '', '등원시간', '하원시간', '알레르기', '비고'],
        // Row 1 (헤더 2행 - 하원정보 서브헤더)
        ['', '', '', '', '', '', '', '', '', '정규하원', '방과후하원', '종일반하원', '', '', '', '']
      ];

      if (exportTargets.students) {
        students.forEach(st => {
          const raw = getStudentRaw(st);
          const bus = buses.find(b => b.id === st.assignedBusId);
          const busName = bus ? (bus.busNumber || bus.name || `${bus.id}호차`) : '';

          const className = raw['반명'] || raw['반'] || raw['학급'] || '';
          const studentName = st.realName || st.name || raw['학생이름/영문이름'] || raw['원아명'] || raw['이름'] || '';
          const academyName = academy?.name || raw['유치원명'] || '';
          const age = (raw['연령'] !== undefined && raw['연령'] !== null && String(raw['연령']).trim()) 
            ? raw['연령'] 
            : (raw['학년'] || raw['나이'] || '');
          const gender = raw['성별'] || '';
          const parentName = raw['보호자 성함'] || raw['보호자성함'] || raw['보호자명'] || raw['학부모성함'] || raw['학부모 성함'] || '';
          const parentPhone = raw['부모연락처'] || raw['보호자연락처'] || raw['보호자 연락처'] || raw['학부모연락처'] || raw['연락처'] || raw['전화번호'] || '';
          const address = st.address || raw['주소'] || st.boardingLocation || raw['등원지'] || raw['탑승지'] || '';
          const teacherName = raw['담임명'] || raw['담임'] || '';

          // 하원정보 구분 매핑
          const depType = raw['하원구분'] || raw['하원정보'] || '';
          let regularDrop = raw['정규하원'] || '';
          let afterSchoolDrop = raw['방과후하원'] || '';
          let fullDayDrop = raw['종일반하원'] || '';

          if (!regularDrop && !afterSchoolDrop && !fullDayDrop) {
            if (depType === '방과후하원') {
              afterSchoolDrop = raw['하원지'] || 'O';
            } else if (depType === '종일반하원') {
              fullDayDrop = raw['하원지'] || 'O';
            } else {
              regularDrop = raw['하원지'] || (depType === '정규하원' ? 'O' : '');
            }
          }

          const pickupTime = raw['등원시간'] || '';
          const dropoffTime = raw['하원시간'] || '';

          // 비고 구성 (배정차량 및 메모)
          const noteParts = [];
          if (busName) noteParts.push(`차량: ${busName}`);
          if (st.teacherMemo) noteParts.push(st.teacherMemo);
          if (raw['비고']) noteParts.push(raw['비고']);
          const note = noteParts.join(' / ');

          const allergies = st.allergies || raw['알레르기'] || raw['알러지'] || '';
          aoaData.push([
            className,
            studentName,
            academyName,
            age,
            gender,
            parentName,
            parentPhone,
            address,
            teacherName,
            regularDrop,
            afterSchoolDrop,
            fullDayDrop,
            pickupTime,
            dropoffTime,
            allergies,
            note
          ]);
        });
      }

      // 2. 교사 데이터 추출 및 정제 (가입 교사 + 차량 동승 교사)
      const registeredTeacherNames = new Set();
      const teachersData = [];

      if (exportTargets.teachers) {
        if (Array.isArray(currentTeachers)) {
          currentTeachers.forEach((t, idx) => {
            const assignedBus = buses.find(b => b.teacherName === t.name || (t.phone && b.teacherPhone === t.phone));
            registeredTeacherNames.add(t.name);
            teachersData.push({
              'No': idx + 1,
              '교사 성명': t.name || '',
              '담당 반': t.assignedClass || '미배정',
              '이메일(아이디)': t.email || '',
              '동승 차량': assignedBus ? (assignedBus.busNumber || assignedBus.name) : '미배정',
              '가입 일시': t.createdAt ? new Date(t.createdAt).toLocaleDateString('ko-KR') : '-'
            });
          });
        }

        // 차량에 등록되어 있으나 교사 회원 목록에 없는 동승교사 보완
        buses.forEach(b => {
          if (b.teacherName && b.teacherName !== '미지정' && !registeredTeacherNames.has(b.teacherName)) {
            registeredTeacherNames.add(b.teacherName);
            teachersData.push({
              'No': teachersData.length + 1,
              '교사 성명': b.teacherName,
              '담당 반': '차량 동승 지도',
              '이메일(아이디)': '미가입 (차량 동승 교사)',
              '동승 차량': b.busNumber || b.name,
              '가입 일시': '-'
            });
          }
        });
      }

      // 3. 기사 및 차량 데이터 추출 및 정제
      const driversData = [];
      if (exportTargets.drivers) {
        sortedBuses.forEach((b, idx) => {
          const assignedStudentCount = students.filter(st => st.assignedBusId === b.id).length;
          const driverStatus = b.driverApprovalStatus === 'APPROVED' 
            ? '승인완료' 
            : b.driverApprovalStatus === 'PENDING' 
              ? '승인대기' 
              : (b.isDriverRegistered ? '가입됨' : '미가입');
          const teacherStatus = b.teacherApprovalStatus === 'APPROVED'
            ? '승인완료'
            : b.teacherApprovalStatus === 'PENDING'
              ? '승인대기'
              : (b.isTeacherRegistered ? '가입됨' : '미가입');

          driversData.push({
            'No': idx + 1,
            '호차명': b.busNumber || b.name || `${idx + 1}호차`,
            '차량 번호판': b.plateNumber || '미등록',
            '승차 정원': b.capacity ? `${b.capacity}인승` : '미설정',
            '담당 기사 성명': b.driverName || '미지정',
            '기사 연락처': b.driverPhone || '미등록',
            '기사 앱 승인상태': driverStatus,
            '동승 교사 성명': b.teacherName || '미지정',
            '동승 교사 연락처': b.teacherPhone || '미등록',
            '동승 교사 앱 승인상태': teacherStatus,
            '배정 원생 수': `${assignedStudentCount}명`
          });
        });
      }

      // 엑셀 워크북 생성
      const wb = XLSX.utils.book_new();

      // 시트 1: 원아 명단 (선택된 경우)
      if (exportTargets.students) {
        const wsStudents = XLSX.utils.aoa_to_sheet(aoaData);
        wsStudents['!merges'] = [
          { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },   // 반명
          { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },   // 학생이름/영문이름
          { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },   // 유치원명
          { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },   // 연령
          { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } },   // 성별
          { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },   // 보호자 성함
          { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } },   // 부모연락처
          { s: { r: 0, c: 7 }, e: { r: 1, c: 7 } },   // 주소
          { s: { r: 0, c: 8 }, e: { r: 1, c: 8 } },   // 담임명
          { s: { r: 0, c: 9 }, e: { r: 0, c: 11 } },  // 하원정보 (정규하원, 방과후하원, 종일반하원 상위 병합)
          { s: { r: 0, c: 12 }, e: { r: 1, c: 12 } }, // 등원시간
          { s: { r: 0, c: 13 }, e: { r: 1, c: 13 } }, // 하원시간
          { s: { r: 0, c: 14 }, e: { r: 1, c: 14 } }, // 알레르기
          { s: { r: 0, c: 15 }, e: { r: 1, c: 15 } }  // 비고
        ];
        wsStudents['!cols'] = [
          { wch: 12 }, // 반명
          { wch: 18 }, // 학생이름/영문이름
          { wch: 16 }, // 유치원명
          { wch: 8 },  // 연령
          { wch: 8 },  // 성별
          { wch: 14 }, // 보호자 성함
          { wch: 18 }, // 부모연락처
          { wch: 34 }, // 주소
          { wch: 12 }, // 담임명
          { wch: 12 }, // 정규하원
          { wch: 12 }, // 방과후하원
          { wch: 12 }, // 종일반하원
          { wch: 12 }, // 등원시간
          { wch: 12 }, // 하원시간
          { wch: 20 }, // 알레르기
          { wch: 26 }, // 비고
        ];
        XLSX.utils.book_append_sheet(wb, wsStudents, '유치원부');
      }

      // 시트 2: 교사 명단 (선택된 경우)
      if (exportTargets.teachers) {
        const wsTeachers = XLSX.utils.json_to_sheet(
          teachersData.length > 0 ? teachersData : [{ '안내': '등록된 교사 데이터가 없습니다.' }]
        );
        wsTeachers['!cols'] = [
          { wch: 6 },  // No
          { wch: 16 }, // 교사 성명
          { wch: 16 }, // 담당 반
          { wch: 28 }, // 이메일
          { wch: 16 }, // 동승 차량
          { wch: 16 }, // 가입 일시
        ];
        XLSX.utils.book_append_sheet(wb, wsTeachers, '교사 명단');
      }

      // 시트 3: 기사 및 차량 명단 (선택된 경우)
      if (exportTargets.drivers) {
        const wsDrivers = XLSX.utils.json_to_sheet(
          driversData.length > 0 ? driversData : [{ '안내': '등록된 통학차량/기사 데이터가 없습니다.' }]
        );
        wsDrivers['!cols'] = [
          { wch: 6 },  // No
          { wch: 14 }, // 호차명
          { wch: 16 }, // 차량 번호판
          { wch: 12 }, // 승차 정원
          { wch: 16 }, // 담당 기사 성명
          { wch: 18 }, // 기사 연락처
          { wch: 16 }, // 기사 앱 승인상태
          { wch: 16 }, // 동승 교사 성명
          { wch: 18 }, // 동승 교사 연락처
          { wch: 16 }, // 동승 교사 앱 승인상태
          { wch: 14 }, // 배정 원생 수
        ];
        XLSX.utils.book_append_sheet(wb, wsDrivers, '기사 및 차량 명단');
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const academyTitle = academy?.name ? `${academy.name.replace(/\s+/g, '_')}_` : '';
      const selectedParts = [];
      if (exportTargets.students) selectedParts.push('원생');
      if (exportTargets.teachers) selectedParts.push('교사');
      if (exportTargets.drivers) selectedParts.push('기사');
      const suffix = selectedParts.length === 3 ? '원생_교사_기사_통합명단' : `${selectedParts.join('_')}_명단`;
      const fileName = `${academyTitle}${suffix}_${dateStr}.xlsx`;

      XLSX.writeFile(wb, fileName);
    } catch (err) {
      console.error('엑셀 다운로드 중 오류 발생:', err);
      alert('엑셀 파일 생성 중 오류가 발생했습니다.');
    } finally {
      setIsExportingExcel(false);
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

  const handleAddBus = async (e) => {
    e.preventDefault();
    const busName = (newBusForm.name || newBusForm.busNumber || `${buses.length + 1}호차`).trim();
    setIsProcessing(true);

    try {
      const targetAcademyId = selectedAcademyId || currentUser.academyId || 1;
      const res = await fetch(`${API_BASE_URL}/routing/vehicle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-academy-id': String(targetAcademyId),
        },
        body: JSON.stringify({
          academyId: targetAcademyId,
          name: busName,
          busNumber: newBusForm.busNumber || busName,
          plateNumber: newBusForm.plateNumber || '',
          driverName: newBusForm.driverName || '',
          driverPhone: newBusForm.driverPhone || '',
          teacherName: newBusForm.teacherName || '',
          teacherPhone: newBusForm.teacherPhone || '',
          capacity: parseInt(newBusForm.capacity) || 25,
          color: newBusForm.color || '#2563eb',
        })
      }).catch(() => null);

      let createdBus;
      if (res && res.ok) {
        createdBus = await res.json();
      } else {
        // Fallback local persistence if backend remote endpoint is unavailable
        createdBus = {
          id: Date.now(),
          name: busName,
          busNumber: newBusForm.busNumber || busName,
          plateNumber: newBusForm.plateNumber || '',
          driverName: newBusForm.driverName || '',
          driverPhone: newBusForm.driverPhone || '',
          teacherName: newBusForm.teacherName || '',
          teacherPhone: newBusForm.teacherPhone || '',
          capacity: parseInt(newBusForm.capacity) || 25,
          color: newBusForm.color || '#2563eb',
          polygonCoordinates: '[]',
          operatingSchedule: '[]',
        };
      }

      const updated = [...buses, createdBus];
      setBuses(typeof computePolygons === 'function' ? computePolygons(updated) : updated);
      localStorage.setItem('takeme_buses', JSON.stringify(updated));
      setShowAddBusModal(false);
      setNewBusForm({
        name: '',
        busNumber: '',
        plateNumber: '',
        driverName: '',
        driverPhone: '',
        teacherName: '',
        teacherPhone: '',
        capacity: 25,
        color: '#2563eb',
      });
      alert(`[${busName}] 차량이 성공적으로 등록되었습니다.`);

      try {
        const stateRes = await fetch(`${API_BASE_URL}/routing/initial-state?academyId=${targetAcademyId}`);
        if (stateRes.ok) {
          const stateData = await stateRes.json();
          if (Array.isArray(stateData.buses) && typeof computePolygons === 'function') setBuses(computePolygons(stateData.buses));
          if (Array.isArray(stateData.students)) setStudents(stateData.students);
        }
      } catch (_) {}
    } catch (err) {
      console.error(err);
      alert('차량 등록 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteBus = async (bus) => {
    if (!bus) return;
    const busStudents = students.filter(st => st.assignedBusId === bus.id);
    const confirmMsg = busStudents.length > 0
      ? `정말 [${bus.name}] 차량을 삭제하시겠습니까?\n\n※ 해당 차량에 배정된 원아 ${busStudents.length}명은 안전하게 '배정 대기' 상태로 전환됩니다.`
      : `정말 [${bus.name}] 차량을 삭제하시겠습니까?`;

    if (!window.confirm(confirmMsg)) return;

    setIsProcessing(true);
    try {
      const targetAcademyId = selectedAcademyId || currentUser.academyId || 1;
      await fetch(`${API_BASE_URL}/routing/vehicle/${bus.id}?academyId=${targetAcademyId}&userId=${currentUser.id}`, { method: 'DELETE' }).catch(() => {});

      const updatedBuses = buses.filter(b => b.id !== bus.id);
      setBuses(typeof computePolygons === 'function' ? computePolygons(updatedBuses) : updatedBuses);
      localStorage.setItem('takeme_buses', JSON.stringify(updatedBuses));

      if (busStudents.length > 0) {
        const updatedStudents = students.map(st => st.assignedBusId === bus.id ? { ...st, assignedBusId: null } : st);
        setStudents(updatedStudents);
        localStorage.setItem('takeme_students', JSON.stringify(updatedStudents));
      }

      if (selectedBusId === bus.id) {
        setSelectedBusId(null);
      }

      alert(`[${bus.name}] 차량이 삭제되었습니다.`);
    } catch (err) {
      console.error(err);
      alert('차량 삭제 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
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
    return (busArray || []).map(bus => {
      let poly = bus.polygon || bus.polygonCoordinates || bus.points;
      while (typeof poly === 'string') {
        try { poly = JSON.parse(poly); } catch(e) { break; }
      }
      if (Array.isArray(poly) && poly.length >= 3) {
        try {
          const closedCoords = poly.map(p => [p[1], p[0]]);
          if (closedCoords[0][0] !== closedCoords[closedCoords.length - 1][0] ||
              closedCoords[0][1] !== closedCoords[closedCoords.length - 1][1]) {
            closedCoords.push(closedCoords[0]);
          }
          const turfPoly = turf.polygon([closedCoords]);
          return {
            ...bus,
            points: poly,
            polygon: poly,
            polygonCoordinates: poly,
            turfPolygon: turfPoly
          };
        } catch (e) {
          return {
            ...bus,
            points: poly,
            polygon: poly,
            polygonCoordinates: poly
          };
        }
      }
      return { ...bus, points: [], polygon: [], polygonCoordinates: [] };
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
          businessNumber: data.academy.businessNumber || '',
          lat: parseFloat(data.academy.latitude),
          lng: parseFloat(data.academy.longitude),
          authCode: data.academy.authCode
        };
        setAcademy(formattedAcademy);
        setAcademyForm({
          name: formattedAcademy.name,
          address: formattedAcademy.address,
          businessNumber: formattedAcademy.businessNumber
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
        if (!isTeacherRole && (!data.academy || !data.academy.id)) {
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
          businessNumber: academyForm.businessNumber ? academyForm.businessNumber.trim() : '',
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
          businessNumber: academyChangeForm.businessNumber ? academyChangeForm.businessNumber.trim() : '',
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
        alert('유치원 정보가 성공적으로 변경되었습니다!');
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

  // Check if row 1 contains sub-headers like '정규하원', '방과후하원', '종일반하원', '승차지', '하차지'
  const isTwoRowHeader = row1.some(cell => 
    cell && typeof cell === 'string' && (cell.includes('하원') || cell.includes('정규') || cell.includes('종일') || cell.includes('승차') || cell.includes('하차'))
  );

  let headerRowIndex = 0;
  let headers = [];

  if (isTwoRowHeader) {
    headerRowIndex = 2; // Data rows start at index 2
    for (let c = 0; c < Math.max(row0.length, row1.length); c++) {
      const top = row0[c] ? String(row0[c]).trim() : '';
      const sub = row1[c] ? String(row1[c]).trim() : '';
      if (top.includes('호차') || top.includes('차량') || (top && (sub.includes('승차') || sub.includes('하차')))) {
        if (sub.includes('하차')) {
          headers.push('탑승차량_하차지');
        } else {
          headers.push('탑승차량_승차지');
        }
      } else if (sub) {
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

  const cleanVehicle = (str) => {
    if (!str) return '';
    const m = String(str).match(/([0-9]+)\s*호차/);
    return m ? `${m[1]}호차` : '';
  };

  const cleanStopName = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/\([0-9]+\s*호차\)/g, '')
      .replace(/\[[0-9]+\s*호차\]/g, '')
      .replace(/^[0-9]+\s*호차\s*/, '')
      .replace(/^[0-9]+\s*코스\s*/, '')
      .replace(/^[0-9]+\s*노선\s*/, '')
      .replace(/^\s*\(\s*|\s*\)\s*$/g, '')
      .trim();
  };

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
    const kindergartenName = (academy?.name && academy.name.trim()) || obj['유치원명'] || obj['소속원명'] || obj['학교명'] || '';
    const age = obj['연령'] || obj['학년'] || '';
    const parentPhone = obj['부모연락처'] || obj['보호자연락처'] || obj['보호자 연락처'] || '';

    // CRITICAL: Road name address is in '주소' / '도로명주소' (Column 7)
    const roadAddress = obj['주소'] || obj['도로명주소'] || '';

    // Vehicle & Stop parsing
    const rawBoarding = obj['탑승차량_승차지'] || obj['승차지'] || obj['등원지'] || obj['탑승지'] || '';
    const rawDropoff = obj['탑승차량_하차지'] || obj['하차지'] || obj['하원지'] || '';
    const noteStr = obj['비고'] || obj['노선'] || obj['코스'] || '';

    const detectedBus = cleanVehicle(rawBoarding) || cleanVehicle(rawDropoff) || cleanVehicle(noteStr) || cleanVehicle(obj['등원차량']) || cleanVehicle(obj['차량']) || cleanVehicle(obj['호차']);
    if (detectedBus) {
      obj['등원차량'] = detectedBus;
      obj['하원차량'] = detectedBus;
      obj['호차'] = detectedBus;
      obj['차량'] = detectedBus;
    }

    const boardingStopName = cleanStopName(rawBoarding) || cleanStopName(rawDropoff) || '';

    const allergies = obj['알레르기'] || obj['알러지'] || obj['특이사항(알레르기)'] || '';
    obj['알레르기'] = allergies;

    obj['원아명'] = name;
    obj['이름'] = name;
    obj['유치원명'] = kindergartenName;
    obj['학교명'] = kindergartenName;

    // Preserve existing class teacher if already registered in system
    const studentClass = (obj['반명'] || obj['반'] || '').toString().trim();
    if (studentClass && Array.isArray(teachers)) {
      const existingT = teachers.find(t => t.assignedClass && t.assignedClass.trim() === studentClass);
      if (existingT && existingT.name) {
        obj['담임명'] = existingT.name;
      }
    }
    obj['연령'] = age;
    obj['부모연락처'] = parentPhone;
    obj['보호자연락처'] = parentPhone;

    // Road address is preserved as primary address; boardingStopName is preserved as stop
    obj['주소'] = roadAddress || boardingStopName;
    obj['도로명주소'] = roadAddress;
    obj['등원지'] = boardingStopName || roadAddress;
    obj['탑승지'] = boardingStopName || roadAddress;
    obj['승차지'] = boardingStopName || roadAddress;
    obj['하차지'] = cleanStopName(rawDropoff) || boardingStopName || roadAddress;

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
          const name = row['학생이름/영문이름'] || row['이름'] || row['원아명'] || row['원생명'] || row['학생명'] || row['원생이름'] || `원생${idx + 1}`;
          const roadAddress = (row['도로명주소'] || row['주소'] || '').toString().trim();
          const stopLocation = (row['탑승차량_승차지'] || row['승차지'] || row['등원지'] || row['탑승지'] || row['승차지(주소)'] || '').toString().trim();
          const address = roadAddress || stopLocation;
          const boardingLocation = stopLocation || roadAddress;
          return {
            name: name.toString().trim(),
            address: address,
            boardingLocation: boardingLocation,
            raw: row
          };
        }).filter(item => item.name);

        if (addressMap.length === 0) {
          alert('엑셀 파일에서 등록할 원아 데이터를 찾을 수 없습니다.');
          setIsProcessing(false);
          return;
        }

        const validAddressesToGeocode = Array.from(new Set(addressMap.map(a => a.address).filter(Boolean)));
        let geocodeLookup = new Map();
        if (validAddressesToGeocode.length > 0) {
          const res = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: validAddressesToGeocode })
          });
          if (res.ok) {
            const list = await res.json();
            list.forEach(item => {
              if (item.coords && !isNaN(item.coords.lat) && !isNaN(item.coords.lng)) {
                geocodeLookup.set(item.address, item.coords);
              }
            });
          }
        }

        let successCount = 0;
        let failedCount = 0;
        const newStudents = [];

        addressMap.forEach((item, idx) => {
          const coords = item.address ? geocodeLookup.get(item.address) : null;
          const isGeocoded = Boolean(coords && coords.lat && coords.lng);

          let lat = null;
          let lng = null;
          let address = '';
          let boardingLocation = '';
          let assignedBus = null;

          if (isGeocoded) {
            lat = coords.lat;
            lng = coords.lng;
            address = item.address;
            boardingLocation = item.boardingLocation || address;
            successCount++;

            const pt = turf.point([lng, lat]);
            // 1. Point in polygon (구역 내 위치한 학생은 해당 구역 차량에 즉시 배정)
            for (const bus of buses) {
              if (bus.turfPolygon && turf.booleanPointInPolygon(pt, bus.turfPolygon)) {
                assignedBus = bus;
                break;
              }
            }

            // 2. 구역 밖인 경우: 엑셀에 명시된 차량이 있으면 해당 차량으로 배정 (구역 확장 대상)
            if (!assignedBus) {
              const rawRow = item.raw || {};
              const explicitBusRaw = (rawRow['등원차량'] || rawRow['하원차량'] || rawRow['차량'] || rawRow['호차'] || '').toString().trim();
              if (explicitBusRaw) {
                const numOnly = explicitBusRaw.replace(/[^0-9]/g, '');
                assignedBus = buses.find(b => b.name === explicitBusRaw || (numOnly && (b.name || '').replace(/[^0-9]/g, '') === numOnly)) || null;
              }
            }

            // 3. Proximity fallback
            if (!assignedBus) {
              let minDistance = Infinity;
              for (const bus of buses) {
                if (bus.points && bus.points.length > 0) {
                  for (const bPt of bus.points) {
                    const busNode = turf.point([bPt[1], bPt[0]]);
                    const dist = turf.distance(pt, busNode);
                    if (dist < minDistance) {
                      minDistance = dist;
                      assignedBus = bus;
                    }
                  }
                }
              }
            }
          } else {
            // Geocoding failed: remove road address, mark for manual input
            failedCount++;
            address = '';
            boardingLocation = '';
            lat = null;
            lng = null;
            assignedBus = null;
          }

          const rawObj = { ...(item.raw || {}) };
          if (!isGeocoded) {
            rawObj['주소입력필요'] = true;
            if (item.address) {
              rawObj['실패주소'] = item.address;
            }
          }

          newStudents.push({
            id: idx + 1,
            name: item.name,
            address: address,
            boardingLocation: boardingLocation,
            lat: lat,
            lng: lng,
            addressNeedsInput: !isGeocoded,
            assignedBusId: assignedBus ? assignedBus.id : null,
            color: assignedBus ? (assignedBus.color || '#64748b') : '#64748b',
            raw: rawObj
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
        
        alert(
          `총 ${newStudents.length}명의 원아 등록이 완료되었습니다!\n\n` +
          `• 정상 배차: ${successCount}명\n` +
          `• 주소 수동 입력 필요: ${failedCount}명\n\n` +
          (failedCount > 0 
            ? '※ 주소 읽기에 실패한 원아는 목록에 [빨간색 테두리]로 표시됩니다. 클릭하여 올바른 도로명 주소를 수동으로 입력해 주세요.'
            : '모든 원아의 주소가 정상적으로 지도 구역에 배차되었습니다.')
        );
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
        const b1 = row['등원차량'] || row['차량'] || row['호차'] || row['등원_차량'];
        const b2 = row['하원차량'] || row['하원_차량'];
        if (b1) busSet.add(b1.toString().trim());
        if (b2) busSet.add(b2.toString().trim());

        // Check '비고', '노선', '코스', '승차지', '탑승차량_승차지' for vehicle patterns
        const note = (row['비고'] || row['노선'] || row['코스'] || row['탑승차량_승차지'] || row['승차지'] || '').toString();
        const match = note.match(/([0-9]+)\s*(?:호차|코스|노선)/);
        if (match) busSet.add(`${match[1]}호차`);
      });

      const busList = Array.from(busSet).sort((a, b) => {
        const na = parseInt(a.replace(/[^0-9]/g, ''), 10) || 0;
        const nb = parseInt(b.replace(/[^0-9]/g, ''), 10) || 0;
        return na - nb;
      });

      // Preserve all registered vehicles of the academy!
      const existingCount = Array.isArray(buses) && buses.length > 0 ? buses.length : (academy?.vehicleCount || 1);
      const count = Math.max(existingCount, busList.length, academy?.vehicleCount || 1);
      const vehicles = Array.from({ length: count }).map((_, i) => ({
        id: buses[i]?.id || (i + 1),
        busNumber: buses[i]?.name || (busList[i] || `${i + 1}호차`),
        plateNumber: buses[i]?.plateNumber || '',
        driverName: buses[i]?.driverName || '미정',
        driverPhone: buses[i]?.driverPhone || '000-0000-0000',
        teacherName: buses[i]?.teacherName || '미정',
        teacherPhone: buses[i]?.teacherPhone || '000-0000-0000',
        capacity: buses[i]?.capacity || 25
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
        
        // Reload state to ensure all existing students are retained, merged, and displayed with new zone assignments
        await loadInitialState(targetAcademyId);
        
        if (showAcademyModal) {
          alert('구역 세팅이 완료되었습니다!\n왼쪽 메뉴의 [버스 정보 관리] 탭에서 기사님과 교사님 정보를 등록해주세요.');
          setSetupStep(2); // Go to Academy Info Input
        } else {
          setIsResettingZones(false);
          alert('구역 매핑이 완료되었습니다!\n기존에 등록된 원생들이 새로운 구역에 자동으로 병합 배차되었습니다.');
        }
      } catch (e) {
        alert(`구역 매핑 재설정에 실패했습니다: ${e.message}`);
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

  const fetchYearlyZoneMappings = async () => {
    try {
      setIsLoadingYearlyMappings(true);
      const targetAcademyId = selectedAcademyId || currentUser?.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/yearly-zone-mappings?academyId=${targetAcademyId || ''}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('takeme_token') || localStorage.getItem('token') || ''}`,
          'x-academy-id': String(targetAcademyId || '')
        }
      });
      if (res.ok) {
        const data = await res.json();
        setYearlyZoneMappings(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error('Failed to fetch yearly zone mappings', e);
    } finally {
      setIsLoadingYearlyMappings(false);
    }
  };

  const handleResetZones = async () => {
    if (!window.confirm(
      '현재 지도 구역 매핑을 전년도 구역 매핑 DB에 안전하게 보관하고, 지도의 구역을 초기화하시겠습니까?\n\n' +
      '• 관리자 및 기사/교사 계정 정보는 안전하게 보존됩니다.\n' +
      '• 초기화 후 새 엑셀 시트를 업로드하여 새로운 구역 정보를 저장할 수 있습니다.'
    )) {
      return;
    }

    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser?.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/reset-zones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('takeme_token') || localStorage.getItem('token') || ''}`,
          'x-academy-id': String(targetAcademyId || '')
        },
        body: JSON.stringify({ academyId: targetAcademyId })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message || '구역 매핑이 전년도 DB에 보관되었으며, 활성 구역이 초기화되었습니다.');
        setActiveTab('status');
        setIsResettingZones(true);
        await loadInitialState(targetAcademyId);
        await fetchYearlyZoneMappings();
      } else {
        alert(result.message || '초기화 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('초기화 요청 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExpandZonesToStudents = async () => {
    if (!window.confirm(
      '현재 매핑된 구역을 기반으로 근처 학생들 위치까지 구역을 확장하고 차량 배차를 자동 재배정하시겠습니까?\n\n' +
      '• 각 차량의 운행 구역이 배정된 원아의 탑승 위치까지 자동으로 확장됩니다.\n' +
      '• 각 차량의 구역 폴리곤이 학생 위치를 포함하도록 자연스럽게 확장됩니다.\n' +
      '• 구역 간 경계는 서로 겹치지 않고 정확하게 맞닿게 유지됩니다.'
    )) {
      return;
    }

    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser?.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/expand-zones-to-students`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
          'x-academy-id': String(targetAcademyId || '')
        },
        body: JSON.stringify({ academyId: targetAcademyId })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || '구역 확장 처리에 실패했습니다.');
      }

      const data = await res.json();
      await loadInitialState(targetAcademyId);

      const summaryText = (data.vehicles || [])
        .map(v => `${v.busNumber}: ${v.studentCount}명`)
        .join(', ');

      alert(
        `구역 확장 및 학생 재배차가 완료되었습니다!\n\n` +
        `• 재배차 원아 수: 총 ${data.count || 0}명\n` +
        `• 차량별 배차 현황: ${summaryText || '완료'}`
      );
    } catch (e) {
      console.error(e);
      alert(`구역 확장 및 재배차 중 오류가 발생했습니다: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleArchiveCurrentMapping = async () => {
    const title = window.prompt('전년도 구역 매핑으로 저장할 제목을 입력해주세요:', `${new Date().getFullYear() - 1}학년도 구역 매핑`);
    if (title === null) return;

    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser?.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/yearly-zone-mappings/archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('takeme_token') || localStorage.getItem('token') || ''}`,
          'x-academy-id': String(targetAcademyId || '')
        },
        body: JSON.stringify({
          academyId: targetAcademyId,
          academicYear: '전년도',
          title: title.trim() || '전년도 구역 매핑 이력'
        })
      });
      const result = await res.json();
      if (res.ok && result) {
        alert('현재 구역 매핑이 전년도 구역 매핑 DB에 성공적으로 보관되었습니다.');
        await fetchYearlyZoneMappings();
      } else {
        alert('보관할 활성 구역 매핑이 없거나 저장에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('보관 처리 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestoreYearlyMapping = async (mappingId, title) => {
    if (!window.confirm(`'${title}' 구역 매핑을 현재 지도에 복원하시겠습니까?\n\n• 복원 전 현재 구역 매핑은 자동 백업됩니다.\n• 계정 및 차량 ID는 안전하게 보존됩니다.`)) {
      return;
    }
    try {
      setIsProcessing(true);
      const targetAcademyId = selectedAcademyId || currentUser?.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/yearly-zone-mappings/${mappingId}/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('takeme_token') || localStorage.getItem('token') || ''}`,
          'x-academy-id': String(targetAcademyId || '')
        },
        body: JSON.stringify({ academyId: targetAcademyId })
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert(result.message || '전년도 구역 매핑이 성공적으로 복원되었습니다.');
        setShowYearlyMappingModal(false);
        await loadInitialState(targetAcademyId);
        await fetchYearlyZoneMappings();
      } else {
        alert(result.message || '복원 처리 중 오류가 발생했습니다.');
      }
    } catch (e) {
      console.error(e);
      alert('복원 요청 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteYearlyMapping = async (mappingId, title) => {
    if (!window.confirm(`'${title}' 전년도 구역 매핑 이력을 삭제하시겠습니까?`)) {
      return;
    }
    try {
      const targetAcademyId = selectedAcademyId || currentUser?.academyId;
      const res = await fetch(`${API_BASE_URL}/routing/yearly-zone-mappings/${mappingId}?academyId=${targetAcademyId || ''}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('takeme_token') || localStorage.getItem('token') || ''}`,
          'x-academy-id': String(targetAcademyId || '')
        }
      });
      const result = await res.json();
      if (res.ok && result.success) {
        alert('삭제되었습니다.');
        await fetchYearlyZoneMappings();
        if (selectedYearlyMapping?.id === mappingId) {
          setSelectedYearlyMapping(null);
        }
      }
    } catch (e) {
      console.error(e);
      alert('삭제 중 오류가 발생했습니다.');
    }
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
    if (!studentForm.isNotRiding && !studentForm.address.trim()) {
      alert('도로명 주소를 입력해주세요.');
      return;
    }

    setIsProcessing(true);
    try {
      const targetAcademyId = selectedAcademyId || currentUser.academyId;

      // 1. Geocode address via backend geocode-bulk endpoint if address is provided
      let coords = null;
      if (!studentForm.isNotRiding && studentForm.address.trim()) {
        try {
          const geoRes = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ addresses: [studentForm.address.trim()] })
          });
          if (geoRes.ok) {
            const geocoded = await geoRes.json();
            coords = geocoded[0]?.coords || null;
          }
        } catch (geoErr) {
          console.warn('Geocoding error:', geoErr);
        }
      }

      let assignedBusId = studentForm.isNotRiding ? null : (studentForm.assignedBusId ? Number(studentForm.assignedBusId) : null);
      let assignedDepartureBusId = studentForm.isNotRiding ? null : (studentForm.assignedDepartureBusId ? Number(studentForm.assignedDepartureBusId) : null);
      let assignedBus = buses.find(b => b.id === assignedBusId);
      let assignedDepartureBus = buses.find(b => b.id === assignedDepartureBusId);

      // 2. Auto-assign vehicle by zone polygon if not manually selected
      if (!studentForm.isNotRiding && !assignedBusId && coords) {
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
      const outLoc = studentForm.dropoffLocation?.trim() || studentForm.outLocation?.trim() || studentForm.address.trim();

      const payload = {
        name: studentForm.name.trim(),
        address: studentForm.address.trim(),
        boardingLocation: inLoc,
        dropoffLocation: outLoc,
        lat: coords ? coords.lat : undefined,
        lng: coords ? coords.lng : undefined,
        assignedBusId: assignedBusId,
        assignedDepartureBusId: assignedDepartureBusId,
        isNotRiding: Boolean(studentForm.isNotRiding),
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
        inBus: studentForm.isNotRiding ? '' : (assignedBus?.name || ''),
        outBus: studentForm.isNotRiding ? '' : (assignedDepartureBus?.name || assignedBus?.name || ''),
        inTime: studentForm.inTime.trim(),
        outTime: studentForm.outTime.trim(),
        allergies: studentForm.allergies.trim(),
        note: studentForm.note.trim(),
        academyId: targetAcademyId
      };

      const res = editingStudentId
        ? await fetch(`${API_BASE_URL}/routing/student/${editingStudentId}${targetAcademyId ? `?academyId=${targetAcademyId}` : ''}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`${API_BASE_URL}/routing/add-student`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || (editingStudentId ? '원생 정보 수정 실패' : '원생 등록 실패'));
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
      alert(
        editingStudentId
          ? `'${studentForm.name}' 원아 정보 및 주소가 성공적으로 수정되었습니다!\n${busInfo}`
          : `'${studentForm.name}' 원아가 성공적으로 추가되었습니다!\n${busInfo}`
      );
      setShowAddStudentModal(false);
      setEditingStudentId(null);
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
        allergies: '',
        note: ''
      });
    } catch (err) {
      console.error(err);
      alert(`원생 처리 중 오류가 발생했습니다: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenAddStudentModal = () => {
    setEditingStudentId(null);
    setStudentForm({
      name: '',
      address: '',
      inLocation: '',
      outLocation: '',
      className: '',
      kindergartenName: academy?.name || '',
      age: '',
      gender: '남',
      parentName: '',
      parentPhone: '',
      teacherName: '',
      departureType: '정규하원',
      assignedBusId: '',
      assignedDepartureBusId: '',
      isNotRiding: false,
      dropoffLocation: '',
      inTime: '',
      outTime: '',
      allergies: '',
      note: ''
    });
    setShowAddStudentModal(true);
  };

  const handleOpenEditStudentModal = (student) => {
    setEditingStudentId(student.id);
    const raw = student.raw || {};
    setStudentForm({
      name: student.realName || student.name || '',
      address: student.address || raw['주소'] || raw['실패주소'] || '',
      inLocation: student.boardingLocation || raw['등원지'] || raw['탑승지'] || student.address || '',
      outLocation: raw['하원지'] || student.boardingLocation || student.address || '',
      className: raw['반명'] || raw['반'] || '',
      kindergartenName: raw['유치원명'] || raw['소속원명'] || raw['학교명'] || academy?.name || '',
      age: raw['연령'] !== undefined && raw['연령'] !== null ? String(raw['연령']) : (raw['학년'] ? String(raw['학년']) : ''),
      gender: raw['성별'] || '남',
      parentName: raw['보호자 성함'] || raw['학부모 성함'] || raw['학부모명'] || student.parentName || '',
      parentPhone: raw['부모연락처'] || raw['보호자연락처'] || raw['보호자 연락처'] || student.parentPhone || '',
      teacherName: raw['담임명'] || '',
      departureType: raw['하원구분'] || raw['하원정보'] || '정규하원',
      assignedBusId: student.assignedBusId ? String(student.assignedBusId) : '',
      assignedDepartureBusId: student.assignedDepartureBusId ? String(student.assignedDepartureBusId) : '',
      isNotRiding: Boolean(student.isNotRiding || raw['미탑승'] || raw['차량미탑승']),
      dropoffLocation: student.dropoffLocation || raw['하차지'] || raw['하원지'] || '',
      inTime: raw['등원시간'] || '',
      outTime: raw['하원시간'] || '',
      allergies: student.allergies || raw['알레르기'] || '',
      note: raw['비고'] || ''
    });
    setShowAddStudentModal(true);
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
  if (isTeacherRole) {
    return (
      <TeacherDashboard
        currentUser={currentUser}
        academy={academy}
        buses={buses}
        students={students}
        availableClasses={availableClasses}
        selectedAcademyId={selectedAcademyId}
        socket={socketRef.current}
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
      {/* 긴급 사고·고장 비상 알림 (빨간 줄 알림 배너 - 사용자가 확인할 때까지 유지) */}
      {emergencyAlert && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white px-6 py-4 shadow-2xl flex items-center justify-between border-b-4 border-red-700 animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-3.5">
            <span className="text-3xl animate-pulse">🚨</span>
            <div>
              <div className="font-black text-lg tracking-wide flex items-center gap-2">
                <span>[긴급 사고·고장 비상 알림]</span>
                <span className="bg-white/20 px-2 py-0.5 rounded text-sm">{emergencyAlert.vehicleName}</span>
                <span className="text-sm font-bold text-red-100">기사: {emergencyAlert.driverName}</span>
              </div>
              <div className="text-xs text-red-100 mt-1">
                발생 시각: {emergencyAlert.time ? new Date(emergencyAlert.time).toLocaleTimeString('ko-KR') : '방금'} · 지도에서 해당 차량 위치로 포커스되었습니다.
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {emergencyAlert.lat && emergencyAlert.lng && (
              <button
                type="button"
                onClick={() => setMapFocusTarget([parseFloat(emergencyAlert.lat), parseFloat(emergencyAlert.lng)])}
                className="px-3.5 py-1.5 bg-white/20 hover:bg-white/30 text-white font-bold text-xs rounded-lg transition"
              >
                위치 보기
              </button>
            )}
            <button
              type="button"
              onClick={() => setEmergencyAlert(null)}
              className="px-5 py-2 bg-white text-red-600 hover:bg-red-50 font-black text-sm rounded-lg shadow transition"
            >
              확인
            </button>
          </div>
        </div>
      )}

      {/* 동승 시작 알림 배너 (파란색, 소리 없음, 몇 초 뒤 사라짐) */}
      {escortToast && (
        <div className="fixed top-5 right-5 z-[9999] bg-blue-600 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-3 border border-blue-400 animate-in slide-in-from-top duration-300">
          <span className="text-xl">🚌</span>
          <div>
            <div className="font-extrabold text-sm">{escortToast.vehicleName} 동승 시작</div>
            <div className="text-xs text-blue-100">
              지도교사: {escortToast.escortName} ({escortToast.time ? new Date(escortToast.time).toLocaleTimeString('ko-KR') : ''})
            </div>
          </div>
        </div>
      )}

      {/* 실시간 출석부 제출 알림 배너 (파란색 토스트) */}
      {attendanceToast && (
        <div className="fixed top-20 right-5 z-[9999] bg-blue-600 text-white px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3.5 border border-blue-400 animate-in slide-in-from-top duration-300">
          <span className="text-2xl">📋</span>
          <div>
            <div className="font-extrabold text-sm">
              [{attendanceToast.className}] {attendanceToast.teacherName} 선생님이 출석부를 제출했습니다.
            </div>
            <div className="text-xs text-blue-100 mt-0.5">
              출석 {attendanceToast.presentCount} · 결석 {attendanceToast.absentCount} · 지각 {attendanceToast.lateCount} · 조퇴 {attendanceToast.earlyLeaveCount} (총 {attendanceToast.totalCount}명)
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAttendanceToast(null)}
            className="ml-3 text-blue-200 hover:text-white text-base font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Yearly Zone Mapping History Modal */}
      {showYearlyMappingModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-blue-50/40">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">전년도 구역 매핑 보관함</h3>
                  <p className="text-xs text-slate-500">과거 구역 매핑 내역을 확인하거나 필요 시 현재 지도로 복원할 수 있습니다.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleArchiveCurrentMapping}
                  disabled={isProcessing}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 shadow-xs"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  현재 구역 보관하기
                </button>
                <button
                  type="button"
                  onClick={() => setShowYearlyMappingModal(false)}
                  className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-3.5 flex-1 bg-slate-50/50">
              {isLoadingYearlyMappings ? (
                <div className="py-12 text-center text-slate-400 text-sm">
                  전년도 구역 매핑 내역을 불러오는 중입니다...
                </div>
              ) : yearlyZoneMappings.length === 0 ? (
                <div className="py-12 px-4 text-center rounded-xl bg-white border border-dashed border-slate-200">
                  <p className="text-sm font-bold text-slate-600 mb-1">보관된 전년도 구역 매핑이 없습니다</p>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    '현재 구역 보관하기' 버튼을 누르거나, 새 엑셀 시트 업로드 및 매핑 초기화 시 이전 구역 매핑이 자동으로 이곳에 안전하게 보관됩니다.
                  </p>
                </div>
              ) : (
                yearlyZoneMappings.map(item => (
                  <div key={item.id} className="p-4 bg-white rounded-xl border border-slate-200 shadow-2xs hover:border-blue-300 transition-all space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
                            {item.academicYear || '전년도'}
                          </span>
                          <h4 className="font-bold text-slate-800 text-sm">{item.title}</h4>
                        </div>
                        <p className="text-xs text-slate-400">
                          보관 일시: {new Date(item.archivedAt).toLocaleString('ko-KR')} · 차량 {item.totalVehicles || item.vehicleMappings?.length || 0}대 · 배정 원아 {item.totalStudents || 0}명
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleRestoreYearlyMapping(item.id, item.title)}
                          disabled={isProcessing}
                          className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold border border-blue-200 transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          구역 복원
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedYearlyMapping(selectedYearlyMapping?.id === item.id ? null : item)}
                          className="px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold border border-slate-200 transition-colors"
                        >
                          {selectedYearlyMapping?.id === item.id ? '상세 닫기' : '상세 보기'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteYearlyMapping(item.id, item.title)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="삭제"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Vehicle pill summary */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Array.isArray(item.vehicleMappings) && item.vehicleMappings.map((vm, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold bg-slate-50 border border-slate-200 text-slate-700"
                        >
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: vm.colorHex || '#3b82f6' }} />
                          {vm.busNumber} ({vm.studentCount || 0}명)
                        </span>
                      ))}
                    </div>

                    {/* Expandable Details */}
                    {selectedYearlyMapping?.id === item.id && (
                      <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-2">
                        <p className="font-bold text-slate-700">호차별 상세 정보:</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {item.vehicleMappings.map((vm, idx) => (
                            <div key={idx} className="p-2 bg-white rounded-md border border-slate-200">
                              <div className="flex items-center justify-between font-bold text-slate-800">
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: vm.colorHex || '#3b82f6' }} />
                                  {vm.busNumber} {vm.plateNumber ? `(${vm.plateNumber})` : ''}
                                </span>
                                <span className="text-blue-600">{vm.studentCount || 0}명</span>
                              </div>
                              <p className="text-slate-500 text-2xs mt-1">
                                기사: {vm.driverName || '미정'} · 교사: {vm.teacherName || '미정'}
                              </p>
                              <p className="text-slate-400 text-2xs">
                                폴리곤 꼭짓점: {Array.isArray(vm.polygonCoordinates) ? vm.polygonCoordinates.length : 0}개 지점
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-white">
              <span className="text-xs text-slate-400">
                초기화 또는 새 엑셀 시트 업로드 시 기존 매핑이 이 보관함에 자동으로 백업됩니다.
              </span>
              <button
                type="button"
                onClick={() => setShowYearlyMappingModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Academy Registration Modal Overlay */}
      {showAcademyModal && (
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 transform transition-all">
            {setupStep === 1 && (
              <>
                <div className="text-center mb-6">
                  
                  <h2 className="text-2xl font-bold text-slate-800">초기 구역 설정</h2>
                  <p className="text-slate-500 text-sm mt-2">전년도 배차 기준 파일을 업로드하여 기본 구역을 세팅해주세요.</p>
                </div>
                
                <div className="p-3 bg-red-100/50 rounded-lg mb-4 text-left">
                  <p className="text-xs text-red-800 font-bold">작성 안내</p>
                  <p className="text-xs text-red-700 mt-1">
                    아래에서 양식을 다운로드한 후, <b>하이라이트 표시된 필수 항목(등원지, 하원지, 차량)</b>만 채워주시면 됩니다.<br/>해당 장소들을 바탕으로 자동으로 픽업/드랍 구역이 나뉩니다.
                  </p>
                </div>

                <a href="/전년도_자료_입력_시트_양식_최종.xlsx" download="전년도_자료_입력_시트_양식_최종.xlsx" className="w-full py-3 mb-3 bg-white text-slate-700 rounded-xl text-sm font-bold border border-slate-200 shadow-sm hover:bg-slate-50 transition-colors flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  전년도 양식 다운로드 (최종)
                </a>
                
                <input type="file" accept=".xlsx, .xls" className="hidden" ref={setupFileInputRef} onChange={handleZoneResetUpload} />
                <button 
                  onClick={() => setupFileInputRef.current.click()}
                  disabled={isProcessing}
                  className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-colors shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  {isProcessing ? '구역 세팅 중...' : '엑셀 업로드 및 시작하기'}
                </button>
                <button 
                  type="button"
                  onClick={() => setSetupStep(2)}
                  className="w-full mt-3 py-2 text-xs font-semibold text-slate-500 hover:text-blue-600 transition-colors underline"
                >
                  엑셀 파일 없이 유치원 정보 직접 등록하기 &rarr;
                </button>
              </>
            )}
            
            {setupStep === 2 && (
              <>
                <div className="text-center mb-6">
                  <h2 className="text-2xl font-bold text-slate-800">유치원 정보 등록</h2>
                  <p className="text-slate-500 text-sm mt-2">지도의 중심이 될 유치원 위치와 사업자등록번호를 등록해주세요.</p>
                </div>
                
                <form onSubmit={handleAcademySubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">유치원명 <span className="text-red-500">*</span></label>
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
                    <label className="block text-sm font-bold text-slate-700 mb-1">사업자 등록번호</label>
                    <input 
                      type="text" 
                      value={academyForm.businessNumber || ''} 
                      onChange={e => setAcademyForm({...academyForm, businessNumber: formatBusinessNumber(e.target.value)})}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all tracking-wider"
                      placeholder="예: 123-45-67890 (10자리)"
                      maxLength={12}
                    />
                    <p className="text-[11px] text-slate-400 mt-1">숫자 10자리를 입력하시면 하이픈(-)이 자동으로 적용됩니다.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-1">원 도로명 주소 <span className="text-red-500">*</span></label>
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
                    {isProcessing ? '위치 확인 및 저장 중...' : '모든 설정 완료하고 메인으로'}
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
        <div className="text-xs text-blue-200 text-center truncate max-w-[70px] mb-4 font-medium" title={currentUser.name}>
          {isSuperAdmin ? '플랫폼관리' : (currentUser.name ? `${currentUser.name} 관리자님` : '관리자님')}
        </div>
        <button 
          onClick={() => handleTabChange('status')} 
          className={`p-4 rounded-2xl transition-all ${activeTab === 'status' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} 
          title="차량 및 구역 관리"
        >
          {/* 차량 및 통학버스 아이콘 */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4zM4 6a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm0 5h16M9 6v5m6-5v5" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('students')} className={`p-4 rounded-2xl transition-all ${activeTab === 'students' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="원생 정보">
          {/* 유치원생 돔형 통학모 아이콘 (사이드바 통일 라인 스타일) */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {/* 상단 꼭지 단추 */}
            <ellipse cx="12" cy="4.9" rx="1.3" ry="0.7" />
            {/* 돔형 크라운 (모자 몸통) */}
            <path d="M5.2 14 C4.6 9.2 7.8 5.6 10.7 5.2 M13.3 5.2 C16.2 5.6 19.4 9.2 18.8 14" />
            {/* 돔 하단 이마 곡선 */}
            <path d="M5.2 14 C8 16.2 16 16.2 18.8 14" />
            {/* 유치원 모자 챙 (Brim) */}
            <path d="M5.2 14 C3.2 14.8 1.8 15.8 1.2 16.8 C4.5 20.6 19.5 20.6 22.8 16.8 C22.2 15.8 20.8 14.8 18.8 14" />
            {/* 패널 절개선 */}
            <path d="M11.2 5.5 C9.8 8.8 8.8 12.2 8.5 15.8" />
            <path d="M12.8 5.5 C14.2 8.8 15.2 12.2 15.5 15.8" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('classes')} className={`p-4 rounded-2xl transition-all ${activeTab === 'classes' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="반 관리">
          {/* 교실 학급 칠판 아이콘 */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="12" rx="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h5m-3 4v4m6-4v4m-8 0h10" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('attendance')} className={`p-4 rounded-2xl transition-all ${activeTab === 'attendance' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="출석 현황">
          {/* 출석 체크보드 아이콘 */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('auth')} className={`p-4 rounded-2xl transition-all ${activeTab === 'auth' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="인증 관리">
          {/* 가입 승인 및 인증 방패 아이콘 */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('log')} className={`p-4 rounded-2xl transition-all ${activeTab === 'log' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="캘린더 및 로그보기">
          {/* 캘린더 달력 아이콘 */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth={2} />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
          </svg>
        </button>
        <button onClick={() => handleTabChange('messages')} className={`p-4 rounded-2xl transition-all ${activeTab === 'messages' ? 'bg-white text-blue-700 shadow-lg scale-110' : 'text-blue-200 hover:bg-blue-600'}`} title="메세지함">
          {/* 대화 및 메시지함 아이콘 */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
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
      <div className={`bg-white shadow-lg z-10 flex flex-col w-[380px] shrink-0 break-keep ${activeTab === 'messages' ? 'hidden' : ''}`}>

        {(activeTab === 'status' || activeTab === 'buses') && (
          <div className="p-6 h-full flex flex-col overflow-y-auto break-keep">
            {/* Header */}
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-800">차량 및 구역 관리</h2>
                <span className="text-xs px-2.5 py-1 rounded-lg font-black bg-blue-100 text-blue-700 border border-blue-200 shadow-xs">
                  {activeEducationLevel}
                </span>
              </div>
              <p className="text-[13px] text-slate-500 mt-1">호차별 운행 구역, 차량 정보 및 탑승 원생을 통합 관리합니다.</p>
            </div>

            {/* Action Buttons: Integrated Zone Mapping & Pickup Points */}
            <div className="space-y-2.5 mb-4">
              <button
                type="button"
                onClick={() => {
                  const presetColors = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#ea580c'];
                  setNewBusForm({
                    name: `${buses.length + 1}호차`,
                    busNumber: `${buses.length + 1}호차`,
                    plateNumber: '',
                    driverName: '',
                    driverPhone: '',
                    teacherName: '',
                    teacherPhone: '',
                    capacity: 25,
                    color: presetColors[buses.length % presetColors.length] || '#2563eb',
                  });
                  setShowAddBusModal(true);
                }}
                className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-xs hover:shadow-md transition-all flex items-center justify-center gap-1.5 text-xs sm:text-sm active:scale-[0.99] cursor-pointer"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                <span>새 통학 차량 추가</span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setIsResettingZones(!isResettingZones)}
                  className={`w-full py-2.5 px-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 shadow-xs whitespace-nowrap ${
                    isResettingZones
                      ? 'bg-blue-600 text-white border-blue-600 shadow-inner'
                      : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
                  </svg>
                  {isResettingZones ? '엑셀 매핑 닫기' : '구역 매핑 엑셀'}
                </button>

                <button
                  onClick={() => {
                    setIsZoneEditingMode(!isZoneEditingMode);
                    if (isZoneEditingMode) setEditingZoneBusId(null);
                  }}
                  className={`w-full py-2.5 px-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 shadow-xs whitespace-nowrap ${
                    isZoneEditingMode
                      ? 'bg-amber-500 text-white border-amber-500 shadow-inner'
                      : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100 hover:border-amber-300'
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  {isZoneEditingMode ? '구역 수정 종료' : '구역 매핑 수정'}
                </button>
              </div>

              {/* Integrated Zone Remapping Panel */}
              {isResettingZones && (
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50/60 rounded-2xl border border-blue-200 shadow-xs space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-blue-900 text-xs flex items-center gap-1.5">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                      구역 매핑 엑셀 업로드 및 원생 자동 병합
                    </span>
                    <button 
                      onClick={() => setIsResettingZones(false)}
                      className="text-xs text-slate-400 hover:text-slate-600 font-bold"
                    >
                      닫기
                    </button>
                  </div>
                  <p className="text-xs text-blue-700 leading-relaxed">
                    새 엑셀 파일의 <b>등원지, 하원지, 차량</b> 데이터를 바탕으로 운행 구역(폴리곤)을 재계산합니다. <b>기존에 등록된 원생 및 선생님 정보는 보존</b>되며 새 구역으로 자동 병합 배차됩니다.
                  </p>
                  <input type="file" accept=".xlsx, .xls" className="hidden" ref={resetFileInputRef} onChange={handleZoneResetUpload} />
                  <div className="pt-2 border-t border-blue-200/60 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        fetchYearlyZoneMappings();
                        setShowYearlyMappingModal(true);
                      }}
                      className="flex-1 py-1.5 px-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold border border-indigo-200 transition-colors flex items-center justify-center gap-1 shadow-2xs whitespace-nowrap"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      전년도 구역 매핑 이력
                    </button>
                    <button
                      type="button"
                      onClick={handleResetZones}
                      disabled={isProcessing}
                      className="py-1.5 px-2.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold border border-rose-200 transition-colors flex items-center justify-center gap-1 shadow-2xs whitespace-nowrap disabled:opacity-50"
                      title="현재 구역 매핑을 전년도 DB에 보관하고 지도를 초기화합니다"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      구역 매핑 초기화
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <a 
                      href="/전년도_자료_입력_시트_양식_최종.xlsx" 
                      download="전년도_자료_입력_시트_양식_최종.xlsx" 
                      className="flex-1 py-2 px-3 bg-white text-slate-700 rounded-xl text-xs border border-slate-200 shadow-xs hover:bg-slate-50 transition-colors flex items-center justify-center font-bold whitespace-nowrap gap-1"
                    >
                      <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      양식 다운로드
                    </a>
                    <button 
                      onClick={() => resetFileInputRef.current && resetFileInputRef.current.click()} 
                      disabled={isProcessing}
                      className="flex-1 py-2 px-3 bg-blue-600 text-white rounded-xl text-xs font-bold shadow-xs hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center justify-center gap-1.5"
                    >
                      {isProcessing ? '구역 매핑 처리 중...' : '새 엑셀 업로드'}
                    </button>
                  </div>
                  <div className="p-2.5 bg-blue-50/70 border border-blue-200/60 rounded-xl text-xs text-blue-800 space-y-1">
                    <div className="font-bold flex items-center gap-1 text-blue-900">
                      <svg className="w-3.5 h-3.5 text-blue-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>전년도 매핑 엑셀 작성 안내</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-blue-700">
                      승차지/하차지 또는 비고란에 <b>'1호차 (도로명 주소)'</b> 형태로 호차를 표기해주시면, 호차별 실제 운행 거점이 0% 겹침으로 정확하게 지도에 매핑됩니다.
                    </p>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleExpandZonesToStudents}
                      disabled={isProcessing}
                      className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                      title="현재 매핑된 구역을 등록된 원아 위치 기준으로 확장하고 차량 배차를 자동 재배정합니다"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      </svg>
                      {isProcessing ? '구역 확장 및 재배차 중...' : '구역 확장 및 자동 재배차'}
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => setShowPickupPoints(!showPickupPoints)} 
                  className={`w-full py-2.5 px-2 rounded-xl text-sm font-bold border transition-all whitespace-nowrap text-center ${
                    showPickupPoints 
                      ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-inner' 
                      : 'border-slate-200 bg-white text-slate-600 hover:border-orange-300 hover:text-orange-600 shadow-xs'
                  }`}
                >
                  {showPickupPoints ? '탑승지 숨기기' : '탑승지 보기'}
                </button>
                <button 
                  onClick={() => setIsAddingPickupPoint(!isAddingPickupPoint)} 
                  className={`w-full py-2.5 px-2 rounded-xl text-sm font-bold border transition-all whitespace-nowrap text-center ${
                    isAddingPickupPoint 
                      ? 'border-purple-500 bg-purple-50 text-purple-700 shadow-inner' 
                      : 'border-slate-200 bg-white text-slate-600 hover:border-purple-300 hover:text-purple-600 shadow-xs'
                  }`}
                >
                  {isAddingPickupPoint ? '위치 클릭 중...' : '+ 탑승지 추가'}
                </button>
              </div>
            </div>

            {/* Bus Cards List */}
            <div className="space-y-3.5 overflow-y-auto pr-0.5 flex-1">
              {sortedBuses.length === 0 ? (
                <div className="text-slate-400 text-sm text-center py-10">등록된 버스가 없습니다.</div>
              ) : (
                sortedBuses.map(bus => {
                  const isSelected = selectedBusId === bus.id;
                  const busStudents = students.filter(st => st.assignedBusId === bus.id);

                  return (
                    <div 
                      key={bus.id} 
                      className={`p-4 border rounded-2xl transition-all shadow-xs ${
                        isSelected 
                          ? 'border-blue-500 bg-blue-50/20 ring-2 ring-blue-100' 
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      {/* Bus Card Header */}
                      <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2.5">
                        <div 
                          className="flex items-center gap-2.5 cursor-pointer min-w-0"
                          onClick={() => setSelectedBusId(isSelected ? null : bus.id)}
                        >
                          <div className="w-3.5 h-3.5 rounded-full shadow-xs shrink-0" style={{ backgroundColor: bus.color }}></div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-slate-900 text-base">{bus.name}</span>
                              {bus.plateNumber && (
                                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded font-mono">
                                  {bus.plateNumber}
                                </span>
                              )}
                              {operatingBuses[bus.id] && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-extrabold bg-emerald-500 text-white animate-pulse shadow-xs">
                                  운행중
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingBus(bus);
                          }}
                          className="text-xs bg-slate-100 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg hover:bg-blue-50 hover:text-blue-600 transition-colors whitespace-nowrap shrink-0 border border-slate-200/80"
                        >
                          상세 설정
                        </button>
                          <button 
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteBus(bus);
                            }}
                            className="text-xs bg-white text-slate-400 hover:text-red-600 hover:bg-red-50 font-bold px-2 py-1.5 rounded-lg transition-colors whitespace-nowrap border border-slate-200 hover:border-red-200 cursor-pointer"
                            title="차량 삭제"
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {/* Info Summary Grid */}
                      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                        <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <span className="text-slate-400 block text-xs font-medium">기사님</span>
                          <span className="font-bold text-slate-800 truncate block mt-0.5">
                            {bus.driverName || '미등록'}
                          </span>
                        </div>
                        <div className="bg-slate-50 p-2 rounded-xl border border-slate-100">
                          <span className="text-slate-400 block text-xs font-medium">지도교사</span>
                          <span className="font-bold text-slate-800 truncate block mt-0.5">
                            {bus.teacherName || '미등록'}
                          </span>
                        </div>
                      </div>

                      {/* Zone & Students Status Bar */}
                      <div 
                        className="flex items-center justify-between text-xs cursor-pointer p-2 rounded-xl bg-slate-50/70 hover:bg-slate-100/70 transition-colors"
                        onClick={() => setSelectedBusId(isSelected ? null : bus.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-700">배정 원아</span>
                          <span className="bg-blue-100 text-blue-700 font-bold px-1.5 py-0.2 rounded text-xs">
                            {busStudents.length}명
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-slate-400">
                          <span className="text-xs">{isSelected ? '접기' : '명단보기'}</span>
                          <svg className={`w-3.5 h-3.5 transition-transform ${isSelected ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expandable Students List */}
                      {isSelected && (
                        <div className="mt-3 border-t border-slate-100 pt-3 space-y-1.5">
                          <div className="text-xs font-bold text-slate-500 flex justify-between px-1 mb-1">
                            <span>배정 학생 명단</span>
                            <span>{busStudents.length}명</span>
                          </div>
                          {busStudents.length > 0 ? (
                            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                              {busStudents.map(st => (
                                <div key={st.id} className="text-xs flex justify-between items-center bg-slate-50 p-2 rounded-lg border border-slate-100">
                                  <span className="font-bold text-slate-700 truncate">{st.name}</span>
                                  <span className="text-slate-400 truncate max-w-[150px] text-right" title={st.address || st.boardingLocation}>
                                    {st.boardingLocation || st.address || '위치 미등록'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-center text-xs text-slate-400 py-3 bg-slate-50 rounded-xl">
                              배정된 원아가 없습니다.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {activeTab === 'students' && (
          <div className="p-4 h-full flex flex-col">
            <h2 className="text-lg font-bold text-slate-800 mb-1 text-center">원아 정보</h2>
            <p className="text-[13px] text-slate-500 mb-3 text-center">
              원아를 직접 추가하거나 엑셀 파일로 일괄 등록할 수 있습니다.
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
              onClick={handleOpenAddStudentModal}
              className="w-full py-2.5 px-3 mb-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-2 text-sm active:scale-[0.99]"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              원아 추가
            </button>

            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isProcessing}
              className="w-full py-2.5 px-3 mb-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl border border-slate-200 transition-colors disabled:opacity-50 text-center text-sm flex items-center justify-center gap-1.5"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l4-4m0 0l4 4m-4-4v12" />
              </svg>
              {isProcessing ? '처리 중...' : '원아 엑셀 업로드'}
            </button>

            <a 
              href="/원아_정보_입력_시트.xlsx" 
              download="원아_정보_입력_시트.xlsx" 
              className="w-full py-2 mb-2 bg-white text-slate-600 rounded-xl text-[13px] font-semibold border border-slate-200 shadow-xs hover:bg-slate-50 transition-colors text-center flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              원아 등록 양식 다운로드
            </a>

            <button
              type="button"
              onClick={() => {
                setSelectedPaymentStudent(null);
                handleTabChange('messages');
              }}
              className="w-full py-2 mb-3 bg-gradient-to-r from-indigo-50 to-blue-50 hover:from-indigo-100 hover:to-blue-100 text-indigo-700 rounded-xl text-xs font-black border border-indigo-200 shadow-2xs transition-all flex items-center justify-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              <span>상담 탑승지 등록 및 결제 신청</span>
            </button>

            {students.length > 0 ? (
              <div className="mt-1 flex-1 flex flex-col min-h-0">
                {/* Header with Title and Count */}
                <div className="flex justify-between items-center mb-2 border-b pb-1.5 shrink-0">
                  <h3 className="font-bold text-slate-700 text-sm">등록 원아 목록</h3>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                      총 {students.length}명 {filteredStudents.length !== students.length ? `(검색 ${filteredStudents.length}명)` : ''}
                    </span>
                  </div>
                </div>

                {/* Student Search and Class Filter Bar */}
                <div className="flex items-center gap-1.5 mb-2 shrink-0">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={studentSearchKeyword}
                      onChange={(e) => setStudentSearchKeyword(e.target.value)}
                      placeholder="원아명, 전화번호 검색..."
                      className="w-full pl-7 pr-6 py-1.5 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition"
                    />
                    <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    {studentSearchKeyword && (
                      <button
                        type="button"
                        onClick={() => setStudentSearchKeyword('')}
                        className="absolute right-2 top-1 text-slate-400 hover:text-slate-600 text-xs font-bold"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <select
                    value={studentClassFilter}
                    onChange={(e) => setStudentClassFilter(e.target.value)}
                    className="w-24 py-1.5 px-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 text-slate-700 shrink-0"
                  >
                    <option value="ALL">전체 반</option>
                    {availableClasses.map(cls => (
                      <option key={cls} value={cls}>{cls}</option>
                    ))}
                  </select>
                </div>

                {/* Filter Mode Selector: 전체 / 반별 / 연령별 / 차량별 */}
                <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl mb-2 shrink-0 text-[13px] font-bold">
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

                {/* Sort Bar: 이름순 / 나이순 / 반 순서 */}
                <div className="flex items-center justify-between mb-2 px-1 text-xs shrink-0">
                  <span className="font-bold text-slate-500">
                    정렬 기준
                  </span>
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => setStudentSortBy('NAME')}
                      className={`px-2.5 py-1 rounded-md transition-all ${studentSortBy === 'NAME' ? 'bg-white text-blue-700 shadow-2xs font-extrabold' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      이름순
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudentSortBy('AGE')}
                      className={`px-2.5 py-1 rounded-md transition-all ${studentSortBy === 'AGE' ? 'bg-white text-blue-700 shadow-2xs font-extrabold' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      나이순
                    </button>
                    <button
                      type="button"
                      onClick={() => setStudentSortBy('CLASS')}
                      className={`px-2.5 py-1 rounded-md transition-all ${studentSortBy === 'CLASS' ? 'bg-white text-blue-700 shadow-2xs font-extrabold' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      반 순서
                    </button>
                  </div>
                </div>

                {/* Group Accordion Controls (when not ALL) */}
                {studentFilterMode !== 'ALL' && (
                  <div className="flex justify-between items-center px-1 mb-1.5 shrink-0">
                    <span className="text-xs font-bold text-slate-500">
                      {studentFilterMode === 'CLASS' && '반별 분류'}
                      {studentFilterMode === 'AGE' && '연령별 분류'}
                      {studentFilterMode === 'BUS' && '차량별 분류'}
                    </span>
                    <button 
                      type="button"
                      onClick={handleToggleAllGroups}
                      className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline flex items-center gap-0.5"
                    >
                      {getGroupedStudents().some(g => collapsedGroups[g.key]) ? '+ 모두 펼치기' : '− 모두 접기'}
                    </button>
                  </div>
                )}

                {/* Students Content Area */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {studentFilterMode === 'ALL' ? (
                    // Flat List with Student Detail Toggle (+)
                    sortStudentsList(filteredStudents).map(st => {
                      const isExpanded = expandedStudentDetailIds.has(st.id);
                      const bus = buses.find(b => b.id === st.assignedBusId);
                      const isNotRiding = Boolean(st.isNotRiding || st.raw?.['미탑승'] || st.raw?.['차량미탑승']);
                      const needsAddress = !isNotRiding && (!st.address || !st.lat || !st.lng || st.addressNeedsInput || st.raw?.['주소입력필요']);
                      const depBus = st.assignedDepartureBusId ? buses.find(b => b.id === st.assignedDepartureBusId) : null;
                      return (
                        <div key={st.id} className={`p-2.5 rounded-xl shadow-xs hover:shadow-md transition-all group ${needsAddress ? 'bg-red-50/30 border-2 border-red-500 ring-2 ring-red-100' : 'bg-white border border-slate-200'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: needsAddress ? '#ef4444' : (st.color || bus?.color || '#64748b') }}></div>
                              <span className="font-bold text-slate-800 text-sm shrink-0">{st.name}</span>
                              <div className="flex items-center gap-1 overflow-hidden truncate">
                                {needsAddress && (
                                  <span className="text-xs bg-red-100 text-red-700 font-extrabold px-1.5 py-0.5 rounded border border-red-300 shrink-0 animate-pulse">
                                    주소 입력 필요
                                  </span>
                                )}
                                {st.raw?.['반명'] && (
                                  <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-1.5 py-0.5 rounded border border-blue-100 shrink-0">
                                    {st.raw['반명']}
                                  </span>
                                )}
                                {(st.raw?.['연령'] !== undefined && st.raw?.['연령'] !== null ? st.raw['연령'] : st.raw?.['학년']) && (
                                  <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                    {st.raw['연령'] !== undefined && st.raw['연령'] !== null ? st.raw['연령'] : st.raw['학년']}
                                  </span>
                                )}
                                {(st.allergies || st.raw?.['알레르기']) && (
                                  <span className="text-xs bg-red-50 text-red-600 font-bold px-1.5 py-0.5 rounded border border-red-200 shrink-0">
                                    알레르기: {st.allergies || st.raw['알레르기']}
                                  </span>
                                )}
                                {st.raw?.['하원구분'] && (
                                  <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                                    {st.raw['하원구분']}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0 ml-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedPaymentStudent(st);
                                  handleTabChange('messages');
                                }}
                                className="w-5 h-5 flex items-center justify-center rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-600 text-xs transition-colors"
                                title="상담 탑승지 등록 및 결제 신청 (지도 핀/주소 등록)"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                </svg>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleOpenEditStudentModal(st); }}
                                className="w-5 h-5 flex items-center justify-center rounded-md bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 text-xs transition-colors"
                                title="원아 정보 및 주소 수정"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
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

                          {needsAddress ? (
                            <div className="my-1.5 p-1.5 bg-red-50 rounded-lg border border-red-200 flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1 text-xs text-red-600 font-bold truncate">
                                <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span className="truncate">도로명 주소 필요 {st.raw?.['실패주소'] ? `(${st.raw['실패주소']})` : ''}</span>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleOpenEditStudentModal(st); }}
                                className="px-2 py-0.5 text-xs bg-red-600 hover:bg-red-700 text-white font-bold rounded shadow-2xs transition active:scale-95 shrink-0"
                              >
                                주소 입력
                              </button>
                            </div>
                          ) : (
                            <div className="text-[13px] text-slate-600 truncate mb-1" title={st.address}>
                              {st.address}
                            </div>
                          )}

                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-400 text-xs">
                              {st.raw?.['보호자 성함'] ? `${st.raw?.['보호자 성함']} ` : ''}
                              {maskPhoneNumber(st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['보호자 연락처'])}
                            </span>
                            <span className="font-bold text-xs px-2 py-0.5 rounded-md" style={{ color: isNotRiding ? '#64748b' : (needsAddress ? '#ef4444' : (st.color || bus?.color || '#64748b')), backgroundColor: isNotRiding ? '#f1f5f9' : (needsAddress ? '#fee2e2' : `${st.color || bus?.color || '#64748b'}15`) }}>
                              {isNotRiding ? '도보/자차(미탑승)' : (needsAddress ? '배정 대기(주소 필요)' : (bus && depBus && bus.id !== depBus.id ? `등: ${bus.name} / 하: ${depBus.name}` : (bus ? bus.name : (depBus ? `하원: ${depBus.name}` : '배정 대기'))))}
                            </span>
                          </div>

                          {/* Expandable Details via (+) */}
                          {isExpanded && (
                            <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-xs text-slate-600 space-y-1 bg-slate-50/70 p-2 rounded-lg animate-fade-in">
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
                              {(st.allergies || st.raw?.['알레르기']) && (
                                <div className="flex justify-between items-start bg-red-50/70 p-1.5 rounded border border-red-100">
                                  <span className="text-red-600 font-bold shrink-0">알레르기:</span>
                                  <span className="font-semibold text-red-700 text-right max-w-[180px] break-keep">{st.allergies || st.raw['알레르기']}</span>
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
                              <span className="text-sm font-bold text-slate-800">{group.name}</span>
                              <span className="text-[13px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                                {group.list.length}명
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-400">
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
                                <div className="text-xs text-slate-400 text-center py-2">배정된 원아가 없습니다.</div>
                              ) : (
                                group.list.map(st => {
                                  const isExpanded = expandedStudentDetailIds.has(st.id);
                                  const bus = buses.find(b => b.id === st.assignedBusId);
                                  const isNotRiding = Boolean(st.isNotRiding || st.raw?.['미탑승'] || st.raw?.['차량미탑승']);
                                  const needsAddress = !isNotRiding && (!st.address || !st.lat || !st.lng || st.addressNeedsInput || st.raw?.['주소입력필요']);
                                  const depBus = st.assignedDepartureBusId ? buses.find(b => b.id === st.assignedDepartureBusId) : null;
                                  return (
                                    <div key={st.id} className={`p-2.5 rounded-xl shadow-xs hover:shadow-md transition-all group ${needsAddress ? 'bg-red-50/30 border-2 border-red-500 ring-2 ring-red-100' : 'bg-white border border-slate-200'}`}>
                                      <div className="flex items-center justify-between mb-1">
                                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: needsAddress ? '#ef4444' : (st.color || bus?.color || '#64748b') }}></div>
                                          <span className="font-bold text-slate-800 text-sm shrink-0">{st.name}</span>
                                          <div className="flex items-center gap-1 overflow-hidden truncate">
                                            {needsAddress && (
                                              <span className="text-xs bg-red-100 text-red-700 font-extrabold px-1.5 py-0.5 rounded border border-red-300 shrink-0 animate-pulse">
                                                주소 입력 필요
                                              </span>
                                            )}
                                            {studentFilterMode !== 'CLASS' && st.raw?.['반명'] && (
                                              <span className="text-xs bg-blue-50 text-blue-600 font-semibold px-1.5 py-0.5 rounded border border-blue-100 shrink-0">
                                                {st.raw['반명']}
                                              </span>
                                            )}
                                            {studentFilterMode !== 'AGE' && (st.raw?.['연령'] !== undefined && st.raw?.['연령'] !== null ? st.raw['연령'] : st.raw['학년']) && (
                                              <span className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                                {st.raw['연령'] !== undefined && st.raw['연령'] !== null ? st.raw['연령'] : st.raw['학년']}
                                              </span>
                                            )}
                                            {(st.allergies || st.raw?.['알레르기']) && (
                                              <span className="text-xs bg-red-50 text-red-600 font-bold px-1.5 py-0.5 rounded border border-red-200 shrink-0">
                                                알레르기: {st.allergies || st.raw['알레르기']}
                                              </span>
                                            )}
                                            {st.raw?.['하원구분'] && (
                                              <span className="text-xs bg-amber-50 text-amber-700 font-semibold px-1.5 py-0.5 rounded border border-amber-200 shrink-0">
                                                {st.raw['하원구분']}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0 ml-1">
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleOpenEditStudentModal(st); }}
                                            className="w-5 h-5 flex items-center justify-center rounded-md bg-slate-100 hover:bg-blue-100 text-slate-500 hover:text-blue-600 text-xs transition-colors"
                                            title="원아 정보 및 주소 수정"
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                            </svg>
                                          </button>
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

                                      {needsAddress ? (
                                        <div className="my-1.5 p-1.5 bg-red-50 rounded-lg border border-red-200 flex items-center justify-between gap-1.5">
                                          <div className="flex items-center gap-1 text-xs text-red-600 font-bold truncate">
                                            <svg className="w-3.5 h-3.5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <span className="truncate">도로명 주소 필요 {st.raw?.['실패주소'] ? `(${st.raw['실패주소']})` : ''}</span>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={(e) => { e.stopPropagation(); handleOpenEditStudentModal(st); }}
                                            className="px-2 py-0.5 text-xs bg-red-600 hover:bg-red-700 text-white font-bold rounded shadow-2xs transition active:scale-95 shrink-0"
                                          >
                                            주소 입력
                                          </button>
                                        </div>
                                      ) : (
                                        <div className="text-[13px] text-slate-600 truncate mb-1" title={st.address}>
                                          {st.address}
                                        </div>
                                      )}

                                      <div className="flex justify-between items-center text-xs">
                                        <span className="text-slate-400 text-xs">
                                          {st.raw?.['보호자 성함'] ? `${st.raw?.['보호자 성함']} ` : ''}
                                          {maskPhoneNumber(st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['보호자 연락처'])}
                                        </span>
                                        {studentFilterMode !== 'BUS' && (
                                          <span className="font-bold text-xs px-2 py-0.5 rounded-md" style={{ color: isNotRiding ? '#64748b' : (needsAddress ? '#ef4444' : (st.color || bus?.color || '#64748b')), backgroundColor: isNotRiding ? '#f1f5f9' : (needsAddress ? '#fee2e2' : `${st.color || bus?.color || '#64748b'}15`) }}>
                                            {isNotRiding ? '도보/자차(미탑승)' : (needsAddress ? '배정 대기(주소 필요)' : (bus && depBus && bus.id !== depBus.id ? `등: ${bus.name} / 하: ${depBus.name}` : (bus ? bus.name : (depBus ? `하원: ${depBus.name}` : '배정 대기'))))}
                                          </span>
                                        )}
                                      </div>

                                      {/* Expandable Details via (+) */}
                                      {isExpanded && (
                                        <div className="mt-2 pt-2 border-t border-dashed border-slate-200 text-xs text-slate-600 space-y-1 bg-slate-50/70 p-2 rounded-lg animate-fade-in">
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
                                          {(st.allergies || st.raw?.['알레르기']) && (
                                            <div className="flex justify-between items-start bg-red-50/70 p-1.5 rounded border border-red-100">
                                              <span className="text-red-600 font-bold shrink-0">알레르기:</span>
                                              <span className="font-semibold text-red-700 text-right max-w-[180px] break-keep">{st.allergies || st.raw['알레르기']}</span>
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
                <h4 className="font-bold text-slate-700 text-sm mb-1 text-center">등록된 원생이 없습니다</h4>
                <p className="text-[13px] text-slate-500 mb-3 text-center max-w-xs leading-relaxed">
                  [원생 추가] 버튼을 눌러 직접 등록하거나, 엑셀 파일을 업로드하여 구역에 맞추어 자동으로 배차해보세요.
                </p>
                <div className="flex gap-2">
                  <button 
                    onClick={handleOpenAddStudentModal}
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
            <p className="text-[13px] text-slate-500 mb-4">
              관리자이 새로운 반을 개설하고, 원아들을 드래그하여 반에 넣고 담당 담임교사를 배정할 수 있습니다.
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
                <span className="text-xs text-slate-400">총 {availableClasses.length}개</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {availableClasses.map(cls => {
                  const count = students.filter(st => (st.raw?.['반명'] || st.raw?.['반'] || '').trim() === cls.trim()).length;
                  const teacher = teachers.find(t => t.assignedClass && t.assignedClass.trim() === cls.trim());

                  return (
                    <div key={cls} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 hover:border-slate-300 transition-colors">
                      <div className="flex items-center justify-between font-bold text-xs text-slate-900">
                        <span>{cls}</span>
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-black">{count}명</span>
                      </div>
                      <div className="text-xs text-slate-500 flex justify-between">
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
          <div className="flex flex-col h-full bg-white">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 bg-white">
              <h2 className="text-xl font-black text-slate-800 mb-1 flex items-center gap-2">
                키 인증 관리
              </h2>
              <p className="text-[13px] text-slate-500 font-medium">원생, 차량 스태프, 교사의 앱 연동과 승인을 관리합니다.</p>
            </div>

            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
              {/* 원 인증코드 카드 */}
              <div className="bg-gradient-to-br from-blue-50 to-indigo-50/60 border border-blue-200/80 rounded-2xl p-4 text-center shadow-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-blue-900 flex items-center gap-1">
                    원 인증코드
                  </span>
                  <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">공용</span>
                </div>
                {academy?.authCode ? (
                  <div className="text-2xl font-black text-blue-600 tracking-widest font-mono select-all bg-white py-2 px-3 rounded-xl border border-blue-100 shadow-xs mb-2.5">
                    {academy.authCode}
                  </div>
                ) : (
                  <div className="text-slate-500 mb-2.5 text-xs py-2">현재 발급된 코드가 없습니다.</div>
                )}
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      if (academy?.authCode) {
                        navigator.clipboard?.writeText(academy.authCode);
                        alert('인증코드가 클립보드에 복사되었습니다.');
                      }
                    }}
                    disabled={!academy?.authCode}
                    className="flex-1 py-2 bg-white hover:bg-blue-50 text-blue-700 font-bold rounded-xl text-xs border border-blue-200 transition shadow-xs flex items-center justify-center gap-1"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    코드 복사
                  </button>
                  <button 
                    onClick={handleGenerateAuthCode}
                    disabled={isProcessing}
                    className="py-2 px-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-xs text-xs whitespace-nowrap"
                  >
                    {academy?.authCode ? '재발급' : '발급'}
                  </button>
                </div>
                <p className="text-xs text-blue-600/80 mt-2 text-left">
                  학부모와 교직원이 앱 회원가입 시 이 코드를 입력해야 해당 원으로 연동됩니다.
                </p>
              </div>

              {/* 3대 셀 버튼 (휴업일 셀 느낌) */}
              <div className="flex flex-col gap-2.5">
                <button 
                  onClick={() => setAuthTab('STUDENT')} 
                  className={`w-full p-3.5 rounded-2xl font-bold transition-all flex items-center justify-between text-left ${
                    authTab === 'STUDENT' 
                      ? 'bg-blue-600 text-white shadow-md ring-2 ring-blue-400/30' 
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">전체 원생</div>
                      <div className={`text-xs ${authTab === 'STUDENT' ? 'text-blue-100' : 'text-slate-500'} truncate`}>
                        학부모 및 원아 가입 승인
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {students.filter(s => s.approvalStatus === 'PENDING').length > 0 && (
                      <span className="bg-orange-500 text-white text-xs font-black px-2 py-0.5 rounded-full animate-pulse shadow-xs">
                        대기 {students.filter(s => s.approvalStatus === 'PENDING').length}
                      </span>
                    )}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                      authTab === 'STUDENT' ? 'bg-blue-700/60 text-white' : 'bg-slate-200 text-slate-600'
                    }`}>
                      {students.length}명
                    </span>
                  </div>
                </button>

                <button 
                  onClick={() => setAuthTab('STAFF')} 
                  className={`w-full p-3.5 rounded-2xl font-bold transition-all flex items-center justify-between text-left ${
                    authTab === 'STAFF' 
                      ? 'bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400/30' 
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">차량 스태프</div>
                      <div className={`text-xs ${authTab === 'STAFF' ? 'text-emerald-100' : 'text-slate-500'} truncate`}>
                        기사님 & 동승 지도교사
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {buses.some(b => b.driverApprovalStatus === 'PENDING' || b.teacherApprovalStatus === 'PENDING') && (
                      <span className="bg-orange-500 text-white text-xs font-black px-2 py-0.5 rounded-full animate-pulse shadow-xs">
                        대기
                      </span>
                    )}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                      authTab === 'STAFF' ? 'bg-emerald-700/60 text-white' : 'bg-slate-200 text-slate-600'
                    }`}>
                      {buses.length}대
                    </span>
                  </div>
                </button>

                <button 
                  onClick={() => setAuthTab('TEACHER')} 
                  className={`w-full p-3.5 rounded-2xl font-bold transition-all flex items-center justify-between text-left ${
                    authTab === 'TEACHER' 
                      ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-400/30' 
                      : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">유치원 교사</div>
                      <div className={`text-xs ${authTab === 'TEACHER' ? 'text-indigo-100' : 'text-slate-500'} truncate`}>
                        담당 교사 연동 및 배정 현황
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${
                      authTab === 'TEACHER' ? 'bg-indigo-700/60 text-white' : 'bg-slate-200 text-slate-600'
                    }`}>
                      {teachers.length}명
                    </span>
                  </div>
                </button>
              </div>

              {/* 하단 팁 */}
              <div className="mt-auto p-3.5 bg-slate-50 rounded-xl border border-slate-200/70 text-xs text-slate-500 space-y-1">
                <div className="font-bold text-slate-700 flex items-center gap-1">
                  인증 안내
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed">
                  상단 버튼을 누르면 우측 화면에 각 대상별 상세 승인 및 연동 목록이 나타납니다.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="p-6 h-full flex flex-col overflow-y-auto break-keep">
            <h2 className="text-xl font-bold text-slate-800 mb-6">환경설정</h2>
            
            <div className="space-y-4">
              <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 transition-all">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-bold text-orange-700">유치원 정보 관리</h3>
                  {academy?.businessNumber && (
                    <span className="text-[11px] bg-orange-200/70 text-orange-800 font-semibold px-2 py-0.5 rounded-full">
                      사업자번호: {academy.businessNumber}
                    </span>
                  )}
                </div>
                <p className="text-xs text-orange-600 mb-3 opacity-80 leading-relaxed">유치원명, 주소 및 사업자 등록번호를 확인하고 변경할 수 있습니다.</p>
                
                {!isChangingAcademy ? (
                  <div className="space-y-2">
                    {academy && (
                      <div className="text-xs text-slate-600 bg-white/80 p-2.5 rounded-lg border border-orange-200/50 mb-2 space-y-1">
                        <div><span className="font-bold text-slate-700">기관명:</span> {academy.name || '미등록'}</div>
                        <div><span className="font-bold text-slate-700">주소:</span> {academy.address || '미등록'}</div>
                        <div><span className="font-bold text-slate-700">사업자 등록번호:</span> {academy.businessNumber || '미등록'}</div>
                      </div>
                    )}
                    <button onClick={() => {
                      setAcademyChangeForm({ 
                        name: academy?.name || '', 
                        address: academy?.address || '',
                        businessNumber: academy?.businessNumber || ''
                      });
                      setIsChangingAcademy(true);
                    }} className="w-full py-2.5 px-3 bg-white text-orange-600 rounded-xl text-sm font-bold border border-orange-200 shadow-xs hover:bg-orange-600 hover:text-white transition-colors whitespace-nowrap">
                      유치원 정보 수정 모드
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleChangeAcademySubmit} className="space-y-3 mt-4 pt-4 border-t border-orange-200">
                    <div>
                      <label className="block text-xs font-bold text-orange-800 mb-1">새 유치원명 <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        value={academyChangeForm.name} 
                        onChange={e => setAcademyChangeForm({...academyChangeForm, name: e.target.value})}
                        className="w-full px-3 py-2 bg-white border border-orange-200 rounded-xl text-sm outline-none"
                        placeholder="유치원명"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-orange-800 mb-1">사업자 등록번호</label>
                      <input 
                        type="text" 
                        value={academyChangeForm.businessNumber || ''} 
                        onChange={e => setAcademyChangeForm({...academyChangeForm, businessNumber: formatBusinessNumber(e.target.value)})}
                        className="w-full px-3 py-2 bg-white border border-orange-200 rounded-xl text-sm outline-none tracking-wider"
                        placeholder="예: 123-45-67890 (10자리)"
                        maxLength={12}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-orange-800 mb-1">새 원 주소 (도로명/지번) <span className="text-red-500">*</span></label>
                      <input 
                        type="text" 
                        value={academyChangeForm.address} 
                        onChange={e => setAcademyChangeForm({...academyChangeForm, address: e.target.value})}
                        className="w-full px-3 py-2 bg-white border border-orange-200 rounded-xl text-sm outline-none"
                        placeholder="주소"
                        required
                      />
                    </div>
                    <button 
                      type="submit" 
                      disabled={isProcessing}
                      className="w-full py-2.5 px-3 bg-orange-600 text-white rounded-xl text-sm font-bold shadow-xs hover:bg-orange-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                    >
                      {isProcessing ? '변경 중...' : '변경 완료'}
                    </button>
                    <button type="button" onClick={() => setIsChangingAcademy(false)} className="w-full py-2 mt-1 bg-transparent text-orange-600 rounded-lg text-xs hover:underline whitespace-nowrap">
                      취소
                    </button>
                  </form>
                )}
              </div>

              {/* 전체 명단 엑셀 다운로드 카드 - Compact & Slim Design */}
              <div className="relative overflow-hidden bg-white rounded-2xl p-4 border border-slate-200 shadow-xs hover:shadow-sm transition-all">
                {/* Background ambient glow effect */}
                <div className="pointer-events-none absolute -top-12 -right-12 w-36 h-36 bg-gradient-to-br from-emerald-200/30 to-teal-100/20 rounded-full blur-xl" />

                {/* Header */}
                <div className="relative flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-bold text-slate-800 text-sm">
                        원 전체 명단 엑셀 다운로드
                      </h3>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded-md">
                        .xlsx
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      원생 · 교사 · 기사 명단을 시트별로 분리하여 다운로드합니다.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const allSelected = exportTargets.students && exportTargets.teachers && exportTargets.drivers;
                      setExportTargets({
                        students: !allSelected,
                        teachers: !allSelected,
                        drivers: !allSelected,
                      });
                    }}
                    className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100/70 border border-emerald-200/60 px-2.5 py-1 rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    {exportTargets.students && exportTargets.teachers && exportTargets.drivers ? '선택 해제' : '전체 선택'}
                  </button>
                </div>

                {/* Compact Target Selection Pills (No Icons, No Clipping) */}
                <div className="grid grid-cols-3 gap-1.5 mb-3">
                  {/* 1. 원생 */}
                  <button
                    type="button"
                    onClick={() => setExportTargets(prev => ({ ...prev, students: !prev.students }))}
                    className={`h-9 px-1 rounded-lg border text-xs font-bold flex items-center justify-center transition-all cursor-pointer whitespace-nowrap ${
                      exportTargets.students
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    <span>원생</span>
                    <span className={`text-[11px] ml-1 font-medium ${
                      exportTargets.students ? 'text-emerald-100' : 'text-slate-400'
                    }`}>
                      ({students.length}명)
                    </span>
                  </button>

                  {/* 2. 교사 */}
                  <button
                    type="button"
                    onClick={() => setExportTargets(prev => ({ ...prev, teachers: !prev.teachers }))}
                    className={`h-9 px-1 rounded-lg border text-xs font-bold flex items-center justify-center transition-all cursor-pointer whitespace-nowrap ${
                      exportTargets.teachers
                        ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    <span>교사</span>
                    <span className={`text-[11px] ml-1 font-semibold ${
                      exportTargets.teachers ? 'text-blue-100' : 'text-slate-400'
                    }`}>
                      ({teachers.length}명)
                    </span>
                  </button>

                  {/* 3. 기사 */}
                  <button
                    type="button"
                    onClick={() => setExportTargets(prev => ({ ...prev, drivers: !prev.drivers }))}
                    className={`h-9 px-1 rounded-lg border text-xs font-bold flex items-center justify-center transition-all cursor-pointer whitespace-nowrap ${
                      exportTargets.drivers
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                    }`}
                  >
                    <span>기사</span>
                    <span className={`text-[11px] ml-1 font-semibold ${
                      exportTargets.drivers ? 'text-amber-100' : 'text-slate-400'
                    }`}>
                      ({buses.length}대)
                    </span>
                  </button>
                </div>

                {/* Security Note & CTA Button */}
                {(() => {
                  const selectedCount = (exportTargets.students ? 1 : 0) + (exportTargets.teachers ? 1 : 0) + (exportTargets.drivers ? 1 : 0);
                  const hasSelection = selectedCount > 0;
                  return (
                    <button
                      onClick={handleInitiateExcelExport}
                      disabled={isExportingExcel || !hasSelection}
                      className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                        hasSelection && !isExportingExcel
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs hover:shadow-sm active:scale-[0.99]'
                          : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed shadow-none'
                      }`}
                    >
                      {isExportingExcel ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                          </svg>
                          <span>엑셀 생성 중...</span>
                        </>
                      ) : !hasSelection ? (
                        <span>다운로드할 대상을 1개 이상 선택하세요</span>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          <span>Google OTP 인증 후 엑셀 다운로드 ({selectedCount}개 선택됨)</span>
                        </>
                      )}
                    </button>
                  );
                })()}
              </div>

              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 mt-auto space-y-2">
                <h3 className="font-bold text-slate-700 mb-1">계정 관리</h3>
                <button 
                  onClick={handleLogout}
                  className="w-full py-2.5 px-3 bg-white text-slate-700 rounded-xl text-sm font-bold border border-slate-300 shadow-xs hover:bg-slate-100 transition-colors whitespace-nowrap"
                >
                  로그아웃
                </button>
                <button 
                  onClick={handleDeleteAcademy}
                  disabled={isProcessing}
                  className="w-full py-2.5 px-3 bg-white text-slate-500 rounded-xl text-sm font-bold border border-slate-300 shadow-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
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
                  캘린더 및 로그
                </h2>
                <p className="text-sm text-slate-500 font-medium">원생의 출결과 로그를 확인하세요.</p>
              </div>
              <div className="p-4 flex flex-col gap-3">
                <button onClick={() => setLogTab('LOG')} className={`w-full py-3 rounded-xl font-bold transition-all ${logTab === 'LOG' ? 'bg-blue-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>로그보기</button>
                <button onClick={() => setLogTab('ABSENCE')} className={`w-full py-3 rounded-xl font-bold transition-all ${logTab === 'ABSENCE' ? 'bg-red-500 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>원생 결석관리</button>
                <button onClick={() => setLogTab('HOLIDAY')} className={`w-full py-3 rounded-xl font-bold transition-all ${logTab === 'HOLIDAY' ? 'bg-orange-500 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>휴업일 설정</button>
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
            currentUser={currentUser}
            selectedAcademyId={selectedAcademyId}
            socket={socketRef.current}
            initialStudent={selectedPaymentStudent}
            onClearInitialStudent={() => setSelectedPaymentStudent(null)}
            isClosing={isMessageClosing}
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

        {activeTab === 'attendance' && (
          <div className="absolute inset-0 z-20 bg-slate-50 flex flex-col overflow-hidden">
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
                    <h1 className="text-xl font-black text-slate-800 tracking-tight">유치원 전체 출석 현황</h1>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full font-bold border border-blue-200">
                      실시간 소켓 연동
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    담임선생님들이 제출한 각 반별 출석부를 실시간으로 확인합니다.
                  </p>
                </div>
              </div>

              {/* Date & Refresh */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-xl border border-slate-200">
                  <span className="text-xs font-bold text-slate-500">조회 일자:</span>
                  <input
                    type="date"
                    value={adminAttendanceDate}
                    onChange={(e) => {
                      setAdminAttendanceDate(e.target.value);
                      fetchAdminAttendance(e.target.value);
                    }}
                    className="bg-transparent text-xs font-bold text-slate-700 border-none outline-hidden cursor-pointer"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => fetchAdminAttendance()}
                  disabled={isAdminAttendanceLoading}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <svg className={`w-4 h-4 ${isAdminAttendanceLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>새로고침</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleTabChange('status')}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
                  title="닫기"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Metrics Bar */}
            <div className="bg-white border-b border-slate-200 px-8 py-4 shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="text-[11px] font-bold text-slate-500">전체 원아</div>
                <div className="text-xl font-black text-slate-800">{adminAttendanceData?.summary?.totalStudents || 0}명</div>
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200">
                <div className="text-[11px] font-bold text-emerald-700">출석 원아</div>
                <div className="text-xl font-black text-emerald-700">{adminAttendanceData?.summary?.present || 0}명</div>
              </div>
              <div className="bg-red-50 p-3 rounded-xl border border-red-200">
                <div className="text-[11px] font-bold text-red-700">결석 원아</div>
                <div className="text-xl font-black text-red-700">{adminAttendanceData?.summary?.absent || 0}명</div>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200">
                <div className="text-[11px] font-bold text-amber-700">지각 원아</div>
                <div className="text-xl font-black text-amber-700">{adminAttendanceData?.summary?.late || 0}명</div>
              </div>
              <div className="bg-purple-50 p-3 rounded-xl border border-purple-200">
                <div className="text-[11px] font-bold text-purple-700">조퇴 원아</div>
                <div className="text-xl font-black text-purple-700">{adminAttendanceData?.summary?.earlyLeave || 0}명</div>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-200">
                <div className="text-[11px] font-bold text-blue-700">출석부 제출율</div>
                <div className="text-xl font-black text-blue-700">
                  {adminAttendanceData?.summary?.submittedClasses || 0} / {adminAttendanceData?.summary?.totalClasses || 0} 반
                </div>
              </div>
            </div>

            {/* Class Cards */}
            <div className="flex-1 overflow-y-auto p-8 space-y-6">
              {isAdminAttendanceLoading ? (
                <div className="flex items-center justify-center py-24">
                  <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : adminAttendanceData?.classes && adminAttendanceData.classes.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {adminAttendanceData.classes.map((c) => (
                    <div key={c.className} className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                      <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                        <div className="flex items-center gap-3">
                          <h3 className="text-base font-black text-slate-800">{c.className}</h3>
                          {c.teacherName && (
                            <span className="text-xs text-slate-500 font-semibold">담임: {c.teacherName}선생님</span>
                          )}
                        </div>
                        {c.isSubmitted ? (
                          <div className="flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold px-2.5 py-1 rounded-full">
                            <span>✓ 제출완료</span>
                            {c.submittedAt && (
                              <span className="text-[11px] text-emerald-600 font-normal">
                                ({new Date(c.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2.5 py-1 rounded-full">
                            미제출
                          </span>
                        )}
                      </div>

                      {/* Class counts */}
                      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3 text-xs bg-white">
                        <span className="font-bold text-slate-600">총 {c.total}명</span>
                        <span className="text-emerald-700 font-bold">출석 {c.present}</span>
                        <span className="text-red-700 font-bold">결석 {c.absent}</span>
                        <span className="text-amber-700 font-bold">지각 {c.late}</span>
                        <span className="text-purple-700 font-bold">조퇴 {c.earlyLeave}</span>
                      </div>

                      {/* Students table */}
                      <div className="p-4 flex-1 overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="text-slate-400 border-b border-slate-100">
                              <th className="pb-2 font-bold">원아명</th>
                              <th className="pb-2 font-bold">상태</th>
                              <th className="pb-2 font-bold">셔틀</th>
                              <th className="pb-2 font-bold">비고</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {c.students.map((st) => (
                              <tr key={st.id} className="hover:bg-slate-50/60 transition">
                                <td className="py-2.5 font-bold text-slate-800">{st.name}</td>
                                <td className="py-2.5">
                                  {st.status === 'PRESENT' && (
                                    <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-bold rounded-md text-[11px]">출석</span>
                                  )}
                                  {st.status === 'ABSENT' && (
                                    <span className="px-2 py-0.5 bg-red-100 text-red-800 font-bold rounded-md text-[11px]">결석</span>
                                  )}
                                  {st.status === 'LATE' && (
                                    <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-bold rounded-md text-[11px]">지각</span>
                                  )}
                                  {st.status === 'EARLY_LEAVE' && (
                                    <span className="px-2 py-0.5 bg-purple-100 text-purple-800 font-bold rounded-md text-[11px]">조퇴</span>
                                  )}
                                </td>
                                <td className="py-2.5 text-slate-500 text-[11px]">
                                  {st.vehicleName}
                                  {st.boardStatus === 'BOARDED' && ' (탑승)'}
                                </td>
                                <td className="py-2.5 text-slate-400 text-[11px] truncate max-w-[120px]">{st.memo || '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-24 text-center bg-white rounded-3xl border border-dashed border-slate-200">
                  <h4 className="font-bold text-slate-700 text-sm mb-1">등록된 반 출석 정보가 없습니다</h4>
                  <p className="text-xs text-slate-400">담임선생님이 출석부를 제출하면 실시간으로 여기에 표시됩니다.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'auth' && (
          <AuthViewer 
            isClosing={isAuthClosing}
            currentTab={authTab}
            setCurrentTab={setAuthTab}
            students={students}
            buses={buses}
            teachers={teachers}
            academy={academy}
            handleApproveStudent={handleApproveStudent}
            handleRevokeStudent={handleRevokeStudent}
            handleApproveStaff={handleApproveStaff}
            handleRevokeStaff={handleRevokeStaff}
            handleRevokeTeacher={handleRevokeTeacher}
            fetchTeachers={fetchTeachers}
            refreshAllData={refreshAllData}
            handleGenerateAuthCode={handleGenerateAuthCode}
            handleUnlockUser={handleUnlockUser}
            isProcessing={isProcessing}
          />
        )}

        {/* Zone Editing Overlay */}
        {isZoneEditingMode && (
          <div className="absolute top-4 left-16 z-[1000] bg-white/95 backdrop-blur-sm p-4 rounded-2xl shadow-xl border border-blue-100 flex flex-col gap-3 min-w-[200px]">
            <h3 className="font-bold text-slate-800 text-sm">구역 수정할 호차 선택</h3>
            <div className="flex flex-col gap-1">
              {sortedBuses.map(bus => (
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
                  {isProcessing ? '저장 중...' : '수정 내역 저장'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Top Active Operating Status Pill Banner */}
        {Object.entries(operatingBuses).some(([_, isOp]) => isOp) && (
          <div className="absolute top-4 left-16 z-[1000] bg-emerald-600/95 backdrop-blur-sm text-white px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 border border-emerald-400 text-xs font-bold animate-pulse">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping"></span>
            <span>
              실시간 운행 중: {
                buses
                  .filter(b => operatingBuses[b.id])
                  .map(b => b.name)
                  .join(', ') || '차량'
              }
            </span>
          </div>
        )}

        {/* Top-Right Controls: SuperAdmin Switcher & Day Filter */}
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
          <MapFocusEffect target={mapFocusTarget} />

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
              html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:#f97316;color:white;border-radius:50%;font-weight:bold;font-size:12px;box-shadow:0 2px 4px rgba(0,0,0,0.3);">BUS</div>`,
              iconSize: [24, 24],
              iconAnchor: [12, 24]
            });
            return (
              <Marker key={`pickup-${p.id}`} position={[p.latitude, p.longitude]} icon={ptIcon}>
                <Popup>
                  <div className="text-left p-1 w-48 max-h-56 overflow-y-auto">
                    <div className="font-bold text-sm text-slate-800 border-b pb-1 mb-1">{p.name}</div>
                    
                    {(() => {
                      const boardingStudents = students.filter(st => (st.boardingLocation || st.address) === p.name);
                      const servingBusIds = new Set();
                      boardingStudents.forEach(st => {
                        if (st.assignedBusId) servingBusIds.add(st.assignedBusId);
                        if (st.assignedDepartureBusId) servingBusIds.add(st.assignedDepartureBusId);
                      });
                      const servingBuses = buses.filter(b => servingBusIds.has(b.id));
                      return (
                        <div className="mb-2 pb-1 border-b border-slate-100 text-xs">
                          <span className="font-bold text-slate-500 block mb-1">경유 호차:</span>
                          {servingBuses.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {servingBuses.map(b => (
                                <span key={b.id} className="px-1.5 py-0.5 rounded text-[11px] font-bold text-white shadow-xs" style={{ backgroundColor: b.color || '#3b82f6' }}>
                                  {b.name}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">배정 호차 없음</span>
                          )}
                        </div>
                      );
                    })()}

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
            if (operatingBuses[bus.id] === false) return null; // Immediately remove if stopped!
            const busIcon = L.divIcon({
              className: 'custom-bus-marker',
              html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
                <div style="background-color: ${bus.color || '#ef4444'}; font-size: 16px; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.4);">🚌</div>
                <div style="position: absolute; top: -10px; right: -12px; background: #10b981; color: white; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 9999px; border: 1.5px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.25); white-space: nowrap;">● LIVE</div>
              </div>`,
              iconSize: [34, 34],
              iconAnchor: [17, 17]
            });
            return (
              <Marker key={`realtime-bus-${vid}`} position={[loc.lat, loc.lng]} icon={busIcon}>
                <Popup className="font-bold">
                  <div className="text-center p-1">
                    <div className="font-extrabold text-blue-800 text-sm">{bus.name}</div>
                    <div className="text-xs text-emerald-600 font-bold mt-1">실시간 운행 중</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{new Date(loc.timestamp).toLocaleTimeString()} 수신</div>
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* If operating but no GPS points yet, show starting indicator */}
          {buses.map(bus => {
            if (!operatingBuses[bus.id] || busLocations[bus.id]) return null;
            if (selectedBusId && bus.id !== selectedBusId) return null;
            const initialPt = (bus.points && bus.points[0]) || (academy && !isNaN(academy.lat) ? [academy.lat, academy.lng] : null);
            if (!initialPt) return null;
            const startingIcon = L.divIcon({
              className: 'custom-bus-marker-starting',
              html: `<div style="position: relative; display: flex; align-items: center; justify-content: center;">
                <div style="background-color: ${bus.color || '#3b82f6'}; font-size: 15px; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 2.5px dashed white; box-shadow: 0 4px 10px rgba(0,0,0,0.3);">🚌</div>
                <div style="position: absolute; top: -8px; right: -10px; background: #f59e0b; color: white; font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 9999px; border: 1.5px solid white; white-space: nowrap;">운행시작</div>
              </div>`,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });
            return (
              <Marker key={`starting-bus-${bus.id}`} position={initialPt} icon={startingIcon}>
                <Popup className="font-bold">
                  <div className="text-center p-1">
                    <div className="font-extrabold text-blue-800 text-sm">{bus.name}</div>
                    <div className="text-xs text-amber-600 font-bold mt-1">운행 시작됨 (GPS 위치 수신 대기 중)</div>
                  </div>
                </Popup>
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
                <h3 className="text-lg font-bold text-slate-800">
                  {editingStudentId ? '원아 정보 및 주소 수정' : '원아 직접 추가'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {editingStudentId
                    ? '올바른 도로명 주소를 입력하고 저장하면 지도 구역이 자동으로 확장됩니다.'
                    : '유치원 엑셀 양식 항목을 작성하여 원아를 등록합니다. (추가 시 차량 구역 자동 확장)'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowAddStudentModal(false); setEditingStudentId(null); }}
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
                <div className="flex items-center justify-between mb-2.5">
                  <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                    주소 및 승하차 위치
                  </h4>
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer select-none bg-slate-50 px-2 py-1 rounded border border-slate-200 hover:bg-slate-100">
                    <input
                      type="checkbox"
                      checked={studentForm.isNotRiding}
                      onChange={e => setStudentForm({ ...studentForm, isNotRiding: e.target.checked })}
                      className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                    />
                    차량 미탑승 (도보/자차)
                  </label>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    도로명 주소 {!studentForm.isNotRiding && <span className="text-red-500">*</span>}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required={!studentForm.isNotRiding}
                      placeholder={studentForm.isNotRiding ? "도보/자차 등원생 (주소 선택사항)" : "주소 검색 버튼을 눌러 도로명 주소를 선택하세요"}
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
                      등원 탑승지 (미입력 시 도로명 주소 적용)
                    </label>
                    <input
                      type="text"
                      disabled={studentForm.isNotRiding}
                      placeholder={studentForm.isNotRiding ? "미탑승" : "예: 101동 앞 정문"}
                      value={studentForm.inLocation}
                      onChange={e => setStudentForm({ ...studentForm, inLocation: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      하원 하차지 (미입력 시 도로명 주소 적용)
                    </label>
                    <input
                      type="text"
                      disabled={studentForm.isNotRiding}
                      placeholder={studentForm.isNotRiding ? "미탑승" : "예: 101동 앞 정문"}
                      value={studentForm.dropoffLocation || studentForm.outLocation}
                      onChange={e => setStudentForm({ ...studentForm, dropoffLocation: e.target.value, outLocation: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                  </div>
                </div>
              </div>

              {/* Section 4: 배차 및 시간 */}
              <div className="pt-2 border-t border-slate-100">
                <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                  배차 및 운행 일정 {studentForm.isNotRiding && <span className="text-xs text-slate-400 font-normal">(도보/자차 등원생 - 배차 제외)</span>}
                </h4>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">등원 배정 차량</label>
                    <select
                      disabled={studentForm.isNotRiding}
                      value={studentForm.assignedBusId}
                      onChange={e => setStudentForm({ ...studentForm, assignedBusId: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">자동 배정 (구역 기반)</option>
                      {sortedBuses.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">하원 배정 차량</label>
                    <select
                      disabled={studentForm.isNotRiding}
                      value={studentForm.assignedDepartureBusId}
                      onChange={e => setStudentForm({ ...studentForm, assignedDepartureBusId: e.target.value })}
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white disabled:bg-slate-100 disabled:text-slate-400"
                    >
                      <option value="">등원 차량과 동일 (또는 자동 배정)</option>
                      {sortedBuses.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                  <label className="block text-xs font-semibold text-slate-700 mb-1">알레르기 주의사항</label>
                  <input
                    type="text"
                    placeholder="식품/약품 알레르기 (예: 땅콩, 복숭아, 유제품, 계란 등)"
                    value={studentForm.allergies}
                    onChange={e => setStudentForm({ ...studentForm, allergies: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
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
                  onClick={() => { setShowAddStudentModal(false); setEditingStudentId(null); }}
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
                      <span>{editingStudentId ? '수정 중...' : '등록 중...'}</span>
                    </>
                  ) : (
                    <span>{editingStudentId ? '수정 저장 (구역 자동 확장)' : '원생 등록하기'}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Vehicle Modal */}
      {showAddBusModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-black">
                  🚌
                </div>
                <h2 className="text-lg font-black text-slate-900">새 통학 차량 추가</h2>
              </div>
              <button 
                type="button"
                onClick={() => setShowAddBusModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 text-lg font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddBus} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">호차명 <span className="text-red-500">*</span></label>
                  <input 
                    type="text" 
                    required
                    value={newBusForm.name} 
                    onChange={e => setNewBusForm({ ...newBusForm, name: e.target.value, busNumber: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-600 outline-none text-sm font-semibold" 
                    placeholder="예: 3호차" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">차량 번호</label>
                  <input 
                    type="text" 
                    value={newBusForm.plateNumber} 
                    onChange={e => setNewBusForm({ ...newBusForm, plateNumber: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-600 outline-none text-sm font-semibold" 
                    placeholder="예: 서울70가 1234" 
                  />
                </div>
              </div>

              {/* Color Presets */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">지도 표시 고유 색상</label>
                <div className="flex items-center gap-2">
                  {['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#ea580c', '#475569'].map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewBusForm({ ...newBusForm, color: c })}
                      className={`w-7 h-7 rounded-full transition-transform cursor-pointer ${newBusForm.color === c ? 'ring-2 ring-offset-2 ring-blue-600 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                  <input 
                    type="color" 
                    value={newBusForm.color} 
                    onChange={e => setNewBusForm({ ...newBusForm, color: e.target.value })}
                    className="w-7 h-7 rounded-full cursor-pointer border-0 p-0 bg-transparent"
                    title="사용자 지정 색상"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">운전 기사님 성함</label>
                  <input 
                    type="text" 
                    value={newBusForm.driverName} 
                    onChange={e => setNewBusForm({ ...newBusForm, driverName: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold" 
                    placeholder="기사님 이름" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">기사님 연락처</label>
                  <input 
                    type="text" 
                    value={newBusForm.driverPhone} 
                    onChange={e => setNewBusForm({ ...newBusForm, driverPhone: formatPhoneNumber(e.target.value) })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold" 
                    placeholder="010-0000-0000" 
                    maxLength={13} 
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">동승 교사 성함</label>
                  <input 
                    type="text" 
                    value={newBusForm.teacherName} 
                    onChange={e => setNewBusForm({ ...newBusForm, teacherName: e.target.value })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold" 
                    placeholder="교사 이름" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">동승 교사 연락처</label>
                  <input 
                    type="text" 
                    value={newBusForm.teacherPhone} 
                    onChange={e => setNewBusForm({ ...newBusForm, teacherPhone: formatPhoneNumber(e.target.value) })} 
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold" 
                    placeholder="010-0000-0000" 
                    maxLength={13} 
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">차량 탑승 정원 (인원수)</label>
                <input 
                  type="number" 
                  min="1"
                  max="100"
                  value={newBusForm.capacity} 
                  onChange={e => setNewBusForm({ ...newBusForm, capacity: e.target.value })} 
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm font-semibold" 
                  placeholder="25" 
                />
              </div>

              <div className="flex gap-2.5 pt-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddBusModal(false)} 
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors cursor-pointer"
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  disabled={isProcessing} 
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isProcessing ? '등록 중...' : '차량 추가하기'}
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
              <div className="pt-3 border-t border-slate-100 flex justify-between items-center mt-6">
                <button
                  type="button"
                  onClick={async () => {
                    if (!editingBus) return;
                    if (!window.confirm(`[${editingBus.busNumber || editingBus.name}] 차량을 삭제하시겠습니까?\n\n이 차량에 배정된 원아들과 구역은 주변 차량들이 자동으로 확장하여 인계받습니다.`)) return;
                    setIsProcessing(true);
                    try {
                      const targetAcademyId = selectedAcademyId || currentUser.academyId;
                      const res = await fetch(`${API_BASE_URL}/routing/vehicle/${editingBus.id}?academyId=${targetAcademyId}&userId=${currentUser.id}`, {
                        method: 'DELETE'
                      });
                      if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        throw new Error(err.message || '차량 삭제에 실패했습니다.');
                      }
                      alert('차량이 삭제되었으며 주변 차량으로 구역과 원아가 자동 확장되었습니다.');
                      setEditingBus(null);
                      const stateRes = await fetch(`${API_BASE_URL}/routing/initial-state?academyId=${targetAcademyId}`);
                      if (stateRes.ok) {
                        const stateData = await stateRes.json();
                        if (Array.isArray(stateData.buses)) setBuses(computePolygons(stateData.buses));
                        if (Array.isArray(stateData.students)) setStudents(stateData.students);
                      }
                    } catch (err) {
                      alert(err.message);
                    } finally {
                      setIsProcessing(false);
                    }
                  }}
                  className="px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200"
                >
                  차량 삭제 (주변 구역 자동 확장)
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditingBus(null)} className="px-4 py-2 bg-slate-100 text-slate-600 font-bold text-xs rounded-lg hover:bg-slate-200">취소</button>
                  <button type="submit" disabled={isProcessing} className="px-4 py-2 bg-blue-600 text-white font-bold text-xs rounded-lg hover:bg-blue-700 disabled:opacity-50">저장하기</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 엑셀 다운로드 OTP 2차 보안 인증 모달 - Premium Redesign */}
      {isOtpModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-100 transition-all">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 px-6 py-5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 backdrop-blur-xs flex items-center justify-center text-xl text-emerald-400">
                  🔒
                </div>
                <div>
                  <h3 className="text-base font-extrabold tracking-tight">2단계 보안 승인 (Google OTP)</h3>
                  <p className="text-xs text-slate-400">명단 엑셀 다운로드를 위한 2차 인증</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setIsOtpModalOpen(false);
                  setOtpCode('');
                  setOtpError('');
                }}
                className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <form onSubmit={handleVerifyOtpAndExport} className="p-6 space-y-5">
              {/* Target Summary Chips (No icons) */}
              <div className="p-3.5 bg-slate-50/90 rounded-2xl border border-slate-200/80">
                <p className="text-[11px] font-bold text-slate-500 mb-2 tracking-wide uppercase">다운로드 대상 요약</p>
                <div className="flex flex-wrap gap-1.5">
                  {exportTargets.students && (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-100/80 text-emerald-800 border border-emerald-200">
                      원생 ({students.length}명)
                    </span>
                  )}
                  {exportTargets.teachers && (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-100/80 text-blue-800 border border-blue-200">
                      교사 ({teachers.length}명)
                    </span>
                  )}
                  {exportTargets.drivers && (
                    <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-100/80 text-amber-800 border border-amber-200">
                      기사 ({buses.length}대)
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1.5">
                  인증 코드 6자리 입력
                </label>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  스마트폰의 <span className="font-semibold text-slate-700">Google Authenticator</span> 앱을 열고 표시된 6자리 번호를 입력하세요.
                </p>
                <input 
                  type="text" 
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6} 
                  autoFocus
                  placeholder="000000" 
                  value={otpCode} 
                  onChange={e => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setOtpCode(val);
                    if (otpError) setOtpError('');
                  }} 
                  className="w-full px-4 py-3.5 bg-slate-50 border-2 border-slate-200 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 rounded-2xl text-center text-3xl font-mono tracking-[0.35em] outline-none transition-all placeholder:text-slate-300 font-extrabold"
                  required
                />
              </div>

              {otpError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-600 text-xs">
                  <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="leading-relaxed font-semibold">{otpError}</span>
                </div>
              )}

              <div className="flex gap-2.5 pt-2">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsOtpModalOpen(false);
                    setOtpCode('');
                    setOtpError('');
                  }}
                  disabled={isVerifyingOtp}
                  className="flex-1 py-3 px-4 bg-slate-100 text-slate-700 rounded-xl text-sm font-bold hover:bg-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  취소
                </button>
                <button 
                  type="submit" 
                  disabled={isVerifyingOtp || otpCode.length !== 6}
                  className="flex-2 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-xl text-sm font-bold shadow-md shadow-emerald-600/20 hover:shadow-lg hover:shadow-emerald-600/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
                >
                  {isVerifyingOtp ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                      </svg>
                      <span>인증 확인 중...</span>
                    </>
                  ) : (
                    <>
                      <span>인증 및 다운로드</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
