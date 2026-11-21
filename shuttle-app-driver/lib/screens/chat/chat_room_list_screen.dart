import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../config.dart';
import '../../models/user_model.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../widgets/load_error_view.dart';
import 'chat_conversation_screen.dart';
import 'new_chat_dialog.dart';


/// 기관 공지 채널의 예전 이름("실시간 알림 채널")을 "공지사항"으로 표시한다.
String? _normalizeRoomName(dynamic name) {
  final n = name?.toString();
  if (n == '실시간 알림 채널') return '공지사항';
  return n;
}

class ChatRoomListScreen extends StatefulWidget {
  final bool isEmbeddedTab;

  const ChatRoomListScreen({super.key, this.isEmbeddedTab = false});

  @override
  State<ChatRoomListScreen> createState() => _ChatRoomListScreenState();
}

class _ChatRoomListScreenState extends State<ChatRoomListScreen> {
  List<Map<String, dynamic>> _rooms = [];
  bool _isLoading = true;
  String? _loadError; // 채팅방 목록 불러오기 실패 이유 (null 이면 정상)

  @override
  void initState() {
    super.initState();
    _loadRooms();
    SocketService().onRoomUpdated((_) {
      if (mounted) _loadRooms(showLoading: false);
    });
  }

  /// userInitiated: 사용자가 직접 새로고침(당겨서 새로고침/다시 시도)한 경우
  Future<void> _loadRooms({bool showLoading = true, bool userInitiated = false}) async {
    if (showLoading) setState(() => _isLoading = true);
    try {
      final rooms = await ApiService().getChatRooms(throwOnError: true);
      if (mounted) {
        setState(() {
          _rooms = rooms;
          _isLoading = false;
          _loadError = null;
        });
      }
    } catch (e) {
      if (!mounted) return;
      final message = friendlyError(e);
      setState(() {
        _isLoading = false;
        // 이미 보이는 목록이 없을 때만 오류 화면, 목록이 있으면 그대로 두고 안내만 한다
        if (_rooms.isEmpty) _loadError = message;
      });
      if (_rooms.isNotEmpty && (userInitiated || showLoading)) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('대화 목록을 새로 불러오지 못했습니다. $message')),
        );
      }
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
      final title = room['displayName'] ?? targetUser?['name'] ?? _normalizeRoomName(room['name']) ?? '대화방';

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
    final title = room['displayName'] ?? _normalizeRoomName(room['name']) ?? '대화방';
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

  /// 길게 누르면: 맨 위 고정/해제, 채팅방 삭제 (TakeMe 알림은 항상 맨 위라 해당 없음)
  void _showRoomActions(Map<String, dynamic> room) {
    final roomId = room['id'] as int;
    final title = room['displayName'] ?? _normalizeRoomName(room['name']) ?? '대화방';
    final isPinned = room['isPinned'] == true;
    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
              child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            ListTile(
              minTileHeight: 56,
              leading: Icon(isPinned ? Icons.push_pin_outlined : Icons.push_pin),
              title: Text(isPinned ? '고정 해제' : '맨 위에 고정', style: const TextStyle(fontSize: 16)),
              onTap: () {
                Navigator.pop(ctx);
                _roomAction('/chat/rooms/$roomId/pin', {'pinned': !isPinned},
                    failText: isPinned ? '고정을 해제하지 못했습니다.' : '고정하지 못했습니다.');
              },
            ),
            ListTile(
              minTileHeight: 56,
              leading: const Icon(Icons.delete_outline, color: Color(0xFFDC2626)),
              title: const Text('채팅방 삭제', style: TextStyle(fontSize: 16, color: Color(0xFFDC2626))),
              onTap: () {
                Navigator.pop(ctx);
                _confirmHideRoom(roomId, title);
              },
            ),
          ],
        ),
      ),
    );
  }

  void _confirmHideRoom(int roomId, String title) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('채팅방 삭제'),
        content: Text('"$title" 채팅방을 내 목록에서 삭제할까요?\n상대방에게는 그대로 남고, 새 메시지가 오면 다시 보입니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          TextButton(
            onPressed: () {
              Navigator.pop(ctx);
              _roomAction('/chat/rooms/$roomId/hide', {}, failText: '채팅방을 삭제하지 못했습니다.');
            },
            child: const Text('삭제', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Future<void> _roomAction(String path, Map<String, dynamic> body, {required String failText}) async {
    try {
      final res = await ApiService().postWithAuth(Uri.parse('${AppConfig.apiHost}$path'), jsonEncode(body));
      if (res.statusCode == 200 || res.statusCode == 201) {
        _loadRooms(showLoading: false);
        return;
      }
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$failText (${res.statusCode})')));
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$failText ${friendlyError(e)}')));
    }
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
    final displayName = room['displayName'] ?? _normalizeRoomName(room['name']) ?? '대화방';
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
    } else if (role != null && role.isNotEmpty) {
      badgeLabel = UserModel.getRoleKorean(role);
      badgeColor = const Color(0xFF64748B);
    }
    // 역할을 모르는 방(예전 공지사항 방 등)에는 '알 수 없음' 배지를 달지 않는다
    if (badgeLabel == '알 수 없음') badgeLabel = '';

    final isPinned = room['isPinned'] == true;

    return InkWell(
      onTap: () => _enterRoom(room),
      // TakeMe 알림·공지사항(시스템 방)은 고정·삭제 대상이 아니다
      onLongPress: (isSystem || room['type'] == 'NOTIFICATION_SYSTEM') ? null : () => _showRoomActions(room),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        child: Row(
          children: [
            // Avatar
            if (isSystem)
              Stack(
                clipBehavior: Clip.none,
                children: [
                  // TakeMe 알림: 어두운 사각형 종 아이콘 (학부모 앱과 같은 모양)
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: const Color(0xFF0F172A),
                      borderRadius: BorderRadius.circular(14),
                    ),
                    child: const Icon(Icons.notifications_active, color: Colors.white, size: 22),
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
            else if (room['type'] == 'NOTIFICATION_SYSTEM')
              // 공지사항: 연한 초록 사각형 확성기 아이콘 (학부모 앱과 같은 모양)
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: const Color(0xFFECFDF5),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.campaign_rounded, color: Color(0xFF059669), size: 24),
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
                      if (isPinned) ...[
                        const Icon(Icons.push_pin, size: 14, color: Color(0xFF64748B), semanticLabel: '고정됨'),
                        const SizedBox(width: 4),
                      ],
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
      onRefresh: () => _loadRooms(showLoading: false, userInitiated: true),
      color: const Color(0xFF2563EB),
      child: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : (_loadError != null && _rooms.isEmpty)
              ? LoadErrorView(
                  title: '대화 목록을 불러오지 못했습니다.',
                  message: _loadError!,
                  onRetry: () => _loadRooms(userInitiated: true),
                )
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
          '대화방 & 메시지',
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
