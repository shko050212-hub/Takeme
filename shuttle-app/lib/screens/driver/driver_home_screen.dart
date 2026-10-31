import 'dart:async';

import 'package:flutter/material.dart';

import '../../driver/driver_navigator.dart';
import '../../driver/geo.dart';
import '../../widgets/nav_map_view.dart';
import '../settings_screen.dart';
import 'operation_log_screen.dart';

/// 기사 전용 화면 (팀 앱과 같은 크기·글꼴)
/// - 1단계(운행 준비): 전체 지도 + 하단 준비 패널('경로 탐색' 버튼)
/// - 2단계(경로 탐색·선택): 전체 경로 축소 보기 + 안전 경로/빠른 경로 비교 카드 + '운행 시작' 버튼
/// - 3단계(운행 중): 티맵 스타일 주행 화면 (상단 회전 안내 + 하단 바 + 메뉴 안에 안전/빠른 경로·운행 종료)
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _C {
  static const blue = Color(0xFF2563EB);
  static const blueDark = Color(0xFF1D4ED8);
  static const blueBg = Color(0xFFEFF6FF);
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

  void _openLogs() =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => const OperationLogScreen()));

  Future<void> _confirmStop() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(_nav.testMode ? '테스트 종료' : '운행 종료',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
        content: Text(_nav.testMode ? '테스트 주행을 끝낼까요?' : '현재 운행을 종료하시겠습니까?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('계속 주행', style: TextStyle(color: _C.slate600, fontWeight: FontWeight.w700)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: _C.red,
              foregroundColor: Colors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            child: Text(_nav.testMode ? '테스트 종료' : '운행 종료',
                style: const TextStyle(fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
    if (ok == true) await _nav.stop();
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
              if (_nav.driving)
                Positioned(left: 0, top: 0, child: _turnHeader()),
              if (_nav.driving && !_nav.overlayPermissionGranted)
                Positioned(
                  left: 12,
                  right: 12,
                  top: 118,
                  child: Material(
                    color: Colors.transparent,
                    child: InkWell(
                      borderRadius: BorderRadius.circular(12),
                      onTap: _nav.openOverlaySettings,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
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
                  child: _mapButton(Icons.navigation, '내 위치로 (12시 방향 정렬)',
                      _nav.position == null ? null : _nav.centerOnMe,
                      iconColor: _C.blue),
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

  /// 티맵 스타일 하단 바: [ ↻ 새로고침 ]   [ 도착예정시각  남은km ]   [ ☰ 메뉴 ]
  Widget _bottomBar() {
    final a = _nav.active;
    final currentMode = a?.mode ?? _nav.mode;
    final next = _nav.nextStop;
    final (ampm, clock) = _nav.etaAmPmAndTime;
    final subtitle = next != null
        ? '다음 정류장: ${next.name} · ${currentMode.title}'
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
          // 가운데: 상단 안내줄 + 하단 도착예정시각 & 남은 km
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.gps_fixed, size: 13, color: _C.slate500),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _C.slate500),
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
          // 오른쪽: 메뉴 버튼 (티맵 ☰ 위치 → 안전경로, 빠른경로, 운행종료)
          IconButton(
            tooltip: '주행 메뉴',
            onPressed: _openDrivingMenu,
            icon: const Icon(Icons.menu, size: 28, color: _C.slate800),
          ),
        ],
      ),
    );
  }

  /// 우측 하단 ☰ 메뉴 클릭 시 열리는 티맵 스타일 메뉴 시트 (안전경로 / 빠른경로 / 운행종료)
  void _openDrivingMenu() {
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
                  '경로 안내 옵션',
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
                    _nav.simulating ? '주행 시뮬레이션 멈추기' : '주행 시뮬레이션 시작',
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
                    _nav.testMode ? '테스트 종료' : '운행 종료',
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
