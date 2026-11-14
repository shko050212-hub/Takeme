import 'dart:async';
import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../models/student_model.dart';
import '../../models/route_model.dart';
import '../../widgets/kakao_map_view.dart';
import 'change_request_modal.dart';
import 'my_requests_screen.dart';
import 'student_notification_list_screen.dart';
import 'student_board_screen.dart';
import '../chat/chat_room_list_screen.dart';
import '../settings_screen.dart';

class StudentHomeScreen extends StatefulWidget {
  const StudentHomeScreen({super.key});

  @override
  State<StudentHomeScreen> createState() => _StudentHomeScreenState();
}

class _StudentHomeScreenState extends State<StudentHomeScreen> {
  int _currentNavIndex = 0; // 0: 홈/셔틀, 1: 공지창, 2: 1:1 메시지
  String _activeTab = 'goto'; // 'goto' (등교/등원) | 'gohome' (하교/귀가)
  StudentModel? _studentInfo;
  RouteDataModel? _routeData;
  int _unreadNotificationCount = 0;
  Timer? _notificationPollTimer;
  Map<String, dynamic>? _todaySchedule;

  double? _busLat;
  double? _busLng;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadAllData();
    _loadUnreadCount();
    _notificationPollTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (mounted) _loadUnreadCount();
    });
  }

  @override
  void dispose() {
    _notificationPollTimer?.cancel();
    final vehicleId = _routeData?.vehicleId;
    if (vehicleId != null) {
      SocketService().leaveVehicleRoom(vehicleId);
    }
    super.dispose();
  }

  Future<void> _loadUnreadCount() async {
    try {
      final user = ApiService().currentUser;
      if (user == null) return;
      final count = await ApiService().getUnreadNotificationCount(user.email);
      if (mounted) {
        setState(() => _unreadNotificationCount = count);
      }
    } catch (e) {
      debugPrint('[StudentHomeScreen] _loadUnreadCount error: $e');
    }
  }

  Future<void> _loadAllData() async {
    if (!mounted) return;
    setState(() => _isLoading = true);

    try {
      final user = ApiService().currentUser;
      if (user == null) {
        if (mounted) setState(() => _isLoading = false);
        return;
      }

      try {
        SocketService().connect(ApiService().token);
      } catch (e) {
        debugPrint('[StudentHomeScreen] Socket connect error: $e');
      }

      final results = await Future.wait([
        ApiService().getMyChild(user.email),
        ApiService().getParentRoute(user.email),
        ApiService().getTodaySchedule(user.email),
      ]).timeout(const Duration(seconds: 8), onTimeout: () {
        return [null, null, null];
      });

      final student = results[0] as StudentModel?;
      final route = results[1] as RouteDataModel?;
      final schedule = results[2] as Map<String, dynamic>?;

      if (mounted) {
        setState(() {
          _studentInfo = student;
          _routeData = route;
          _todaySchedule = schedule;
        });

        if (route?.vehicleId != null) {
          try {
            SocketService().joinVehicleRoom(route!.vehicleId!);
            SocketService().onLocationUpdated((data) {
              if (mounted && data['lat'] != null && data['lng'] != null) {
                setState(() {
                  _busLat = double.tryParse(data['lat'].toString());
                  _busLng = double.tryParse(data['lng'].toString());
                });
              }
            });
          } catch (e) {
            debugPrint('[StudentHomeScreen] Socket room error: $e');
          }
        }

        try {
          SocketService().onChangeRequestDecided((data) {
            if (!mounted) return;
            _loadUnreadCount();
            final statusText = data['status'] == 'APPROVED' ? '승인' : '반려';
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('통학 변경 신청이 $statusText되었습니다.'),
                backgroundColor: data['status'] == 'APPROVED' ? const Color(0xFF10B981) : const Color(0xFFEF4444),
              ),
            );
          });
        } catch (_) {}
      }
    } catch (e) {
      debugPrint('[StudentHomeScreen] _loadAllData error: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  /// 학생 모바일 통학 QR 탑승권 모달
  void _showStudentQRModal() {
    final user = ApiService().currentUser;
    final studentName = _studentInfo?.name ?? user?.name ?? '김민준';
    final vehicleName = _studentInfo?.vehicleName ?? '1호차 셔틀';

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: const Color(0xFFCBD5E1),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              const SizedBox(height: 16),
              const Text(
                '학생 모바일 탑승증',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 4),
              Text(
                '셔틀 탑승 시 단말기에 QR 코드를 태그해주세요.',
                style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
              ),
              const SizedBox(height: 20),
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFF8FAFC),
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Column(
                  children: [
                    QrImageView(
                      data: 'TAKEME_STUDENT:${user?.email ?? "student"}:$studentName',
                      version: QrVersions.auto,
                      size: 180.0,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '$studentName 학생 ($vehicleName)',
                      style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFF1E293B)),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(ctx),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF4338CA),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: const Text('닫기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      titleSpacing: 20,
      backgroundColor: Colors.white,
      elevation: 0,
      title: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(7),
            decoration: BoxDecoration(
              color: const Color(0xFF4338CA),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.school_rounded, color: Colors.white, size: 20),
          ),
          const SizedBox(width: 10),
          const Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'TAKEME 학생',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
              ),
              Text(
                '중·고등부 안심 통학 셔틀',
                style: TextStyle(fontSize: 10, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
              ),
            ],
          ),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.qr_code_rounded, color: Color(0xFF4338CA), size: 24),
          tooltip: '내 모바일 학생 탑승증',
          onPressed: _showStudentQRModal,
        ),
        Stack(
          children: [
            IconButton(
              icon: const Icon(Icons.notifications_none_rounded, color: Color(0xFF1E293B), size: 24),
              onPressed: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const StudentNotificationListScreen()),
                ).then((_) => _loadUnreadCount());
              },
            ),
            if (_unreadNotificationCount > 0)
              Positioned(
                top: 8,
                right: 8,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    color: Color(0xFFEF4444),
                    shape: BoxShape.circle,
                  ),
                  child: Text(
                    '$_unreadNotificationCount',
                    style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
          ],
        ),
        IconButton(
          icon: const Icon(Icons.settings_outlined, color: Color(0xFF1E293B), size: 22),
          onPressed: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            );
          },
        ),
        const SizedBox(width: 8),
      ],
    );
  }

  Widget _buildTabItem(String tabKey, String title, IconData icon) {
    final isSelected = _activeTab == tabKey;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          setState(() {
            _activeTab = tabKey;
          });
        },
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF4338CA) : Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: isSelected ? const Color(0xFF4338CA) : const Color(0xFFE2E8F0),
            ),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: const Color(0xFF4338CA).withValues(alpha: 0.25),
                      blurRadius: 8,
                      offset: const Offset(0, 3),
                    )
                  ]
                : [],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 18, color: isSelected ? Colors.white : const Color(0xFF64748B)),
              const SizedBox(width: 6),
              Text(
                title,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  color: isSelected ? Colors.white : const Color(0xFF64748B),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHomeBody() {
    final user = ApiService().currentUser;
    final studentName = _studentInfo?.name ?? user?.name ?? '김민준';
    final academyName = _routeData?.academyName ?? _studentInfo?.academyName ?? '마곡 안심 아카데미';
    final vehicleName = _studentInfo?.vehicleName ?? '1호차 셔틀';

    return RefreshIndicator(
      onRefresh: _loadAllData,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // 1. 내 프로필 및 통학 상태 카드
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 24,
                        backgroundColor: const Color(0xFFEEF2FF),
                        child: Text(
                          studentName.isNotEmpty ? studentName.substring(0, 1) : '학',
                          style: const TextStyle(color: Color(0xFF4338CA), fontWeight: FontWeight.bold, fontSize: 18),
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Text(
                                  '$studentName 학생',
                                  style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                ),
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFFEEF2FF),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    vehicleName,
                                    style: const TextStyle(color: Color(0xFF4338CA), fontSize: 10, fontWeight: FontWeight.bold),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              academyName,
                              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.qr_code_2_rounded, color: Color(0xFF4338CA), size: 28),
                        tooltip: '모바일 탑승권',
                        onPressed: _showStudentQRModal,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // 2. 등교(등원) / 하교(귀가) 탭
                Row(
                  children: [
                    _buildTabItem('goto', '등교 (등원)', Icons.wb_sunny_rounded),
                    const SizedBox(width: 8),
                    _buildTabItem('gohome', '하교 (귀가)', Icons.nightlight_round),
                  ],
                ),
                const SizedBox(height: 14),

                // 3. 탑승 안내 가이드 카드
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: const Color(0xFFE2E8F0)),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.03),
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(
                          color: _activeTab == 'gohome' ? const Color(0xFFECFDF5) : const Color(0xFFEEF2FF),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Icon(
                          _activeTab == 'gohome' ? Icons.home_rounded : Icons.location_on_rounded,
                          color: _activeTab == 'gohome' ? const Color(0xFF10B981) : const Color(0xFF4338CA),
                          size: 24,
                        ),
                      ),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _activeTab == 'gohome' ? '오늘 하교 셔틀 도착 예정' : '오늘 등교 셔틀 탑승 예정',
                              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _activeTab == 'gohome'
                                  ? '${_studentInfo?.boardingLocation ?? _studentInfo?.address ?? "마곡나루역 1번 출구 앞"} (16:30 하교 완료)'
                                  : '${_studentInfo?.boardingLocation ?? _studentInfo?.address ?? "마곡나루역 1번 출구 앞"} (08:40 탑승)',
                              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 16),

                // 4. 실시간 네비게이션 지도 (A 방식 도로선 및 기사 실시간 위치)
                Container(
                  height: 300,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(20),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.06),
                        blurRadius: 10,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: KakaoMapView(
                    isGohome: _activeTab == 'gohome',
                    stops: _routeData?.stops ?? [],
                    routePoints: _routeData?.routePoints ?? [],
                    busLat: _busLat,
                    busLng: _busLng,
                    academyLat: _routeData?.academyLat,
                    academyLng: _routeData?.academyLng,
                    academyName: academyName,
                    myChildName: studentName,
                    myChildAddress: _todaySchedule?['address'] ?? _studentInfo?.boardingLocation ?? _studentInfo?.address,
                  ),
                ),
                const SizedBox(height: 16),

                // 5. 학생 빠른 신청 액션 버튼들
                Row(
                  children: [
                    Expanded(
                      flex: 3,
                      child: ElevatedButton.icon(
                        onPressed: () {
                          showDialog(
                            context: context,
                            builder: (_) => ChangeRequestModal(
                              email: user!.email,
                              onSuccess: _loadAllData,
                            ),
                          );
                        },
                        icon: const Icon(Icons.edit_calendar_rounded, size: 19, color: Colors.white),
                        label: const Text(
                          '탑승 장소/시간 변경',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: Colors.white),
                        ),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF4338CA),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 2,
                      child: OutlinedButton.icon(
                        onPressed: () {
                          Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const MyRequestsScreen()),
                          );
                        },
                        icon: const Icon(Icons.history_rounded, size: 18, color: Color(0xFF4338CA)),
                        label: const Text(
                          '신청 내역',
                          style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: Color(0xFF4338CA)),
                        ),
                        style: OutlinedButton.styleFrom(
                          side: const BorderSide(color: Color(0xFFC7D2FE), width: 1.5),
                          backgroundColor: const Color(0xFFEEF2FF),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: _currentNavIndex == 0 ? _buildAppBar() : null,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF4338CA)))
          : IndexedStack(
              index: _currentNavIndex,
              children: [
                _buildHomeBody(),
                ClassBoardScreen(
                  childClassName: _studentInfo?.className,
                  isEmbedded: true,
                ),
                const ChatRoomListScreen(isEmbeddedTab: true),
              ],
            ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _currentNavIndex,
        onTap: (index) {
          setState(() {
            _currentNavIndex = index;
          });
        },
        backgroundColor: Colors.white,
        selectedItemColor: const Color(0xFF4338CA),
        unselectedItemColor: const Color(0xFF94A3B8),
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 12),
        unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w500, fontSize: 12),
        type: BottomNavigationBarType.fixed,
        elevation: 8,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.directions_bus_rounded),
            activeIcon: Icon(Icons.directions_bus_filled_rounded),
            label: '홈 / 셔틀',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.article_outlined),
            activeIcon: Icon(Icons.article_rounded),
            label: '공지창',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.chat_bubble_outline_rounded),
            activeIcon: Icon(Icons.chat_bubble_rounded),
            label: '1:1 메시지',
          ),
        ],
      ),
    );
  }
}
