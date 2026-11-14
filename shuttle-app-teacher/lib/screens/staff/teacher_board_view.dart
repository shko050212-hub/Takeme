import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../../models/user_model.dart';
import '../../services/api_service.dart';

class TeacherBoardView extends StatefulWidget {
  final String? initialCategory;
  const TeacherBoardView({super.key, this.initialCategory});

  @override
  State<TeacherBoardView> createState() => _TeacherBoardViewState();
}

class _TeacherBoardViewState extends State<TeacherBoardView> {
  List<Map<String, dynamic>> _posts = [];
  bool _isLoading = true;
  String _searchKeyword = '';
  String _selectedClassFilter = 'ALL';
  String _selectedPostTypeFilter = 'ALL'; // 'ALL', 'NOTICE', 'POST'
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
    if (widget.initialCategory != null) {
      _selectedPostTypeFilter = widget.initialCategory!;
    }
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
      postType: _selectedPostTypeFilter == 'ALL' ? null : _selectedPostTypeFilter,
    );
    if (mounted) {
      setState(() {
        _posts = posts;
        _isLoading = false;
      });
    }
  }

  List<Map<String, dynamic>> get _filteredPosts {
    final user = ApiService().currentUser;
    var list = _posts;
    if (_selectedPostTypeFilter != 'ALL') {
      list = list.where((p) => (p['postType'] ?? 'POST') == _selectedPostTypeFilter).toList();
    }
    if (user?.role == 'HOMEROOM_TEACHER') {
      return list;
    }
    if (_selectedClassFilter == 'ALL') {
      return list;
    }
    return list.where((p) {
      if (p['visibility'] == 'ALL') return true;
      final target = p['targetClass']?.toString() ?? '';
      return target == _selectedClassFilter;
    }).toList();
  }

  bool _canEditPost(Map<String, dynamic> post) {
    final user = ApiService().currentUser;
    if (user == null) return false;
    if (user.role == 'ADMIN' || user.role == 'ACADEMY_ADMIN') return true;
    if (post['authorUserId'] != null && post['authorUserId'] == user.id) return true;
    if (post['authorName'] == user.name) return true;
    return false;
  }

  void _confirmDeletePost(int postId) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('게시글 삭제', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
        content: const Text('이 게시글을 정말 삭제하시겠습니까?\n삭제된 게시글과 댓글은 복구할 수 없습니다.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final res = await ApiService().deleteBoardPost(postId);
              if (res['success'] == true && mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('게시글이 삭제되었습니다.')),
                );
                _loadPosts();
              } else if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('삭제에 실패했습니다. 권한을 확인해주세요.')),
                );
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            child: const Text('삭제', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showCreatePostModal() {
    final currentUser = ApiService().currentUser;
    final isHomeroom = currentUser?.role == 'HOMEROOM_TEACHER';
    final hasClass = currentUser?.assignedClass != null &&
        currentUser!.assignedClass!.isNotEmpty &&
        currentUser.assignedClass != '미배정';
    final titleCtrl = TextEditingController();
    final contentCtrl = TextEditingController();
    String? selectedCategory;
    String visibility = isHomeroom ? 'CLASS' : 'ALL';
    String selectedClass = hasClass ? currentUser.assignedClass! : '햇살반';
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
          final viewInsets = MediaQuery.of(context).viewInsets;
          final viewPadding = MediaQuery.of(context).viewPadding;
          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 24,
              bottom: viewInsets.bottom + viewPadding.bottom + 24,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        selectedCategory == 'NOTICE'
                            ? '알림장 작성'
                            : selectedCategory == 'POST'
                                ? '게시물 작성'
                                : '알림장 / 게시글 작성',
                        style: const TextStyle(
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
                  const SizedBox(height: 12),

                  // Category Selector (NOTICE vs POST)
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setModalState(() => selectedCategory = 'NOTICE'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: selectedCategory == 'NOTICE' ? const Color(0xFFEA580C) : Colors.transparent,
                                borderRadius: BorderRadius.circular(9),
                                boxShadow: selectedCategory == 'NOTICE'
                                    ? [BoxShadow(color: const Color(0xFFEA580C).withValues(alpha: 0.25), blurRadius: 4, offset: const Offset(0, 2))]
                                    : null,
                              ),
                              alignment: Alignment.center,
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.campaign_outlined,
                                    size: 16,
                                    color: selectedCategory == 'NOTICE' ? Colors.white : const Color(0xFF64748B),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    '알림장',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: selectedCategory == 'NOTICE' ? Colors.white : const Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setModalState(() => selectedCategory = 'POST'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: selectedCategory == 'POST' ? const Color(0xFF2563EB) : Colors.transparent,
                                borderRadius: BorderRadius.circular(9),
                                boxShadow: selectedCategory == 'POST'
                                    ? [BoxShadow(color: const Color(0xFF2563EB).withValues(alpha: 0.25), blurRadius: 4, offset: const Offset(0, 2))]
                                    : null,
                              ),
                              alignment: Alignment.center,
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.article_outlined,
                                    size: 16,
                                    color: selectedCategory == 'POST' ? Colors.white : const Color(0xFF64748B),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    '게시물',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: selectedCategory == 'POST' ? Colors.white : const Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
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
                    '원아 활동 사진 첨부',
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

                            if (selectedCategory == null) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('카테고리(알림장 또는 게시물)를 선택해주세요.')),
                              );
                              return;
                            }
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
                            final authorName = user?.name.isNotEmpty == true
                                ? user!.name
                                : (user?.role == 'HOMEROOM_TEACHER' ? '담임교사' : '지도교사');
                            final authorRole = user?.role == 'HOMEROOM_TEACHER' ? 'HOMEROOM_TEACHER' : (user?.role ?? 'TEACHER');

                            final res = await ApiService().createBoardPost(
                              title: title,
                              content: content,
                              visibility: visibility,
                              targetClass: visibility == 'CLASS' ? selectedClass : null,
                              postType: selectedCategory,
                              imageUrl: uploadedCloudUrls.isNotEmpty ? uploadedCloudUrls.first : null,
                              images: uploadedCloudUrls,
                              authorName: authorName,
                              authorRole: authorRole,
                              academyId: user?.academyId,
                            );

                            setModalState(() => isUploading = false);

                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);

                            if (!mounted) return;
                            if (res['success'] == true) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text('${selectedCategory == 'NOTICE' ? '알림장' : '게시물'}이 등록되었습니다. 학부모 및 관리자 웹과 실시간 공유됩니다.'),
                                  backgroundColor: const Color(0xFF10B981),
                                ),
                              );
                              setState(() {
                                _selectedPostTypeFilter = selectedCategory!;
                              });
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
                      backgroundColor: selectedCategory == 'NOTICE' ? const Color(0xFFEA580C) : const Color(0xFF2563EB),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: isUploading
                        ? const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)),
                              SizedBox(width: 10),
                              Text('등록 중...', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                            ],
                          )
                        : Text(
                            selectedCategory == 'NOTICE'
                                ? '알림장 등록하기'
                                : selectedCategory == 'POST'
                                    ? '게시물 등록하기'
                                    : '등록하기',
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 15),
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

  void _showEditPostModal(Map<String, dynamic> post) {
    final postId = post['id'] as int;
    final titleCtrl = TextEditingController(text: post['title']?.toString() ?? '');
    final contentCtrl = TextEditingController(text: post['content']?.toString() ?? '');
    String selectedCategory = post['postType'] == 'NOTICE' ? 'NOTICE' : 'POST';
    String visibility = post['visibility']?.toString() ?? 'ALL';
    String selectedClass = post['targetClass']?.toString() ?? '햇살반';
    final existingImages = List<String>.from((post['images'] as List?)?.map((e) => e.toString()) ??
        (post['imageUrl'] != null ? [post['imageUrl'].toString()] : []));
    final List<XFile> newlyPickedImages = [];
    bool isSaving = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) {
          final viewInsets = MediaQuery.of(context).viewInsets;
          final viewPadding = MediaQuery.of(context).viewPadding;
          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 24,
              bottom: viewInsets.bottom + viewPadding.bottom + 24,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        selectedCategory == 'NOTICE' ? '알림장 수정' : '게시물 수정',
                        style: const TextStyle(
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
                  const SizedBox(height: 12),

                  // Category Selector (NOTICE vs POST)
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setModalState(() => selectedCategory = 'NOTICE'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: selectedCategory == 'NOTICE' ? const Color(0xFFEA580C) : Colors.transparent,
                                borderRadius: BorderRadius.circular(9),
                                boxShadow: selectedCategory == 'NOTICE'
                                    ? [BoxShadow(color: const Color(0xFFEA580C).withValues(alpha: 0.25), blurRadius: 4, offset: const Offset(0, 2))]
                                    : null,
                              ),
                              alignment: Alignment.center,
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.campaign_outlined,
                                    size: 16,
                                    color: selectedCategory == 'NOTICE' ? Colors.white : const Color(0xFF64748B),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    '알림장',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: selectedCategory == 'NOTICE' ? Colors.white : const Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: GestureDetector(
                            onTap: () => setModalState(() => selectedCategory = 'POST'),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 10),
                              decoration: BoxDecoration(
                                color: selectedCategory == 'POST' ? const Color(0xFF2563EB) : Colors.transparent,
                                borderRadius: BorderRadius.circular(9),
                                boxShadow: selectedCategory == 'POST'
                                    ? [BoxShadow(color: const Color(0xFF2563EB).withValues(alpha: 0.25), blurRadius: 4, offset: const Offset(0, 2))]
                                    : null,
                              ),
                              alignment: Alignment.center,
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(
                                    Icons.article_outlined,
                                    size: 16,
                                    color: selectedCategory == 'POST' ? Colors.white : const Color(0xFF64748B),
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    '게시물',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.bold,
                                      color: selectedCategory == 'POST' ? Colors.white : const Color(0xFF64748B),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
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
                            initialValue: _classList.contains(selectedClass) ? selectedClass : '햇살반',
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
                      contentPadding: const EdgeInsets.all(12),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // Photo management
                  const Text(
                    '활동 사진 관리',
                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                  ),
                  const SizedBox(height: 8),

                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      InkWell(
                        onTap: isSaving
                            ? null
                            : () async {
                                final picker = ImagePicker();
                                final List<XFile> images = await picker.pickMultiImage(imageQuality: 80);
                                if (images.isNotEmpty) {
                                  setModalState(() {
                                    newlyPickedImages.addAll(images);
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
                            border: Border.all(color: const Color(0xFFCBD5E1)),
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
                      // Existing images
                      ...existingImages.asMap().entries.map((entry) {
                        final idx = entry.key;
                        final url = entry.value;
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
                              child: Image.network(url, fit: BoxFit.cover, errorBuilder: (ctx, err, stack) => const Icon(Icons.broken_image)),
                            ),
                            Positioned(
                              top: -6,
                              right: -6,
                              child: InkWell(
                                onTap: () {
                                  setModalState(() {
                                    existingImages.removeAt(idx);
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
                      // Newly picked images
                      ...newlyPickedImages.asMap().entries.map((entry) {
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
                                border: Border.all(color: const Color(0xFF2563EB), width: 1.5),
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
                                    newlyPickedImages.removeAt(idx);
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

                  // Save Button
                  ElevatedButton(
                    onPressed: isSaving
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

                            setModalState(() => isSaving = true);

                            // Upload newly picked images
                            final List<String> allImages = List<String>.from(existingImages);
                            for (final file in newlyPickedImages) {
                              final bytes = await file.readAsBytes();
                              final mimeType = file.name.endsWith('.png') ? 'image/png' : 'image/jpeg';
                              final upRes = await ApiService().uploadBoardImage(
                                bytes: bytes,
                                filename: file.name,
                                mimeType: mimeType,
                              );
                              if (upRes['success'] == true && upRes['url'] != null) {
                                allImages.add(upRes['url'] as String);
                              }
                            }

                            final res = await ApiService().updateBoardPost(
                              postId,
                              title: title,
                              content: content,
                              visibility: visibility,
                              targetClass: visibility == 'CLASS' ? selectedClass : null,
                              postType: selectedCategory,
                              images: allImages,
                            );

                            setModalState(() => isSaving = false);

                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);

                            if (res['success'] == true) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('${selectedCategory == 'NOTICE' ? '알림장' : '게시물'}이 수정되었습니다.')),
                              );
                              _loadPosts();
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text(res['message'] ?? '게시글 수정에 실패했습니다.')),
                              );
                            }
                          },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: selectedCategory == 'NOTICE' ? const Color(0xFFEA580C) : const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: isSaving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                          )
                        : const Text('수정 완료', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
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
          final viewInsets = MediaQuery.of(context).viewInsets;
          final viewPadding = MediaQuery.of(context).viewPadding;
          return Padding(
            padding: EdgeInsets.only(
              left: 16,
              right: 16,
              top: 16,
              bottom: viewInsets.bottom + viewPadding.bottom + 12,
            ),
            child: SizedBox(
              height: MediaQuery.of(context).size.height * 0.65,
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
                          final authorName = user?.name.isNotEmpty == true
                              ? user!.name
                              : (user?.role == 'HOMEROOM_TEACHER' ? '담임교사' : '지도교사');
                          final authorRole = user?.role == 'HOMEROOM_TEACHER' ? 'HOMEROOM_TEACHER' : (user?.role ?? 'TEACHER');

                          final res = await ApiService().addPostComment(
                            postId,
                            content: text,
                            authorName: authorName,
                            authorRole: authorRole,
                          );

                          if (res['success'] == true) {
                            final newComment = {
                              'id': DateTime.now().millisecondsSinceEpoch,
                              'authorName': authorName,
                              'authorRole': authorRole,
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
    final user = ApiService().currentUser;
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
              // Category Filter Chips: 전체 · 알림장 · 게시물
              const SizedBox(height: 8),
              Row(
                children: [
                  ChoiceChip(
                    label: const Text('전체'),
                    selected: _selectedPostTypeFilter == 'ALL',
                    onSelected: (_) {
                      setState(() => _selectedPostTypeFilter = 'ALL');
                      _loadPosts();
                    },
                    selectedColor: const Color(0xFF0F172A),
                    labelStyle: TextStyle(
                      color: _selectedPostTypeFilter == 'ALL' ? Colors.white : const Color(0xFF475569),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(width: 6),
                  ChoiceChip(
                    avatar: Icon(Icons.campaign, size: 14, color: _selectedPostTypeFilter == 'NOTICE' ? Colors.white : const Color(0xFFEA580C)),
                    label: const Text('알림장'),
                    selected: _selectedPostTypeFilter == 'NOTICE',
                    onSelected: (_) {
                      setState(() => _selectedPostTypeFilter = 'NOTICE');
                      _loadPosts();
                    },
                    selectedColor: const Color(0xFFEA580C),
                    labelStyle: TextStyle(
                      color: _selectedPostTypeFilter == 'NOTICE' ? Colors.white : const Color(0xFFEA580C),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(width: 6),
                  ChoiceChip(
                    avatar: Icon(Icons.article, size: 14, color: _selectedPostTypeFilter == 'POST' ? Colors.white : const Color(0xFF2563EB)),
                    label: const Text('게시물'),
                    selected: _selectedPostTypeFilter == 'POST',
                    onSelected: (_) {
                      setState(() => _selectedPostTypeFilter = 'POST');
                      _loadPosts();
                    },
                    selectedColor: const Color(0xFF2563EB),
                    labelStyle: TextStyle(
                      color: _selectedPostTypeFilter == 'POST' ? Colors.white : const Color(0xFF2563EB),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
              // Filter Chips (Hidden for Homeroom Teacher since they only see their assigned class)
              if (user?.role != 'HOMEROOM_TEACHER') ...[
                const SizedBox(height: 8),
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
                                                    post['authorName'] ?? '기관 관리자',
                                                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1E293B)),
                                                  ),
                                                  const SizedBox(width: 6),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: post['postType'] == 'NOTICE' ? const Color(0xFFFFF7ED) : const Color(0xFFEFF6FF),
                                                      borderRadius: BorderRadius.circular(4),
                                                      border: Border.all(
                                                        color: post['postType'] == 'NOTICE' ? const Color(0xFFFDBA74) : const Color(0xFFBFDBFE),
                                                        width: 0.8,
                                                      ),
                                                    ),
                                                    child: Text(
                                                      post['postType'] == 'NOTICE' ? '알림장' : '게시물',
                                                      style: TextStyle(
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                        color: post['postType'] == 'NOTICE' ? const Color(0xFFEA580C) : const Color(0xFF2563EB),
                                                      ),
                                                    ),
                                                  ),
                                                  const SizedBox(width: 4),
                                                  Container(
                                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                    decoration: BoxDecoration(
                                                      color: post['authorRole'] == 'ADMIN' || post['authorRole'] == 'ACADEMY_ADMIN'
                                                          ? const Color(0xFFEFF6FF)
                                                          : const Color(0xFFF0FDF4),
                                                      borderRadius: BorderRadius.circular(4),
                                                    ),
                                                    child: Text(
                                                      UserModel.getRoleKorean(post['authorRole']),
                                                      style: TextStyle(
                                                        fontSize: 10,
                                                        fontWeight: FontWeight.bold,
                                                        color: post['authorRole'] == 'ADMIN' || post['authorRole'] == 'ACADEMY_ADMIN'
                                                            ? const Color(0xFF2563EB)
                                                            : const Color(0xFF16A34A),
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

                                      // Class badge & 3-dots Menu
                                      Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
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
                                          if (_canEditPost(post)) ...[
                                            const SizedBox(width: 4),
                                            PopupMenuButton<String>(
                                              icon: const Icon(Icons.more_vert, size: 20, color: Color(0xFF64748B)),
                                              padding: EdgeInsets.zero,
                                              constraints: const BoxConstraints(),
                                              onSelected: (val) {
                                                if (val == 'edit') {
                                                  _showEditPostModal(post);
                                                } else if (val == 'delete') {
                                                  _confirmDeletePost(post['id'] as int);
                                                }
                                              },
                                              itemBuilder: (ctx) => [
                                                const PopupMenuItem(
                                                  value: 'edit',
                                                  child: Row(
                                                    children: [
                                                      Icon(Icons.edit_outlined, size: 18, color: Color(0xFF2563EB)),
                                                      SizedBox(width: 8),
                                                      Text('수정'),
                                                    ],
                                                  ),
                                                ),
                                                const PopupMenuItem(
                                                  value: 'delete',
                                                  child: Row(
                                                    children: [
                                                      Icon(Icons.delete_outline, size: 18, color: Color(0xFFEF4444)),
                                                      SizedBox(width: 8),
                                                      Text('삭제', style: TextStyle(color: Color(0xFFEF4444))),
                                                    ],
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ],
                                        ],
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
