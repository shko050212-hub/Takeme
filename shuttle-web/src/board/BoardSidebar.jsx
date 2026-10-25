import React from 'react';

export default function BoardSidebar({
  selectedClass = 'ALL',
  setSelectedClass,
  availableClasses = [],
  searchKeyword = '',
  setSearchKeyword,
  onOpenNewPost,
  posts = [],
}) {
  const totalPostsCount = posts.length;
  const publicPostsCount = posts.filter(p => p.visibility === 'ALL').length;

  const getClassCount = (cls) => {
    return posts.filter(p => p.visibility === 'CLASS' && p.targetClass === cls).length;
  };

  const totalLikes = posts.reduce((sum, p) => sum + (p.likeCount || 0), 0);
  const totalComments = posts.reduce((sum, p) => sum + (p.comments?.length || 0), 0);

  return (
    <div className="flex flex-col h-full bg-white select-none">
      {/* Header */}
      <div className="p-5 border-b border-slate-100 bg-white">
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
            <span>원아 앨범 · 게시판</span>
          </h2>
          <span className="text-[11px] font-bold px-2.5 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-100">
            관리자 모드
          </span>
        </div>
        <p className="text-xs text-slate-500 font-medium leading-relaxed">
          원아들의 활동 사진과 공지사항을 반별 또는 전체 공개로 등록하고 관리하세요.
        </p>
      </div>

      <div className="p-4 flex flex-col gap-4 flex-1 overflow-y-auto">
        {/* New Post Button */}
        <button
          type="button"
          onClick={onOpenNewPost}
          className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-2xl font-black text-sm shadow-md hover:shadow-lg transition-all transform active:scale-98 flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
          <span>새 게시글 / 사진 등록</span>
        </button>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="제목, 본문, 작성자 검색..."
            className="w-full pl-9 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
          />
          <svg className="w-4 h-4 text-slate-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {searchKeyword && (
            <button
              onClick={() => setSearchKeyword('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs p-0.5"
            >
              ✕
            </button>
          )}
        </div>

        {/* Class Filter */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 px-1">
            <span>공개 범위 및 반별 필터</span>
            <span className="text-[11px] text-slate-400 font-normal">총 {totalPostsCount}개</span>
          </div>

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedClass('ALL')}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                selectedClass === 'ALL'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-100'
              }`}
            >
              <span>전체 게시물 보기</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-black ${
                selectedClass === 'ALL' ? 'bg-blue-500/50 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {totalPostsCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSelectedClass('PUBLIC_ONLY')}
              className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all ${
                selectedClass === 'PUBLIC_ONLY'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-100'
              }`}
            >
              <span>전체 공개글만 보기</span>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-black ${
                selectedClass === 'PUBLIC_ONLY' ? 'bg-emerald-500/50 text-white' : 'bg-slate-200 text-slate-600'
              }`}>
                {publicPostsCount}
              </span>
            </button>

            <div className="pt-2 border-t border-dashed border-slate-200">
              <span className="text-[11px] font-semibold text-slate-400 px-1 mb-1.5 block">
                반별 전용 사진첩
              </span>
              <div className="space-y-1">
                {availableClasses.map(cls => {
                  const isSelected = selectedClass === cls;
                  const count = getClassCount(cls);
                  return (
                    <button
                      key={cls}
                      type="button"
                      onClick={() => setSelectedClass(cls)}
                      className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                        isSelected
                          ? 'bg-orange-500 text-white shadow-sm'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-orange-400"></span>
                        <span>{cls} 사진첩</span>
                      </div>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-black ${
                        isSelected ? 'bg-orange-400/50 text-white' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Board Statistics Card */}
        <div className="mt-auto p-4 bg-slate-50 rounded-2xl border border-slate-200">
          <h4 className="text-xs font-bold text-slate-700 mb-2.5">
            게시판 활동 현황
          </h4>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-[10px] text-slate-400 block font-medium">게시글</span>
              <span className="text-sm font-black text-slate-800">{totalPostsCount}개</span>
            </div>
            <div className="bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-[10px] text-slate-400 block font-medium">좋아요</span>
              <span className="text-sm font-black text-red-500">{totalLikes}</span>
            </div>
            <div className="bg-white p-2 rounded-xl border border-slate-100 shadow-2xs">
              <span className="text-[10px] text-slate-400 block font-medium">댓글</span>
              <span className="text-sm font-black text-blue-600">{totalComments}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
