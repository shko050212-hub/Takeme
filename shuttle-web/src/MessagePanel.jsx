import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from './config';

export default function MessagePanel({ buses, students, isClosing, msgSelectedBusId, msgTargetDriver, msgTargetTeacher, msgTargetStudents, resetSelections }) {
  const [inboxMessages, setInboxMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    fetchInbox();
    const interval = setInterval(fetchInbox, 10000); // poll every 10s
    return () => clearInterval(interval);
  }, []);

  const fetchInbox = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/routing/admin-messages`);
      if (res.ok) {
        const data = await res.json();
        setInboxMessages(data);
      }
    } catch (e) {
      console.error('Failed to fetch admin messages', e);
    }
  };

  const handleSend = async () => {
    if (!messageText.trim()) return alert('메세지 내용을 입력해주세요.');
    if (!msgTargetDriver && !msgTargetTeacher && msgTargetStudents.length === 0) {
      return alert('왼쪽 사이드바에서 수신 대상을 먼저 선택해주세요.');
    }

    const targetRoles = [];
    if (msgTargetDriver) targetRoles.push('DRIVER');
    if (msgTargetTeacher) targetRoles.push('TEACHER');
    if (msgTargetStudents.length > 0) targetRoles.push('PARENT');

    setIsSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/routing/admin-messages/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetRoles,
          vehicleId: msgSelectedBusId,
          studentIds: msgTargetStudents,
          message: messageText
        })
      });
      if (res.ok) {
        alert('메세지가 성공적으로 전송되었습니다.');
        setMessageText('');
        resetSelections();
      } else {
        alert('전송에 실패했습니다.');
      }
    } catch (e) {
      alert('오류가 발생했습니다.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className={`absolute inset-0 z-[2000] flex bg-slate-50 h-full overflow-hidden transition-all duration-300 ${isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
      
      {/* Left Area: Send Message */}
      <div className="w-1/2 h-full border-r border-slate-200 flex flex-col bg-white overflow-y-auto relative">
        <div className="p-5 border-b border-slate-200 sticky top-0 bg-white z-10 shadow-sm flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-800 mb-1 flex items-center gap-2">
              <span>📤</span> 메세지 보내기
            </h2>
            <p className="text-sm text-slate-500">좌측 사이드바에서 선택한 대상에게 메세지를 전송합니다.</p>
          </div>
          {msgSelectedBusId ? (
             <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg text-sm font-bold border border-blue-200">
               {buses.find(b => b.id === msgSelectedBusId)?.name} 선택됨
             </div>
          ) : (
             <div className="bg-slate-100 text-slate-500 px-3 py-1 rounded-lg text-sm font-bold border border-slate-200">
               호차 미선택
             </div>
          )}
        </div>

        <div className="p-6 flex flex-col h-full">
          <div className="bg-slate-50 rounded-xl p-4 mb-4 border border-slate-200">
            <h3 className="font-bold text-slate-700 mb-2">전송 대상 요약</h3>
            <div className="flex gap-3 text-sm">
              <span className={`font-bold ${msgTargetDriver ? 'text-blue-600' : 'text-slate-400'}`}>🚙 기사님: {msgTargetDriver ? '포함' : '제외'}</span>
              <span className={`font-bold ${msgTargetTeacher ? 'text-green-600' : 'text-slate-400'}`}>👩‍🏫 교사님: {msgTargetTeacher ? '포함' : '제외'}</span>
              <span className={`font-bold ${msgTargetStudents.length > 0 ? 'text-slate-700' : 'text-slate-400'}`}>👨‍👩‍👦 학부모님: {msgTargetStudents.length}명</span>
            </div>
            {(!msgTargetDriver && !msgTargetTeacher && msgTargetStudents.length === 0) && (
              <p className="text-red-500 text-xs mt-2 font-bold">⚠️ 대상을 먼저 선택해주세요.</p>
            )}
          </div>

          <div className="flex-1 flex flex-col">
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="여기에 전송할 내용을 입력하세요..."
              className="flex-1 w-full p-4 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
            ></textarea>
            
            <button
              onClick={handleSend}
              disabled={isSending || (!msgTargetDriver && !msgTargetTeacher && msgTargetStudents.length === 0)}
              className="mt-4 w-full py-4 bg-blue-600 text-white font-black rounded-xl shadow-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all text-lg"
            >
              {isSending ? '전송 중...' : '메세지 전송'}
            </button>
          </div>
        </div>
      </div>

      {/* Right Area: Inbox */}
      <div className="w-1/2 h-full flex flex-col bg-slate-50 relative">
        <div className="p-5 border-b border-slate-200 sticky top-0 bg-slate-50 z-10 shadow-sm flex justify-between items-center">
          <div>
            <h2 className="text-xl font-black text-slate-800 mb-1 flex items-center gap-2">
              <span>📥</span> 수신함
            </h2>
            <p className="text-sm text-slate-500">원장님께 수신된 메세지 목록입니다.</p>
          </div>
          <button onClick={fetchInbox} className="text-slate-400 hover:text-blue-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {inboxMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-400">
              <span className="text-4xl mb-3">📭</span>
              <p>수신된 메세지가 없습니다.</p>
            </div>
          ) : (
            inboxMessages.map(msg => (
              <div key={msg.id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex gap-4 animate-fade-in">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 text-xl">
                  {msg.message.includes('사고') || msg.message.includes('긴급') ? '🚨' : '💬'}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start mb-1">
                    <span className="font-bold text-slate-700">
                      시스템 / 현장 관리자
                    </span>
                    <span className="text-xs text-slate-400">{new Date(msg.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-600 text-sm leading-relaxed">{msg.message}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      
    </div>
  );
}
