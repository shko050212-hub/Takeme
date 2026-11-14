import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class ClassBoardScreen extends StatefulWidget {
  final String? childClassName;
  final bool isEmbeddedTab;
  /// main 호환용 별칭 (isEmbeddedTab 과 같은 의미)
  final bool isEmbedded;
  final String initialCategory;

  const ClassBoardScreen({
    super.key,
    this.childClassName,
    this.isEmbeddedTab = false,
    this.isEmbedded = false,
    this.initialCategory = 'ALL',
  });

  @override
  State<ClassBoardScreen> createState() => _ClassBoardScreenState();
}

class _ClassBoardScreenState extends State<ClassBoardScreen> {
  List<Map<String, dynamic>> _posts = [];
  bool _isLoading = true;
  late String _selectedCategory;

  @override
  void initState() {
    super.initState();
    _selectedCategory = widget.initialCategory;
    _loadPosts();
  }

  Future<void> _loadPosts() async {
    final user = ApiService().currentUser;
    if (user == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }

    final list = await ApiService().getClassBoardPosts(
      user.email,
      postType: _selectedCategory == 'ALL' ? null : _selectedCategory,
    );
    if (mounted) {
      setState(() {
        _posts = list;
        _isLoading = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filteredPosts {
    if (_selectedCategory == 'ALL') return _posts;
    return _posts.where((p) => (p['postType'] ?? 'POST') == _selectedCategory).toList();
  }

  String _formatDate(dynamic dateVal) {
    if (dateVal == null) return '';
    try {
      final dt = DateTime.parse(dateVal.toString());
      return '${dt.year}.${dt.month.toString().padLeft(2, '0')}.${dt.day.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return dateVal.toString();
    }
  }

  void _openDetail(Map<String, dynamic> post) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ClassBoardDetailScreen(post: post)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final classLabel = widget.childClassName != null && widget.childClassName!.isNotEmpty
        ? '${widget.childClassName} 알림장·게시판'
        : '우리 반 알림장·게시판';

    final displayPosts = _filteredPosts;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        automaticallyImplyLeading: !(widget.isEmbeddedTab || widget.isEmbedded),
        title: Text(
          classLabel,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFF0F172A)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        iconTheme: const IconThemeData(color: Color(0xFF0F172A)),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: Column(
        children: [
          // Category Filter Chips: 전체 · 알림장 · 게시물
          Container(
            color: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                ChoiceChip(
                  label: const Text('전체'),
                  selected: _selectedCategory == 'ALL',
                  onSelected: (_) {
                    setState(() => _selectedCategory = 'ALL');
                    _loadPosts();
                  },
                  selectedColor: const Color(0xFF0F172A),
                  labelStyle: TextStyle(
                    color: _selectedCategory == 'ALL' ? Colors.white : const Color(0xFF475569),
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  avatar: Icon(Icons.campaign, size: 14, color: _selectedCategory == 'NOTICE' ? Colors.white : const Color(0xFFEA580C)),
                  label: const Text('알림장'),
                  selected: _selectedCategory == 'NOTICE',
                  onSelected: (_) {
                    setState(() => _selectedCategory = 'NOTICE');
                    _loadPosts();
                  },
                  selectedColor: const Color(0xFFEA580C),
                  labelStyle: TextStyle(
                    color: _selectedCategory == 'NOTICE' ? Colors.white : const Color(0xFFEA580C),
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(width: 8),
                ChoiceChip(
                  avatar: Icon(Icons.article, size: 14, color: _selectedCategory == 'POST' ? Colors.white : const Color(0xFF2563EB)),
                  label: const Text('게시물'),
                  selected: _selectedCategory == 'POST',
                  onSelected: (_) {
                    setState(() => _selectedCategory = 'POST');
                    _loadPosts();
                  },
                  selectedColor: const Color(0xFF2563EB),
                  labelStyle: TextStyle(
                    color: _selectedCategory == 'POST' ? Colors.white : const Color(0xFF2563EB),
                    fontWeight: FontWeight.bold,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          Container(color: const Color(0xFFF1F5F9), height: 1),

          Expanded(
            child: _isLoading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
                : RefreshIndicator(
                    onRefresh: _loadPosts,
                    child: displayPosts.isEmpty
                        ? Center(
                            child: SingleChildScrollView(
                              physics: const AlwaysScrollableScrollPhysics(),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Container(
                                    padding: const EdgeInsets.all(22),
                                    decoration: const BoxDecoration(
                                      color: Color(0xFFEFF6FF),
                                      shape: BoxShape.circle,
                                    ),
                                    child: const Icon(
                                      Icons.article_outlined,
                                      size: 48,
                                      color: Color(0xFF2563EB),
                                    ),
                                  ),
                                  const SizedBox(height: 18),
                                  Text(
                                    _selectedCategory == 'NOTICE'
                                        ? '등록된 알림장이 없습니다'
                                        : _selectedCategory == 'POST'
                                            ? '등록된 게시물이 없습니다'
                                            : '등록된 글이 없습니다',
                                    style: const TextStyle(
                                      fontSize: 17,
                                      fontWeight: FontWeight.bold,
                                      color: Color(0xFF334155),
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  const Text(
                                    '선생님이 새로운 알림장이나 게시물을 등록하면 여기에 표시됩니다.',
                                    style: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                            itemCount: displayPosts.length,
                            separatorBuilder: (context, index) => const SizedBox(height: 12),
                            itemBuilder: (context, index) {
                              final post = displayPosts[index];
                              final title = post['title']?.toString() ?? '제목 없음';
                              final content = post['content']?.toString() ?? '';
                              final author = post['authorName']?.toString() ?? '선생님';
                              final targetClass = post['targetClass']?.toString() ?? post['className']?.toString();
                              final isClassOnly = targetClass != null && targetClass.isNotEmpty;
                              final dateStr = _formatDate(post['createdAt']);
                              final isNotice = post['postType'] == 'NOTICE';

                              final List<dynamic> images = post['images'] is List ? post['images'] : [];
                              final singleImage = post['imageUrl']?.toString();
                              final hasImage = (singleImage != null && singleImage.isNotEmpty) || images.isNotEmpty;
                              final thumbUrl = (singleImage != null && singleImage.isNotEmpty)
                                  ? singleImage
                                  : (images.isNotEmpty ? images.first.toString() : null);

                              return Material(
                                color: Colors.transparent,
                                child: InkWell(
                                  onTap: () => _openDetail(post),
                                  borderRadius: BorderRadius.circular(16),
                                  child: Container(
                                    padding: const EdgeInsets.all(16),
                                    decoration: BoxDecoration(
                                      color: Colors.white,
                                      borderRadius: BorderRadius.circular(16),
                                      border: Border.all(color: const Color(0xFFE2E8F0)),
                                      boxShadow: [
                                        BoxShadow(
                                          color: const Color(0xFF0F172A).withValues(alpha: 0.03),
                                          blurRadius: 6,
                                          offset: const Offset(0, 2),
                                        ),
                                      ],
                                    ),
                                    child: Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Row(
                                                children: [
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: isClassOnly ? const Color(0xFFDBEAFE) : const Color(0xFFF1F5F9),
                                                      borderRadius: BorderRadius.circular(6),
                                                    ),
                                                    child: Text(
                                                      isClassOnly ? targetClass : '전체 공지',
                                                      style: TextStyle(
                                                        color: isClassOnly ? const Color(0xFF1D4ED8) : const Color(0xFF475569),
                                                        fontSize: 11,
                                                        fontWeight: FontWeight.bold,
                                                      ),
                                                    ),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  // Category Badge (주황 알림장 / 파랑 게시물)
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: isNotice ? const Color(0xFFFFF7ED) : const Color(0xFFEFF6FF),
                                                      borderRadius: BorderRadius.circular(6),
                                                      border: Border.all(
                                                        color: isNotice ? const Color(0xFFFDBA74) : const Color(0xFFBFDBFE),
                                                        width: 0.8,
                                                      ),
                                                    ),
                                                    child: Text(
                                                      isNotice ? '알림장' : '게시물',
                                                      style: TextStyle(
                                                        color: isNotice ? const Color(0xFFEA580C) : const Color(0xFF2563EB),
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                      ),
                                                    ),
                                                  ),
                                                  const SizedBox(width: 8),
                                                  Text(
                                                    author,
                                                    style: const TextStyle(
                                                      fontSize: 12,
                                                      color: Color(0xFF64748B),
                                                      fontWeight: FontWeight.w600,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                        const SizedBox(height: 8),
                                        Text(
                                          title,
                                          style: const TextStyle(
                                            fontSize: 15,
                                            fontWeight: FontWeight.w800,
                                            color: Color(0xFF0F172A),
                                          ),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          content,
                                          style: const TextStyle(
                                            fontSize: 13,
                                            height: 1.4,
                                            color: Color(0xFF475569),
                                          ),
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        const SizedBox(height: 8),
                                        Text(
                                          dateStr,
                                          style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                                        ),
                                      ],
                                    ),
                                  ),
                                  if (hasImage && thumbUrl != null) ...[
                                    const SizedBox(width: 12),
                                    ClipRRect(
                                      borderRadius: BorderRadius.circular(10),
                                      child: Image.network(
                                        thumbUrl,
                                        width: 72,
                                        height: 72,
                                        fit: BoxFit.cover,
                                        errorBuilder: (ctx, err, stack) => Container(
                                          width: 72,
                                          height: 72,
                                          color: const Color(0xFFF1F5F9),
                                          child: const Icon(Icons.broken_image_outlined, color: Color(0xFF94A3B8)),
                                        ),
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class ClassBoardDetailScreen extends StatelessWidget {
  final Map<String, dynamic> post;

  const ClassBoardDetailScreen({super.key, required this.post});

  String _formatDate(dynamic dateVal) {
    if (dateVal == null) return '';
    try {
      final dt = DateTime.parse(dateVal.toString());
      return '${dt.year}년 ${dt.month}월 ${dt.day}일 ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return dateVal.toString();
    }
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
    final title = post['title']?.toString() ?? '제목 없음';
    final content = post['content']?.toString() ?? '';
    final author = post['authorName']?.toString() ?? '선생님';
    final targetClass = post['targetClass']?.toString() ?? post['className']?.toString();
    final isClassOnly = targetClass != null && targetClass.isNotEmpty;
    final dateStr = _formatDate(post['createdAt']);

    final List<String> allImages = [];
    if (post['imageUrl'] != null && post['imageUrl'].toString().isNotEmpty) {
      allImages.add(post['imageUrl'].toString());
    }
    if (post['images'] is List) {
      for (final img in (post['images'] as List)) {
        final url = img?.toString();
        if (url != null && url.isNotEmpty && !allImages.contains(url)) {
          allImages.add(url);
        }
      }
    }

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: Text(
          post['postType'] == 'NOTICE' ? '알림장 상세' : '게시물 상세',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFF0F172A)),
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
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: isClassOnly ? const Color(0xFFDBEAFE) : const Color(0xFFF1F5F9),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    isClassOnly ? targetClass : '전체 공지',
                    style: TextStyle(
                      color: isClassOnly ? const Color(0xFF1D4ED8) : const Color(0xFF475569),
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
                  decoration: BoxDecoration(
                    color: post['postType'] == 'NOTICE' ? const Color(0xFFFFF7ED) : const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: post['postType'] == 'NOTICE' ? const Color(0xFFFDBA74) : const Color(0xFFBFDBFE),
                      width: 0.8,
                    ),
                  ),
                  child: Text(
                    post['postType'] == 'NOTICE' ? '알림장' : '게시물',
                    style: TextStyle(
                      color: post['postType'] == 'NOTICE' ? const Color(0xFFEA580C) : const Color(0xFF2563EB),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const Spacer(),
                Text(
                  dateStr,
                  style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              title,
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Color(0xFF0F172A),
                height: 1.3,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.account_circle, size: 20, color: Color(0xFF64748B)),
                const SizedBox(width: 6),
                Text(
                  author,
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Color(0xFF475569)),
                ),
              ],
            ),
            const SizedBox(height: 16),
            const Divider(color: Color(0xFFF1F5F9)),
            const SizedBox(height: 16),
            Text(
              content,
              style: const TextStyle(
                fontSize: 15,
                height: 1.7,
                color: Color(0xFF334155),
              ),
            ),
            if (allImages.isNotEmpty) ...[
              const SizedBox(height: 24),
              const Text(
                '첨부 사진 (터치하여 확대)',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 10),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: allImages.length,
                separatorBuilder: (ctx, idx) => const SizedBox(height: 12),
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
                            errorBuilder: (c, e, s) => Container(
                              height: 180,
                              color: const Color(0xFFF1F5F9),
                              child: const Center(
                                child: Icon(Icons.broken_image_outlined, color: Color(0xFF94A3B8), size: 36),
                              ),
                            ),
                          ),
                          Container(
                            margin: const EdgeInsets.all(10),
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.black.withValues(alpha: 0.6),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: const Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.zoom_in, color: Colors.white, size: 16),
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
          ],
        ),
      ),
    );
  }
}
