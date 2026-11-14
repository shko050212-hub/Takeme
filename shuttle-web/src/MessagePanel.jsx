import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { API_BASE_URL } from './config';
import { formatTeacherName } from './utils/teacherUtil';

// Leaflet default icon fix
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Pins for Director (Red), Teacher Proposal (Green), and Default (Blue)
const redPinIcon = L.divIcon({
  className: 'custom-red-pin',
  html: '<div style="background-color:#ef4444;color:white;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.4);font-size:11px;font-weight:900;">관리자</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const greenPinIcon = L.divIcon({
  className: 'custom-green-pin',
  html: '<div style="background-color:#10b981;color:white;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.4);font-size:11px;font-weight:900;">교사</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

const bluePinIcon = L.divIcon({
  className: 'custom-blue-pin',
  html: '<div style="background-color:#3b82f6;color:white;border:2px solid white;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.4);font-size:11px;font-weight:900;">탑승</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});

// Map Click Event Listener Component
function MapClickMarker({ position, onMapClick, icon }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });

  return position && position[0] && position[1] ? (
    <Marker position={position} icon={icon || bluePinIcon} />
  ) : null;
}

// Map Center Updater
function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1] && !isNaN(center[0]) && !isNaN(center[1])) {
      map.setView(center, map.getZoom());
    }
  }, [center, map]);
  return null;
}

// Mini Map Component for Payment/Boarding Request Card
function MiniLocationMap({ lat, lng, locationName, icon }) {
  if (!lat || !lng || isNaN(Number(lat)) || isNaN(Number(lng))) return null;
  const position = [Number(lat), Number(lng)];

  return (
    <div className="w-full h-36 rounded-xl overflow-hidden border border-slate-200 shadow-2xs relative z-0 my-2">
      <MapContainer
        center={position}
        zoom={15}
        scrollWheelZoom={false}
        zoomControl={false}
        dragging={false}
        doubleClickZoom={false}
        attributionControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={position} icon={icon || bluePinIcon}>
          {locationName && <Popup>{locationName}</Popup>}
        </Marker>
      </MapContainer>
      <div className="absolute bottom-1 right-1 bg-white/90 backdrop-blur-xs px-2 py-0.5 rounded text-[10px] text-slate-600 font-bold border border-slate-200 z-[400] shadow-2xs pointer-events-none">
        {locationName || '탑승 위치'}
      </div>
    </div>
  );
}

