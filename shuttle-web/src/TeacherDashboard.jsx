import React, { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import BoardViewer from './board/BoardViewer';
import BoardSidebar from './board/BoardSidebar';
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
  // Navigation State on Left Rail: 'home' | 'board'
  const [activeNavTab, setActiveNavTab] = useState('home');

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
  const scheduleItems = [
    { time: '09:00 ~ 09:30', title: '등원 및 자유놀이', desc: '밝은 인사와 함께 원아 맞이 및 체온 점검' },
    { time: '09:30 ~ 10:10', title: '오전 간식 & 아침 모임', desc: '제철 과일 간식 및 일과 소개' },
    { time: '10:10 ~ 11:20', title: '가을 숲 생태 탐색 활동', desc: '야외 놀이터 자연물 관찰 활동' },
    { time: '11:20 ~ 12:30', title: '점심 식사 및 양치 지도', desc: '식사 지도 및 올바른 양치 습관 형성' },
    { time: '12:30 ~ 14:00', title: '낮잠 및 휴식 시간', desc: '정적인 실내 휴식 및 낮잠' },
    { time: '14:00 ~ 15:00', title: '오후 간식 및 신체 율동 놀이', desc: '간식 섭취 및 신체 율동 시간' },
    { time: '15:00 ~ 16:00', title: '1차 셔틀 하원 인솔', desc: '개인 물품 정리 및 1차 통학 차량 탑승' },
    { time: '16:30 ~ 17:30', title: '2차 셔틀 하원 및 통합 보육', desc: '2차 하원 차량 탑승 및 연장 보육반 인계' },
  ];

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

        {/* Tab 3: 새 사진 등록 바로가기 */}
        <button
          onClick={() => {
            setIsCreatingBoardPost(true);
            setActiveNavTab('board');
          }}
          className="p-4 rounded-2xl text-blue-200 hover:bg-blue-600 transition-all"
          title="새 활동 사진 등록"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
        {/* VIEW A: Board Mode */}
        {activeNavTab === 'board' ? (
          <div className="flex h-full w-full overflow-hidden">
            <BoardSidebar
              selectedClass={boardSelectedClass}
              setSelectedClass={setBoardSelectedClass}
              availableClasses={availableClasses}
              searchKeyword={boardSearchKeyword}
              setSearchKeyword={setBoardSearchKeyword}
              onOpenNewPost={() => setIsCreatingBoardPost(true)}
              posts={boardPosts}
            />
            <div className="flex-1 relative z-0 overflow-hidden">
              <BoardViewer
                isClosing={false}
                currentUser={localTeacherUser}
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
                      <h3 className="font-extrabold text-slate-900 text-base">오늘의 수업 및 일과 일정</h3>
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
                                  title="클릭하여 알림장 메모 수정"
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-[11px] font-bold text-amber-800">
                                      알림장 메모
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
                                {student.teacherMemo ? '알림장 메모 수정' : '+ 알림장 메모 작성'}
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

      {/* --- MODAL 1: Student Memo Modal --- */}
      {selectedStudentForMemo && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-scale-up">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-black text-slate-900 text-base">
                  {selectedStudentForMemo.name} 원아 알림장 & 일일 메모
                </h3>
                <p className="text-xs text-slate-500">
                  건강 상태, 투약, 식사량, 부모님 전달사항을 기록하세요.
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
              <label className="block text-xs font-bold text-slate-700 mb-1">메모 내용</label>
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
                {isSavingMemo ? '저장 중...' : '알림장 저장 완료'}
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
    </div>
  );
}
