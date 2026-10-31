import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../driver/driver_navigator.dart';
import '../../driver/geo.dart';
import '../../widgets/nav_map_view.dart';
import '../settings_screen.dart';
import 'operation_log_screen.dart';

/// 기사 전용 화면 (팀 앱과 같은 크기·글꼴)
/// - 1단계(운행 준비): 전체 지도 + 하단 준비 패널('경로 탐색' 버튼)
/// - 2단계(경로 탐색·선택): 전체 경로 축소 보기 + 안전 경로/빠른 경로 비교 카드 + '운행 시작' 버튼
/// - 3단계(운행 중): 티맵 스타일 주행 화면
///   · 시속 5km 이상 주행 중 조작 잠금 & 화면 켜짐 유지
///   · 지도교사 "출발하셔도 됩니다" 신호 수신 배너·음성
///   · 정차 지점 메모 음성·화면 안내
///   · 현재 속도 크게 표시 & 어린이 보호구역(30km/h) 경고 + 급정거·과속 자동 일지 기록
///   · 길게 눌러 작동하는 SOS 긴급 버튼
///   · 운행 종료 시 "차량 내부 확인 완료" 체크 필수
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _C {
  static const blue = Color(0xFF2563EB);
  static const blueDark = Color(0xFF1D4ED8);
  static const blueBg = Color(0xFFEFF6FF);
  static const green = Color(0xFF059669);
  static const red = Color(0xFFDC2626);
  static const orange = Color(0xFFEA580C);
  static const orangeBg = Color(0xFFFFF7ED);
  static const sky = Color(0xFF0EA5E9);
  static const slate800 = Color(0xFF1E293B);
  static const slate600 = Color(0xFF475569);
  static const slate500 = Color(0xFF64748B);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate100 = Color(0xFFF1F5F9);
}

