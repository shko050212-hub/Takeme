import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../../services/api_service.dart';

class TeacherBoardView extends StatefulWidget {
  const TeacherBoardView({super.key});

  @override
  State<TeacherBoardView> createState() => _TeacherBoardViewState();
}

class _TeacherBoardViewState extends State<TeacherBoardView> {
  List<Map<String, dynamic>> _posts = [];
  bool _isLoading = true;
  String _searchKeyword = '';
  String _selectedClassFilter = 'ALL';
  final _searchController = TextEditingController();

  final List<String> _classList = const [
    'ALL',
    '햇살반',
    '열매반',
    '풀잎반',
    '새싹반',
    '심화B반',
  ];

  @override
  void initState() {
    super.initState();
    _loadPosts();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadPosts() async {
    setState(() => _isLoading = true);
    final user = ApiService().currentUser;
    final posts = await ApiService().getBoardPosts(
      academyId: user?.academyId,
      search: _searchKeyword.isNotEmpty ? _searchKeyword : null,
    );
    if (mounted) {
      setState(() {
        _posts = posts;
        _isLoading = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filteredPosts {
    if (_selectedClassFilter == 'ALL') {
      return _posts;
    }
    return _posts.where((p) {
      if (p['visibility'] == 'ALL') return true;
      final target = p['targetClass']?.toString() ?? '';
      return target == _selectedClassFilter;
    }).toList();
  }

  void _showCreatePostModal() {
    final titleCtrl = TextEditingController();
    final contentCtrl = TextEditingController();
    String visibility = 'ALL';
    String selectedClass = '햇살반';
    final List<XFile> pickedImages = [];
    bool isUploading = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          final bottomInset = MediaQuery.of(context).viewInsets.bottom;
          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 24,
              bottom: bottomInset + 24,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        '클라우드 게시글 작성',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w800,
                          color: Color(0xFF0F172A),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, color: Color(0xFF64748B)),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),

                  // Visibility & Target Class Selector
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<String>(
                          initialValue: visibility,
                          decoration: InputDecoration(
                            labelText: '공개 범위',
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                          items: const [
                            DropdownMenuItem(value: 'ALL', child: Text('전체 공개')),
                            DropdownMenuItem(value: 'CLASS', child: Text('특정 반 전용')),
                          ],
                          onChanged: (val) {
                            if (val != null) {
                              setModalState(() => visibility = val);
                            }
                          },
                        ),
                      ),
                      if (visibility == 'CLASS') ...[
                        const SizedBox(width: 10),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            initialValue: selectedClass,
                            decoration: InputDecoration(
                              labelText: '대상 학급',
                              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                            items: _classList
                                .where((c) => c != 'ALL')
                                .map((c) => DropdownMenuItem(value: c, child: Text(c)))
                                .toList(),
                            onChanged: (val) {
                              if (val != null) {
                                setModalState(() => selectedClass = val);
                              }
                            },
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 12),

                  // Title Input
                  TextField(
                    controller: titleCtrl,
                    decoration: InputDecoration(
                      labelText: '제목',
                      hintText: '게시글 제목을 입력하세요',
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Content Input
                  TextField(
                    controller: contentCtrl,
                    maxLines: 4,
                    decoration: InputDecoration(
                      labelText: '내용',
                      hintText: '활동 내용, 알림 사항 등을 작성하세요',
                      contentPadding: const EdgeInsets.all(12),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Image Picker Section
                  const Text(
                    '클라우드 사진 첨부',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                  ),
                  const SizedBox(height: 8),

                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      // Add Photo Button
                      InkWell(
                        onTap: isUploading
                            ? null
                            : () async {
                                final picker = ImagePicker();
                                final List<XFile> images = await picker.pickMultiImage(imageQuality: 80);
                                if (images.isNotEmpty) {
                                  setModalState(() {
                                    pickedImages.addAll(images);
                                  });
                                }
                              },
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          width: 72,
                          height: 72,
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: const Color(0xFFCBD5E1), style: BorderStyle.solid),
                          ),
                          child: const Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.add_a_photo_outlined, color: Color(0xFF2563EB), size: 24),
                              SizedBox(height: 4),
                              Text('사진 추가', style: TextStyle(fontSize: 10, color: Color(0xFF64748B), fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ),

                      // Image Previews
                      ...pickedImages.asMap().entries.map((entry) {
                        final idx = entry.key;
                        final img = entry.value;
                        return Stack(
                          clipBehavior: Clip.none,
                          children: [
                            Container(
                              width: 72,
                              height: 72,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(color: const Color(0xFFE2E8F0)),
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: FutureBuilder<Uint8List>(
                                future: img.readAsBytes(),
                                builder: (context, snapshot) {
                                  if (snapshot.hasData) {
                                    return Image.memory(snapshot.data!, fit: BoxFit.cover);
                                  }
                                  return const Center(child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)));
                                },
                              ),
                            ),
                            Positioned(
                              top: -6,
                              right: -6,
                              child: InkWell(
                                onTap: () {
                                  setModalState(() {
                                    pickedImages.removeAt(idx);
                                  });
                                },
                                child: Container(
                                  padding: const EdgeInsets.all(2),
                                  decoration: const BoxDecoration(
                                    color: Color(0xFFDC2626),
                                    shape: BoxShape.circle,
                                  ),
                                  child: const Icon(Icons.close, color: Colors.white, size: 14),
                                ),
                              ),
                            ),
                          ],
                        );
                      }),
                    ],
                  ),
                  const SizedBox(height: 20),

                  // Submit Button
                  ElevatedButton(
                    onPressed: isUploading
                        ? null
                        : () async {
                            final title = titleCtrl.text.trim();
                            final content = contentCtrl.text.trim();

                            if (title.isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('제목을 입력해주세요.')),
                              );
                              return;
                            }
                            if (content.isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('내용을 입력해주세요.')),
                              );
                              return;
                            }

                            setModalState(() => isUploading = true);

                            // Upload all picked images to cloud
                            final List<String> uploadedCloudUrls = [];
                            for (final file in pickedImages) {
                              final bytes = await file.readAsBytes();
                              final mimeType = file.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
                              final upRes = await ApiService().uploadBoardImage(
                                bytes: bytes,
                                filename: file.name,
                                mimeType: mimeType,
                              );
                              if (upRes['success'] == true && upRes['url'] != null) {
                                uploadedCloudUrls.add(upRes['url'] as String);
                              }
                            }

                            final user = ApiService().currentUser;
                            final authorName = user?.name ?? '지도교사';

                            final res = await ApiService().createBoardPost(
                              title: title,
                              content: content,
                              visibility: visibility,
                              targetClass: visibility == 'CLASS' ? selectedClass : null,
                              imageUrl: uploadedCloudUrls.isNotEmpty ? uploadedCloudUrls.first : null,
                              images: uploadedCloudUrls,
                              authorName: authorName,
                              authorRole: 'TEACHER',
                              academyId: user?.academyId,
                            );

                            setModalState(() => isUploading = false);

                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);

                            if (!mounted) return;
                            if (res['success'] == true) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('클라우드 게시글이 등록되었습니다. 관리자 웹과 실시간 동기화됩니다.'),
                                  backgroundColor: Color(0xFF10B981),
                                ),
                              );
                              _loadPosts();
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(res['message'] ?? '게시글 등록에 실패했습니다.'),
                                  backgroundColor: const Color(0xFFDC2626),
                                ),
                              );
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: isUploading
                        ? const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)),
                              SizedBox(width: 10),
                              Text('클라우드 업로드 중...', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                            ],
                          )
                        : const Text(
                            '게시글 등록하기',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
                          ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  void _handleLikeToggle(Map<String, dynamic> post) async {
    final postId = post['id'] as int;
    final user = ApiService().currentUser;
    final userId = user?.id.toString() ?? 'teacher';

    final List likedUsers = List.from(post['likedUserIds'] ?? []);
    final isLiked = likedUsers.contains(userId);

    setState(() {
      if (isLiked) {
        likedUsers.remove(userId);
        post['likeCount'] = ((post['likeCount'] ?? 1) as int) - 1;
      } else {
        likedUsers.add(userId);
        post['likeCount'] = ((post['likeCount'] ?? 0) as int) + 1;
      }
      post['likedUserIds'] = likedUsers;
    });

    await ApiService().togglePostLike(postId, userId);
  }

  void _showCommentDialog(Map<String, dynamic> post) {
    final commentCtrl = TextEditingController();
    final postId = post['id'] as int;
    final List comments = List.from(post['comments'] ?? []);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setCommentState) {
          final bottomInset = MediaQuery.of(context).viewInsets.bottom;
          return Padding(
            padding: EdgeInsets.only(left: 16, right: 16, top: 16, bottom: bottomInset + 16),
            child: SizedBox(
              height: 440,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '댓글 (${comments.length})',
                        style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close, size: 20),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                  const Divider(),
                  Expanded(
                    child: comments.isEmpty
                        ? const Center(
                            child: Text(
                              '작성된 댓글이 없습니다.',
                              style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13),
                            ),
                          )
                        : ListView.separated(
                            itemCount: comments.length,
                            separatorBuilder: (ctx, idx) => const SizedBox(height: 8),
                            itemBuilder: (context, idx) {
                              final c = comments[idx];
                              return Container(
                                padding: const EdgeInsets.all(10),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF8FAFC),
                                  borderRadius: BorderRadius.circular(10),
                                  border: Border.all(color: const Color(0xFFE2E8F0)),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                      children: [
                                        Text(
                                          c['authorName'] ?? '사용자',
                                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF334155)),
                                        ),
                                        Text(
                                          c['createdAt'] != null ? DateFormat('MM/dd HH:mm').format(DateTime.parse(c['createdAt'])) : '',
                                          style: const TextStyle(fontSize: 10, color: Color(0xFF94A3B8)),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      c['content'] ?? '',
                                      style: const TextStyle(fontSize: 13, color: Color(0xFF1E293B)),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: commentCtrl,
                          decoration: InputDecoration(
                            hintText: '댓글을 입력하세요...',
                            contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      ElevatedButton(
                        onPressed: () async {
                          final text = commentCtrl.text.trim();
                          if (text.isEmpty) return;
                          commentCtrl.clear();

                          final user = ApiService().currentUser;
                          final authorName = user?.name ?? '지도교사';

                          final res = await ApiService().addPostComment(
                            postId,
                            content: text,
                            authorName: authorName,
                            authorRole: 'TEACHER',
                          );

                          if (res['success'] == true) {
                            final newComment = {
                              'id': DateTime.now().millisecondsSinceEpoch,
                              'authorName': authorName,
                              'authorRole': 'TEACHER',
                              'content': text,
                              'createdAt': DateTime.now().toIso8601String(),
                            };
                            setCommentState(() {
                              comments.add(newComment);
                            });
                            setState(() {
                              post['comments'] = comments;
                            });
                          }
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                        child: const Text('등록', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final displayPosts = _filteredPosts;

    return Column(
      children: [
        // Top Toolbar: Search & Write Post Button
        Container(
          color: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      decoration: InputDecoration(
                        hintText: '게시글 검색 (제목, 내용, 반이름)',
                        prefixIcon: const Icon(Icons.search, size: 20, color: Color(0xFF64748B)),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        suffixIcon: _searchKeyword.isNotEmpty
                            ? IconButton(
                                icon: const Icon(Icons.clear, size: 18),
                                onPressed: () {
                                  _searchController.clear();
                                  setState(() => _searchKeyword = '');
                                  _loadPosts();
                                },
                              )
                            : null,
                      ),
                      onSubmitted: (val) {
                        setState(() => _searchKeyword = val.trim());
                        _loadPosts();
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    onPressed: _showCreatePostModal,
                    icon: const Icon(Icons.edit_note, size: 18, color: Colors.white),
                    label: const Text('글작성', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: 0,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Filter Chips
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: _classList.map((c) {
                    final isSelected = _selectedClassFilter == c;
                    return Padding(
                      padding: const EdgeInsets.only(right: 6),
                      child: ChoiceChip(
                        label: Text(c == 'ALL' ? '전체 학급' : c),
                        selected: isSelected,
                        onSelected: (_) => setState(() => _selectedClassFilter = c),
                        selectedColor: const Color(0xFF2563EB),
                        labelStyle: TextStyle(
                          color: isSelected ? Colors.white : const Color(0xFF475569),
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
            ],
          ),
        ),

        // Post List View
        Expanded(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
              : displayPosts.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(Icons.photo_library_outlined, size: 48, color: Color(0xFFCBD5E1)),
                          const SizedBox(height: 8),
                          const Text('등록된 게시글이 없습니다.', style: TextStyle(color: Color(0xFF94A3B8))),
                          const SizedBox(height: 12),
                          OutlinedButton(
                            onPressed: _loadPosts,
                            child: const Text('새로고침'),
                          ),
                        ],
                      ),
                    )
                  : RefreshIndicator(
                      onRefresh: _loadPosts,
                      child: ListView.separated(
                        padding: const EdgeInsets.all(16),
                        itemCount: displayPosts.length,
                        separatorBuilder: (ctx, idx) => const SizedBox(height: 14),
                        itemBuilder: (ctx, idx) {
                          final post = displayPosts[idx];
                          final images = (post['images'] as List?)?.map((e) => e.toString()).toList() ??
                              (post['imageUrl'] != null ? [post['imageUrl'].toString()] : []);
                          final likeCount = post['likeCount'] ?? 0;
                          final comments = post['comments'] as List? ?? [];
                          final user = ApiService().currentUser;
                          final userId = user?.id.toString() ?? 'teacher';
                          final isLiked = (post['likedUserIds'] as List? ?? []).contains(userId);

                          return Container(
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withValues(alpha: 0.03),
                                  blurRadius: 6,
                                  offset: const Offset(0, 2),
                                ),
                              ],
                            ),
                            clipBehavior: Clip.antiAlias,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Post Header
                                Padding(
                                  padding: const EdgeInsets.all(14),
                                  child: Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Row(
                                        children: [
                                          CircleAvatar(
                                            radius: 18,
                                            backgroundColor: const Color(0xFFEFF6FF),
                                            child: Text(
                                              (post['authorName'] ?? '교')[0],
                                              style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.bold),
                                            ),
                                          ),
                                          const SizedBox(width: 10),
                                          Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Row(
                                                children: [
                                                  Text(
                                                    post['authorName'] ?? '원장선생님',
                                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1E293B)),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: post['authorRole'] == 'ADMIN' ? const Color(0xFFEFF6FF) : const Color(0xFFF0FDF4),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      post['authorRole'] == 'ADMIN' ? '원장님' : '지도교사',
                                                      style: TextStyle(
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                        color: post['authorRole'] == 'ADMIN' ? const Color(0xFF2563EB) : const Color(0xFF16A34A),
                                                      ),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                              const SizedBox(height: 2),
                                              Text(
                                                post['createdAt'] != null
                                                    ? DateFormat('yyyy.MM.dd HH:mm').format(DateTime.parse(post['createdAt']))
                                                    : '',
                                                style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                                              ),
                                            ],
                                          ),
                                        ],
                                      ),

                                      // Class badge
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                        decoration: BoxDecoration(
                                          color: const Color(0xFFF1F5F9),
                                          borderRadius: BorderRadius.circular(8),
                                        ),
                                        child: Text(
                                          post['targetClass'] ?? (post['visibility'] == 'ALL' ? '전체 공개' : '반공개'),
                                          style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF475569)),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),

                                // Post Title & Content
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 14),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        post['title'] ?? '',
                                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        post['content'] ?? '',
                                        style: const TextStyle(fontSize: 13, color: Color(0xFF334155), height: 1.45),
                                      ),
                                    ],
                                  ),
                                ),
                                const SizedBox(height: 12),

                                // Photos Display
                                if (images.isNotEmpty) ...[
                                  SizedBox(
                                    height: 180,
                                    child: ListView.separated(
                                      scrollDirection: Axis.horizontal,
                                      padding: const EdgeInsets.symmetric(horizontal: 14),
                                      itemCount: images.length,
                                      separatorBuilder: (ctx, idx) => const SizedBox(width: 8),
                                      itemBuilder: (context, imgIdx) {
                                        final imgUrl = images[imgIdx];
                                        return Container(
                                          width: 240,
                                          decoration: BoxDecoration(
                                            borderRadius: BorderRadius.circular(12),
                                            border: Border.all(color: const Color(0xFFE2E8F0)),
                                          ),
                                          clipBehavior: Clip.antiAlias,
                                          child: Image.network(
                                            imgUrl,
                                            fit: BoxFit.cover,
                                            errorBuilder: (ctx, err, stack) => Container(
                                              color: const Color(0xFFF1F5F9),
                                              child: const Center(
                                                child: Icon(Icons.broken_image_outlined, color: Color(0xFF94A3B8)),
                                              ),
                                            ),
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                                  const SizedBox(height: 12),
                                ],

                                const Divider(height: 1),

                                // Actions Bar: Like & Comment
                                Padding(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                                  child: Row(
                                    children: [
                                      TextButton.icon(
                                        onPressed: () => _handleLikeToggle(post),
                                        icon: Icon(
                                          isLiked ? Icons.favorite : Icons.favorite_border,
                                          size: 18,
                                          color: isLiked ? const Color(0xFFDC2626) : const Color(0xFF64748B),
                                        ),
                                        label: Text(
                                          '좋아요 $likeCount',
                                          style: TextStyle(
                                            fontSize: 12,
                                            fontWeight: FontWeight.bold,
                                            color: isLiked ? const Color(0xFFDC2626) : const Color(0xFF64748B),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 8),
                                      TextButton.icon(
                                        onPressed: () => _showCommentDialog(post),
                                        icon: const Icon(Icons.chat_bubble_outline, size: 18, color: Color(0xFF64748B)),
                                        label: Text(
                                          '댓글 ${comments.length}',
                                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B)),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          );
                        },
                      ),
                    ),
        ),
      ],
    );
  }
}
