// Server Cloud & IndexedDB hybrid storage utility for Takeme Document Management
import { API_BASE_URL } from '../config';

const DB_NAME = 'TakemeDocumentDB';
const DB_VERSION = 1;
const STORE_NAME = 'documents';

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return resolve(null);
    }
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function saveDocument({ academyId, educationLevel, title, category, file, note = '', uploadedBy = '관리자' }) {
  const currentEdu = educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  let serverDoc = null;

  // 1. Try uploading to backend cloud storage
  try {
    const fileBase64 = await fileToBase64(file);
    const res = await fetch(`${API_BASE_URL}/routing/documents/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        academyId: academyId && academyId !== 'all' && academyId !== 'default' ? Number(academyId) : undefined,
        educationLevel: currentEdu,
        title: title || file.name,
        category: category || '기타서류',
        note,
        uploadedBy,
        fileName: file.name,
        fileType: file.type || 'application/octet-stream',
        fileBase64,
      }),
    });
    if (res.ok) {
      serverDoc = await res.json();
    }
  } catch (err) {
    console.warn('Backend document upload failed, using local fallback:', err);
  }

  const id = serverDoc?.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const docRecord = {
    id,
    academyId: academyId || 'default',
    educationLevel: currentEdu,
    title: title || file.name,
    category: category || '기타서류',
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type || 'application/octet-stream',
    fileUrl: serverDoc?.fileUrl || '',
    uploadedAt: serverDoc?.uploadedAt || new Date().toISOString(),
    uploadedBy,
    note,
    fileBlob: file, // IndexedDB natively supports storing File/Blob
  };

  // 2. Cache in IndexedDB
  try {
    const db = await openDB();
    if (db) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const req = store.put(docRecord);
        req.onsuccess = () => resolve(docRecord);
        req.onerror = () => reject(req.error);
      });
    }
  } catch (dbErr) {
    console.warn('IndexedDB cache save failed:', dbErr);
  }

  window.dispatchEvent(new CustomEvent('takeme_docs_changed'));
  return docRecord;
}

export async function getDocuments(academyId, educationLevel) {
  const currentEdu = educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';

  // 1. Fetch from server cloud API
  try {
    const q = new URLSearchParams();
    if (academyId && academyId !== 'all') q.set('academyId', String(academyId));
    if (currentEdu) q.set('educationLevel', currentEdu);

    const res = await fetch(`${API_BASE_URL}/routing/documents?${q.toString()}`);
    if (res.ok) {
      const serverDocs = await res.json();
      if (Array.isArray(serverDocs) && serverDocs.length > 0) {
        // Cache to IndexedDB in background
        openDB().then(db => {
          if (!db) return;
          const tx = db.transaction([STORE_NAME], 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          serverDocs.forEach(sd => {
            store.put({
              ...sd,
              id: sd.id,
              educationLevel: sd.educationLevel || currentEdu,
            });
          });
        }).catch(() => {});

        return serverDocs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      }
    }
  } catch (netErr) {
    console.warn('Failed to fetch documents from server, falling back to local DB:', netErr);
  }

  // 2. Fallback to local IndexedDB
  try {
    const db = await openDB();
    if (db) {
      return new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const allDocs = req.result || [];
          const eduFiltered = allDocs.filter(d => (d.educationLevel || '유치원') === currentEdu);
          if (!academyId || academyId === 'all') {
            resolve(eduFiltered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
          } else {
            const filtered = eduFiltered.filter(d => String(d.academyId) === String(academyId) || d.academyId === 'default');
            resolve(filtered.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)));
          }
        };
        req.onerror = () => resolve([]);
      });
    }
  } catch (err) {
    console.warn('IndexedDB read failed:', err);
  }

  return [];
}

export async function deleteDocument(id) {
  // 1. Delete from server
  try {
    await fetch(`${API_BASE_URL}/routing/documents/${id}`, { method: 'DELETE' });
  } catch (e) {
    console.warn('Server delete failed, deleting locally:', e);
  }

  // 2. Delete from IndexedDB
  try {
    const db = await openDB();
    if (db) {
      await new Promise((resolve) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    }
  } catch (e) {}

  window.dispatchEvent(new CustomEvent('takeme_docs_changed'));
  return true;
}

export function downloadDocument(doc) {
  if (!doc) {
    alert('다운로드할 서류 정보가 없습니다.');
    return;
  }
  if (doc.fileBlob) {
    const url = URL.createObjectURL(doc.fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.fileName || `${doc.title || '서류'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  if (doc.fileUrl) {
    const a = document.createElement('a');
    a.href = doc.fileUrl;
    a.target = '_blank';
    a.download = doc.fileName || `${doc.title || '서류'}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  alert('다운로드할 파일 데이터가 없습니다.');
}

export function previewDocumentInNewTab(doc) {
  if (!doc) {
    alert('미리보기할 서류 정보가 없습니다.');
    return;
  }
  if (doc.fileBlob) {
    const ext = (doc.fileName || '').split('.').pop().toLowerCase();
    let blob = doc.fileBlob;
    if (ext === 'pdf' && blob.type !== 'application/pdf') {
      blob = new Blob([blob], { type: 'application/pdf' });
    } else if (['jpg', 'jpeg'].includes(ext) && !blob.type.startsWith('image/')) {
      blob = new Blob([blob], { type: 'image/jpeg' });
    } else if (ext === 'png' && !blob.type.startsWith('image/')) {
      blob = new Blob([blob], { type: 'image/png' });
    }
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      alert('팝업 차단이 감지되었습니다. 브라우저에서 팝업을 허용해주세요.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  if (doc.fileUrl) {
    const win = window.open(doc.fileUrl, '_blank');
    if (!win) {
      alert('팝업 차단이 감지되었습니다. 브라우저에서 팝업을 허용해주세요.');
    }
    return;
  }
  alert('미리보기할 파일 데이터가 없습니다.');
}

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// --------------------------------------------------------------------------
// 교육 · 보험 · 신고증명서 만료일 알림 관리 시스템 (서버 동기화 지원)
// --------------------------------------------------------------------------

function getAuthHeaders() {
  const token = localStorage.getItem('takeme_token') || localStorage.getItem('token') || '';
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export function getExpiryStorageKey(educationLevel) {
  const currentEdu = educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  return `takeme_legal_expiry_records_${currentEdu}`;
}

export function getExpiryRecords(educationLevel) {
  const key = getExpiryStorageKey(educationLevel);
  const currentEdu = educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  
  // Background sync with server
  fetch(`${API_BASE_URL}/routing/legal-expiry?educationLevel=${encodeURIComponent(currentEdu)}`, {
    headers: { ...getAuthHeaders() }
  })
    .then(r => r.json())
    .then(serverRecords => {
      if (serverRecords && typeof serverRecords === 'object' && Object.keys(serverRecords).length > 0) {
        const prev = localStorage.getItem(key);
        const next = JSON.stringify(serverRecords);
        if (prev !== next) {
          localStorage.setItem(key, next);
          window.dispatchEvent(new CustomEvent('takeme_expiry_changed'));
        }
      }
    })
    .catch(() => {});

  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return {};
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('만료일 정보 로드 실패:', err);
    return {};
  }
}

export async function loadExpiryRecordsAsync(educationLevel) {
  const key = getExpiryStorageKey(educationLevel);
  const currentEdu = educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  try {
    const res = await fetch(`${API_BASE_URL}/routing/legal-expiry?educationLevel=${encodeURIComponent(currentEdu)}`, {
      headers: { ...getAuthHeaders() }
    });
    if (res.ok) {
      const serverRecords = await res.json();
      if (serverRecords && typeof serverRecords === 'object' && Object.keys(serverRecords).length > 0) {
        localStorage.setItem(key, JSON.stringify(serverRecords));
        return serverRecords;
      }
    }
  } catch (_) {}
  return getExpiryRecords(educationLevel);
}

export function saveExpiryRecord(busId, record, educationLevel) {
  const key = getExpiryStorageKey(educationLevel);
  const currentEdu = educationLevel || localStorage.getItem('takeme_selected_education_level') || '유치원';
  
  try {
    const records = getExpiryRecords(educationLevel);
    records[String(busId)] = {
      ...(records[String(busId)] || {}),
      ...record,
      busId: String(busId),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(records));

    // Save to server DB
    fetch(`${API_BASE_URL}/routing/legal-expiry`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        vehicleId: Number(busId),
        educationLevel: currentEdu,
        ...record,
      }),
    }).catch(e => console.warn('Server expiry sync failed:', e));

    window.dispatchEvent(new CustomEvent('takeme_expiry_changed'));
    return records[String(busId)];
  } catch (err) {
    console.error('만료일 정보 저장 실패:', err);
    throw err;
  }
}

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
      badge: '만료',
    };
  }
  if (diffDays <= 30) {
    return {
      days: diffDays,
      status: 'urgent',
      label: diffDays === 0 ? 'D-Day (오늘 만료)' : `D-${diffDays}`,
      color: 'text-rose-700',
      bg: 'bg-rose-100',
      border: 'border-rose-300',
      badge: '만료 임박 (1달 이내)',
    };
  }
  if (diffDays <= 60) {
    return {
      days: diffDays,
      status: 'warning',
      label: `D-${diffDays}`,
      color: 'text-amber-700',
      bg: 'bg-amber-100',
      border: 'border-amber-300',
      badge: '갱신 주의 (2달 이내)',
    };
  }
  return {
    days: diffDays,
    status: 'safe',
    label: `D-${diffDays}`,
    color: 'text-emerald-700',
    bg: 'bg-emerald-100',
    border: 'border-emerald-300',
    badge: '정상',
  };
}

export function getOverallExpirySummary(buses = [], educationLevel) {
  const records = getExpiryRecords(educationLevel);
  const summary = {
    totalBuses: buses.length,
    urgentCount: 0,
    warningCount: 0,
    safeCount: 0,
    urgentItems: [],
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

  summary.urgentItems.sort((a, b) => (a.dday.days ?? 999) - (b.dday.days ?? 999));
  return summary;
}

export function getExpiryNotificationSchedule(dateStr) {
  const dday = calculateDday(dateStr);
  if (dday.status === 'empty') {
    return { shouldNotify: false, frequency: 'none', reason: '미등록', dday };
  }

  const days = dday.days;
  if (days <= 14) {
    return {
      shouldNotify: true,
      frequency: 'daily',
      frequencyLabel: '매일 알림',
      intervalDays: 1,
      urgency: days < 0 ? 'expired' : 'urgent',
      urgencyLabel: days < 0 ? '만료 경과' : '만료 임박 (2주 이내)',
      dday,
    };
  }

  if (days <= 60) {
    return {
      shouldNotify: true,
      frequency: 'weekly',
      frequencyLabel: '주 1회 알림',
      intervalDays: 7,
      urgency: days <= 30 ? 'urgent' : 'warning',
      urgencyLabel: days <= 30 ? '만료 임박 (1달 이내)' : '주의 (2달 이내)',
      dday,
    };
  }

  return {
    shouldNotify: false,
    frequency: 'none',
    frequencyLabel: '알림 없음 (정상)',
    intervalDays: 0,
    urgency: 'safe',
    urgencyLabel: '정상',
    dday,
  };
}

const STAFF_NOTIFICATIONS_KEY = 'takeme_staff_notifications';

export function syncStaffExpiryNotifications(buses = [], educationLevel) {
  const records = getExpiryRecords(educationLevel);
  const driverNotifications = [];
  const teacherNotifications = [];

  buses.forEach((bus) => {
    const busId = String(bus.id);
    const busName = bus.name || bus.busNumber || `${busId}호차`;
    const plate = bus.plateNumber || '차량번호 미등록';
    const driverName = bus.driverName || '기사님';
    const teacherName = bus.teacherName || '차량선생님';
    const busRecord = records[busId] || {};

    const items = [
      {
        key: 'insuranceExpiry',
        label: '자동차 종합보험',
        targetRoles: ['driver', 'teacher'],
        dateStr: busRecord.insuranceExpiry,
      },
      {
        key: 'inspectionExpiry',
        label: '정기안전검사/신고필증',
        targetRoles: ['driver', 'teacher'],
        dateStr: busRecord.inspectionExpiry,
      },
      {
        key: 'driverEduExpiry',
        label: '운전자 안전교육',
        targetRoles: ['driver'],
        dateStr: busRecord.driverEduExpiry,
      },
      {
        key: 'companionEduExpiry',
        label: '동승보호자 안전교육',
        targetRoles: ['teacher'],
        dateStr: busRecord.companionEduExpiry,
      },
    ];

    items.forEach((item) => {
      const schedule = getExpiryNotificationSchedule(item.dateStr);
      if (!schedule.shouldNotify) return;

      const dday = schedule.dday;
      const days = dday.days;
      let titlePrefix = '';
      if (schedule.urgency === 'expired') {
        titlePrefix = `[법정서류 만료 (+${Math.abs(days)}일)]`;
      } else if (days <= 14) {
        titlePrefix = `[긴급 매일알림 D-${days}]`;
      } else if (days <= 30) {
        titlePrefix = `[만료임박 주간알림 D-${days}]`;
      } else {
        titlePrefix = `[주의 주간알림 D-${days}]`;
      }

      const message = `${titlePrefix} ${busName}(${plate}) ${item.label} 만료일(${item.dateStr})이 ${dday.label}입니다. 서류 갱신 및 이수를 확인해주세요.`;

      const notiObject = {
        id: `noti_${busId}_${item.key}_${Date.now()}`,
        busId,
        busName,
        plateNumber: plate,
        itemKey: item.key,
        itemLabel: item.label,
        expiryDate: item.dateStr,
        daysRemaining: days,
        frequency: schedule.frequency,
        frequencyLabel: schedule.frequencyLabel,
        urgency: schedule.urgency,
        urgencyLabel: schedule.urgencyLabel,
        titlePrefix,
        message,
        createdAt: new Date().toISOString(),
      };

      if (item.targetRoles.includes('driver')) {
        driverNotifications.push({
          ...notiObject,
          targetRole: 'driver',
          targetName: driverName,
        });
      }
      if (item.targetRoles.includes('teacher')) {
        teacherNotifications.push({
          ...notiObject,
          targetRole: 'teacher',
          targetName: teacherName,
        });
      }
    });
  });

  const payload = {
    updatedAt: new Date().toISOString(),
    driverNotifications,
    teacherNotifications,
  };

  try {
    localStorage.setItem(STAFF_NOTIFICATIONS_KEY, JSON.stringify(payload));
    window.dispatchEvent(new CustomEvent('takeme_staff_notifications_updated', { detail: payload }));
  } catch (e) {
    console.error('기사/교사 알림 저장 실패:', e);
  }

  return {
    driverNotifications,
    teacherNotifications,
    allCount: driverNotifications.length + teacherNotifications.length,
  };
}

export function getStaffNotifications(role = 'all') {
  try {
    const raw = localStorage.getItem(STAFF_NOTIFICATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (role === 'driver') return parsed.driverNotifications || [];
    if (role === 'teacher') return parsed.teacherNotifications || [];
    return [...(parsed.driverNotifications || []), ...(parsed.teacherNotifications || [])];
  } catch (err) {
    return [];
  }
}

/**
 * 기사·교사 모바일 앱 및 관리자에게 법정 서류/안전 교육 만료 임박 푸시 알림 즉시 발송
 */
export async function sendStaffExpiryNotificationsToServer(notifications, academyId) {
  try {
    const list = notifications || getStaffNotifications('all');
    if (!list || list.length === 0) {
      return { success: false, message: '발송할 만료 임박 알림 내역이 없습니다.' };
    }

    const res = await fetch(`${API_BASE_URL}/routing/legal-expiry/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        academyId: academyId && academyId !== 'all' ? Number(academyId) : undefined,
        notifications: list,
        force: true, // 관리자가 수동 발송 요청 시 당일 중복 제한 해제하고 즉시 발송
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || '서버 푸시 발송 요청에 실패했습니다.');
    }

    return await res.json();
  } catch (err) {
    console.error('기사/교사 만료 알림 서버 전송 실패:', err);
    throw err;
  }
}

