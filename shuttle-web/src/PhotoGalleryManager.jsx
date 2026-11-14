import React, { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL } from './config';

export default function PhotoGalleryManager({
  selectedAcademyId,
  currentUser,
  socket,
  buses = [],
  availableClasses = [],
  onClose,
}) {
  const [photos, setPhotos] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [filterVehicleId, setFilterVehicleId] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [filterSourceType, setFilterSourceType] = useState('');
  const [searchUploader, setSearchUploader] = useState('');

  // Selected Photo for Fullscreen Modal
  const [activePhoto, setActivePhoto] = useState(null);

  // Multi-selection for batch download
  const [selectedIds, setSelectedIds] = useState([]);
  const [isSelectMode, setIsSelectMode] = useState(false);

  const token = localStorage.getItem('takeme_token');

  const fetchPhotos = async () => {
    if (!token) return;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterFrom) params.append('from', filterFrom);
      if (filterTo) params.append('to', filterTo);
      if (filterVehicleId) params.append('vehicleId', filterVehicleId);
      if (filterClass) params.append('className', filterClass);
      if (filterSourceType) params.append('sourceType', filterSourceType);

      const res = await fetch(`${API_BASE_URL}/routing/media?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('사진 목록을 불러오지 못했습니다.');
      }

      const data = await res.json();
      setPhotos(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Fetch photos failed:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [selectedAcademyId, filterFrom, filterTo, filterVehicleId, filterClass, filterSourceType]);

  // Real-time socket events
  useEffect(() => {
    if (!socket) return;

    const handleMediaUploaded = (newMedia) => {
      if (!newMedia) return;
      setPhotos((prev) => {
        // Prevent duplicate
        if (prev.some((p) => p.id === newMedia.id)) return prev;
        return [newMedia, ...prev];
      });
    };

    const handleMediaDeleted = ({ id }) => {
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      setActivePhoto((current) => (current?.id === id ? null : current));
    };

    socket.on('mediaUploaded', handleMediaUploaded);
    socket.on('mediaDeleted', handleMediaDeleted);

    return () => {
      socket.off('mediaUploaded', handleMediaUploaded);
      socket.off('mediaDeleted', handleMediaDeleted);
    };
  }, [socket]);

  const handleDelete = async (id, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('이 사진을 사진 보관함에서 삭제하시겠습니까?')) return;

    try {
      const res = await fetch(`${API_BASE_URL}/routing/media/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || '삭제에 실패했습니다.');
      }

      setPhotos((prev) => prev.filter((p) => p.id !== id));
      if (activePhoto?.id === id) setActivePhoto(null);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleDownload = (photo, e) => {
    if (e) e.stopPropagation();
    const downloadUrl = `${API_BASE_URL}/routing/media/${photo.id}/download?token=${token}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = photo.filename || `photo_${photo.id}.jpg`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleSelectPhoto = (id, e) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBatchDownload = async () => {
    if (selectedIds.length === 0) {
      alert('다운로드할 사진을 선택해주세요.');
      return;
    }
    const selectedPhotos = photos.filter((p) => selectedIds.includes(p.id));
    for (let i = 0; i < selectedPhotos.length; i++) {
      const photo = selectedPhotos[i];
      const downloadUrl = `${API_BASE_URL}/routing/media/${photo.id}/download?token=${token}`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = photo.filename || `photo_${photo.id}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (i < selectedPhotos.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  };

  const filteredPhotos = useMemo(() => {
    if (!searchUploader.trim()) return photos;
    const q = searchUploader.trim().toLowerCase();
    return photos.filter(
      (p) =>
        (p.uploaderName && p.uploaderName.toLowerCase().includes(q)) ||
        (p.uploaderRole && p.uploaderRole.toLowerCase().includes(q)),
    );
  }, [photos, searchUploader]);

  const formatRole = (role) => {
    switch (role) {
      case 'HOMEROOM_TEACHER':
        return '담임교사';
      case 'SHUTTLE_TEACHER':
        return '지도교사';
      case 'TEACHER':
        return '교사';
      case 'DRIVER':
        return '기사';
      case 'PARENT':
        return '학부모';
      case 'ACADEMY_ADMIN':
        return '관리자';
      default:
        return role || '교직원';
    }
  };

  return (
    <div className="absolute inset-0 z-20 bg-slate-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center font-bold shadow-xs">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-800 tracking-tight">사진 보관함 (클라우드)</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
                총 {filteredPhotos.length}장
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              교직원이 현장에서 촬영 및 보관한 실시간 사진 모음입니다. (학부모 알림장과 분리 관리)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchPhotos}
            className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
            title="새로고침"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            새로고침
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition"
              title="닫기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border-b border-slate-200 px-8 py-3.5 flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
          <span>기간:</span>
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <span>~</span>
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
          <span>차량:</span>
          <select
            value={filterVehicleId}
            onChange={(e) => setFilterVehicleId(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
          >
            <option value="">전체 차량</option>
            {buses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name || `${b.busNumber}호차`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
          <span>반:</span>
          <select
            value={filterClass}
            onChange={(e) => setFilterClass(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
          >
            <option value="">전체 학급</option>
            {availableClasses.map((cls, idx) => (
              <option key={idx} value={cls}>
                {cls}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
          <span>출처:</span>
          <select
            value={filterSourceType}
            onChange={(e) => setFilterSourceType(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
          >
            <option value="">전체 출처</option>
            <option value="GALLERY">보관함 업로드</option>
            <option value="NOTICE">알림장</option>
            <option value="BOARD">게시판</option>
          </select>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => {
              if (isSelectMode) {
                setIsSelectMode(false);
                setSelectedIds([]);
              } else {
                setIsSelectMode(true);
              }
            }}
            className={`px-3 py-1.5 rounded-lg font-bold transition border ${
              isSelectMode
                ? 'bg-slate-800 text-white border-slate-800'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {isSelectMode ? '선택 취소' : '선택 모드'}
          </button>
          {isSelectMode && (
            <>
              <button
                onClick={() => {
                  if (selectedIds.length === filteredPhotos.length) {
                    setSelectedIds([]);
                  } else {
                    setSelectedIds(filteredPhotos.map((p) => p.id));
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 font-medium text-slate-600"
              >
                {selectedIds.length === filteredPhotos.length ? '전체 해제' : '전체 선택'}
              </button>
              <button
                onClick={handleBatchDownload}
                disabled={selectedIds.length === 0}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold shadow-xs transition flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {selectedIds.length}장 일괄 다운로드
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium ml-auto">
          <input
            type="text"
            placeholder="촬영자/역할 검색..."
            value={searchUploader}
            onChange={(e) => setSearchUploader(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-indigo-500 outline-none w-40"
          />
          {(filterFrom || filterTo || filterVehicleId || filterClass || filterSourceType || searchUploader) && (
            <button
              onClick={() => {
                setFilterFrom('');
                setFilterTo('');
                setFilterVehicleId('');
                setFilterClass('');
                setFilterSourceType('');
                setSearchUploader('');
              }}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              초기화
            </button>
          )}
        </div>
      </div>

      {/* Main Grid View */}
      <div className="flex-1 overflow-y-auto p-8">
        {isLoading && photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
            <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-bold">사진을 불러오는 중...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm font-bold">{error}</span>
          </div>
        ) : filteredPhotos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
            <svg className="w-12 h-12 stroke-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-sm font-bold text-slate-500">저장된 사진이 없습니다.</span>
            <span className="text-xs text-slate-400">지도교사 또는 담임교사 앱에서 사진을 업로드하면 실시간 표시됩니다.</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {filteredPhotos.map((photo) => (
              <div
                key={photo.id}
                onClick={() => setActivePhoto(photo)}
                className="group relative bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-2xs hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer flex flex-col"
              >
                <div className="aspect-square w-full bg-slate-100 overflow-hidden relative">
                  {photo.url ? (
                    <img
                      src={photo.url}
                      alt={photo.filename || '사진'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                      이미지 없음
                    </div>
                  )}

                  {/* Badges on top */}
                  <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                    {photo.sourceType === 'NOTICE' ? (
                      <span className="px-2 py-0.5 rounded-md bg-amber-500/90 text-white text-[10px] font-bold backdrop-blur-xs">
                        알림장
                      </span>
                    ) : photo.sourceType === 'BOARD' ? (
                      <span className="px-2 py-0.5 rounded-md bg-sky-600/90 text-white text-[10px] font-bold backdrop-blur-xs">
                        게시판
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-purple-600/90 text-white text-[10px] font-bold backdrop-blur-xs">
                        보관함
                      </span>
                    )}
                    {photo.className && (
                      <span className="px-2 py-0.5 rounded-md bg-indigo-600/90 text-white text-[10px] font-bold backdrop-blur-xs">
                        {photo.className}
                      </span>
                    )}
                    {photo.vehicleId && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[10px] font-bold backdrop-blur-xs">
                        {photo.vehicleId}호차
                      </span>
                    )}
                  </div>

                  {/* Multi-selection Checkbox */}
                  {isSelectMode && (
                    <div
                      onClick={(e) => toggleSelectPhoto(photo.id, e)}
                      className="absolute top-2 right-2 z-10 w-6 h-6 rounded-lg bg-white/90 border border-slate-300 flex items-center justify-center shadow-sm cursor-pointer"
                    >
                      {selectedIds.includes(photo.id) ? (
                        <div className="w-4 h-4 rounded-md bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                          ✓
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Actions overlay */}
                  <div className="absolute inset-0 bg-slate-900/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      onClick={(e) => handleDownload(photo, e)}
                      className="p-2 rounded-xl bg-white text-slate-700 hover:text-indigo-600 shadow-lg transition"
                      title="원본 다운로드"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => handleDelete(photo.id, e)}
                      className="p-2 rounded-xl bg-white text-red-600 hover:bg-red-50 shadow-lg transition"
                      title="삭제"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Info Footer */}
                <div className="p-2.5 flex flex-col justify-between text-xs gap-1">
                  <div className="flex items-center justify-between text-slate-700 font-semibold truncate">
                    <span className="truncate">{photo.uploaderName || '교직원'}</span>
                    <span className="text-[10px] text-slate-400 font-normal shrink-0">
                      {formatRole(photo.uploaderRole)}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {photo.createdAt ? new Date(photo.createdAt).toLocaleString('ko-KR') : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Fullscreen Photo Modal */}
      {activePhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-xs"
          onClick={() => setActivePhoto(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-slate-800 text-sm">
                    {activePhoto.uploaderName || '교직원'} ({formatRole(activePhoto.uploaderRole)})
                  </h3>
                  {activePhoto.sourceType === 'NOTICE' ? (
                    <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 text-[10px] font-bold">알림장</span>
                  ) : activePhoto.sourceType === 'BOARD' ? (
                    <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-700 text-[10px] font-bold">게시판</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 text-[10px] font-bold">보관함</span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  {activePhoto.createdAt ? new Date(activePhoto.createdAt).toLocaleString('ko-KR') : ''}
                  {activePhoto.className && ` · ${activePhoto.className}`}
                  {activePhoto.vehicleId && ` · ${activePhoto.vehicleId}호차`}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownload(activePhoto)}
                  className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  원본 다운로드
                </button>
                <button
                  onClick={() => handleDelete(activePhoto.id)}
                  className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  삭제
                </button>
                <button
                  onClick={() => setActivePhoto(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Image Body */}
            <div className="flex-1 overflow-auto bg-slate-950 flex items-center justify-center p-4 min-h-[300px]">
              {activePhoto.url ? (
                <img
                  src={activePhoto.url}
                  alt={activePhoto.filename || '사진 원본'}
                  className="max-w-full max-h-[75vh] object-contain rounded-lg"
                />
              ) : (
                <div className="text-white text-xs">이미지를 불러올 수 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

