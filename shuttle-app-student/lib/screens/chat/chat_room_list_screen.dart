import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/user_model.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import 'chat_conversation_screen.dart';
import 'new_chat_dialog.dart';

class ChatRoomListScreen extends StatefulWidget {
  final bool isEmbeddedTab;

  const ChatRoomListScreen({super.key, this.isEmbeddedTab = false});

  @override
  State<ChatRoomListScreen> createState() => _ChatRoomListScreenState();
}

class _ChatRoomListScreenState extends State<ChatRoomListScreen> {
  List<Map<String, dynamic>> _rooms = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadRooms();
    SocketService().onRoomUpdated((_) {
      if (mounted) _loadRooms(showLoading: false);
    });
  }

  Future<void> _loadRooms({bool showLoading = true}) async {
    if (showLoading) setState(() => _isLoading = true);
    final rooms = await ApiService().getChatRooms();
    if (mounted) {
      setState(() {
        _rooms = rooms;
        _isLoading = false;
      });
    }
  }

  void _openNewChat() async {
    final result = await Navigator.push<Map<String, dynamic>>(
      context,
      MaterialPageRoute(builder: (_) => const NewChatDialog()),
    );
    if (result != null && mounted) {
      final room = result['room'] as Map<String, dynamic>;
      final targetUser = result['targetUser'] as Map<String, dynamic>?;
      final roomId = room['id'] as int;
      final title = room['displayName'] ?? targetUser?['name'] ?? room['name'] ?? '대화방';

      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatConversationScreen(
            roomId: roomId,
            title: title,
            targetUser: targetUser,
          ),
        ),
      );
      _loadRooms(showLoading: false);
    }
  }

  void _enterRoom(Map<String, dynamic> room) async {
    final roomId = room['id'] as int;
    final title = room['displayName'] ?? room['name'] ?? '대화방';
    final targetUser = room['targetUser'] as Map<String, dynamic>?;

    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatConversationScreen(
          roomId: roomId,
          title: title,
          targetUser: targetUser,
        ),
      ),
    );
    _loadRooms(showLoading: false);
  }

  String _formatRoomTime(dynamic createdAt) {
    if (createdAt == null) return '';
    try {
      final dt = DateTime.parse(createdAt.toString()).toLocal();
      final now = DateTime.now();
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        return DateFormat('a h:mm', 'ko_KR').format(dt);
      } else if (dt.year == now.year && dt.month == now.month && dt.day == now.day - 1) {
        return '어제';
      } else {
        return DateFormat('M월 d일', 'ko_KR').format(dt);
      }
    } catch (_) {
      return '';
    }
  }

  Widget _buildRoomItem(Map<String, dynamic> room) {
    final displayName = room['displayName'] ?? room['name'] ?? '대화방';
    final latestMsg = room['latestMessage'] as Map<String, dynamic>?;
    final latestText = latestMsg?['text']?.toString() ?? '대화 내용이 없습니다.';
    final timeStr = _formatRoomTime(latestMsg?['createdAt'] ?? room['updatedAt'] ?? room['createdAt']);
    final unreadCount = room['unreadCount'] as int? ?? 0;
    final targetUser = room['targetUser'] as Map<String, dynamic>?;
    final role = targetUser?['role']?.toString();
    final assignedClass = targetUser?['assignedClass']?.toString();

    final isSystem = room['type'] == 'SYSTEM' || room['name'] == 'TakeMe 알림' || room['isSystem'] == true;
    String badgeLabel = '';
    Color badgeColor = const Color(0xFF64748B);
    if (isSystem) {
      badgeLabel = '시스템';
      badgeColor = const Color(0xFF2563EB);
    } else if (role == 'ACADEMY_ADMIN' || role == 'SUPER_ADMIN') {
      badgeLabel = '기관 관리자';
      badgeColor = const Color(0xFFDC2626);
    } else if (role == 'HOMEROOM_TEACHER') {
      badgeLabel = assignedClass != null ? '$assignedClass 담임교사' : '담임교사';
      badgeColor = const Color(0xFF2563EB);
    } else if (role == 'SHUTTLE_TEACHER') {
      badgeLabel = '지도교사';
      badgeColor = const Color(0xFF0284C7);
    } else if (role == 'TEACHER') {
      badgeLabel = '교사';
      badgeColor = const Color(0xFF0284C7);
    } else if (role == 'DRIVER') {
      badgeLabel = '기사';
      badgeColor = const Color(0xFFD97706);
    } else if (role == 'PARENT') {
      badgeLabel = '학부모';
      badgeColor = const Color(0xFF10B981);
    } else if (role == 'STUDENT') {
      badgeLabel = '학생';
      badgeColor = const Color(0xFF8B5CF6);
    } else {
      badgeLabel = UserModel.getRoleKorean(role);
      badgeColor = const Color(0xFF64748B);
    }

    return InkWell(
      onTap: () => _enterRoom(room),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            // Avatar
            if (isSystem)
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: const Icon(Icons.notifications_active, color: Colors.white, size: 24),
                  ),
                  if (unreadCount > 0)
                    Positioned(
                      right: -3,
                      bottom: -3,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                        decoration: BoxDecoration(
                          color: const Color(0xFFEF4444),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 2),
                        ),
                        constraints: const BoxConstraints(minWidth: 20, minHeight: 20),
                        alignment: Alignment.center,
                        child: Text(
                          unreadCount > 9 ? '9+' : '$unreadCount',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 10,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                ],
              )
            else
              CircleAvatar(
                radius: 24,
                backgroundColor: const Color(0xFFEFF6FF),
                child: Text(
                  displayName.isNotEmpty ? displayName.substring(0, 1) : '?',
                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF2563EB)),
                ),
              ),
            const SizedBox(width: 14),
            // Info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          displayName,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: Color(0xFF0F172A),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (badgeLabel.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: badgeColor.withValues(alpha: 0.1),
                            borderRadius: BorderRadius.circular(6),
                            border: Border.all(color: badgeColor.withValues(alpha: 0.3)),
                          ),
                          child: Text(
                            badgeLabel,
                            style: TextStyle(
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                              color: badgeColor,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    latestText,
                    style: TextStyle(
                      fontSize: 13,
                      color: unreadCount > 0 ? const Color(0xFF1E293B) : const Color(0xFF64748B),
                      fontWeight: unreadCount > 0 ? FontWeight.w600 : FontWeight.normal,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Time and Badge
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  timeStr,
                  style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                ),
                const SizedBox(height: 6),
                if (unreadCount > 0)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFFEF4444),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                    alignment: Alignment.center,
                    child: Text(
                      unreadCount > 9 ? '9+' : '$unreadCount',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  )
                else
                  const SizedBox(height: 18),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final body = RefreshIndicator(
      onRefresh: () => _loadRooms(showLoading: false),
      color: const Color(0xFF2563EB),
      child: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : _rooms.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        decoration: const BoxDecoration(
                          color: Color(0xFFF1F5F9),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.forum_outlined, size: 32, color: Color(0xFF94A3B8)),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        '진행 중인 대화가 없습니다.',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        '우측 상단의 "새 대화" 버튼을 눌러\n학부모, 교직원과 실시간 대화를 시작해보세요.',
                        style: TextStyle(fontSize: 12, color: Color(0xFF64748B), height: 1.4),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 20),
                      ElevatedButton.icon(
                        onPressed: _openNewChat,
                        icon: const Icon(Icons.chat, size: 16),
                        label: const Text('새 대화 시작하기'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  physics: const AlwaysScrollableScrollPhysics(),
                  itemCount: _rooms.length,
                  separatorBuilder: (_, index) => const Divider(height: 1, indent: 76, color: Color(0xFFF1F5F9)),
                  itemBuilder: (ctx, idx) => _buildRoomItem(_rooms[idx]),
                ),
    );

    if (widget.isEmbeddedTab) {
      return Scaffold(
        backgroundColor: Colors.white,
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _openNewChat,
          backgroundColor: const Color(0xFF2563EB),
          icon: const Icon(Icons.add_comment_rounded, color: Colors.white, size: 18),
          label: const Text('새 대화', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        ),
        body: body,
      );
    }

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: Color(0xFF1E293B), size: 20),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          '메신저 대화',
          style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
        ),
        actions: [
          TextButton.icon(
            onPressed: _openNewChat,
            icon: const Icon(Icons.add_comment_rounded, size: 16, color: Color(0xFF2563EB)),
            label: const Text(
              '새 대화',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13, color: Color(0xFF2563EB)),
            ),
          ),
          const SizedBox(width: 8),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: body,
    );
  }
}
