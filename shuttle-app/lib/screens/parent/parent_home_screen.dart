import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../models/student_model.dart';
import '../../models/route_model.dart';
import '../../models/notification_model.dart';
import '../../widgets/kakao_map_view.dart';
import 'absence_modal.dart';
import '../settings_screen.dart';

class ParentHomeScreen extends StatefulWidget {
  const ParentHomeScreen({super.key});

  @override
  State<ParentHomeScreen> createState() => _ParentHomeScreenState();
}

class _ParentHomeScreenState extends State<ParentHomeScreen> {
  String _activeTab = 'goto'; // 'goto' (등원) | 'gohome' (하원)
  StudentModel? _childInfo;
  RouteDataModel? _routeData;
  List<NotificationModel> _notifications = [];
  Map<String, dynamic>? _todaySchedule;

  double? _busLat;
  double? _busLng;
  bool _isLoading = true;
  bool _isScanning = false;

  final _allergyController = TextEditingController();
  final List<String> _commonAllergies = [
    '땅콩', '견과류', '우유', '복숭아', '계란', '갑각류', '대두', '밀가루', '생선'
  ];

  @override
  void initState() {
    super.initState();
    _loadAllData();
  }

  @override
  void dispose() {
    _allergyController.dispose();
    final vehicleId = _routeData?.vehicleId;
    if (vehicleId != null) {
      SocketService().leaveVehicleRoom(vehicleId);
    }
    super.dispose();
  }

  Future<void> _loadAllData() async {
    setState(() => _isLoading = true);
    final user = ApiService().currentUser;
    if (user == null) return;

    // Connect socket
    SocketService().connect(ApiService().token);

    final child = await ApiService().getMyChild(user.email);
    final route = await ApiService().getParentRoute(user.email);
    final notis = await ApiService().getNotifications(user.email);
    final schedule = await ApiService().getTodaySchedule(user.email);

    if (mounted) {
      setState(() {
        _childInfo = child;
        _routeData = route;
        _notifications = notis;
        _todaySchedule = schedule;
        _isLoading = false;
        if (child != null) {
          _allergyController.text = child.allergies;
        }
      });

      if (route?.vehicleId != null) {
        SocketService().joinVehicleRoom(route!.vehicleId!);
        SocketService().onLocationUpdated((data) {
          if (mounted && data['lat'] != null && data['lng'] != null) {
            setState(() {
              _busLat = double.tryParse(data['lat'].toString());
              _busLng = double.tryParse(data['lng'].toString());
            });
          }
        });
      }
    }
  }

