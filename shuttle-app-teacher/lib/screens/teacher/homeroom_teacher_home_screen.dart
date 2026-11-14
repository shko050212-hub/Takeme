import 'dart:async';
import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../settings_screen.dart';
import '../staff/teacher_board_view.dart';
import '../chat/chat_room_list_screen.dart';
import 'homeroom_students_view.dart';
import 'homeroom_attendance_view.dart';
import 'homeroom_change_requests_view.dart';
import '../media/photo_gallery_screen.dart';

class HomeroomTeacherHomeScreen extends StatefulWidget {
  const HomeroomTeacherHomeScreen({super.key});

  @override
  State<HomeroomTeacherHomeScreen> createState() => _HomeroomTeacherHomeScreenState();
}

class _HomeroomTeacherHomeScreenState extends State<HomeroomTeacherHomeScreen> {
  int _selectedTabIndex = 0;
  late final PageController _pageController;
  bool _isRefreshing = false;
  int _unreadNotificationCount = 0;
  int _unreadChatCount = 0;
  Timer? _notificationPollTimer;

  @override
  void initState() {
    super.initState();
    _pageController = PageController(initialPage: _selectedTabIndex);
    _loadUnreadCount();
    _notificationPollTimer = Timer.periodic(const Duration(seconds: 30), (_) => _loadUnreadCount());
    SocketService().connect(ApiService().token);
    SocketService().onNotificationReceived((_) {
      if (mounted) _loadUnreadCount();
    });
    SocketService().onRoomUpdated((_) {
      if (mounted) _loadUnreadCount();
    });
  }

