import React, { useState, useMemo, useEffect } from 'react';

const API_BASE_URL = 'http://52.63.245.203:3000';

export default function ClassManager({
  academyId,
  academy,
  currentUser,
  students,
  setStudents,
  teachers,
  setTeachers,
  availableClasses,
  customClasses,
  setCustomClasses,
  onRefreshData,
  isClosing,
  onClose
}) {
  const [newClassName, setNewClassName] = useState('');
  const [unassignedSearch, setUnassignedSearch] = useState('');
  const [selectedUnassignedIds, setSelectedUnassignedIds] = useState([]);
  const [bulkTargetClass, setBulkTargetClass] = useState('');
  const [dragOverClass, setDragOverClass] = useState(null); // className or '__UNASSIGNED__'
  const [draggingStudentId, setDraggingStudentId] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Combine custom classes and any classes found in students or teachers
  const allClassNames = useMemo(() => {
    const set = new Set();
    customClasses.forEach(c => {
      if (c && String(c).trim()) set.add(String(c).trim());
    });
    students.forEach(st => {
      const cls = st.raw?.['반명'] || st.raw?.['반'] || '';
      if (cls && String(cls).trim() && cls !== '미배정') set.add(String(cls).trim());
    });
    teachers.forEach(t => {
      if (t.assignedClass && String(t.assignedClass).trim() && t.assignedClass !== '미배정') {
        set.add(String(t.assignedClass).trim());
      }
    });
    if (set.size === 0) {
      ['햇살반', '열매반', '새싹반'].forEach(c => set.add(c));
    }
    return Array.from(set).sort();
  }, [customClasses, students, teachers]);

  // Set default bulk target class
  useEffect(() => {
    if (allClassNames.length > 0 && !bulkTargetClass) {
      setBulkTargetClass(allClassNames[0]);
    }
  }, [allClassNames, bulkTargetClass]);

  // Unassigned Students
  const unassignedStudents = useMemo(() => {
    return students.filter(st => {
      const cls = (st.raw?.['반명'] || st.raw?.['반'] || '').trim();
      return !cls || cls === '미배정' || !allClassNames.includes(cls);
    });
  }, [students, allClassNames]);

  // Filtered Unassigned Students by search keyword
  const filteredUnassignedStudents = useMemo(() => {
    if (!unassignedSearch.trim()) return unassignedStudents;
    const kw = unassignedSearch.toLowerCase().trim();
    return unassignedStudents.filter(st => {
      const name = st.name || '';
      const phone = st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['학부모전화번호'] || '';
      return name.toLowerCase().includes(kw) || phone.includes(kw);
    });
  }, [unassignedStudents, unassignedSearch]);

  // Group assigned students by class
  const classStudentMap = useMemo(() => {
    const map = {};
    allClassNames.forEach(c => {
      map[c] = [];
    });
    students.forEach(st => {
      const cls = (st.raw?.['반명'] || st.raw?.['반'] || '').trim();
      if (cls && map[cls]) {
        map[cls].push(st);
      }
    });
    return map;
  }, [allClassNames, students]);

  // Map of homeroom teacher for each class
  const classTeacherMap = useMemo(() => {
    const map = {};
    allClassNames.forEach(c => {
      map[c] = teachers.find(t => t.assignedClass && t.assignedClass.trim() === c.trim()) || null;
    });
    return map;
  }, [allClassNames, teachers]);

  // 1. Create a New Class
  const handleCreateClass = (e) => {
    e?.preventDefault();
    const trimmed = newClassName.trim();
    if (!trimmed) {
      alert('개설할 반 이름을 입력해 주세요.');
      return;
    }
    if (allClassNames.includes(trimmed)) {
      alert(`이미 존재하는 반 이름입니다: [${trimmed}]`);
      return;
    }

    const updated = Array.from(new Set([...customClasses, trimmed]));
    setCustomClasses(updated);
    try {
      localStorage.setItem(`takeme_custom_classes_${academyId || 'default'}`, JSON.stringify(updated));
    } catch (err) {
      console.error(err);
    }
    setNewClassName('');
    alert(`[${trimmed}] 이(가) 성공적으로 개설되었습니다.`);
  };

  // 2. Delete Class
  const handleDeleteClass = async (classNameToDelete) => {
    const assignedCount = classStudentMap[classNameToDelete]?.length || 0;
    const teacher = classTeacherMap[classNameToDelete];
    const confirmMsg = assignedCount > 0
      ? `[${classNameToDelete}] 에 속한 원아 ${assignedCount}명이 모두 '미배정' 상태로 변경됩니다. 정말 삭제하시겠습니까?`
      : `[${classNameToDelete}] 을(를) 삭제하시겠습니까?`;

    if (!window.confirm(confirmMsg)) return;

    setIsProcessing(true);
    try {
      // Unassign students from backend & state
      if (assignedCount > 0) {
        const studentIds = classStudentMap[classNameToDelete].map(s => s.id);
        await fetch(`${API_BASE_URL}/routing/students/assign-class`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentIds, className: '' })
        }).catch(err => console.warn(err));

        setStudents(prev => prev.map(st => {
          if (studentIds.includes(st.id)) {
            const rawObj = typeof st.raw === 'object' && st.raw ? { ...st.raw } : {};
            rawObj['반명'] = '';
            rawObj['반'] = '';
            return { ...st, raw: rawObj };
          }
          return st;
        }));
      }

      // Unassign teacher if assigned
      if (teacher) {
        await fetch(`${API_BASE_URL}/routing/teacher/assign-class`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherId: teacher.id, assignedClass: '' })
        }).catch(err => console.warn(err));

        setTeachers(prev => prev.map(t => (t.id === teacher.id ? { ...t, assignedClass: '' } : t)));
      }

      // Remove from custom classes
      const updated = customClasses.filter(c => c !== classNameToDelete);
      setCustomClasses(updated);
      try {
        localStorage.setItem(`takeme_custom_classes_${academyId || 'default'}`, JSON.stringify(updated));
      } catch (err) {
        console.error(err);
      }
    } catch (e) {
      console.error('Delete class failed', e);
      alert('반 삭제 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
      if (onRefreshData) onRefreshData();
    }
  };

  // 3. Assign single student to a class (or unassign)
  const handleAssignStudent = async (studentId, targetClass) => {
    const finalClass = (targetClass || '').trim();
    setIsProcessing(true);

    // Optimistic UI update
    setStudents(prev => prev.map(st => {
      if (st.id === studentId) {
        const rawObj = typeof st.raw === 'object' && st.raw ? { ...st.raw } : {};
        rawObj['반명'] = finalClass;
        rawObj['반'] = finalClass;
        return { ...st, raw: rawObj };
      }
      return st;
    }));

    try {
      await fetch(`${API_BASE_URL}/routing/student/${studentId}/class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ className: finalClass })
      });
    } catch (e) {
      console.warn('Student class update fallback to local', e);
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Bulk Assign selected unassigned students
  const handleBulkAssign = async () => {
    if (selectedUnassignedIds.length === 0) {
      alert('이동할 원아를 선택해 주세요.');
      return;
    }
    if (!bulkTargetClass) {
      alert('배정할 반을 선택해 주세요.');
      return;
    }

    setIsProcessing(true);
    const count = selectedUnassignedIds.length;

    // Optimistic UI update
    setStudents(prev => prev.map(st => {
      if (selectedUnassignedIds.includes(st.id)) {
        const rawObj = typeof st.raw === 'object' && st.raw ? { ...st.raw } : {};
        rawObj['반명'] = bulkTargetClass;
        rawObj['반'] = bulkTargetClass;
        return { ...st, raw: rawObj };
      }
      return st;
    }));

    try {
      await fetch(`${API_BASE_URL}/routing/students/assign-class`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: selectedUnassignedIds, className: bulkTargetClass })
      });
      alert(`선택한 원아 ${count}명이 [${bulkTargetClass}]에 배정되었습니다.`);
      setSelectedUnassignedIds([]);
    } catch (e) {
      console.warn('Bulk assign failed', e);
    } finally {
      setIsProcessing(false);
      if (onRefreshData) onRefreshData();
    }
  };

  // 5. Assign Teacher to Class
  const handleAssignTeacherToClass = async (className, teacherIdStr) => {
    const teacherId = teacherIdStr ? Number(teacherIdStr) : null;
    setIsProcessing(true);

    try {
      if (!teacherId) {
        // Unassign current teacher of this class
        const currentTeacher = classTeacherMap[className];
        if (currentTeacher) {
          await fetch(`${API_BASE_URL}/routing/teacher/assign-class`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacherId: currentTeacher.id, assignedClass: '' })
          });
          setTeachers(prev => prev.map(t => (t.id === currentTeacher.id ? { ...t, assignedClass: '' } : t)));
        }
      } else {
        // If teacher is already in another class or someone else was in this class, update
        const prevTeacher = classTeacherMap[className];
        if (prevTeacher && prevTeacher.id !== teacherId) {
          await fetch(`${API_BASE_URL}/routing/teacher/assign-class`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacherId: prevTeacher.id, assignedClass: '' })
          }).catch(err => console.warn(err));
        }

        await fetch(`${API_BASE_URL}/routing/teacher/assign-class`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ teacherId, assignedClass: className })
        });

        // Update local teachers state
        setTeachers(prev => prev.map(t => {
          if (t.id === teacherId) return { ...t, assignedClass: className };
          if (prevTeacher && t.id === prevTeacher.id) return { ...t, assignedClass: '' };
          return t;
        }));
      }
    } catch (e) {
      console.error('Assign teacher failed', e);
      alert('교사 배정 중 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
      if (onRefreshData) onRefreshData();
    }
  };

  // 6. Drag and Drop handlers
  const handleDragStart = (e, studentId) => {
    e.dataTransfer.setData('text/plain', String(studentId));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingStudentId(studentId);
  };

  const handleDragEnd = () => {
    setDraggingStudentId(null);
    setDragOverClass(null);
  };

  const handleDragOver = (e, targetName) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverClass !== targetName) {
      setDragOverClass(targetName);
    }
  };

  const handleDragLeave = () => {
    setDragOverClass(null);
  };

  const handleDrop = (e, targetClass) => {
    e.preventDefault();
    setDragOverClass(null);
    setDraggingStudentId(null);
    const studentIdStr = e.dataTransfer.getData('text/plain');
    if (!studentIdStr) return;
    const studentId = Number(studentIdStr);
    handleAssignStudent(studentId, targetClass === '__UNASSIGNED__' ? '' : targetClass);
  };

  return (
    <div className={`absolute inset-0 z-[2000] flex flex-col bg-slate-100 h-full overflow-hidden transition-all duration-300 ${isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
      
      {/* Top Bar Header */}
      <div className="bg-white px-8 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 shadow-xs shrink-0 z-10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-800">
              반 관리 및 분반 / 교사 배정
            </h1>
            <span className="text-xs font-bold px-3 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
              총 {allClassNames.length}개 반 개설됨
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            원장선생님께서 새로운 반을 개설하고, 원아들을 드래그하여 반에 넣고 담당 담임교사를 지정할 수 있습니다.
          </p>
        </div>

        {/* Quick Stats Pills & Close Button */}
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold">
            <span className="text-slate-500">원아 현황:</span>
            <span className="text-blue-700">배정 {students.length - unassignedStudents.length}명</span>
            <span className="text-slate-300">|</span>
            <span className="text-amber-700">미배정 {unassignedStudents.length}명</span>
          </div>

          <div className="hidden lg:flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold">
            <span className="text-slate-500">교사 현황:</span>
            <span className="text-emerald-700">담임 배정 {teachers.filter(t => t.assignedClass).length}명</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-600">미배정 {teachers.filter(t => !t.assignedClass).length}명</span>
          </div>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition"
              title="닫기"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Action Sub-Bar: 새 반 개설 폼 */}
      <div className="bg-white/80 backdrop-blur-xs px-8 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 shrink-0 shadow-2xs">
        <form onSubmit={handleCreateClass} className="flex items-center gap-2 flex-1 max-w-xl">
          <div className="relative flex-1">
            <input
              type="text"
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              placeholder="새 반 이름 입력 (예: 기쁨반, 심화 B반, 7세 슬기반)"
              className="w-full pl-9 pr-3 py-2 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
            />
            <svg className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <button
            type="submit"
            disabled={!newClassName.trim() || isProcessing}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-1.5 disabled:opacity-50 shrink-0"
          >
            <span>+ 새 반 만들기</span>
          </button>
        </form>

        <div className="text-xs text-slate-500 font-medium">
          원아 카드를 마우스로 끌어서 원하는 반 영역에 떨어뜨려 배정하세요.
        </div>
      </div>

      {/* Main Kanban Workspace Area */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-6 lg:p-8">
        <div className="flex gap-6 h-full items-start min-w-max pb-4">
          
          {/* ================= COLUMN 1: 미배정 원아 풀 (Unassigned Pool) ================= */}
          <div
            onDragOver={(e) => handleDragOver(e, '__UNASSIGNED__')}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, '__UNASSIGNED__')}
            className={`w-80 h-full flex flex-col rounded-3xl bg-slate-50 border-2 transition-all shadow-xs ${
              dragOverClass === '__UNASSIGNED__'
                ? 'border-amber-500 bg-amber-50/60 scale-[1.01]'
                : 'border-slate-300/80 hover:border-slate-400'
            }`}
          >
            {/* Header */}
            <div className="p-4 bg-white rounded-t-3xl border-b border-slate-200/80 shrink-0 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                  <h3 className="font-extrabold text-slate-900 text-sm">미배정 원아 풀</h3>
                </div>
                <span className="text-xs font-extrabold bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-200">
                  {unassignedStudents.length}명
                </span>
              </div>

              {/* Search in Unassigned */}
              <div className="relative">
                <input
                  type="text"
                  value={unassignedSearch}
                  onChange={(e) => setUnassignedSearch(e.target.value)}
                  placeholder="원아명 검색..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>

              {/* Bulk Move Controls */}
              {unassignedStudents.length > 0 && (
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5 text-xs">
                  <label className="flex items-center gap-1.5 text-slate-600 font-bold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filteredUnassignedStudents.length > 0 && selectedUnassignedIds.length === filteredUnassignedStudents.length}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedUnassignedIds(filteredUnassignedStudents.map(s => s.id));
                        } else {
                          setSelectedUnassignedIds([]);
                        }
                      }}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>전체 선택</span>
                  </label>

                  {selectedUnassignedIds.length > 0 && (
                    <div className="flex items-center gap-1">
                      <select
                        value={bulkTargetClass}
                        onChange={(e) => setBulkTargetClass(e.target.value)}
                        className="text-[11px] font-bold px-1.5 py-1 bg-white border border-slate-300 rounded-lg max-w-[100px]"
                      >
                        {allClassNames.map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleBulkAssign}
                        disabled={isProcessing}
                        className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[11px] shadow-xs shrink-0"
                      >
                        이동 ({selectedUnassignedIds.length})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Students List in Unassigned */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {filteredUnassignedStudents.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <p className="text-xs font-bold">미배정 원아가 없습니다.</p>
                  <p className="text-[11px] mt-1">모든 원아가 반에 정상 배정되었습니다.</p>
                </div>
              ) : (
                filteredUnassignedStudents.map(st => {
                  const isSelected = selectedUnassignedIds.includes(st.id);
                  const isDragging = draggingStudentId === st.id;
                  const gender = st.raw?.['성별'] || '';
                  const age = st.raw?.['연령'] || '';
                  const phone = st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['학부모전화번호'] || '';

                  return (
                    <div
                      key={st.id}
                      draggable={true}
                      onDragStart={(e) => handleDragStart(e, st.id)}
                      onDragEnd={handleDragEnd}
                      className={`p-3 bg-white rounded-2xl border transition-all cursor-grab active:cursor-grabbing select-none shadow-xs hover:shadow-md hover:border-blue-400 ${
                        isDragging ? 'opacity-40 border-dashed border-blue-400' : 'border-slate-200'
                      } ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50/30' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedUnassignedIds(prev =>
                                prev.includes(st.id) ? prev.filter(id => id !== st.id) : [...prev, st.id]
                              );
                            }}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center shrink-0">
                            {st.name?.[0] || '원'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-extrabold text-slate-900 text-xs">{st.name}</h4>
                              {gender && (
                                <span className={`text-[10px] font-bold px-1 rounded ${
                                  gender === '남' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                }`}>
                                  {gender}
                                </span>
                              )}
                              {age && (
                                <span className="text-[10px] text-slate-500 bg-slate-100 px-1 rounded">
                                  {age}
                                </span>
                              )}
                            </div>
                            {phone && (
                              <p className="text-[11px] text-slate-400 font-mono mt-0.5">{phone}</p>
                            )}
                          </div>
                        </div>

                        {/* Quick Assign Dropdown for convenience without drag */}
                        <select
                          value=""
                          onChange={(e) => {
                            if (e.target.value) handleAssignStudent(st.id, e.target.value);
                          }}
                          className="text-[10px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded-lg border border-slate-200 cursor-pointer"
                        >
                          <option value="">배정 ▼</option>
                          {allClassNames.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ================= COLUMNS 2..N: 개설된 반 목록 (Class Kanban Columns) ================= */}
          {allClassNames.map(className => {
            const classStudents = classStudentMap[className] || [];
            const assignedTeacher = classTeacherMap[className];
            const isDropTarget = dragOverClass === className;

            return (
              <div
                key={className}
                onDragOver={(e) => handleDragOver(e, className)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, className)}
                className={`w-84 h-full flex flex-col rounded-3xl bg-white border-2 transition-all shadow-xs ${
                  isDropTarget
                    ? 'border-blue-500 bg-blue-50/40 scale-[1.01] ring-4 ring-blue-100'
                    : 'border-slate-200/90 hover:border-slate-300'
                }`}
              >
                {/* Class Column Header */}
                <div className="p-4 bg-slate-50/80 rounded-t-3xl border-b border-slate-200 shrink-0 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-blue-600"></span>
                      <h3 className="font-black text-slate-900 text-base">{className}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full border border-blue-200">
                        {classStudents.length}명
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteClass(className)}
                        className="text-slate-400 hover:text-red-500 text-xs font-bold p-1 rounded transition"
                        title="반 삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Homeroom Teacher Selection Area */}
                  <div className="bg-white rounded-2xl p-2.5 border border-slate-200 space-y-1.5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-600">담당 담임교사:</span>
                      {assignedTeacher ? (
                        <span className="text-[10px] font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded-md border border-emerald-200">
                          배정 완료
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold text-slate-400">미배정</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <select
                        value={assignedTeacher?.id || ''}
                        onChange={(e) => handleAssignTeacherToClass(className, e.target.value)}
                        disabled={isProcessing}
                        className="flex-1 text-xs font-bold px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="">-- 담임교사 선택 --</option>
                        {teachers.map(t => (
                          <option key={t.id} value={t.id}>
                            {t.name} 선생님 {t.assignedClass ? `(${t.assignedClass} 담임)` : '(미배정)'}
                          </option>
                        ))}
                      </select>
                      {assignedTeacher && (
                        <button
                          type="button"
                          onClick={() => handleAssignTeacherToClass(className, '')}
                          className="px-2 py-1.5 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 rounded-xl text-[11px] font-bold transition"
                          title="담임 해제"
                        >
                          해제
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Class Student Cards Dropzone */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {classStudents.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center py-20 text-center border-2 border-dashed border-slate-200 rounded-2xl m-1">
                      <svg className="w-8 h-8 text-slate-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                      <p className="text-xs font-bold text-slate-500">배정된 원아가 없습니다</p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        원아를 마우스로 끌어다 놓으세요
                      </p>
                    </div>
                  ) : (
                    classStudents.map((st, idx) => {
                      const isDragging = draggingStudentId === st.id;
                      const gender = st.raw?.['성별'] || '';
                      const age = st.raw?.['연령'] || '';
                      const phone = st.raw?.['부모연락처'] || st.raw?.['보호자연락처'] || st.raw?.['학부모전화번호'] || '';

                      return (
                        <div
                          key={st.id}
                          draggable={true}
                          onDragStart={(e) => handleDragStart(e, st.id)}
                          onDragEnd={handleDragEnd}
                          className={`p-3 bg-white rounded-2xl border transition-all cursor-grab active:cursor-grabbing select-none shadow-xs hover:shadow-md hover:border-blue-400 ${
                            isDragging ? 'opacity-40 border-dashed border-blue-400' : 'border-slate-200'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center shrink-0">
                                {idx + 1}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h4 className="font-extrabold text-slate-900 text-xs">{st.name}</h4>
                                  {gender && (
                                    <span className={`text-[10px] font-bold px-1 rounded ${
                                      gender === '남' ? 'bg-blue-100 text-blue-700' : 'bg-pink-100 text-pink-700'
                                    }`}>
                                      {gender}
                                    </span>
                                  )}
                                  {age && (
                                    <span className="text-[10px] text-slate-500 bg-slate-100 px-1 rounded">
                                      {age}
                                    </span>
                                  )}
                                </div>
                                {phone && (
                                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">{phone}</p>
                                )}
                              </div>
                            </div>

                            {/* Dropdown to move to another class or unassign */}
                            <div className="flex items-center gap-1">
                              <select
                                value={className}
                                onChange={(e) => handleAssignStudent(st.id, e.target.value)}
                                className="text-[10px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-700 px-2 py-1 rounded-lg border border-slate-200 cursor-pointer max-w-[85px]"
                              >
                                <option value="">미배정으로</option>
                                {allClassNames.map(c => (
                                  <option key={c} value={c}>{c}</option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleAssignStudent(st.id, '')}
                                className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-red-50 text-slate-400 hover:text-red-500 flex items-center justify-center text-xs font-bold transition"
                                title="반 배정 취소 (미배정으로 이동)"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
