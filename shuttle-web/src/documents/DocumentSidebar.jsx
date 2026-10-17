import React, { useState, useEffect, useRef } from 'react';
import {
  saveDocument,
  getDocuments,
  deleteDocument,
  downloadDocument,
  formatFileSize,
  getOverallExpirySummary,
} from './documentStorage';
import { openPrintDocument } from './pdfDocumentGenerator';

export default function DocumentSidebar({ 
  academyId, 
  academyName, 
  currentUser, 
  buses = [], 
  students = [] 
}) {
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedBusId, setSelectedBusId] = useState('all');
  const [sidebarTab, setSidebarTab] = useState('templates'); // 'templates' | 'expiry' | 'docs'
  const [expirySummary, setExpirySummary] = useState({ urgentCount: 0, warningCount: 0, safeCount: 0, urgentItems: [] });
  const fileInputRef = useRef(null);


  const loadExpiry = () => {
    const summary = getOverallExpirySummary(buses);
    setExpirySummary(summary);
  };

  const loadDocs = async () => {
    setIsLoading(true);
    try {
      const docs = await getDocuments(academyId);
      setDocuments(docs);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
    loadExpiry();

    const handleDocsChanged = () => loadDocs();
    const handleExpiryChanged = () => loadExpiry();

    window.addEventListener('takeme_docs_changed', handleDocsChanged);
    window.addEventListener('takeme_expiry_changed', handleExpiryChanged);

    return () => {
      window.removeEventListener('takeme_docs_changed', handleDocsChanged);
      window.removeEventListener('takeme_expiry_changed', handleExpiryChanged);
    };
  }, [academyId, buses]);


  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const defaultTitle = file.name.replace(/\.[^/.]+$/, '');
    const title = window.prompt('등록할 서류의 명칭을 입력해주세요:', defaultTitle);
    if (!title || !title.trim()) return;

    setIsUploading(true);
    try {
      await saveDocument({
        academyId,
        title: title.trim(),
        category: '행정서류',
        file,
        uploadedBy: currentUser?.name ? `${currentUser.name} 관리자` : '관리자',
      });
      alert(`'${title}' 서류가 성공적으로 등록되었습니다.`);
    } catch (err) {
      console.error(err);
      alert('서류 등록 중 오류가 발생했습니다.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (doc) => {
    if (window.confirm(`'${doc.title}' 서류를 삭제하시겠습니까?`)) {
      try {
        await deleteDocument(doc.id);
      } catch (err) {
        console.error(err);
        alert('삭제 실패');
      }
    }
  };

  // Active bus and filtered students
  const activeBus = buses.find(b => String(b.id) === String(selectedBusId)) || null;
  const activeBusStudents = students.filter(s => {
    if (!activeBus) return false;
    if (s.assignedBusId && String(s.assignedBusId) === String(activeBus.id)) return true;
    if (s.raw && (s.raw['등원차량'] === activeBus.name || s.raw['하원차량'] === activeBus.name)) return true;
    if (s.assignedVehicle && String(s.assignedVehicle.id) === String(activeBus.id)) return true;
    return false;
  });

  const handleDownloadTemplate = (type) => {
    openPrintDocument(type, {
      academyName,
      date: new Date().toISOString().split('T')[0],
      selectedBus: activeBus,
      busStudents: activeBus ? activeBusStudents : students.slice(0, 15),
    });
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span>📁</span> 서류 및 문서함
          </h2>
          <span className="text-xs bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">
            {documents.length}건
          </span>
        </div>
        <p className="text-xs text-slate-500 font-medium">
          서류를 업로드하여 등록하고 원클릭으로 다운로드하세요.
        </p>
      </div>

      {/* Sidebar Sub Tabs */}
      <div className="flex border-b border-slate-200 bg-slate-50 p-1.5 gap-1 text-[11px] font-bold">
        <button
          onClick={() => setSidebarTab('templates')}
          className={`flex-1 py-1.5 px-1 rounded-lg text-center transition-all ${
            sidebarTab === 'templates'
              ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          📋 서식발급
        </button>
        <button
          onClick={() => setSidebarTab('expiry')}
          className={`flex-1 py-1.5 px-1 rounded-lg text-center transition-all flex items-center justify-center gap-1 ${
            sidebarTab === 'expiry'
              ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>🚦 만료일</span>
          {expirySummary.urgentCount > 0 && (
            <span className="bg-red-500 text-white text-[9px] px-1 py-0.2 rounded-full font-black animate-pulse">
              {expirySummary.urgentCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setSidebarTab('docs')}
          className={`flex-1 py-1.5 px-1 rounded-lg text-center transition-all ${
            sidebarTab === 'docs'
              ? 'bg-white text-blue-700 shadow-2xs font-extrabold'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          📁 서류 ({documents.length})
        </button>
      </div>

      <div className="p-4 flex-1 overflow-y-auto space-y-4">
        {/* Tab 1: Templates (서식 발급) */}
        {sidebarTab === 'templates' && (
          <div className="p-3.5 bg-gradient-to-br from-blue-50 to-indigo-50/50 border border-blue-200/80 rounded-xl space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-extrabold text-blue-900 flex items-center gap-1">
                <span>📋</span> DB 연동 법정 서식 발급
              </div>
              {activeBus && (
                <span className="text-[10px] text-blue-600 font-bold">
                  원생 {activeBusStudents.length}명 연동
                </span>
              )}
            </div>

            {/* Bus Selector */}
            <div className="bg-white px-2.5 py-1.5 rounded-lg border border-blue-200 shadow-2xs">
              <select
                value={selectedBusId}
                onChange={(e) => setSelectedBusId(e.target.value)}
                className="w-full text-xs font-bold text-blue-800 bg-transparent outline-none cursor-pointer"
              >
                <option value="all">전체 (기본 서식)</option>
                {buses.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name || b.busNumber} {b.plateNumber ? `(${b.plateNumber})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2 pt-1">
              <button
                onClick={() => handleDownloadTemplate('safety')}
                className="w-full py-2.5 px-3 bg-white hover:bg-blue-600 text-xs font-bold text-slate-700 hover:text-white border border-slate-200 hover:border-blue-600 rounded-xl transition-all shadow-2xs flex items-center justify-between group"
              >
                <span>일일 안전점검표 {activeBus ? `(${activeBus.name})` : ''}</span>
                <span className="text-[10px] bg-blue-50 text-blue-600 group-hover:bg-blue-500 group-hover:text-white px-2 py-0.5 rounded-md font-bold">인쇄</span>
              </button>
              <button
                onClick={() => handleDownloadTemplate('companion')}
                className="w-full py-2.5 px-3 bg-white hover:bg-blue-600 text-xs font-bold text-slate-700 hover:text-white border border-slate-200 hover:border-blue-600 rounded-xl transition-all shadow-2xs flex items-center justify-between group"
              >
                <span>동승자 탑승일지 및 승하차 명부</span>
                <span className="text-[10px] bg-blue-50 text-blue-600 group-hover:bg-blue-500 group-hover:text-white px-2 py-0.5 rounded-md font-bold">인쇄</span>
              </button>
            </div>

            <p className="text-[10px] text-slate-400 text-center">
              💡 호차를 선택하면 차량번호와 원생 명부가 자동 입력됩니다.
            </p>
          </div>
        )}

        {/* Tab 2: Expiry (만료일 현황) */}
        {sidebarTab === 'expiry' && (
          <div className="space-y-3 animate-in fade-in">
            <div className={`p-3.5 rounded-xl border transition-all ${
              expirySummary.urgentCount > 0 
                ? 'bg-red-50/70 border-red-200' 
                : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-extrabold text-slate-800 flex items-center gap-1.5">
                  <span>🚦</span> 서류·교육 만료 상태
                </div>
                {expirySummary.urgentCount > 0 ? (
                  <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-md animate-pulse">
                    🚨 긴급 {expirySummary.urgentCount}건
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-md">
                    정상
                  </span>
                )}
              </div>

              {expirySummary.urgentCount > 0 && expirySummary.urgentItems[0] && (
                <div className="text-[11px] font-bold text-red-700 bg-white/90 p-2.5 rounded-lg border border-red-100 mb-2.5 leading-tight">
                  ⚠️ {expirySummary.urgentItems[0].busName} {expirySummary.urgentItems[0].fieldLabel}
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">{expirySummary.urgentItems[0].dateStr}</span>
                    <span className="text-[10px] bg-red-600 text-white px-1.5 py-0.2 rounded font-extrabold">
                      {expirySummary.urgentItems[0].dday.label}
                    </span>
                  </div>
                </div>
              )}

              {/* Traffic Light Counter */}
              <div className="grid grid-cols-3 gap-1.5 text-center text-[10px]">
                <div className="bg-white py-2 px-1 rounded-lg border border-slate-200/70 shadow-2xs">
                  <span className="text-red-600 font-extrabold text-xs">🔴 {expirySummary.urgentCount}</span>
                  <div className="text-slate-400 text-[9px] mt-0.5">긴급/만료</div>
                </div>
                <div className="bg-white py-2 px-1 rounded-lg border border-slate-200/70 shadow-2xs">
                  <span className="text-amber-600 font-extrabold text-xs">🟡 {expirySummary.warningCount}</span>
                  <div className="text-slate-400 text-[9px] mt-0.5">갱신주의</div>
                </div>
                <div className="bg-white py-2 px-1 rounded-lg border border-slate-200/70 shadow-2xs">
                  <span className="text-emerald-600 font-extrabold text-xs">🟢 {expirySummary.safeCount}</span>
                  <div className="text-slate-400 text-[9px] mt-0.5">정상</div>
                </div>
              </div>

              <div className="text-[10px] text-slate-400 text-center mt-3 font-medium">
                💡 오른쪽 대화면 [만료일 알림 현황] 탭에서 호차별 날짜 수정이 가능합니다.
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Docs (등록 서류 보관함) */}
        {sidebarTab === 'docs' && (
          <div className="space-y-3 animate-in fade-in">
            {/* Upload Action */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="w-full py-2.5 px-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-xs hover:shadow transition-all flex items-center justify-center gap-2 text-xs disabled:opacity-50 active:scale-98"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {isUploading ? '업로드 등록 중...' : '서류 파일 바로 올리기'}
            </button>

            {/* Document List */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-700">보관된 서류 목록</span>
                <span className="text-[11px] text-slate-400">최신순</span>
              </div>

              {isLoading ? (
                <div className="text-center py-6 text-xs text-slate-400">목록 조회 중...</div>
              ) : documents.length === 0 ? (
                <div className="bg-slate-50 border border-dashed border-slate-200 rounded-xl p-5 text-center text-xs text-slate-400">
                  등록된 서류가 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs hover:border-blue-300 transition-all"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="flex-1 min-w-0 pr-1">
                          <div className="text-[10px] text-blue-600 font-bold mb-0.5">{doc.category}</div>
                          <div className="text-xs font-bold text-slate-800 break-all leading-snug" title={doc.title}>
                            {doc.title}
                          </div>
                          <div className="text-[11px] text-slate-500 break-all leading-tight mt-1" title={doc.fileName}>
                            {doc.fileName} <span className="text-slate-400 text-[10px]">({formatFileSize(doc.fileSize)})</span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDelete(doc)}
                          className="text-slate-300 hover:text-red-500 p-1 transition-colors shrink-0"
                          title="삭제"
                        >
                          ✕
                        </button>
                      </div>

                      <button
                        onClick={() => downloadDocument(doc)}
                        className="w-full mt-1.5 py-1.5 px-2 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        다운로드
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
