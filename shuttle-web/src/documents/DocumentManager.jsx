import React, { useState, useEffect, useRef } from 'react';
import {
  saveDocument,
  getDocuments,
  deleteDocument,
  downloadDocument,
  formatFileSize,
  getExpiryRecords,
  saveExpiryRecord,
  calculateDday,
  getOverallExpirySummary,
} from './documentStorage';
import { openPrintDocument } from './pdfDocumentGenerator';

const CATEGORIES = [
  { id: 'all', label: '전체 서류' },
  { id: 'safety', label: '안전·점검' },
  { id: 'vehicle', label: '차량·보험' },
  { id: 'companion', label: '동승보호자' },
  { id: 'consent', label: '원생·동의서' },
  { id: 'etc', label: '기타 서류' },
];

export default function DocumentManager({ 
  academyId, 
  academyName, 
  currentUser, 
  isClosing, 
  buses = [], 
  students = [] 
}) {
  const [documents, setDocuments] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Database Integration: Selected Bus & Student for Automatic Forms
  const [selectedBusId, setSelectedBusId] = useState('all');
  const [selectedStudentId, setSelectedStudentId] = useState('');

  // Expiry Alert System States
  const [expiryRecords, setExpiryRecords] = useState({});
  const [expirySummary, setExpirySummary] = useState({ urgentCount: 0, warningCount: 0, safeCount: 0, urgentItems: [] });
  const [editingBusExpiry, setEditingBusExpiry] = useState(null); // null or bus object
  const [expiryFormData, setExpiryFormData] = useState({
    insuranceExpiry: '',
    inspectionExpiry: '',
    driverEduExpiry: '',
    companionEduExpiry: '',
  });
  const [expiryFilterTab, setExpiryFilterTab] = useState('all'); // 'all' | 'urgent' | 'warning' | 'safe'

  // Sub Navigation Tabs: 'templates' (법정 서식 자동 발급) | 'expiry' (만료일 신호등 현황) | 'documents' (등록 서류 보관함)
  const [activeSubTab, setActiveSubTab] = useState('templates');

  // Form states for upload modal
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('safety');
  const [uploadNote, setUploadNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);


  const fileInputRef = useRef(null);

  // Load expiry records & calculate summary
  const loadExpiry = () => {
    const recs = getExpiryRecords();
    setExpiryRecords(recs);
    const sum = getOverallExpirySummary(buses);
    setExpirySummary(sum);
  };

  // Load documents
  const loadDocs = async () => {
    setIsLoading(true);
    try {
      const docs = await getDocuments(academyId);
      setDocuments(docs);
    } catch (err) {
      console.error('문서 목록 불러오기 실패:', err);
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


  // Handle Drag & Drop
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setUploadFile(file);
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
      setShowUploadModal(true);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadFile(file);
      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleSubmitUpload = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      alert('업로드할 파일을 선택해주세요.');
      return;
    }
    if (!uploadTitle.trim()) {
      alert('서류 제목을 입력해주세요.');
      return;
    }

    setIsSubmitting(true);
    try {
      const categoryLabel = CATEGORIES.find(c => c.id === uploadCategory)?.label || '기타 서류';
      await saveDocument({
        academyId,
        title: uploadTitle.trim(),
        category: categoryLabel,
        file: uploadFile,
        note: uploadNote.trim(),
        uploadedBy: currentUser?.name ? `${currentUser.name} 관리자` : '원장선생님/관리자',
      });

      // Reset modal form
      setUploadFile(null);
      setUploadTitle('');
      setUploadCategory('safety');
      setUploadNote('');
      setShowUploadModal(false);
      await loadDocs();
    } catch (err) {
      console.error('문서 저장 실패:', err);
      alert('문서 저장 중 오류가 발생했습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (doc) => {
    if (window.confirm(`'${doc.title}' 서류를 삭제하시겠습니까?`)) {
      try {
        await deleteDocument(doc.id);
        await loadDocs();
      } catch (err) {
        console.error('문서 삭제 실패:', err);
        alert('문서 삭제 중 오류가 발생했습니다.');
      }
    }
  };

  // --------------------------------------------------------------------------
  // Expiry Alert System Handlers
  // --------------------------------------------------------------------------
  const handleOpenExpiryModal = (bus) => {
    const busId = String(bus.id);
    const existing = expiryRecords[busId] || {};
    setExpiryFormData({
      insuranceExpiry: existing.insuranceExpiry || '',
      inspectionExpiry: existing.inspectionExpiry || '',
      driverEduExpiry: existing.driverEduExpiry || '',
      companionEduExpiry: existing.companionEduExpiry || '',
    });
    setEditingBusExpiry(bus);
  };

  const handleQuickExtend = (field, years = 0, months = 0) => {
    setExpiryFormData((prev) => {
      const currentVal = prev[field];
      let baseDate = new Date();
      if (currentVal) {
        const [y, m, d] = currentVal.split('-').map(Number);
        const parsed = new Date(y, m - 1, d);
        if (!isNaN(parsed.getTime())) {
          // 만약 기존 날짜가 미래면 기존 날짜 기준으로 연장, 이미 지났으면 오늘 기준으로 연장
          baseDate = parsed > new Date() ? parsed : new Date();
        }
      }

      baseDate.setFullYear(baseDate.getFullYear() + years);
      baseDate.setMonth(baseDate.getMonth() + months);

      const y = baseDate.getFullYear();
      const m = String(baseDate.getMonth() + 1).padStart(2, '0');
      const d = String(baseDate.getDate()).padStart(2, '0');

      return {
        ...prev,
        [field]: `${y}-${m}-${d}`,
      };
    });
  };

  const handleSaveExpirySubmit = (e) => {
    e.preventDefault();
    if (!editingBusExpiry) return;

    try {
      saveExpiryRecord(editingBusExpiry.id, {
        busName: editingBusExpiry.name || editingBusExpiry.busNumber || `${editingBusExpiry.id}호차`,
        ...expiryFormData,
      });
      setEditingBusExpiry(null);
    } catch (err) {
      alert('만료일 정보 저장 중 오류가 발생했습니다.');
    }
  };


  // Find currently selected bus and students
  const activeBus = buses.find(b => String(b.id) === String(selectedBusId)) || null;

  // Filter students for the active bus
  const activeBusStudents = students.filter(s => {
    if (!activeBus) return false;
    if (s.assignedBusId && String(s.assignedBusId) === String(activeBus.id)) return true;
    if (s.raw && (s.raw['등원차량'] === activeBus.name || s.raw['하원차량'] === activeBus.name)) return true;
    if (s.assignedVehicle && String(s.assignedVehicle.id) === String(activeBus.id)) return true;
    return false;
  });

  // Students available for consent form
  const availableStudents = activeBus ? activeBusStudents : students;
  const activeStudent = availableStudents.find(s => String(s.id) === String(selectedStudentId)) || availableStudents[0] || null;

  // Generate and download default template as PDF with DB information
  const handleDownloadTemplate = (type) => {
    openPrintDocument(type, {
      academyName,
      date: new Date().toISOString().split('T')[0],
      selectedBus: activeBus,
      busStudents: activeBus ? activeBusStudents : students.slice(0, 15),
      selectedStudent: activeStudent,
    });
  };

  // Filtered documents
  const filteredDocs = documents.filter((doc) => {
    const matchCategory =
      selectedCategory === 'all' ||
      (selectedCategory === 'safety' && doc.category.includes('안전')) ||
      (selectedCategory === 'vehicle' && doc.category.includes('차량')) ||
      (selectedCategory === 'companion' && doc.category.includes('동승')) ||
      (selectedCategory === 'consent' && doc.category.includes('동의')) ||
      (selectedCategory === 'etc' && !doc.category.includes('안전') && !doc.category.includes('차량') && !doc.category.includes('동승') && !doc.category.includes('동의'));

    const query = searchQuery.trim().toLowerCase();
    const matchQuery =
      !query ||
      doc.title.toLowerCase().includes(query) ||
      doc.fileName.toLowerCase().includes(query) ||
      (doc.note && doc.note.toLowerCase().includes(query)) ||
      (doc.uploadedBy && doc.uploadedBy.toLowerCase().includes(query));

    return matchCategory && matchQuery;
  });

  const getFileIcon = (fileName = '') => {
    const ext = fileName.split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) {
      return (
        <div className="w-10 h-10 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
          PDF
        </div>
      );
    }
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      return (
        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
          XLS
        </div>
      );
    }
    if (['doc', 'docx', 'hwp', 'hwpx', 'txt'].includes(ext)) {
      return (
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
          DOC
        </div>
      );
    }
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
      return (
        <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
          IMG
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
        FILE
      </div>
    );
  };

  return (
    <div
      className={`absolute inset-0 z-[2000] bg-slate-50 flex flex-col h-full overflow-hidden transition-all duration-300 ${
        isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'
      }`}
    >
      {/* Top Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">행정 및 안전 서류함</h1>
            {expirySummary.urgentCount > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-extrabold px-2.5 py-1 rounded-full flex items-center gap-1 animate-pulse">
                만료 임박 {expirySummary.urgentCount}건
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            통학버스 법정 일지 자동 발급, 안전·보험 서류 만료일 관리, 파일 보관을 한곳에서 편리하게 처리하세요.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setUploadFile(null);
              setUploadTitle('');
              setUploadNote('');
              setShowUploadModal(true);
            }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl shadow-md hover:shadow-lg transition-all active:scale-95"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            새 서류 등록
          </button>
        </div>
      </div>

      {/* Sub Navigation Pill Tabs (스크롤 없이 기능별 원클릭 분리) */}
      <div className="bg-white border-b border-slate-200 px-8 py-2.5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('templates')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${
              activeSubTab === 'templates'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-200 scale-102'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            법정 서식 자동 발급
          </button>
          <button
            onClick={() => setActiveSubTab('expiry')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${
              activeSubTab === 'expiry'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-200 scale-102'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            만료일 알림 현황
            {expirySummary.urgentCount > 0 ? (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-extrabold animate-pulse">
                {expirySummary.urgentCount}
              </span>
            ) : (
              <span className="bg-emerald-100 text-emerald-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
                정상
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('documents')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-black transition-all ${
              activeSubTab === 'documents'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-200 scale-102'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            등록 서류 보관함
            <span className="bg-slate-200 text-slate-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              {documents.length}
            </span>
          </button>
        </div>

        {/* 탭 안내 가이드 문구 */}
        <div className="text-xs text-slate-400 font-medium hidden sm:block">
          {activeSubTab === 'templates' && '호차를 선택하면 차량번호와 탑승 원생 명부가 서식에 자동 완성됩니다.'}
          {activeSubTab === 'expiry' && '자동차 종합보험, 정기검사, 안전교육 4대 법정 기한을 관리합니다.'}
          {activeSubTab === 'documents' && '업로드하여 영구 보관 중인 서류들을 검색하고 다운로드할 수 있습니다.'}
        </div>
      </div>

      {/* Urgent Expiry Alert Banner (D-7 이내 발생 시) */}
      {expirySummary.urgentCount > 0 && activeSubTab !== 'expiry' && (
        <div className="bg-gradient-to-r from-red-600 to-rose-600 text-white px-8 py-2.5 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs animate-in fade-in">
          <div className="flex items-center gap-2.5 font-bold">
            <span>
              [긴급 만료 알림] {expirySummary.urgentItems[0]?.busName} {expirySummary.urgentItems[0]?.fieldLabel} ({expirySummary.urgentItems[0]?.dday.label}) 외 {expirySummary.urgentCount}건의 갱신이 필요합니다.
            </span>
          </div>
          <button
            onClick={() => {
              setActiveSubTab('expiry');
              const targetBusId = expirySummary.urgentItems[0]?.busId;
              const targetBus = buses.find((b) => String(b.id) === String(targetBusId)) || {
                id: targetBusId,
                name: expirySummary.urgentItems[0]?.busName,
              };
              handleOpenExpiryModal(targetBus);
            }}
            className="bg-white text-red-700 hover:bg-red-50 font-black px-3.5 py-1 rounded-lg shadow-2xs transition-all active:scale-95"
          >
            만료일 현황 및 갱신 바로가기 →
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">


        {/* Legal Expiry Traffic-Light Dashboard Section (만료일 탭 선택 시에만 단독 렌더링) */}
        {activeSubTab === 'expiry' && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs space-y-5 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">

            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                  법정 의무 서류 및 안전교육 만료일 현황
                  <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                    신호등 알림 시스템
                  </span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  어린이통학버스 종합보험, 정기검사/신고필증, 운전자 및 동승보호자 안전교육(2년 주기)의 만료일을 관리합니다.
                </p>
              </div>
            </div>

            {/* Status Filter Badges */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setExpiryFilterTab('all')}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all ${
                  expiryFilterTab === 'all'
                    ? 'bg-slate-800 text-white border-slate-800 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                전체 ({buses.length}대)
              </button>
              <button
                onClick={() => setExpiryFilterTab('urgent')}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1 ${
                  expiryFilterTab === 'urgent'
                    ? 'bg-red-600 text-white border-red-600 shadow-xs'
                    : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                }`}
              >
                만료/임박 ({expirySummary.urgentCount}건)
              </button>
              <button
                onClick={() => setExpiryFilterTab('warning')}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1 ${
                  expiryFilterTab === 'warning'
                    ? 'bg-amber-500 text-white border-amber-500 shadow-xs'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                }`}
              >
                주의 ({expirySummary.warningCount}건)
              </button>
              <button
                onClick={() => setExpiryFilterTab('safe')}
                className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1 ${
                  expiryFilterTab === 'safe'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                정상 ({expirySummary.safeCount}건)
              </button>
            </div>
          </div>

          {/* Bus Expiry Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {buses
              .filter((bus) => {
                if (selectedBusId !== 'all' && String(bus.id) !== String(selectedBusId)) {
                  return false;
                }
                if (expiryFilterTab === 'all') return true;
                const rec = expiryRecords[String(bus.id)] || {};
                const ddays = [
                  calculateDday(rec.insuranceExpiry),
                  calculateDday(rec.inspectionExpiry),
                  calculateDday(rec.driverEduExpiry),
                  calculateDday(rec.companionEduExpiry),
                ];
                if (expiryFilterTab === 'urgent') {
                  return ddays.some((d) => d.status === 'expired' || d.status === 'urgent');
                }
                if (expiryFilterTab === 'warning') {
                  return ddays.some((d) => d.status === 'warning');
                }
                if (expiryFilterTab === 'safe') {
                  return ddays.every((d) => d.status === 'safe');
                }
                return true;
              })
              .map((bus) => {
                const rec = expiryRecords[String(bus.id)] || {};
                const insuranceD = calculateDday(rec.insuranceExpiry);
                const inspectionD = calculateDday(rec.inspectionExpiry);
                const driverEduD = calculateDday(rec.driverEduExpiry);
                const companionEduD = calculateDday(rec.companionEduExpiry);

                const hasUrgent = [insuranceD, inspectionD, driverEduD, companionEduD].some(
                  (d) => d.status === 'expired' || d.status === 'urgent'
                );

                return (
                  <div
                    key={bus.id}
                    className={`rounded-2xl border p-4.5 transition-all shadow-xs flex flex-col justify-between ${
                      hasUrgent
                        ? 'bg-red-50/40 border-red-200 hover:border-red-400'
                        : 'bg-slate-50/70 border-slate-200 hover:border-blue-300'
                    }`}
                  >
                    <div>
                      {/* Bus Header */}
                      <div className="flex items-center justify-between pb-3 border-b border-slate-200/60 mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shadow-2xs shrink-0"
                            style={{ backgroundColor: bus.color || '#3b82f6' }}
                          ></span>
                          <span className="font-extrabold text-sm text-slate-800">
                            {bus.name || bus.busNumber}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold text-slate-500 bg-white px-2 py-0.5 rounded-lg border border-slate-200 shadow-2xs">
                          {bus.plateNumber || '차량번호 미등록'}
                        </span>
                      </div>

                      {/* 4 Legal Items */}
                      <div className="space-y-2 text-xs">
                        {/* 1. Insurance */}
                        <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <div className="text-[10px] text-slate-400 font-bold">자동차 종합보험</div>
                              <div className="font-semibold text-slate-700 text-[11px]">
                                {rec.insuranceExpiry || '미등록'}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border ${insuranceD.bg} ${insuranceD.color} ${insuranceD.border}`}
                          >
                            {insuranceD.label}
                          </span>
                        </div>

                        {/* 2. Inspection / Registration */}
                        <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <div className="text-[10px] text-slate-400 font-bold">정기검사 / 신고필증</div>
                              <div className="font-semibold text-slate-700 text-[11px]">
                                {rec.inspectionExpiry || '미등록'}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border ${inspectionD.bg} ${inspectionD.color} ${inspectionD.border}`}
                          >
                            {inspectionD.label}
                          </span>
                        </div>

                        {/* 3. Driver Edu */}
                        <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <div className="text-[10px] text-slate-400 font-bold">
                                운전자 안전교육 ({bus.driverName || '기사'})
                              </div>
                              <div className="font-semibold text-slate-700 text-[11px]">
                                {rec.driverEduExpiry || '미등록'}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border ${driverEduD.bg} ${driverEduD.color} ${driverEduD.border}`}
                          >
                            {driverEduD.label}
                          </span>
                        </div>

                        {/* 4. Companion Edu */}
                        <div className="flex items-center justify-between bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <div className="text-[10px] text-slate-400 font-bold">
                                동승자 안전교육 ({bus.teacherName || '교사'})
                              </div>
                              <div className="font-semibold text-slate-700 text-[11px]">
                                {rec.companionEduExpiry || '미등록'}
                              </div>
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-extrabold px-2 py-0.5 rounded-lg border ${companionEduD.bg} ${companionEduD.color} ${companionEduD.border}`}
                          >
                            {companionEduD.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Action Button */}
                    <button
                      onClick={() => handleOpenExpiryModal(bus)}
                      className="w-full mt-3 py-2 px-3 bg-white hover:bg-blue-600 text-blue-700 hover:text-white border border-blue-200 hover:border-blue-600 rounded-xl text-xs font-bold transition-all shadow-2xs flex items-center justify-center gap-1.5 active:scale-98"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                        />
                      </svg>
                      만료일 설정 / 갱신
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
        )}

        {/* Legal Templates Section (법정 서식 자동 발급 탭 선택 시에만 렌더링) */}
        {activeSubTab === 'templates' && (
          <div className="bg-white border border-slate-200/90 rounded-2xl p-7 shadow-xs space-y-6 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-800 flex items-center gap-2">
                    데이터베이스 연동 법정 서식 자동 발급
                    <span className="text-xs font-bold text-blue-700 bg-blue-100 px-2 py-0.5 rounded-md">
                      당일 날짜 & DB 명부 연동
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    호차를 선택하면 차량번호, 기사님, 동승보호자, 그리고 <strong>해당 호차 배정 실제 원생 명부</strong>가 서식에 자동으로 채워집니다.
                  </p>
                </div>
              </div>

              {/* Bus Selector */}
              <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 shadow-2xs">
                <span className="text-xs font-bold text-blue-900">
                  호차 선택:
                </span>
                <select
                  value={selectedBusId}
                  onChange={(e) => setSelectedBusId(e.target.value)}
                  className="text-xs font-bold text-blue-700 bg-transparent outline-none cursor-pointer"
                >
                  <option value="all">전체 (공통 기본 양식)</option>
                  {buses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.busNumber} {b.plateNumber ? `(${b.plateNumber})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Active Bus Info Badge */}
            {activeBus && (
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-4">
                  <span className="font-extrabold text-blue-700 bg-blue-100/70 px-2.5 py-1 rounded-lg">
                    {activeBus.name} 선택됨
                  </span>
                  <span className="text-slate-600">
                    <strong className="text-slate-400">차량번호:</strong> {activeBus.plateNumber || '미등록'}
                  </span>
                  <span className="text-slate-600">
                    <strong className="text-slate-400">기사님:</strong> {activeBus.driverName || '미지정'}
                  </span>
                  <span className="text-slate-600">
                    <strong className="text-slate-400">동승보호자:</strong> {activeBus.teacherName || '미지정'}
                  </span>
                </div>
                <div className="font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                  배정된 원생: {activeBusStudents.length}명
                </div>
              </div>
            )}

            {/* Template Action Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => handleDownloadTemplate('safety')}
                className="flex items-center justify-between p-5 bg-slate-50/60 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-400 rounded-2xl transition-all text-left shadow-xs group"
              >
                <div>
                  <div className="text-xs font-bold text-slate-800 group-hover:text-blue-600">
                    일일 안전점검표 {activeBus ? `(${activeBus.name})` : ''}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {activeBus ? '호차, 차량번호, 기사/동승자 자동 기입' : '기본 양식'}
                  </div>
                </div>
                <span className="text-xs font-bold text-blue-600 bg-white group-hover:bg-blue-600 group-hover:text-white px-3 py-1.5 rounded-xl border border-blue-200 transition-colors shrink-0 shadow-2xs">
                  인쇄 / PDF
                </span>
              </button>

              <button
                onClick={() => handleDownloadTemplate('companion')}
                className="flex items-center justify-between p-5 bg-slate-50/60 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-400 rounded-2xl transition-all text-left shadow-xs group"
              >
                <div>
                  <div className="text-xs font-bold text-slate-800 group-hover:text-blue-600">
                    동승자 탑승일지 및 승하차명부
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {activeBus ? `원생 명부 (${activeBusStudents.length}명) 자동 포함` : '승하차 안전확인부'}
                  </div>
                </div>
                <span className="text-xs font-bold text-blue-600 bg-white group-hover:bg-blue-600 group-hover:text-white px-3 py-1.5 rounded-xl border border-blue-200 transition-colors shrink-0 shadow-2xs">
                  인쇄 / PDF
                </span>
              </button>

              <button
                onClick={() => handleDownloadTemplate('consent')}
                className="flex items-center justify-between p-5 bg-slate-50/60 hover:bg-blue-50/70 border border-slate-200 hover:border-blue-400 rounded-2xl transition-all text-left shadow-xs group"
              >
                <div>
                  <div className="text-xs font-bold text-slate-800 group-hover:text-blue-600">
                    차량이용 및 안전동의서
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {activeStudent ? `[${activeStudent.name}] 원아 인적사항 연동` : '보호자 서약 서식'}
                  </div>
                </div>
                <span className="text-xs font-bold text-blue-600 bg-white group-hover:bg-blue-600 group-hover:text-white px-3 py-1.5 rounded-xl border border-blue-200 transition-colors shrink-0 shadow-2xs">
                  인쇄 / PDF
                </span>
              </button>
            </div>

            {/* Individual Student Selector for Consent */}
            {availableStudents.length > 0 && (
              <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 font-bold">
                  동의서 대상 원생 개별 선택:
                </span>
                <select
                  value={selectedStudentId}
                  onChange={(e) => setSelectedStudentId(e.target.value)}
                  className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 font-bold text-slate-800 text-xs outline-none"
                >
                  {availableStudents.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} ({st.raw?.['유치원명'] || st.raw?.['학교명'] || ''} {st.raw?.['연령'] || st.raw?.['학년'] || ''} {st.raw?.['반명'] ? `| ${st.raw?.['반명']}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Print Note */}
            <div className="text-[11px] text-slate-400 bg-slate-50 p-3 rounded-xl border border-dashed border-slate-200 leading-relaxed">
              <strong>작성 안내</strong>: [인쇄 / PDF] 버튼을 누르면 A4 표준 법정 서식으로 자동 조판된 인쇄 미리보기가 열립니다. 날짜(당일)와 호차·원생 정보는 자동 기입되며, 점검 체크란은 법적 효력을 위해 현장 수기 체크용 빈 양식으로 인쇄됩니다.
            </div>
          </div>
        )}

        {/* Registered Documents Vault Section (등록 서류 보관함 탭 선택 시에만 렌더링) */}
        {activeSubTab === 'documents' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">

          {/* Categories */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Search Input */}
          <div className="relative min-w-[240px]">
            <input
              type="text"
              placeholder="서류명, 파일명 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Quick Drag & Drop Upload Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => {
            if (fileInputRef.current) fileInputRef.current.click();
          }}
          className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
            isDragging
              ? 'border-blue-500 bg-blue-50/70 scale-[1.01]'
              : 'border-slate-300 hover:border-blue-400 bg-white/70 hover:bg-blue-50/30'
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              handleFileSelect(e);
              if (e.target.files && e.target.files[0]) {
                setShowUploadModal(true);
              }
            }}
            className="hidden"
          />
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <div className="text-sm font-bold text-slate-700">
              여기로 서류 파일을 끌어다 놓거나 <span className="text-blue-600 underline">파일을 선택</span>하세요
            </div>
            <div className="text-xs text-slate-400">
              PDF, HWP, 엑셀(XLSX), 워드, 이미지 등 모든 행정 서류 지원 (브라우저 로컬 저장)
            </div>
          </div>
        </div>

        {/* Document List */}
        {isLoading ? (
          <div className="text-center py-16 text-slate-400 text-sm">서류 목록을 불러오는 중...</div>
        ) : filteredDocs.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-xs">
            <h3 className="text-base font-bold text-slate-700 mb-1">등록된 서류가 없습니다</h3>
            <p className="text-xs text-slate-500 mb-4">
              새로운 서류를 업로드하거나 상단의 필수 법정 서식을 다운로드하여 사용해보세요.
            </p>
            <button
              onClick={() => {
                setUploadFile(null);
                setUploadTitle('');
                setShowUploadModal(true);
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all shadow-sm"
            >
              서류 등록하기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDocs.map((doc) => (
              <div
                key={doc.id}
                className="bg-white border border-slate-200 hover:border-blue-400 hover:shadow-md rounded-2xl p-5 transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {getFileIcon(doc.fileName)}
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md inline-block mb-1">
                          {doc.category}
                        </span>
                        <h3 className="font-bold text-sm text-slate-800 leading-snug break-all" title={doc.title}>
                          {doc.title}
                        </h3>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(doc)}
                      className="text-slate-300 hover:text-red-500 transition-colors p-1 shrink-0"
                      title="서류 삭제"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>

                  <div className="space-y-2 text-[11px] text-slate-500 bg-slate-50 p-3 rounded-xl mb-4">
                    <div className="flex flex-col gap-0.5 border-b border-slate-200/60 pb-1.5">
                      <span className="text-[10px] text-slate-400 font-semibold">파일명:</span>
                      <span className="font-medium text-slate-800 break-all text-xs leading-relaxed" title={doc.fileName}>
                        {doc.fileName}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">용량:</span>
                      <span className="font-medium text-slate-700">{formatFileSize(doc.fileSize)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">등록일:</span>
                      <span className="font-medium text-slate-700">
                        {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString('ko-KR') : '-'}
                      </span>
                    </div>
                    {doc.note && (
                      <div className="pt-1 text-[11px] text-slate-600 border-t border-slate-200/60 break-all leading-relaxed">
                        {doc.note}
                      </div>
                    )}
                  </div>
                </div>

                {/* Direct Download Button */}
                <button
                  onClick={() => downloadDocument(doc)}
                  className="w-full flex items-center justify-center gap-2 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white font-bold text-xs py-2.5 rounded-xl transition-all shadow-xs active:scale-[0.98]"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  파일 다운로드
                </button>
              </div>
            ))}
          </div>
        )}
          </div>
        )}
      </div>


      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-black text-slate-800">
                서류 등록하기
              </h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitUpload} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">서류 파일 선택 *</label>
                <input
                  type="file"
                  onChange={handleFileSelect}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer border border-slate-200 rounded-xl p-1"
                />
                {uploadFile && (
                  <div className="text-[11px] text-blue-600 mt-1 font-medium break-all">
                    선택된 파일: {uploadFile.name} ({formatFileSize(uploadFile.size)})
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">서류 명칭 *</label>
                <input
                  type="text"
                  placeholder="예: 2026년 10월 통학버스 안전점검표"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">서류 분류 *</label>
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="safety">안전·점검 (체크리스트, 안전점검표 등)</option>
                  <option value="vehicle">차량·보험 (차량등록증, 자동차종합보험 등)</option>
                  <option value="companion">동승보호자 (탑승일지, 보호자명부 등)</option>
                  <option value="consent">원생·동의서 (차량이용신청서, 응급처치동의서 등)</option>
                  <option value="etc">기타 서류 (공문, 증명서 등)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">메모 / 설명 (선택)</label>
                <textarea
                  rows={2}
                  placeholder="서류 관련 참고 사항이나 메모를 입력하세요."
                  value={uploadNote}
                  onChange={(e) => setUploadNote(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md transition-all disabled:opacity-50"
                >
                  {isSubmitting ? '등록 중...' : '서류 등록 완료'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Legal Expiry Edit Modal */}
      {editingBusExpiry && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-[2100] p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-800">
                  {editingBusExpiry.name || editingBusExpiry.busNumber} 만료일 설정
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  차량번호: <strong>{editingBusExpiry.plateNumber || '미등록'}</strong> | 
                  기사: <strong>{editingBusExpiry.driverName || '미지정'}</strong> | 
                  동승자: <strong>{editingBusExpiry.teacherName || '미지정'}</strong>
                </p>
              </div>
              <button
                onClick={() => setEditingBusExpiry(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveExpirySubmit} className="space-y-4">
              {/* 1. Automobile Insurance */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-700">
                    자동차 종합보험 만료일 (의무)
                  </label>
                  {expiryFormData.insuranceExpiry && (
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                        calculateDday(expiryFormData.insuranceExpiry).bg
                      } ${calculateDday(expiryFormData.insuranceExpiry).color} ${
                        calculateDday(expiryFormData.insuranceExpiry).border
                      }`}
                    >
                      {calculateDday(expiryFormData.insuranceExpiry).label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={expiryFormData.insuranceExpiry}
                    onChange={(e) =>
                      setExpiryFormData({ ...expiryFormData, insuranceExpiry: e.target.value })
                    }
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickExtend('insuranceExpiry', 1)}
                    className="px-2.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] rounded-xl border border-blue-200 shrink-0 transition-colors"
                  >
                    +1년 갱신
                  </button>
                </div>
              </div>

              {/* 2. Safety Inspection */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-700">
                    정기안전검사 / 신고필증 갱신일
                  </label>
                  {expiryFormData.inspectionExpiry && (
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                        calculateDday(expiryFormData.inspectionExpiry).bg
                      } ${calculateDday(expiryFormData.inspectionExpiry).color} ${
                        calculateDday(expiryFormData.inspectionExpiry).border
                      }`}
                    >
                      {calculateDday(expiryFormData.inspectionExpiry).label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={expiryFormData.inspectionExpiry}
                    onChange={(e) =>
                      setExpiryFormData({ ...expiryFormData, inspectionExpiry: e.target.value })
                    }
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickExtend('inspectionExpiry', 0, 6)}
                    className="px-2.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] rounded-xl border border-blue-200 shrink-0 transition-colors"
                  >
                    +6개월
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickExtend('inspectionExpiry', 1)}
                    className="px-2.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] rounded-xl border border-blue-200 shrink-0 transition-colors"
                  >
                    +1년
                  </button>
                </div>
              </div>

              {/* 3. Driver Safety Education */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-700">
                    운전자 안전교육 만료일 (도로교통공단 2년 주기)
                  </label>
                  {expiryFormData.driverEduExpiry && (
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                        calculateDday(expiryFormData.driverEduExpiry).bg
                      } ${calculateDday(expiryFormData.driverEduExpiry).color} ${
                        calculateDday(expiryFormData.driverEduExpiry).border
                      }`}
                    >
                      {calculateDday(expiryFormData.driverEduExpiry).label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={expiryFormData.driverEduExpiry}
                    onChange={(e) =>
                      setExpiryFormData({ ...expiryFormData, driverEduExpiry: e.target.value })
                    }
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickExtend('driverEduExpiry', 2)}
                    className="px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] rounded-xl border border-indigo-200 shrink-0 transition-colors"
                  >
                    +2년 (법정주기)
                  </button>
                </div>
              </div>

              {/* 4. Companion Safety Education */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-black text-slate-700">
                    동승보호자 안전교육 만료일 (2년 주기)
                  </label>
                  {expiryFormData.companionEduExpiry && (
                    <span
                      className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                        calculateDday(expiryFormData.companionEduExpiry).bg
                      } ${calculateDday(expiryFormData.companionEduExpiry).color} ${
                        calculateDday(expiryFormData.companionEduExpiry).border
                      }`}
                    >
                      {calculateDday(expiryFormData.companionEduExpiry).label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={expiryFormData.companionEduExpiry}
                    onChange={(e) =>
                      setExpiryFormData({ ...expiryFormData, companionEduExpiry: e.target.value })
                    }
                    className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickExtend('companionEduExpiry', 2)}
                    className="px-2.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-[11px] rounded-xl border border-indigo-200 shrink-0 transition-colors"
                  >
                    +2년 (법정주기)
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingBusExpiry(null)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md transition-all active:scale-98"
                >
                  만료일 저장 완료
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