// Comparison Map Component for Counter-Proposal (Original vs Suggested)
function ComparisonLocationMap({ original, suggested }) {
  if (!original?.latitude || !suggested?.latitude) return null;
  const pos1 = [Number(original.latitude), Number(original.longitude)];
  const pos2 = [Number(suggested.latitude), Number(suggested.longitude)];
  const center = [(pos1[0] + pos2[0]) / 2, (pos1[1] + pos2[1]) / 2];

  return (
    <div className="w-full h-44 rounded-xl overflow-hidden border-2 border-indigo-200 shadow-2xs relative z-0 my-2">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom={false}
        zoomControl={false}
        dragging={false}
        doubleClickZoom={false}
        attributionControl={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Marker position={pos1} icon={redPinIcon}>
          <Popup>관리자 지정: {original.boardingLocation}</Popup>
        </Marker>
        <Marker position={pos2} icon={greenPinIcon}>
          <Popup>지도교사 제안: {suggested.boardingLocation}</Popup>
        </Marker>
      </MapContainer>
      <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between bg-white/95 backdrop-blur-xs px-2.5 py-1 rounded-lg text-[10px] border border-slate-200 z-[400] shadow-2xs font-extrabold">
        <span className="flex items-center gap-1 text-red-600">
          <span className="w-2 h-2 rounded-full bg-red-500"></span>
          관리자: {original.boardingLocation}
        </span>
        <span className="flex items-center gap-1 text-emerald-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
          교사 제안: {suggested.boardingLocation}
        </span>
      </div>
    </div>
  );
}

export default function MessagePanel({ currentUser, selectedAcademyId, socket, isClosing, initialStudent, onClearInitialStudent, activeEducationLevel, initialRoomType }) {
  const currentEducationLevel = activeEducationLevel || currentUser?.educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  const isKindergarten = currentEducationLevel === '유치원';
  const isElementary = currentEducationLevel === '초등부';
  const isMiddleHigh = currentEducationLevel === '중,고등부';
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchRoomQuery, setSearchRoomQuery] = useState('');

  // Bookmarked Messages
  const [bookmarkedIds, setBookmarkedIds] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('takeme_bookmarked_msgs') || '[]');
    } catch (e) {
      return [];
    }
  });
  const [showBookmarksOnly, setShowBookmarksOnly] = useState(false);

  const handleToggleBookmark = (msgId) => {
    setBookmarkedIds(prev => {
      const next = prev.includes(msgId) ? prev.filter(id => id !== msgId) : [...prev, msgId];
      try { localStorage.setItem('takeme_bookmarked_msgs', JSON.stringify(next)); } catch (e) {}
      return next;
    });
  };

  // Quick Action [+] Menu State
  const [showPlusMenu, setShowPlusMenu] = useState(false);

  // Message Presets & Saved Phrases State
  const [showPhrasesModal, setShowPhrasesModal] = useState(false);
  const [newPhraseInput, setNewPhraseInput] = useState('');
  const [savedPhrases, setSavedPhrases] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('takeme_saved_phrases') || '[]');
      if (stored.length > 0) return stored;
    } catch (e) {}
    return [
      '오늘 통학 차량이 도로 사정으로 약 5~10분 지연 도착 예정입니다. 양해 부탁드립니다.',
      '기상 악화(우천/강설)로 인해 안전을 최우선으로 서행 운행 중입니다. 안심하셔도 좋습니다.',
      '내일은 원내 특별 체험활동 일정으로 셔틀 하원 시간이 30분 앞당겨집니다.',
      '오늘 원아의 건강 상태 및 특이사항(투약, 컨디션)을 확인 부탁드립니다.',
      '정차 장소에 3분 전 미리 대기해 주시면 원활하고 안전한 승하차에 큰 도움이 됩니다.'
    ];
  });

  const handleSavePhrase = () => {
    if (!newPhraseInput.trim()) return;
    const next = [...savedPhrases, newPhraseInput.trim()];
    setSavedPhrases(next);
    try { localStorage.setItem('takeme_saved_phrases', JSON.stringify(next)); } catch (e) {}
    setNewPhraseInput('');
  };

  const handleSelectPhrase = (phrase) => {
    setInputText(phrase);
    setShowPhrasesModal(false);
  };


  // New Chat Modal State
  const [isNewChatModalOpen, setIsNewChatModalOpen] = useState(false);
  const [categoryUsers, setCategoryUsers] = useState({ drivers: [], teachers: [], parents: [], students: [], admins: [] });
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [searchUserQuery, setSearchUserQuery] = useState('');
  const [customGroupName, setCustomGroupName] = useState('');
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // Participant list popover state
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);

  // Payment / Boarding Request Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isLoadingPaymentContext, setIsLoadingPaymentContext] = useState(false);
  const [paymentContext, setPaymentContext] = useState({ vehicles: [], students: [], pickupPoints: [] });
  const [paymentForm, setPaymentForm] = useState({
    studentSelectMode: 'DROPDOWN',
    selectedStudentId: '',
    customStudentName: '',
    selectedVehicleId: '',
    isPublicContest: false,
    requestType: 'ONE_ON_ONE', // 'ONE_ON_ONE' | 'CONTEST'
    locationType: 'PIN', // 'PIN' | 'ADDRESS'
    locationSelectMode: 'MAP_PIN', // 'MAP_PIN' | 'ADDRESS_SEARCH'
    selectedPickupPointId: '',
    boardingLocation: '',
    address: '',
    latitude: 37.842,
    longitude: 127.123,
    rideType: 'REGULAR', // 'REGULAR' | 'TODAY_ONLY'
    requestDate: new Date().toISOString().split('T')[0],
    note: '학부모 상담 후 신규 탑승지 지정 및 결재 승인 요청',
  });
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [isDeciding, setIsDeciding] = useState(null);
  const [isPushingParent, setIsPushingParent] = useState(null);

  // Counter-Proposal (지도교사 재결재 요청) Modal State
  const [counterModalMsg, setCounterModalMsg] = useState(null);
  const [counterLocation, setCounterLocation] = useState({ lat: 37.842, lng: 127.123, boardingLocation: '', address: '' });
  const [counterNote, setCounterNote] = useState('');
  const [isSubmittingCounter, setIsSubmittingCounter] = useState(false);

  const messagesEndRef = useRef(null);
  const activeRoomRef = useRef(null);
  activeRoomRef.current = activeRoom;

  // Resolve user info from props or localStorage
  const myUser = currentUser || (() => {
    try {
      return JSON.parse(localStorage.getItem('takeme_user') || '{}');
    } catch (_) {
      return {};
    }
  })();

  const isParent = myUser.role === 'PARENT';
  const targetAcademyId = selectedAcademyId || myUser.academyId;

  // Initial Load: Fetch rooms
  useEffect(() => {
    setActiveRoom(null);
    setMessages([]);
    fetchRooms();
  }, [myUser.email, currentEducationLevel]);

  // Socket.IO event listeners
  useEffect(() => {
    if (!socket) return;

    const handleReceiveMessage = (newMsg) => {
      if (!newMsg) return;
      const currentActive = activeRoomRef.current;
      const msgRoomId = newMsg.room?.id || newMsg.roomId;

      if (currentActive && Number(currentActive.id) === Number(msgRoomId)) {
        markRoomAsRead(msgRoomId);
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) {
            // Update existing message if payload status changed
            return prev.map((m) => (m.id === newMsg.id ? newMsg : m));
          }
          return [...prev, newMsg];
        });
        scrollToBottom();
      }

      // Update room list latest message
      setRooms((prevRooms) => {
        return prevRooms.map((r) => {
          if (Number(r.id) === Number(msgRoomId)) {
            return {
              ...r,
              latestMessage: newMsg,
              updatedAt: new Date().toISOString(),
              unreadCount: (currentActive && Number(currentActive.id) === Number(msgRoomId)) ? 0 : (r.unreadCount || 0) + 1,
            };
          }
          return r;
        }).sort((a, b) => {
          if (a.type === 'NOTIFICATION_SYSTEM') return -1;
          if (b.type === 'NOTIFICATION_SYSTEM') return 1;
          const tA = a.latestMessage ? new Date(a.latestMessage.createdAt).getTime() : new Date(a.updatedAt || a.createdAt).getTime();
          const tB = b.latestMessage ? new Date(b.latestMessage.createdAt).getTime() : new Date(b.updatedAt || b.createdAt).getTime();
          return tB - tA;
        });
      });
    };

    const handleRoomUpdated = () => {
      fetchRooms();
    };

    const handleMessagesRead = (data) => {
      const currentActive = activeRoomRef.current;
      if (currentActive && Number(currentActive.id) === Number(data?.roomId)) {
        setMessages((prev) =>
          prev.map((m) => ({ ...m, unreadCount: 0 }))
        );
      }
    };

    socket.on('receiveMessage', handleReceiveMessage);
    socket.on('roomUpdated', handleRoomUpdated);
    socket.on('messagesRead', handleMessagesRead);

    return () => {
      socket.off('receiveMessage', handleReceiveMessage);
      socket.off('roomUpdated', handleRoomUpdated);
      socket.off('messagesRead', handleMessagesRead);
    };
  }, [socket]);

  // Join/Leave room socket channels when active room changes
  useEffect(() => {
    if (!activeRoom) return;

    if (socket) {
      socket.emit('joinChatRoom', { roomId: activeRoom.id });
    }

    markRoomAsRead(activeRoom.id);
    fetchMessages(activeRoom.id);

    return () => {
      if (socket && activeRoom) {
        socket.emit('leaveChatRoom', { roomId: activeRoom.id });
      }
    };
  }, [activeRoom?.id]);

  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 80);
  };

  const getAuthHeaders = () => {
    const token = localStorage.getItem('takeme_token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  };

  const fetchRooms = async () => {
    if (!myUser?.email) return;
    try {
      const q = new URLSearchParams({
        email: myUser.email,
        educationLevel: currentEducationLevel,
      });
      if (targetAcademyId) q.append('academyId', String(targetAcademyId));
      const res = await fetch(`${API_BASE_URL}/chat/rooms?${q.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        // 학제 일치 검증 필터 (방에 educationLevel이 명시된 경우 현재 학제와 반드시 일치해야 함)
        const filtered = (data || []).filter((r) => !r.educationLevel || r.educationLevel === currentEducationLevel);
        setRooms(filtered);
        if (initialRoomType) {
          const match = filtered.find((r) => r.type === initialRoomType);
          if (match) {
            setActiveRoom(match);
            return;
          }
        }
        if (activeRoomRef.current) {
          const updated = filtered.find((r) => r.id === activeRoomRef.current.id);
          if (updated) {
            setActiveRoom(updated);
          } else if (filtered.length > 0) {
            setActiveRoom(filtered[0]);
          } else {
            setActiveRoom(null);
          }
        } else if (filtered.length > 0) {
          setActiveRoom(filtered[0]);
        } else {
          setActiveRoom(null);
        }
      }
    } catch (e) {
      console.error('Failed to load chat rooms', e);
    }
  };

  const markRoomAsRead = async (roomId) => {
    if (!roomId) return;
    try {
      await fetch(`${API_BASE_URL}/chat/rooms/${roomId}/read`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch (e) {
      console.error('Failed to mark room as read', e);
    }
  };

  const fetchMessages = async (roomId) => {
    try {
      const q = new URLSearchParams({ roomId: String(roomId) });
      if (myUser?.id) q.append('userId', String(myUser.id));
      const res = await fetch(`${API_BASE_URL}/chat/messages?${q.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
        setRooms((prev) =>
          prev.map((r) => (Number(r.id) === Number(roomId) ? { ...r, unreadCount: 0 } : r))
        );
        scrollToBottom();
      }
    } catch (e) {
      console.error('Failed to load messages', e);
    }
  };

  const fetchCategoryUsers = async () => {
    setIsLoadingUsers(true);
    try {
      const q = new URLSearchParams();
      if (targetAcademyId) q.append('academyId', String(targetAcademyId));
      if (myUser?.email) q.append('email', myUser.email);
      if (currentEducationLevel) q.append('educationLevel', currentEducationLevel);
      const res = await fetch(`${API_BASE_URL}/chat/users?${q.toString()}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setCategoryUsers({
          drivers: data.drivers || [],
          teachers: data.teachers || [],
          parents: data.parents || [],
          students: data.students || [],
          admins: data.admins || [],
        });
      }
    } catch (e) {
      console.error('Failed to load users for chat', e);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleOpenNewChatModal = () => {
    setSelectedUserIds([]);
    setSearchUserQuery('');
    setCustomGroupName('');
    setIsNewChatModalOpen(true);
    fetchCategoryUsers();
  };

  const handleToggleSelectUser = (id) => {
    setSelectedUserIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((uid) => uid !== id);
      } else {
        return [...prev, id];
      }
    });
  };

  // 역할별 일괄 선택/해제 토글
  const handleToggleSelectRole = (userList) => {
    if (!userList || userList.length === 0) return;
    const targetIds = userList.map((u) => u.id);
    setSelectedUserIds((prev) => {
      const allSelected = targetIds.every((id) => prev.includes(id));
      if (allSelected) {
        return prev.filter((id) => !targetIds.includes(id));
      } else {
        const next = new Set([...prev, ...targetIds]);
        return Array.from(next);
      }
    });
  };

  // 관련 인원 전체 선택/해제 토글
  const handleToggleSelectAllUsers = () => {
    const allUsers = isKindergarten
      ? [...filteredDrivers, ...filteredTeachers, ...filteredParents, ...filteredAdmins]
      : [...filteredDrivers, ...filteredTeachers, ...filteredStudents, ...filteredParents, ...filteredAdmins];
    const allIds = allUsers.map((u) => u.id);
    setSelectedUserIds((prev) => {
      const allSelected = allIds.length > 0 && allIds.every((id) => prev.includes(id));
      if (allSelected) {
        return [];
      } else {
        return allIds;
      }
    });
  };

  const handleStartChat = async () => {
    if (selectedUserIds.length === 0) {
      return alert('대화할 상대를 최소 1명 이상 선택해주세요.');
    }

    setIsCreatingRoom(true);
    try {
      const isGroup = selectedUserIds.length > 1;
      const res = await fetch(`${API_BASE_URL}/chat/rooms`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          userIds: selectedUserIds,
          educationLevel: currentEducationLevel,
          academyId: targetAcademyId,
          name: isGroup && customGroupName.trim() ? customGroupName.trim() : undefined,
          type: isGroup ? 'GROUP' : 'DIRECT',
          creatorEmail: myUser.email,
        }),
      });

      if (res.ok) {
        const createdRoom = await res.json();
        setIsNewChatModalOpen(false);
        setSelectedUserIds([]);
        setCustomGroupName('');
        await fetchRooms();
        setActiveRoom(createdRoom);
      } else {
        alert('채팅방 생성에 실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || !activeRoom) return;

    setInputText('');
    setIsSending(true);

    try {
      const res = await fetch(`${API_BASE_URL}/chat/messages`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          roomId: activeRoom.id,
          text,
          senderEmail: myUser.email,
        }),
      });

      if (res.ok) {
        const savedMsg = await res.json();
        setMessages((prev) => {
          if (prev.some((m) => m.id === savedMsg.id)) return prev;
          return [...prev, savedMsg];
        });
        scrollToBottom();

        // [교사/기사 앱 수신함 브릿지 동기화: 1:1 개인 메세지 및 공지 자동 판별]
        try {
          const otherMembers = (activeRoom.members || [])
            .map((m) => m.user)
            .filter((u) => u && u.email !== myUser.email);

          const isGroupRoom = (activeRoom.members || []).length > 2 || activeRoom.type === 'GROUP';
          const isPersonal = !isGroupRoom && otherMembers.length === 1;
          const targetUser = otherMembers[0] || null;

          const hasTeacher = otherMembers.some(
            (u) => u.role && (u.role.includes('TEACHER') || u.role === 'SHUTTLE_TEACHER' || u.role === 'HOMEROOM_TEACHER')
          );
          const hasDriver = otherMembers.some((u) => u.role && u.role.includes('DRIVER'));

          const targetRoles = [];
          if (hasTeacher) targetRoles.push('TEACHER', 'HOMEROOM_TEACHER', 'SHUTTLE_TEACHER');
          if (hasDriver) targetRoles.push('DRIVER');
          if (targetRoles.length === 0) targetRoles.push('TEACHER');

          const prefix = isPersonal
            ? `[원장님 1:1 개인 메세지]`
            : `[원장님 공지]`;

          // 1. 백엔드 admin-messages 엔드포인트 브릿지
          fetch(`${API_BASE_URL}/routing/admin-messages/send`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              targetRoles,
              vehicleId: null,
              studentIds: [],
              message: `${prefix} ${text}`,
            }),
          }).catch((err) => console.warn('교사 앱 수신함 백엔드 전송:', err));

          // 2. 모바일 앱 프록시 실시간 수신함 큐 동기화 (1:1 개인 메세지 플래그 및 수신자 명시)
          const bridgeHost = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost';
          fetch(`http://${bridgeHost}:8083/api/bridge-admin-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              educationLevel: currentEducationLevel,
              isPersonal,
              type: isPersonal ? 'PERSONAL' : 'NOTICE',
              targetEmail: targetUser ? targetUser.email : null,
              targetName: targetUser ? (targetUser.name || '선생님') : '선생님',
              targetUserId: targetUser ? targetUser.id : null,
              senderName: myUser.name || '원장님(관리자)',
              senderEmail: myUser.email,
              targetRoles,
              message: text,
              prefix,
              createdAt: new Date().toISOString(),
            }),
          }).catch(() => {});
        } catch (bridgeErr) {
          console.warn('교사 앱 메시지 브릿지 처리 중 오류(무시):', bridgeErr);
        }
      } else {
        alert('메시지 전송에 실패했습니다.');
      }
    } catch (e) {
      alert('메시지 전송 중 오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ============================================================
  // 결재 및 탑승 신청 관련 핸들러
  // ============================================================

  // Auto open modal when initialStudent prop is provided (e.g. from Director Dashboard consultation)
  useEffect(() => {
    if (initialStudent) {
      handleOpenPaymentModalWithStudent(initialStudent);
      if (onClearInitialStudent) onClearInitialStudent();
    }
  }, [initialStudent]);

  useEffect(() => {
    if (initialRoomType && rooms.length > 0) {
      const match = rooms.find((r) => r.type === initialRoomType);
      if (match) {
        setActiveRoom(match);
      }
    }
  }, [initialRoomType, rooms]);

  const handleOpenPaymentModalWithStudent = async (student) => {
    await handleOpenPaymentModal();
    if (student) {
      const sLat = Number(student.latitude || student.lat) || 37.842;
      const sLng = Number(student.longitude || student.lng) || 127.123;
      const sLoc = student.boardingLocation || student.address || '원아 등록 탑승지';
      const sClassName = student.className || student.raw?.['반명'] || student.raw?.반 || '';
      const sParentName = student.parentName || student.raw?.['보호자 성함'] || student.raw?.보호자명 || '학부모';
      const sParentPhone = student.parentPhone || student.raw?.['보호자연락처'] || student.raw?.보호자연락처 || '';

      setPaymentForm(prev => ({
        ...prev,
        studentSelectMode: 'DROPDOWN',
        selectedStudentId: String(student.id),
        customStudentName: student.name,
        selectedVehicleId: student.assignedBusId ? String(student.assignedBusId) : prev.selectedVehicleId,
        boardingLocation: sLoc,
        address: student.address || sLoc,
        latitude: sLat,
        longitude: sLng,
        note: `[${sClassName ? sClassName + '반' : '원아'}] ${student.name} (보호자: ${sParentName}님 / ${sParentPhone || '연락처 미등록'}) - 기존 탑승지: [${sLoc}], 셔틀 결재 승인 및 학부모 안내 요청`,
      }));
    }
  };

  const handleOpenPaymentModal = async () => {
    if (isParent) {
      return alert('학부모 계정은 결재 신청 기능을 이용할 수 없습니다.');
    }

    setIsPaymentModalOpen(true);
    setIsLoadingPaymentContext(true);

    try {
      const q = new URLSearchParams();
      if (targetAcademyId) q.append('academyId', String(targetAcademyId));
      if (myUser?.email) q.append('email', myUser.email);
      const res = await fetch(`${API_BASE_URL}/chat/payment-context?${q.toString()}`, {
        headers: getAuthHeaders(),
      });

      if (res.ok) {
        const ctx = await res.json();
        setPaymentContext(ctx);

        const firstVehicle = ctx.vehicles?.[0];
        const defaultLat = 37.842;
        const defaultLng = 127.123;

        setPaymentForm((prev) => ({
          ...prev,
          selectedVehicleId: firstVehicle ? String(firstVehicle.id) : '',
          locationType: 'PIN',
          locationSelectMode: 'MAP_PIN',
          boardingLocation: prev.boardingLocation || '신규 지정 탑승지 (지도 핀)',
          latitude: prev.latitude || defaultLat,
          longitude: prev.longitude || defaultLng,
          requestDate: new Date().toISOString().split('T')[0],
          note: prev.note || '학부모 상담 후 신규 탑승지 지정 및 결재 승인 요청',
        }));
      }
    } catch (e) {
      console.error('Failed to load payment context', e);
    } finally {
      setIsLoadingPaymentContext(false);
    }
  };

  // Map Click Handler in Director Payment Modal
  const handleMapClickForPayment = async (lat, lng) => {
    setPaymentForm((prev) => ({
      ...prev,
      latitude: lat,
      longitude: lng,
      locationType: 'PIN',
    }));

    // Reverse geocode to get real road address
    try {
      const res = await fetch(`${API_BASE_URL}/routing/reverse-geocode?lat=${lat}&lng=${lng}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.address) {
          setPaymentForm((prev) => ({
            ...prev,
            address: data.address,
            boardingLocation: data.roadAddress || data.address,
          }));
        }
      }
    } catch (e) {
      console.warn('Reverse geocode error', e);
    }
  };

  // Daum Postcode Search in Director Payment Modal
  const handleOpenPostcodeForPayment = () => {
    const trigger = () => {
      new window.daum.Postcode({
        oncomplete: async (data) => {
          const fullAddress = data.roadAddress || data.jibunAddress;
          setPaymentForm((prev) => ({
            ...prev,
            address: fullAddress,
            boardingLocation: fullAddress,
            locationType: 'ADDRESS',
          }));
          // Geocode address to coordinates
          try {
            const geoRes = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ addresses: [fullAddress] }),
            });
            if (geoRes.ok) {
              const geocoded = await geoRes.json();
              const coords = geocoded[0]?.coords;
              if (coords) {
                setPaymentForm((prev) => ({
                  ...prev,
                  latitude: coords.lat,
                  longitude: coords.lng,
                }));
              }
            }
          } catch (e) {
            console.warn('Geocoding error', e);
          }
        },
      }).open();
    };

    if (window.daum && window.daum.Postcode) {
      trigger();
    } else {
      const script = document.createElement('script');
      script.src = '//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
      script.onload = trigger;
      document.head.appendChild(script);
    }
  };

  // Manual Address Search Button
  const handleSearchAddressForPayment = async () => {
    const query = paymentForm.address.trim() || paymentForm.boardingLocation.trim();
    if (!query) return alert('검색할 주소를 입력해주세요.');

    try {
      const geoRes = await fetch(`${API_BASE_URL}/routing/geocode-bulk`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ addresses: [query] }),
      });
      if (geoRes.ok) {
        const geocoded = await geoRes.json();
        const coords = geocoded[0]?.coords;
        if (coords) {
          setPaymentForm((prev) => ({
            ...prev,
            latitude: coords.lat,
            longitude: coords.lng,
            locationType: 'ADDRESS',
          }));
          alert(`'${query}' 주소 위치로 핀을 이동했습니다.`);
        } else {
          alert('해당 주소의 좌표를 찾을 수 없습니다. 지도를 직접 클릭하여 핀을 지정해주세요.');
        }
      }
    } catch (e) {
      alert('주소 검색 중 오류가 발생했습니다.');
    }
  };

  // Open Counter-Proposal Modal (지도교사가 다른 위치 핀 찍어 재결재 요청)
  const handleOpenCounterModal = (msg) => {
    setCounterModalMsg(msg);
    const p = msg.payload || {};
    const initLat = Number(p.latitude) || 37.842;
    const initLng = Number(p.longitude) || 127.123;
    setCounterLocation({
      lat: initLat,
      lng: initLng,
      boardingLocation: `${p.boardingLocation || '탑승지'} 인근 제안`,
      address: p.address || '',
    });
    setCounterNote('대형 통학버스 안전 진입 및 회차를 위해 탑승 위치 변경을 제안합니다.');
  };

  // Map Click in Counter-Proposal Modal
  const handleMapClickForCounter = async (lat, lng) => {
    setCounterLocation(prev => ({ ...prev, lat, lng }));
    try {
      const res = await fetch(`${API_BASE_URL}/routing/reverse-geocode?lat=${lat}&lng=${lng}`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.address) {
          setCounterLocation(prev => ({
            ...prev,
            address: data.address,
            boardingLocation: data.roadAddress || data.address,
          }));
        }
      }
    } catch (e) {
      console.warn('Reverse geocode error', e);
    }
  };

  // Submit Counter-Proposal (관리자에게 재결재 요청 보내기)
  const handleSubmitCounterProposal = async () => {
    if (!counterModalMsg) return;
    if (!counterLocation.lat || !counterLocation.lng) {
      return alert('지도에서 변경할 탑승지 위치를 핀으로 찍어주세요.');
    }
    if (!counterLocation.boardingLocation.trim()) {
      return alert('새로 제안하는 탑승지 명칭을 입력해주세요.');
    }
    if (!counterNote.trim()) {
      return alert('관리자님께 전달할 재결재 요청 사유를 입력해주세요.');
    }

    setIsSubmittingCounter(true);
    try {
      const res = await fetch(`${API_BASE_URL}/chat/payment-request/${counterModalMsg.id}/re-request`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          suggestedLocation: {
            boardingLocation: counterLocation.boardingLocation.trim(),
            address: counterLocation.address || counterLocation.boardingLocation.trim(),
            latitude: counterLocation.lat,
            longitude: counterLocation.lng,
          },
          note: counterNote.trim(),
          proposerEmail: myUser.email,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        alert('관리자님께 새로운 탑승 위치로 재결재 요청을 발송했습니다.\n관리자님께서 승인하시면 해당 위치로 확정됩니다.');
        setCounterModalMsg(null);
        if (data.message) {
          setMessages(prev => prev.map(m => m.id === counterModalMsg.id ? data.message : m));
        }
        fetchRooms();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || '재결재 요청 전송에 실패했습니다.');
      }
    } catch (e) {
      alert('재결재 요청 전송 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingCounter(false);
    }
  };

  const handleStudentSelect = (stId) => {
    if (stId === 'NEW') {
      setPaymentForm((prev) => ({
        ...prev,
        studentSelectMode: 'CUSTOM',
        selectedStudentId: '',
        customStudentName: '',
        note: '신규 원생 셔틀 탑승 결재 승인 요청',
      }));
      return;
    }

    const st = paymentContext.students?.find((s) => String(s.id) === String(stId));
    if (!st) return;

    const sLat = Number(st.lat || st.latitude) || 37.842;
    const sLng = Number(st.lng || st.longitude) || 127.123;
    const sLoc = st.boardingLocation || st.address || '원아 등록 탑승지';
    const sClassName = st.className || '';
    const sParentName = st.parentName || '학부모';
    const sParentPhone = st.parentPhone || '';

    setPaymentForm((prev) => ({
      ...prev,
      studentSelectMode: 'DROPDOWN',
      selectedStudentId: String(st.id),
      customStudentName: st.name,
      selectedVehicleId: st.assignedBusId ? String(st.assignedBusId) : prev.selectedVehicleId,
      boardingLocation: sLoc,
      address: st.address || sLoc,
      latitude: sLat,
      longitude: sLng,
      note: `[${sClassName ? sClassName + '반' : '원아'}] ${st.name} (보호자: ${sParentName}님 / ${sParentPhone || '연락처 미등록'}) - 기존 탑승지: [${sLoc}], 셔틀 결재 승인 및 학부모 안내 요청`,
    }));
  };

  const handlePickupPointSelect = (pId) => {
    const pt = paymentContext.pickupPoints?.find((p) => String(p.id) === String(pId));
    if (!pt) return;

    setPaymentForm((prev) => ({
      ...prev,
      selectedPickupPointId: String(pt.id),
      boardingLocation: pt.name,
      latitude: pt.latitude,
      longitude: pt.longitude,
    }));
  };

  const handleSubmitPaymentRequest = async (e) => {
    e?.preventDefault();

    const studentName =
      paymentForm.studentSelectMode === 'CUSTOM'
        ? paymentForm.customStudentName.trim()
        : paymentContext.students?.find((s) => String(s.id) === String(paymentForm.selectedStudentId))?.name ||
          paymentForm.customStudentName.trim();

    if (!studentName) {
      return alert('원생(학생) 이름을 선택하거나 입력해주세요.');
    }

    if (!paymentForm.isPublicContest && !paymentForm.selectedVehicleId) {
      return alert('1:1 결재 신청 시 담당 차량(호차)을 선택해주세요.');
    }

    const boardingLocation = paymentForm.boardingLocation.trim();
    if (!boardingLocation) {
      return alert('탑승 희망 위치를 선택하거나 입력해주세요.');
    }

    setIsSubmittingPayment(true);

    try {
      // 결재는 관리자-교사 간에만 이루어지므로 상대방이 교사인 경우에만 현재 방 유지, 학부모 방일 경우 교사 전용 방으로 라우팅
      const isCurrentRoomWithTeacher = !isChatWithParent && activeOtherUser?.role === 'TEACHER';
      const targetRoomId = isCurrentRoomWithTeacher ? activeRoom?.id : undefined;

      const res = await fetch(`${API_BASE_URL}/chat/payment-request`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          studentId: paymentForm.selectedStudentId ? Number(paymentForm.selectedStudentId) : undefined,
          studentName,
          roomId: targetRoomId,
          vehicleId: Number(paymentForm.selectedVehicleId),
          rideType: paymentForm.rideType || 'TODAY_ONLY',
          boardingLocation,
          address: paymentForm.address.trim() || boardingLocation,
          latitude: paymentForm.latitude || undefined,
          longitude: paymentForm.longitude || undefined,
          locationType: paymentForm.locationType || 'PIN',
          requestDate: paymentForm.requestDate,
          note: paymentForm.note.trim() || '학부모 상담 후 신규 탑승지 지정 및 결재 승인 요청',
          requesterEmail: myUser.email,
        }),
      });

      if (res.ok) {
        const createdMsg = await res.json();
        setIsPaymentModalOpen(false);
        // If current active room matches created message room, append message
        if (activeRoom && createdMsg.roomId && Number(createdMsg.roomId) === Number(activeRoom.id)) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === createdMsg.id)) return prev;
            return [...prev, createdMsg];
          });
          scrollToBottom();
        } else if (createdMsg.roomId) {
          alert('담당 차량 지도교사와의 결재 대화방으로 결재 신청서가 안전하게 발송되었습니다.\n(학부모 대화방에는 결재 카드가 노출되지 않습니다.)');
        }
        await fetchRooms();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || '결재 신청서 발송에 실패했습니다.');
      }
    } catch (e) {
      alert('결재 신청 전송 중 오류가 발생했습니다.');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleDecidePaymentRequest = async (messageId, decision) => {
    if (isDeciding) return;
    if (isParent) {
      return alert('학부모 계정은 승인 또는 거절 권한이 없습니다.');
    }

    const actionText = decision === 'APPROVED' ? '결재 및 탑승을 수락' : '결재 신청을 거절';
    if (!window.confirm(`${actionText}하시겠습니까?`)) {
      return;
    }

    setIsDeciding(messageId);

    try {
      const res = await fetch(`${API_BASE_URL}/chat/payment-request/${messageId}/decision`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          decision,
          decidedByEmail: myUser.email,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const updatedMsg = data.message;
        setMessages((prev) =>
          prev.map((m) => (m.id === messageId ? updatedMsg || { ...m, payload: { ...m.payload, status: decision } } : m))
        );
        fetchRooms();
        // Dispatch event for Dashboard to update map/stops if mounted
        window.dispatchEvent(new Event('takeme_route_updated'));
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || '처리에 실패했습니다.');
      }
    } catch (e) {
      alert('처리 중 오류가 발생했습니다.');
    } finally {
      setIsDeciding(null);
    }
  };

  const handlePushParentNotification = async (messageId) => {
    if (!messageId || isPushingParent) return;
    setIsPushingParent(messageId);
    try {
      const res = await fetch(`${API_BASE_URL}/chat/payment-request/${messageId}/push-parent`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ senderEmail: myUser.email }),
      });
      if (res.ok) {
        const data = await res.json();
        alert(`학부모님께 알림 푸시가 성공적으로 전송되었습니다!\n"${data.pushText || ''}"`);
        if (activeRoom) {
          fetchMessages(activeRoom.id);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.message || '학부모 푸시 발송에 실패했습니다.');
      }
    } catch (e) {
      alert('서버 연결 중 오류가 발생했습니다.');
    } finally {
      setIsPushingParent(null);
    }
  };

  const getRoleBadge = (role) => {
    switch (role?.toUpperCase?.() || role) {
      case 'DRIVER':
        return <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded">기사</span>;
      case 'HOMEROOM_TEACHER':
        return <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded">담임교사</span>;
      case 'SHUTTLE_TEACHER':
        return <span className="bg-sky-100 text-sky-700 text-[10px] font-bold px-1.5 py-0.5 rounded">지도교사</span>;
      case 'TEACHER':
        return <span className="bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded">교사</span>;
      case 'PARENT':
        return <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded">학부모</span>;
      case 'STUDENT':
        return <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-1.5 py-0.5 rounded">학생</span>;
      case 'ACADEMY_ADMIN':
      case 'SUPER_ADMIN':
        return <span className="bg-purple-100 text-purple-700 text-[10px] font-bold px-1.5 py-0.5 rounded">기관 관리자</span>;
      default:
        return <span className="bg-slate-100 text-slate-600 text-[10px] font-medium px-1.5 py-0.5 rounded">알 수 없음</span>;
    }
  };

  const getRoomTitle = (room) => {
    if (!room) return '';
    if (room.type === 'PAYMENT_SYSTEM' || room.name === '결재 전용 채널' || room.name === '결제 시스템 방') {
      return '결재 전용 채널';
    }
    if (room.type === 'NOTIFICATION_SYSTEM' || room.name === '실시간 알림 채널') {
      return '실시간 알림 채널';
    }
    if (room.name && room.name !== '1:1 대화' && !room.name.includes('(')) {
      return room.name;
    }

    const members = (room.members || []).map((m) => m.user).filter(Boolean);
    const otherMembers = members.filter((u) => u.email !== myUser.email);

    if (otherMembers.length === 0) {
      return room.name || '나와의 대화';
    }

    if (otherMembers.length === 1) {
      const other = otherMembers[0];
      return `${other.name || '상대방'}`;
    }

    const names = otherMembers.slice(0, 3).map((u) => u.name || '사용자').join(', ');
    return `${names}${otherMembers.length > 3 ? ' 외' : ''} (${members.length}명)`;
  };

  const formatMessageTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? '오후' : '오전';
    hours = hours % 12 || 12;
    return `${ampm} ${hours}:${minutes}`;
  };

  const formatRoomListTime = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      let hours = date.getHours();
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? '오후' : '오전';
      hours = hours % 12 || 12;
      return `${ampm} ${hours}:${minutes}`;
    }

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return '어제';
    }

    return `${date.getMonth() + 1}월 ${date.getDate()}일`;
  };

  const filteredRooms = useMemo(() => {
    const seenSpecial = new Set();
    return rooms
      .filter((r) => !r.educationLevel || r.educationLevel === currentEducationLevel)
      .filter((r) => {
        if (r.type === 'PAYMENT_SYSTEM') {
          return false; // Hide payment system channel
        } else if (r.type === 'NOTIFICATION_SYSTEM') {
          // 개인 알림방(TakeMe 알림) 1개 + 기관 공지 채널(실시간 알림 채널) 1개만 표시
          const key = r.name === 'TakeMe 알림' ? 'PERSONAL' : 'ACADEMY';
          if (seenSpecial.has(key)) return false;
          seenSpecial.add(key);
        }
        const title = getRoomTitle(r).toLowerCase();
        const lastText = (r.latestMessage?.text || '').toLowerCase();
        const q = searchRoomQuery.toLowerCase();
        return !q || title.includes(q) || lastText.includes(q);
      })
      .sort((a, b) => {

        const aPin = a.type === 'NOTIFICATION_SYSTEM';
        const bPin = b.type === 'NOTIFICATION_SYSTEM';
        if (aPin && bPin) return a.name === 'TakeMe 알림' ? -1 : 1; // 내 알림 -> 기관 공지
        if (aPin) return -1;
        if (bPin) return 1;
        // Rooms with unread messages or recent updates float to top
        const unreadA = (a.unreadCount || 0) > 0 ? 1 : 0;
        const unreadB = (b.unreadCount || 0) > 0 ? 1 : 0;
        if (unreadA !== unreadB) return unreadB - unreadA;
        const tA = a.latestMessage ? new Date(a.latestMessage.createdAt).getTime() : new Date(a.updatedAt || a.createdAt).getTime();
        const tB = b.latestMessage ? new Date(b.latestMessage.createdAt).getTime() : new Date(b.updatedAt || b.createdAt).getTime();
        return tB - tA;
      });
  }, [rooms, searchRoomQuery, currentEducationLevel]);

  // Filter users inside New Chat modal
  const filterUserList = (list) => {
    if (!searchUserQuery.trim()) return list;
    const q = searchUserQuery.toLowerCase().trim();
    return list.filter((u) => {
      const name = (u.name || '').toLowerCase();
      const sub = (u.subText || '').toLowerCase();
      const email = (u.email || '').toLowerCase();
      return name.includes(q) || sub.includes(q) || email.includes(q);
    });
  };

  const filteredDrivers = filterUserList(categoryUsers.drivers);
  const filteredTeachers = filterUserList(categoryUsers.teachers);
  const filteredParents = filterUserList(categoryUsers.parents);
  const filteredStudents = filterUserList(categoryUsers.students || []);
  const filteredAdmins = filterUserList(categoryUsers.admins);

  // Group messages by date for date pill separators
  const messagesWithDates = messages.map((m, idx) => {
    const prev = messages[idx - 1];
    const prevDate = prev ? new Date(prev.createdAt).toDateString() : null;
    const currDate = new Date(m.createdAt).toDateString();
    const isNewDate = prevDate !== currDate;
    return {
      ...m,
      isNewDate,
      fullDateStr: new Date(m.createdAt).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }),
    };
  });

  const isCurrentRoomPaymentSystem = activeRoom?.type === 'PAYMENT_SYSTEM' || activeRoom?.name === '결재 전용 채널';
  const isCurrentRoomNotificationSystem = activeRoom?.type === 'NOTIFICATION_SYSTEM' || activeRoom?.name === '실시간 알림 채널';

  const activeOtherUser = (activeRoom?.members || [])
    .map((m) => m.user)
    .find((u) => u && u.email !== myUser.email);
  const isChatWithParent = activeOtherUser?.role === 'PARENT' || activeRoom?.type === 'PARENT' || activeRoom?.name?.includes('학부모');

  return (
    <div
      className={`absolute inset-0 z-[2000] flex bg-slate-100 h-full overflow-hidden transition-all duration-300 ${
        isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'
      }`}
    >
      {/* ============================================================ */}
      {/* LEFT COLUMN: 채팅방 목록 (Kakao Style Room List) */}
      {/* ============================================================ */}
      <div className="w-96 h-full border-r border-slate-200 flex flex-col bg-white overflow-hidden flex-shrink-0 shadow-sm">
        {/* Top Header */}
        <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-800 tracking-tight leading-none">메세지함</h2>
              <span className="text-[11px] text-slate-400 font-medium">실시간 원내 메신저</span>
            </div>
          </div>

          {/* 메세지 보내기 (새 대화) 버튼 */}
          <button
            onClick={handleOpenNewChatModal}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs py-2 px-3 rounded-xl shadow-sm transition-all"
            title="새로운 상대 또는 그룹에게 메세지 보내기"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>메세지 보내기</span>
          </button>
        </div>

        {/* Room Search Bar */}
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="채팅방 또는 참여자 검색..."
              value={searchRoomQuery}
              onChange={(e) => setSearchRoomQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Chat Rooms Scrollable List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
          {filteredRooms.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-6 text-center text-slate-400">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-300 mb-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <p className="text-xs font-semibold text-slate-600">진행 중인 채팅방이 없습니다.</p>
              <p className="text-[11px] text-slate-400 mt-1">상단의 [+ 메세지 보내기]를 눌러 대화를 시작하세요.</p>
            </div>
          ) : (
            filteredRooms.map((room) => {
              const isSelected = activeRoom && activeRoom.id === room.id;
              const isPaymentSystem = room.type === 'PAYMENT_SYSTEM' || room.name === '결재 전용 채널' || room.name === '결제 시스템 방';
              const isNotificationSystem = room.type === 'NOTIFICATION_SYSTEM' || room.name === '실시간 알림 채널';
              const title = getRoomTitle(room);
              const isGroup = (room.members || []).length > 2 || room.type === 'GROUP';
              const lastText = isPaymentSystem
                ? room.latestMessage?.text || '신규 원생 탑승 및 결재 승인 요청 전용 채널입니다.'
                : isNotificationSystem
                ? room.latestMessage?.text || '실시간 출결 변동 및 결재 승인 완료 알림 채널입니다.'
                : room.latestMessage?.text || '대화를 시작해보세요.';
              const lastTime = formatRoomListTime(room.latestMessage?.createdAt || room.updatedAt || room.createdAt);

              // Find other member for role badge in 1:1
              const otherUser = (room.members || [])
                .map((m) => m.user)
                .find((u) => u && u.email !== myUser.email);

              return (
                <div
                  key={room.id}
                  onClick={() => setActiveRoom(room)}
                  className={`p-3.5 flex items-center gap-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-blue-50/80 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                  }`}
                >
                  {/* Room Avatar */}
                  <div className="relative flex-shrink-0">
                    {isSystemAlert ? (
                      <div className="w-11 h-11 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0 relative">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                      </div>
                    ) : isPaymentSystem ? (
                      <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                        </svg>
                      </div>
                    ) : isNotificationSystem ? (
                      <div className="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-sm shadow-xs flex-shrink-0">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                        </svg>
                      </div>
                    ) : isGroup ? (
                      <div className="w-11 h-11 rounded-2xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs shadow-2xs flex-shrink-0">
                        그룹
                      </div>
                    ) : (
                      <div className="w-11 h-11 rounded-2xl bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm shadow-2xs flex-shrink-0">
                        {otherUser?.name?.[0] || title[0] || '대'}
                      </div>
                    )}
                    {room.unreadCount > 0 && (
                      <span className="absolute -bottom-1 -right-1 bg-red-500 text-white text-[10px] font-black min-w-5 h-5 px-1 rounded-full flex items-center justify-center border-2 border-white shadow-2xs">
                        {room.unreadCount > 9 ? '9+' : room.unreadCount}
                      </span>
                    )}
                  </div>

                  {/* Room Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className={`text-xs font-bold truncate ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}>
                          {title}
                        </span>
                        {isPaymentSystem && (
                          <span className="text-[10px] bg-indigo-100 text-indigo-700 font-extrabold px-1.5 py-0.2 rounded-md">
                            결재 전용
                          </span>
                        )}
                        {isNotificationSystem && (
                          <span className="text-[10px] bg-emerald-100 text-emerald-700 font-extrabold px-1.5 py-0.2 rounded-md">
                            실시간 알림
                          </span>
                        )}
                        {!isPaymentSystem && !isNotificationSystem && !isGroup && otherUser && getRoleBadge(otherUser.role)}
                      </div>
                      <span className="text-[10px] text-slate-400 flex-shrink-0">{lastTime}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-slate-500 truncate leading-snug">
                        {lastText}
                      </p>
                      {room.unreadCount > 0 && (
                        <span className="ml-1.5 flex-shrink-0 bg-red-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full leading-tight">
                          {room.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ============================================================ */}
      {/* RIGHT COLUMN: 카톡 스타일 채팅 대화창 */}
      {/* ============================================================ */}
      <div className="flex-1 h-full flex flex-col bg-white overflow-hidden relative">
        {activeRoom ? (
          <>
            {/* Chat Room Header */}
            <div className="h-16 px-6 border-b border-slate-200 bg-white flex items-center justify-between shadow-xs z-10 flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-extrabold text-slate-800 truncate">
                      {getRoomTitle(activeRoom)}
                    </h3>
                    {isCurrentRoomPaymentSystem ? (
                      <span className="text-[11px] bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded-full">
                        결재 전용 채널
                      </span>
                    ) : isCurrentRoomNotificationSystem ? (
                      <span className="text-[11px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
                        실시간 알림 채널
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400 font-bold">
                        {(activeRoom.members || []).length}명 참여중
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {isCurrentRoomPaymentSystem
                      ? '신규 학생 탑승 요청 및 담당 차량 지도교사 수락/거절 시스템 채널입니다.'
                      : isCurrentRoomNotificationSystem
                      ? '결재 완료(지도교사/학부모/원장 승인) 및 출결/통학 변동 알림 전용 채널입니다.'
                      : (activeRoom.members || [])
                          .map((m) => m.user)
                          .filter(Boolean)
                          .map((u) => `${u.name || u.email}`)
                          .join(', ')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* 결재 신청 버튼 (선생-관리자 사이의 내부 절차이므로 학부모 계정 및 학부모와의 대화방에서는 숨김) */}
                {!isCurrentRoomNotificationSystem && !isParent && !isChatWithParent && (
                  <button
                    type="button"
                    onClick={handleOpenPaymentModal}
                    className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-xs transition-all flex items-center gap-1.5"
                    title="신규 원생 결재 및 탑승 신청서 작성"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>결재 신청</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowParticipantsModal(true)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <span>참여자</span>
                </button>
                <button
                  type="button"
                  onClick={() => fetchMessages(activeRoom.id)}
                  className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-50 transition-colors"
                  title="새로고침"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Kakao-style Messages Viewport */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-100">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500">
                  <div className="p-3 bg-white/70 backdrop-blur-xs rounded-full shadow-xs mb-2">
                    <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-xs font-semibold bg-white/80 px-3 py-1 rounded-full text-slate-600 shadow-xs">
                    {isCurrentRoomPaymentSystem
                      ? '결재 및 탑승 승인 내역이 여기에 표시됩니다. 상단 [결재 신청] 버튼으로 신청서를 작성하세요.'
                      : isCurrentRoomNotificationSystem
                      ? '실시간 알림 내역이 여기에 표시됩니다. 결재 완료 및 출결 변동 알림이 자동으로 수신됩니다.'
                      : '새로운 대화가 시작되었습니다. 첫 메시지를 남겨보세요.'}
                  </p>
                </div>
              ) : (
                messagesWithDates
                  .filter(m => !showBookmarksOnly || bookmarkedIds.includes(m.id))
                  .filter(m => {
                    // ★ 핵심 권한 격리: 결재는 선생-관리자 간의 내부 절차이므로 학부모 계정 또는 학부모와의 대화방에서는 완전 숨김
                    if (isParent || isChatWithParent) {
                      if (m.type === 'PAYMENT_REQUEST' || m.payload?.studentName) {
                        return false;
                      }
                    }
                    return true;
                  })
                  .map((msg) => {
                  const isMine = msg.sender?.email === myUser.email || msg.sender?.id === myUser.id;
                  const senderName = msg.sender?.name || msg.sender?.email || '알 수 없음';
                  const senderRole = msg.sender?.role;
                  const isNotificationRoom = isCurrentRoomNotificationSystem || activeRoom?.type === 'NOTIFICATION_SYSTEM';
                  const isPaymentRoom = isCurrentRoomPaymentSystem || activeRoom?.type === 'PAYMENT_SYSTEM';
                  const payload = msg.payload || {};
                  const isSystemAlert = Boolean(payload.isSystemAlert || msg.type === 'SYSTEM_ALERT' || isNotificationRoom);
                  const isPaymentRequest = !isNotificationRoom && (msg.type === 'PAYMENT_REQUEST' || (isPaymentRoom && Boolean(payload.studentName && !isSystemAlert)));
                  const isContest = Boolean(payload.isPublicContest || payload.requestType === 'CONTEST');
                  const isRequester =
                    isMine ||
                    (payload.requesterEmail && myUser.email && payload.requesterEmail.toLowerCase() === myUser.email.toLowerCase()) ||
                    (payload.requesterId && myUser.id && Number(payload.requesterId) === myUser.id);
                  const isTargetTeacher =
                    (payload.targetTeacherEmail && myUser.email && payload.targetTeacherEmail.toLowerCase() === myUser.email.toLowerCase()) ||
                    (payload.targetTeacherId && myUser.id && Number(payload.targetTeacherId) === myUser.id) ||
                    (payload.teacherEmail && myUser.email && payload.teacherEmail.toLowerCase() === myUser.email.toLowerCase());
                  const isAdmin = myUser.role === 'ACADEMY_ADMIN' || myUser.role === 'SUPER_ADMIN';

                  return (
                    <React.Fragment key={msg.id}>
                      {/* Date Separator Pill */}
                      {msg.isNewDate && (
                        <div className="flex justify-center my-3">
                          <span className="bg-black/15 text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-2xs backdrop-blur-xs">
                            {msg.fullDateStr}
                          </span>
                        </div>
                      )}

                      {/* 1. SYSTEM NOTIFICATION ALERT CARD (Notification System Room) */}
                      {isSystemAlert ? (
                        <div className="flex flex-col items-center my-2.5 w-full animate-fade-in">
                          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs hover:shadow-md transition-shadow overflow-hidden max-w-lg w-full">
                            {/* Card Header */}
                            <div className={`px-4 py-2.5 flex items-center justify-between border-b ${
                              payload.category === 'PAYMENT_DECISION' && (payload.title?.includes('반려') || payload.decision === 'REJECTED')
                                ? 'bg-rose-50/80 border-rose-100'
                                : payload.category === 'PAYMENT_DECISION' || payload.title?.includes('승인') || payload.title?.includes('완료')
                                ? 'bg-emerald-50/80 border-emerald-100'
                                : payload.category === 'ABSENT' || payload.title?.includes('결석')
                                ? 'bg-rose-50/80 border-rose-100'
                                : payload.category === 'PICKUP' || payload.title?.includes('픽업')
                                ? 'bg-blue-50/80 border-blue-100'
                                : 'bg-indigo-50/80 border-indigo-100'
                            }`}>
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${
                                  payload.category === 'PAYMENT_DECISION' && (payload.title?.includes('반려') || payload.decision === 'REJECTED')
                                    ? 'bg-rose-500'
                                    : payload.category === 'PAYMENT_DECISION' || payload.title?.includes('승인') || payload.title?.includes('완료')
                                    ? 'bg-emerald-500'
                                    : payload.category === 'ABSENT' || payload.title?.includes('결석')
                                    ? 'bg-rose-500'
                                    : 'bg-indigo-500'
                                }`}></span>
                                <span className="text-xs font-black text-slate-800">
                                  {payload.title || (payload.category === 'PAYMENT_DECISION' ? '결재 완료 안내' : '실시간 알림')}
                                </span>
                                <span className={`text-[10px] font-extrabold px-2 py-0.2 rounded-full border ${
                                  payload.category === 'PAYMENT_DECISION' && (payload.title?.includes('반려') || payload.decision === 'REJECTED')
                                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                                    : payload.category === 'PAYMENT_DECISION' || payload.title?.includes('승인') || payload.title?.includes('완료')
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                    : payload.category === 'ABSENT' || payload.title?.includes('결석')
                                    ? 'bg-rose-100 text-rose-800 border-rose-300'
                                    : payload.category === 'PICKUP' || payload.title?.includes('픽업')
                                    ? 'bg-blue-100 text-blue-800 border-blue-300'
                                    : 'bg-indigo-100 text-indigo-800 border-indigo-300'
                                }`}>
                                  {payload.category === 'PAYMENT_DECISION'
                                    ? (payload.decision === 'REJECTED' || payload.title?.includes('반려') ? '결재 반려' : '결재 승인 완료')
                                    : payload.category === 'ABSENT' ? '출결 결석'
                                    : payload.category === 'PICKUP' ? '개별 픽업'
                                    : payload.category === 'SHUTTLE_REQUEST' ? '셔틀 탑승'
                                    : '안내 알림'}
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400">
                                {formatMessageTime(msg.createdAt)}
                              </span>
                            </div>

                            {/* Card Body */}
                            <div className="p-3.5 space-y-2.5">
                              <p className="text-xs font-bold text-slate-800 leading-relaxed break-keep">
                                {payload.content || msg.text}
                              </p>
                              {payload.extraData && (
                                <div className="bg-slate-50 rounded-xl p-2.5 text-[11px] text-slate-600 space-y-1 border border-slate-100 font-medium">
                                  {payload.extraData.studentName && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-400">대상 원아:</span>
                                      <span className="font-bold text-slate-700">{payload.extraData.studentName}</span>
                                    </div>
                                  )}
                                  {payload.extraData.busNumber && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-400">배정 차량:</span>
                                      <span className="font-bold text-indigo-600">{payload.extraData.busNumber}</span>
                                    </div>
                                  )}
                                  {payload.extraData.boardingLocation && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-400">탑승 위치:</span>
                                      <span className="font-bold text-slate-700 truncate max-w-[200px]">{payload.extraData.boardingLocation}</span>
                                    </div>
                                  )}
                                  {payload.extraData.decidedBy && (
                                    <div className="flex justify-between">
                                      <span className="text-slate-400">처리 담당자:</span>
                                      <span className="font-bold text-slate-700">{payload.extraData.decidedBy}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : isPaymentRequest ? (
                        <div className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} my-2 animate-fade-in`}>
                          {/* Sender Info Header */}
                          <div className="flex items-center gap-1.5 mb-1 px-1">
                            <span className="text-xs font-bold text-slate-800">{senderName}</span>
                            {senderRole && getRoleBadge(senderRole)}
                            <span className="text-[10px] text-slate-600 ml-1">
                              {formatMessageTime(msg.createdAt)}
                            </span>
                          </div>

                          {/* Card Body */}
                          <div className="bg-white border-2 border-indigo-200 rounded-2xl shadow-md overflow-hidden max-w-md w-full">
                            {/* Card Top Title Banner */}
                            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-3.5 border-b border-indigo-100 flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-xs shadow-xs">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                  </svg>
                                </div>
                                <div>
                                  <h4 className="text-xs font-black text-indigo-950">
                                    '신규 탑승 및 결재 승인 요청'
                                  </h4>
                                  <span className="text-[10px] text-indigo-600 font-medium">
                                    '담당 차량 지도교사 수락/거절'
                                  </span>
                                </div>
                              </div>

                              {/* Status & Ride Type Badges */}
                              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-300">
                                  1:1 지정 결재
                                </span>

                                {payload.rideType === 'TODAY_ONLY' ? (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                                    당일 1회 탑승
                                  </span>
                                ) : (
                                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-300">
                                    정규 셔틀 등록
                                  </span>
                                )}

                                {payload.status === 'APPROVED' ? (
                                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    ✓ 결제 수락 완료
                                  </span>
                                ) : payload.status === 'RE_REQUESTED' ? (
                                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-purple-100 text-purple-800 border border-purple-300 animate-pulse flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-purple-600"></span>
                                    위치 변경 재결재 요청
                                  </span>
                                ) : payload.status === 'REJECTED' ? (
                                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                                    ✕ 결재 반려됨
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300 animate-pulse">
                                    승인 대기중
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Card Content */}
                            <div className="p-4 space-y-3">
                              {/* Counter Proposal Banner if RE_REQUESTED */}
                              {payload.status === 'RE_REQUESTED' && (
                                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 p-3.5 rounded-2xl border-2 border-purple-200 space-y-2">
                                  <div className="flex items-center gap-1.5 text-xs font-black text-purple-900">
                                    <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    <span>지도교사 위치 변경 재결재 요청</span>
                                  </div>
                                  <p className="text-xs font-bold text-purple-950 bg-white/80 p-2.5 rounded-xl border border-purple-100 leading-relaxed">
                                    "{payload.counterProposal?.note || payload.counterNote || '통학버스 운행 여건에 따른 탑승 위치 변경 제안'}"
                                  </p>
                                  <div className="text-[10px] text-purple-700 font-semibold text-right">
                                    제안 지도교사: {payload.counterProposal?.proposedBy || payload.counterProposedBy || '담당 지도교사'}
                                  </div>
                                </div>
                              )}

                              {/* 1. 메세지 */}
                              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                                <div className="text-[10px] text-slate-400 font-bold mb-1 flex items-center gap-1">
                                  <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                  </svg>
                                  <span>관리자 원래 신청 내용</span>
                                </div>
                                <p className="text-xs font-bold text-slate-800 leading-relaxed">
                                  "{payload.note || '학부모 상담 후 신규 탑승지 지정 및 결재 승인 요청'}"
                                </p>
                              </div>

                              {/* Student & Bus Details */}
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                  <span className="text-[10px] font-bold text-slate-400 block">탑승 학생</span>
                                  <span className="font-extrabold text-slate-800 text-sm">{payload.studentName}</span>
                                </div>
                                <div className="p-2.5 rounded-xl bg-blue-50/60 border border-blue-100">
                                  <span className="text-[10px] font-bold text-blue-500 block">
                                    {isContest && payload.status === 'PENDING' ? '신청 구분' : '희망/배정 차량'}
                                  </span>
                                  <span className="font-extrabold text-blue-900 text-sm truncate block">
                                    {isContest && payload.status === 'PENDING' ? '오픈 공모 (선착순 배정)' : payload.busNumber}
                                  </span>
                                  <span className="text-[10px] text-blue-600 block truncate">
`교사: ${formatTeacherName(payload.teacherName) || '담당 교사'}`
                                  </span>
                                </div>
                              </div>

                              {/* 2. 날짜 */}
                              <div className="flex items-center gap-2 text-xs text-slate-700 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                                <svg className="w-4 h-4 text-indigo-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                <span className="text-slate-400 font-bold">탑승 희망 일자:</span>
                                <span className="font-extrabold text-slate-900">{payload.requestDate}</span>
                              </div>

                              {/* Location text */}
                              {payload.status === 'RE_REQUESTED' && payload.counterProposal ? (
                                <div className="grid grid-cols-2 gap-2 text-xs">
                                  <div className="p-2.5 rounded-xl bg-red-50/50 border border-red-200">
                                    <span className="text-[10px] font-bold text-red-500 block">관리자 지정 원래 탑승지</span>
                                    <span className="font-extrabold text-slate-900 block truncate" title={payload.counterProposal.originalLocation?.boardingLocation}>
                                      {payload.counterProposal.originalLocation?.boardingLocation}
                                    </span>
                                  </div>
                                  <div className="p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-300">
                                    <span className="text-[10px] font-bold text-emerald-700 block">지도교사 제안 탑승지</span>
                                    <span className="font-extrabold text-emerald-950 block truncate" title={payload.counterProposal.suggestedLocation?.boardingLocation}>
                                      {payload.counterProposal.suggestedLocation?.boardingLocation}
                                    </span>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start gap-2 text-xs text-slate-700 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                                  <svg className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                  </svg>
                                  <div>
                                    <span className="text-slate-400 font-bold mr-1">탑승 위치:</span>
                                    <span className="font-extrabold text-slate-900">{payload.boardingLocation}</span>
                                    {payload.address && payload.address !== payload.boardingLocation && (
                                      <span className="text-[11px] text-slate-500 block mt-0.5">{payload.address}</span>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* 3. 지도 (Single Pin or Comparison Pins) */}
                              {payload.status === 'RE_REQUESTED' && payload.counterProposal ? (
                                <ComparisonLocationMap
                                  original={payload.counterProposal.originalLocation}
                                  suggested={payload.counterProposal.suggestedLocation}
                                />
                              ) : (
                                <MiniLocationMap
                                  lat={payload.latitude}
                                  lng={payload.longitude}
                                  locationName={payload.boardingLocation}
                                  icon={payload.status === 'APPROVED' ? greenPinIcon : bluePinIcon}
                                />
                              )}

                              {/* 4. 결재 반려 / 수락 버튼 및 학부모 알림 푸시 */}
                              {payload.status === 'APPROVED' ? (
                                <div className="space-y-2">
                                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-2">
                                    <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                    </svg>
                                    <div>
                                      <span>
                                        {`✓ 결재 수락 완료: ${payload.busNumber} 노선 및 구역 배정 완료`}
                                      </span>
                                      {payload.decidedBy && (
                                        <span className="block text-[10px] text-emerald-600 font-normal">
                                          승인자: {payload.decidedBy} ({payload.decidedAt ? formatMessageTime(payload.decidedAt) : ''})
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* 학부모 알림 푸시 버튼 (메시지 창에서 직접 푸시) */}
                                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                                    <div className="text-[11px] text-slate-500 font-semibold flex items-center gap-1">
                                      <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                                      </svg>
                                      <span>학부모 하차 안내:</span>
                                    </div>
                                    <button
                                      type="button"
                                      disabled={isPushingParent === msg.id}
                                      onClick={() => handlePushParentNotification(msg.id)}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 shadow-xs ${
                                        payload.parentPushedAt
                                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'
                                          : 'bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white'
                                      }`}
                                    >
                                      {payload.parentPushedAt ? (
                                        <>
                                          <svg className="w-3 h-3 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
                                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                          </svg>
                                          <span>알림 발송 완료</span>
                                          <span className="text-[10px] opacity-75">({formatMessageTime(payload.parentPushedAt)})</span>
                                        </>
                                      ) : (
                                        <>
                                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                          </svg>
                                          <span>{isPushingParent === msg.id ? '발송 중...' : '학부모 알림 푸시'}</span>
                                        </>
                                      )}
                                    </button>
                                  </div>
                                </div>
                              ) : payload.status === 'REJECTED' ? (
                                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2">
                                  <svg className="w-4 h-4 text-rose-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  <div>
                                    <span>
                                      '탑승 및 결재 요청이 거절되었습니다.'
                                    </span>
                                    {payload.decidedBy && (
                                      <span className="block text-[10px] text-rose-600 font-normal">
                                        처리자: {payload.decidedBy}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : isRequester ? (
                                /* 신청자 본인인 경우: 자가 승인 금지 안내 */
                                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-center space-y-1">
                                  <div className="flex items-center justify-center gap-1.5 text-xs font-black text-amber-900">
                                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>상대방 결재 대기 중</span>
                                  </div>
                                  <p className="text-[11px] text-amber-700 font-medium">
                                    신청자는 직접 결재할 수 없으며, 상대방({isContest ? '지도교사 공모 수락자' : `${formatTeacherName(payload.teacherName) || '담당 지도교사'} / 원장님`})만 결재 가능합니다.
                                  </p>
                                </div>
                              ) : isParent ? (
                                <div className="text-center py-2.5 px-3 bg-slate-100 rounded-xl text-xs text-slate-500 font-medium">
                                  담당 차량 지도교사 또는 관리자 승인 대기 중입니다.
                                </div>
                              ) : payload.status === 'RE_REQUESTED' ? (
                                /* Action for Director/Admin on Counter-Proposal */
                                <div className="space-y-1.5 pt-1">
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleDecidePaymentRequest(msg.id, 'APPROVED')}
                                      disabled={isDeciding === msg.id}
                                      className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>지도교사 제안 위치로 최종 수락</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDecidePaymentRequest(msg.id, 'REJECTED')}
                                      disabled={isDeciding === msg.id}
                                      className="py-2.5 px-4 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 active:scale-95 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                                    >
                                      거절
                                    </button>
                                  </div>
                                  <p className="text-[10px] text-center text-slate-400 font-medium">
                                    관리자님께서 수락하시면 지도교사가 제안한 위치로 최종 노선/구역이 확정됩니다.
                                  </p>
                                </div>
                              ) : isContest ? (
                                /* Action for Teachers/Admin on Open Contest */
                                <div className="space-y-1.5 pt-1">
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleDecidePaymentRequest(msg.id, 'APPROVED')}
                                      disabled={isDeciding === msg.id}
                                      className="flex-1 py-2.5 px-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>먼저 공모 수락 (내 차량 배정)</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDecidePaymentRequest(msg.id, 'REJECTED')}
                                      disabled={isDeciding === msg.id}
                                      className="py-2.5 px-3 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 active:scale-95 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                                    >
                                      거절
                                    </button>
                                  </div>
                                  <p className="text-[10px] text-center text-purple-700 font-semibold">
                                    담당 지도교사 또는 원장님께서 수락하시면 해당 차량의 탑승 노선에 자동 반영됩니다.
                                  </p>
                                </div>
                              ) : (isTargetTeacher || isAdmin) ? (
                                /* Action for Designated Guide Teacher/Admin on 1:1 PENDING */
                                <div className="space-y-1.5 pt-1">
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleDecidePaymentRequest(msg.id, 'APPROVED')}
                                      disabled={isDeciding === msg.id}
                                      className="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                      </svg>
                                      <span>결제 수락 (구역 자동배정)</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleOpenCounterModal(msg)}
                                      className="py-2.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 active:scale-95 font-extrabold text-xs rounded-xl transition-all flex items-center gap-1"
                                      title="다른 위치를 지도에서 핀으로 찍어 관리자에게 재결재 요청"
                                    >
                                      <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                      </svg>
                                      <span>다른 위치 핀 찍어 재결재 요청</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDecidePaymentRequest(msg.id, 'REJECTED')}
                                      disabled={isDeciding === msg.id}
                                      className="py-2.5 px-3 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 text-slate-600 border border-slate-200 active:scale-95 font-bold text-xs rounded-xl transition-all disabled:opacity-50"
                                    >
                                      거절
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                /* 1:1 결재 건이지만 다른 지도교사가 열람한 경우 */
                                <div className="p-3 bg-slate-100 rounded-xl border border-slate-200 text-center space-y-0.5">
                                  <div className="text-xs font-bold text-slate-700">
                                    1:1 지정 결재 건
                                  </div>
                                  <p className="text-[10px] text-slate-500">
                                    해당 1:1 결재는 지정된 담당 지도교사({formatTeacherName(payload.teacherName) || payload.busNumber}) 또는 원장님만 결재할 수 있습니다.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        /* Standard Chat Bubble */
                        isMine ? (
                          <div className="flex justify-end items-end gap-1.5 animate-fade-in">
                            <div className="flex flex-col items-end pb-0.5 select-none">
                              {Number(msg.unreadCount) > 0 && (
                                <span className="text-[10px] text-amber-500 font-black leading-none pb-0.5">
                                  {msg.unreadCount}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-600 font-medium">
                                {formatMessageTime(msg.createdAt)}
                              </span>
                            </div>
                            <div className="bg-blue-600 text-white px-3.5 py-2.5 rounded-2xl rounded-tr-xs text-xs font-medium max-w-[70%] break-words shadow-xs">
                              <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start gap-2 animate-fade-in">
                            <div className="w-9 h-9 rounded-xl bg-white text-slate-700 border border-slate-200 flex items-center justify-center font-black text-xs flex-shrink-0 shadow-2xs">
                              {senderName[0] || '상'}
                            </div>

                            <div className="flex flex-col max-w-[70%]">
                              <div className="flex items-center gap-1.5 mb-1 pl-0.5">
                                <span className="text-xs font-bold text-slate-800">{senderName}</span>
                                {senderRole && getRoleBadge(senderRole)}
                              </div>

                              <div className="flex items-end gap-1.5">
                                <div className="bg-white text-slate-800 px-3.5 py-2.5 rounded-2xl rounded-tl-xs text-xs font-medium break-words shadow-xs border border-white/80">
                                  <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                                </div>
                                <div className="flex flex-col items-start pb-0.5 select-none">
                                  {Number(msg.unreadCount) > 0 && (
                                    <span className="text-[10px] text-amber-500 font-black leading-none pb-0.5">
                                      {msg.unreadCount}
                                    </span>
                                  )}
                                  <span className="text-[10px] text-slate-600 font-medium">
                                    {formatMessageTime(msg.createdAt)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </React.Fragment>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Bar */}
            {isCurrentRoomNotificationSystem ? (
              <div className="p-4 bg-slate-50 border-t border-slate-200 text-center text-xs font-bold text-slate-500 flex items-center justify-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>실시간 알림 채널입니다. (지도교사/학부모 결재 승인 완료 및 출결 변동 알림 자동 수신 전용)</span>
              </div>
            ) : (
              <div className="p-4 bg-white border-t border-slate-200 flex items-end gap-2 shadow-sm relative">
                {/* Quick Action [+] Menu Popup */}
                {showPlusMenu && (
                  <div className="absolute bottom-20 left-4 z-30 bg-white rounded-2xl shadow-2xl border border-slate-200 p-2 w-64 space-y-1 animate-scale-up">
                    <div className="text-[11px] font-black text-slate-400 px-2 py-1 uppercase">빠른 서식 / 결재 신청</div>
                    {!isParent && !isChatWithParent && (
                      <button
                        type="button"
                        onClick={() => {
                          setShowPlusMenu(false);
                          handleOpenPaymentModal();
                        }}
                        className="w-full text-left px-3 py-2 rounded-xl hover:bg-indigo-50 text-indigo-950 font-bold text-xs flex items-center gap-2 transition"
                      >
                        <span className="w-6 h-6 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-black">결</span>
                        <span>셔틀 탑승 결재 요청</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        setInputText('[원아 결석 알림]\n- 원아명: \n- 결석 일자: 오늘\n- 결석 사유: ');
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-rose-50 text-rose-950 font-bold text-xs flex items-center gap-2 transition"
                    >
                      <span className="w-6 h-6 rounded-lg bg-rose-100 text-rose-600 flex items-center justify-center text-xs font-black">결</span>
                      <span>원아 결석 알림서</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        setInputText('[등원 지각 알림]\n- 원아명: \n- 예상 등원 시간: \n- 지각 사유: ');
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-amber-50 text-amber-950 font-bold text-xs flex items-center gap-2 transition"
                    >
                      <span className="w-6 h-6 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center text-xs font-black">지</span>
                      <span>등원 지각 알림서</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowPlusMenu(false);
                        setInputText('[연장 보육 신청]\n- 원아명: \n- 신청 시간: ~ 19:30\n- 귀가 방식: 직접 픽업');
                      }}
                      className="w-full text-left px-3 py-2 rounded-xl hover:bg-purple-50 text-purple-950 font-bold text-xs flex items-center gap-2 transition"
                    >
                      <span className="w-6 h-6 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center text-xs font-black">연</span>
                      <span>연장 보육 신청서</span>
                    </button>
                  </div>
                )}

                {/* [+] Button */}
                <button
                  type="button"
                  onClick={() => setShowPlusMenu(prev => !prev)}
                  className={`h-[52px] w-[52px] rounded-xl flex items-center justify-center font-black text-xl transition-all shadow-xs shrink-0 ${
                    showPlusMenu
                      ? 'bg-indigo-600 text-white rotate-45'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900'
                  }`}
                  title="빠른 서식 (결재, 결석, 지각, 연장보육)"
                >
                  +
                </button>

                {/* Preset Phrases Button */}
                <button
                  type="button"
                  onClick={() => setShowPhrasesModal(true)}
                  className="h-[52px] px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition flex items-center gap-1 shrink-0"
                  title="자주 쓰는 문구 선택 및 저장"
                >
                  <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                  </svg>
                  <span className="hidden sm:inline">문구</span>
                </button>

                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="메세지를 입력하세요. (Enter: 전송, Shift+Enter: 줄바꿈)"
                  rows={2}
                  className="flex-1 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none transition-all"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={isSending || !inputText.trim()}
                  className="h-[52px] px-5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 flex-shrink-0"
                >
                  <span>전송</span>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-400 bg-slate-50/50">
            <div className="w-16 h-16 rounded-3xl bg-white shadow-md flex items-center justify-center text-slate-300 mb-4">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="text-base font-extrabold text-slate-700">선택된 대화방이 없습니다.</h3>
            <p className="text-xs text-slate-400 mt-1.5 max-w-xs">
              좌측 목록에서 대화방을 선택하거나 상단의 [+ 메세지 보내기]를 눌러 새로운 대화를 시작하세요.
            </p>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* MODAL: 새 대화 상대 선택 (New Chat Role Categorized Modal) */}
      {/* ============================================================ */}
      {isNewChatModalOpen && (
        <div className="fixed inset-0 z-[3000] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh] animate-scale-up">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-extrabold text-slate-800">대화 상대 선택</h3>
                <p className="text-xs text-slate-400 mt-0.5">메세지를 보낼 상대를 역할별로 선택하세요 (다수 선택 시 그룹 톡).</p>
              </div>
              <button
                type="button"
                onClick={() => setIsNewChatModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* User Search Bar */}
            <div className="p-3 border-b border-slate-100 bg-white">
              <div className="relative">
                <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="이름, 역할 또는 이메일 검색..."
                  value={searchUserQuery}
                  onChange={(e) => setSearchUserQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Quick Role Select Toolbar (역할별 및 관련인원 전체 선택 툴바) */}
            <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-1 flex-wrap">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleToggleSelectAllUsers}
                  className="px-2.5 py-1 text-xs font-black rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition shadow-2xs cursor-pointer"
                >
                  관련인원 전체 {selectedUserIds.length === (filteredDrivers.length + filteredTeachers.length + filteredParents.length + filteredAdmins.length) && selectedUserIds.length > 0 ? '해제' : '선택'}
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSelectRole(filteredTeachers)}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition cursor-pointer"
                >
                  교사 전체 ({filteredTeachers.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSelectRole(filteredDrivers)}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-blue-100 text-blue-800 hover:bg-blue-200 transition cursor-pointer"
                >
                  기사 전체 ({filteredDrivers.length})
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSelectRole(filteredParents)}
                  className="px-2 py-1 text-xs font-bold rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 transition cursor-pointer"
                >
                  학부모 전체 ({filteredParents.length})
                </button>
                {filteredAdmins.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleToggleSelectRole(filteredAdmins)}
                    className="px-2 py-1 text-xs font-bold rounded-lg bg-purple-100 text-purple-800 hover:bg-purple-200 transition cursor-pointer"
                  >
                    관리자 전체 ({filteredAdmins.length})
                  </button>
                )}
              </div>
              {selectedUserIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedUserIds([])}
                  className="text-[11px] text-slate-400 hover:text-rose-600 font-bold underline cursor-pointer"
                >
                  선택 초기화 ({selectedUserIds.length}명)
                </button>
              )}
            </div>

            {/* Categorized Users List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isLoadingUsers ? (
                <div className="py-12 text-center text-xs text-slate-400 font-semibold">
                  사용자 목록을 불러오는 중...
                </div>
              ) : (
                <>
                  {/* Category 1: 기사 (Drivers) */}
                  {filteredDrivers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-black text-blue-700 bg-blue-50/80 px-2.5 py-1.5 rounded-lg border border-blue-100">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          <span>기사 ({filteredDrivers.length}명)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRole(filteredDrivers)}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                        >
                          기사 전체 {filteredDrivers.every(u => selectedUserIds.includes(u.id)) ? '해제' : '선택'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 pl-1">
                        {filteredDrivers.map((u) => {
                          const isChecked = selectedUserIds.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${
                                isChecked ? 'bg-blue-50 border-blue-300 shadow-xs' : 'border-slate-100 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSelectUser(u.id)}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                                {u.name[0] || '기'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-800">{u.name}</span>
                                <span className="text-[11px] text-blue-600 ml-2 font-medium">({u.subText})</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 2: 교사 (Teachers) */}
                  {filteredTeachers.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-black text-emerald-700 bg-emerald-50/80 px-2.5 py-1.5 rounded-lg border border-emerald-100">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          <span>교사 ({filteredTeachers.length}명)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRole(filteredTeachers)}
                          className="text-[11px] font-bold text-emerald-600 hover:text-emerald-800 hover:underline cursor-pointer"
                        >
                          교사 전체 {filteredTeachers.every(u => selectedUserIds.includes(u.id)) ? '해제' : '선택'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 pl-1">
                        {filteredTeachers.map((u) => {
                          const isChecked = selectedUserIds.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${
                                isChecked ? 'bg-emerald-50 border-emerald-300 shadow-xs' : 'border-slate-100 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSelectUser(u.id)}
                                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs">
                                {u.name[0] || '교'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-800">{u.name}</span>
                                <span className="text-[11px] text-emerald-600 ml-2 font-medium">({u.subText})</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 3: 학생 (Students) - 유치원이 아닐 때(초등부, 중·고등부)만 노출 */}
                  {!isKindergarten && filteredStudents.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-black text-indigo-800 bg-indigo-50/80 px-2.5 py-1.5 rounded-lg border border-indigo-100">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-indigo-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                          </svg>
                          <span>학생 ({filteredStudents.length}명)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRole(filteredStudents)}
                          className="text-[11px] font-bold text-indigo-800 hover:text-indigo-950 hover:underline cursor-pointer"
                        >
                          학생 전체 {filteredStudents.every(u => selectedUserIds.includes(u.id)) ? '해제' : '선택'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 pl-1">
                        {filteredStudents.map((u) => {
                          const isChecked = selectedUserIds.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${
                                isChecked ? 'bg-indigo-50 border-indigo-300 shadow-xs' : 'border-slate-100 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSelectUser(u.id)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center font-bold text-xs">
                                {u.name[0] || '생'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-800">{u.name}</span>
                                <span className="text-[11px] text-indigo-700 ml-2 font-medium">({u.subText})</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 4: 학부모 (Parents) - 유치원, 초등부, 중·고등부 모두 노출 */}
                  {filteredParents.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-black text-amber-800 bg-amber-50/80 px-2.5 py-1.5 rounded-lg border border-amber-100">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                          </svg>
                          <span>학부모 ({filteredParents.length}명)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRole(filteredParents)}
                          className="text-[11px] font-bold text-amber-800 hover:text-amber-950 hover:underline cursor-pointer"
                        >
                          학부모 전체 {filteredParents.every(u => selectedUserIds.includes(u.id)) ? '해제' : '선택'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 pl-1">
                        {filteredParents.map((u) => {
                          const isChecked = selectedUserIds.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${
                                isChecked ? 'bg-amber-50 border-amber-300 shadow-xs' : 'border-slate-100 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSelectUser(u.id)}
                                className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center font-bold text-xs">
                                {u.name[0] || '학'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-800">{u.name}</span>
                                <span className="text-[11px] text-amber-700 ml-2 font-medium">({u.subText})</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Category 4: 관리자 (Admins) */}
                  {filteredAdmins.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-black text-purple-700 bg-purple-50/80 px-2.5 py-1.5 rounded-lg border border-purple-100">
                        <div className="flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                          </svg>
                          <span>관리자 ({filteredAdmins.length}명)</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRole(filteredAdmins)}
                          className="text-[11px] font-bold text-purple-600 hover:text-purple-800 hover:underline cursor-pointer"
                        >
                          관리자 전체 {filteredAdmins.every(u => selectedUserIds.includes(u.id)) ? '해제' : '선택'}
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-1 pl-1">
                        {filteredAdmins.map((u) => {
                          const isChecked = selectedUserIds.includes(u.id);
                          return (
                            <label
                              key={u.id}
                              className={`flex items-center gap-3 p-2 rounded-xl border cursor-pointer transition-all ${
                                isChecked ? 'bg-purple-50 border-purple-300 shadow-xs' : 'border-slate-100 hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleSelectUser(u.id)}
                                className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500 cursor-pointer"
                              />
                              <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs">
                                {u.name[0] || '원'}
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-xs font-bold text-slate-800">{u.name}</span>
                                <span className="text-[11px] text-purple-600 ml-2 font-medium">({u.subText})</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {filteredDrivers.length === 0 &&
                    filteredTeachers.length === 0 &&
                    filteredParents.length === 0 &&
                    filteredAdmins.length === 0 && (
                      <div className="py-10 text-center text-slate-400 text-xs">
                        검색 결과와 일치하는 사용자가 없습니다.
                      </div>
                    )}
                </>
              )}
            </div>

            {/* Modal Bottom: Selection Summary & Group Chat Option */}
            <div className="p-4 border-t border-slate-200 bg-slate-50 space-y-3">
              {selectedUserIds.length > 1 && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-bold text-purple-800">
                    <span>그룹 톡 생성 모드</span>
                    <span className="text-[11px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                      {selectedUserIds.length}명 선택됨
                    </span>
                  </div>
                  <input
                    type="text"
                    placeholder="그룹 채팅방 이름 입력 (미입력 시 참여자 이름으로 자동 설정)"
                    value={customGroupName}
                    onChange={(e) => setCustomGroupName(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                </div>
              )}

              {selectedUserIds.length === 1 && (
                <p className="text-xs font-bold text-blue-600">
                  1:1 대화방으로 연결됩니다.
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsNewChatModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleStartChat}
                  disabled={isCreatingRoom || selectedUserIds.length === 0}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isCreatingRoom ? '채팅방 여는 중...' : selectedUserIds.length > 1 ? '그룹 톡 시작' : '대화 시작'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: 신규 탑승 및 결재 신청서 (Payment Request Modal) */}
      {/* ============================================================ */}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-[3000] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-indigo-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-scale-up">
            {/* Modal Header */}
            <div className="p-4 border-b border-indigo-100 bg-gradient-to-r from-indigo-50 to-purple-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-indigo-950">신규 탑승 및 결재 신청</h3>
                  <p className="text-[11px] text-indigo-600 font-medium">담당 차량 지도교사에게 탑승 승인 및 배정을 요청합니다.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPaymentModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmitPaymentRequest} className="flex-1 overflow-y-auto p-5 space-y-4">
              {isLoadingPaymentContext ? (
                <div className="py-12 text-center text-xs text-slate-400 font-semibold">
                  원생 및 차량 정보를 불러오는 중...
                </div>
              ) : (
                <>
                  {/* 1. 원생(학생) 선택 */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-800 flex items-center gap-1">
                        <span>탑승 원생(학생)</span>
                        <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => setPaymentForm((prev) => ({ ...prev, studentSelectMode: 'DROPDOWN' }))}
                          className={`font-bold pb-0.5 border-b-2 transition-colors ${
                            paymentForm.studentSelectMode === 'DROPDOWN'
                              ? 'border-indigo-600 text-indigo-600'
                              : 'border-transparent text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          등록된 원생 선택
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => setPaymentForm((prev) => ({ ...prev, studentSelectMode: 'CUSTOM', selectedStudentId: '' }))}
                          className={`font-bold pb-0.5 border-b-2 transition-colors ${
                            paymentForm.studentSelectMode === 'CUSTOM'
                              ? 'border-indigo-600 text-indigo-600'
                              : 'border-transparent text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          신규 원생 직접 입력
                        </button>
                      </div>
                    </div>

                    {paymentForm.studentSelectMode === 'DROPDOWN' ? (
                      <select
                        value={paymentForm.selectedStudentId}
                        onChange={(e) => handleStudentSelect(e.target.value)}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      >
                        <option value="">-- 원생을 선택하세요 --</option>
                        {(paymentContext.students || []).map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name} ({st.assignedBusNumber ? `${st.assignedBusNumber}` : '미배정'}) - {st.boardingLocation || st.address || '주소 미등록'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        placeholder="신규 원생 이름 입력 (예: 김민수)"
                        value={paymentForm.customStudentName}
                        onChange={(e) => setPaymentForm((prev) => ({ ...prev, customStudentName: e.target.value }))}
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                      />
                    )}

                    {/* 원아 및 학부모 상세 정보 요약 카드 (등록된 원생 선택 시 자동 표시) */}
                    {paymentForm.studentSelectMode === 'DROPDOWN' && paymentForm.selectedStudentId && (() => {
                      const selectedSt = (paymentContext.students || []).find((s) => String(s.id) === String(paymentForm.selectedStudentId));
                      if (!selectedSt) return null;
                      return (
                        <div className="bg-gradient-to-br from-indigo-50/90 via-white to-blue-50/90 border-2 border-indigo-200 rounded-2xl p-4 space-y-3 shadow-xs animate-fade-in">
                          <div className="flex items-center justify-between border-b border-indigo-100 pb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse"></span>
                              <span className="font-extrabold text-sm text-indigo-950">{selectedSt.name} 원아 상세 정보</span>
                              {selectedSt.className && (
                                <span className="text-[11px] font-black px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 border border-indigo-200">
                                  {selectedSt.className}반
                                </span>
                              )}
                            </div>
                            <span className="text-xs font-bold text-slate-500">
                              현재 배정: <strong className="text-indigo-600">{selectedSt.assignedBusNumber || '미배정'}</strong>
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-white/90 p-2.5 rounded-xl border border-slate-200 space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 block">학부모(보호자) 정보</span>
                              <div className="font-black text-slate-800">
                                {selectedSt.parentName || '보호자 성함 미등록'}
                              </div>
                              <div className="text-[11px] font-mono text-blue-600 font-bold">
                                {selectedSt.parentPhone || '연락처 미등록'}
                              </div>
                            </div>

                            <div className="bg-white/90 p-2.5 rounded-xl border border-slate-200 space-y-1">
                              <span className="text-[10px] font-bold text-slate-400 block">생일 및 건강 특이사항</span>
                              <div className="font-bold text-slate-700">
                                생년월일: <span className="font-mono">{selectedSt.birthDate || '-'}</span>
                              </div>
                              <div className="text-[11px]">
                                {selectedSt.allergies && selectedSt.allergies !== '없음' && selectedSt.allergies !== '-' ? (
                                  <span className="text-rose-600 font-black bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200">
                                    알레르기: {selectedSt.allergies}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">알레르기: 없음</span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="bg-white/90 p-2.5 rounded-xl border border-indigo-100 text-xs space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-indigo-600">등록된 탑승/하차 희망 위치</span>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {selectedSt.lat ? `좌표: ${Number(selectedSt.lat).toFixed(4)}, ${Number(selectedSt.lng).toFixed(4)}` : '좌표 미등록'}
                              </span>
                            </div>
                            <div className="font-bold text-slate-800 truncate" title={selectedSt.boardingLocation || selectedSt.address}>
                              {selectedSt.boardingLocation || selectedSt.address || '주소 미등록'}
                            </div>
                            {selectedSt.address && selectedSt.boardingLocation !== selectedSt.address && (
                              <div className="text-[11px] text-slate-500 truncate" title={selectedSt.address}>
                                도로명 주소: {selectedSt.address}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* 2. 배정 희망 차량 (호차) */}
                  <div className="space-y-1.5 border border-slate-200 rounded-2xl p-3.5 bg-slate-50/50">
                    <label className="text-xs font-black text-slate-800 flex items-center gap-1">
                      <span>배정 희망 차량 (호차)</span>
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={paymentForm.selectedVehicleId}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, selectedVehicleId: e.target.value }))}
                      className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="">-- 차량(호차)을 선택하세요 --</option>
                      {(paymentContext.vehicles || []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.busNumber} (담당 지도교사: {formatTeacherName(v.teacherName)} / 기사: {v.driverName})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 3. 탑승 희망 위치 등록 (핀으로 찍기 vs 주소로 등록하기) */}
                  <div className="space-y-2 border-2 border-indigo-100 rounded-2xl p-3.5 bg-indigo-50/20">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-black text-slate-800 flex items-center gap-1">
                        <span>탑승 희망 위치 등록 방식</span>
                        <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-indigo-200 text-xs font-bold shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setPaymentForm((prev) => ({ ...prev, locationSelectMode: 'MAP_PIN', locationType: 'PIN' }))}
                          className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                            paymentForm.locationSelectMode === 'MAP_PIN'
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                          </svg>
                          <span>1. 핀으로 찍기</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentForm((prev) => ({ ...prev, locationSelectMode: 'ADDRESS_SEARCH', locationType: 'ADDRESS' }))}
                          className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1 ${
                            paymentForm.locationSelectMode === 'ADDRESS_SEARCH'
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <span>2. 주소로 등록하기</span>
                        </button>
                      </div>
                    </div>

                    {paymentForm.locationSelectMode === 'MAP_PIN' ? (
                      /* Mode 1: 핀으로 찍기 (Interactive Leaflet Map) */
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                          <span className="font-bold">지도를 마우스로 클릭하여 탑승 희망 위치에 핀을 꽂으세요.</span>
                          <span>좌표: {paymentForm.latitude?.toFixed(4)}, {paymentForm.longitude?.toFixed(4)}</span>
                        </div>
                        <div className="w-full h-48 rounded-2xl overflow-hidden border border-slate-300 relative shadow-inner">
                          <MapContainer
                            center={[paymentForm.latitude || 37.842, paymentForm.longitude || 127.123]}
                            zoom={15}
                            style={{ height: '100%', width: '100%' }}
                          >
                            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                            <MapRecenter center={[paymentForm.latitude, paymentForm.longitude]} />
                            <MapClickMarker
                              position={[paymentForm.latitude, paymentForm.longitude]}
                              onMapClick={handleMapClickForPayment}
                              icon={bluePinIcon}
                            />
                          </MapContainer>
                        </div>
                        <input
                          type="text"
                          placeholder="탑승 위치명 입력 (예: 경동대 메트로폴 정문 앞)"
                          value={paymentForm.boardingLocation}
                          onChange={(e) => setPaymentForm((prev) => ({ ...prev, boardingLocation: e.target.value }))}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                        />
                        {paymentForm.address && (
                          <p className="text-[11px] text-slate-500 pl-1 font-medium">
                            변환 도로명 주소: {paymentForm.address}
                          </p>
                        )}
                      </div>
                    ) : (
                      /* Mode 2: 주소로 등록하기 (도로명 주소 검색 및 지오코딩) */
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="도로명 주소 입력 (예: 경기도 양주시 화합로...)"
                            value={paymentForm.address}
                            onChange={(e) => setPaymentForm((prev) => ({ ...prev, address: e.target.value }))}
                            className="flex-1 p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                          />
                          <button
                            type="button"
                            onClick={handleOpenPostcodeForPayment}
                            className="px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs shrink-0 flex items-center gap-1"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <span>우편번호 검색</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleSearchAddressForPayment}
                            className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shrink-0"
                          >
                            위치 찾기
                          </button>
                        </div>
                        <input
                          type="text"
                          placeholder="상세 탑승 위치명 (예: 현대아파트 101동 정문 앞)"
                          value={paymentForm.boardingLocation}
                          onChange={(e) => setPaymentForm((prev) => ({ ...prev, boardingLocation: e.target.value }))}
                          className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-semibold"
                        />
                        {paymentForm.latitude && paymentForm.longitude && (
                          <div className="w-full h-36 rounded-xl overflow-hidden border border-slate-300 relative shadow-inner">
                            <MapContainer
                              center={[paymentForm.latitude, paymentForm.longitude]}
                              zoom={15}
                              style={{ height: '100%', width: '100%' }}
                            >
                              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                              <MapRecenter center={[paymentForm.latitude, paymentForm.longitude]} />
                              <Marker position={[paymentForm.latitude, paymentForm.longitude]} icon={bluePinIcon}>
                                <Popup>{paymentForm.boardingLocation || paymentForm.address}</Popup>
                              </Marker>
                            </MapContainer>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 4. 탑승 희망 날짜 */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-800 flex items-center gap-1">
                      <span>탑승 희망 일자</span>
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="date"
                      value={paymentForm.requestDate}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, requestDate: e.target.value }))}
                      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>

                  {/* 5. 요청 메세지 */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-black text-slate-800">요청 메시지</label>
                    <textarea
                      rows={3}
                      value={paymentForm.note}
                      onChange={(e) => setPaymentForm((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder="지도교사에게 전달할 메시지를 입력하세요."
                      className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-medium leading-relaxed"
                    />
                  </div>
                </>
              )}

              {/* Modal Buttons */}
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 -mx-5 -mb-5 mt-4">
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingPayment || isLoadingPaymentContext}
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white text-xs font-black rounded-xl shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  {isSubmittingPayment ? '신청서 전송 중...' : '결재 신청서 보내기'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 지도교사 위치 수정 및 재결재 요청 모달 (Counter-Proposal) */}
      {/* ============================================================ */}
      {counterModalMsg && (
        <div className="fixed inset-0 z-[3100] bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-indigo-200 w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animate-scale-up">
            {/* Header */}
            <div className="p-4 border-b border-indigo-100 bg-gradient-to-r from-amber-500 to-indigo-600 text-white flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black flex items-center gap-2">
                  <span>탑승 위치 변경 및 재결재 요청</span>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full font-bold">지도교사 위치 역제안</span>
                </h3>
                <p className="text-[11px] text-amber-100 mt-0.5">
                  통학버스 운행/회차 여건에 맞추어 다른 위치를 핀으로 찍어 관리자님께 재결재를 요청합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCounterModalMsg(null)}
                className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* 원아 & 차량 정보 */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">탑승 원아</span>
                  <span className="font-extrabold text-slate-800 text-sm">{counterModalMsg.payload?.studentName}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 font-bold block">담당 차량</span>
                  <span className="font-extrabold text-indigo-700 text-sm">{counterModalMsg.payload?.busNumber}</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-red-500 font-bold block">관리자 원래 요청 위치</span>
                  <span className="font-bold text-slate-700 max-w-[140px] truncate block" title={counterModalMsg.payload?.boardingLocation}>
                    {counterModalMsg.payload?.boardingLocation}
                  </span>
                </div>
              </div>

              {/* Map with instructions */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <span>변경할 탑승지 위치를 지도에서 핀으로 찍으세요</span>
                    <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.2 rounded border border-emerald-200">
                      초록 핀 클릭
                    </span>
                  </label>
                  <span className="text-[11px] text-slate-400">지도를 클릭하면 핀이 이동합니다</span>
                </div>

                <div className="w-full h-56 rounded-2xl overflow-hidden border border-slate-300 relative shadow-inner">
                  <MapContainer
                    center={[counterLocation.lat || 37.842, counterLocation.lng || 127.123]}
                    zoom={15}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    <MapRecenter center={[counterLocation.lat, counterLocation.lng]} />
                    <MapClickMarker
                      position={[counterLocation.lat, counterLocation.lng]}
                      onMapClick={handleMapClickForCounter}
                      icon={greenPinIcon}
                    />
                    {counterModalMsg.payload?.latitude && counterModalMsg.payload?.longitude && (
                      <Marker
                        position={[Number(counterModalMsg.payload.latitude), Number(counterModalMsg.payload.longitude)]}
                        icon={redPinIcon}
                      >
                        <Popup>관리자 원래 요청 위치</Popup>
                      </Marker>
                    )}
                  </MapContainer>
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-[400]">
                    <span className="bg-red-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">
                      빨간 핀: 관리자 원래 위치
                    </span>
                    <span className="bg-emerald-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow">
                      초록 핀: 지도교사 제안 위치
                    </span>
                  </div>
                </div>
              </div>

              {/* Location title input */}
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-800">
                  새로 제안하는 탑승지 명칭
                </label>
                <input
                  type="text"
                  value={counterLocation.boardingLocation}
                  onChange={e => setCounterLocation(prev => ({ ...prev, boardingLocation: e.target.value }))}
                  placeholder="예: 현대아파트 대로변 버스정류장 앞"
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                {counterLocation.address && (
                  <p className="text-[11px] text-slate-500 pl-1">
                    도로명 주소: {counterLocation.address}
                  </p>
                )}
              </div>

              {/* Reason / Note */}
              <div className="space-y-1">
                <label className="text-xs font-black text-slate-800 flex items-center gap-1">
                  <span>재결재 요청 사유 (관리자님께 전달)</span>
                  <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={counterNote}
                  onChange={e => setCounterNote(e.target.value)}
                  placeholder="해당 위치로 탑승지를 변경해야 하는 사유를 입력하세요 (예: 골목길 진입 불가, 회차 공간 협소 등)"
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none font-medium leading-relaxed"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                disabled={isSubmittingCounter}
                onClick={() => setCounterModalMsg(null)}
                className="px-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                disabled={isSubmittingCounter || !counterLocation.lat || !counterLocation.boardingLocation.trim()}
                onClick={handleSubmitCounterProposal}
                className="px-5 py-2.5 bg-gradient-to-r from-amber-500 to-indigo-600 hover:opacity-95 active:scale-95 text-white text-xs font-black rounded-xl shadow-xs transition-all disabled:opacity-40 flex items-center gap-1.5"
              >
                {isSubmittingCounter ? '재결재 요청 전송 중...' : '관리자에게 재결재 요청 보내기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL: 참여자 목록 (Active Room Participants Popover) */}
      {/* ============================================================ */}
      {showParticipantsModal && activeRoom && (
        <div className="fixed inset-0 z-[3000] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm overflow-hidden flex flex-col max-h-[70vh] animate-scale-up">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h4 className="text-sm font-extrabold text-slate-800">
                대화 참여자 ({(activeRoom.members || []).length}명)
              </h4>
              <button
                type="button"
                onClick={() => setShowParticipantsModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 divide-y divide-slate-100 overflow-y-auto max-h-96">
              {(activeRoom.members || []).map((m) => {
                const u = m.user;
                if (!u) return null;
                const isMe = u.email === myUser.email;
                return (
                  <div key={m.id} className="py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold flex items-center justify-center text-xs flex-shrink-0">
                        {u.name?.[0] || '사'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-800 truncate">{u.name}</span>
                          {isMe && <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded font-bold">나</span>}
                        </div>
                        <span className="text-[10px] text-slate-400 block truncate">{u.email}</span>
                      </div>
                    </div>
                    {getRoleBadge(u.role)}
                  </div>
                );
              })}
            </div>
            <div className="p-3 border-t border-slate-100 bg-slate-50 text-right">
              <button
                type="button"
                onClick={() => setShowParticipantsModal(false)}
                className="px-4 py-1.5 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-lg hover:bg-slate-100"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: Saved Phrases & Presets Modal --- */}
      {showPhrasesModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 flex flex-col max-h-[85vh] animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-black text-slate-900 text-base flex items-center gap-2">
                <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
                자주 쓰는 알림 문구
              </h3>
              <button
                type="button"
                onClick={() => setShowPhrasesModal(false)}
                className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-xs"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase">클릭하여 메시지 입력창에 바로 넣기</span>
              {savedPhrases.map((phrase, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSelectPhrase(phrase)}
                  className="w-full text-left p-3 rounded-xl bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 text-xs font-semibold text-slate-800 transition"
                >
                  {phrase}
                </button>
              ))}
            </div>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <label className="text-xs font-bold text-slate-700">새로운 문구 직접 저장</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPhraseInput}
                  onChange={(e) => setNewPhraseInput(e.target.value)}
                  placeholder="자주 쓰는 알림 문구를 입력하세요..."
                  className="flex-1 text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white outline-none"
                />
                <button
                  type="button"
                  onClick={handleSavePhrase}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black shrink-0 transition"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
