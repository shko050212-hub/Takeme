import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { API_BASE_URL } from './config';

const getDaysInMonth = (year, month) => {
  return new Date(year, month + 1, 0).getDate();
};

const getFirstDayOfMonth = (year, month) => {
  return new Date(year, month, 1).getDay();
};

const monthNames = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"];

export default function LogViewer({ buses, students, currentTab = 'LOG', isClosing }) {
  
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedBusId, setSelectedBusId] = useState(buses?.length > 0 ? buses[0].id : null);
  
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
  
  const calendarRef = useRef(null);
  
  // Generate 13 months
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthsData = [];
  
  for (let i = -6; i <= 6; i++) {
    let m = currentMonth + i;
    let y = currentYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    monthsData.push({ year: y, month: m });
  }

  useLayoutEffect(() => {
    if (calendarRef.current) {
      const currentMonthElement = calendarRef.current.querySelector('[data-is-current="true"]');
      if (currentMonthElement) {
        calendarRef.current.scrollTop = currentMonthElement.offsetTop - calendarRef.current.offsetTop - 20;
      }
    }
  }, [currentTab]);

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
      const res = await fetch(`${API_BASE_URL}/routing/holidays`);
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
      
    try {
      await fetch(`${API_BASE_URL}/routing/holiday`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: startStr,
          endDate: endStr
        })
      });
      setShowHolidayConfirm(false);
      setHolidayRange({ start: null, end: null });
      fetchHolidays();
    } catch (e) {
      console.error(e);
    }
  };

  const getDayClasses = (dateObj, isSelected, isToday) => {
    let classes = 'h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ';
    
    if (currentTab === 'ABSENCE' && selectedStudentForAbsence) {
      if (isDateInRange(dateObj, absenceRange.start, absenceRange.end)) {
        return classes + 'bg-red-500 text-white shadow-md transform scale-110 ring-2 ring-red-300 ring-offset-2';
      }
    } else if (currentTab === 'HOLIDAY') {
      if (isDateInRange(dateObj, holidayRange.start, holidayRange.end)) {
        return classes + 'bg-orange-500 text-white shadow-md transform scale-110 ring-2 ring-orange-300 ring-offset-2';
      }
    } else if (currentTab === 'LOG') {
      if (isSelected) return classes + 'bg-blue-600 text-white shadow-md transform scale-110';
    }

    if (isToday) return classes + 'bg-blue-50 text-blue-700 border border-blue-200';
    return classes + 'hover:bg-slate-100 text-slate-700';
  };

  const getBusStudents = () => {
    if (!students || !selectedBusId) return [];
    return students.filter(s => s.assignedVehicle?.id === selectedBusId);
  };

  // Rendering calendar dots for absences/holidays
  const renderDots = (dateObj) => {
    const dots = [];
    
    // Holiday check
    const dateStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    const isHoliday = holidays.some(h => dateStr >= h.startDate && dateStr <= h.endDate);
    if (isHoliday) {
      return <div className="absolute bottom-1 flex justify-center w-full"><span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span></div>;
    }
    
    if (currentTab === 'ABSENCE') {
      const dayAbsences = absences.filter(a => dateStr >= a.startDate && dateStr <= a.endDate);
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
      
      {/* Calendar Area (50% or 100% depending on tab) */}
      <div className={`${currentTab === 'HOLIDAY' ? 'w-full' : 'w-1/2'} h-full border-r border-slate-200 flex flex-col bg-white transition-all duration-300`}>
        
        {/* Calendar Header */}
        <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-100/50 backdrop-blur z-20">
          <h2 className="text-lg font-black text-slate-800">📅 날짜 선택</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-12 scroll-smooth" ref={calendarRef}>
            {monthsData.map((mData, index) => {
              const isCurrentMonth = mData.year === currentYear && mData.month === currentMonth;
              const daysInMonth = getDaysInMonth(mData.year, mData.month);
              const firstDay = getFirstDayOfMonth(mData.year, mData.month);
              const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
              const blanks = Array.from({ length: firstDay }, (_, i) => i);

              return (
                <div key={index} data-is-current={isCurrentMonth} className="max-w-md mx-auto">
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
              <button onClick={() => setShowHolidayConfirm(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2 rounded-xl font-bold shadow-md transition-all">
                휴업일 저장하기
              </button>
            </div>
          )}
        </div>

      {/* Right Side Area (50%) */}
      {currentTab !== 'HOLIDAY' && (
        <div className="w-1/2 h-full flex flex-col bg-slate-50">
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
                  학원생 결석관리
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
                  <div className="flex flex-col items-center justify-center h-full opacity-50">
                    <div className="text-4xl animate-bounce mb-4">📝</div>
                    <p className="text-sm font-bold text-slate-500">로그 데이터를 불러오는 중...</p>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-50">
                    <div className="text-4xl mb-4 grayscale">📭</div>
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
                          <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-slate-50 bg-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 text-lg z-10">
                            {log.icon}
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
                    const studentAbsences = absences.filter(a => a.student.id === student.id);
                    const isSelected = selectedStudentForAbsence?.id === student.id;
                    
                    return (
                      <div key={student.id} className={`bg-white rounded-2xl border p-4 transition-all shadow-sm ${isSelected ? 'ring-2 ring-red-500 border-transparent' : 'hover:border-slate-300'}`}>
                        <div className="flex justify-between items-center">
                          <div className="font-black text-slate-800 text-lg">{student.name} <span className="text-xs text-slate-400 font-normal ml-2">{student.raw?.['학교명']}</span></div>
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
          </div>
        )}

      {/* Holiday Double Confirmation Modal */}
      {showHolidayConfirm && (
        <div className="absolute inset-0 z-[3000] flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl mx-4 transform animate-scale-up">
            <div className="text-5xl mb-4 text-center">🚨</div>
            <h3 className="text-xl font-black text-slate-800 text-center mb-4">일자가 잘못 되지는 않았나요?</h3>
            <p className="text-slate-600 text-center mb-6 leading-relaxed">
              지금 저장을 누르시면 전 인원에게 휴업일 관련 일자 공지가 가게 됩니다. <br/>신중하게 버튼을 눌러 주시면 감사하겠습니다.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setShowHolidayConfirm(false)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition-colors">
                취소
              </button>
              <button onClick={saveHoliday} className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-xl shadow-lg transition-colors">
                확인 및 전송
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
