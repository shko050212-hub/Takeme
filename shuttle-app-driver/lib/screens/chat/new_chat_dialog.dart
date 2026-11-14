import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class NewChatDialog extends StatefulWidget {
  const NewChatDialog({super.key});

  @override
  State<NewChatDialog> createState() => _NewChatDialogState();
}

class _NewChatDialogState extends State<NewChatDialog> {
  final TextEditingController _searchController = TextEditingController();
  Map<String, List<Map<String, dynamic>>> _categoryUsers = {
    'admins': [],
    'teachers': [],
    'drivers': [],
    'parents': [],
  };
  bool _isLoading = true;
  bool _isCreating = false;
  String? _errorMessage;
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _loadUsers();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    final res = await ApiService().getChatUsers();
    if (!mounted) return;

    if (res['success'] == true) {
      setState(() {
        _categoryUsers = {
          'admins': (res['admins'] as List? ?? []).cast<Map<String, dynamic>>(),
          'teachers': (res['teachers'] as List? ?? []).cast<Map<String, dynamic>>(),
          'drivers': (res['drivers'] as List? ?? []).cast<Map<String, dynamic>>(),
          'parents': (res['parents'] as List? ?? []).cast<Map<String, dynamic>>(),
        };
        _isLoading = false;
        _errorMessage = null;
      });
    } else {
      setState(() {
        _categoryUsers = {'admins': [], 'teachers': [], 'drivers': [], 'parents': []};
        _isLoading = false;
        _errorMessage = res['errorMessage']?.toString() ?? '대화 상대를 불러올 수 없습니다.';
      });
    }
  }

  String _getEmptyMessage() {
    final user = ApiService().currentUser;
    if (user == null) return '대화 가능한 상대가 없습니다.';

    if (user.role == 'HOMEROOM_TEACHER') {
      if (user.assignedClass == null || user.assignedClass!.trim().isEmpty || user.assignedClass == '미배정') {
        return '배정된 담당 반이 없어 대화 상대를 찾을 수 없습니다.\n관리자에게 반 배정을 요청해 주세요.';
      }
      return '담당 반(${user.assignedClass})에 배정된 원아나 승인된 학부모님이 아직 없습니다.';
    }

    if (user.role == 'TEACHER' || user.role == 'SHUTTLE_TEACHER') {
      return '담당 차량에 배정된 원아가 없거나 아직 승인된 학부모 계정이 없습니다.';
    }

    if (user.role == 'DRIVER') {
      return '운행 담당 차량에 배정된 원아가 없거나 아직 승인된 학부모 계정이 없습니다.';
    }

    if (user.role == 'PARENT' || user.role == 'STUDENT') {
      return '등록된 원아 정보가 없거나 소속 학급·차량이 아직 지정되지 않았습니다.';
    }

    return '아직 승인된 계정이 없거나 대화 가능한 상대가 없습니다.';
  }

  Future<void> _handleSelectUser(Map<String, dynamic> user) async {
    if (_isCreating) return;
    setState(() => _isCreating = true);

    final targetId = user['id'] as int;
    final targetName = user['name']?.toString() ?? '상대방';

    final room = await ApiService().createChatRoom([targetId], name: targetName);
    if (!mounted) return;

    setState(() => _isCreating = false);

    if (room != null) {
      Navigator.pop(context, {'room': room, 'targetUser': user});
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('대화방 생성에 실패했습니다.'),
          backgroundColor: Color(0xFFEF4444),
        ),
      );
    }
  }

  List<Map<String, dynamic>> _filterUsers(List<Map<String, dynamic>> list) {
    if (_searchQuery.isEmpty) return list;
    return list.where((u) {
      final name = u['name']?.toString() ?? '';
      final sub = u['subText']?.toString() ?? '';
      return name.contains(_searchQuery) || sub.contains(_searchQuery);
    }).toList();
  }

  Widget _buildCategorySection(String title, IconData icon, Color color, List<Map<String, dynamic>> users) {
    final filtered = _filterUsers(users);
    if (filtered.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Row(
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 6),
              Text(
                '$title (${filtered.length})',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
            ],
          ),
        ),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: filtered.length,
          separatorBuilder: (_, index) => const Divider(height: 1, indent: 64, color: Color(0xFFF1F5F9)),
          itemBuilder: (ctx, idx) {
            final u = filtered[idx];
            final name = u['name']?.toString() ?? '사용자';
            final subText = u['subText']?.toString() ?? '';

            return ListTile(
              leading: CircleAvatar(
                radius: 20,
                backgroundColor: color.withValues(alpha: 0.12),
                child: Text(
                  name.isNotEmpty ? name.substring(0, 1) : '?',
                  style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: color),
                ),
              ),
              title: Text(
                name,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Color(0xFF0F172A)),
              ),
              subtitle: subText.isNotEmpty
                  ? Text(subText, style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)))
                  : null,
              trailing: const Icon(Icons.chat_bubble_outline, size: 18, color: Color(0xFF94A3B8)),
              onTap: () => _handleSelectUser(u),
            );
          },
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final totalCount = _categoryUsers.values.fold<int>(0, (sum, list) => sum + list.length);

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.close, color: Color(0xFF1E293B)),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          '새 대화 상대 선택',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : Column(
              children: [
                // Search Field
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: TextField(
                      controller: _searchController,
                      onChanged: (val) => setState(() => _searchQuery = val.trim()),
                      decoration: const InputDecoration(
                        icon: Icon(Icons.search, color: Color(0xFF94A3B8), size: 20),
                        hintText: '이름, 반, 역할 검색...',
                        hintStyle: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                ),
                if (_errorMessage != null)
                  Expanded(
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.error_outline, size: 48, color: Color(0xFFEF4444)),
                            const SizedBox(height: 12),
                            Text(
                              _errorMessage!,
                              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xFF1E293B)),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 16),
                            ElevatedButton.icon(
                              onPressed: _loadUsers,
                              icon: const Icon(Icons.refresh, size: 16),
                              label: const Text('다시 시도'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF2563EB),
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  )
                else
                  Expanded(
                    child: totalCount == 0
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  const Icon(Icons.people_outline, size: 48, color: Color(0xFF94A3B8)),
                                  const SizedBox(height: 12),
                                  Text(
                                    _getEmptyMessage(),
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(color: Color(0xFF64748B), fontSize: 13, height: 1.5),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : SingleChildScrollView(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _buildCategorySection('기관 관리자', Icons.admin_panel_settings, const Color(0xFFDC2626), _categoryUsers['admins'] ?? []),
                              _buildCategorySection('선생님', Icons.school, const Color(0xFF2563EB), _categoryUsers['teachers'] ?? []),
                              _buildCategorySection('셔틀 기사님', Icons.directions_bus, const Color(0xFFF59E0B), _categoryUsers['drivers'] ?? []),
                              _buildCategorySection('학부모', Icons.family_restroom, const Color(0xFF10B981), _categoryUsers['parents'] ?? []),
                              const SizedBox(height: 24),
                            ],
                          ),
                        ),
                ),
              ],
            ),
    );
  }
}