class _DriverHomeScreenState extends State<DriverHomeScreen> with WidgetsBindingObserver {
  late final NavMapController _map;
  late final DriverNavigator _nav;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _map = NavMapController();
    _nav = DriverNavigator(_map)..init();
    _ticker = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted && _nav.driving) setState(() {});
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _nav.refreshOverlayPermission();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ticker?.cancel();
    _nav.dispose();
    super.dispose();
  }

  void _openLogs() {
    if (_nav.isMovingFast) {
      _nav.warnLockedWhileMoving();
      _showLockedToast();
      return;
    }
    Navigator.push(context, MaterialPageRoute(builder: (_) => const OperationLogScreen()));
  }

  void _showLockedToast() {
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('🔒 주행 중(시속 5km 이상)에는 안전을 위해 조작이 잠깁니다. 정차 후 이용해 주세요.'),
        backgroundColor: _C.slate800,
        duration: Duration(seconds: 2),
      ),
    );
  }

  /// 운행 종료 확인 창 — 법적 의무인 "차량 내부 확인 완료" 체크 한 번을 거쳐야 종료 가능
  Future<void> _confirmStop() async {
    bool interiorChecked = false;
    final ok = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          title: Row(
            children: [
              const Icon(Icons.directions_bus_filled, color: _C.blue, size: 22),
              const SizedBox(width: 8),
              Text(
                _nav.testMode ? '테스트 주행 종료' : '운행 종료 및 차량 내부 확인',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _nav.testMode
                    ? '테스트 주행을 종료하기 전 차량 내부 확인 절차를 점검합니다.'
                    : '운행을 마친 뒤 차 안에 남은 아이가 없는지 확인하는 것은 운전자의 필수 안전 의무입니다.',
                style: const TextStyle(fontSize: 13.5, color: _C.slate600, height: 1.4),
              ),
              const SizedBox(height: 14),
              InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => setModalState(() => interiorChecked = !interiorChecked),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  decoration: BoxDecoration(
                    color: interiorChecked ? _C.blueBg : _C.slate100,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: interiorChecked ? _C.blue : _C.slate300,
                      width: interiorChecked ? 2 : 1,
                    ),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        interiorChecked ? Icons.check_box : Icons.check_box_outline_blank,
                        color: interiorChecked ? _C.blue : _C.slate500,
                        size: 24,
                      ),
                      const SizedBox(width: 10),
                      const Expanded(
                        child: Text(
                          '차량 내부 확인 완료\n(남아있는 원아가 없음을 확인했습니다)',
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w800,
                            color: _C.slate800,
                            height: 1.3,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('계속 주행', style: TextStyle(color: _C.slate600, fontWeight: FontWeight.w700)),
            ),
            ElevatedButton(
              onPressed: interiorChecked ? () => Navigator.pop(ctx, true) : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: _C.red,
                disabledBackgroundColor: _C.slate300,
                foregroundColor: Colors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
              child: Text(
                _nav.testMode ? '테스트 종료' : '운행 종료',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
            ),
          ],
        ),
      ),
    );
    if (ok == true) await _nav.stop(interiorChecked: true);
  }

  /// 긴급 버튼 (길게 눌렀을 때 작동): 원장님 및 타 차량에 위치와 함께 사고·고장 긴급 알림 발송
  Future<void> _onEmergencyLongPress() async {
    HapticFeedback.heavyImpact();
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Row(
          children: [
            Icon(Icons.emergency_share, color: _C.red, size: 24),
            SizedBox(width: 8),
            Text('긴급 사고·고장 알림 발송', style: TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: _C.red)),
          ],
        ),
        content: const Text(
          '현재 차량 위치와 함께 원장님 및 다른 호차에 긴급 사고·고장 알림을 즉시 전송할까요?',
          style: TextStyle(fontSize: 14, color: _C.slate800, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('취소', style: TextStyle(color: _C.slate600, fontWeight: FontWeight.w700)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: _C.red,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: const Text('긴급 알림 전송', style: TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
    if (confirm == true) {
      final ok = await _nav.triggerEmergency();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ok ? '🚨 원장님과 타 호차에 긴급 사고·고장 알림을 전송했습니다.' : '긴급 알림 전송에 실패했습니다.'),
          backgroundColor: ok ? _C.red : _C.slate800,
        ),
      );
    }
  }

  void _onEmergencyShortTap() {
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('실수로 눌리지 않도록 SOS 긴급 버튼은 길게(1.5초) 눌러주세요.'),
        backgroundColor: _C.slate800,
        duration: Duration(seconds: 2),
      ),
    );
  }

  Future<void> _confirmSendToServer() async {
    if (_nav.simSendToServer) {
      setState(() => _nav.simSendToServer = false);
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('시뮬레이션 위치를 서버로 보낼까요?', style: TextStyle(fontSize: 16)),
        content: const Text('학부모 앱·관리자 웹에서 버스가 움직이는 것처럼 보이고, '
            '정류장 도착 알림이 실제 학부모에게 갈 수 있습니다. 테스트 계정으로만 사용하세요.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('보내기')),
        ],
      ),
    );
    if (ok == true) setState(() => _nav.simSendToServer = true);
  }

  Future<void> _onMenu(String v) async {
    if (_nav.isMovingFast && v != 'sim') {
      _nav.warnLockedWhileMoving();
      _showLockedToast();
      return;
    }
    switch (v) {
      case 'refresh':
        await _nav.refreshRouteFromServer(speak: true);
      case 'log':
        _openLogs();
      case 'test':
        await _nav.startTestDrive();
      case 'sim':
        if (_nav.simulating) {
          _nav.stopSimulation();
        } else {
          _nav.startSimulation();
        }
      case 'offroute':
        _nav.simulateOffRoute();
      case 'switch':
        await _nav.selectMode(_nav.mode.other);
      case 'send':
        await _confirmSendToServer();
      case 'overlay_perm':
        await _nav.openOverlaySettings();
      case 'settings':
        if (mounted) Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _nav,
      builder: (context, _) => PopScope(
        canPop: !_nav.driving && !_nav.routePreviewing,
        onPopInvokedWithResult: (didPop, _) {
          if (didPop) return;
          if (_nav.driving) {
            _confirmStop();
          } else if (_nav.routePreviewing) {
            _nav.closeRoutePreview();
          }
        },
        child: Scaffold(
          backgroundColor: const Color(0xFFF8FAFC),
          appBar: _nav.driving
              ? null
              : AppBar(
                  leading: _nav.routePreviewing
                      ? IconButton(
                          icon: const Icon(Icons.arrow_back, color: _C.slate800),
                          tooltip: '이전 화면',
                          onPressed: _nav.closeRoutePreview,
                        )
                      : null,
                  title: Text(
                    _nav.testMode
                        ? '테스트 주행 (실제 운행 아님)'
                        : (_nav.routePreviewing
                            ? '경로 탐색 · 선택'
                            : (_nav.vehicleName.isEmpty ? '기사님 운행 대시보드' : '${_nav.vehicleName} 운행 준비')),
                    style: TextStyle(color: _nav.testMode ? _C.orange : _C.slate800),
                  ),
                  actions: [_menu()],
                  bottom: PreferredSize(
                    preferredSize: const Size.fromHeight(1),
                    child: Container(color: _C.slate100, height: 1),
                  ),
                ),
          body: SafeArea(
            top: _nav.driving,
            child: _nav.loading
                ? const Center(child: CircularProgressIndicator(color: _C.blue))
                : _mainBody(),
          ),
        ),
      ),
    );
  }

  Widget _mainBody() {
    return Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              Positioned.fill(child: NavMapView(controller: _map)),
              if (_nav.driving) ...[
                // 좌측 상단: 티맵 스타일 파란색+하얀색 회전 안내 표지판
                Positioned(left: 0, top: 0, child: _turnHeader()),
                // 좌측 중단(표지판 아래): 티맵 스타일 제한속도 원형 표지판 + 현재 속도(km/h) 크게 표시
                Positioned(left: 12, top: 146, child: _speedAndSafetyCluster()),
                // 우측 상단: 길게 눌러 작동하는 SOS 긴급 버튼
                Positioned(right: 12, top: 12, child: _sosLongPressButton()),
              ],
              // 지도교사 "출발하셔도 됩니다" 실시간 신호 배너
              if (_nav.driving && _nav.departSignalBanner != null)
                Positioned(
                  left: 14,
                  right: 14,
                  top: 120,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    decoration: BoxDecoration(
                      color: _C.green,
                      borderRadius: BorderRadius.circular(14),
                      boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 10, offset: Offset(0, 3))],
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle, color: Colors.white, size: 26),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _nav.departSignalBanner!,
                            style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w900),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              // 다른 앱 위에 표시 권한 미허용 시 원탭 안내 배너
              if (_nav.driving && !_nav.overlayPermissionGranted && _nav.departSignalBanner == null)
                Positioned(
                  left: 12,
                  right: 12,
                  top: 112,
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: _nav.openOverlaySettings,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        decoration: BoxDecoration(
                          color: const Color(0xEB1E293B),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Row(
                          children: [
                            Icon(Icons.picture_in_picture_alt, color: Colors.white, size: 18),
                            SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                '백그라운드 길 안내를 위해 "다른 앱 위에 표시" 권한을 켜주세요 (터치)',
                                style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
                              ),
                            ),
                            Icon(Icons.chevron_right, color: Colors.white, size: 18),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              if (_nav.driving) ...[
                // 티맵 스타일: 하단 바 바로 위 좌·우 원형 버튼
                Positioned(
                  left: 14,
                  bottom: 16,
                  child: _mapButton(Icons.alt_route, '전체 경로 보기', () => _nav.setFollow(false)),
                ),
                Positioned(
                  right: 14,
                  bottom: 16,
                  child: _mapButton(
                    Icons.navigation,
                    '내 위치로 (12시 방향 정렬)',
                    _nav.position == null ? null : _nav.centerOnMe,
                    iconColor: _C.blue,
                  ),
                ),
              ] else
                _mapButtons(top: 16),
              if (_nav.simulating)
                Positioned(
                  left: 14,
                  bottom: 76,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(color: _C.slate800, borderRadius: BorderRadius.circular(20)),
                    child: const Text('시뮬레이션 주행 중',
                        style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
                  ),
                ),
            ],
          ),
        ),
        if (_nav.driving)
          _bottomBar()
        else if (_nav.routePreviewing)
          _routeSelectPanel()
        else
          _readyPanel(),
      ],
    );
  }

  /// 티맵 스타일 좌측 속도계 + 어린이 보호구역 경고 표지판
  Widget _speedAndSafetyCluster() {
    final limit = _nav.speedLimitKmh;
    final over = _nav.isOverspeeding;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.center,
      mainAxisSize: MainAxisSize.min,
      children: [
        // 제한속도 표지판 (어린이 보호구역 시 30 + 노란/빨간 강조)
        Container(
          width: 58,
          height: 58,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: over ? _C.red : Colors.white,
            border: Border.all(color: _C.red, width: 6),
            boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 6, offset: Offset(0, 2))],
          ),
          alignment: Alignment.center,
          child: Text(
            '$limit',
            style: TextStyle(
              fontSize: 23,
              fontWeight: FontWeight.w900,
              color: over ? Colors.white : _C.slate800,
              height: 1.0,
            ),
          ),
        ),
        if (_nav.inSchoolZone)
          Container(
            margin: const EdgeInsets.only(top: 4),
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              color: over ? _C.red : const Color(0xFFF59E0B),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Text(
              '보호구역',
              style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w900),
            ),
          ),
        const SizedBox(height: 4),
        // 현재 속도 크게 표시 (티맵 스타일)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: const Color(0xD9FFFFFF),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            '${_nav.speedKmh}',
            style: TextStyle(
              fontSize: 32,
              fontWeight: FontWeight.w900,
              color: over ? _C.red : _C.slate800,
              height: 1.05,
            ),
          ),
        ),
      ],
    );
  }

  /// 사고·고장 시 길게 눌러야 작동하는 SOS 긴급 버튼 (실수 클릭 방지)
  Widget _sosLongPressButton() {
    return Tooltip(
      message: '사고·고장 시 길게(1.5초) 눌러 원장님께 알림',
      child: GestureDetector(
        onTap: _onEmergencyShortTap,
        onLongPress: _nav.emergencySending ? null : _onEmergencyLongPress,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
          decoration: BoxDecoration(
            color: _C.red,
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: const [BoxShadow(color: Color(0x40000000), blurRadius: 8, offset: Offset(0, 2))],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.sos, color: Colors.white, size: 20),
              const SizedBox(width: 4),
              Text(
                _nav.emergencySending ? '전송중' : '긴급(길게)',
                style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w900),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _menu() {
    final items = <PopupMenuEntry<String>>[
      _menuItem('refresh', Icons.refresh, '노선·탑승지 새로고침'),
    ];
    if (!_nav.driving) {
      items.add(_menuItem('log', Icons.calendar_month, '운행 일지'));
      items.add(_menuItem('test', Icons.science_outlined, '테스트 경로로 연습하기'));
    } else {
      items.add(_menuItem('sim', _nav.simulating ? Icons.pause : Icons.play_arrow,
          _nav.simulating ? '시뮬레이션 멈추기' : '주행 시뮬레이션 시작'));
      if (_nav.simulating) items.add(_menuItem('offroute', Icons.alt_route, '경로 이탈 테스트'));
      items.add(_menuItem('switch', Icons.swap_horiz, '${_nav.mode.other.title}로 바꾸기'));
      if (_nav.serverLive) {
        items.add(_menuItem('send', _nav.simSendToServer ? Icons.check_box : Icons.check_box_outline_blank,
            '시뮬레이션 위치를 서버로 보내기'));
      }
    }
    if (!_nav.overlayPermissionGranted) {
      items.add(_menuItem('overlay_perm', Icons.picture_in_picture_alt, '다른 앱 위에 표시 권한 설정'));
    }
    items.add(_menuItem('settings', Icons.settings_outlined, '설정'));
    return PopupMenuButton<String>(
      tooltip: '메뉴',
      icon: const Icon(Icons.more_vert, color: _C.slate600),
      onSelected: _onMenu,
      itemBuilder: (_) => items,
    );
  }

  PopupMenuItem<String> _menuItem(String v, IconData icon, String text) => PopupMenuItem(
        value: v,
        child: Row(children: [
          Icon(icon, color: _C.slate600, size: 20),
          const SizedBox(width: 10),
          Flexible(child: Text(text)),
        ]),
      );

  // ───────────────────────── 1단계: 운행 준비 (경로 탐색 전) ─────────────────────────

  Widget _readyPanel() {
    final disabled = _nav.busy || _nav.vehicleId == null;
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 12, offset: Offset(0, -2))],
      ),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 18),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _summaryRow(),
          if (_nav.actionError != null) ...[
            const SizedBox(height: 8),
            Text(_nav.actionError!, style: const TextStyle(color: _C.red, fontSize: 13)),
          ],
          if (_nav.setupNotice != null) ...[
            const SizedBox(height: 10),
            _notice(_nav.setupNotice!, Icons.info_outline, _C.orange, _C.orangeBg),
          ],
          if (_nav.gpsError != null) ...[
            const SizedBox(height: 8),
            _notice('${_nav.gpsError} · 유치원 위치에서 출발하는 경로로 계산합니다.', Icons.gps_off, _C.red,
                const Color(0xFFFEF2F2)),
          ],
          const SizedBox(height: 14),
          ElevatedButton.icon(
            onPressed: disabled ? null : _nav.openRoutePreview,
            icon: _nav.busy
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : const Icon(Icons.alt_route, color: Colors.white),
            label: const Text('경로 탐색',
                style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Colors.white)),
            style: ElevatedButton.styleFrom(
              backgroundColor: _C.blue,
              disabledBackgroundColor: _C.slate300,
              padding: const EdgeInsets.symmetric(vertical: 15),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              elevation: 0,
            ),
          ),
        ],
      ),
    );
  }

  // ───────────────────────── 2단계: 경로 탐색 및 선택 화면 ─────────────────────────

  Widget _routeSelectPanel() {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
        boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 12, offset: Offset(0, -2))],
      ),
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.map_outlined, size: 18, color: _C.blue),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '경로 선택 · 정류장 ${_nav.stops.length}곳 경유',
                  style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: _C.slate800),
                ),
              ),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: () => _nav.refreshRouteFromServer(speak: true),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: _C.slate100,
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _C.slate200),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.refresh, size: 15, color: _C.blue),
                      SizedBox(width: 4),
                      Text('새로고침',
                          style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _C.blue)),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _routeSignboardCard(RouteMode.safe, Icons.shield_outlined)),
              const SizedBox(width: 10),
              Expanded(child: _routeSignboardCard(RouteMode.fast, Icons.bolt)),
            ],
          ),
          if (_nav.actionError != null) ...[
            const SizedBox(height: 8),
            Text(_nav.actionError!, style: const TextStyle(color: _C.red, fontSize: 13)),
          ],
          const SizedBox(height: 12),
          _startButton(),
        ],
      ),
    );
  }

  Widget _routeSignboardCard(RouteMode m, IconData modeIcon) {
    final slot = _nav.slots[m]!;
    final selected = _nav.mode == m;
    final plan = slot.plan;

    Widget body;
    switch (slot.status) {
      case PlanStatus.loading:
        body = const Padding(
          padding: EdgeInsets.symmetric(vertical: 14),
          child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))),
        );
      case PlanStatus.error:
        body = Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: TextButton.icon(
            onPressed: _nav.previewRoutes,
            icon: const Icon(Icons.refresh, color: _C.red, size: 16),
            label: const Text('다시 탐색', style: TextStyle(color: _C.red, fontSize: 12)),
          ),
        );
      case PlanStatus.ready:
        body = Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Text(
                  plan!.minutesText,
                  style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                    color: selected ? _C.blue : _C.slate800,
                  ),
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    plan.kmText,
                    style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: _C.slate600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              plan.etaClockText,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: selected ? _C.blue : _C.slate600,
              ),
            ),
          ],
        );
      case PlanStatus.idle:
        body = const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Text('경로 준비 중...', style: TextStyle(fontSize: 12, color: _C.slate500)),
        );
    }

    return Semantics(
      button: true,
      selected: selected,
      label: '${m.title}, ${plan != null ? '${plan.minutesText}, ${plan.kmText}, ${plan.etaClockText}' : ''}',
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _nav.selectMode(m),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: selected ? _C.blueBg : Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? _C.blue : _C.slate200, width: selected ? 2.2 : 1),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(modeIcon, size: 16, color: selected ? _C.blue : _C.slate600),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      m == RouteMode.safe ? '안전 경로 (추천)' : '빠른 경로',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: selected ? _C.blue : _C.slate800,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Icon(
                    selected ? Icons.check_circle : Icons.radio_button_unchecked,
                    color: selected ? _C.blue : _C.slate300,
                    size: 18,
                  ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                m.criteria,
                style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: _C.slate500),
              ),
              const SizedBox(height: 6),
              body,
            ],
          ),
        ),
      ),
    );
  }

  Widget _summaryRow() {
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _nav.vehicleName.isEmpty ? '배정 차량 없음' : '오늘 차량 ${_nav.vehicleName}',
                style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: _C.slate800),
              ),
              const SizedBox(height: 2),
              Row(
                children: [
                  Text('정류장 ${_nav.stops.length}곳',
                      style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _C.blue)),
                  const SizedBox(width: 6),
                  InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => _nav.refreshRouteFromServer(speak: true),
                    child: const Padding(
                      padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.refresh, size: 15, color: _C.blue),
                          SizedBox(width: 2),
                          Text('새로고침', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _C.blue)),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        ElevatedButton.icon(
          onPressed: _openLogs,
          icon: const Icon(Icons.calendar_today, size: 18, color: Colors.white),
          label: const Text('운행 일지', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: Colors.white)),
          style: ElevatedButton.styleFrom(
            backgroundColor: _C.sky,
            minimumSize: const Size(0, 44),
            padding: const EdgeInsets.symmetric(horizontal: 14),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            elevation: 0,
          ),
        ),
      ],
    );
  }

  Widget _notice(String text, IconData icon, Color color, Color bg) {
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 18),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(color: color, fontSize: 13, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }

  Widget _startButton() {
    final disabled = _nav.busy || _nav.vehicleId == null;
    return ElevatedButton.icon(
      onPressed: disabled ? null : _nav.start,
      icon: _nav.busy
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
          : const Icon(Icons.navigation, color: Colors.white),
      label: Text('${_nav.mode.title}로 운행 시작',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: Colors.white)),
      style: ElevatedButton.styleFrom(
        backgroundColor: _C.blue,
        disabledBackgroundColor: _C.slate300,
        padding: const EdgeInsets.symmetric(vertical: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        elevation: 0,
      ),
    );
  }

  // ───────────────────────── 3단계: 운행 중 (내비게이션 안내) ─────────────────────────

  IconData _turnIcon(String text) {
    if (text.contains('유턴') || text.contains('U턴')) return Icons.u_turn_left;
    if (text.contains('좌회전')) return Icons.turn_left;
    if (text.contains('우회전')) return Icons.turn_right;
    if (text.contains('왼쪽')) return Icons.turn_slight_left;
    if (text.contains('오른쪽')) return Icons.turn_slight_right;
    if (text.contains('목적지') || text.contains('경유지')) return Icons.flag;
    return Icons.straight;
  }

  /// 티맵 크기·레이아웃의 파란색+하얀색 회전 안내 표지판 + 두 번째 회전 보조 안내
  Widget _turnHeader() {
    final turn = _nav.nextTurn;
    final second = _nav.secondTurn;
    final mainBg = _nav.testMode ? _C.orange : _C.blue;
    const subBg = _C.blueDark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          constraints: const BoxConstraints(minWidth: 200, maxWidth: 255),
          padding: const EdgeInsets.fromLTRB(14, 12, 18, 12),
          decoration: BoxDecoration(
            color: mainBg,
            borderRadius: const BorderRadius.only(
              bottomRight: Radius.circular(12),
            ),
            boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8, offset: Offset(0, 2))],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _nav.rerouting
                  ? const SizedBox(
                      width: 44,
                      height: 44,
                      child: Padding(
                        padding: EdgeInsets.all(8),
                        child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3),
                      ),
                    )
                  : Icon(
                      turn == null ? Icons.straight : _turnIcon(turn.$2),
                      color: Colors.white,
                      size: 46,
                    ),
              const SizedBox(width: 12),
              Flexible(
                child: _nav.rerouting
                    ? const Text(
                        '경로 재탐색 중...',
                        style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            turn == null ? '직진' : formatDistance(turn.$1),
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 32,
                              height: 1.05,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            turn == null ? '경로를 따라 주행' : turn.$2,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
              ),
            ],
          ),
        ),
        if (!_nav.rerouting && second != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: const BoxDecoration(
              color: subBg,
              borderRadius: BorderRadius.only(
                bottomRight: Radius.circular(12),
              ),
              boxShadow: [BoxShadow(color: Color(0x26000000), blurRadius: 4, offset: Offset(0, 2))],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(_turnIcon(second.$2), color: Colors.white, size: 22),
                const SizedBox(width: 6),
                Text(
                  formatDistance(second.$1),
                  style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w800),
                ),
              ],
            ),
          ),
      ],
    );
  }

  /// 티맵 스타일 하단 바: [ ↻ 새로고침 ]   [ 정차위치 안내 / 도착예정시각  남은km ]   [ ☰ 메뉴 ]
  Widget _bottomBar() {
    final a = _nav.active;
    final currentMode = a?.mode ?? _nav.mode;
    final next = _nav.nextStop;
    final (ampm, clock) = _nav.etaAmPmAndTime;
    final subtitle = next != null
        ? '다음: ${next.name} (${next.stopMemo})'
        : '유치원 이동 중 · ${currentMode.title}';

    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 12, offset: Offset(0, -2))],
      ),
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
      child: Row(
        children: [
          // 왼쪽: 새로고침 아이콘 버튼 (티맵 ↻ 위치)
          IconButton(
            tooltip: '경로 새로고침',
            onPressed: _nav.rerouting ? null : () => _nav.refreshRouteFromServer(speak: true),
            icon: const Icon(Icons.refresh, size: 28, color: _C.slate800),
          ),
          // 가운데: 상단 정차지점 안내줄 + 하단 도착예정시각 & 남은 km
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      _nav.isMovingFast ? Icons.lock_outline : Icons.place_outlined,
                      size: 14,
                      color: _C.blue,
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _C.slate600),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      ampm,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: _C.slate800),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      clock,
                      style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900, color: _C.slate800),
                    ),
                    const SizedBox(width: 16),
                    Text(
                      _nav.remainingKmNumberText,
                      style: const TextStyle(fontSize: 27, fontWeight: FontWeight.w900, color: _C.slate800),
                    ),
                    const SizedBox(width: 2),
                    const Text(
                      'km',
                      style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: _C.slate800),
                    ),
                  ],
                ),
              ],
            ),
          ),
          // 오른쪽: 메뉴 버튼 (시속 5km 이상 실제 주행 중에는 안전 잠금)
          IconButton(
            tooltip: '주행 메뉴',
            onPressed: _openDrivingMenu,
            icon: Icon(_nav.isMovingFast && !_nav.simulating ? Icons.lock : Icons.menu, size: 28, color: _C.slate800),
          ),
        ],
      ),
    );
  }

  /// 우측 하단 ☰ 메뉴 클릭 시 열리는 티맵 스타일 메뉴 시트 (안전경로 / 빠른경로 / 운행종료)
  /// - 시속 5km 이상 실제 주행 중에는 조작을 잠그고 음성으로 안내
  void _openDrivingMenu() {
    if (_nav.isMovingFast && !_nav.simulating) {
      _nav.warnLockedWhileMoving();
      _showLockedToast();
      return;
    }

    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        final currentMode = _nav.active?.mode ?? _nav.mode;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: _C.slate300,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 14),
                const Text(
                  '주행 메뉴 (정차 중 조작 가능)',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: _C.slate800),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: _menuRouteOption(
                        ctx,
                        RouteMode.safe,
                        Icons.shield_outlined,
                        '안전 경로 (추천)',
                        currentMode == RouteMode.safe,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: _menuRouteOption(
                        ctx,
                        RouteMode.fast,
                        Icons.bolt,
                        '빠른 경로',
                        currentMode == RouteMode.fast,
                      ),
                    ),
                  ],
                ),
                if (!_nav.overlayPermissionGranted) ...[
                  const SizedBox(height: 10),
                  OutlinedButton.icon(
                    onPressed: () {
                      Navigator.pop(ctx);
                      _nav.openOverlaySettings();
                    },
                    icon: const Icon(Icons.picture_in_picture_alt, color: _C.blue),
                    label: const Text(
                      '다른 앱 위에 표시 권한 설정 (백그라운드 안내)',
                      style: TextStyle(fontWeight: FontWeight.w700, color: _C.blue),
                    ),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      side: const BorderSide(color: _C.blue),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () {
                    Navigator.pop(ctx);
                    if (_nav.simulating) {
                      _nav.stopSimulation();
                    } else {
                      _nav.startSimulation();
                    }
                  },
                  icon: Icon(_nav.simulating ? Icons.pause : Icons.play_arrow, color: _C.slate800),
                  label: Text(
                    _nav.simulating ? '주행 시뮬레이션 멈추기 (정차)' : '주행 시뮬레이션 시작',
                    style: const TextStyle(fontWeight: FontWeight.w700, color: _C.slate800),
                  ),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    side: const BorderSide(color: _C.slate300),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
                const SizedBox(height: 10),
                ElevatedButton.icon(
                  onPressed: () {
                    Navigator.pop(ctx);
                    _confirmStop();
                  },
                  icon: const Icon(Icons.power_settings_new, color: Colors.white),
                  label: Text(
                    _nav.testMode ? '테스트 종료 (차량 내부 확인)' : '운행 종료 (차량 내부 확인)',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: Colors.white),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _C.red,
                    padding: const EdgeInsets.symmetric(vertical: 15),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                    elevation: 0,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _menuRouteOption(BuildContext ctx, RouteMode m, IconData icon, String title, bool selected) {
    return InkWell(
      borderRadius: BorderRadius.circular(12),
      onTap: () {
        Navigator.pop(ctx);
        _nav.selectMode(m);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        decoration: BoxDecoration(
          color: selected ? _C.blueBg : _C.slate100,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? _C.blue : _C.slate200, width: selected ? 2 : 1),
        ),
        child: Row(
          children: [
            Icon(icon, size: 20, color: selected ? _C.blue : _C.slate600),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                title,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: selected ? _C.blue : _C.slate800,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (selected) const Icon(Icons.check_circle, size: 18, color: _C.blue),
          ],
        ),
      ),
    );
  }

  // ───────────────────────── 지도 버튼 ─────────────────────────

  /// 오른쪽 위 (운행 준비/경로 선택 화면용)
  Widget _mapButtons({required double top}) {
    return Positioned(
      right: 10,
      top: top,
      child: Column(children: [
        _mapButton(Icons.my_location, '내 위치로', _nav.position == null ? null : _nav.centerOnMe),
        const SizedBox(height: 10),
        _mapButton(Icons.zoom_out_map, '전체 경로 보기', () => _nav.setFollow(false)),
      ]),
    );
  }

  Widget _mapButton(IconData icon, String tooltip, VoidCallback? onTap, {Color? iconColor}) {
    return Tooltip(
      message: tooltip,
      child: Material(
        color: Colors.white,
        shape: const CircleBorder(),
        elevation: 3,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 48,
            height: 48,
            child: Icon(icon, color: onTap == null ? _C.slate300 : (iconColor ?? _C.slate800), semanticLabel: tooltip),
          ),
        ),
      ),
    );
  }
}
