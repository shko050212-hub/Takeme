import React, { useState, useEffect, useMemo, useRef } from 'react';
import { API_BASE_URL } from '../config';

const PRESET_PHOTOS = [
  {
    name: '야외 모래놀이 & 놀이터',
    url: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&auto=format&fit=crop&q=80'
  },
  {
    name: '창의 미술 & 그리기 시간',
    url: 'https://images.unsplash.com/photo-1596464716127-f2a82984de30?w=800&auto=format&fit=crop&q=80'
  },
  {
    name: '신나는 음악 율동 & 악기 놀이',
    url: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&auto=format&fit=crop&q=80'
  },
  {
    name: '오감 발달 블록 쌓기 놀이',
    url: 'https://images.unsplash.com/photo-1566140967404-b8b3932483f5?w=800&auto=format&fit=crop&q=80'
  },
  {
    name: '즐거운 숲 체험 & 자연 관찰',
    url: 'https://images.unsplash.com/photo-1472162072942-cd5147eb3902?w=800&auto=format&fit=crop&q=80'
  },
  {
    name: '달콤한 생일 축하 파티',
    url: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=800&auto=format&fit=crop&q=80'
  }
];

const DEFAULT_POSTS = [
  {
    id: 101,
    title: '햇살반 가을 낙엽 탐색 및 숲 체험 활동 🍂',
    content: '오늘 햇살반 친구들과 함께 유치원 뒤뜰에서 알록달록 단풍잎과 솔방울을 모아 왕관 만들기 놀이를 했습니다. 아이들이 자연 속에서 너무 신나게 참여했어요!',
    imageUrl: 'https://images.unsplash.com/photo-1596464716127-f2a82984de30?w=800&auto=format&fit=crop&q=80',
    images: [],
    authorName: '햇살반 담임선생님',
    authorRole: 'TEACHER',
    visibility: 'CLASS',
    targetClass: '햇살반',
    likeCount: 5,
    likedUserIds: ['admin'],
    comments: [
      { id: 1, authorName: '민준이 어머님', authorRole: 'PARENT', content: '사진 너무 예쁘네요! 오늘도 수고 많으셨습니다 선생님~ ❤️', createdAt: new Date(Date.now() - 3600000).toISOString() },
      { id: 2, authorName: '원장선생님', authorRole: 'ADMIN', content: '햇살반 친구들 표정이 정말 밝고 예쁩니다 ^^', createdAt: new Date(Date.now() - 1800000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 7200000).toISOString()
  },
  {
    id: 102,
    title: '[전체 공지] 10월 유치원 가을 운동회 & 꿈나무 축제 안내 🎈',
    content: '학부모님 안녕하십니까. 다음 주 금요일 진행되는 가을 운동회 및 꿈나무 축제 일정 안내드립니다. 편안한 복장과 운동화 착용을 부탁드리며 셔틀 운행 시간표를 확인해 주시기 바랍니다.',
    imageUrl: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=800&auto=format&fit=crop&q=80',
    images: [],
    authorName: '원장선생님',
    authorRole: 'ADMIN',
    visibility: 'ALL',
    targetClass: null,
    likeCount: 12,
    likedUserIds: [],
    comments: [
      { id: 3, authorName: '지우 아버님', authorRole: 'PARENT', content: '가을 운동회 정말 기대됩니다! 가족들과 함께 참석하겠습니다.', createdAt: new Date(Date.now() - 14400000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 86400000).toISOString()
  },
  {
    id: 103,
    title: '열매반 조물조물 클레이 도예 체험 시간 🎨',
    content: '고사리 같은 손으로 찰흙을 빚어 나만의 예쁜 동물 그릇을 만들었어요. 집으로 가져가서 칭찬 많이 해주세요!',
    imageUrl: 'https://images.unsplash.com/photo-1566140967404-b8b3932483f5?w=800&auto=format&fit=crop&q=80',
    images: [],
    authorName: '열매반 담임선생님',
    authorRole: 'TEACHER',
    visibility: 'CLASS',
    targetClass: '열매반',
    likeCount: 8,
    likedUserIds: [],
    comments: [
      { id: 4, authorName: '서아 어머님', authorRole: 'PARENT', content: '집에 와서 서아가 찰흙 놀이한 거 엄청 자랑했어요 ㅎㅎ 감사해요!', createdAt: new Date(Date.now() - 28800000).toISOString() }
    ],
    createdAt: new Date(Date.now() - 172800000).toISOString()
  }
];

export default function BoardViewer({
  isClosing = false,
  currentUser = {},
  selectedAcademyId,
  availableClasses = ['햇살반', '열매반', '풀잎반', '새싹반'],
  selectedClass = 'ALL',
  setSelectedClass,
  searchKeyword = '',
  setSearchKeyword,
  isCreatingPost = false,
  setIsCreatingPost,
  posts = [],
  setPosts,
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingToCloud, setIsUploadingToCloud] = useState(false);

  const isAdmin = currentUser.role === 'ACADEMY_ADMIN' || currentUser.role === 'SUPER_ADMIN';
  const isTeacher = currentUser.role === 'TEACHER';
  const teacherClass = currentUser.assignedClass || '햇살반';
  const [activeCommentPostId, setActiveCommentPostId] = useState(null);
  const [commentInputs, setCommentInputs] = useState({});
  const [sortBy, setSortBy] = useState('LATEST'); // 'LATEST' | 'POPULAR'
  const [previewImageUrl, setPreviewImageUrl] = useState(null);
  const [postToDelete, setPostToDelete] = useState(null);
  const [editingPost, setEditingPost] = useState(null);

  // Form state for new / edit post
  const defaultAuthorName = isTeacher 
    ? `${currentUser.name || '선생님'} (${teacherClass})`
    : (currentUser?.name ? `${currentUser.name} 원장선생님` : '원장선생님');

  const [postForm, setPostForm] = useState({
    title: '',
    content: '',
    visibility: isTeacher ? 'CLASS' : 'ALL',
    targetClass: (isTeacher && teacherClass) ? teacherClass : (availableClasses[0] || '햇살반'),
    imageUrl: PRESET_PHOTOS[0].url,
    authorName: defaultAuthorName,
    authorRole: isTeacher ? 'TEACHER' : 'ADMIN',
  });
  const fileInputRef = useRef(null);

  // Load posts from backend or fallback to localStorage
  const fetchPosts = async () => {
    setIsLoading(true);
    try {
      const activeAcademyId = selectedAcademyId || localStorage.getItem('takeme_selected_academy_id') || (() => {
        try { return JSON.parse(localStorage.getItem('takeme_user') || '{}').academyId; } catch(e){ return ''; }
      })();

      const queryParams = new URLSearchParams();
      if (activeAcademyId) queryParams.set('academyId', activeAcademyId);

      const res = await fetch(`${API_BASE_URL}/routing/board/posts?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setPosts(data);
          localStorage.setItem('takeme_board_posts', JSON.stringify(data));
          return;
        }
      }
      // Fallback to local storage or defaults
      const saved = localStorage.getItem('takeme_board_posts');
      if (saved) {
        setPosts(JSON.parse(saved));
      } else {
        setPosts(DEFAULT_POSTS);
        localStorage.setItem('takeme_board_posts', JSON.stringify(DEFAULT_POSTS));
      }
    } catch (e) {
      console.warn('Backend fetch failed, falling back to local data', e);
      const saved = localStorage.getItem('takeme_board_posts');
      setPosts(saved ? JSON.parse(saved) : DEFAULT_POSTS);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [selectedAcademyId]);

  // Sync to local storage on change
  const savePostsLocal = (newPosts) => {
    setPosts(newPosts);
    localStorage.setItem('takeme_board_posts', JSON.stringify(newPosts));
  };

  // Filter & Sort
  const filteredPosts = useMemo(() => {
    let result = [...posts];

    if (selectedClass === 'PUBLIC_ONLY') {
      result = result.filter(p => p.visibility === 'ALL');
    } else if (selectedClass !== 'ALL') {
      // Show ALL-public posts OR posts specifically targeted to this class
      result = result.filter(p => p.visibility === 'ALL' || p.targetClass === selectedClass);
    }

    if (searchKeyword.trim()) {
      const kw = searchKeyword.toLowerCase().trim();
      result = result.filter(p => 
        (p.title && p.title.toLowerCase().includes(kw)) ||
        (p.content && p.content.toLowerCase().includes(kw)) ||
        (p.authorName && p.authorName.toLowerCase().includes(kw)) ||
        (p.targetClass && p.targetClass.toLowerCase().includes(kw))
      );
    }

    if (sortBy === 'POPULAR') {
      result.sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0));
    } else {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    return result;
  }, [posts, selectedClass, searchKeyword, sortBy]);

  // Handle Like Toggle
  const handleToggleLike = async (postId) => {
    const currentUserId = currentUser?.id ? String(currentUser.id) : 'admin';
    
    // Optimistic UI update
    const updated = posts.map(p => {
      if (p.id !== postId) return p;
      const liked = Array.isArray(p.likedUserIds) ? [...p.likedUserIds] : [];
      const isLiked = liked.includes(currentUserId);
      const newLiked = isLiked ? liked.filter(u => u !== currentUserId) : [...liked, currentUserId];
      const newCount = isLiked ? Math.max(0, (p.likeCount || 0) - 1) : (p.likeCount || 0) + 1;
      return { ...p, likeCount: newCount, likedUserIds: newLiked };
    });
    savePostsLocal(updated);

    try {
      await fetch(`${API_BASE_URL}/routing/board/posts/${postId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId })
      });
    } catch (e) {
      console.warn('Like API call failed, saved locally', e);
    }
  };

  // Handle Comment Add
  const handleAddComment = async (postId) => {
    const text = commentInputs[postId]?.trim();
    if (!text) return;

    const authorName = currentUser?.name ? `${currentUser.name} 원장선생님` : '원장선생님';
    const newComment = {
      id: Date.now(),
      authorName,
      authorRole: 'ADMIN',
      content: text,
      createdAt: new Date().toISOString()
    };

    // Optimistic UI update
    const updated = posts.map(p => {
      if (p.id !== postId) return p;
      return {
        ...p,
        comments: [...(p.comments || []), newComment]
      };
    });
    savePostsLocal(updated);
    setCommentInputs(prev => ({ ...prev, [postId]: '' }));

    try {
      await fetch(`${API_BASE_URL}/routing/board/posts/${postId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          authorName,
          authorRole: 'ADMIN'
        })
      });
    } catch (e) {
      console.warn('Comment API call failed, saved locally', e);
    }
  };

  // Handle Comment Delete
  const handleDeleteComment = async (postId, commentId) => {
    if (!window.confirm('이 댓글을 삭제하시겠습니까?')) return;

    const updated = posts.map(p => {
      if (p.id !== postId) return p;
      return {
        ...p,
        comments: (p.comments || []).filter(c => c.id !== commentId)
      };
    });
    savePostsLocal(updated);

    try {
      await fetch(`${API_BASE_URL}/routing/board/posts/${postId}/comments/${commentId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn('Comment delete API failed, updated locally', e);
    }
  };

  // Handle Post Delete
  const handleDeletePost = async (postId) => {
    const updated = posts.filter(p => p.id !== postId);
    savePostsLocal(updated);
    setPostToDelete(null);

    try {
      await fetch(`${API_BASE_URL}/routing/board/posts/${postId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.warn('Post delete API failed, updated locally', e);
    }
  };

  // Handle File Upload to Cloud Storage API
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      alert('사진 크기는 20MB 이하만 업로드 가능합니다.');
      return;
    }

    setIsUploadingToCloud(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64Data = reader.result;
      try {
        const res = await fetch(`${API_BASE_URL}/routing/board/upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            base64Data,
            filename: file.name,
            mimeType: file.type
          })
        });
        const data = await res.json();
        if (res.ok && data.url) {
          setPostForm(prev => ({ ...prev, imageUrl: data.url }));
        } else {
          setPostForm(prev => ({ ...prev, imageUrl: base64Data }));
        }
      } catch (err) {
        console.warn('Cloud upload failed, using local preview', err);
        setPostForm(prev => ({ ...prev, imageUrl: base64Data }));
      } finally {
        setIsUploadingToCloud(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle Save New or Edited Post
  const handleSavePost = async () => {
    if (!postForm.title.trim()) {
      alert('게시글 제목을 입력해 주세요.');
      return;
    }
    if (!postForm.content.trim()) {
      alert('게시글 내용을 입력해 주세요.');
      return;
    }

    const activeAcademyId = selectedAcademyId || localStorage.getItem('takeme_selected_academy_id') || undefined;

    if (editingPost) {
      // Edit mode
      const updated = posts.map(p => {
        if (p.id !== editingPost.id) return p;
        return {
          ...p,
          title: postForm.title.trim(),
          content: postForm.content.trim(),
          visibility: postForm.visibility,
          targetClass: postForm.visibility === 'CLASS' ? postForm.targetClass : null,
          imageUrl: postForm.imageUrl,
          authorName: postForm.authorName || '원장선생님'
        };
      });
      savePostsLocal(updated);
      setEditingPost(null);
      setIsCreatingPost(false);

      try {
        await fetch(`${API_BASE_URL}/routing/board/posts/${editingPost.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: postForm.title.trim(),
            content: postForm.content.trim(),
            visibility: postForm.visibility,
            targetClass: postForm.visibility === 'CLASS' ? postForm.targetClass : null,
            imageUrl: postForm.imageUrl,
          })
        });
      } catch (e) {
        console.warn('Update API failed, saved locally', e);
      }
    } else {
      // Create mode
      const newPost = {
        id: Date.now(),
        title: postForm.title.trim(),
        content: postForm.content.trim(),
        visibility: postForm.visibility,
        targetClass: postForm.visibility === 'CLASS' ? postForm.targetClass : null,
        imageUrl: postForm.imageUrl,
        images: [],
        authorName: postForm.authorName || defaultAuthorName,
        authorRole: isTeacher ? 'TEACHER' : 'ADMIN',
        likeCount: 0,
        likedUserIds: [],
        comments: [],
        createdAt: new Date().toISOString()
      };

      const updated = [newPost, ...posts];
      savePostsLocal(updated);
      setIsCreatingPost(false);

      try {
        const res = await fetch(`${API_BASE_URL}/routing/board/posts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newPost.title,
            content: newPost.content,
            visibility: newPost.visibility,
            targetClass: newPost.targetClass,
            imageUrl: newPost.imageUrl,
            authorName: newPost.authorName,
            authorRole: 'ADMIN',
            academyId: activeAcademyId ? Number(activeAcademyId) : undefined
          })
        });
        if (res.ok) {
          const savedData = await res.json();
          // Update id from server
          if (savedData?.id) {
            savePostsLocal(updated.map(p => p.id === newPost.id ? savedData : p));
          }
        }
      } catch (e) {
        console.warn('Create API failed, saved locally', e);
      }
    }

    // Reset Form
    setPostForm({
      title: '',
      content: '',
      visibility: 'ALL',
      targetClass: availableClasses[0] || '햇살반',
      imageUrl: PRESET_PHOTOS[0].url,
      authorName: currentUser?.name ? `${currentUser.name} 원장선생님` : '원장선생님',
    });
  };


  const canEditPost = (post) => {
    if (isAdmin) return true;
    if (isTeacher) {
      if (post.authorName && post.authorName.includes(currentUser.name)) return true;
      if (post.targetClass && post.targetClass.trim() === teacherClass.trim()) return true;
      if (post.authorRole === 'TEACHER' && post.targetClass === teacherClass) return true;
    }
    return false;
  };


  const handleDownloadCloudImage = async (e, imageUrl, title) => {
    e.stopPropagation();
    if (!imageUrl) return alert('다운로드할 사진이 없습니다.');
    try {
      const res = await fetch(imageUrl);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      const cleanTitle = (title || '유치원_활동사진').replace(/[^a-zA-Z0-9가-힣_-]/g, '_');
      link.download = `${cleanTitle}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      window.open(imageUrl, '_blank');
    }
  };

  const openEditModal = (post) => {
    setEditingPost(post);
    setPostForm({
      title: post.title,
      content: post.content,
      visibility: post.visibility || (isTeacher ? 'CLASS' : 'ALL'),
      targetClass: post.targetClass || (isTeacher ? teacherClass : availableClasses[0]) || '햇살반',
      imageUrl: post.imageUrl || PRESET_PHOTOS[0].url,
      authorName: post.authorName || defaultAuthorName,
      authorRole: post.authorRole || (isTeacher ? 'TEACHER' : 'ADMIN')
    });
    setIsCreatingPost(true);
  };

  return (
    <div className={`absolute inset-0 z-[2000] flex flex-col bg-slate-100 h-full overflow-hidden transition-all duration-300 ${isClosing ? 'animate-slide-out-right' : 'animate-slide-in-right'}`}>
      
      {/* Top Bar Header */}
      <div className="bg-white px-8 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 shadow-xs z-10">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
              <span>📸</span> 원아 활동 앨범 & 소식 게시판
            </h1>
            <span className="text-xs font-bold px-3 py-1 bg-blue-50 text-blue-700 rounded-full border border-blue-200">
              {selectedClass === 'ALL' ? '전체 보기' : selectedClass === 'PUBLIC_ONLY' ? '전체 공개글' : `${selectedClass} 전용`}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            학부모와 접속자는 자신이 속한 반의 사진과 전체 공개 소식만 열람할 수 있습니다. (현재 관리자 모드로 모든 반 조회 가능)
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Quick View Category Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600 border border-slate-200">
            <button
              onClick={() => setSelectedClass('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${selectedClass === 'ALL' ? 'bg-white text-blue-600 shadow-xs' : 'hover:text-slate-800'}`}
            >
              전체 게시글
            </button>
            {teacherClass && (
              <button
                onClick={() => setSelectedClass(teacherClass)}
                className={`px-3 py-1.5 rounded-lg transition-all ${selectedClass === teacherClass ? 'bg-white text-emerald-700 shadow-xs' : 'hover:text-slate-800'}`}
              >
                🌱 {teacherClass} 글
              </button>
            )}
            <button
              onClick={() => setSelectedClass('PUBLIC_ONLY')}
              className={`px-3 py-1.5 rounded-lg transition-all ${selectedClass === 'PUBLIC_ONLY' ? 'bg-white text-blue-600 shadow-xs' : 'hover:text-slate-800'}`}
            >
              📢 전체 공개 공지
            </button>
          </div>

          {/* Sort Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600 border border-slate-200">
            <button
              onClick={() => setSortBy('LATEST')}
              className={`px-3 py-1.5 rounded-lg transition-all ${sortBy === 'LATEST' ? 'bg-white text-blue-600 shadow-xs' : 'hover:text-slate-800'}`}
            >
              최신순
            </button>
            <button
              onClick={() => setSortBy('POPULAR')}
              className={`px-3 py-1.5 rounded-lg transition-all ${sortBy === 'POPULAR' ? 'bg-white text-blue-600 shadow-xs' : 'hover:text-slate-800'}`}
            >
              좋아요순 ❤️
            </button>
          </div>

          {/* New Post Button */}
          <button
            onClick={() => {
              setEditingPost(null);
              setPostForm({
                title: '',
                content: '',
                visibility: selectedClass !== 'ALL' && selectedClass !== 'PUBLIC_ONLY' ? 'CLASS' : 'ALL',
                targetClass: selectedClass !== 'ALL' && selectedClass !== 'PUBLIC_ONLY' ? selectedClass : (availableClasses[0] || '햇살반'),
                imageUrl: PRESET_PHOTOS[0].url,
                authorName: currentUser?.name ? `${currentUser.name} 원장선생님` : '원장선생님',
              });
              setIsCreatingPost(true);
            }}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black shadow-md hover:shadow-lg transition-all flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>새 사진/게시글 작성</span>
          </button>
        </div>
      </div>

      {/* Main Content Area - Grid of Cards */}
      <div className="flex-1 overflow-y-auto p-8 bg-slate-50/70">
        {isLoading ? (
          <div className="h-full flex flex-col items-center justify-center py-20 text-slate-400">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-sm font-bold">게시글과 앨범을 불러오는 중입니다...</p>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="h-full min-h-[400px] flex flex-col items-center justify-center py-20 bg-white rounded-3xl border border-dashed border-slate-300 text-center p-8">
            <div className="text-6xl mb-4">📷</div>
            <h3 className="text-lg font-black text-slate-800 mb-2">등록된 사진이나 게시글이 없습니다</h3>
            <p className="text-xs text-slate-500 max-w-md mb-6 leading-relaxed">
              {searchKeyword ? `'${searchKeyword}' 검색어와 일치하는 게시물이 없습니다.` : '원아들의 신나는 활동 사진이나 공지사항을 첫 번째로 등록해 보세요!'}
            </p>
            <button
              onClick={() => {
                setEditingPost(null);
                setIsCreatingPost(true);
              }}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black shadow-md transition-all"
            >
              + 첫 게시글 작성하기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
            {filteredPosts.map(post => {
              const currentUserId = currentUser?.id ? String(currentUser.id) : 'admin';
              const isLiked = Array.isArray(post.likedUserIds) && post.likedUserIds.includes(currentUserId);
              const isClassSpecific = post.visibility === 'CLASS' && post.targetClass;
              const isCommentExpanded = activeCommentPostId === post.id;
              const formattedDate = new Date(post.createdAt).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div
                  key={post.id}
                  className="bg-white rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden group"
                >
                  {/* [요구사항 반영 1] 메인 사진 위에 제목 */}
                  <div className="p-4 pb-3 bg-white border-b border-slate-100 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      {isClassSpecific ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                          <span>{post.targetClass} 전용</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-black px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span>📢 전체 공개</span>
                        </span>
                      )}

                      {/* Post Actions (Admin or Authorized Teacher) */}
                      {canEditPost(post) && (
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => openEditModal(post)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-xs font-bold"
                            title="게시글 수정"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => setPostToDelete(post)}
                            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors text-xs font-bold"
                            title="게시글 삭제"
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </div>

                    {/* 제목 */}
                    <h3 className="font-black text-slate-900 text-base leading-snug line-clamp-2 hover:text-blue-600 transition-colors" title={post.title}>
                      {post.title}
                    </h3>
                  </div>

                  {/* [요구사항 반영 2] 메인 사진 이미지 영역 */}
                  <div 
                    onClick={() => setPreviewImageUrl(post.imageUrl)}
                    className="relative w-full aspect-[16/10] bg-slate-100 overflow-hidden cursor-zoom-in"
                  >
                    {post.imageUrl ? (
                      <img
                        src={post.imageUrl}
                        alt={post.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                        <span className="text-4xl">🖼️</span>
                        <span className="text-xs mt-1 font-bold">등록된 사진 없음</span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <span className="opacity-0 group-hover:opacity-100 px-3 py-1.5 bg-black/60 text-white text-[11px] font-bold rounded-full backdrop-blur-xs transition-opacity shadow-sm">
                        🔍 크게 보기
                      </span>
                    </div>
                  </div>

                  {/* [요구사항 반영 3] 사진 아래 글 쓴이 & 본문 */}
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      {/* 글 쓴이 정보 */}
                      <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-500 text-white font-black text-xs flex items-center justify-center shadow-xs">
                            {post.authorName?.[0] || '원'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-black text-slate-800">{post.authorName}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.2 bg-slate-100 text-slate-600 rounded">
                                {post.authorRole === 'ADMIN' ? '원장/관리자' : post.authorRole === 'TEACHER' ? '선생님' : '학부모'}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400 block">{formattedDate}</span>
                          </div>
                        </div>
                      </div>

                      {/* 본문 내용 */}
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-3 mb-3 whitespace-pre-line font-normal">
                        {post.content}
                      </p>
                    </div>

                    {/* [요구사항 반영 4] 좋아요 및 댓글 인터랙션 바 */}
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {/* 좋아요 버튼 */}
                        <button
                          type="button"
                          onClick={() => handleToggleLike(post.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all transform active:scale-90 ${
                            isLiked 
                              ? 'bg-red-50 text-red-500 border border-red-200' 
                              : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          <span className={isLiked ? 'scale-110' : ''}>{isLiked ? '❤️' : '🤍'}</span>
                          <span>{post.likeCount || 0}</span>
                        </button>

                        {/* 댓글 버튼 (열기/접기 토글) */}
                        <button
                          type="button"
                          onClick={() => setActiveCommentPostId(isCommentExpanded ? null : post.id)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                            isCommentExpanded
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-slate-200'
                          }`}
                        >
                          <span>💬</span>
                          <span>댓글 {post.comments?.length || 0}</span>
                        </button>

                        {/* 클라우드 사진 원본 저장 버튼 */}
                        <button
                          type="button"
                          onClick={(e) => handleDownloadCloudImage(e, post.imageUrl, post.title)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all bg-slate-50 text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200"
                          title="클라우드 원본 사진 저장 (PC/휴대폰 다운로드)"
                        >
                          <span>💾</span>
                          <span>사진 저장</span>
                        </button>
                      </div>

                      <span className="text-[11px] text-slate-400 font-medium">
                        {isClassSpecific ? `${post.targetClass}` : '전체공개'}
                      </span>
                    </div>

                    {/* [요구사항 반영 5] 펼쳐지는 댓글 목록 및 입력창 */}
                    {isCommentExpanded && (
                      <div className="mt-3 pt-3 border-t border-dashed border-slate-200 animate-fade-in space-y-3">
                        <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                          <span>댓글 목록 ({post.comments?.length || 0})</span>
                          <span className="text-[10px] text-slate-400 font-normal">학부모 및 교직원 소통</span>
                        </div>

                        {/* 댓글 리스트 */}
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                          {(!post.comments || post.comments.length === 0) ? (
                            <p className="text-[11px] text-slate-400 text-center py-3 bg-slate-50 rounded-xl">
                              아직 등록된 댓글이 없습니다. 첫 댓글을 남겨보세요!
                            </p>
                          ) : (
                            post.comments.map(c => (
                              <div key={c.id} className="p-2.5 bg-slate-50 rounded-xl text-xs flex justify-between items-start group/comment">
                                <div>
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <span className="font-bold text-slate-800 text-[11px]">{c.authorName}</span>
                                    <span className="text-[9px] px-1 py-0.2 bg-slate-200 text-slate-600 rounded font-medium">
                                      {c.authorRole === 'ADMIN' ? '원장' : c.authorRole === 'TEACHER' ? '선생님' : '학부모'}
                                    </span>
                                    <span className="text-[10px] text-slate-400">
                                      {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                  <p className="text-slate-700 leading-normal">{c.content}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(post.id, c.id)}
                                  className="text-slate-300 hover:text-red-500 p-1 opacity-0 group-hover/comment:opacity-100 transition-opacity"
                                  title="댓글 삭제"
                                >
                                  ✕
                                </button>
                              </div>
                            ))
                          )}
                        </div>

                        {/* 댓글 입력창 */}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={commentInputs[post.id] || ''}
                            onChange={(e) => setCommentInputs(prev => ({ ...prev, [post.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(post.id); }}
                            placeholder="따뜻한 댓글을 남겨보세요..."
                            className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddComment(post.id)}
                            className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl shadow-xs transition-colors"
                          >
                            등록
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New / Edit Post Modal */}
      {isCreatingPost && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl p-6 sm:p-8 animate-scale-up border border-slate-100">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
              <div className="flex items-center gap-2">
                <span className="text-2xl">📸</span>
                <h3 className="text-xl font-black text-slate-800">
                  {editingPost ? '게시글 수정' : '새 원아 사진 및 소식 등록'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => { setIsCreatingPost(false); setEditingPost(null); }}
                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5">
              {/* 제목 */}
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">
                  게시글 제목 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={postForm.title}
                  onChange={(e) => setPostForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="예: 햇살반 가을 소풍 활동 사진입니다 🍂"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
              </div>

              {/* 공개 범위 선택 (전체 공개 vs 반별 공개) */}
              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-3">
                <label className="block text-xs font-black text-slate-700">
                  공개 범위 설정 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPostForm(prev => ({ ...prev, visibility: 'ALL' }))}
                    className={`py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all border ${
                      postForm.visibility === 'ALL'
                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>📢</span>
                    <span>전체 공개 (모든 학부모·교사)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPostForm(prev => ({ ...prev, visibility: 'CLASS' }))}
                    className={`py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all border ${
                      postForm.visibility === 'CLASS'
                        ? 'bg-orange-500 text-white border-orange-500 shadow-md'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <span>🔒</span>
                    <span>반별 전용 (선택한 반만 열람)</span>
                  </button>
                </div>

                {/* 반 선택 (반별 공개일 때만 노출) */}
                {postForm.visibility === 'CLASS' && (
                  <div className="pt-2 border-t border-slate-200 animate-fade-in flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-600 shrink-0">대상 반 선택:</span>
                    <select
                      value={postForm.targetClass}
                      onChange={(e) => setPostForm(prev => ({ ...prev, targetClass: e.target.value }))}
                      className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      {availableClasses.map(cls => (
                        <option key={cls} value={cls}>{cls}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* 메인 사진 선택 (프리셋 or PC 업로드 or URL) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-black text-slate-700">
                    메인 활동 사진 선택 <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 underline"
                  >
                    <span>📁 내 컴퓨터에서 사진 올리기</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                {/* 사진 미리보기 */}
                <div className="w-full h-44 bg-slate-100 rounded-2xl overflow-hidden mb-3 border border-slate-200 relative group">
                  {postForm.imageUrl ? (
                    <img
                      src={postForm.imageUrl}
                      alt="미리보기"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400">
                      <span>사진을 선택하세요</span>
                    </div>
                  )}
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-2.5 py-1 rounded-full font-bold backdrop-blur-xs">
                    메인 사진 미리보기
                  </div>
                </div>

                {/* 프리셋 선택지 */}
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 mb-1.5 block">
                    추천 유치원 테마 사진 (클릭하여 즉시 적용):
                  </span>
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {PRESET_PHOTOS.map((preset, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setPostForm(prev => ({ ...prev, imageUrl: preset.url }))}
                        className={`relative rounded-xl overflow-hidden aspect-video border-2 transition-all ${
                          postForm.imageUrl === preset.url ? 'border-blue-600 ring-2 ring-blue-300' : 'border-transparent hover:border-slate-300'
                        }`}
                        title={preset.name}
                      >
                        <img src={preset.url} alt={preset.name} className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 본문 내용 */}
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">
                  활동 내용 및 설명 <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={postForm.content}
                  onChange={(e) => setPostForm(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="원아들의 활동 이야기나 공지사항 내용을 자유롭게 작성해 주세요..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none"
                />
              </div>

              {/* 작성자 명 */}
              <div>
                <label className="block text-xs font-black text-slate-700 mb-1.5">작성자 명칭</label>
                <input
                  type="text"
                  value={postForm.authorName}
                  onChange={(e) => setPostForm(prev => ({ ...prev, authorName: e.target.value }))}
                  className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                />
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-3 pt-6 mt-6 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setIsCreatingPost(false); setEditingPost(null); }}
                className="flex-1 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleSavePost}
                className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl text-sm shadow-lg transition-all"
              >
                {editingPost ? '수정 완료' : '게시글 발행하기'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Post Modal */}
      {postToDelete && (
        <div className="fixed inset-0 z-[4000] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 text-center shadow-2xl animate-scale-up border border-slate-100">
            <div className="text-5xl mb-3">🗑️</div>
            <h3 className="text-lg font-black text-slate-800 mb-2">게시글을 삭제하시겠습니까?</h3>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              <b className="text-slate-800">'{postToDelete.title}'</b><br />
              삭제된 게시글과 첨부된 사진, 댓글은 복구할 수 없습니다.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPostToDelete(null)}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => handleDeletePost(postToDelete.id)}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-xs shadow-md transition-colors"
              >
                삭제 확정
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Preview Modal */}
      {previewImageUrl && (
        <div 
          onClick={() => setPreviewImageUrl(null)}
          className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/85 backdrop-blur-md p-4 animate-fade-in cursor-zoom-out"
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center">
            <img
              src={previewImageUrl}
              alt="확대 이미지"
              className="max-w-full max-h-[85vh] object-contain rounded-2xl shadow-2xl animate-scale-up"
            />
            <button
              onClick={() => setPreviewImageUrl(null)}
              className="mt-4 px-6 py-2 bg-white/20 hover:bg-white/30 text-white font-bold text-xs rounded-full backdrop-blur-sm transition-colors"
            >
              닫기 (클릭)
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
