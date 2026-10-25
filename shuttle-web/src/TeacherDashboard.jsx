import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { API_BASE_URL } from './config';

// Leaflet Bus & School Icons
const schoolIcon = L.divIcon({
  className: 'custom-school-icon',
  html: '<div style="background-color:#2563eb;color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,0.3);font-size:18px;">🏫</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

const busIcon = L.divIcon({
  className: 'custom-bus-icon',
  html: '<div style="background-color:#f59e0b;color:white;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 6px rgba(0,0,0,0.3);font-size:18px;">🚌</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

export default function TeacherDashboard({ 
  currentUser, 
  academy, 
  buses = [], 
  students = [], 
  onOpenBoard, 
  onOpenNewPost,
  onLogout,
  onRefreshData
}) {
  // Filter students belonging to this teacher's assigned class
  const teacherClass = currentUser.assignedClass || '햇살반';
  
  // Filter students
  const myStudents = useMemo(() => {
    return students.filter(st => {
      const cls = st.raw?.['반명'] || st.raw?.반명 || st.raw?.['반'] || st.raw?.반 || '';
      if (!cls && teacherClass === '햇살반') return true; // Default match if only one class
      return cls.trim() === teacherClass.trim();
    });
  }, [students, teacherClass]);

  // Search and status filter
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState('ALL'); // 'ALL' | 'SHUTTLE' | 'PICKUP' | 'ABSENT'

  // Memo Modal State
  const [selectedStudentForMemo, setSelectedStudentForMemo] = useState(null);
  const [memoInput, setMemoInput] = useState('');
  const [isSavingMemo, setIsSavingMemo] = useState(false);

  // Shuttle Map Modal State
  const [selectedBusForMap, setSelectedBusForMap] = useState(null);

  // Daily Schedule Preset (Kindergarten daily timeline)
  const defaultSchedule = [
    { time: '09:00 ~ 09:30', title: '등원 및 자유놀이', desc: '밝은 인사와 함께 원아 맞이 & 체온 체크', icon: '👋' },
    { time: '09:30 ~ 10:10', title: '오전 간식 & 아침 모임', desc: '제철 과일 간식 및 오늘 하루 일과 소개', icon: '🍎' },
    { time: '10:10 ~ 11:20', title: '🍂 가을 숲 오감 생태 체험', desc: '야외 숲 놀이터에서 단풍잎·솔방울 관찰 활동', icon: '🍁' },
    { time: '11:20 ~ 12:30', title: '맛있는 점심식사 & 양치 지도', desc: '골고루 식사 지도 및 올바른 양치 습관', icon: '🍱' },
    { time: '12:30 ~ 14:00', title: '낮잠 및 휴식 시간', desc: '편안한 클래식 음악과 함께 낮잠 & 정적 놀이', icon: '💤' },
    { time: '14:00 ~ 15:00', title: '오후 간식 & 신체 율동 놀이', desc: '우유 간식 및 신나는 동요 율동 시간', icon: '🎶' },
    { time: '15:00 ~ 16:00', title: '🚌 1차 셔틀 하원 인솔', desc: '가방 챙기기 및 1차 통학버스 안전 탑승', icon: '🚌' },
    { time: '16:30 ~ 17:30', title: '🚌 2차 셔틀 하원 & 통합 보육', desc: '2차 하원 차량 탑승 및 연장 보육반 인계', icon: '🏡' },
  ];
  const [scheduleItems] = useState(defaultSchedule);

  // Calculate current active schedule item based on current time
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
      const phone = st.raw?.['학부모전화번호'] || st.raw?.학부모전화번호 || st.raw?.['연락처'] || '';
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

  // Update Student Boarding Mode (Shuttle vs Direct Pickup vs Absent)
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

  // Today formatted string
  const todayStr = useMemo(() => {
    const now = new Date();
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 (${days[now.getDay()]})`;
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌱</span>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black text-slate-900 tracking-tight">
                  {academy?.name || '우리 유치원'}
                </h1>
                <span className="bg-emerald-100 text-emerald-800 text-xs font-extrabold px-2.5 py-0.5 rounded-full border border-emerald-200">
                  {teacherClass} 담임
                </span>
              </div>
              <p className="text-xs text-slate-500 font-medium">
                {currentUser?.name || '선생님'} · {todayStr}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={onOpenNewPost || onOpenBoard}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl transition-all shadow-md shadow-blue-500/20 active:scale-95"
            >
              <span>✏️</span>
              <span>새 활동 사진 등록</span>
            </button>
            <button
              onClick={onOpenBoard}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 text-xs sm:text-sm font-bold rounded-xl transition-all shadow-sm active:scale-95"
            >
              <span>📸</span>
              <span>우리 반 앨범</span>
            </button>

            <button
              onClick={onLogout}
              className="flex items-center gap-1 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs sm:text-sm font-semibold rounded-xl transition-all"
            >
              <span>🚪</span>
              <span className="hidden sm:inline">로그아웃</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Banner: Daily Attendance / Ride Status Summary */}
        <section className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-5 text-white shadow-lg shadow-blue-500/10">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">☀️</span>
                <h2 className="text-xl font-bold tracking-tight">
                  좋은 하루입니다, {currentUser?.name || '선생님'}!
                </h2>
              </div>
              <p className="text-blue-100 text-xs sm:text-sm">
                오늘 <strong>{teacherClass}</strong> 원아들의 수업 일정과 하원 셔틀 탑승 현황을 한눈에 관리하세요.
              </p>
            </div>

            {/* Quick Stat Badges */}
            <div className="grid grid-cols-4 gap-2 sm:gap-3">
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/15">
                <p className="text-[11px] text-blue-200 font-medium">우리 반 전체</p>
                <p className="text-lg sm:text-2xl font-black">{summary.total}명</p>
              </div>
              <div className="bg-white/15 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/20">
                <p className="text-[11px] text-blue-100 font-medium">🚌 셔틀 탑승</p>
                <p className="text-lg sm:text-2xl font-black text-amber-300">{summary.shuttle}명</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/15">
                <p className="text-[11px] text-blue-200 font-medium">🚗 직접 픽업</p>
                <p className="text-lg sm:text-2xl font-black text-emerald-300">{summary.pickup}명</p>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-xl p-2.5 sm:p-3 text-center border border-white/15">
                <p className="text-[11px] text-blue-200 font-medium">🏥 결석/병원</p>
                <p className="text-lg sm:text-2xl font-black text-rose-300">{summary.absent}명</p>
              </div>
            </div>
          </div>
        </section>

        {/* 2-Column Upper Grid: [Class Schedule & Timeline] + [Today's Shuttle Status] */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column (7 cols): 수업 일정 & 하루 일과 타임라인 */}
          <section className="lg:col-span-7 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">⏰</span>
                <h3 className="font-extrabold text-slate-900 text-base">오늘의 수업 & 하루 일과 스케줄</h3>
              </div>
              <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-1 rounded-lg">
                현재 시각: {currentHourMinute}
              </span>
            </div>

            <div className="space-y-3 overflow-y-auto max-h-[380px] pr-1">
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
                    <div className="text-2xl shrink-0 pt-0.5">{item.icon}</div>
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

          {/* Right Column (5 cols): 오늘 셔틀 현황 & 차량 위치 간이 확인 */}
          <section className="lg:col-span-5 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-lg">🚌</span>
                <h3 className="font-extrabold text-slate-900 text-base">오늘 우리 반 셔틀 현황</h3>
              </div>
              <span className="text-xs text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded-lg">
                실시간 연동
              </span>
            </div>

            {buses.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <span className="text-3xl block mb-2">🚐</span>
                <p className="text-xs">배정된 셔틀 차량이 없습니다.</p>
              </div>
            ) : (
              <div className="space-y-3 flex-1 overflow-y-auto max-h-[380px] pr-1">
                {buses.map(bus => {
                  // Count students from myClass riding this bus
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

                      {/* Live Location Button */}
                      <button
                        onClick={() => setSelectedBusForMap(bus)}
                        className="w-full py-2 bg-white hover:bg-slate-100 text-blue-700 border border-blue-200 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                      >
                        <span>📍</span>
                        <span>실시간 버스 위치 확인 (지도)</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Lower Section (Full Width): [우리 반 원아 명단 & 출결 / 알림장 관리] */}
        <section className="bg-white rounded-2xl p-5 sm:p-6 border border-slate-200 shadow-sm space-y-5">
          {/* Header & Controls */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl">👦👧</span>
                <h3 className="text-lg font-black text-slate-900 tracking-tight">
                  {teacherClass} 원아 명단 & 출결 / 알림장 관리
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                오늘의 하원 방법(셔틀 / 직접 픽업 / 결석)을 원클릭으로 변경하고 원아별 일일 알림장 메모를 남기세요.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {/* Search input */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="원아명 또는 연락처 검색"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-52"
                />
                <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
              </div>

              {/* Status Filter Toggle */}
              <div className="flex bg-slate-100 p-0.5 rounded-xl border border-slate-200 text-xs font-bold">
                <button
                  onClick={() => setFilterMode('ALL')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all ${
                    filterMode === 'ALL' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  전체 ({myStudents.length})
                </button>
                <button
                  onClick={() => setFilterMode('SHUTTLE')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all ${
                    filterMode === 'SHUTTLE' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  🚌 셔틀 ({summary.shuttle})
                </button>
                <button
                  onClick={() => setFilterMode('PICKUP')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all ${
                    filterMode === 'PICKUP' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  🚗 픽업 ({summary.pickup})
                </button>
                <button
                  onClick={() => setFilterMode('ABSENT')}
                  className={`px-2.5 py-1.5 rounded-lg transition-all ${
                    filterMode === 'ABSENT' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  🏥 결석 ({summary.absent})
                </button>
              </div>
            </div>
          </div>

          {/* Students Card Grid */}
          {displayedStudents.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <span className="text-4xl block mb-2">🧸</span>
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
                const parentPhone = student.raw?.['학부모전화번호'] || student.raw?.학부모전화번호 || student.raw?.['연락처'] || '';
                const age = student.raw?.['연령'] || student.raw?.연령 || '';
                const gender = student.raw?.['성별'] || student.raw?.성별 || '';

                return (
                  <div
                    key={student.id}
                    className={`rounded-2xl p-4 border transition-all flex flex-col justify-between ${
                      isAbsent
                        ? 'bg-slate-100/70 border-slate-300 opacity-75'
                        : isPickup
                        ? 'bg-amber-50/40 border-amber-200'
                        : 'bg-white border-slate-200 shadow-sm hover:border-blue-300'
                    }`}
                  >
                    <div>
                      {/* Top Row: Name, Age, Gender */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-sm ${
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

                        {/* Current Status Badge */}
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

                      {/* Shuttle & Contact Info */}
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
                              <span>📞</span>
                              <span>{parentPhone}</span>
                            </a>
                          ) : (
                            <span className="text-slate-400">미등록</span>
                          )}
                        </div>
                      </div>

                      {/* Sticky Note / Daily Memo Preview */}
                      {student.teacherMemo ? (
                        <div
                          onClick={() => handleOpenMemoModal(student)}
                          className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 mb-3 cursor-pointer hover:bg-amber-100/70 transition-colors"
                          title="클릭하여 알림장 메모 수정"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-bold text-amber-800 flex items-center gap-1">
                              <span>📝</span>
                              <span>알림장 메모</span>
                            </span>
                            <span className="text-[10px] text-amber-600">수정</span>
                          </div>
                          <p className="text-xs text-amber-950 font-medium line-clamp-2 leading-relaxed">
                            {student.teacherMemo}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {/* Bottom Actions: 3-way toggle + Memo button */}
                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      {/* Status Toggle Buttons */}
                      <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                        <button
                          type="button"
                          onClick={() => handleUpdateBoardStatus(student.id, 'WAITING')}
                          className={`py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${
                            isShuttle ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <span>🚌</span>
                          <span>셔틀</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleUpdateBoardStatus(student.id, 'SELF_PICKUP')}
                          className={`py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${
                            isPickup ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <span>🚗</span>
                          <span>픽업</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleUpdateBoardStatus(student.id, 'ABSENT')}
                          className={`py-1 rounded-lg transition-all flex items-center justify-center gap-1 ${
                            isAbsent ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <span>🏥</span>
                          <span>결석</span>
                        </button>
                      </div>

                      {/* Memo Button */}
                      <button
                        type="button"
                        onClick={() => handleOpenMemoModal(student)}
                        className="w-full py-1.5 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-center gap-1 transition-colors"
                      >
                        <span>📝</span>
                        <span>{student.teacherMemo ? '알림장 메모 수정' : '+ 알림장 메모 작성'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* --- MODAL 1: Student Memo / Daily Notice Modal --- */}
      {selectedStudentForMemo && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📝</span>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    {selectedStudentForMemo.name} 원아 알림장 & 일일 메모
                  </h3>
                  <p className="text-xs text-slate-500">
                    오늘의 건강 상태, 투약, 식사량, 부모님 전달사항을 기록하세요.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedStudentForMemo(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* Quick Preset Buttons */}
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1.5">자주 쓰는 빠른 문구 추가</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '💊 처방약 12:30 복용 완료',
                  '🍚 점심 식사 맛있게 완식함',
                  '💤 낮잠 편안하게 푹 잠',
                  '🩹 가벼운 긁힘(연고 도포)',
                  '🎉 오늘 친구들과 양보하며 활동 잘함'
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

            {/* Textarea */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">메모 내용</label>
              <textarea
                rows={4}
                value={memoInput}
                onChange={e => setMemoInput(e.target.value)}
                placeholder="예: 오늘 기분 좋게 등원하여 점심도 잘 먹었습니다. 점심 후 미열이 살짝 있어 지켜보았으나 오후 활동에는 활발히 참여했습니다."
                className="w-full text-sm p-3 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
              />
            </div>

            {/* Modal Actions */}
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

      {/* --- MODAL 2: Shuttle Live Location Map Modal --- */}
      {selectedBusForMap && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🚌</span>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    {selectedBusForMap.name} 실시간 운행 위치
                  </h3>
                  <p className="text-xs text-slate-500">
                    기사님: {selectedBusForMap.driverName || '미지정'} · 차량번호: {selectedBusForMap.licensePlate || '미등록'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedBusForMap(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* Map Container */}
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

                    {/* Academy Marker */}
                    <Marker position={[academyLat, academyLng]} icon={schoolIcon}>
                      <Popup>
                        <div className="font-bold text-xs">{academy?.name || '우리 유치원'}</div>
                      </Popup>
                    </Marker>

                    {/* Bus Marker */}
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
