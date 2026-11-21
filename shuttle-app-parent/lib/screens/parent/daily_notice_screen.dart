import 'package:flutter/material.dart';
import '../../services/api_service.dart';

/// 학부모용 일일 알림장 전용 화면
/// 담임선생님이 보내는 알림장, 가정통신문, 오늘의 활동 및 준비물 전달 전용
class DailyNoticeScreen extends StatefulWidget {
  final String? childClassName;
  final bool isEmbedded;

  const DailyNoticeScreen({
    super.key,
    this.childClassName,
    this.isEmbedded = false,
  });

  @override
  State<DailyNoticeScreen> createState() => _DailyNoticeScreenState();
}

class _DailyNoticeScreenState extends State<DailyNoticeScreen> {
  List<Map<String, dynamic>> _notices = [];
  bool _isLoading = true;
  final Set<int> _confirmedNoticeIds = {}; // 확인 완료한 알림장 ID
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadNotices();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// 검색어가 제목·내용·작성자에 들어 있는 알림장만
  List<Map<String, dynamic>> get _shownNotices {
    if (_searchQuery.isEmpty) return _notices;
    final q = _searchQuery.toLowerCase();
    return _notices.where((n) {
      final text = '${n['title'] ?? ''} ${n['content'] ?? ''} ${n['authorName'] ?? ''}'.toLowerCase();
      return text.contains(q);
    }).toList();
  }

