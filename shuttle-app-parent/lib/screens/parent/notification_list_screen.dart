import 'package:flutter/material.dart';
import '../../models/notification_model.dart';
import '../../services/api_service.dart';
import 'class_board_screen.dart';

class NotificationListScreen extends StatefulWidget {
  const NotificationListScreen({super.key});

  @override
  State<NotificationListScreen> createState() => _NotificationListScreenState();
}

class _NotificationListScreenState extends State<NotificationListScreen> {
  List<NotificationModel> _notifications = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadNotifications();
  }

  Future<void> _loadNotifications() async {
    final user = ApiService().currentUser;
    if (user == null) {
      if (mounted) setState(() => _isLoading = false);
      return;
    }

    final list = await ApiService().getNotifications(user.email);
    if (mounted) {
      setState(() {
        _notifications = list;
        _isLoading = false;
      });
    }
  }

  Future<void> _markAllAsRead() async {
    final user = ApiService().currentUser;
    if (user == null || _notifications.isEmpty) return;

    final unreadCount = _notifications.where((n) => !n.isRead).length;
    if (unreadCount == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('모든 알림을 이미 읽었습니다.')),
      );
      return;
    }

    final ok = await ApiService().markAllNotificationsRead(user.email);
    if (ok && mounted) {
      setState(() {
        _notifications = _notifications.map((n) => n.copyWith(isRead: true)).toList();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('모든 알림을 읽음 처리했습니다.')),
      );
    }
  }

  Future<void> _markAsRead(NotificationModel noti, int index) async {
    if (noti.isRead) return;
    final user = ApiService().currentUser;
    if (user == null) return;

    setState(() {
      _notifications[index] = noti.copyWith(isRead: true);
    });

    await ApiService().readNotification(
      email: user.email,
      messageId: noti.id,
      notificationKey: noti.key,
    );
  }

  void _showNotificationDetail(NotificationModel noti, int index) {
    _markAsRead(noti, index);

    showModalBottomSheet(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 20, 24, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: const Color(0xFFCBD5E1),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Row(
                children: [
                  _buildTypeBadge(noti.type),
                  const Spacer(),
                  Text(
                    _formatDateTime(noti.createdAt),
                    style: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                noti.title,
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Text(
                  noti.message,
                  style: const TextStyle(fontSize: 14, height: 1.6, color: Color(0xFF334155)),
                ),
              ),
              const SizedBox(height: 20),
              if (noti.type == 'BOARD') ...[
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      Navigator.push(
                        context,
                        MaterialPageRoute(builder: (_) => const ClassBoardScreen()),
                      );
                    },
                    icon: const Icon(Icons.article_outlined, size: 18),
                    label: const Text('우리 반 알림장 바로보기', style: TextStyle(fontWeight: FontWeight.bold)),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: const Color(0xFF64748B),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text('닫기'),
                  ),
                ),
              ] else
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFF2563EB),
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    child: const Text('확인', style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTypeBadge(String type) {
    Color bg;
    Color fg;
    String label;

    switch (type) {
      case 'SHUTTLE':
        bg = const Color(0xFFDBEAFE);
        fg = const Color(0xFF1D4ED8);
        label = '셔틀';
        break;
      case 'BOARDING':
        bg = const Color(0xFFDCFCE7);
        fg = const Color(0xFF15803D);
        label = '탑승';
        break;
      case 'ABSENCE':
        bg = const Color(0xFFFEF3C7);
        fg = const Color(0xFFB45309);
        label = '결석';
        break;
      case 'MESSAGE':
        bg = const Color(0xFFE0E7FF);
        fg = const Color(0xFF4338CA);
        label = '메시지';
        break;
      case 'BOARD':
        bg = const Color(0xFFCCFBF1);
        fg = const Color(0xFF0F766E);
        label = '알림장';
        break;
      default:
        bg = const Color(0xFFF1F5F9);
        fg = const Color(0xFF475569);
        label = '공지';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(6)),
      child: Text(label, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.bold)),
    );
  }

  IconData _getTypeIcon(String type) {
    switch (type) {
      case 'SHUTTLE':
        return Icons.directions_bus_rounded;
      case 'BOARDING':
        return Icons.how_to_reg_rounded;
      case 'ABSENCE':
        return Icons.event_busy_rounded;
      case 'MESSAGE':
        return Icons.mark_email_unread_rounded;
      case 'BOARD':
        return Icons.article_rounded;
      default:
        return Icons.notifications_rounded;
    }
  }

  Color _getTypeIconColor(String type) {
    switch (type) {
      case 'SHUTTLE':
        return const Color(0xFF2563EB);
      case 'BOARDING':
        return const Color(0xFF16A34A);
      case 'ABSENCE':
        return const Color(0xFFD97706);
      case 'MESSAGE':
        return const Color(0xFF6366F1);
      case 'BOARD':
        return const Color(0xFF0D9488);
      default:
        return const Color(0xFF64748B);
    }
  }

  String _formatDateTime(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inMinutes < 1) return '방금 전';
    if (diff.inMinutes < 60) return '${diff.inMinutes}분 전';
    if (diff.inHours < 24) return '${diff.inHours}시간 전';
    if (diff.inDays < 7) return '${diff.inDays}일 전';
    return '${dt.month}월 ${dt.day}일';
  }

  @override
  Widget build(BuildContext context) {
    final unreadCount = _notifications.where((n) => !n.isRead).length;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          '알림 목록',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFF0F172A)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        iconTheme: const IconThemeData(color: Color(0xFF0F172A)),
        actions: [
          TextButton(
            onPressed: unreadCount > 0 ? _markAllAsRead : null,
            child: Text(
              '모두 읽음',
              style: TextStyle(
                fontWeight: FontWeight.bold,
                fontSize: 14,
                color: unreadCount > 0 ? const Color(0xFF2563EB) : const Color(0xFF94A3B8),
              ),
            ),
          ),
          const SizedBox(width: 8),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : RefreshIndicator(
              onRefresh: _loadNotifications,
              child: _notifications.isEmpty
                  ? Center(
                      child: SingleChildScrollView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(20),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF1F5F9),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.notifications_none_rounded,
                                size: 48,
                                color: Color(0xFF94A3B8),
                              ),
                            ),
                            const SizedBox(height: 16),
                            const Text(
                              '새로운 알림이 없습니다',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Color(0xFF475569),
                              ),
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              '도착·출발, 탑승 현황 및 새 소식이 여기에 표시됩니다.',
                              style: TextStyle(fontSize: 13, color: Color(0xFF94A3B8)),
                            ),
                          ],
                        ),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      itemCount: _notifications.length,
                      separatorBuilder: (context, index) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final noti = _notifications[index];
                        final isUnread = !noti.isRead;

                        return Material(
                          color: Colors.transparent,
                          child: InkWell(
                            onTap: () => _showNotificationDetail(noti, index),
                            borderRadius: BorderRadius.circular(16),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                color: isUnread ? const Color(0xFFF0F7FF) : Colors.white,
                                borderRadius: BorderRadius.circular(16),
                                border: Border.all(
                                  color: isUnread ? const Color(0xFFBFDBFE) : const Color(0xFFE2E8F0),
                                  width: isUnread ? 1.5 : 1,
                                ),
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
                                  // Category Icon
                                  Container(
                                    width: 40,
                                    height: 40,
                                    decoration: BoxDecoration(
                                      color: _getTypeIconColor(noti.type).withValues(alpha: 0.12),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Icon(
                                      _getTypeIcon(noti.type),
                                      color: _getTypeIconColor(noti.type),
                                      size: 20,
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  // Content
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            _buildTypeBadge(noti.type),
                                            const SizedBox(width: 6),
                                            Expanded(
                                              child: Text(
                                                noti.title,
                                                style: TextStyle(
                                                  fontSize: 14,
                                                  fontWeight: isUnread ? FontWeight.w800 : FontWeight.w600,
                                                  color: isUnread ? const Color(0xFF0F172A) : const Color(0xFF334155),
                                                ),
                                                maxLines: 1,
                                                overflow: TextOverflow.ellipsis,
                                              ),
                                            ),
                                            const SizedBox(width: 6),
                                            if (isUnread)
                                              Container(
                                                width: 7,
                                                height: 7,
                                                margin: const EdgeInsets.only(right: 6),
                                                decoration: const BoxDecoration(
                                                  color: Color(0xFFEF4444),
                                                  shape: BoxShape.circle,
                                                ),
                                              ),
                                            Text(
                                              _formatDateTime(noti.createdAt),
                                              style: TextStyle(
                                                fontSize: 11,
                                                color: isUnread ? const Color(0xFF2563EB) : const Color(0xFF94A3B8),
                                                fontWeight: isUnread ? FontWeight.bold : FontWeight.normal,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          noti.message,
                                          style: TextStyle(
                                            fontSize: 13,
                                            height: 1.4,
                                            color: isUnread ? const Color(0xFF1E293B) : const Color(0xFF64748B),
                                          ),
                                          maxLines: 2,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
