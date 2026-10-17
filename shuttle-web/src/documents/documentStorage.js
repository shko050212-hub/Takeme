// IndexedDB storage utility for Takeme Document Management

const DB_NAME = 'TakemeDocumentDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('academyId', 'academyId', { unique: false });
        store.createIndex('uploadedAt', 'uploadedAt', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocument({ academyId, title, category, file, note = '', uploadedBy = '관리자' }) {
  const db = await openDB();
  const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const docRecord = {
    id,
    academyId: academyId || 'default',
    title: title || file.name,
    category: category || '기타서류',
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || 'application/octet-stream',
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    note,
    fileBlob: file, // IndexedDB natively supports storing File/Blob
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.add(docRecord);

    req.onsuccess = () => {
      window.dispatchEvent(new CustomEvent('takeme_docs_changed'));
      resolve(docRecord);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getDocuments(academyId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const allDocs = req.result || [];
      if (!academyId || academyId === 'all') {
        resolve(allDocs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
      } else {
        const filtered = allDocs.filter(d => String(d.academyId) === String(academyId) || d.academyId === 'default');
        resolve(filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDocument(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => {
      window.dispatchEvent(new CustomEvent('takeme_docs_changed'));
      resolve(true);
    };
    req.onerror = () => reject(req.error);
  });
}

export function downloadDocument(doc) {
  if (!doc || !doc.fileBlob) {
    alert('다운로드할 파일 데이터가 없습니다.');
    return;
  }
  const url = URL.createObjectURL(doc.fileBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.fileName || `${doc.title}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// --------------------------------------------------------------------------
// 교육 · 보험 · 신고증명서 만료일 알림 관리 시스템
// --------------------------------------------------------------------------

const EXPIRY_STORAGE_KEY = 'takeme_legal_expiry_records';

/**
 * 오늘 날짜 기준 N일 후의 YYYY-MM-DD 문자열을 반환하는 헬퍼
 */
function getDateStringOffset(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 초기 시드 데이터 생성 (사용자가 즉시 기능을 확인하고 테스트할 수 있도록 현실적인 샘플 제공)
 */
function generateDefaultExpiryRecords() {
  return {
    // 1호차: 종합보험 만료 D-5 (긴급 🔴)
    '1': {
      busId: '1',
      busName: '1호차',
      insuranceExpiry: getDateStringOffset(5),       // D-5 (긴급)
      inspectionExpiry: getDateStringOffset(180),   // D-180 (정상)
      driverEduExpiry: getDateStringOffset(340),    // D-340 (정상)
      companionEduExpiry: getDateStringOffset(120), // D-120 (정상)
      updatedAt: new Date().toISOString(),
    },
    // 2호차: 정기안전점검 D-18 (주의 🟡)
    '2': {
      busId: '2',
      busName: '2호차',
      insuranceExpiry: getDateStringOffset(90),
      inspectionExpiry: getDateStringOffset(18),     // D-18 (주의)
      driverEduExpiry: getDateStringOffset(240),
      companionEduExpiry: getDateStringOffset(200),
      updatedAt: new Date().toISOString(),
    },
    // 3호차: 운전자 안전교육 D-25 (주의 🟡)
    '3': {
      busId: '3',
      busName: '3호차',
      insuranceExpiry: getDateStringOffset(150),
      inspectionExpiry: getDateStringOffset(110),
      driverEduExpiry: getDateStringOffset(25),     // D-25 (주의)
      companionEduExpiry: getDateStringOffset(75),
      updatedAt: new Date().toISOString(),
    },
    // 4호차: 동승보호자 안전교육 만료 2일 지남 (만료 🔴)
    '4': {
      busId: '4',
      busName: '4호차',
      insuranceExpiry: getDateStringOffset(120),
      inspectionExpiry: getDateStringOffset(60),
      driverEduExpiry: getDateStringOffset(180),
      companionEduExpiry: getDateStringOffset(-2),   // 만료 (D+2 지남)
      updatedAt: new Date().toISOString(),
    },
  };
}

/**
 * 모든 호차의 만료일 레코드를 불러옵니다.
 */
export function getExpiryRecords() {
  try {
    const raw = localStorage.getItem(EXPIRY_STORAGE_KEY);
    if (!raw) {
      const defaults = generateDefaultExpiryRecords();
      localStorage.setItem(EXPIRY_STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('만료일 정보 로드 실패:', err);
    return {};
  }
}

/**
 * 특정 호차의 만료일 레코드를 저장합니다.
 */
export function saveExpiryRecord(busId, record) {
  try {
    const records = getExpiryRecords();
    records[String(busId)] = {
      ...(records[String(busId)] || {}),
      ...record,
      busId: String(busId),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(EXPIRY_STORAGE_KEY, JSON.stringify(records));
    window.dispatchEvent(new CustomEvent('takeme_expiry_changed'));
    return records[String(busId)];
  } catch (err) {
    console.error('만료일 정보 저장 실패:', err);
    throw err;
  }
}

/**
 * D-Day 상태와 일수, 뱃지 색상을 과학적이고 명확하게 계산합니다.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {{ days: number|null, status: 'expired'|'urgent'|'warning'|'safe'|'empty', label: string, color: string, bg: string, border: string }}
 */
export function calculateDday(dateStr) {
  if (!dateStr) {
    return {
      days: null,
      status: 'empty',
      label: '미등록',
      color: 'text-slate-400',
      bg: 'bg-slate-100',
      border: 'border-slate-200',
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      days: diffDays,
      status: 'expired',
      label: `만료 (+${Math.abs(diffDays)}일)`,
      color: 'text-red-700',
      bg: 'bg-red-100',
      border: 'border-red-300',
      badge: '🔴 만료',
    };
  }
  if (diffDays <= 7) {
    return {
      days: diffDays,
      status: 'urgent',
      label: diffDays === 0 ? 'D-Day (오늘 만료)' : `D-${diffDays}`,
      color: 'text-rose-700',
      bg: 'bg-rose-100',
      border: 'border-rose-300',
      badge: '🔴 긴급 임박',
    };
  }
  if (diffDays <= 30) {
    return {
      days: diffDays,
      status: 'warning',
      label: `D-${diffDays}`,
      color: 'text-amber-700',
      bg: 'bg-amber-100',
      border: 'border-amber-300',
      badge: '🟡 갱신 주의',
    };
  }
  return {
    days: diffDays,
    status: 'safe',
    label: `D-${diffDays}`,
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    border: 'border-emerald-300',
    badge: '🟢 정상',
  };
}

/**
 * 전체 호차의 만료 현황을 종합 분석합니다.
 */
export function getOverallExpirySummary(buses = []) {
  const records = getExpiryRecords();
  const summary = {
    totalBuses: buses.length,
    urgentCount: 0,   // 만료 또는 D-7 이내
    warningCount: 0,  // D-30 이내
    safeCount: 0,
    urgentItems: [],  // 긴급 알림 배너에 노출할 항목들
  };

  const fields = [
    { key: 'insuranceExpiry', label: '자동차 종합보험' },
    { key: 'inspectionExpiry', label: '정기안전검사/신고필증' },
    { key: 'driverEduExpiry', label: '운전자 안전교육' },
    { key: 'companionEduExpiry', label: '동승보호자 안전교육' },
  ];

  buses.forEach((bus) => {
    const busId = String(bus.id);
    const busRecord = records[busId] || {};
    const busName = bus.name || bus.busNumber || `${busId}호차`;

    fields.forEach((f) => {
      const dateStr = busRecord[f.key];
      const dday = calculateDday(dateStr);

      if (dday.status === 'expired' || dday.status === 'urgent') {
        summary.urgentCount += 1;
        summary.urgentItems.push({
          busId,
          busName,
          fieldKey: f.key,
          fieldLabel: f.label,
          dateStr,
          dday,
        });
      } else if (dday.status === 'warning') {
        summary.warningCount += 1;
      } else if (dday.status === 'safe') {
        summary.safeCount += 1;
      }
    });
  });

  // 긴급 항목은 가장 촉박한 순으로 정렬
  summary.urgentItems.sort((a, b) => (a.dday.days ?? 999) - (b.dday.days ?? 999));

  return summary;
}

