import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../models/student_model.dart';
import '../../models/route_model.dart';
import '../settings_screen.dart';

class StaffDashboardScreen extends StatefulWidget {
  const StaffDashboardScreen({super.key});

  @override
  State<StaffDashboardScreen> createState() => _StaffDashboardScreenState();
}

class _StaffDashboardScreenState extends State<StaffDashboardScreen> {
  List<StudentModel> _students = [];
  RouteDataModel? _routeData;
  Map<String, dynamic>? _vehicleInfo;

  bool _isLoading = true;
  bool _isEscorting = false; // 동승 중 여부 (지도교사 동승 상태)
  int _currentRunNumber = 1;
  int _currentStopIndex = 0;

  final FlutterTts _flutterTts = FlutterTts();
  final Set<int> _selectedStudentIds = {};
  final _broadcastMessageController = TextEditingController();
  final _memoController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _initTts();
    _loadAllData();
    _setupSocketListeners();
  }

  @override
  void dispose() {
    _broadcastMessageController.dispose();
    _memoController.dispose();
    _flutterTts.stop();
    super.dispose();
  }

  void _initTts() async {
    try {
      await _flutterTts.setLanguage('ko-KR');
      await _flutterTts.setSpeechRate(0.5);
    } catch (e) {
      debugPrint('TTS Init Error: $e');
    }
  }

  /// 실시간 소켓 이벤트 리스너 등록
  void _setupSocketListeners() {
    // ⑤ 원아 상태 실시간 변경 반영
    SocketService().onStudentStatusUpdated((data) {
      if (!mounted) return;
      _loadAllData(showSpinner: false);
      final studentName = data['studentName'] ?? '원아';
      final status = data['status'];
      String msg = '$studentName 원아의 상태가 변경되었습니다.';
      if (status == 'BOARDED') msg = '$studentName 원아가 탑승 처리되었습니다.';
      if (status == 'DROPPED_OFF') msg = '$studentName 원아가 하차 및 보호자 인계 완료되었습니다.';
      if (status == 'HANDOVER_FAILED') msg = '$studentName 원아 인계 실패(재탑승) 처리되었습니다.';
      if (status == 'ABSENT') msg = '$studentName 원아가 결석 처리되었습니다.';

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(msg),
          backgroundColor: const Color(0xFF2563EB),
          duration: const Duration(seconds: 2),
        ),
      );
    });

    // ⑤ 학부모/원장의 실시간 푸시(결석/탑승지 변경 등) 수신
    SocketService().onTeacherPush((data) {
      if (!mounted) return;
      _loadAllData(showSpinner: false);
      final title = data['title'] ?? '알림';
      final message = data['message'] ?? '원아 변동 사항이 있습니다.';
      _flutterTts.speak(message);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('[$title] $message'),
          backgroundColor: const Color(0xFFD97706),
          duration: const Duration(seconds: 3),
        ),
      );
    });

    // ⑤ 노선 또는 일정 변경 수신
    SocketService().onRouteUpdated((data) {
      if (!mounted) return;
      _loadAllData(showSpinner: false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('운행 노선 정보가 갱신되었습니다.'),
          backgroundColor: Color(0xFF059669),
          duration: Duration(seconds: 2),
        ),
      );
    });
  }

  Future<void> _loadAllData({bool showSpinner = true}) async {
    if (showSpinner) {
      setState(() => _isLoading = true);
    }
    final user = ApiService().currentUser;
    if (user == null) return;

    SocketService().connect(ApiService().token);

    final vehicle = await ApiService().getTeacherVehicle(user.email);
    final students = await ApiService().getTeacherStudents(user.email);
    final route = await ApiService().getTeacherRoute(user.email);

    if (mounted) {
      setState(() {
        _vehicleInfo = vehicle;
        _students = students;
        _routeData = route;
        _isLoading = false;

        final runs = _students.map((s) => s.runNumber).toSet().toList()..sort();
        if (runs.isNotEmpty && !runs.contains(_currentRunNumber)) {
          _currentRunNumber = runs.first;
        }

        final stopCount = _routeData?.stops.length ?? 0;
        if (_currentStopIndex >= stopCount && stopCount > 0) {
          _currentStopIndex = stopCount - 1;
        }
      });

      final vid = vehicle?['id'];
      if (vid != null) {
        final vehicleId = int.tryParse(vid.toString()) ?? 0;
        SocketService().joinVehicleRoom(vehicleId);
      }
    }
  }

  // ==========================================
  // ⑦ 동승 시작 및 종료 기능
  // ==========================================

  Future<void> _handleStartEscort() async {
    final vehicleId = _vehicleInfo?['id'];
    if (vehicleId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('배정된 차량 정보를 찾을 수 없습니다.'), backgroundColor: Colors.red),
      );
      return;
    }

    final res = await ApiService().startEscort();
    if (res['success'] == true) {
      setState(() => _isEscorting = true);
      _flutterTts.speak('동승을 시작합니다. 안전한 승하차를 지도해 주세요.');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('동승이 시작되었습니다. 운행일지에 동승 교사 기록이 저장되었습니다.'),
            backgroundColor: Color(0xFF10B981),
          ),
        );
      }
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(res['message'] ?? '동승 시작 처리에 실패했습니다.'), backgroundColor: Colors.red),
        );
      }
    }
  }

  // ② 운행 종료 시 잔류 아동 확인 후 동승 종료
  Future<void> _handleEndEscort() async {
    // 1) 잔류 아동 확인: 탑승(isBoarded) 중이거나 인계실패(isHandoverFailed)인 원아 체크
    final remainingStudents = _students.where((s) => s.isBoarded || s.isHandoverFailed).toList();

    if (remainingStudents.isNotEmpty) {
      final names = remainingStudents.map((s) => s.name).join(', ');
      await showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Color(0xFFDC2626), size: 28),
              SizedBox(width: 8),
              Text('잔류 원아 확인 경고', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: Color(0xFFDC2626))),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '차량 내에 아직 하차 또는 인계가 완료되지 않은 원아가 있습니다!',
                style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF1E293B)),
              ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: const Color(0xFFFECACA)),
                ),
                child: Text(
                  '미하차 원아 (${remainingStudents.length}명):\n$names',
                  style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFFDC2626), fontSize: 13),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                '모든 원아의 하차 및 보호자 인계가 완료되어야 동승을 안전하게 종료할 수 있습니다.',
                style: TextStyle(fontSize: 12, color: Color(0xFF64748B)),
              ),
            ],
          ),
          actions: [
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
              child: const Text('확인 및 원아 확인하기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
      return;
    }

    // 2) 잔류 아동이 없으면: "차량 맨 뒷좌석까지 확인했습니다" 체크 모달 띄우기
    bool checkedBackSeats = false;
    final notesCtrl = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('동승 종료 및 차량 안전 점검', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '모든 원아의 하차가 정상 완료되었습니다.\n차량 내 잔류 아동 사고 예방을 위해 맨 뒷좌석까지 철저히 확인해 주세요.',
                style: TextStyle(fontSize: 13, color: Color(0xFF475569)),
              ),
              const SizedBox(height: 16),
              Container(
                decoration: BoxDecoration(
                  color: checkedBackSeats ? const Color(0xFFF0FDF4) : const Color(0xFFFFFBEB),
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: checkedBackSeats ? const Color(0xFF86EFAC) : const Color(0xFFFCD34D)),
                ),
                child: CheckboxListTile(
                  value: checkedBackSeats,
                  onChanged: (val) => setDialogState(() => checkedBackSeats = val ?? false),
                  title: const Text(
                    '차량 맨 뒷좌석까지 확인했습니다',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Color(0xFF0F172A)),
                  ),
                  subtitle: const Text('법정 동승 보호자 안전 확인 의무 항목입니다.', style: TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                  activeColor: const Color(0xFF16A34A),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 6),
                ),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: notesCtrl,
                decoration: InputDecoration(
                  hintText: '특이사항 메모 (선택 입력)',
                  hintStyle: const TextStyle(fontSize: 12),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('취소', style: TextStyle(color: Color(0xFF64748B))),
            ),
            ElevatedButton(
              onPressed: checkedBackSeats ? () => Navigator.pop(ctx, true) : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF16A34A),
                disabledBackgroundColor: const Color(0xFFCBD5E1),
              ),
              child: const Text('동승 종료 완료', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      ),
    );

    if (confirmed == true) {
      final res = await ApiService().endEscort(
        checkedBackSeats: true,
        notes: notesCtrl.text.trim().isEmpty ? null : notesCtrl.text.trim(),
      );
      if (res['success'] == true) {
        setState(() => _isEscorting = false);
        _flutterTts.speak('동승이 안전하게 종료되었습니다. 수고하셨습니다.');
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('동승이 종료되었습니다. 안전 점검 기록이 운행 일지에 기록되었습니다.'),
              backgroundColor: Color(0xFF10B981),
            ),
          );
        }
      } else {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(res['message'] ?? '동승 종료 처리에 실패했습니다.'), backgroundColor: Colors.red),
          );
        }
      }
    }
  }

  // ==========================================
  // ③ 정류장별 인원 확인 & 기사에게 출발 신호
  // ==========================================

  Future<void> _handleSendDepartSignal(RouteStop? currentStop, List<StudentModel> stopStudents) async {
    final vehicleId = _vehicleInfo?['id'];
    if (vehicleId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('차량 정보가 없습니다.'), backgroundColor: Colors.red),
      );
      return;
    }
    final vId = int.tryParse(vehicleId.toString()) ?? 0;
    final stopName = currentStop?.name ?? '정류장';

    // 정류장 내 미완료 원아(아직 대기중이거나 처리되지 않은 원아) 확인
    final uncompleted = stopStudents.where((s) => s.isWaiting).toList();

    if (uncompleted.isNotEmpty) {
      final uncompletedNames = uncompleted.map((s) => s.name).join(', ');
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('출발 신호 전송 확인', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          content: Text(
            '아직 탑승 또는 결석 처리가 되지 않은 원아가 있습니다.\n\n대기 원아: $uncompletedNames\n\n그래도 기사님께 출발 신호를 보내시겠습니까?',
            style: const TextStyle(fontSize: 13, color: Color(0xFF334155)),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD97706)),
              child: const Text('출발 신호 보내기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
      if (confirm != true) return;
    }

    // 소켓 및 API 전송
    SocketService().sendReadyToDepart(vehicleId: vId, stopName: stopName);
    await ApiService().readyToDepart(stopName: stopName);

    _flutterTts.speak('$stopName 정류장 탑승 완료. 기사님께 출발 신호를 전달했습니다.');
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('기사님께 [$stopName] 출발 신호(출발 가능)를 전송했습니다.'),
          backgroundColor: const Color(0xFF10B981),
        ),
      );
    }
  }

  // ==========================================
  // ① 탑승, 하차, 인계 실패 및 원아 처리
  // ==========================================

  void _handleManualBoard(StudentModel student) {
    final reasonCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${student.name} 원아 탑승 확인', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('수동 탑승 처리 사유를 입력해주세요 (선택):'),
            const SizedBox(height: 10),
            TextField(
              controller: reasonCtrl,
              decoration: InputDecoration(
                hintText: '예: 교통카드 미소지, 직접 탑승 확인 등',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final user = ApiService().currentUser;
              if (user == null) return;
              final res = await ApiService().manualBoardStudent(user.email, student.id, reasonCtrl.text.trim());
              if (res['success'] == true) {
                _loadAllData(showSpinner: false);
                _flutterTts.speak('${student.name} 원아 탑승 완료');
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
            child: const Text('탑승 처리', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  /// ① 하차 및 보호자 인계 완료
  void _handleDropoffStudent(StudentModel student) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('${student.name} 원아 하차 및 인계', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: Text(
          '${student.name} 원아를 차량에서 하차시키고\n보호자에게 안전하게 인계하셨습니까?\n(인계 완료 시 학부모님께 알림이 발송됩니다)',
          style: const TextStyle(fontSize: 13, color: Color(0xFF334155)),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final res = await ApiService().dropoffStudent(student.id);
              if (res['success'] == true) {
                _loadAllData(showSpinner: false);
                _flutterTts.speak('${student.name} 원아 하차 및 인계 완료');
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('${student.name} 원아의 하차 및 인계가 완료되었습니다. 학부모님께 알림이 전송되었습니다.'),
                      backgroundColor: const Color(0xFF10B981),
                    ),
                  );
                }
              } else {
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text(res['message'] ?? '하차 처리에 실패했습니다.'), backgroundColor: Colors.red),
                  );
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981)),
            child: const Text('인계 완료', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  /// ① 인계 실패 · 다시 태움 처리
  void _handleHandoverFailed(StudentModel student) {
    final reasonCtrl = TextEditingController(text: '보호자 미도착');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Color(0xFFDC2626), size: 22),
            SizedBox(width: 6),
            Text('인계 실패 · 재탑승 처리', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Color(0xFFDC2626))),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '정류장에 보호자가 나타나지 않아 ${student.name} 원아를 차량에 다시 태우고 안전을 보호합니다.',
              style: const TextStyle(fontSize: 13, color: Color(0xFF334155)),
            ),
            const SizedBox(height: 12),
            const Text('인계 실패 사유:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            TextField(
              controller: reasonCtrl,
              decoration: InputDecoration(
                hintText: '예: 보호자 미도착, 전화 부재 등',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            ),
            const SizedBox(height: 10),
            const Text(
              '※ 처리 즉시 원장님 웹 및 학부모님께 긴급 알림이 발송되며, 운행 일지에 기록됩니다.',
              style: TextStyle(fontSize: 11, color: Color(0xFFDC2626)),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final res = await ApiService().handoverFailed(student.id, reason: reasonCtrl.text.trim());
              if (res['success'] == true) {
                _loadAllData(showSpinner: false);
                _flutterTts.speak('${student.name} 원아 보호자 인계 실패로 차량에 재탑승합니다.');
                if (mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('${student.name} 원아 인계 실패 처리 완료. 원장님 및 학부모님께 통보되었습니다.'),
                      backgroundColor: const Color(0xFFDC2626),
                    ),
                  );
                }
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            child: const Text('재탑승 처리', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _handleSkipStudent(StudentModel student) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${student.name} 원아 미탑승(결석) 처리', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: const Text('해당 원아를 오늘 미탑승(결석) 처리하고 다음 일정으로 계속하시겠습니까?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final user = ApiService().currentUser;
              if (user == null) return;
              final res = await ApiService().skipStudent(user.email, student.id);
              if (res['success'] == true) {
                _loadAllData(showSpinner: false);
                _flutterTts.speak('${student.name} 원아 결석 처리 완료');
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            child: const Text('결석 처리', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  // ==========================================
  // ⑥ 긴급 상황 및 학부모 전화 걸기
  // ==========================================

  Future<void> _makePhoneCall(String? phoneNumber) async {
    if (phoneNumber == null || phoneNumber.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('등록된 보호자 연락처가 없습니다.'), backgroundColor: Colors.orange),
      );
      return;
    }
    final cleanNumber = phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
    final uri = Uri.parse('tel:$cleanNumber');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('전화 걸기 실패: $phoneNumber'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _handleEmergency(StudentModel student) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.emergency, color: Color(0xFFDC2626), size: 24),
            const SizedBox(width: 6),
            Text('${student.name} 긴급 알림 발송', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          ],
        ),
        content: Text(
          '${student.name} 원아의 긴급 상황(갑작스러운 건강 이상, 응급 등)을 원장 및 학부모에게 즉시 알리시겠습니까?',
          style: const TextStyle(fontSize: 13, color: Color(0xFF334155)),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final res = await ApiService().triggerEmergency(studentId: student.id);
              if (res['success'] == true && mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('${student.name} 원아에 대한 긴급 상황 알림이 전송되었습니다.'),
                    backgroundColor: const Color(0xFFDC2626),
                  ),
                );
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            child: const Text('긴급 전송', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showTeacherQRModal() {
    final user = ApiService().currentUser;
    if (user == null) return;

    final qrData = 'teacherEmail=${Uri.encodeComponent(user.email)}';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              '원아 탑승용 QR 코드',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
            ),
            const SizedBox(height: 6),
            const Text(
              '원아 또는 학부모님께 이 화면을 보여주세요.',
              style: TextStyle(fontSize: 13, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0)),
                boxShadow: [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.05), blurRadius: 10, offset: const Offset(0, 4)),
                ],
              ),
              child: QrImageView(
                data: qrData,
                version: QrVersions.auto,
                size: 220,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              '동승 지도교사: ${user.name} (${user.email})',
              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF334155)),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(ctx),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: const Text('닫기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _showStudentMemoDialog(StudentModel student) {
    _memoController.text = student.teacherMemo ?? '';
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${student.name} 원아 메모 및 특이사항', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (student.allergies.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFFEF2F2),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFFFECACA)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded, size: 18, color: Color(0xFFDC2626)),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '알레르기: ${student.allergies}',
                        style: const TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold, fontSize: 12),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
            ],
            if (student.parentMessage != null && student.parentMessage!.isNotEmpty) ...[
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: const Color(0xFFEFF6FF),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '학부모 메시지: ${student.parentMessage}',
                  style: const TextStyle(color: Color(0xFF1E40AF), fontSize: 12),
                ),
              ),
              const SizedBox(height: 12),
            ],
            const Text('교사 메모 작성:', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            TextField(
              controller: _memoController,
              maxLines: 3,
              decoration: InputDecoration(
                hintText: '특이사항이나 전달사항을 입력하세요.',
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final res = await ApiService().saveTeacherMemo(student.id, _memoController.text.trim());
              if (res['success'] == true) {
                _loadAllData(showSpinner: false);
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF2563EB)),
            child: const Text('저장', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  void _showBroadcastModal() {
    _broadcastMessageController.clear();
    bool sendToParents = true;
    bool sendToStudents = false;
    bool isSending = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => StatefulBuilder(
        builder: (context, setModalState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 24,
            bottom: MediaQuery.of(context).viewInsets.bottom + 24,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                '선택 원아 메시지 전송',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 4),
              Text(
                '선택된 원아 ${_selectedStudentIds.length}명의 보호자에게 메시지를 전송합니다.',
                style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  FilterChip(
                    label: const Text('학부모'),
                    selected: sendToParents,
                    onSelected: (v) => setModalState(() => sendToParents = v),
                    selectedColor: const Color(0xFFEFF6FF),
                    checkmarkColor: const Color(0xFF2563EB),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('학생'),
                    selected: sendToStudents,
                    onSelected: (v) => setModalState(() => sendToStudents = v),
                    selectedColor: const Color(0xFFEFF6FF),
                    checkmarkColor: const Color(0xFF2563EB),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              TextField(
                controller: _broadcastMessageController,
                maxLines: 3,
                decoration: InputDecoration(
                  hintText: '전송할 메시지 내용을 입력하세요 (예: 5분 후 탑승지에 도착 예정입니다)',
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                  contentPadding: const EdgeInsets.all(12),
                ),
              ),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: isSending
                    ? null
                    : () async {
                        final msg = _broadcastMessageController.text.trim();
                        if (msg.isEmpty) return;

                        final roles = <String>[];
                        if (sendToParents) roles.add('PARENT');
                        if (sendToStudents) roles.add('STUDENT');
                        if (roles.isEmpty) return;

                        setModalState(() => isSending = true);
                        final user = ApiService().currentUser;
                        if (user != null) {
                          final res = await ApiService().broadcastMessage(
                            user.email,
                            studentIds: _selectedStudentIds.toList(),
                            targetRoles: roles,
                            message: msg,
                          );
                          if (!ctx.mounted) return;
                          Navigator.pop(ctx);
                          if (!mounted) return;
                          if (res['success'] == true) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(content: Text('메시지가 성공적으로 전송되었습니다.'), backgroundColor: Color(0xFF10B981)),
                            );
                          }
                        }
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                child: isSending
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                    : const Text('메시지 전송하기', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final runList = _students.where((s) => s.runNumber == _currentRunNumber).toList();
    final availableRuns = _students.map((s) => s.runNumber).toSet().toList()..sort();

    final stops = _routeData?.stops ?? [];
    final hasStops = stops.isNotEmpty;
    final currentStop = hasStops && _currentStopIndex < stops.length ? stops[_currentStopIndex] : null;
    final nextStop = hasStops && (_currentStopIndex + 1) < stops.length ? stops[_currentStopIndex + 1] : null;

    // 현재 정류장 배정 원아 필터링
    final stopStudents = currentStop != null
        ? runList.where((s) {
            final loc = s.boardingLocation ?? s.address;
            return loc.contains(currentStop.name) || s.stopOrder == (_currentStopIndex + 1);
          }).toList()
        : <StudentModel>[];

    // 이 정류장 완료 원아 카운트
    final stopCompletedCount = stopStudents.where((s) => s.isBoarded || s.isDroppedOff || s.isAbsent).length;
    final isStopAllCompleted = stopStudents.isNotEmpty && (stopCompletedCount == stopStudents.length);

    // 다음 정류장 정보 (④ 다음 정류장 미리 보기)
    final nextStopStudents = nextStop != null
        ? runList.where((s) {
            final loc = s.boardingLocation ?? s.address;
            return loc.contains(nextStop.name) || s.stopOrder == (_currentStopIndex + 2);
          }).toList()
        : <StudentModel>[];

    final nextBoardingNames = nextStopStudents.where((s) => !s.isAbsent).map((s) => s.name).toList();
    final nextAbsentNames = nextStopStudents.where((s) => s.isAbsent).map((s) => s.name).toList();

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: const Text(
          '동승 지도교사 탑승 관리',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.qr_code, color: Color(0xFF2563EB)),
            onPressed: _showTeacherQRModal,
            tooltip: '탑승 QR 띄우기',
          ),
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFF64748B)),
            onPressed: _loadAllData,
            tooltip: '새로고침',
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
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFF2563EB)))
          : Column(
              children: [
                // ⑦ 동승 시작/동승 종료 상단 컨트롤러 바 (운행과 GPS 위치전송은 기사 앱 담당)
                Container(
                  color: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          onPressed: _isEscorting ? _handleEndEscort : _handleStartEscort,
                          icon: Icon(
                            _isEscorting ? Icons.check_circle_outline : Icons.directions_bus,
                            color: Colors.white,
                          ),
                          label: Text(
                            _isEscorting ? '동승 종료 (하차 및 안전 확인)' : '동승 시작 (통학차량 탑승)',
                            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white),
                          ),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: _isEscorting ? const Color(0xFF16A34A) : const Color(0xFF2563EB),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                            elevation: 0,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

                // ③ & ④ 정류장 안내, 다음 정류장 미리 보기 & 기사 출발 신호 카드
                if (hasStops && currentStop != null)
                  Container(
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                      boxShadow: [
                        BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 6, offset: const Offset(0, 2)),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // 정류장 이동 헤더
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.place, color: Color(0xFF2563EB), size: 18),
                                const SizedBox(width: 4),
                                Text(
                                  '현재 정류장 (${_currentStopIndex + 1}/${stops.length})',
                                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF64748B)),
                                ),
                              ],
                            ),
                            Row(
                              children: [
                                IconButton(
                                  icon: const Icon(Icons.chevron_left, size: 20),
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(),
                                  onPressed: _currentStopIndex > 0
                                      ? () => setState(() => _currentStopIndex--)
                                      : null,
                                ),
                                const SizedBox(width: 8),
                                IconButton(
                                  icon: const Icon(Icons.chevron_right, size: 20),
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(),
                                  onPressed: _currentStopIndex < stops.length - 1
                                      ? () => setState(() => _currentStopIndex++)
                                      : null,
                                ),
                              ],
                            ),
                          ],
                        ),
                        Text(
                          currentStop.name,
                          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
                        ),
                        const SizedBox(height: 6),

                        // ③ 정류장별 탑승 예정 인원 카운트 및 출발 신호 버튼
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                              decoration: BoxDecoration(
                                color: isStopAllCompleted ? const Color(0xFFDCFCE7) : const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                stopStudents.isEmpty
                                    ? '배정 원아 없음'
                                    : '탑승 예정 ${stopStudents.length}명 중 $stopCompletedCount명 완료',
                                style: TextStyle(
                                  color: isStopAllCompleted ? const Color(0xFF16A34A) : const Color(0xFFB45309),
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                            const Spacer(),
                            ElevatedButton.icon(
                              onPressed: () => _handleSendDepartSignal(currentStop, stopStudents),
                              icon: const Icon(Icons.send_rounded, size: 14, color: Colors.white),
                              label: const Text('기사님께 출발 신호', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white)),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: isStopAllCompleted ? const Color(0xFF16A34A) : const Color(0xFFF59E0B),
                                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                elevation: 0,
                              ),
                            ),
                          ],
                        ),

                        // ④ 다음 정류장 미리 보기
                        if (nextStop != null) ...[
                          const Divider(height: 18, color: Color(0xFFF1F5F9)),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFEFF6FF),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text('다음 정류장', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB))),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      nextStop.name,
                                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      '탑승 예정: ${nextBoardingNames.isEmpty ? "없음" : nextBoardingNames.join(", ")}'
                                      '${nextAbsentNames.isNotEmpty ? " / 결석: ${nextAbsentNames.join(", ")}" : ""}',
                                      style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ],
                      ],
                    ),
                  ),

                // Run selector tabs (회차 선택)
                if (availableRuns.length > 1)
                  Container(
                    color: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      child: Row(
                        children: availableRuns.map((r) {
                          final isSelected = _currentRunNumber == r;
                          return Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text('$r차 운행'),
                              selected: isSelected,
                              onSelected: (_) => setState(() => _currentRunNumber = r),
                              selectedColor: const Color(0xFF2563EB),
                              labelStyle: TextStyle(
                                color: isSelected ? Colors.white : const Color(0xFF475569),
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                    ),
                  ),

                // 명단 헤더
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  color: const Color(0xFFF8FAFC),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '탑승 명단 (${runList.where((s) => s.isBoarded || s.isDroppedOff).length}/${runList.length}명)',
                        style: const TextStyle(fontWeight: FontWeight.w800, color: Color(0xFF334155), fontSize: 14),
                      ),
                      if (_selectedStudentIds.isNotEmpty)
                        GestureDetector(
                          onTap: _showBroadcastModal,
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                            decoration: BoxDecoration(
                              color: const Color(0xFFEFF6FF),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: const Color(0xFFBFDBFE)),
                            ),
                            child: Text(
                              '선택 메시지 전송 (${_selectedStudentIds.length})',
                              style: const TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.bold, fontSize: 11),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),

                // ① 원아 목록 (탑승, 하차, 인계 실패, 전화, 긴급 버튼)
                Expanded(
                  child: runList.isEmpty
                      ? const Center(child: Text('해당 회차에 배정된 원아가 없습니다.', style: TextStyle(color: Color(0xFF94A3B8))))
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          itemCount: runList.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 10),
                          itemBuilder: (ctx, idx) {
                            final st = runList[idx];
                            final isChecked = _selectedStudentIds.contains(st.id);

                            Color cardBorderColor = const Color(0xFFE2E8F0);
                            if (st.isBoarded) cardBorderColor = const Color(0xFFBBF7D0);
                            if (st.isDroppedOff) cardBorderColor = const Color(0xFFC7D2FE);
                            if (st.isHandoverFailed) cardBorderColor = const Color(0xFFFECACA);
                            if (st.isAbsent) cardBorderColor = const Color(0xFFE2E8F0);

                            return Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(color: cardBorderColor, width: st.isHandoverFailed ? 1.5 : 1.0),
                                boxShadow: [
                                  BoxShadow(color: Colors.black.withValues(alpha: 0.02), blurRadius: 4, offset: const Offset(0, 2)),
                                ],
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      // 체크박스 (단체 메시지용)
                                      Checkbox(
                                        value: isChecked,
                                        onChanged: (v) {
                                          setState(() {
                                            if (v == true) {
                                              _selectedStudentIds.add(st.id);
                                            } else {
                                              _selectedStudentIds.remove(st.id);
                                            }
                                          });
                                        },
                                        activeColor: const Color(0xFF2563EB),
                                      ),

                                      // 원아 기본 정보
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Row(
                                              children: [
                                                Text(
                                                  st.name,
                                                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Color(0xFF1E293B)),
                                                ),
                                                const SizedBox(width: 8),
                                                // 상태 뱃지
                                                _buildStatusBadge(st),
                                              ],
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              st.boardingLocation ?? st.address,
                                              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                              maxLines: 1,
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                            if (st.parentName != null) ...[
                                              const SizedBox(height: 2),
                                              Text(
                                                '보호자: ${st.parentName} (${st.parentPhone ?? "연락처 미등록"})',
                                                style: const TextStyle(fontSize: 11, color: Color(0xFF94A3B8)),
                                              ),
                                            ],
                                          ],
                                        ),
                                      ),

                                      // ⑥ 보호자 전화 걸기 버튼
                                      IconButton(
                                        icon: const Icon(Icons.phone, color: Color(0xFF2563EB), size: 20),
                                        onPressed: () => _makePhoneCall(st.parentPhone),
                                        tooltip: '보호자에게 전화 걸기',
                                      ),

                                      // ⑥ 긴급 알림 버튼
                                      IconButton(
                                        icon: const Icon(Icons.emergency_outlined, color: Color(0xFFDC2626), size: 20),
                                        onPressed: () => _handleEmergency(st),
                                        tooltip: '원아 긴급 알림',
                                      ),

                                      // 특이사항/메모 아이콘
                                      IconButton(
                                        icon: Icon(
                                          (st.teacherMemo != null && st.teacherMemo!.isNotEmpty) || (st.parentMessage != null && st.parentMessage!.isNotEmpty)
                                              ? Icons.error_outline
                                              : Icons.edit_note,
                                          color: (st.teacherMemo != null && st.teacherMemo!.isNotEmpty) ? const Color(0xFFDC2626) : const Color(0xFF94A3B8),
                                          size: 22,
                                        ),
                                        onPressed: () => _showStudentMemoDialog(st),
                                        tooltip: '메모/특이사항',
                                      ),
                                    ],
                                  ),

                                  // 알레르기 표시
                                  if (st.allergies.isNotEmpty) ...[
                                    const SizedBox(height: 6),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFFEF2F2),
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(color: const Color(0xFFFECACA)),
                                      ),
                                      child: Text(
                                        '알레르기: ${st.allergies}',
                                        style: const TextStyle(color: Color(0xFFDC2626), fontSize: 11, fontWeight: FontWeight.bold),
                                      ),
                                    ),
                                  ],

                                  // ① 하차·인계 및 탑승 액션 버튼 바
                                  const SizedBox(height: 10),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.end,
                                    children: [
                                      if (st.isWaiting) ...[
                                        ElevatedButton(
                                          onPressed: () => _handleManualBoard(st),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: const Color(0xFF10B981),
                                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                            elevation: 0,
                                          ),
                                          child: const Text('탑승', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
                                        ),
                                        const SizedBox(width: 6),
                                        OutlinedButton(
                                          onPressed: () => _handleSkipStudent(st),
                                          style: OutlinedButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                            side: const BorderSide(color: Color(0xFFCBD5E1)),
                                          ),
                                          child: const Text('결석', style: TextStyle(color: Color(0xFF64748B), fontSize: 13)),
                                        ),
                                      ] else if (st.isBoarded || st.isHandoverFailed) ...[
                                        // 하차 및 인계 완료 버튼
                                        ElevatedButton.icon(
                                          onPressed: () => _handleDropoffStudent(st),
                                          icon: const Icon(Icons.check, size: 16, color: Colors.white),
                                          label: const Text('하차 · 보호자 인계', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                                          style: ElevatedButton.styleFrom(
                                            backgroundColor: const Color(0xFF16A34A),
                                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                            elevation: 0,
                                          ),
                                        ),
                                        const SizedBox(width: 6),
                                        // 보호자 부재 시 인계 실패 버튼
                                        OutlinedButton.icon(
                                          onPressed: () => _handleHandoverFailed(st),
                                          icon: const Icon(Icons.close, size: 14, color: Color(0xFFDC2626)),
                                          label: const Text('인계 실패(재탑승)', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold, fontSize: 12)),
                                          style: ElevatedButton.styleFrom(
                                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                            side: const BorderSide(color: Color(0xFFFCA5A5)),
                                            backgroundColor: const Color(0xFFFEF2F2),
                                          ),
                                        ),
                                      ] else if (st.isDroppedOff) ...[
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFF0FDF4),
                                            borderRadius: BorderRadius.circular(6),
                                            border: Border.all(color: const Color(0xFF86EFAC)),
                                          ),
                                          child: const Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: [
                                              Icon(Icons.check_circle, size: 14, color: Color(0xFF16A34A)),
                                              SizedBox(width: 4),
                                              Text('보호자 인계 완료', style: TextStyle(color: Color(0xFF16A34A), fontWeight: FontWeight.bold, fontSize: 12)),
                                            ],
                                          ),
                                        ),
                                      ] else if (st.isAbsent) ...[
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFF1F5F9),
                                            borderRadius: BorderRadius.circular(6),
                                          ),
                                          child: const Text('결석 (미탑승)', style: TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.bold, fontSize: 12)),
                                        ),
                                      ],
                                    ],
                                  ),
                                ],
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
    );
  }

  /// 상태 뱃지 빌더
  Widget _buildStatusBadge(StudentModel st) {
    if (st.isHandoverFailed) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFFEE2E2),
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: const Color(0xFFFCA5A5)),
        ),
        child: const Text('인계실패(차량보호)', style: TextStyle(color: Color(0xFFDC2626), fontWeight: FontWeight.bold, fontSize: 11)),
      );
    }
    if (st.isDroppedOff) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFEEF2FF),
          borderRadius: BorderRadius.circular(6),
        ),
        child: const Text('인계완료', style: TextStyle(color: Color(0xFF4F46E5), fontWeight: FontWeight.bold, fontSize: 11)),
      );
    }
    if (st.isBoarded) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFDCFCE7),
          borderRadius: BorderRadius.circular(6),
        ),
        child: const Text('탑승 중', style: TextStyle(color: Color(0xFF15803D), fontWeight: FontWeight.bold, fontSize: 11)),
      );
    }
    if (st.isAbsent) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(6),
        ),
        child: const Text('결석', style: TextStyle(color: Color(0xFF64748B), fontWeight: FontWeight.bold, fontSize: 11)),
      );
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFEFF6FF),
        borderRadius: BorderRadius.circular(6),
      ),
      child: const Text('탑승 대기', style: TextStyle(color: Color(0xFF2563EB), fontWeight: FontWeight.bold, fontSize: 11)),
    );
  }
}