  @override
  void dispose() {
    _pageController.dispose();
    _notificationPollTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadUnreadCount() async {
    try {
      final count = await ApiService().getTeacherUnreadCount();
      final chatCount = await ApiService().getChatTotalUnreadCount();
      if (mounted) {
        setState(() {
          _unreadNotificationCount = count;
          _unreadChatCount = chatCount;
        });
      }
    } catch (_) {}
  }

  Widget _buildNotificationButton() {
    final totalUnread = _unreadNotificationCount + _unreadChatCount;
    return Stack(
      clipBehavior: Clip.none,
      alignment: Alignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.forum_outlined, color: Color(0xFF0F172A), size: 24),
          tooltip: '메신저 & 알림',
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ChatRoomListScreen()),
            ).then((_) => _loadUnreadCount());
          },
        ),
        if (totalUnread > 0)
          Positioned(
            right: 4,
            bottom: 4,
            child: IgnorePointer(
              child: Container(
                padding: const EdgeInsets.all(3),
                decoration: BoxDecoration(
                  color: const Color(0xFFEF4444),
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 2),
                ),
                constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
                alignment: Alignment.center,
                child: Text(
                  totalUnread > 9 ? '9+' : '$totalUnread',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                    height: 1,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildTabItem({
    required int index,
    required IconData icon,
    required String label,
    int badgeCount = 0,
  }) {
    final isSelected = _selectedTabIndex == index;
    return Expanded(
      child: InkWell(
        onTap: () {
          _pageController.animateToPage(
            index,
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
          );
        },
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
                decoration: BoxDecoration(
                  color: isSelected ? const Color(0xFFF1F5F9) : Colors.transparent,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Stack(
                  clipBehavior: Clip.none,
                  alignment: Alignment.center,
                  children: [
                    Icon(
                      icon,
                      size: 24,
                      color: isSelected ? const Color(0xFF0F172A) : const Color(0xFF94A3B8),
                    ),
                    if (badgeCount > 0)
                      Positioned(
                        right: -7,
                        bottom: -4,
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                          decoration: BoxDecoration(
                            color: const Color(0xFFEF4444),
                            shape: BoxShape.circle,
                            border: Border.all(color: Colors.white, width: 2),
                          ),
                          constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                          alignment: Alignment.center,
                          child: Text(
                            badgeCount > 9 ? '9+' : '$badgeCount',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                              height: 1,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 2),
              Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textScaler: MediaQuery.textScalerOf(context).clamp(maxScaleFactor: 1.2),
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: isSelected ? FontWeight.w800 : FontWeight.w500,
                  color: isSelected ? const Color(0xFF0F172A) : const Color(0xFF94A3B8),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _getAppTitle() {
    switch (_selectedTabIndex) {
      case 0:
        return '우리 반 원아 명단';
      case 1:
        return '학급 알림장·게시물';
      case 2:
        return '출석부 관리';
      case 3:
        return '통학 변동 현황';
      case 4:
        return '실시간 메신저';
      default:
        return '담임교사 홈';
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ApiService().currentUser;
    final hasClass = user?.assignedClass != null &&
        user!.assignedClass!.trim().isNotEmpty &&
        user.assignedClass != '미배정';

    if (!hasClass) {
      return Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        appBar: AppBar(
          title: const Text(
            '담임교사 포털',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
          ),
          backgroundColor: Colors.white,
          elevation: 0,
          actions: [
            _buildNotificationButton(),
            IconButton(
              icon: const Icon(Icons.cloud_outlined, color: Color(0xFF475569)),
              tooltip: '사진 보관함',
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(
                    builder: (_) => PhotoGalleryScreen(
                      initialClassName: user?.assignedClass,
                    ),
                  ),
                );
              },
            ),
            IconButton(
              icon: const Icon(Icons.settings_outlined, color: Color(0xFF475569)),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const SettingsScreen()),
                );
              },
            ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(1),
            child: Container(color: const Color(0xFFF1F5F9), height: 1),
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Container(
                  width: 80,
                  height: 80,
                  decoration: const BoxDecoration(
                    color: Color(0xFFEFF6FF),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.school_outlined, size: 44, color: Color(0xFF2563EB)),
                ),
                const SizedBox(height: 24),
                const Text(
                  '담당 반이 배정되지 않았습니다',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                ),
                const SizedBox(height: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF2F2),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: const Color(0xFFFECACA)),
                  ),
                  child: const Text(
                    '관리자에게 반 배정을 요청하세요',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Color(0xFFDC2626)),
                    textAlign: TextAlign.center,
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  '원장님 또는 관리자 웹에서 담당 반이 배정되면\n우리 반 원아 명단 및 알림장이 자동으로 활성화됩니다.',
                  style: TextStyle(fontSize: 13, color: Color(0xFF64748B), height: 1.5),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 28),
                ElevatedButton.icon(
                  onPressed: _isRefreshing
                      ? null
                      : () async {
                          setState(() => _isRefreshing = true);
                          await ApiService().fetchTeacherProfile();
                          if (mounted) {
                            setState(() => _isRefreshing = false);
                          }
                        },
                  icon: _isRefreshing
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                        )
                      : const Icon(Icons.refresh, size: 18),
                  label: Text(_isRefreshing ? '확인 중...' : '배정 상태 다시 확인'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF2563EB),
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
                    elevation: 0,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final teacherName = user.name.isNotEmpty ? user.name : '담임교사';
    final assignedClass = user.assignedClass!;

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  _getAppTitle(),
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFFBFDBFE)),
                  ),
                  child: Text(
                    '$assignedClass 담임',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              '$teacherName 담임선생님',
              style: const TextStyle(fontSize: 11, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
            ),
          ],
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.cloud_outlined, color: Color(0xFF475569)),
            tooltip: '사진 보관함',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => PhotoGalleryScreen(
                    initialClassName: user.assignedClass,
                  ),
                ),
              );
            },
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: Color(0xFF475569)),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SettingsScreen()),
              );
            },
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: PageView(
        controller: _pageController,
        onPageChanged: (idx) {
          setState(() => _selectedTabIndex = idx);
        },
        children: const [
          HomeroomStudentsView(),
          TeacherBoardView(),
          HomeroomAttendanceView(),
          HomeroomChangeRequestsView(),
          ChatRoomListScreen(isEmbeddedTab: true),
        ],
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(
            top: BorderSide(color: Color(0xFFE2E8F0), width: 1),
          ),
        ),
        child: SafeArea(
          top: false,
          bottom: true,
          left: true,
          right: true,
          child: SizedBox(
            height: 64,
            child: Row(
              children: [
                _buildTabItem(index: 0, icon: Icons.people_alt_outlined, label: '우리 반 원아'),
                _buildTabItem(index: 1, icon: Icons.photo_library_outlined, label: '알림장·게시물'),
                _buildTabItem(index: 2, icon: Icons.fact_check_outlined, label: '출석부'),
                _buildTabItem(index: 3, icon: Icons.edit_calendar_outlined, label: '통학 변동'),
                _buildTabItem(
                  index: 4,
                  icon: Icons.forum_outlined,
                  label: '메신저',
                  badgeCount: _unreadChatCount + _unreadNotificationCount,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
