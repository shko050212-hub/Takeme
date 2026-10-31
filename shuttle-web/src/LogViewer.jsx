import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { API_BASE_URL } from './config';

const getDaysInMonth = (year, month) => {
  return new Date(year, month + 1, 0).getDate();
};

const getFirstDayOfMonth = (year, month) => {
  return new Date(year, month, 1).getDay();
};

const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

const toDateStr = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val.split('T')[0];
  if (val instanceof Date) {
    return `${val.getFullYear()}-${String(val.getMonth() + 1).padStart(2, '0')}-${String(val.getDate()).padStart(2, '0')}`;
  }
  return String(val);
};

const renderLogIcon = (type) => {
  switch (type) {
    case 'OPERATION_START':
      return (
        <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'OPERATION_END':
      return (
        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
        </svg>
      );
    case 'BOARDING':
      return (
        <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'PARENT_MESSAGE':
      return (
        <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      );
    default:
      return (
        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
  }
};

export default function LogViewer({ buses, students, currentTab = 'LOG', isClosing }) {
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedBusId, setSelectedBusId] = useState(buses?.length > 0 ? buses[0].id : null);

  useEffect(() => {
    if ((!selectedBusId || !buses?.some(b => b.id === selectedBusId)) && buses?.length > 0) {
      setSelectedBusId(buses[0].id);
    }
  }, [buses, selectedBusId]);
  
  // LOG state
  const [logs, setLogs] = useState([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  
  // ABSENCE state
  const [absences, setAbsences] = useState([]);
  const [selectedStudentForAbsence, setSelectedStudentForAbsence] = useState(null);
  const [absenceRange, setAbsenceRange] = useState({ start: null, end: null });
  
  // HOLIDAY state
  const [holidays, setHolidays] = useState([]);
  const [holidayRange, setHolidayRange] = useState({ start: null, end: null });
  const [showHolidayConfirm, setShowHolidayConfirm] = useState(false);
  const [holidayReason, setHolidayReason] = useState('유치원 정기 휴업');
  const [holidayToDelete, setHolidayToDelete] = useState(null);
  const [isSavingHoliday, setIsSavingHoliday] = useState(false);
  const [isDeletingHoliday, setIsDeletingHoliday] = useState(false);
  
  const calendarRef = useRef(null);
  
  // Year & Month setup: calendarYear based (1월 ~ 12월)
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const [calendarYear, setCalendarYear] = useState(currentYear);

  // Generate 12 months (1월 ~ 12월) for selected calendarYear
  const monthsData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => ({
      year: calendarYear,
      month: i
    }));
  }, [calendarYear]);

  // Year options: currentYear - 5 to currentYear + 5
  const yearOptions = useMemo(() => {
    return Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);
  }, [currentYear]);

  useLayoutEffect(() => {
    if (calendarRef.current) {
      if (calendarYear === currentYear) {
        const currentMonthElement = calendarRef.current.querySelector('[data-is-current="true"]');
        if (currentMonthElement) {
          calendarRef.current.scrollTop = currentMonthElement.offsetTop - calendarRef.current.offsetTop - 20;
        }
      } else {
        calendarRef.current.scrollTop = 0;
      }
    }
  }, [currentTab, calendarYear]);

  const fetchAbsences = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/routing/absences${selectedBusId ? `?vehicleId=${selectedBusId}` : ''}`);
      const data = await res.json();
      setAbsences(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchHolidays = async () => {
    try {
      const activeAcademyId = localStorage.getItem('takeme_selected_academy_id') || (() => {
        try { return JSON.parse(localStorage.getItem('takeme_user') || '{}').academyId; } catch(e){ return ''; }
      })();
      const res = await fetch(`${API_BASE_URL}/routing/holidays${activeAcademyId ? `?academyId=${activeAcademyId}` : ''}`);
      const data = await res.json();
      setHolidays(data || []);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (currentTab === 'LOG' && selectedBusId) {
      const fetchLogs = async () => {
        setIsLoadingLogs(true);
        try {
          const year = selectedDate.getFullYear();
          const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
          const day = String(selectedDate.getDate()).padStart(2, '0');
          const dateStr = `${year}-${month}-${day}`;
          
          const res = await fetch(`${API_BASE_URL}/routing/daily-logs?date=${dateStr}&vehicleId=${selectedBusId}`);
          const data = await res.json();
          setLogs(Array.isArray(data) ? data : []);
        } catch (e) {
          console.error(e);
        } finally {
          setIsLoadingLogs(false);
        }
      };
      fetchLogs();
    } else if (currentTab === 'ABSENCE') {
      fetchAbsences();
    } else if (currentTab === 'HOLIDAY') {
      fetchHolidays();
    }
  }, [currentTab, selectedDate, selectedBusId]);

  const handleDateClick = (year, month, day) => {
    const clickedDate = new Date(year, month, day);
    
    if (currentTab === 'LOG') {
      setSelectedDate(clickedDate);
    } else if (currentTab === 'ABSENCE' && selectedStudentForAbsence) {
      handleRangeSelection(clickedDate, absenceRange, setAbsenceRange);
    } else if (currentTab === 'HOLIDAY') {
      handleRangeSelection(clickedDate, holidayRange, setHolidayRange);
    }
  };

  const handleRangeSelection = (clickedDate, currentRange, setRange) => {
    if (!currentRange.start || (currentRange.start && currentRange.end)) {
      setRange({ start: clickedDate, end: null });
    } else {
      if (clickedDate < currentRange.start) {
        setRange({ start: clickedDate, end: currentRange.start });
      } else {
        setRange({ start: currentRange.start, end: clickedDate });
      }
    }
  };

  const isSameDate = (d1, d2) => {
    if (!d1 || !d2) return false;
    return d1.getFullYear() === d2.getFullYear() && 
           d1.getMonth() === d2.getMonth() && 
           d1.getDate() === d2.getDate();
  };

  const isDateInRange = (date, start, end) => {
    if (!start) return false;
    if (!end) return isSameDate(date, start);
    
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
    return d >= s && d <= e;
  };

  const saveAbsence = async () => {
    if (!selectedStudentForAbsence || !absenceRange.start) return;
    
    const startStr = `${absenceRange.start.getFullYear()}-${String(absenceRange.start.getMonth() + 1).padStart(2, '0')}-${String(absenceRange.start.getDate()).padStart(2, '0')}`;
    const endStr = absenceRange.end 
      ? `${absenceRange.end.getFullYear()}-${String(absenceRange.end.getMonth() + 1).padStart(2, '0')}-${String(absenceRange.end.getDate()).padStart(2, '0')}`
      : startStr;
      
    try {
      await fetch(`${API_BASE_URL}/routing/absence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId: selectedStudentForAbsence.id,
          startDate: startStr,
          endDate: endStr
        })
      });
      setAbsenceRange({ start: null, end: null });
      fetchAbsences();
    } catch (e) {
      console.error(e);
    }
  };

  const deleteAbsence = async (id) => {
    try {
      await fetch(`${API_BASE_URL}/routing/absence/${id}`, { method: 'DELETE' });
      fetchAbsences();
    } catch (e) {
      console.error(e);
    }
  };

  const saveHoliday = async () => {
    if (!holidayRange.start) return;
    
    const startStr = `${holidayRange.start.getFullYear()}-${String(holidayRange.start.getMonth() + 1).padStart(2, '0')}-${String(holidayRange.start.getDate()).padStart(2, '0')}`;
    const endStr = holidayRange.end 
      ? `${holidayRange.end.getFullYear()}-${String(holidayRange.end.getMonth() + 1).padStart(2, '0')}-${String(holidayRange.end.getDate()).padStart(2, '0')}`
      : startStr;
      
    setIsSavingHoliday(true);
    try {
      const activeAcademyId = localStorage.getItem('takeme_selected_academy_id') || (() => {
        try { return JSON.parse(localStorage.getItem('takeme_user') || '{}').academyId; } catch(e){ return undefined; }
      })();
      await fetch(`${API_BASE_URL}/routing/holiday`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: startStr,
          endDate: endStr,
          reason: holidayReason || '유치원 정기 휴업',
          academyId: activeAcademyId ? Number(activeAcademyId) : undefined
        })
      });
      setShowHolidayConfirm(false);
      setHolidayRange({ start: null, end: null });
      setHolidayReason('유치원 정기 휴업');
      fetchHolidays();
    } catch (e) {
      console.error(e);
      alert('휴업일 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSavingHoliday(false);
    }
  };

  const deleteHoliday = async (id) => {
    setIsDeletingHoliday(true);
    try {
      await fetch(`${API_BASE_URL}/routing/holiday/${id}`, { method: 'DELETE' });
      await fetchHolidays();
      setHolidayToDelete(null);
    } catch (e) {
      console.error(e);
      alert('휴업일 취소 중 오류가 발생했습니다.');
    } finally {
      setIsDeletingHoliday(false);
    }
  };

  const getDayClasses = (dateObj, isSelected, isToday) => {
    let classes = 'h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all relative ';
    
    if (currentTab === 'ABSENCE' && selectedStudentForAbsence) {
      if (isDateInRange(dateObj, absenceRange.start, absenceRange.end)) {
        return classes + 'bg-red-500 text-white shadow-md transform scale-110 ring-2 ring-red-300 ring-offset-2';
      }
    } else if (currentTab === 'HOLIDAY') {
      if (isDateInRange(dateObj, holidayRange.start, holidayRange.end)) {
        return classes + 'bg-orange-500 text-white shadow-md transform scale-110 ring-2 ring-orange-300 ring-offset-2';
      }
      const isRegisteredHoliday = holidays.some(h => {
        const s = toDateStr(h.startDate);
        const e = toDateStr(h.endDate);
        const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
        return dateStr >= s && dateStr <= e;
      });
      if (isRegisteredHoliday) {
        return classes + 'bg-orange-100 text-orange-700 font-black border border-orange-300 hover:bg-orange-200';
      }
    } else if (currentTab === 'LOG') {
      if (isSelected) return classes + 'bg-blue-600 text-white shadow-md transform scale-110';
    }

    if (isToday) return classes + 'bg-blue-50 text-blue-700 border border-blue-200';
    return classes + 'hover:bg-slate-100 text-slate-700';
  };

  const getBusStudents = () => {
    if (!students || !selectedBusId) return [];
    return students.filter(s => 
      s.assignedBusId === selectedBusId || 
      s.assignedVehicle?.id === selectedBusId ||
      s.assignedVehicleId === selectedBusId ||
      s.schedules?.some(sch => sch.assignedVehicle?.id === selectedBusId || sch.assignedVehicleId === selectedBusId)
    );
  };

  // Rendering calendar dots for absences/holidays
  const renderDots = (dateObj) => {
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    
    // Holiday check
    const isHoliday = holidays.some(h => {
      const s = toDateStr(h.startDate);
      const e = toDateStr(h.endDate);
      return dateStr >= s && dateStr <= e;
    });
    if (isHoliday) {
      return <div className="absolute bottom-1 flex justify-center w-full"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span></div>;
    }
    
    if (currentTab === 'ABSENCE') {
      const dayAbsences = absences.filter(a => {
        const s = toDateStr(a.startDate);
        const e = toDateStr(a.endDate);
        return dateStr >= s && dateStr <= e;
      });
      if (dayAbsences.length > 0) {
        return (
          <div className="absolute bottom-1 flex justify-center w-full gap-0.5 flex-wrap px-1">
            {dayAbsences.slice(0, 3).map((a, i) => (
              <span key={i} className="w-1.5 h-1.5 rounded-full bg-red-400"></span>
            ))}
            {dayAbsences.length > 3 && <span className="w-1 h-1 rounded-full bg-slate-400"></span>}
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div className={`absolute inset-0 z-[2000] flex bg-slate-50 h-full overflow-hidden transition-all duration-300 ${isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
      
      {/* Calendar Area (50% width) */}
      <div className="w-1/2 h-full border-r border-slate-200 flex flex-col bg-white transition-all duration-300">
        
        {/* Calendar Header with Year Selector */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-white z-20">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h2 className="text-base font-black text-slate-800">날짜 선택</h2>
            <span className="text-xs text-slate-400 font-medium">(1월 ~ 12월)</span>
          </div>

          {/* Year Selector */}
          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setCalendarYear(prev => prev - 1)}
              className="p-1.5 hover:bg-white rounded-lg text-slate-600 hover:text-slate-900 transition-colors"
              title="이전 연도"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <select
              value={calendarYear}
              onChange={(e) => setCalendarYear(Number(e.target.value))}
              className="bg-white text-slate-800 font-black text-sm px-2.5 py-1 rounded-lg border border-slate-200 shadow-xs outline-none cursor-pointer focus:ring-2 focus:ring-blue-500"
            >
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setCalendarYear(prev => prev + 1)}
              className="p-1.5 hover:bg-white rounded-lg text-slate-600 hover:text-slate-900 transition-colors"
              title="다음 연도"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {calendarYear !== currentYear && (
              <button
                type="button"
                onClick={() => setCalendarYear(currentYear)}
                className="ml-1 px-2 py-1 text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                올해
              </button>
            )}
          </div>
        </div>

        {/* 1월 ~ 12월 Quick Month Selector Pills */}
        <div className="flex items-center gap-1 overflow-x-auto px-4 py-2 bg-slate-50 border-b border-slate-200">
          {monthsData.map((mData) => {
            const isCurrentMonth = mData.year === currentYear && mData.month === currentMonth;
            return (
              <button
                key={mData.month}
                type="button"
                onClick={() => {
                  const el = calendarRef.current?.querySelector(`[data-month-index="${mData.month}"]`);
                  if (el && calendarRef.current) {
                    calendarRef.current.scrollTop = el.offsetTop - calendarRef.current.offsetTop - 10;
                  }
                }}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg shrink-0 transition-all ${
                  isCurrentMonth
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                }`}
              >
                {monthNames[mData.month]}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-12 scroll-smooth" ref={calendarRef}>
            {monthsData.map((mData) => {
              const isCurrentMonth = mData.year === currentYear && mData.month === currentMonth;
              const daysInMonth = getDaysInMonth(mData.year, mData.month);
              const firstDay = getFirstDayOfMonth(mData.year, mData.month);
              const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
              const blanks = Array.from({ length: firstDay }, (_, i) => i);

              return (
                <div key={mData.month} data-month-index={mData.month} data-is-current={isCurrentMonth} className="max-w-md mx-auto">
                  <h3 className="text-xl font-black text-slate-800 mb-4">{mData.year}년 {monthNames[mData.month]}</h3>
                  <div className="grid grid-cols-7 gap-1 text-center mb-2">
                    {['일', '월', '화', '수', '목', '금', '토'].map(d => (
                      <div key={d} className={`text-xs font-bold ${d === '일' ? 'text-red-500' : d === '토' ? 'text-blue-500' : 'text-slate-400'}`}>{d}</div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {blanks.map(b => <div key={`blank-${b}`} className="h-10"></div>)}
                    {daysArray.map(day => {
                      const dateObj = new Date(mData.year, mData.month, day);
                      const isSelected = isSameDate(dateObj, selectedDate);
                      const isToday = isSameDate(dateObj, new Date());
                      
                      return (
                        <div key={day} className="relative">
                          <button
                            onClick={() => handleDateClick(mData.year, mData.month, day)}
                            className={getDayClasses(dateObj, isSelected, isToday)}
                          >
                            {day}
                          </button>
                          {renderDots(dateObj)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Buttons below calendar depending on state */}
          {currentTab === 'ABSENCE' && absenceRange.start && (
            <div className="p-4 border-t bg-white shadow-lg flex justify-between items-center animate-slide-up">
              <div>
                <div className="text-xs text-slate-500 font-bold">선택된 기간</div>
                <div className="font-black text-red-600">
                  {absenceRange.start.toLocaleDateString()} {absenceRange.end && `~ ${absenceRange.end.toLocaleDateString()}`}
                </div>
              </div>
              <button onClick={saveAbsence} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-xl font-bold shadow-md transition-all">
                결석 저장하기
              </button>
            </div>
          )}

          {currentTab === 'HOLIDAY' && holidayRange.start && (
            <div className="p-4 border-t bg-white shadow-lg flex justify-between items-center animate-slide-up">
              <div>
                <div className="text-xs text-slate-500 font-bold">휴업 예정 기간</div>
                <div className="font-black text-orange-600">
                  {holidayRange.start.toLocaleDateString()} {holidayRange.end && `~ ${holidayRange.end.toLocaleDateString()}`}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setHolidayRange({ start: null, end: null })}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors"
                >
                  선택 취소
                </button>
                <button onClick={() => setShowHolidayConfirm(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2 rounded-xl font-bold shadow-md transition-all text-sm">
                  휴업일 저장하기
                </button>
              </div>
            </div>
          )}
        </div>

      {/* Right Side Area (50%) */}
      <div className="w-1/2 h-full flex flex-col bg-slate-50">
        {currentTab === 'HOLIDAY' ? (
          <div className="h-full flex flex-col">
            <div className="p-4 border-b border-slate-200 bg-white shadow-sm z-10 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  유치원 휴업일(휴원) 관리
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  달력에서 날짜를 지정하거나 등록된 휴업일을 취소(삭제)할 수 있습니다.
                </p>
              </div>
              <span className="text-xs font-bold px-3 py-1 bg-orange-50 text-orange-600 rounded-full border border-orange-200">
                등록 휴업일: {holidays.length}건
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {holidayRange.start && (
                <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-4 animate-fade-in shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-orange-600 uppercase tracking-wider">신규 휴업일 선택 중</span>
                    <button
                      onClick={() => setHolidayRange({ start: null, end: null })}
                      className="text-xs text-slate-500 hover:text-slate-700 underline font-semibold"
                    >
                      선택 취소
                    </button>
                  </div>
                  <div className="text-base font-black text-orange-800 mb-3">
                    {holidayRange.start.toLocaleDateString()} {holidayRange.end && `~ ${holidayRange.end.toLocaleDateString()}`}
                    {holidayRange.end && (
                      <span className="text-xs font-semibold text-orange-600 ml-2">
                        ({Math.round((holidayRange.end - holidayRange.start) / (1000 * 60 * 60 * 24)) + 1}일간)
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setShowHolidayConfirm(true)}
                    className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    이 기간을 휴업일로 저장하기
                  </button>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-black text-slate-700">지정된 휴업일 목록</h3>
                  <span className="text-xs text-slate-400">최신순</span>
                </div>

                {holidays.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-8 text-center">
                    <div className="w-12 h-12 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center mx-auto mb-3">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </div>
                    <p className="font-bold text-slate-600 text-sm mb-1">등록된 휴업일이 없습니다</p>
                    <p className="text-xs text-slate-400">
                      왼쪽 달력에서 시작일과 종료일을 클릭하여 휴업일을 지정해 보세요.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {holidays.map(h => {
                      const sDate = toDateStr(h.startDate);
                      const eDate = toDateStr(h.endDate);
                      const isSingleDay = sDate === eDate;
                      return (
                        <div
                          key={h.id}
                          className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs hover:shadow-md transition-all flex items-center justify-between"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-lg shrink-0">
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                            </div>
                            <div>
                              <div className="font-black text-slate-800 text-base flex items-center gap-2">
                                <span>{sDate} {isSingleDay ? '' : `~ ${eDate}`}</span>
                                {isSingleDay && <span className="text-[11px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">당일</span>}
                              </div>
                              <div className="text-xs text-slate-500 mt-1 flex items-center gap-2">
                                <span>{h.reason ? `사유: ${h.reason}` : '사유: 유치원 정기 휴업'}</span>
                                <span className="text-slate-300">|</span>
                                <span className="text-orange-600 font-semibold">전 차량 운행 정지</span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setHolidayToDelete(h)}
                            className="px-3.5 py-2 bg-red-50 hover:bg-red-500 text-red-600 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 border border-red-100 hover:border-transparent shadow-xs"
                            title="휴업일 지정 취소"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>휴업 취소</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
          <div className="p-4 border-b border-slate-200 bg-white shadow-sm z-10">
            {currentTab === 'LOG' && (
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-slate-800">
                  {selectedDate.getFullYear()}년 {selectedDate.getMonth() + 1}월 {selectedDate.getDate()}일 운행 일지
                </h2>
              </div>
            )}
            {currentTab === 'ABSENCE' && (
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-slate-800">
                  원생 결석관리
                </h2>
              </div>
            )}
            
            {/* Bus Selection Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {buses.map(bus => (
                <button
                  key={bus.id}
                  onClick={() => { setSelectedBusId(bus.id); setSelectedStudentForAbsence(null); }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${
                    selectedBusId === bus.id 
                      ? 'bg-slate-800 text-white shadow-md transform scale-105' 
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: bus.color }}></span>
                  {bus.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {currentTab === 'LOG' && (
              <div className="h-full">
                {isLoadingLogs ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-60">
                    <div className="w-8 h-8 border-3 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p className="text-sm font-bold text-slate-500">로그 데이터를 불러오는 중...</p>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-60">
                    <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
                    </div>
                    <p className="text-sm font-bold text-slate-500">선택한 날짜에 기록된 로그가 없습니다.</p>
                  </div>
                ) : (
                  <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                    {logs.map((log, index) => {
                      const getTypeStyle = (type) => {
                        switch (type) {
                          case 'OPERATION_START': return 'text-blue-600 bg-blue-50 border-blue-100';
                          case 'OPERATION_END': return 'text-red-600 bg-red-50 border-red-100';
                          case 'BOARDING': return 'text-green-600 bg-green-50 border-green-100';
                          case 'PARENT_MESSAGE': return 'text-purple-600 bg-purple-50 border-purple-100';
                          default: return 'text-slate-600 bg-slate-50 border-slate-100';
                        }
                      };
                      const getTypeLabel = (type) => {
                        switch (type) {
                          case 'OPERATION_START': return '운행 시작';
                          case 'OPERATION_END': return '운행 종료';
                          case 'BOARDING': return '탑승';
                          case 'PARENT_MESSAGE': return '메시지';
                          default: return type;
                        }
                      };
                      const style = getTypeStyle(log.type);
                      return (
                        <div key={index} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                          <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-slate-50 bg-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                            {renderLogIcon(log.type)}
                          </div>
                          <div className={`w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-2xl border shadow-sm transition-all hover:shadow-md ${style}`}>
                            <div className="flex items-center justify-between space-x-2 mb-1">
                              <div className="font-black text-sm">{getTypeLabel(log.type)}</div>
                              <time className="text-xs font-bold opacity-70">
                                {new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </time>
                            </div>
                            <div className="text-sm font-medium opacity-90">{log.message}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {currentTab === 'ABSENCE' && (
                <div className="grid grid-cols-1 gap-4">
                  {getBusStudents().map(student => {
                    const studentAbsences = absences.filter(a => (a.student?.id || a.studentId) === student.id);
                    const isSelected = selectedStudentForAbsence?.id === student.id;
                    
                    return (
                      <div key={student.id} className={`bg-white rounded-2xl border p-4 transition-all shadow-sm ${isSelected ? 'ring-2 ring-red-500 border-transparent' : 'hover:border-slate-300'}`}>
                        <div className="flex justify-between items-center">
                          <div className="font-black text-slate-800 text-lg">{student.name} <span className="text-xs text-slate-400 font-normal ml-2">{student.raw?.['유치원명'] || student.raw?.['학교명']}</span></div>
                          <button 
                            onClick={() => {
                              setSelectedStudentForAbsence(isSelected ? null : student);
                              setAbsenceRange({ start: null, end: null });
                            }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isSelected ? 'bg-red-500 text-white' : 'bg-red-50 text-red-600 hover:bg-red-100'}`}
                          >
                            {isSelected ? '선택 취소' : '결석 등록'}
                          </button>
                        </div>
                        
                        {studentAbsences.length > 0 && (
                          <div className="mt-4 space-y-2 border-t pt-3">
                            <div className="text-xs text-slate-400 font-bold mb-2">등록된 결석 이력</div>
                            {studentAbsences.map(a => (
                              <div key={a.id} className="flex justify-between items-center bg-slate-50 px-3 py-2 rounded-lg text-sm border">
                                <span className="font-medium text-slate-700">{a.startDate} {a.startDate !== a.endDate ? `~ ${a.endDate}` : ''}</span>
                                <button onClick={() => deleteAbsence(a.id)} className="text-slate-400 hover:text-red-500 transition-colors">
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {getBusStudents().length === 0 && (
                    <div className="text-center p-8 text-slate-500 font-bold">이 차량에 배정된 원생이 없습니다.</div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Holiday Double Confirmation Modal */}
      {showHolidayConfirm && (
        <div className="absolute inset-0 z-[3000] flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl mx-4 transform animate-scale-up">
            <div className="w-12 h-12 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-xl font-black text-slate-800 text-center mb-2">휴업일로 지정하시겠습니까?</h3>
            <div className="text-center mb-4">
              <span className="font-black text-orange-600 text-base">
                {holidayRange.start?.toLocaleDateString()} {holidayRange.end && `~ ${holidayRange.end.toLocaleDateString()}`}
              </span>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-slate-500 mb-1">휴업 사유</label>
              <input
                type="text"
                value={holidayReason}
                onChange={(e) => setHolidayReason(e.target.value)}
                placeholder="예: 정기 휴원, 개원기념일, 재량휴업일 등"
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 font-medium"
              />
            </div>
            <p className="text-slate-500 text-center text-xs mb-6 leading-relaxed">
              저장을 누르시면 전 인원에게 휴업일 공지가 발송되며,<br/>해당 기간 동안 셔틀 운행이 일시 정지됩니다.
            </p>
            <div className="flex gap-3">
              <button 
                type="button"
                disabled={isSavingHoliday}
                onClick={() => setShowHolidayConfirm(false)} 
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                취소
              </button>
              <button 
                type="button"
                disabled={isSavingHoliday}
                onClick={saveHoliday} 
                className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl shadow-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {isSavingHoliday ? '저장 중...' : '확인 및 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Holiday Confirmation Modal */}
      {holidayToDelete && (
        <div className="absolute inset-0 z-[3000] flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl mx-4 transform animate-scale-up">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <h3 className="text-xl font-black text-slate-800 text-center mb-2">휴업일 지정을 취소하시겠습니까?</h3>
            <p className="text-slate-600 text-center mb-6 leading-relaxed text-sm">
              <b className="text-orange-600 font-bold">
                {toDateStr(holidayToDelete.startDate)} {toDateStr(holidayToDelete.startDate) !== toDateStr(holidayToDelete.endDate) ? `~ ${toDateStr(holidayToDelete.endDate)}` : ''}
              </b>
              <br/>
              해당 기간의 휴업 설정이 취소되며, 셔틀 차량 운행 및 원아 등·하원이 <b>정상 운행</b>으로 복원됩니다.
            </p>
            <div className="flex gap-3">
              <button 
                type="button"
                disabled={isDeletingHoliday}
                onClick={() => setHolidayToDelete(null)} 
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                닫기
              </button>
              <button 
                type="button"
                disabled={isDeletingHoliday}
                onClick={() => deleteHoliday(holidayToDelete.id)} 
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl shadow-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {isDeletingHoliday ? '취소 중...' : '휴업 취소 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideOutRight { from { transform: translateX(0); } to { transform: translateX(100%); } }
        @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes scaleUp { from { transform: scale(0.95); opacity: 0; } to { transform: scale(1); opacity: 1; } }
        
        .animate-slide-in-right { animation: slideInRight 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-slide-out-right { animation: slideOutRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-slide-up { animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .animate-fade-in { animation: fadeIn 0.2s ease forwards; }
        .animate-scale-up { animation: scaleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </div>
  );
}
