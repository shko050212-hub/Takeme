import React, { useState, useMemo } from 'react';

export default function AuthViewer({
  isClosing,
  currentTab = 'STUDENT', // 'STUDENT' | 'STAFF' | 'TEACHER'
  setCurrentTab,
  students = [],
  buses = [],
  teachers = [],
  academy,
  handleApproveStudent,
  handleRevokeStudent,
  handleApproveStaff,
  handleRevokeStaff,
  handleRevokeTeacher,
  fetchTeachers,
  refreshAllData,
  handleGenerateAuthCode,
  isProcessing
}) {
  const [studentStatusFilter, setStudentStatusFilter] = useState('ALL'); // 'ALL', 'PENDING', 'APPROVED', 'UNREGISTERED'
  const [selectedClassFilter, setSelectedClassFilter] = useState('ALL');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Extract all unique class names from students
  const availableClasses = useMemo(() => {
    const set = new Set();
    students.forEach(st => {
      const cls = st.className || st.raw?.['반명'] || st.raw?.['반'] || st.raw?.['학급'];
      if (cls && typeof cls === 'string' && cls.trim()) {
        set.add(cls.trim());
      }
    });
    return Array.from(set).sort();
  }, [students]);

  // Student counts
  const studentCounts = useMemo(() => {
    const total = students.length;
    const pending = students.filter(s => s.approvalStatus === 'PENDING').length;
    const approved = students.filter(s => s.approvalStatus === 'APPROVED').length;
    const unregistered = students.filter(s => !s.approvalStatus || s.approvalStatus === 'UNREGISTERED').length;
    return { total, pending, approved, unregistered };
  }, [students]);

  // Filtered Students
  const filteredStudents = useMemo(() => {
    return students.filter(st => {
      // Status filter
      if (studentStatusFilter === 'PENDING' && st.approvalStatus !== 'PENDING') return false;
      if (studentStatusFilter === 'APPROVED' && st.approvalStatus !== 'APPROVED') return false;
      if (studentStatusFilter === 'UNREGISTERED' && (st.approvalStatus === 'PENDING' || st.approvalStatus === 'APPROVED')) return false;

      // Class filter
      if (selectedClassFilter !== 'ALL') {
        const cls = (st.className || st.raw?.['반명'] || st.raw?.['반'] || st.raw?.['학급'] || '').trim();
        if (cls !== selectedClassFilter) return false;
      }

      // Search keyword
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase().trim();
        const name = (st.name || '').toLowerCase();
        const address = (st.address || '').toLowerCase();
        const phone = (st.parentPhone || st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || '').toLowerCase();
        const bus = buses.find(b => b.id === st.assignedBusId);
        const busName = (bus?.name || '').toLowerCase();

        return name.includes(kw) || address.includes(kw) || phone.includes(kw) || busName.includes(kw);
      }

      return true;
    });
  }, [students, studentStatusFilter, selectedClassFilter, searchKeyword, buses]);

  // Filtered Buses for Staff tab
  const filteredBuses = useMemo(() => {
    if (!searchKeyword.trim()) return buses;
    const kw = searchKeyword.toLowerCase().trim();
    return buses.filter(b => {
      const name = (b.name || '').toLowerCase();
      const plate = (b.plateNumber || '').toLowerCase();
      const driver = (b.driverName || '').toLowerCase();
      const teacher = (b.teacherName || '').toLowerCase();
      return name.includes(kw) || plate.includes(kw) || driver.includes(kw) || teacher.includes(kw);
    });
  }, [buses, searchKeyword]);

  // Filtered Teachers
  const filteredTeachers = useMemo(() => {
    if (!searchKeyword.trim()) return teachers;
    const kw = searchKeyword.toLowerCase().trim();
    return teachers.filter(t => {
      const name = (t.name || '').toLowerCase();
      const email = (t.email || '').toLowerCase();
      const cls = (t.assignedClass || '').toLowerCase();
      const phone = (t.phone || '').toLowerCase();
      return name.includes(kw) || email.includes(kw) || cls.includes(kw) || phone.includes(kw);
    });
  }, [teachers, searchKeyword]);

  const handleRefreshClick = async () => {
    setIsRefreshing(true);
    try {
      if (typeof refreshAllData === 'function') await refreshAllData();
      if (typeof fetchTeachers === 'function') await fetchTeachers();
    } catch (e) {
      console.error(e);
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  return (
    <div className={`absolute inset-0 z-[2000] flex flex-col bg-slate-100 h-full overflow-hidden transition-all duration-300 ${isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
      
      {/* Top Bar Header */}
      <div className="bg-white px-8 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 shadow-xs shrink-0 z-10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              {currentTab === 'STUDENT' && <span>원생·학부모 키 인증 및 승인</span>}
              {currentTab === 'STAFF' && <span>차량 스태프 (기사·교사) 승인</span>}
              {currentTab === 'TEACHER' && <span>유치원 교사 가입 및 승인 현황</span>}
            </h1>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              원 인증: {academy?.authCode || '미발급'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {currentTab === 'STUDENT' && '앱에 원 인증코드를 입력하고 가입한 원아 및 학부모의 접근 권한을 승인하거나 해제합니다.'}
            {currentTab === 'STAFF' && '통학차량 기사님과 동승 지도교사의 계정 연동 및 운행 권한을 관리합니다.'}
            {currentTab === 'TEACHER' && '원 인증코드로 가입된 유치원 교사의 계정 연동 상태를 확인하고 관리합니다.'}
          </p>
        </div>

        {/* Tab Pills & Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Sub-tab Switcher Pills */}
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => setCurrentTab('STUDENT')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                currentTab === 'STUDENT'
                  ? 'bg-white text-blue-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>전체 원생</span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.2 rounded-full font-bold">
                {studentCounts.total}
              </span>
              {studentCounts.pending > 0 && (
                <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
              )}
            </button>

            <button
              onClick={() => setCurrentTab('STAFF')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                currentTab === 'STAFF'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>차량 스태프</span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.2 rounded-full font-bold">
                {buses.length}호차
              </span>
            </button>

            <button
              onClick={() => setCurrentTab('TEACHER')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                currentTab === 'TEACHER'
                  ? 'bg-white text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>유치원 교사</span>
              <span className="text-[10px] bg-slate-200 px-1.5 py-0.2 rounded-full font-bold">
                {teachers.length}명
              </span>
            </button>
          </div>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="이름, 연락처, 반 검색..."
              className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white w-48 transition-all"
            />
            <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchKeyword && (
              <button
                onClick={() => setSearchKeyword('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs font-bold"
              >
                ✕
              </button>
            )}
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefreshClick}
            disabled={isRefreshing}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl border border-slate-200 transition-colors shadow-xs"
            title="새로고침"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">

        {/* TAB 1: STUDENT VIEW */}
        {currentTab === 'STUDENT' && (
          <div className="space-y-6">
            {/* Top Summary Stats Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div 
                onClick={() => setStudentStatusFilter('ALL')}
                className={`p-4 bg-white rounded-2xl border transition-all cursor-pointer shadow-xs ${
                  studentStatusFilter === 'ALL' ? 'border-blue-500 ring-2 ring-blue-100 bg-blue-50/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold text-slate-500">전체 원아</div>
                <div className="text-2xl font-black text-slate-800 mt-1">{studentCounts.total}<span className="text-sm font-medium text-slate-500 ml-1">명</span></div>
              </div>

              <div 
                onClick={() => setStudentStatusFilter('PENDING')}
                className={`p-4 bg-white rounded-2xl border transition-all cursor-pointer shadow-xs ${
                  studentStatusFilter === 'PENDING' ? 'border-orange-500 ring-2 ring-orange-100 bg-orange-50/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold text-orange-600 flex items-center justify-between">
                  <span>승인 대기</span>
                  {studentCounts.pending > 0 && (
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
                  )}
                </div>
                <div className="text-2xl font-black text-orange-600 mt-1">{studentCounts.pending}<span className="text-sm font-medium text-orange-400 ml-1">명</span></div>
              </div>

              <div 
                onClick={() => setStudentStatusFilter('APPROVED')}
                className={`p-4 bg-white rounded-2xl border transition-all cursor-pointer shadow-xs ${
                  studentStatusFilter === 'APPROVED' ? 'border-green-500 ring-2 ring-green-100 bg-green-50/20' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold text-green-700">승인 완료</div>
                <div className="text-2xl font-black text-green-700 mt-1">{studentCounts.approved}<span className="text-sm font-medium text-green-500 ml-1">명</span></div>
              </div>

              <div 
                onClick={() => setStudentStatusFilter('UNREGISTERED')}
                className={`p-4 bg-white rounded-2xl border transition-all cursor-pointer shadow-xs ${
                  studentStatusFilter === 'UNREGISTERED' ? 'border-slate-400 ring-2 ring-slate-100 bg-slate-50/40' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="text-xs font-bold text-slate-500">미가입</div>
                <div className="text-2xl font-black text-slate-500 mt-1">{studentCounts.unregistered}<span className="text-sm font-medium text-slate-400 ml-1">명</span></div>
              </div>
            </div>

            {/* Filter Controls Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-slate-600">상태 필터:</span>
                <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                  <button
                    onClick={() => setStudentStatusFilter('ALL')}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                      studentStatusFilter === 'ALL' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    전체 ({studentCounts.total})
                  </button>
                  <button
                    onClick={() => setStudentStatusFilter('PENDING')}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                      studentStatusFilter === 'PENDING' ? 'bg-orange-500 text-white shadow-xs' : 'text-orange-700 hover:text-orange-900'
                    }`}
                  >
                    대기 ({studentCounts.pending})
                  </button>
                  <button
                    onClick={() => setStudentStatusFilter('APPROVED')}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                      studentStatusFilter === 'APPROVED' ? 'bg-green-600 text-white shadow-xs' : 'text-green-700 hover:text-green-900'
                    }`}
                  >
                    승인 ({studentCounts.approved})
                  </button>
                  <button
                    onClick={() => setStudentStatusFilter('UNREGISTERED')}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${
                      studentStatusFilter === 'UNREGISTERED' ? 'bg-slate-300 text-slate-800 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    미가입 ({studentCounts.unregistered})
                  </button>
                </div>
              </div>

              {/* Class Dropdown Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">반 선택:</span>
                <select
                  value={selectedClassFilter}
                  onChange={(e) => setSelectedClassFilter(e.target.value)}
                  className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="ALL">전체 학급</option>
                  {availableClasses.map(cls => (
                    <option key={cls} value={cls}>{cls}</option>
                  ))}
                </select>
                <span className="text-xs text-slate-400 font-medium">
                  검색 결과: <strong className="text-slate-700">{filteredStudents.length}</strong>명
                </span>
              </div>
            </div>

            {/* Students Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredStudents.map(st => {
                const assignedBus = buses.find(b => b.id === st.assignedBusId);
                const className = st.className || st.raw?.['반명'] || st.raw?.['반'] || st.raw?.['학급'];
                const parentPhone = st.parentPhone || st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['연락처'];
                const parentName = st.parentName || st.raw?.['보호자 성함'] || st.raw?.['보호자성함'] || st.raw?.['학부모성함'];

                return (
                  <div 
                    key={st.id} 
                    className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between gap-4"
                  >
                    <div>
                      {/* Card Header: Name, Class, Status Badge */}
                      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 font-black text-sm flex items-center justify-center shrink-0">
                            {st.name?.[0] || '원'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-base font-bold text-slate-900 truncate">{st.name}</span>
                              {className && (
                                <span className="text-[11px] bg-blue-50 text-blue-700 px-2.5 py-0.5 rounded-full border border-blue-200 font-bold whitespace-nowrap">
                                  {className}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-400 truncate mt-0.5">
                              {parentName ? `보호자: ${parentName}` : '원아 계정'}
                              {parentPhone && ` (${parentPhone})`}
                            </div>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="shrink-0">
                          {st.approvalStatus === 'APPROVED' ? (
                            <span className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full font-bold border border-green-200 flex items-center gap-1 shadow-2xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
                              승인완료
                            </span>
                          ) : st.approvalStatus === 'PENDING' ? (
                            <span className="text-xs bg-orange-100 text-orange-700 px-3 py-1 rounded-full font-bold border border-orange-200 flex items-center gap-1 shadow-2xs animate-pulse">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-600"></span>
                              승인대기
                            </span>
                          ) : (
                            <span className="text-xs bg-slate-100 text-slate-500 px-3 py-1 rounded-full font-medium border border-slate-200">
                              미가입
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Detail Info Body */}
                      <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400 w-16 shrink-0">배정 차량</span>
                          {assignedBus ? (
                            <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                              {assignedBus.name} ({assignedBus.plateNumber || '차량'})
                            </span>
                          ) : (
                            <span className="text-slate-400 font-medium">차량 미배정 (도보 등)</span>
                          )}
                        </div>

                        {st.address && (
                          <div className="flex items-start gap-1.5">
                            <span className="text-slate-400 w-16 shrink-0 mt-0.5">주소</span>
                            <span className="font-medium text-slate-700 truncate" title={st.address}>{st.address}</span>
                          </div>
                        )}

                        {st.boardingLocation && st.boardingLocation !== st.address && (
                          <div className="flex items-start gap-1.5">
                            <span className="text-slate-400 w-16 shrink-0 mt-0.5">등원탑승지</span>
                            <span className="font-medium text-slate-700 truncate" title={st.boardingLocation}>{st.boardingLocation}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action Buttons Footer */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                      {st.approvalStatus === 'PENDING' && (
                        <>
                          <button
                            onClick={() => handleRevokeStudent(st.id, true)}
                            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors"
                          >
                            가입 거절
                          </button>
                          <button
                            onClick={() => handleApproveStudent(st.id)}
                            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1"
                          >
                            <span>가입 승인</span>
                          </button>
                        </>
                      )}

                      {st.approvalStatus === 'APPROVED' && (
                        <button
                          onClick={() => handleRevokeStudent(st.id, false)}
                          className="px-3.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl transition-colors"
                        >
                          연동 해제
                        </button>
                      )}

                      {(!st.approvalStatus || st.approvalStatus === 'UNREGISTERED') && (
                        <span className="text-[11px] text-slate-400 italic">
                          학부모가 앱에서 원 코드로 가입하면 대기 상태가 됩니다.
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredStudents.length === 0 && (
              <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                
                <p className="font-bold text-slate-600">조건에 일치하는 원아가 없습니다.</p>
                <p className="text-xs text-slate-400 mt-1">필터나 검색어를 변경해보세요.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: STAFF (DRIVER & BUS TEACHER) VIEW */}
        {currentTab === 'STAFF' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">통학차량 스태프 가입 및 승인 현황</h3>
                <p className="text-xs text-slate-500 mt-0.5">각 호차별 기사님 및 동승 지도교사의 앱 연동 승인 상태를 관리합니다.</p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600">등록 차량:</span>
                <span className="font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{buses.length}대</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredBuses.map(bus => {
                const assignedCount = students.filter(s => s.assignedBusId === bus.id).length;

                return (
                  <div key={bus.id} className="p-6 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between gap-5">
                    <div>
                      {/* Bus Header */}
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs flex items-center justify-center">
                            차량
                          </div>
                          <div>
                            <div className="text-base font-bold text-slate-900">{bus.name}</div>
                            <div className="text-xs text-slate-400 font-mono">{bus.plateNumber || '차량번호 미입력'}</div>
                          </div>
                        </div>

                        <span className="text-xs font-bold text-blue-700 bg-blue-50 px-3 py-1 rounded-full border border-blue-200">
                          원생 {assignedCount}명 탑승
                        </span>
                      </div>

                      {/* Driver & Teacher Cards inside */}
                      <div className="mt-4 space-y-3">
                        {/* 1. Driver Card */}
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 font-black text-xs flex items-center justify-center shrink-0">
                              기사
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-800 text-sm whitespace-nowrap">
                                  {bus.driverName || '기사 미지정'}
                                </span>
                                {bus.driverApprovalStatus === 'APPROVED' ? (
                                  <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full font-bold border border-green-200 whitespace-nowrap">
                                    승인완료
                                  </span>
                                ) : bus.driverApprovalStatus === 'PENDING' ? (
                                  <span className="text-[11px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full font-bold border border-orange-200 animate-pulse whitespace-nowrap">
                                    승인대기
                                  </span>
                                ) : (
                                  <span className="text-[11px] bg-slate-200 text-slate-600 px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                                    미가입
                                  </span>
                                )}
                              </div>
                              {bus.driverPhone && (
                                <div className="text-xs text-slate-400 mt-0.5">{bus.driverPhone}</div>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {bus.driverApprovalStatus === 'PENDING' && (
                              <>
                                <button
                                  onClick={() => handleApproveStaff(bus.id, 'DRIVER')}
                                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
                                >
                                  승인
                                </button>
                                <button
                                  onClick={() => handleRevokeStaff(bus.id, 'DRIVER', true)}
                                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition"
                                >
                                  거절
                                </button>
                              </>
                            )}
                            {bus.driverApprovalStatus === 'APPROVED' && (
                              <button
                                onClick={() => handleRevokeStaff(bus.id, 'DRIVER', false)}
                                className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-lg transition"
                              >
                                연동 해제
                              </button>
                            )}
                          </div>
                        </div>

                        {/* 2. Escort Teacher Card */}
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 font-black text-xs flex items-center justify-center shrink-0">
                              동승
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-slate-800 text-sm whitespace-nowrap">
                                  {bus.teacherName || '지도교사 미지정'}
                                </span>
                                {bus.teacherApprovalStatus === 'APPROVED' ? (
                                  <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full font-bold border border-green-200 whitespace-nowrap">
                                    승인완료
                                  </span>
                                ) : bus.teacherApprovalStatus === 'PENDING' ? (
                                  <span className="text-[11px] bg-orange-100 text-orange-700 px-2.5 py-0.5 rounded-full font-bold border border-orange-200 animate-pulse whitespace-nowrap">
                                    승인대기
                                  </span>
                                ) : (
                                  <span className="text-[11px] bg-slate-200 text-slate-600 px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap">
                                    미가입
                                  </span>
                                )}
                              </div>
                              {bus.teacherPhone && (
                                <div className="text-xs text-slate-400 mt-0.5">{bus.teacherPhone}</div>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0 flex items-center gap-1.5">
                            {bus.teacherApprovalStatus === 'PENDING' && (
                              <>
                                <button
                                  onClick={() => handleApproveStaff(bus.id, 'TEACHER')}
                                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg shadow-xs transition"
                                >
                                  승인
                                </button>
                                <button
                                  onClick={() => handleRevokeStaff(bus.id, 'TEACHER', true)}
                                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded-lg transition"
                                >
                                  거절
                                </button>
                              </>
                            )}
                            {bus.teacherApprovalStatus === 'APPROVED' && (
                              <button
                                onClick={() => handleRevokeStaff(bus.id, 'TEACHER', false)}
                                className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-lg transition"
                              >
                                연동 해제
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 bg-slate-50/50 p-2.5 rounded-xl border border-dashed border-slate-200">
                      기사님/교사가 앱에서 회원가입 시 '운전기사' 또는 '차량 지도교사'를 선택하고 해당 차량을 지정하면 승인 대기 목록에 표시됩니다.
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredBuses.length === 0 && (
              <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                
                <p className="font-bold text-slate-600">등록된 통학차량이 없습니다.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: TEACHER VIEW */}
        {currentTab === 'TEACHER' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-slate-800 text-sm">유치원 담당 교사 가입 및 승인 현황 ({teachers.length}명)</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  교사 계정의 연동 상태를 확인합니다. 담임 배정 및 분반은 [반 관리] 메뉴에서 진행할 수 있습니다.
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200">
                  담임 배정: {teachers.filter(t => t.assignedClass).length}명
                </span>
                <span className="font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg border border-slate-200">
                  반 미배정: {teachers.filter(t => !t.assignedClass).length}명
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredTeachers.map(teacher => {
                const currentClass = teacher.assignedClass;

                return (
                  <div key={teacher.id} className="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all flex flex-col justify-between gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-base shrink-0 shadow-xs">
                          {teacher.name?.[0] || '교'}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-slate-900 text-base whitespace-nowrap">{teacher.name} 선생님</span>
                            <span className="text-[11px] bg-green-100 text-green-700 px-2.5 py-0.5 rounded-full font-bold border border-green-200 whitespace-nowrap">
                              가입 승인됨
                            </span>
                          </div>
                          <div className="text-xs text-slate-500 mt-1 truncate" title={teacher.email}>
                            <span>{teacher.email}</span>
                            {teacher.phone && <span className="text-slate-400"> • {teacher.phone}</span>}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        {currentClass && currentClass !== '미배정' ? (
                          <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg font-bold border border-blue-100">
                            {currentClass} 담임교사
                          </span>
                        ) : (
                          <span className="text-xs bg-slate-100 text-slate-500 px-2.5 py-1 rounded-lg font-medium border border-slate-200">
                            반 미배정
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => handleRevokeTeacher(teacher.id)}
                        className="px-3.5 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl transition shadow-xs"
                      >
                        연동 해제
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredTeachers.length === 0 && (
              <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-slate-200 text-slate-400">
                
                <p className="font-bold text-slate-600">등록된 유치원 교사가 없습니다.</p>
                <p className="text-xs text-slate-400 mt-1">교사가 회원가입 시 '유치원 교사'를 선택하고 원 코드로 가입하면 여기에 표시됩니다.</p>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