  Future<void> _loadNotices() async {
    final user = ApiService().currentUser;
    if (user == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }

    try {
      final list = await ApiService().getClassBoardPosts(user.email);
      // 알림장 피드: 학급 타겟팅 글 및 공지 우선 필터링
      if (mounted) {
        setState(() {
          _notices = list;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  String _formatDate(dynamic dateVal) {
    if (dateVal == null) return '';
    try {
      final dt = DateTime.parse(dateVal.toString());
      return '${dt.year}.${dt.month.toString().padLeft(2, '0')}.${dt.day.toString().padLeft(2, '0')}';
    } catch (_) {
      return dateVal.toString();
    }
  }

  void _openDetail(Map<String, dynamic> notice) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => DailyNoticeDetailScreen(
          notice: notice,
          isConfirmed: _confirmedNoticeIds.contains(notice['id']),
          onConfirmChanged: (confirmed) {
            setState(() {
              if (confirmed) {
                _confirmedNoticeIds.add(notice['id'] as int);
              } else {
                _confirmedNoticeIds.remove(notice['id'] as int);
              }
            });
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final className = widget.childClassName?.isNotEmpty == true ? widget.childClassName! : '우리 반';

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        automaticallyImplyLeading: !widget.isEmbedded,
        elevation: 0,
        backgroundColor: Colors.white,
        centerTitle: false,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: const Color(0xFFEFF6FF),
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: const Color(0xFFBFDBFE)),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.menu_book_rounded, color: Color(0xFF2563EB), size: 16),
                  const SizedBox(width: 6),
                  Text(
                    '$className 알림장',
                    style: const TextStyle(
                      color: Color(0xFF1E40AF),
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: Color(0xFF475569)),
            tooltip: '새로고침',
            onPressed: () {
              setState(() => _isLoading = true);
              _loadNotices();
            },
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : RefreshIndicator(
              onRefresh: _loadNotices,
              color: const Color(0xFF2563EB),
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                children: [
                  // 상단 담임교사 알림장 안내 카드
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF3B82F6), Color(0xFF1D4ED8)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFF2563EB).withValues(alpha: 0.2),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(
                            color: Colors.white.withValues(alpha: 0.2),
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.campaign_rounded, color: Colors.white, size: 26),
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '$className 담임선생님 일일 알림장',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 3),
                              const Text(
                                '오늘의 활동, 내일 준비물, 귀가 전달사항을 매일 확인해주세요.',
                                style: TextStyle(
                                  color: Color(0xFFDBEAFE),
                                  fontSize: 12,
                                  height: 1.3,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 14),

                  // 검색창
                  Container(
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: TextField(
                      controller: _searchController,
                      textInputAction: TextInputAction.search,
                      onChanged: (val) => setState(() => _searchQuery = val.trim()),
                      decoration: InputDecoration(
                        hintText: '알림장 제목, 내용 검색',
                        hintStyle: const TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                        prefixIcon: const Icon(Icons.search_rounded, size: 20, color: Color(0xFF64748B)),
                        suffixIcon: _searchQuery.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear_rounded, size: 18, color: Color(0xFF94A3B8)),
                                onPressed: () {
                                  _searchController.clear();
                                  setState(() => _searchQuery = '');
                                },
                              )
                            : null,
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                    ),
                  ),

                  const SizedBox(height: 14),

                  // 알림장 피드 목록
                  if (_shownNotices.isEmpty && _searchQuery.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 40),
                      child: Text(
                        "'$_searchQuery' 검색 결과가 없습니다.",
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 14, color: Color(0xFF64748B)),
                      ),
                    )
                  else if (_notices.isEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 60),
                      alignment: Alignment.center,
                      child: Column(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(18),
                            decoration: const BoxDecoration(
                              color: Color(0xFFF1F5F9),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.assignment_turned_in_outlined,
                              size: 42,
                              color: Color(0xFF94A3B8),
                            ),
                          ),
                          const SizedBox(height: 14),
                          const Text(
                            '등록된 알림장이 없습니다',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: Color(0xFF475569),
                            ),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            '담임선생님이 작성한 일일 알림장이 도착하면 여기에 표시됩니다.',
                            style: TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                          ),
                        ],
                      ),
                    )
                  else
                    ..._shownNotices.map((notice) => _buildNoticeCard(notice)),
                ],
              ),
            ),
    );
  }

  Widget _buildNoticeCard(Map<String, dynamic> notice) {
    final id = notice['id'] as int? ?? 0;
    final title = notice['title']?.toString() ?? '알림장';
    final content = notice['content']?.toString() ?? '';
    final author = notice['authorName']?.toString() ?? '담임선생님';
    final dateStr = _formatDate(notice['createdAt']);
    final isConfirmed = _confirmedNoticeIds.contains(id);

    final List<dynamic> images = notice['images'] is List ? notice['images'] : [];
    final singleImage = notice['imageUrl']?.toString();
    final hasImage = (singleImage != null && singleImage.isNotEmpty) || images.isNotEmpty;
    final thumbUrl = (singleImage != null && singleImage.isNotEmpty)
        ? singleImage
        : (images.isNotEmpty ? images.first.toString() : null);

    final isPreparation = title.contains('준비물') || content.contains('준비물');
    final isNotice = title.contains('가정통신문') || title.contains('안내') || title.contains('공지');

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isConfirmed ? const Color(0xFFE2E8F0) : const Color(0xFFBFDBFE),
          width: isConfirmed ? 1 : 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.03),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _openDetail(notice),
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 카드 상단 헤더: 태그 & 날짜 & 확인 여부
                Row(
                  children: [
                    if (isPreparation)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        margin: const EdgeInsets.only(right: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFFEF3C7),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.backpack_rounded, size: 12, color: Color(0xFFD97706)),
                            SizedBox(width: 4),
                            Text('준비물', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFFD97706))),
                          ],
                        ),
                      )
                    else if (isNotice)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        margin: const EdgeInsets.only(right: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEEF2FF),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.assignment_outlined, size: 12, color: Color(0xFF4F46E5)),
                            SizedBox(width: 4),
                            Text('가정통신', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF4F46E5))),
                          ],
                        ),
                      )
                    else
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        margin: const EdgeInsets.only(right: 6),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEFF6FF),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.rate_review_rounded, size: 12, color: Color(0xFF2563EB)),
                            SizedBox(width: 4),
                            Text('오늘의 알림', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB))),
                          ],
                        ),
                      ),
                    Text(
                      author,
                      style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                    ),
                    const Spacer(),
                    // 학부모 확인 배지
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                      decoration: BoxDecoration(
                        color: isConfirmed ? const Color(0xFFECFDF5) : const Color(0xFFFEF2F2),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            isConfirmed ? Icons.check_circle_rounded : Icons.pending_rounded,
                            size: 11,
                            color: isConfirmed ? const Color(0xFF059669) : const Color(0xFFDC2626),
                          ),
                          const SizedBox(width: 3),
                          Text(
                            isConfirmed ? '확인완료' : '미확인',
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: isConfirmed ? const Color(0xFF059669) : const Color(0xFFDC2626),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),

                const SizedBox(height: 10),

                // 제목
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: Color(0xFF0F172A),
                    height: 1.3,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),

                const SizedBox(height: 6),

                // 본문 미리보기 및 썸네일
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        content,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.45,
                          color: Color(0xFF475569),
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (hasImage && thumbUrl != null) ...[
                      const SizedBox(width: 12),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(
                          thumbUrl,
                          width: 64,
                          height: 64,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            width: 64,
                            height: 64,
                            color: const Color(0xFFF1F5F9),
                            child: const Icon(Icons.image_not_supported_outlined, color: Color(0xFF94A3B8), size: 24),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),

                const SizedBox(height: 12),

                // 하단 날짜 & 읽음 확인 버튼
                Row(
                  children: [
                    const Icon(Icons.calendar_today_rounded, size: 12, color: Color(0xFF94A3B8)),
                    const SizedBox(width: 4),
                    Text(dateStr, style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8))),
                    const Spacer(),
                    InkWell(
                      onTap: () {
                        setState(() {
                          if (isConfirmed) {
                            _confirmedNoticeIds.remove(id);
                          } else {
                            _confirmedNoticeIds.add(id);
                          }
                        });
                      },
                      borderRadius: BorderRadius.circular(8),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        child: Row(
                          children: [
                            Icon(
                              isConfirmed ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                              size: 16,
                              color: isConfirmed ? const Color(0xFF2563EB) : const Color(0xFF94A3B8),
                            ),
                            const SizedBox(width: 4),
                            Text(
                              isConfirmed ? '확인 취소' : '확인했어요',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: isConfirmed ? const Color(0xFF2563EB) : const Color(0xFF64748B),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 알림장 상세 화면
class DailyNoticeDetailScreen extends StatefulWidget {
  final Map<String, dynamic> notice;
  final bool isConfirmed;
  final ValueChanged<bool> onConfirmChanged;

  const DailyNoticeDetailScreen({
    super.key,
    required this.notice,
    required this.isConfirmed,
    required this.onConfirmChanged,
  });

  @override
  State<DailyNoticeDetailScreen> createState() => _DailyNoticeDetailScreenState();
}

class _DailyNoticeDetailScreenState extends State<DailyNoticeDetailScreen> {
  late bool _confirmed;

  @override
  void initState() {
    super.initState();
    _confirmed = widget.isConfirmed;
  }

  void _openImageZoom(BuildContext context, String imageUrl) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.black,
            iconTheme: const IconThemeData(color: Colors.white),
            elevation: 0,
            title: const Text('사진 확대', style: TextStyle(color: Colors.white, fontSize: 16)),
          ),
          body: Center(
            child: InteractiveViewer(
              panEnabled: true,
              minScale: 0.8,
              maxScale: 4.0,
              child: Image.network(
                imageUrl,
                fit: BoxFit.contain,
                errorBuilder: (ctx, err, stack) => const Center(
                  child: Text('이미지를 불러올 수 없습니다.', style: TextStyle(color: Colors.white)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final title = widget.notice['title']?.toString() ?? '알림장';
    final content = widget.notice['content']?.toString() ?? '';
    final author = widget.notice['authorName']?.toString() ?? '담임선생님';
    final dateStr = widget.notice['createdAt']?.toString() ?? '';

    final List<String> allImages = [];
    if (widget.notice['imageUrl'] != null && widget.notice['imageUrl'].toString().isNotEmpty) {
      allImages.add(widget.notice['imageUrl'].toString());
    }
    if (widget.notice['images'] is List) {
      for (final img in (widget.notice['images'] as List)) {
        final url = img?.toString();
        if (url != null && url.isNotEmpty && !allImages.contains(url)) {
          allImages.add(url);
        }
      }
    }

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: const Text(
          '알림장 상세',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFF0F172A)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        iconTheme: const IconThemeData(color: Color(0xFF0F172A)),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 태그 및 작성자
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    '우리 반 알림장',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF1D4ED8)),
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  author,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF475569)),
                ),
                const Spacer(),
                Text(
                  dateStr.length >= 10 ? dateStr.substring(0, 10) : dateStr,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                ),
              ],
            ),

            const SizedBox(height: 14),

            // 알림장 제목
            Text(
              title,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
                color: Color(0xFF0F172A),
                height: 1.35,
              ),
            ),

            const SizedBox(height: 16),
            const Divider(color: Color(0xFFF1F5F9), thickness: 1),
            const SizedBox(height: 16),

            // 알림장 본문
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFFF8FAFC),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0)),
              ),
              child: Text(
                content,
                style: const TextStyle(
                  fontSize: 15,
                  height: 1.7,
                  color: Color(0xFF334155),
                ),
              ),
            ),

            // 사진 첨부 목록
            if (allImages.isNotEmpty) ...[
              const SizedBox(height: 24),
              Row(
                children: [
                  const Icon(Icons.photo_library_outlined, size: 18, color: Color(0xFF2563EB)),
                  const SizedBox(width: 6),
                  Text(
                    '오늘의 활동 사진 (${allImages.length}장)',
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: allImages.length,
                separatorBuilder: (_, __) => const SizedBox(height: 12),
                itemBuilder: (ctx, idx) {
                  final imgUrl = allImages[idx];
                  return GestureDetector(
                    onTap: () => _openImageZoom(context, imgUrl),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(14),
                      child: Stack(
                        alignment: Alignment.bottomRight,
                        children: [
                          Image.network(
                            imgUrl,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) => Container(
                              height: 180,
                              color: const Color(0xFFF1F5F9),
                              child: const Center(
                                child: Icon(Icons.broken_image_outlined, color: Color(0xFF94A3B8), size: 36),
                              ),
                            ),
                          ),
                          Container(
                            margin: const EdgeInsets.all(10),
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.6),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.zoom_in, color: Colors.white, size: 14),
                                SizedBox(width: 4),
                                Text(
                                  '확대보기',
                                  style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ],

            const SizedBox(height: 30),

            // 학부모 확인 완료 버튼
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton.icon(
                onPressed: () {
                  setState(() => _confirmed = !_confirmed);
                  widget.onConfirmChanged(_confirmed);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(_confirmed ? '알림장을 확인 완료했습니다.' : '알림장 확인 상태를 해제했습니다.'),
                      backgroundColor: _confirmed ? const Color(0xFF10B981) : const Color(0xFF64748B),
                    ),
                  );
                },
                icon: Icon(
                  _confirmed ? Icons.check_circle_rounded : Icons.check_circle_outline_rounded,
                  color: Colors.white,
                ),
                label: Text(
                  _confirmed ? '담임선생님 알림장 확인 완료됨' : '알림장 내용 확인했습니다',
                  style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.bold),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: _confirmed ? const Color(0xFF059669) : const Color(0xFF2563EB),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  elevation: 0,
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}