  void _showAllergyEditDialog() {
    _allergyController.text = _childInfo?.allergies ?? '';
    bool isSaving = false;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) {
          void toggleChip(String chip) {
            List<String> list = _allergyController.text
                .split(',')
                .map((s) => s.trim())
                .where((s) => s.isNotEmpty)
                .toList();
            if (list.contains(chip)) {
              list.remove(chip);
            } else {
              list.add(chip);
            }
            setDialogState(() {
              _allergyController.text = list.join(', ');
            });
          }

          return AlertDialog(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: const Text('원아 알레르기 관리', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '식품이나 약품 등 주의해야 할 알레르기를 등록해주세요. 버스 지도교사 및 기사님께 실시간 공유됩니다.',
                    style: TextStyle(fontSize: 12, color: Color(0xFF64748B), height: 1.4),
                  ),
                  const SizedBox(height: 14),
                  const Text('빠른 선택 태그', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF334155))),
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: _commonAllergies.map((chip) {
                      final isSelected = _allergyController.text.split(',').map((s) => s.trim()).contains(chip);
                      return GestureDetector(
                        onTap: () => toggleChip(chip),
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                          decoration: BoxDecoration(
                            color: isSelected ? const Color(0xFFEFF6FF) : const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: isSelected ? const Color(0xFF3B82F6) : const Color(0xFFE2E8F0)),
                          ),
                          child: Text(
                            chip,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: isSelected ? const Color(0xFF2563EB) : const Color(0xFF475569),
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 14),
                  const Text('상세 알레르기 및 유의사항', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF334155))),
                  const SizedBox(height: 6),
                  TextField(
                    controller: _allergyController,
                    maxLines: 3,
                    decoration: InputDecoration(
                      hintText: '직접 입력 (예: 복숭아 먹으면 두드러기 발생, 견과류 절대 금지)',
                      hintStyle: const TextStyle(fontSize: 12, color: Color(0xFF94A3B8)),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      contentPadding: const EdgeInsets.all(12),
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx),
                child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
              ),
              ElevatedButton(
                onPressed: isSaving
                    ? null
                    : () async {
                        setDialogState(() => isSaving = true);
                        final user = ApiService().currentUser;
                        if (user != null) {
                          final allergiesText = _allergyController.text.trim();
                          final res = await ApiService().updateChildAllergies(user.email, allergiesText);
                          if (res['success'] == true) {
                            if (!mounted) return;
                            setState(() {
                              if (_childInfo != null) {
                                _childInfo = StudentModel(
                                  id: _childInfo!.id,
                                  name: _childInfo!.name,
                                  realName: _childInfo!.realName,
                                  address: _childInfo!.address,
                                  boardingLocation: _childInfo!.boardingLocation,
                                  latitude: _childInfo!.latitude,
                                  longitude: _childInfo!.longitude,
                                  allergies: allergiesText,
                                  className: _childInfo!.className,
                                  academyName: _childInfo!.academyName,
                                  vehicleName: _childInfo!.vehicleName,
                                  approvalStatus: _childInfo!.approvalStatus,
                                );
                              }
                            });
                            if (!ctx.mounted) return;
                            Navigator.pop(ctx);
                            if (!mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('알레르기 정보가 저장되었습니다.'), backgroundColor: Color(0xFF10B981)),
                            );
                          }
                        }
                      },
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
                child: const Text('저장', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ],
          );
        },
      ),
    );
  }

  void _handleQRScanResult(BarcodeCapture capture) async {
    if (_isScanning) return;
    final List<Barcode> barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final rawVal = barcodes.first.rawValue;
    if (rawVal == null || rawVal.isEmpty) return;

    setState(() => _isScanning = true);
    final user = ApiService().currentUser;
    if (user == null) return;

    String? teacherEmail;
    try {
      final data = Uri.splitQueryString(rawVal);
      teacherEmail = data['teacherEmail'];
    } catch (_) {}

    if (teacherEmail != null && teacherEmail.isNotEmpty) {
      final res = await ApiService().studentBoardByQR(user.email, teacherEmail);
      if (!mounted) return;
      Navigator.pop(context); // close camera sheet
      if (res['success'] == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('탑승 처리가 완료되었습니다.'), backgroundColor: Color(0xFF10B981)),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res['message'] ?? '탑승 처리에 실패했습니다.'), backgroundColor: Colors.red),
        );
      }
    } else {
      setState(() => _isScanning = false);
    }
  }

  void _openQRScanner() {
    _isScanning = false;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.black,
      builder: (ctx) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.black,
          title: const Text('탑승 QR 스캔', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          leading: IconButton(
            icon: const Icon(Icons.close, color: Colors.white),
            onPressed: () => Navigator.pop(ctx),
          ),
        ),
        body: Column(
          children: [
            Expanded(
              child: MobileScanner(
                onDetect: _handleQRScanResult,
              ),
            ),
            Container(
              padding: const EdgeInsets.all(24),
              child: const Text(
                '지도교사님의 폰에 띄워진 QR 코드를 사각형 안에 맞춰주세요.',
                style: TextStyle(color: Colors.white, fontSize: 13),
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final user = ApiService().currentUser;
    final isStudent = user?.role == 'STUDENT';

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          'TAKEME',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: Color(0xFF2563EB), letterSpacing: -0.5),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF64748B)),
            onPressed: _loadAllData,
          ),
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: Color(0xFF475569)),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SettingsScreen()),
              ).then((_) => _loadAllData());
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
                        // Tabs: 등원 / 하원
                        Row(
                          children: [
                            _buildTabItem('goto', '등원'),
                            const SizedBox(width: 8),
                            _buildTabItem('gohome', '하원'),
                          ],
                        ),
                        const SizedBox(height: 16),

                        // Child Info & Allergy Card
                        if (!isStudent && _childInfo != null) ...[
                          Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: Colors.white,
                              borderRadius: BorderRadius.circular(20),
                              border: Border.all(color: const Color(0xFFE2E8F0)),
                              boxShadow: [
                                BoxShadow(
                                  color: const Color(0xFF0F172A).withValues(alpha: 0.04),
                                  blurRadius: 8,
                                  offset: const Offset(0, 2),
                                )
                              ],
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                  children: [
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            '${_childInfo!.name} 원아${_childInfo!.className != null ? ' (${_childInfo!.className})' : ''}',
                                            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                                          ),
                                          const SizedBox(height: 2),
                                          Text(
                                            '${_childInfo!.academyName ?? '소속 원'} · ${_childInfo!.vehicleName ?? '차량 미배정'}',
                                            style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
                                          ),
                                        ],
                                      ),
                                    ),
                                    OutlinedButton(
                                      onPressed: _showAllergyEditDialog,
                                      style: OutlinedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                        backgroundColor: const Color(0xFFEFF6FF),
                                        side: const BorderSide(color: Color(0xFFBFDBFE)),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                      ),
                                      child: Text(
                                        _childInfo!.allergies.isNotEmpty ? '알레르기 수정' : '알레르기 등록',
                                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                                  decoration: BoxDecoration(
                                    color: _childInfo!.allergies.isNotEmpty ? const Color(0xFFFEF2F2) : const Color(0xFFF8FAFC),
                                    borderRadius: BorderRadius.circular(12),
                                    border: Border.all(
                                      color: _childInfo!.allergies.isNotEmpty ? const Color(0xFFFECACA) : const Color(0xFFF1F5F9),
                                    ),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text(
                                        '알레르기 정보',
                                        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF64748B)),
                                      ),
                                      const SizedBox(height: 2),
                                      Text(
                                        _childInfo!.allergies.isNotEmpty ? _childInfo!.allergies : '등록된 알레르기가 없습니다.',
                                        style: TextStyle(
                                          fontSize: 13,
                                          fontWeight: FontWeight.bold,
                                          color: _childInfo!.allergies.isNotEmpty ? const Color(0xFFDC2626) : const Color(0xFF10B981),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],

                        // Guide Card: Pickup info
                        Container(
                          padding: const EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                            border: Border.all(color: const Color(0xFFE2E8F0)),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF0F172A).withValues(alpha: 0.04),
                                blurRadius: 8,
                                offset: const Offset(0, 2),
                              )
                            ],
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 44,
                                height: 44,
                                decoration: BoxDecoration(
                                  color: const Color(0xFFEFF6FF),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: const Icon(Icons.location_on, color: Color(0xFF2563EB), size: 24),
                              ),
                              const SizedBox(width: 14),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      _todaySchedule?['dateStr'] ?? DateFormat('yyyy년 M월 d일').format(DateTime.now()),
                                      style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.w600),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      _todaySchedule?['address'] ?? _childInfo?.boardingLocation ?? _childInfo?.address ?? '탑승지 설정됨',
                                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Real-time Map
                        Container(
                          height: 280,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(20),
                            boxShadow: [
                              BoxShadow(
                                color: const Color(0xFF0F172A).withValues(alpha: 0.06),
                                blurRadius: 10,
                                offset: const Offset(0, 2),
                              )
                            ],
                          ),
                          child: KakaoMapView(
                            stops: _routeData?.stops ?? [],
                            routePoints: _routeData?.routePoints ?? [],
                            busLat: _busLat,
                            busLng: _busLng,
                            academyLat: _routeData?.academyLat,
                            academyLng: _routeData?.academyLng,
                            academyName: _routeData?.academyName,
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Action Buttons
                        if (!isStudent)
                          ElevatedButton.icon(
                            onPressed: () {
                              showDialog(
                                context: context,
                                builder: (_) => AbsenceModal(
                                  email: user!.email,
                                  onSuccess: _loadAllData,
                                ),
                              );
                            },
                            icon: const Icon(Icons.calendar_today, size: 18, color: Color(0xFF2563EB)),
                            label: const Text(
                              '결석 / 탑승지 변경 / 메시지',
                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Color(0xFF2563EB)),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.white,
                              elevation: 0,
                              side: const BorderSide(color: Color(0xFFE2E8F0)),
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            ),
                          )
                        else
                          ElevatedButton.icon(
                            onPressed: _openQRScanner,
                            icon: const Icon(Icons.qr_code_scanner, size: 20, color: Colors.white),
                            label: const Text(
                              '탑승 QR 스캔하기',
                              style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Colors.white),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: const Color(0xFF2563EB),
                              elevation: 2,
                              padding: const EdgeInsets.symmetric(vertical: 16),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                            ),
                          ),
                        const SizedBox(height: 24),

                        // Notification Inbox
                        Row(
                          children: [
                            const Icon(Icons.notifications_outlined, size: 18, color: Color(0xFF0F172A)),
                            const SizedBox(width: 6),
                            const Text(
                              '수신함',
                              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                            ),
                            const Spacer(),
                            if (_notifications.isNotEmpty)
                              Text(
                                '${_notifications.length}건',
                                style: const TextStyle(fontSize: 12, color: Color(0xFF64748B), fontWeight: FontWeight.bold),
                              ),
                          ],
                        ),
                        const SizedBox(height: 10),

                        if (_notifications.isEmpty)
                          Container(
                            padding: const EdgeInsets.symmetric(vertical: 24),
                            alignment: Alignment.center,
                            child: const Text('새로운 공지나 알림이 없습니다.', style: TextStyle(color: Color(0xFF94A3B8), fontSize: 13)),
                          )
                        else
                          ListView.separated(
                            shrinkWrap: true,
                            physics: const NeverScrollableScrollPhysics(),
                            itemCount: _notifications.length,
                            separatorBuilder: (context, index) => const SizedBox(height: 8),
                            itemBuilder: (ctx, idx) {
                              final noti = _notifications[idx];
                              return Container(
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: Colors.white,
                                  borderRadius: BorderRadius.circular(14),
                                  border: Border.all(color: const Color(0xFFF1F5F9)),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      DateFormat('HH:mm').format(noti.createdAt),
                                      style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8), fontWeight: FontWeight.w600),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      noti.message,
                                      style: const TextStyle(fontSize: 13, color: Color(0xFF334155), height: 1.4),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        const SizedBox(height: 30),
                      ],
                    ),
                  ),
                ),
              ),
            ),
    );
  }

  Widget _buildTabItem(String tab, String label) {
    final isSelected = _activeTab == tab;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _activeTab = tab),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF2563EB) : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: isSelected ? const Color(0xFF2563EB) : const Color(0xFFE2E8F0)),
          ),
          alignment: Alignment.center,
          child: Text(
            label,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              color: isSelected ? Colors.white : const Color(0xFF64748B),
            ),
          ),
        ),
      ),
    );
  }
}
