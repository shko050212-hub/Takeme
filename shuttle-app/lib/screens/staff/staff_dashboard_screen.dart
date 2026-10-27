import 'package:flutter/material.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../services/api_service.dart';
import '../../services/socket_service.dart';
import '../../services/location_service.dart';
import '../../models/student_model.dart';
import '../../models/route_model.dart';
import '../../widgets/kakao_map_view.dart';
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
  bool _isOperating = false;
  int _currentRunNumber = 1;

  double? _myLat;
  double? _myLng;

  final FlutterTts _flutterTts = FlutterTts();
  final Set<int> _selectedStudentIds = {};
  final _broadcastMessageController = TextEditingController();
  final _memoController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _initTts();
    _loadAllData();
  }

  @override
  void dispose() {
    _broadcastMessageController.dispose();
    _memoController.dispose();
    _flutterTts.stop();
    LocationService().stopLocationTracking();
    super.dispose();
  }

  void _initTts() async {
    await _flutterTts.setLanguage('ko-KR');
    await _flutterTts.setSpeechRate(0.5);
  }

  Future<void> _loadAllData() async {
    setState(() => _isLoading = true);
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
      });

      final vid = vehicle?['id'];
      if (vid != null) {
        final vehicleId = int.tryParse(vid.toString()) ?? 0;
        SocketService().joinVehicleRoom(vehicleId);
      }
    }
  }

  void _toggleOperation() {
    final vehicleId = _vehicleInfo?['id'];
    if (vehicleId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('배정된 차량 정보를 찾을 수 없습니다.'), backgroundColor: Colors.red),
      );
      return;
    }

    final vId = int.tryParse(vehicleId.toString()) ?? 0;

    setState(() {
      _isOperating = !_isOperating;
    });

    if (_isOperating) {
      LocationService().startLocationTracking((pos) {
        if (!mounted) return;
        setState(() {
          _myLat = pos.latitude;
          _myLng = pos.longitude;
        });
        SocketService().sendLocationUpdate(
          vehicleId: vId,
          lat: pos.latitude,
          lng: pos.longitude,
        );
      });
      _flutterTts.speak('운행을 시작합니다. 안전 운전하세요.');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('운행이 시작되었습니다. 실시간 위치가 전송됩니다.'), backgroundColor: Color(0xFF10B981)),
      );
    } else {
      LocationService().stopLocationTracking();
      _flutterTts.speak('운행을 종료합니다.');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('운행이 종료되었습니다.'), backgroundColor: Color(0xFF64748B)),
      );
    }
  }

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
                _loadAllData();
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

  void _handleSkipStudent(StudentModel student) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('${student.name} 원아 미탑승(결석) 처리', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: const Text('해당 원아를 오늘 미탑승 처리하고 다음 목적지로 안내를 계속하시겠습니까?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              final user = ApiService().currentUser;
              if (user == null) return;
              final res = await ApiService().skipStudent(user.email, student.id);
              if (res['success'] == true) {
                _loadAllData();
                _flutterTts.speak('${student.name} 원아 미탑승 처리 완료.');
              }
            },
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFDC2626)),
            child: const Text('결석 처리', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
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
              '교사: ${user.name} (${user.email})',
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
                _loadAllData();
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
                '단체 메시지 전송',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 4),
              Text(
                '선택된 원아 ${_selectedStudentIds.length}명에게 메시지를 전송합니다.',
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
    final user = ApiService().currentUser;
    final isDriver = user?.role == 'DRIVER';

    final runList = _students.where((s) => s.runNumber == _currentRunNumber).toList();
    final availableRuns = _students.map((s) => s.runNumber).toSet().toList()..sort();

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Text(
          isDriver ? '기사님 운행 대시보드' : '지도교사 대시보드',
          style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          if (!isDriver)
            IconButton(
              icon: const Icon(Icons.qr_code, color: Color(0xFF2563EB)),
              onPressed: _showTeacherQRModal,
              tooltip: '탑승 QR 띄우기',
            ),
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
                // Top Driving Controller (Driver only)
                if (isDriver)
                  Container(
                    color: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                    child: Row(
                      children: [
                        Expanded(
                          child: ElevatedButton.icon(
                            onPressed: _toggleOperation,
                            icon: Icon(_isOperating ? Icons.stop_circle_outlined : Icons.play_circle_outline, color: Colors.white),
                            label: Text(
                              _isOperating ? '운행 종료 (위치 끄기)' : '운행 시작 (위치 켜기)',
                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white),
                            ),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: _isOperating ? const Color(0xFFDC2626) : const Color(0xFF2563EB),
                              padding: const EdgeInsets.symmetric(vertical: 14),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                              elevation: 0,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                // Map View (Driver gets persistent map, Teacher gets expandable)
                if (isDriver)
                  Container(
                    height: 220,
                    margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: KakaoMapView(
                      stops: _routeData?.stops ?? [],
                      routePoints: _routeData?.routePoints ?? [],
                      busLat: _myLat,
                      busLng: _myLng,
                      academyLat: _routeData?.academyLat,
                      academyLng: _routeData?.academyLng,
                      academyName: _routeData?.academyName,
                    ),
                  ),

                // Run selector tabs
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

                // Passenger count header
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                  color: const Color(0xFFF8FAFC),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '탑승 명단 (${runList.where((s) => s.boarded).length}/${runList.length}명)',
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

                // Passenger List
                Expanded(
                  child: runList.isEmpty
                      ? const Center(child: Text('해당 회차에 배정된 원아가 없습니다.', style: TextStyle(color: Color(0xFF94A3B8))))
                      : ListView.separated(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          itemCount: runList.length,
                          separatorBuilder: (context, index) => const SizedBox(height: 8),
                          itemBuilder: (ctx, idx) {
                            final st = runList[idx];
                            final isChecked = _selectedStudentIds.contains(st.id);

                            return Container(
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: Colors.white,
                                borderRadius: BorderRadius.circular(14),
                                border: Border.all(
                                  color: st.boarded ? const Color(0xFFBBF7D0) : (st.absent ? const Color(0xFFFECACA) : const Color(0xFFE2E8F0)),
                                ),
                              ),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.center,
                                children: [
                                  // Selection checkbox
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

                                  // Student Details
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Text(
                                              st.name,
                                              style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Color(0xFF1E293B)),
                                            ),
                                            if (st.allergies.isNotEmpty) ...[
                                              const SizedBox(width: 6),
                                              Container(
                                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                                decoration: BoxDecoration(
                                                  color: const Color(0xFFFEF2F2),
                                                  borderRadius: BorderRadius.circular(4),
                                                  border: Border.all(color: const Color(0xFFFECACA)),
                                                ),
                                                child: Text(
                                                  '알레르기: ${st.allergies}',
                                                  style: const TextStyle(
                                                    color: Color(0xFFDC2626),
                                                    fontSize: 10,
                                                    fontWeight: FontWeight.bold,
                                                  ),
                                                ),
                                              ),
                                            ],
                                          ],
                                        ),
                                        const SizedBox(height: 3),
                                        Text(
                                          st.boardingLocation ?? st.address,
                                          style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),

                                  // Memo / Alert Icon
                                  IconButton(
                                    icon: Icon(
                                      (st.teacherMemo != null && st.teacherMemo!.isNotEmpty) || (st.parentMessage != null && st.parentMessage!.isNotEmpty)
                                          ? Icons.error_outline
                                          : Icons.edit_note,
                                      color: (st.teacherMemo != null && st.teacherMemo!.isNotEmpty) ? const Color(0xFFDC2626) : const Color(0xFF94A3B8),
                                    ),
                                    onPressed: () => _showStudentMemoDialog(st),
                                  ),

                                  // Boarding Action Buttons
                                  if (!st.boarded && !st.absent) ...[
                                    ElevatedButton(
                                      onPressed: () => _handleManualBoard(st),
                                      style: ElevatedButton.styleFrom(
                                        backgroundColor: const Color(0xFF10B981),
                                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                        elevation: 0,
                                      ),
                                      child: const Text('탑승', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                                    ),
                                    const SizedBox(width: 4),
                                    OutlinedButton(
                                      onPressed: () => _handleSkipStudent(st),
                                      style: OutlinedButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                        side: const BorderSide(color: Color(0xFFCBD5E1)),
                                      ),
                                      child: const Text('결석', style: TextStyle(color: Color(0xFF64748B), fontSize: 12)),
                                    ),
                                  ] else if (st.boarded)
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFDCFCE7),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: const Text('탑승완료', style: TextStyle(color: Color(0xFF15803D), fontWeight: FontWeight.bold, fontSize: 11)),
                                    )
                                  else if (st.absent)
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFFFEE2E2),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: const Text('미탑승', style: TextStyle(color: Color(0xFFB91C1C), fontWeight: FontWeight.bold, fontSize: 11)),
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
}
