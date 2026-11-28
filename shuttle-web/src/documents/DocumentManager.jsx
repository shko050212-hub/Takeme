import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  saveDocument,
  getDocuments,
  deleteDocument,
  downloadDocument,
  previewDocumentInNewTab,
  formatFileSize,
  getExpiryRecords,
  loadExpiryRecordsAsync,
  saveExpiryRecord,
  calculateDday,
  getOverallExpirySummary,
  getExpiryNotificationSchedule,
  syncStaffExpiryNotifications,
  getStaffNotifications,
  sendStaffExpiryNotificationsToServer,
} from './documentStorage';
import { openPrintDocument } from './pdfDocumentGenerator';
import { API_BASE_URL } from '../config';

const CATEGORIES = [
  { id: 'all', label: '전체 서류' },
  { id: 'attendance', label: '근태·출근부' },
  { id: 'registry', label: '학원·설립등록' },
  { id: 'shuttle_consent', label: '차량이용동의서' },
  { id: 'privacy', label: '개인정보동의서' },
  { id: 'driver_location', label: '기사 위치정보' },
  { id: 'accounting', label: '회계·지출문서' },
  { id: 'report', label: '신고·보험필증' },
  { id: 'safety', label: '안전점검·운행일지' },
  { id: 'safety_guide', label: '안전지침·교육자료' },
  { id: 'etc', label: '기타 서류' },
];

