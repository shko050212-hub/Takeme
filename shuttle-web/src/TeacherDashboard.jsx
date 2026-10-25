import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import BoardViewer from './board/BoardViewer';
import { API_BASE_URL } from './config';

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
  onLogout,
  onRefreshData,
  boardPosts = [],
  setBoardPosts,
}) {
  // Navigation State on Left Rail: 'home' | 'board' | 'cloud'
  const [activeNavTab, setActiveNavTab] = useState('home');

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
    if (window.confirm('이 사진을 임시 클라우드에서 삭제하시겠습니까?')) {
      setCloudPhotos(prev => prev.filter(p => p.id !== photoId));
    }
  };

  const handleClearAllCloudPhotos = () => {
    if (cloudPhotos.length === 0) return;
    if (window.confirm('임시 클라우드에 보관된 모든 사진을 삭제하시겠습니까?')) {
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
          alert('아직 담당 반이 배정되지 않았습니다. 원장선생님께 문의해주세요.');
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
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  // Shuttle Map Modal State
  const [selectedBusForMap, setSelectedBusForMap] = useState(null);

  // Board Specific State
  const [boardSelectedClass, setBoardSelectedClass] = useState(teacherClass || 'ALL');
  const [boardSearchKeyword, setBoardSearchKeyword] = useState('');
  const [isCreatingBoardPost, setIsCreatingBoardPost] = useState(false);

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

  // Class Notice State (반 전체 알림장)
  const [isClassNoticeModalOpen, setIsClassNoticeModalOpen] = useState(false);
  const [classNoticeTitle, setClassNoticeTitle] = useState('');
  const [classNoticeContent, setClassNoticeContent] = useState('');
  const [isSendingClassNotice, setIsSendingClassNotice] = useState(false);
  const classNoticeStorageKey = `takeme_class_notice_${teacherClass || 'default'}`;
  const [latestClassNotice, setLatestClassNotice] = useState(() => {
    try {
      const saved = localStorage.getItem(classNoticeStorageKey);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    return null;
  });

  const handleSendClassNotice = async () => {
    if (!classNoticeContent.trim()) {
      alert('알림장 내용을 입력해주세요.');
      return;
    }
    if (myStudents.length === 0) {
      alert('반에 소속된 원아가 없습니다.');
      return;
    }

    setIsSendingClassNotice(true);
    const fullNoticeText = classNoticeTitle.trim() 
      ? `[${classNoticeTitle.trim()}] ${classNoticeContent.trim()}`
      : classNoticeContent.trim();

    try {
      // 1. Batch update notes for all students in my class
      await Promise.all(
        myStudents.map(st =>
          fetch(`${API_BASE_URL}/routing/student/${st.id}/note`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memo: `[반 전체 알림장] ${fullNoticeText}` })
          }).catch(err => console.warn(`Failed note update for student ${st.id}`, err))
        )
      );

      // 2. Broadcast message to parents
      try {
        await fetch(`${API_BASE_URL}/routing/admin/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetRoles: ['PARENT'],
            vehicleId: null,
            studentIds: myStudents.map(s => s.id),
            message: `[${teacherClass} 반 전체 알림장] ${fullNoticeText}`
          })
        });
      } catch (msgErr) {
        console.warn('Failed admin message broadcast', msgErr);
      }

      // 3. Save latest notice for display banner
      const noticeRecord = {
        title: classNoticeTitle.trim() || '우리 반 공지',
        content: classNoticeContent.trim(),
        sentAt: new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        recipientCount: myStudents.length
      };
      setLatestClassNotice(noticeRecord);
      localStorage.setItem(classNoticeStorageKey, JSON.stringify(noticeRecord));

      alert(`${teacherClass} 학부모 전체(${myStudents.length}명)에게 알림장이 발송되었습니다.`);
      setClassNoticeTitle('');
      setClassNoticeContent('');
      setIsClassNoticeModalOpen(false);

      if (onRefreshData) onRefreshData();
    } catch (e) {
      console.error(e);
      alert('알림장 발송 중 오류가 발생했습니다.');
    } finally {
      setIsSendingClassNotice(false);
    }
  };

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
      const status = st.boardStatus || 'WAITING';
      if (status === 'SELF_PICKUP' || status === '부모님직접픽업') {
        pickupCount++;
      } else if (status === 'ABSENT' || status === '결석') {
        absentCount++;
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
  }, [myStudents]);

  // Filtered Students
  const displayedStudents = useMemo(() => {
    return myStudents.filter(st => {
      const name = st.name || '';
      const phone = st.raw?.['학부모전화번호'] || st.raw?.['연락처'] || '';
      const matchesSearch = name.toLowerCase().includes(searchQuery.toLowerCase()) || phone.includes(searchQuery);

      if (!matchesSearch) return false;

      const status = st.boardStatus || 'WAITING';
      if (filterMode === 'SHUTTLE') {
        return status !== 'SELF_PICKUP' && status !== '부모님직접픽업' && status !== 'ABSENT' && status !== '결석';
      }
      if (filterMode === 'PICKUP') {
        return status === 'SELF_PICKUP' || status === '부모님직접픽업';
      }
      if (filterMode === 'ABSENT') {
        return status === 'ABSENT' || status === '결석';
      }
      return true;
    });
  }, [myStudents, searchQuery, filterMode]);

  // Update Student Boarding Mode
  const handleUpdateBoardStatus = async (studentId, newStatus) => {
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
          className={`p-4 rounded-2xl transition-all ${
            activeNavTab === 'home'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
          }`}
          title="우리 반 교실 홈"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        </button>

        {/* Tab 2: 유치원 게시판 */}
        <button
          onClick={() => setActiveNavTab('board')}
          className={`p-4 rounded-2xl transition-all ${
            activeNavTab === 'board'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
          }`}
          title="원아 앨범 & 게시판"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        {/* Tab 3: 임시 사진 클라우드 */}
        <button
          onClick={() => setActiveNavTab('cloud')}
          className={`p-4 rounded-2xl transition-all ${
            activeNavTab === 'cloud'
              ? 'bg-white text-blue-700 shadow-lg scale-110'
              : 'text-blue-200 hover:bg-blue-600'
          }`}
          title="임시 사진 클라우드"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
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
        {/* VIEW A: Board Mode (Only assigned class, no side buttons) */}
        {activeNavTab === 'board' ? (
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
            />
          </div>
        ) : activeNavTab === 'cloud' ? (
          /* VIEW C: Temporary Photo Cloud Mode */
          <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Cloud Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-black text-slate-800 tracking-tight">임시 사진 클라우드</h1>
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
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
                  isDraggingOverCloud
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
                    위 영역을 클릭하거나 사진 파일을 끌어다 놓아 임시 클라우드에 사진을 저장해보세요.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* VIEW B: Classroom Home Mode */
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Condition: Unassigned Teacher Screen (아무 화면 없게 나오고 원장이 배정하는 시스템) */}
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
                      담당 반 배정 대기 중입니다
                    </h2>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      <strong>{localTeacherUser?.name || '선생님'}</strong>님, 환영합니다.<br/>
                      현재 <strong>{academy?.name || '소속 유치원'}</strong>에 정상 등록되었으며,
                      <strong>원장선생님께서 담당 반을 배정</strong>하시면 교실 수업 일정 및 원아 명단이 자동으로 활성화됩니다.
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
                        {todayStr} · <strong>{localTeacherUser?.name || '선생님'}</strong>님, 오늘 하루도 안전하고 행복한 보육 되세요!
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
                            className={`flex items-start gap-3 p-3 rounded-xl transition-all border ${
                              isCurrent
                                ? 'bg-blue-50/80 border-blue-300 shadow-sm'
                                : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-50'
                            }`}
                          >
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                              isCurrent ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-200 text-slate-600'
                            }`}>
                              {idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className={`text-sm font-bold ${isCurrent ? 'text-blue-900' : 'text-slate-800'}`}>
                                  {item.title}
                                </h4>
                                <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md font-semibold shrink-0 ${
                                  isCurrent ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'
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
                        {teacherClass} 원아 명단 & 출결 / 알림장 관리
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        원아별 일일 알림장 메모를 남기고, 오늘 하원 방법(셔틀 / 직접 픽업 / 결석)을 원클릭으로 변경하세요.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsClassNoticeModalOpen(true)}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-all shadow-sm shadow-blue-500/20 flex items-center justify-center gap-1.5 shrink-0"
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
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${
                            filterMode === 'ALL' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          전체 ({myStudents.length})
                        </button>
                        <button
                          onClick={() => setFilterMode('SHUTTLE')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${
                            filterMode === 'SHUTTLE' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          셔틀 ({summary.shuttle})
                        </button>
                        <button
                          onClick={() => setFilterMode('PICKUP')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${
                            filterMode === 'PICKUP' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          픽업 ({summary.pickup})
                        </button>
                        <button
                          onClick={() => setFilterMode('ABSENT')}
                          className={`px-2.5 py-1.5 rounded-lg transition-all ${
                            filterMode === 'ABSENT' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          결석 ({summary.absent})
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Class-wide Notice Banner (if any sent) */}
                  {latestClassNotice && (
                    <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-extrabold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-md">
                              우리 반 전체 알림장
                            </span>
                            <span className="text-xs text-slate-400 font-medium">{latestClassNotice.sentAt}</span>
                            <span className="text-xs text-slate-500 font-semibold">({latestClassNotice.recipientCount}명 학부모 발송 완료)</span>
                          </div>
                          <h4 className="text-sm font-bold text-slate-900 mt-1">{latestClassNotice.title}</h4>
                          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{latestClassNotice.content}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setClassNoticeTitle(latestClassNotice.title || '');
                          setClassNoticeContent(latestClassNotice.content || '');
                          setIsClassNoticeModalOpen(true);
                        }}
                        className="self-end sm:self-center px-3 py-1.5 bg-white hover:bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold rounded-xl transition-colors shrink-0 shadow-2xs"
                      >
                        내용 수정 후 재발송
                      </button>
                    </div>
                  )}

                  {displayedStudents.length === 0 ? (
                    <div className="text-center py-12 text-slate-400">
                      <p className="text-sm font-semibold">해당하는 원아가 없습니다.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {displayedStudents.map(student => {
                        const status = student.boardStatus || 'WAITING';
                        const isPickup = status === 'SELF_PICKUP' || status === '부모님직접픽업';
                        const isAbsent = status === 'ABSENT' || status === '결석';
                        const isShuttle = !isPickup && !isAbsent;

                        const bus = buses.find(b => b.id === student.assignedBusId);
                        const parentPhone = student.raw?.['학부모전화번호'] || student.raw?.['연락처'] || '';
                        const age = student.raw?.['연령'] || '';
                        const gender = student.raw?.['성별'] || '';

                        return (
                          <div
                            key={student.id}
                            className={`rounded-2xl p-4 border transition-all flex flex-col justify-between ${
                              isAbsent
                                ? 'bg-slate-100/70 border-slate-300 opacity-75'
                                : isPickup
                                ? 'bg-amber-50/40 border-amber-200'
                                : 'bg-white border-slate-200 shadow-xs hover:border-blue-300'
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2.5">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-xs ${
                                    isAbsent
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
                                        <span className={`text-[11px] font-bold px-1.5 py-0.2 rounded ${
                                          gender === '남' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
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

                                <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full shrink-0 border ${
                                  isAbsent
                                    ? 'bg-rose-100 text-rose-700 border-rose-200'
                                    : isPickup
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                    : 'bg-blue-100 text-blue-800 border-blue-200'
                                }`}>
                                  {isAbsent ? '결석' : isPickup ? '직접 픽업' : '셔틀 하원'}
                                </span>
                              </div>

                              <div className="bg-slate-50 rounded-xl p-2.5 my-2.5 text-xs space-y-1.5 border border-slate-100">
                                <div className="flex items-center justify-between">
                                  <span className="text-slate-400">하원 차량:</span>
                                  <span className="font-bold text-slate-700">
                                    {bus ? `${bus.name} (${bus.licensePlate || '1차'})` : '배정 대기'}
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
                                  onClick={() => handleUpdateBoardStatus(student.id, 'WAITING')}
                                  className={`py-1 rounded-lg transition-all flex items-center justify-center ${
                                    isShuttle ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  셔틀
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleUpdateBoardStatus(student.id, 'SELF_PICKUP')}
                                  className={`py-1 rounded-lg transition-all flex items-center justify-center ${
                                    isPickup ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                                  }`}
                                >
                                  픽업
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleUpdateBoardStatus(student.id, 'ABSENT')}
                                  className={`py-1 rounded-lg transition-all flex items-center justify-center ${
                                    isAbsent ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-500 hover:text-slate-800'
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

      {/* --- MODAL 3: Class-wide Notice Modal (우리 반 전체 알림장) --- */}
      {isClassNoticeModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[11px] font-extrabold rounded-md">
                    우리 반 전체 발송
                  </span>
                  <h3 className="font-black text-slate-900 text-base">
                    {teacherClass} 전체 알림장 작성
                  </h3>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  작성하신 알림장은 <strong>{teacherClass} 소속 모든 원아({myStudents.length}명)의 학부모님</strong> 앱으로 일괄 발송됩니다.
                </p>
              </div>
              <button
                onClick={() => setIsClassNoticeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">알림장 제목</label>
              <input
                type="text"
                value={classNoticeTitle}
                onChange={e => setClassNoticeTitle(e.target.value)}
                placeholder="예: [내일 야외 활동 준비물 안내] 편한 복장 및 물통 지참"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
              />
            </div>

            <div>
              <p className="text-xs font-bold text-slate-600 mb-1.5">자주 쓰는 전체 공지 문구</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '내일은 숲 체험 활동이 예정되어 있으니 편한 운동화와 모자를 착용해 주세요.',
                  '가정통신문 및 동의서가 배부되었으니 확인 후 회신 부탁드립니다.',
                  '기온 변화가 심하니 얇은 겉옷을 가방에 챙겨 보내주시기 바랍니다.',
                  '원아들의 개인 물품 및 식기류에 이름을 꼭 기재해 주시기 바랍니다.'
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setClassNoticeContent(prev => (prev ? `${prev}\n${preset}` : preset));
                    }}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg font-medium transition-colors text-left"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">알림장 본문</label>
              <textarea
                rows={5}
                value={classNoticeContent}
                onChange={e => setClassNoticeContent(e.target.value)}
                placeholder="학부모님들께 전달할 알림장 내용을 입력하세요."
                className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
              />
            </div>

            <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs text-blue-900 leading-relaxed">
              수신 대상: <strong>{teacherClass} 원아 {myStudents.length}명 전체 학부모</strong>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsClassNoticeModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSendClassNotice}
                disabled={isSendingClassNotice}
                className="px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md shadow-blue-500/20 disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSendingClassNotice ? '전체 발송 중...' : '반 전체 발송하기'}
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
    </div>
  );
}