export default function DocumentManager({ 
  academyId, 
  academyName, 
  currentUser, 
  isClosing, 
  buses = [], 
  students = [],
  activeEducationLevel,
}) {
  const currentEducationLevel = activeEducationLevel || currentUser?.educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  const [documents, setDocuments] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Database Integration: Selected Bus & Student for Automatic Forms
  const [selectedBusId, setSelectedBusId] = useState('all');
  const [selectedStudentId, setSelectedStudentId] = useState('none');

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
  const [staffNotiSummary, setStaffNotiSummary] = useState({ driverNotifications: [], teacherNotifications: [], allCount: 0 });
  const [showStaffNotiModal, setShowStaffNotiModal] = useState(false);
  const [staffNotiRoleFilter, setStaffNotiRoleFilter] = useState('all'); // 'all' | 'driver' | 'teacher'
  const [isSendingPush, setIsSendingPush] = useState(false);
  const [pushStatusMessage, setPushStatusMessage] = useState(null); // { type: 'success' | 'error', text: '' }

  const handleSendPushToStaff = async () => {
    const list =
      staffNotiRoleFilter === 'driver'
        ? staffNotiSummary.driverNotifications
        : staffNotiRoleFilter === 'teacher'
        ? staffNotiSummary.teacherNotifications
        : [...(staffNotiSummary.driverNotifications || []), ...(staffNotiSummary.teacherNotifications || [])];

    if (!list || list.length === 0) {
      alert('발송할 대상 만료 알림이 없습니다.');
      return;
    }

    if (!window.confirm(`현재 알림 목록 ${list.length}건을 대상 기사·교사 앱 및 관리자에게 지금 즉시 푸시 발송하시겠습니까?`)) {
      return;
    }

    setIsSendingPush(true);
    setPushStatusMessage(null);
    try {
      const targetAcademyId = academyId || currentUser?.academyId;
      const res = await sendStaffExpiryNotificationsToServer(list, targetAcademyId);
      setPushStatusMessage({
        type: 'success',
        text: `✓ ${res.sentCount ?? list.length}건의 만료 알림 푸시가 기사/교사 앱(및 관리자)으로 성공적으로 발송되었습니다!`,
      });
      setTimeout(() => setPushStatusMessage(null), 6000);
    } catch (err) {
      console.error('푸시 발송 실패:', err);
      setPushStatusMessage({
        type: 'error',
        text: `발송 실패: ${err.message || '서버 통신 오류'}`,
      });
    } finally {
      setIsSendingPush(false);
    }
  };

  // Sub Navigation Tabs: 'templates' (법정 서식 자동 발급) | 'expiry' (만료일 신호등 현황) | 'documents' (등록 서류 보관함) | 'attendance' (원아 출결서류)
  const [activeSubTab, setActiveSubTab] = useState('templates');

  // 원아 출결서류 (실시간 반별 탑승·하차·출석 현황)
  const [attendances, setAttendances] = useState([]);
  const [attendanceDate, setAttendanceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [attendanceClassFilter, setAttendanceClassFilter] = useState('ALL');
  const [attendanceSearchKeyword, setAttendanceSearchKeyword] = useState('');
  const [isLoadingAttendance, setIsLoadingAttendance] = useState(false);

  const loadAttendance = async (dateArg) => {
    const targetDate = dateArg || attendanceDate;
    const targetAcademyId = academyId || currentUser?.academyId || 1;
    setIsLoadingAttendance(true);
    try {
      const res = await fetch(`${API_BASE_URL}/teacher/academy/attendance-today?academyId=${targetAcademyId}&date=${targetDate}`);
      if (res.ok) {
        const data = await res.json();
        setAttendances(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.warn('출결 기록 조회 실패:', err);
    } finally {
      setIsLoadingAttendance(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === 'attendance') {
      loadAttendance(attendanceDate);
    }
  }, [activeSubTab, attendanceDate, academyId]);

  // Form states for upload modal
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadCategory, setUploadCategory] = useState('registry');
  const [uploadNote, setUploadNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Document Preview Modal States
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewType, setPreviewType] = useState('unsupported'); // 'pdf' | 'image' | 'text' | 'unsupported'
  const [previewText, setPreviewText] = useState('');


  const fileInputRef = useRef(null);

  // Load expiry records & calculate summary & sync staff app notifications (학제별 격리)
  const loadExpiry = async () => {
    let recs = getExpiryRecords(currentEducationLevel);
    if (!recs || Object.keys(recs).length === 0) {
      recs = await loadExpiryRecordsAsync(currentEducationLevel);
    }
    setExpiryRecords(recs || {});
    const sum = getOverallExpirySummary(buses, currentEducationLevel);
    setExpirySummary(sum);
    const staffSync = syncStaffExpiryNotifications(buses, currentEducationLevel);
    setStaffNotiSummary(staffSync);
  };

  // Load documents (학제별 격리)
  const loadDocs = async () => {
    setIsLoading(true);
    try {
      const docs = await getDocuments(academyId, currentEducationLevel);
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
  }, [academyId, buses, currentEducationLevel]);


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
        educationLevel: currentEducationLevel,
        title: uploadTitle.trim(),
        category: categoryLabel,
        file: uploadFile,
        note: uploadNote.trim(),
        uploadedBy: currentUser?.name ? `${currentUser.name} 관리자` : '관리자',
      });

      // Reset modal form
      setUploadFile(null);
      setUploadTitle('');
      setUploadCategory('registry');
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
  // Document Preview Handlers
  // --------------------------------------------------------------------------
  const handleOpenPreview = async (doc) => {
    if (!doc || !doc.fileBlob) {
      alert('미리보기할 파일 데이터를 찾을 수 없습니다.');
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    const ext = doc.fileName?.split('.').pop()?.toLowerCase() || '';
    const mime = doc.fileType?.toLowerCase() || '';

    if (ext === 'pdf' || mime.includes('pdf')) {
      const blob = doc.fileBlob.type === 'application/pdf'
        ? doc.fileBlob
        : new Blob([doc.fileBlob], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewType('pdf');
      setPreviewText('');
      setPreviewDoc(doc);
    } else if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext) || mime.startsWith('image/')) {
      const url = URL.createObjectURL(doc.fileBlob);
      setPreviewUrl(url);
      setPreviewType('image');
      setPreviewText('');
      setPreviewDoc(doc);
    } else if (['txt', 'csv', 'json', 'md', 'log'].includes(ext) || mime.startsWith('text/')) {
      try {
        const text = await doc.fileBlob.text();
        setPreviewText(text);
        setPreviewType('text');
        setPreviewUrl('');
        setPreviewDoc(doc);
      } catch (e) {
        setPreviewType('unsupported');
        setPreviewUrl('');
        setPreviewDoc(doc);
      }
    } else {
      setPreviewType('unsupported');
      setPreviewUrl('');
      setPreviewText('');
      setPreviewDoc(doc);
    }
  };

  const handleClosePreview = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl('');
    setPreviewText('');
    setPreviewDoc(null);
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
      }, currentEducationLevel);
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
  const activeStudent = (selectedStudentId && selectedStudentId !== 'none')
    ? (availableStudents.find(s => String(s.id) === String(selectedStudentId)) || null)
    : null;

  // Generate and download default template as PDF with DB information
  const handleDownloadTemplate = (type) => {
    openPrintDocument(type, {
      academyName,
      date: new Date().toISOString().split('T')[0],
      selectedBus: activeBus,
      busStudents: type === 'health-allergy' ? students : (activeBus ? activeBusStudents : students),
      selectedStudent: activeStudent,
    });
  };

  // Filtered documents
  const filteredDocs = documents.filter((doc) => {
    const cat = doc.category || '';
    const matchCategory =
      selectedCategory === 'all' ||
      (selectedCategory === 'registry' && (cat.includes('학원') || cat.includes('설립') || cat.includes('등록') || cat.includes('인가'))) ||
      (selectedCategory === 'shuttle_consent' && (cat.includes('차량이용') || cat.includes('탑승신청') || (cat.includes('동의') && !cat.includes('개인정보') && !cat.includes('위치')))) ||
      (selectedCategory === 'privacy' && cat.includes('개인정보')) ||
      (selectedCategory === 'driver_location' && (cat.includes('위치정보') || cat.includes('기사') && cat.includes('위치'))) ||
      (selectedCategory === 'accounting' && (cat.includes('회계') || cat.includes('지출') || cat.includes('정산') || cat.includes('유류비') || cat.includes('영수증'))) ||
      (selectedCategory === 'report' && (cat.includes('신고') || cat.includes('보험') || cat.includes('필증') || cat.includes('검사') || cat.includes('차량'))) ||
      (selectedCategory === 'safety' && (cat.includes('안전') || cat.includes('점검') || cat.includes('일지') || cat.includes('동승'))) ||
      (selectedCategory === 'etc' && (cat.includes('기타') || (!cat.includes('학원') && !cat.includes('설립') && !cat.includes('등록') && !cat.includes('차량이용') && !cat.includes('개인정보') && !cat.includes('위치') && !cat.includes('회계') && !cat.includes('신고') && !cat.includes('보험') && !cat.includes('안전') && !cat.includes('동승') && !cat.includes('동의'))));

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

  const renderTemplateCard = ({ id, title, subtitle, tag, theme = 'blue', colSpan2 = false }) => {
    const themeStyles = {
      blue: {
        borderLeft: 'border-l-blue-500 hover:border-blue-400',
        tagBg: 'bg-blue-50 text-blue-700 border-blue-200',
        btn: 'text-blue-700 hover:text-white bg-blue-50 hover:bg-blue-600 border-blue-200 hover:border-blue-600',
      },
      emerald: {
        borderLeft: 'border-l-emerald-500 hover:border-emerald-400',
        tagBg: 'bg-emerald-50 text-emerald-800 border-emerald-200',
        btn: 'text-emerald-700 hover:text-white bg-emerald-50 hover:bg-emerald-600 border-emerald-200 hover:border-emerald-600',
      },
      indigo: {
        borderLeft: 'border-l-indigo-500 hover:border-indigo-400',
        tagBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        btn: 'text-indigo-700 hover:text-white bg-indigo-50 hover:bg-indigo-600 border-indigo-200 hover:border-indigo-600',
      },
      rose: {
        borderLeft: 'border-l-rose-500 hover:border-rose-400',
        tagBg: 'bg-rose-50 text-rose-700 border-rose-200',
        btn: 'text-rose-700 hover:text-white bg-rose-50 hover:bg-rose-600 border-rose-200 hover:border-rose-600',
      },
    }[theme];

    return (
      <div
        key={id}
        className={`bg-white border border-slate-200/90 border-l-[6px] ${themeStyles.borderLeft} rounded-2xl p-4 flex items-center justify-between gap-3 transition-all shadow-xs hover:shadow-md ${
          colSpan2 ? 'xl:col-span-2' : ''
        }`}
      >
        <div className="flex-1 min-w-0 pr-1 flex flex-col justify-center">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[14px] font-extrabold text-slate-900 tracking-tight leading-snug">
              {title}
            </span>
            {tag && (
              <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${themeStyles.tagBg}`}>
                {tag}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 font-medium leading-relaxed line-clamp-2">
            {subtitle}
          </p>
        </div>
        <button
          onClick={() => handleDownloadTemplate(id)}
          className={`inline-flex items-center gap-1.5 text-xs font-bold border px-3 py-2 rounded-xl transition-all shadow-2xs hover:shadow-xs shrink-0 ml-auto cursor-pointer active:scale-95 whitespace-nowrap ${themeStyles.btn}`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
          </svg>
          <span>서식 출력</span>
        </button>
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
      <div className="bg-white border-b border-slate-200 px-8 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">서류 관리</h1>
          {expirySummary.urgentCount > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-red-50 text-red-600 border border-red-200 text-xs font-bold px-3 py-1 rounded-full shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
              만료 임박 {expirySummary.urgentCount}건
            </span>
          )}
        </div>

        <button
          onClick={() => {
            setUploadFile(null);
            setUploadTitle('');
            setUploadNote('');
            setShowUploadModal(true);
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-all shadow-xs hover:shadow-sm cursor-pointer active:scale-95"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          새 서류 등록
        </button>
      </div>

      {/* Sub Navigation Tabs (Pill / Segmented Style for Higher Readability) */}
      <div className="bg-white border-b border-slate-200 px-8 py-2.5 flex items-center justify-between">
        <div className="inline-flex p-1 bg-slate-100 rounded-xl gap-1">
          <button
            onClick={() => setActiveSubTab('templates')}
            className={`py-2 px-4 text-xs font-extrabold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'templates'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>서식 출력</span>
          </button>
          <button
            onClick={() => setActiveSubTab('expiry')}
            className={`py-2 px-4 text-xs font-extrabold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'expiry'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>만료일 현황</span>
            {expirySummary.urgentCount > 0 && (
              <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-black">
                {expirySummary.urgentCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSubTab('documents')}
            className={`py-2 px-4 text-xs font-extrabold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'documents'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
            <span>보관 서류</span>
            <span className="bg-slate-200/80 text-slate-700 text-[10px] px-1.5 py-0.2 rounded-full font-bold">
              {documents.length}
            </span>
          </button>
          <button
            onClick={() => setActiveSubTab('attendance')}
            className={`py-2 px-4 text-xs font-extrabold rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'attendance'
                ? 'bg-white text-blue-600 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            <span>원아 출결서류</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">


        {/* TAB 2: Expiry Dashboard Section (가독성 대폭 강화된 대시보드 테이블) */}
        {activeSubTab === 'expiry' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-xs space-y-6 animate-in fade-in">
            {/* 상단 타이틀 & 알림 관리 헤더 */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
              <div>
                <h2 className="text-xl font-extrabold text-slate-800 tracking-tight flex items-center gap-2.5">
                  <span className="w-2.5 h-6 bg-blue-600 rounded-full inline-block"></span>
                  호차별 서류 및 안전교육 만료일 현황
                </h2>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowStaffNotiModal(true)}
                  className="text-xs font-bold px-3.5 py-2 rounded-xl border border-purple-200 bg-purple-50 hover:bg-purple-100 text-purple-700 transition-all flex items-center gap-2 shadow-2xs cursor-pointer"
                >
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  <span>기사·교사 앱 푸시알림</span>
                  <span className="bg-purple-600 text-white text-[11px] font-extrabold px-1.5 py-0.5 rounded-full">
                    {staffNotiSummary.allCount}
                  </span>
                </button>
              </div>
            </div>

            {/* 1. 상단 핵심 통계 카드 4종 (클릭 시 자동 필터링 지원) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              <button
                onClick={() => setExpiryFilterTab('all')}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  expiryFilterTab === 'all'
                    ? 'bg-blue-600 border-blue-600 text-white shadow-sm ring-2 ring-blue-500/20'
                    : 'bg-blue-50/50 hover:bg-blue-100/70 border-blue-200 text-blue-950'
                }`}
              >
                <div className={`text-xs font-bold ${expiryFilterTab === 'all' ? 'text-blue-100' : 'text-blue-600'}`}>
                  전체 관리 차량
                </div>
                <div className="text-2xl font-black mt-1">
                  {buses.length}<span className="text-sm font-semibold ml-1">대</span>
                </div>
                <div className={`text-[11px] mt-1 font-medium ${expiryFilterTab === 'all' ? 'text-blue-100' : 'text-blue-600/80'}`}>
                  호차별 서류 통합 관리
                </div>
              </button>

              <button
                onClick={() => setExpiryFilterTab('urgent')}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  expiryFilterTab === 'urgent'
                    ? 'bg-rose-600 border-rose-600 text-white shadow-sm ring-2 ring-rose-500/20'
                    : 'bg-rose-50/60 hover:bg-rose-100/80 border-rose-200 text-rose-900'
                }`}
              >
                <div className={`text-xs font-bold flex items-center justify-between ${expiryFilterTab === 'urgent' ? 'text-rose-100' : 'text-rose-600'}`}>
                  <span>🚨 만료 임박 / 만료</span>
                  <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-rose-200/50 rounded">30일 이내</span>
                </div>
                <div className="text-2xl font-black mt-1">
                  {expirySummary.urgentCount}<span className="text-sm font-semibold ml-1">건</span>
                </div>
                <div className={`text-[11px] mt-1 font-medium ${expiryFilterTab === 'urgent' ? 'text-rose-100' : 'text-rose-600'}`}>
                  즉시 갱신 조치 요망
                </div>
              </button>

              <button
                onClick={() => setExpiryFilterTab('warning')}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  expiryFilterTab === 'warning'
                    ? 'bg-amber-500 border-amber-500 text-white shadow-sm ring-2 ring-amber-500/20'
                    : 'bg-amber-50/60 hover:bg-amber-100/80 border-amber-200 text-amber-900'
                }`}
              >
                <div className={`text-xs font-bold flex items-center justify-between ${expiryFilterTab === 'warning' ? 'text-amber-100' : 'text-amber-600'}`}>
                  <span>⚠️ 갱신 주의</span>
                  <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-amber-200/50 rounded">60일 이내</span>
                </div>
                <div className="text-2xl font-black mt-1">
                  {expirySummary.warningCount}<span className="text-sm font-semibold ml-1">건</span>
                </div>
                <div className={`text-[11px] mt-1 font-medium ${expiryFilterTab === 'warning' ? 'text-amber-100' : 'text-amber-600'}`}>
                  일정 사전 확인 권장
                </div>
              </button>

              <button
                onClick={() => setExpiryFilterTab('safe')}
                className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                  expiryFilterTab === 'safe'
                    ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/20'
                    : 'bg-emerald-50/60 hover:bg-emerald-100/80 border-emerald-200 text-emerald-900'
                }`}
              >
                <div className={`text-xs font-bold flex items-center justify-between ${expiryFilterTab === 'safe' ? 'text-emerald-100' : 'text-emerald-600'}`}>
                  <span>✅ 유효 정상</span>
                  <span className="text-[10px] font-extrabold px-1.5 py-0.2 bg-emerald-200/50 rounded">안전</span>
                </div>
                <div className="text-2xl font-black mt-1">
                  {expirySummary.safeCount}<span className="text-sm font-semibold ml-1">건</span>
                </div>
                <div className={`text-[11px] mt-1 font-medium ${expiryFilterTab === 'safe' ? 'text-emerald-100' : 'text-emerald-600'}`}>
                  모든 서류 유효함
                </div>
              </button>
            </div>

            {/* 2. 대형 고가독성 만료일 테이블 */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200/90 shadow-xs bg-white">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-700 text-xs font-black tracking-tight">
                    <th className="py-4 px-5 w-48">차량(호차)</th>
                    <th className="py-4 px-5">종합보험 만료일</th>
                    <th className="py-4 px-5">정기검사 만료일</th>
                    <th className="py-4 px-5 bg-blue-50/40">운전기사 안전교육</th>
                    <th className="py-4 px-5 bg-purple-50/40">동승교사 안전교육</th>
                    <th className="py-4 px-5 text-center w-28">만료일 변경</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {buses
                    .filter((bus) => {
                      if (selectedBusId !== 'all' && String(bus.id) !== String(selectedBusId)) return false;
                      if (expiryFilterTab === 'all') return true;
                      const rec = expiryRecords[String(bus.id)] || {};
                      const ddays = [
                        calculateDday(rec.insuranceExpiry),
                        calculateDday(rec.inspectionExpiry),
                        calculateDday(rec.driverEduExpiry),
                        calculateDday(rec.companionEduExpiry),
                      ];
                      if (expiryFilterTab === 'urgent') return ddays.some((d) => d.status === 'expired' || d.status === 'urgent');
                      if (expiryFilterTab === 'warning') return ddays.some((d) => d.status === 'warning');
                      if (expiryFilterTab === 'safe') return ddays.every((d) => d.status === 'safe');
                      return true;
                    })
                    .map((bus) => {
                      const rec = expiryRecords[String(bus.id)] || {};
                      const insuranceD = calculateDday(rec.insuranceExpiry);
                      const inspectionD = calculateDday(rec.inspectionExpiry);
                      const driverEduD = calculateDday(rec.driverEduExpiry);
                      const companionEduD = calculateDday(rec.companionEduExpiry);

                      return (
                        <tr key={bus.id} className="hover:bg-blue-50/30 transition-colors">
                          {/* 차량 호차 정보 */}
                          <td className="py-4.5 px-5 font-bold">
                            <div className="flex items-center gap-2.5">
                              <span 
                                className="w-3.5 h-3.5 rounded-full shrink-0 shadow-2xs border border-white" 
                                style={{ backgroundColor: bus.color || '#3b82f6' }} 
                              />
                              <span className="text-base font-black text-slate-900 tracking-tight">{bus.name || bus.busNumber}</span>
                            </div>
                            <div className="text-xs font-bold text-slate-500 pl-6 mt-1 tracking-tight">
                              {bus.plateNumber || '차량번호 미등록'}
                            </div>
                          </td>

                          {/* 종합보험 */}
                          <td className="py-4.5 px-5">
                            <div className="text-[13px] font-black text-slate-900 mb-1.5 tracking-tight">
                              {rec.insuranceExpiry || <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">미등록</span>}
                            </div>
                            <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-lg border shadow-2xs ${insuranceD.bg} ${insuranceD.color} ${insuranceD.border}`}>
                              {insuranceD.label}
                            </span>
                          </td>

                          {/* 정기검사 */}
                          <td className="py-4.5 px-5">
                            <div className="text-[13px] font-black text-slate-900 mb-1.5 tracking-tight">
                              {rec.inspectionExpiry || <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">미등록</span>}
                            </div>
                            <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-lg border shadow-2xs ${inspectionD.bg} ${inspectionD.color} ${inspectionD.border}`}>
                              {inspectionD.label}
                            </span>
                          </td>

                          {/* 운전기사 안전교육 */}
                          <td className="py-4.5 px-5 bg-blue-50/20">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200">
                                기사
                              </span>
                              <span className="text-xs font-black text-slate-800">
                                {bus.driverName || <span className="text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">미지정</span>}
                              </span>
                            </div>
                            <div className="text-[13px] font-black text-slate-900 mb-1.5 tracking-tight">
                              {rec.driverEduExpiry || <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">만료일 미등록</span>}
                            </div>
                            <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-lg border shadow-2xs ${driverEduD.bg} ${driverEduD.color} ${driverEduD.border}`}>
                              {driverEduD.label}
                            </span>
                          </td>

                          {/* 동승교사(차량선생님) 안전교육 */}
                          <td className="py-4.5 px-5 bg-purple-50/20">
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                                동승교사
                              </span>
                              <span className="text-xs font-black text-slate-800">
                                {bus.teacherName || <span className="text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">미지정</span>}
                              </span>
                            </div>
                            <div className="text-[13px] font-black text-slate-900 mb-1.5 tracking-tight">
                              {rec.companionEduExpiry || <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">만료일 미등록</span>}
                            </div>
                            <span className={`inline-block text-[11px] font-black px-2.5 py-1 rounded-lg border shadow-2xs ${companionEduD.bg} ${companionEduD.color} ${companionEduD.border}`}>
                              {companionEduD.label}
                            </span>
                          </td>

                          {/* 설정 버튼 */}
                          <td className="py-4.5 px-5 text-center">
                            <button
                              onClick={() => handleOpenExpiryModal(bus)}
                              className="text-xs font-extrabold text-blue-700 hover:text-white bg-blue-50 hover:bg-blue-600 border border-blue-200 hover:border-blue-600 px-3.5 py-2 rounded-xl transition-all shadow-2xs hover:shadow-xs cursor-pointer inline-flex items-center gap-1.5 active:scale-95"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                              <span>설정</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            {/* 하단 도움말 배너 */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-wrap items-center justify-between text-xs text-slate-600 gap-2">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                <span><b>도로교통법 제53조의3</b>: 어린이통학버스 운영자 및 운전자, 동승보호자는 <b>2년마다 안전교육을 정기 이수</b>해야 합니다.</span>
              </div>
              <div className="text-slate-400 font-medium">
                * 만료 30일 전부터 기사 및 교사 앱으로 자동 알림 발송
              </div>
            </div>
          </div>
        )}

        {/* TAB 1: Legal Templates (서식 출력 탭) */}
        {activeSubTab === 'templates' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Control Bar: Bus & Student Selection (Higher Readability Card) */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-5">
              {/* Left: Selectors */}
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-xs font-extrabold text-slate-700 whitespace-nowrap flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                    차량(호차)
                  </span>
                  <select
                    value={selectedBusId}
                    onChange={(e) => {
                      setSelectedBusId(e.target.value);
                      setSelectedStudentId('none');
                    }}
                    className="text-xs font-bold text-slate-800 bg-slate-50 hover:bg-slate-100/80 border border-slate-300 rounded-xl px-3.5 py-2 outline-none cursor-pointer focus:border-blue-500 focus:bg-white shadow-2xs transition-all min-w-[190px]"
                  >
                    <option value="all">전체 (공통 기본 양식)</option>
                    {buses.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.busNumber} {b.plateNumber ? `(${b.plateNumber})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <span className="text-xs font-extrabold text-slate-700 whitespace-nowrap flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                    대상 원아
                  </span>
                  <select
                    value={selectedStudentId}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    className="text-xs font-bold text-slate-800 bg-slate-50 hover:bg-slate-100/80 border border-slate-300 rounded-xl px-3.5 py-2 outline-none cursor-pointer focus:border-blue-500 focus:bg-white shadow-2xs transition-all min-w-[210px]"
                  >
                    <option value="none">선택 안 함 (원아 정보 공란 / 수기 서식)</option>
                    {availableStudents.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.name} ({st.className || st.raw?.['반명'] || st.raw?.['연령'] || '원아'})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Right: Selected Summary Badges */}
              <div className="flex flex-wrap items-center gap-2 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100 text-xs">
                {activeBus ? (
                  <>
                    <span className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/80 font-bold text-slate-700 shadow-2xs">
                      차량: <strong className="text-blue-700 font-extrabold">{activeBus.plateNumber || '미등록'}</strong>
                    </span>
                    <span className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/80 font-bold text-slate-700 shadow-2xs">
                      기사: <strong className="text-slate-900 font-extrabold">{activeBus.driverName || '미지정'}</strong>
                    </span>
                    <span className="bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200/80 font-bold text-slate-700 shadow-2xs">
                      선생님: <strong className="text-slate-900 font-extrabold">{activeBus.teacherName || '미지정'}</strong>
                    </span>
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded-xl font-black shadow-2xs">
                      배정 원아 {activeBusStudents.length}명
                    </span>
                  </>
                ) : (
                  <span className="bg-slate-50 text-slate-600 px-3 py-1.5 rounded-xl border border-slate-200 font-semibold shadow-2xs">
                    공통 서식 모드 (특정 차량 미선택)
                  </span>
                )}
                {activeStudent ? (
                  <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 px-3 py-1.5 rounded-xl font-black shadow-2xs flex items-center gap-1">
                    <span>✨ 자동완성:</span>
                    <strong>{activeStudent.name}</strong>
                    <span className="text-[11px] font-bold text-emerald-600">({activeStudent.className || activeStudent.raw?.['반명'] || '원아'})</span>
                  </span>
                ) : (
                  <span className="bg-slate-100/90 text-slate-600 px-3 py-1.5 rounded-xl border border-slate-200 font-bold shadow-2xs">
                    원아 정보: 공란 발급
                  </span>
                )}
              </div>
            </div>

            {/* Template Groups (Modern, High-Readability Card Grid) */}
            <div className="space-y-7">
              {/* Group 1: 차량 및 안전운행 서식 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-6 bg-blue-600 rounded-full inline-block"></span>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">차량 및 안전운행 서식</h3>
                  <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                    차량 안전 5종
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderTemplateCard({
                    id: 'safety',
                    title: `일일 안전점검표 ${activeBus ? `(${activeBus.name})` : ''}`,
                    subtitle: '운행 전 제동·조향·등화·소화기·안전벨트 일일 안전 점검 및 서명 기록',
                    tag: '법정의무',
                    theme: 'blue',
                  })}
                  {renderTemplateCard({
                    id: 'companion',
                    title: '동승보호자 탑승일지 및 승하차 명부',
                    subtitle: '승하차 인원, 안전벨트 착용 확인 및 운행 후 잔류 원아 최종 확인',
                    tag: '동승교사',
                    theme: 'blue',
                  })}
                  {renderTemplateCard({
                    id: 'emergency',
                    title: '통학차량 탑승 원아 비상연락망',
                    subtitle: '호차 탑승 원아 및 학부모 2인 비상연락처·승하차 정류장 위치 종합부',
                    tag: '보호자 2인',
                    theme: 'blue',
                  })}
                  {renderTemplateCard({
                    id: 'timetable',
                    title: '호차별 운행 노선표 및 시간표',
                    subtitle: '정류장별 등·하원 예정시간 및 탑승 원아 상세 명부',
                    tag: '노선시간표',
                    theme: 'blue',
                  })}
                  {renderTemplateCard({
                    id: 'attendance-log',
                    title: `교직원 및 셔틀 운행인력 근태표 (월간 출근부) ${activeBus ? `(${activeBus.name})` : ''}`,
                    subtitle: activeBus ? `[${activeBus.name}] 기사 및 차량선생님 출퇴근 시간 및 법정 근무기록부` : '교사, 기사, 차량선생님 출퇴근 시간 및 주휴수당·연장근로 산정용 표준 월간 출근부',
                    tag: '노무·출근부',
                    theme: 'indigo',
                    colSpan2: true,
                  })}
                </div>
              </div>

              {/* Group 2: 원아 및 학부모 동의서 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-6 bg-emerald-600 rounded-full inline-block"></span>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">원아 및 학부모 동의 서식</h3>
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    학부모 동의 3종
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderTemplateCard({
                    id: 'consent',
                    title: '통학차량 이용 신청 및 안전동의서',
                    subtitle: '탑승 신청, 승하차 지점 확인 및 차량 내 안전수칙 준수 학부모 동의',
                    tag: '신청·동의',
                    theme: 'emerald',
                  })}
                  {renderTemplateCard({
                    id: 'handover',
                    title: '영유아 귀가 및 응급처치 동의서',
                    subtitle: '하원 인계자(보호자 대리인) 지정 및 위급 시 응급의료 위탁 동의',
                    tag: '귀가인계',
                    theme: 'emerald',
                  })}
                  {renderTemplateCard({
                    id: 'consent-privacy-student',
                    title: '개인정보 수집·이용 동의서 (원생·학부모용)',
                    subtitle: '통학 안전 문자 및 실시간 승하차 알림 제공을 위한 필수 정보 수집 동의',
                    tag: '개인정보',
                    theme: 'emerald',
                    colSpan2: true,
                  })}
                </div>
              </div>

              {/* Group 3: 종사자 및 회계 관리 서식 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-6 bg-indigo-600 rounded-full inline-block"></span>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">종사자 및 회계 관리 서식</h3>
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                    운영·행정 3종
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderTemplateCard({
                    id: 'consent-driver-location',
                    title: '운전자 위치정보 수집·이용 동의서',
                    subtitle: '실시간 통학차량 위치관제 및 학부모 안심 알림 제공을 위한 위치수집 동의',
                    tag: '위치관제',
                    theme: 'indigo',
                  })}
                  {renderTemplateCard({
                    id: 'consent-privacy-staff',
                    title: '통학차량 종사자 개인정보 동의서 (기사·교사용)',
                    subtitle: '인사·운행 배정 및 안전교육 이수증 등록을 위한 교직원 개인정보 동의',
                    tag: '종사자인사',
                    theme: 'indigo',
                  })}
                  {renderTemplateCard({
                    id: 'accounting-expense-report',
                    title: '통학차량 운영비 및 정산서',
                    subtitle: '유류비, 고속도로 통행료, 차량 정비 및 세차비 등 월간 지출 정산서',
                    tag: '회계정산',
                    theme: 'indigo',
                    colSpan2: true,
                  })}
                </div>
              </div>

              {/* Group 4: 안전 관리 및 대응 자료 */}
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="w-2.5 h-6 bg-rose-600 rounded-full inline-block"></span>
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">안전 관리 및 대응 자료</h3>
                  <span className="text-xs font-bold text-rose-700 bg-rose-50 px-2.5 py-0.5 rounded-full border border-rose-200">
                    안전·보건 4종
                  </span>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {renderTemplateCard({
                    id: 'health-allergy',
                    title: '원아 건강·알레르기 및 기저질환 명부',
                    subtitle: '식품·약품 알레르기, 기저질환, 상비약 및 응급 대처 요령 기록부',
                    tag: '응급보건',
                    theme: 'rose',
                  })}
                  {renderTemplateCard({
                    id: 'safety-manual',
                    title: '통학버스 안전운행 표준 매뉴얼',
                    subtitle: '출발 전 안전점검, 사각지대 승하차 지도, 잔류원아 확인 필수 행동 수칙',
                    tag: '기사·교사',
                    theme: 'rose',
                  })}
                  {renderTemplateCard({
                    id: 'safety-education',
                    title: '원아 교통안전 교육 및 가정통신문',
                    subtitle: '원아 통학버스 3대 안전 약속 및 가정 내 통학 안전 지도 협조 안내문',
                    tag: '가정통신문',
                    theme: 'rose',
                  })}
                  {renderTemplateCard({
                    id: 'emergency-protocol',
                    title: '비상사고 및 응급상황 위기대응 지침',
                    subtitle: '교통사고 4단계 대응 매뉴얼, 영유아 심폐소생술(CPR) 및 하임리히법 지침',
                    tag: '응급지침',
                    theme: 'rose',
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Registered Documents Vault Section */}
        {activeSubTab === 'documents' && (
          <div className="space-y-6 animate-in fade-in">
            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
              {/* Categories */}
              <div className="flex items-center gap-1 overflow-x-auto">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      selectedCategory === cat.id
                        ? 'bg-blue-600 text-white shadow-2xs'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Search Input */}
              <div className="relative min-w-[220px]">
                <input
                  type="text"
                  placeholder="서류명, 파일명 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-all"
                />
                <svg
                  className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>

            {/* Slim Upload Zone */}
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (fileInputRef.current) fileInputRef.current.click();
              }}
              className={`border border-dashed rounded-xl p-3 text-center cursor-pointer transition-all flex items-center justify-center gap-3 ${
                isDragging
                  ? 'border-blue-500 bg-blue-50/70'
                  : 'border-slate-300 hover:border-blue-400 bg-white/70 hover:bg-blue-50/20'
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
              <svg className="w-5 h-5 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <span className="text-xs text-slate-600 font-medium">
                서류 파일을 끌어다 놓거나 <span className="text-blue-600 font-semibold underline">직접 파일 선택</span> (PDF, HWP, 엑셀, 이미지 등)
              </span>
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
                    <div
                      onClick={() => handleOpenPreview(doc)}
                      className="flex items-center gap-3 min-w-0 cursor-pointer group/title"
                      title="클릭하여 서류 미리보기"
                    >
                      {getFileIcon(doc.fileName)}
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md inline-block mb-1">
                          {doc.category}
                        </span>
                        <h3 className="font-bold text-sm text-slate-800 group-hover/title:text-blue-600 transition-colors leading-snug break-all" title={doc.title}>
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

                {/* Preview & Download Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleOpenPreview(doc)}
                    className="flex items-center justify-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 rounded-xl transition-all shadow-xs active:scale-[0.98]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    미리보기
                  </button>
                  <button
                    onClick={() => downloadDocument(doc)}
                    className="flex items-center justify-center gap-1.5 bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white font-bold text-xs py-2.5 rounded-xl transition-all shadow-xs active:scale-[0.98]"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    다운로드
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
          </div>
        )}

        {/* TAB 4: Student Attendance & Location Document Section (원아 출결서류) */}
        {activeSubTab === 'attendance' && (() => {
          // 1. Map attendances by studentId
          const attMap = new Map();
          attendances.forEach(a => {
            if (a.studentId) attMap.set(Number(a.studentId), a);
          });

          // 2. Filter students by search and class
          const filteredStudents = students.filter(st => {
            const stName = st.name || '';
            const stClass = st.className || st.raw?.['반명'] || st.raw?.['반'] || '기본반';
            if (attendanceClassFilter !== 'ALL' && stClass !== attendanceClassFilter) return false;
            if (attendanceSearchKeyword.trim()) {
              const q = attendanceSearchKeyword.trim().toLowerCase();
              return stName.toLowerCase().includes(q) || stClass.toLowerCase().includes(q) || (st.boardingLocation || '').toLowerCase().includes(q);
            }
            return true;
          });

          // 3. Extract unique classes
          const allClasses = [...new Set(students.map(s => s.className || s.raw?.['반명'] || s.raw?.['반'] || '기본반'))].filter(Boolean);
          const activeClasses = [...new Set(filteredStudents.map(s => s.className || s.raw?.['반명'] || s.raw?.['반'] || '기본반'))].filter(Boolean);

          // 4. Calculate overall stats
          let totalBoarded = 0;
          let totalDropped = 0;
          let totalAttended = 0;
          let totalAbsent = 0;

          students.forEach(st => {
            const isBoarded = st.boardStatus === 'BOARDED' || st.boardStatus === 'DROPPED';
            const isDropped = st.boardStatus === 'DROPPED';
            const att = attMap.get(st.id);
            const isAttended = att?.status === 'PRESENT' || st.raw?.attendanceStatus === 'PRESENT';
            const isAbs = att?.status === 'ABSENT' || st.boardStatus === 'ABSENT';

            if (isBoarded) totalBoarded++;
            if (isDropped) totalDropped++;
            if (isAttended) totalAttended++;
            if (isAbs) totalAbsent++;
          });

          // Helper to get location estimation
          const getEstimatedLocation = (st, att) => {
            const isAttended = att?.status === 'PRESENT' || st.raw?.attendanceStatus === 'PRESENT';
            const isAbs = att?.status === 'ABSENT' || st.boardStatus === 'ABSENT';
            const isBoarded = st.boardStatus === 'BOARDED';
            const isDropped = st.boardStatus === 'DROPPED';
            const isSelfPickup = Boolean(st.isNotRiding || st.boardStatus === 'SELF_PICKUP');

            if (isAbs) {
              return { label: '결석 (가정 요양)', color: 'bg-rose-50 text-rose-700 border-rose-200' };
            }
            if (isAttended) {
              return { label: '원내 출석 (교실 활동)', color: 'bg-emerald-50 text-emerald-800 border-emerald-300' };
            }
            if (isDropped) {
              return { label: '원 도착 완료 (입실 중)', color: 'bg-cyan-50 text-cyan-800 border-cyan-300' };
            }
            if (isBoarded) {
              return { label: '셔틀 이동 중 (차량 탑승)', color: 'bg-indigo-50 text-indigo-800 border-indigo-300 animate-pulse' };
            }
            if (isSelfPickup) {
              return { label: '보호자 직접 등하원', color: 'bg-purple-50 text-purple-800 border-purple-200' };
            }
            return { label: '등원 대기 (탑승지 대기)', color: 'bg-amber-50 text-amber-800 border-amber-300' };
          };

          return (
            <div className="space-y-6 animate-in fade-in">
              {/* Header Card */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                <div>
                  <h2 className="text-xl font-extrabold text-slate-800 tracking-tight flex items-center gap-2.5">
                    <span className="w-2.5 h-6 bg-blue-600 rounded-full inline-block"></span>
                    원아 실시간 출결 및 위치 현황표
                  </h2>
                  <p className="text-xs text-slate-500 mt-1 font-medium">
                    차량교사의 셔틀 [탑승] 및 [하차] 기록과 담임교사의 [출석] 확인 결과를 통합하여 원아의 현재 위치를 실시간 예상합니다.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {/* 날짜 선택 */}
                  <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs">
                    <span className="font-extrabold text-slate-600">기준 일자</span>
                    <input
                      type="date"
                      value={attendanceDate}
                      onChange={(e) => setAttendanceDate(e.target.value)}
                      className="bg-white px-2 py-1 rounded-lg border border-slate-200 font-bold text-slate-800 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setAttendanceDate(new Date().toISOString().split('T')[0])}
                      className="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      오늘
                    </button>
                  </div>

                  {/* 새로고침 */}
                  <button
                    type="button"
                    onClick={() => loadAttendance(attendanceDate)}
                    disabled={isLoadingAttendance}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <span>{isLoadingAttendance ? '동기화 중...' : '새로고침'}</span>
                  </button>

                  {/* 인쇄 */}
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    <span>서류 출력</span>
                  </button>
                </div>
              </div>

              {/* 통계 요약 카드 5종 */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[11px] font-bold text-slate-500">전체 원아</div>
                  <div className="text-xl font-black text-slate-900 mt-1">{students.length}명</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>차량 탑승 완료</span>
                  </div>
                  <div className="text-xl font-black text-emerald-700 mt-1">{totalBoarded}명</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[11px] font-bold text-cyan-600 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
                    <span>차량 하차 완료</span>
                  </div>
                  <div className="text-xl font-black text-cyan-700 mt-1">{totalDropped}명</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[11px] font-bold text-teal-600 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                    <span>원내 출석 완료</span>
                  </div>
                  <div className="text-xl font-black text-teal-700 mt-1">{totalAttended}명</div>
                </div>
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
                  <div className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <span>결석 / 미등원</span>
                  </div>
                  <div className="text-xl font-black text-rose-700 mt-1">{totalAbsent}명</div>
                </div>
              </div>

              {/* 검색 및 필터 바 */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">반별 필터:</span>
                  <select
                    value={attendanceClassFilter}
                    onChange={(e) => setAttendanceClassFilter(e.target.value)}
                    className="text-xs font-bold bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 outline-none cursor-pointer focus:border-blue-500"
                  >
                    <option value="ALL">전체 반 보기 ({allClasses.length}개 반)</option>
                    {allClasses.map(cls => (
                      <option key={cls} value={cls}>{cls}</option>
                    ))}
                  </select>
                </div>

                <div className="relative min-w-[220px]">
                  <input
                    type="text"
                    placeholder="원아명, 탑승지 검색..."
                    value={attendanceSearchKeyword}
                    onChange={(e) => setAttendanceSearchKeyword(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 font-semibold"
                  />
                  <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {attendanceSearchKeyword && (
                    <button
                      type="button"
                      onClick={() => setAttendanceSearchKeyword('')}
                      className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              {/* 반별 셀 (Cards Grouped by Class) */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {activeClasses.map((className) => {
                  const classStudents = filteredStudents.filter(s => (s.className || s.raw?.['반명'] || s.raw?.['반'] || '기본반') === className);
                  if (classStudents.length === 0) return null;

                  const classBoarded = classStudents.filter(s => s.boardStatus === 'BOARDED' || s.boardStatus === 'DROPPED').length;
                  const classDropped = classStudents.filter(s => s.boardStatus === 'DROPPED').length;
                  const classAttended = classStudents.filter(s => {
                    const att = attMap.get(s.id);
                    return att?.status === 'PRESENT' || s.raw?.attendanceStatus === 'PRESENT';
                  }).length;

                  return (
                    <div
                      key={className}
                      className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden flex flex-col transition-all hover:shadow-md"
                    >
                      {/* 반 셀 헤더 */}
                      <div className="px-5 py-3.5 bg-gradient-to-r from-slate-50 via-blue-50/30 to-indigo-50/20 border-b border-slate-200 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="w-3 h-3 rounded-full bg-blue-600"></span>
                          <h3 className="font-black text-sm text-slate-900">{className}</h3>
                          <span className="text-[11px] font-bold text-slate-500">총 {classStudents.length}명</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                          <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-md border border-emerald-200">
                            탑승 {classBoarded}/{classStudents.length}
                          </span>
                          <span className="bg-cyan-50 text-cyan-700 px-2 py-0.5 rounded-md border border-cyan-200">
                            하차 {classDropped}/{classStudents.length}
                          </span>
                          <span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-md border border-teal-200">
                            출석 {classAttended}/{classStudents.length}
                          </span>
                        </div>
                      </div>

                      {/* 명단 테이블 (왼쪽부터 탑승, 하차, 출석, 예상위치) */}
                      <div className="overflow-x-auto flex-1">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50/80 text-slate-600 font-extrabold border-b border-slate-100">
                            <tr>
                              <th className="py-2.5 px-3.5 whitespace-nowrap">원아명</th>
                              <th className="py-2.5 px-3 whitespace-nowrap text-center">탑승 (차량)</th>
                              <th className="py-2.5 px-3 whitespace-nowrap text-center">하차 (차량)</th>
                              <th className="py-2.5 px-3 whitespace-nowrap text-center">출석 (담임)</th>
                              <th className="py-2.5 px-3.5 whitespace-nowrap">현재 예상 위치</th>
                              <th className="py-2.5 px-3 whitespace-nowrap">정차지/노선</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 font-medium">
                            {classStudents.map((st) => {
                              const att = attMap.get(st.id);
                              const isBoarded = st.boardStatus === 'BOARDED' || st.boardStatus === 'DROPPED';
                              const isDropped = st.boardStatus === 'DROPPED';
                              const isAttended = att?.status === 'PRESENT' || st.raw?.attendanceStatus === 'PRESENT';
                              const isAbs = att?.status === 'ABSENT' || st.boardStatus === 'ABSENT';
                              const isSelfPickup = Boolean(st.isNotRiding || st.boardStatus === 'SELF_PICKUP');
                              const est = getEstimatedLocation(st, att);

                              return (
                                <tr key={st.id} className="hover:bg-slate-50/60 transition-colors">
                                  {/* 원아명 */}
                                  <td className="py-2.5 px-3.5 font-bold text-slate-800 whitespace-nowrap">
                                    <div className="flex items-center gap-1.5">
                                      <span>{st.name}</span>
                                      {st.gender && (
                                        <span className="text-[10px] text-slate-400">({st.gender})</span>
                                      )}
                                    </div>
                                  </td>

                                  {/* 탑승 (차량교사) */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    {isSelfPickup ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                        직접등원
                                      </span>
                                    ) : isAbs ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-rose-100 text-rose-700 border border-rose-200">
                                        미탑승(결석)
                                      </span>
                                    ) : isBoarded ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-emerald-100 text-emerald-800 border border-emerald-300">
                                        ✓ 탑승완료
                                      </span>
                                    ) : (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                                        탑승대기
                                      </span>
                                    )}
                                  </td>

                                  {/* 하차 (차량교사) */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    {isSelfPickup ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-600 border border-slate-200">
                                        -
                                      </span>
                                    ) : isAbs ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                        -
                                      </span>
                                    ) : isDropped ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-cyan-100 text-cyan-800 border border-cyan-300">
                                        ✓ 하차완료
                                      </span>
                                    ) : isBoarded ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200 animate-pulse">
                                        이동중
                                      </span>
                                    ) : (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                        대기
                                      </span>
                                    )}
                                  </td>

                                  {/* 출석 (담임교사) */}
                                  <td className="py-2.5 px-3 text-center whitespace-nowrap">
                                    {isAttended ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-teal-100 text-teal-800 border border-teal-300">
                                        ✓ 출석완료
                                      </span>
                                    ) : isAbs ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-rose-100 text-rose-700 border border-rose-200">
                                        결석
                                      </span>
                                    ) : att?.status === 'LATE' ? (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-black rounded-md bg-purple-100 text-purple-800 border border-purple-200">
                                        지각
                                      </span>
                                    ) : (
                                      <span className="inline-block px-2 py-0.5 text-[10px] font-bold rounded-md bg-slate-100 text-slate-500 border border-slate-200">
                                        미입력
                                      </span>
                                    )}
                                  </td>

                                  {/* 현재 예상 위치 */}
                                  <td className="py-2.5 px-3.5 whitespace-nowrap">
                                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black border ${est.color}`}>
                                      <span className="w-1.5 h-1.5 rounded-full bg-current"></span>
                                      <span>{est.label}</span>
                                    </span>
                                  </td>

                                  {/* 정차지 / 노선 */}
                                  <td className="py-2.5 px-3 text-slate-500 text-[11px] truncate max-w-[150px]">
                                    {st.boardingLocation || st.address || '미지정'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeClasses.length === 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
                  <p className="text-sm font-bold text-slate-600">검색 조건에 맞는 원아가 없습니다.</p>
                </div>
              )}
            </div>
          );
        })()}
      </div>


      {/* Upload Modal */}
      {showUploadModal && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4">
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
                  <option value="registry">학원·설립등록 (학원설립운영등록증, 사업자등록증, 강사명부 등)</option>
                  <option value="shuttle_consent">차량이용동의서 (통학차량 이용 신청 및 안전수칙 동의서 스캔본)</option>
                  <option value="privacy">개인정보동의서 (원생·학부모 및 교직원 개인정보 수집·이용 동의서)</option>
                  <option value="driver_location">기사 위치정보 (기사 위치정보 수집·이용 동의서 서명 스캔본)</option>
                  <option value="accounting">회계·지출문서 (운영비/유류비 정산서, 영수증, 지출결의서)</option>
                  <option value="report">신고·보험필증 (어린이통학버스 신고필증, 자동차종합보험, 정기검사표)</option>
                  <option value="safety">안전점검·운행일지 (일일 안전점검표, 동승일지, 노선표)</option>
                  <option value="etc">기타 서류 (공문, 위촉장, 일반 증명서 등)</option>
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
        </div>,
        document.body
      )}

      {/* Legal Expiry Edit Modal */}
      {editingBusExpiry && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4">
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
        </div>,
        document.body
      )}

      {/* Staff Notifications Modal (기사 및 교사 앱 알림 발송 현황 모달) */}
      {showStaffNotiModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4"
          onClick={() => setShowStaffNotiModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold">
                  🔔
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-800">
                    기사 및 차량선생님 모바일 앱 만료 알림 발송 현황
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    2달 전 주의(주 1회) · 1달 전 만료임박 · 2주 전 매일 알림 규칙에 따라 앱으로 자동 전송되는 큐입니다.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowStaffNotiModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors text-lg font-bold"
              >
                ✕
              </button>
            </div>

            {/* Filter Tabs */}
            <div className="px-6 py-3 border-b border-slate-100 flex items-center justify-between gap-3 bg-white">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStaffNotiRoleFilter('all')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all ${
                    staffNotiRoleFilter === 'all'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  전체 알림 ({staffNotiSummary.allCount}건)
                </button>
                <button
                  onClick={() => setStaffNotiRoleFilter('driver')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
                    staffNotiRoleFilter === 'driver'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                  }`}
                >
                  기사 앱 대상 ({staffNotiSummary.driverNotifications.length}건)
                </button>
                <button
                  onClick={() => setStaffNotiRoleFilter('teacher')}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
                    staffNotiRoleFilter === 'teacher'
                      ? 'bg-purple-600 text-white shadow-xs'
                      : 'bg-purple-50 text-purple-700 hover:bg-purple-100'
                  }`}
                >
                  교사 앱 대상 ({staffNotiSummary.teacherNotifications.length}건)
                </button>
              </div>

              <div className="text-[11px] text-slate-400 font-medium hidden sm:block">
                실시간 기사·교사 앱 소켓/스토리지 연동 중
              </div>
            </div>

            {/* Notifications List Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-slate-50/50">
              {(() => {
                const list =
                  staffNotiRoleFilter === 'driver'
                    ? staffNotiSummary.driverNotifications
                    : staffNotiRoleFilter === 'teacher'
                    ? staffNotiSummary.teacherNotifications
                    : [...staffNotiSummary.driverNotifications, ...staffNotiSummary.teacherNotifications];

                if (list.length === 0) {
                  return (
                    <div className="text-center py-12 bg-white rounded-2xl border border-slate-200 p-8">
                      <div className="w-12 h-12 mx-auto rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-xl mb-2">
                        ✓
                      </div>
                      <h4 className="text-sm font-bold text-slate-700">현재 발송 대기 중인 만료 알림이 없습니다</h4>
                      <p className="text-xs text-slate-400 mt-1">
                        모든 법정 서류 및 안전교육이 정상(2달 초과 잔여) 상태이거나 서류 만료일이 아직 미도래 상태입니다.
                      </p>
                    </div>
                  );
                }

                return list.map((item) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-xl border bg-white shadow-2xs space-y-2 border-slate-200 hover:border-indigo-300 transition-all"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                            item.targetRole === 'driver'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}
                        >
                          {item.targetRole === 'driver' ? '기사용' : '교사용'}: {item.targetName}
                        </span>
                        <span className="text-xs font-extrabold text-slate-800">
                          {item.busName} ({item.plateNumber})
                        </span>
                        <span className="text-xs font-bold text-slate-500">
                          · {item.itemLabel}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${
                            item.frequency === 'daily'
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {item.frequency === 'daily' ? '매일 발송 (2주 이내)' : '주 1회 발송 (2달~2주)'}
                        </span>
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                            item.daysRemaining < 0
                              ? 'bg-red-600 text-white'
                              : item.daysRemaining <= 14
                              ? 'bg-rose-600 text-white'
                              : item.daysRemaining <= 30
                              ? 'bg-amber-500 text-white'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {item.daysRemaining < 0
                            ? `만료 (+${Math.abs(item.daysRemaining)}일)`
                            : item.daysRemaining === 0
                            ? 'D-Day 오늘 만료'
                            : `D-${item.daysRemaining}`}
                        </span>
                      </div>
                    </div>

                    <div className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-100 font-medium leading-relaxed">
                      💬 <span className="font-semibold">{item.message}</span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                      <span>만료 예정일: <strong>{item.expiryDate}</strong></span>
                      <span>알림 상태: {item.urgencyLabel}</span>
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex flex-col text-left w-full sm:w-auto">
                <span className="text-slate-500 font-medium">
                  * 평일 오전 9:30에 만료 임박(D-14 매일, D-60 주1회) 건이 기사·교사 앱으로 자동 발송됩니다.
                </span>
                {pushStatusMessage && (
                  <span className={`text-xs font-bold mt-1.5 ${pushStatusMessage.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {pushStatusMessage.text}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end">
                <button
                  type="button"
                  onClick={handleSendPushToStaff}
                  disabled={isSendingPush || (!staffNotiSummary.driverNotifications?.length && !staffNotiSummary.teacherNotifications?.length)}
                  className={`px-4 py-2 font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer ${
                    isSendingPush || (!staffNotiSummary.driverNotifications?.length && !staffNotiSummary.teacherNotifications?.length)
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      : 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-200'
                  }`}
                >
                  {isSendingPush ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      발송 중...
                    </>
                  ) : (
                    <>
                      <span>📲</span>
                      <span>기사·교사 앱으로 지금 즉시 푸시 발송</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowStaffNotiModal(false)}
                  className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Document Preview Modal */}
      {previewDoc && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4"
          onClick={handleClosePreview}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full h-[86vh] flex flex-col border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {getFileIcon(previewDoc.fileName)}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">
                      {previewDoc.category}
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {previewDoc.fileName} ({formatFileSize(previewDoc.fileSize)})
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-800 truncate mt-0.5" title={previewDoc.title}>
                    {previewDoc.title}
                  </h3>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(previewType === 'pdf' || previewType === 'image' || previewType === 'text') && (
                  <button
                    onClick={() => previewDocumentInNewTab(previewDoc)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs"
                    title="새 탭에서 크게 열기 및 인쇄"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    새 창으로 열기
                  </button>
                )}
                <button
                  onClick={() => downloadDocument(previewDoc)}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  파일 다운로드
                </button>
                <button
                  onClick={handleClosePreview}
                  className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors text-lg font-bold ml-1"
                  title="닫기"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 bg-slate-100 p-4 overflow-hidden flex items-center justify-center">
              {previewType === 'pdf' && previewUrl && (
                <iframe
                  src={previewUrl}
                  title={previewDoc.title}
                  className="w-full h-full rounded-xl border border-slate-200 bg-white shadow-inner"
                />
              )}

              {previewType === 'image' && previewUrl && (
                <div className="w-full h-full flex items-center justify-center overflow-auto bg-slate-900/5 rounded-xl p-4">
                  <img
                    src={previewUrl}
                    alt={previewDoc.title}
                    className="max-w-full max-h-full object-contain rounded-lg shadow-md bg-white"
                  />
                </div>
              )}

              {previewType === 'text' && (
                <div className="w-full h-full bg-white rounded-xl border border-slate-200 p-5 overflow-auto shadow-inner">
                  <pre className="text-xs font-mono text-slate-800 whitespace-pre-wrap break-all leading-relaxed">
                    {previewText || '(내용이 없는 텍스트 파일입니다.)'}
                  </pre>
                </div>
              )}

              {previewType === 'unsupported' && (
                <div className="bg-white rounded-2xl border border-slate-200 p-10 max-w-md w-full text-center shadow-sm">
                  <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
                    {getFileIcon(previewDoc.fileName)}
                  </div>
                  <h4 className="text-base font-extrabold text-slate-800 mb-1.5">
                    브라우저 직접 미리보기를 지원하지 않는 형식입니다
                  </h4>
                  <p className="text-xs text-slate-500 leading-relaxed mb-5">
                    한글(HWP), 엑셀(XLSX), 워드(DOCX) 등의 전용 문서 파일은 아래 버튼을 눌러 다운로드한 후 전용 프로그램에서 열람해주세요.<br />
                    <span className="text-[11px] text-slate-400">(PDF, JPG/PNG 이미지, TXT/CSV 파일은 즉시 미리보기가 지원됩니다.)</span>
                  </p>
                  <button
                    onClick={() => downloadDocument(previewDoc)}
                    className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    {previewDoc.fileName} 다운로드
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
