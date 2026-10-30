import 'dart:async';

import 'package:flutter/material.dart';

import '../../driver/driver_navigator.dart';
import '../../driver/geo.dart';
import '../../widgets/nav_map_view.dart';
import '../settings_screen.dart';
import 'operation_log_screen.dart';

/// 기사 전용 화면 (팀 앱과 같은 크기·글꼴)
/// - 운행 전: 전체 지도 + 아래 패널(끌어서 내리고 올리기): 차량·운행 일지·운행 시작·경로 비교
/// - 운행 중: 전체 지도 + 왼쪽 위 회전 안내(카카오내비 방식) + 아래 운행 정보
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _C {
  static const blue = Color(0xFF2563EB);
  static const blueBg = Color(0xFFEFF6FF);
  static const red = Color(0xFFDC2626);
  static const orange = Color(0xFFEA580C);
  static const orangeBg = Color(0xFFFFF7ED);
  static const green = Color(0xFF059669);
  static const sky = Color(0xFF0EA5E9);
  static const slate800 = Color(0xFF1E293B);
  static const slate600 = Color(0xFF475569);
  static const slate500 = Color(0xFF64748B);
  static const slate300 = Color(0xFFCBD5E1);
  static const slate200 = Color(0xFFE2E8F0);
  static const slate100 = Color(0xFFF1F5F9);
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  late final NavMapController _map;
  late final DriverNavigator _nav;
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _map = NavMapController();
    _nav = DriverNavigator(_map)..init();
    _ticker = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted && _nav.driving) setState(() {}); // '마지막 전송 N초 전' 갱신
    });
  }

  @override
  void dispose() {
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
        title: Text(_nav.testMode ? '테스트 종료' : '운행 종료',
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: Text(_nav.testMode ? '테스트 주행을 끝낼까요?' : '운행을 종료하고 위치 전송을 멈출까요?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('종료', style: TextStyle(color: _C.red, fontWeight: FontWeight.bold)),
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
      case 'settings':
        if (mounted) Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _nav,
      builder: (context, _) => Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        appBar: AppBar(
          leading: (!_nav.driving && _nav.routePreviewing)
              ? IconButton(
                  icon: const Icon(Icons.arrow_back, color: _C.slate800),
                  tooltip: '이전 화면',
                  onPressed: _nav.closeRoutePreview,
                )
              : null,
          title: Text(
            _nav.testMode
                ? '테스트 주행 (실제 운행 아님)'
                : (_nav.driving
                    ? '운행 중'
                    : (_nav.routePreviewing
                        ? '경로 탐색 · 선택'
                        : (_nav.vehicleName.isEmpty ? '기사님 운행 대시보드' : '${_nav.vehicleName} 운행 준비'))),
            style: TextStyle(color: _nav.testMode ? _C.orange : _C.slate800),
          ),
          actions: [_menu()],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(1),
            child: Container(color: _C.slate100, height: 1),
          ),
        ),
        body: SafeArea(
          top: false,
          child: _nav.loading
              ? const Center(child: CircularProgressIndicator(color: _C.blue))
              : _mainBody(),
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
                Positioned(left: 12, top: 12, right: 64, child: _turnHeader()),
              _mapButtons(top: 92),
              if (_nav.simulating)
                Positioned(
                  left: 12,
                  bottom: 12,
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
          // 안전 경로 / 빠른 경로 간판형 비교 카드 (나란히 배치하여 둘 중 선택)
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
              const SizedBox(height: 8),
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

  /// 왼쪽 위 회전 안내 (카카오내비 방식): [아이콘] 거리  방면·동작
  Widget _turnHeader() {
    final turn = _nav.nextTurn;
    final color = _nav.testMode ? _C.orange : const Color(0xFF1E40AF);
    return Container(
      padding: const EdgeInsets.fromLTRB(10, 10, 14, 10),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(14),
        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8, offset: Offset(0, 2))],
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 2)),
            child: _nav.rerouting
                ? const Padding(
                    padding: EdgeInsets.all(10),
                    child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.5))
                : Icon(turn == null ? Icons.straight : _turnIcon(turn.$2), color: Colors.white, size: 30),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: _nav.rerouting
                ? const Text('경로를 다시 찾는 중...',
                    style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700))
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(turn == null ? '직진' : formatDistance(turn.$1),
                          style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
                      Text(turn == null ? '경로를 따라 주행하세요' : turn.$2,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w600)),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  Widget _bottomBar() {
    final a = _nav.active;
    final currentMode = a?.mode ?? _nav.mode;
    final next = _nav.nextStop;
    final nd = _nav.nextStopDistance;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // 1. 상단: 현재 안내 경로 표시 + 새로고침 버튼
          Row(
            children: [
              _modeChip(RouteMode.safe, currentMode == RouteMode.safe, label: '안전 경로 (추천)'),
              const SizedBox(width: 6),
              _modeChip(RouteMode.fast, currentMode == RouteMode.fast, label: '빠른 경로'),
              const Spacer(),
              InkWell(
                borderRadius: BorderRadius.circular(8),
                onTap: _nav.rerouting ? null : () => _nav.refreshRouteFromServer(speak: true),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
          const SizedBox(height: 8),
          // 2. 도착 예정시간 · 남은 거리(몇 km 남았는지) 표시 바
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: _C.blueBg,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: _C.blue.withValues(alpha: 0.3)),
            ),
            child: Row(
              children: [
                Text(
                  _nav.remainingMinutesText,
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w900, color: _C.blue),
                ),
                const SizedBox(width: 10),
                Container(width: 1, height: 22, color: _C.slate300),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _nav.etaText,
                        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: _C.slate800),
                      ),
                      Text(
                        '남은 거리 ${_nav.remainingKmText}',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _C.blue),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          // 3. 다음 정류장 안내
          Text(
            next == null
                ? '모든 정류장 완료 · 유치원으로 이동 중'
                : '다음 정류장  ${next.name} (${_nav.passedCount + 1}/${_nav.activeStops.length})'
                    '${nd == null ? '' : ' · ${formatDistance(nd)}'}',
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: _C.slate800),
          ),
          if (_nav.routeWarning != null) ...[
            const SizedBox(height: 6),
            Text(_nav.routeWarning!, style: const TextStyle(fontSize: 12, color: _C.orange)),
          ],
          const SizedBox(height: 6),
          _statusRow(),
          const SizedBox(height: 10),
          ElevatedButton.icon(
            onPressed: _nav.busy ? null : _confirmStop,
            icon: const Icon(Icons.stop_circle_outlined, color: Colors.white),
            label: Text(_nav.testMode ? '테스트 종료' : '운행 종료 (위치 끄기)',
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white)),
            style: ElevatedButton.styleFrom(
              backgroundColor: _C.red,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              elevation: 0,
            ),
          ),
        ],
      ),
    );
  }

  Widget _modeChip(RouteMode m, bool selected, {required String label}) {
    return InkWell(
      borderRadius: BorderRadius.circular(8),
      onTap: () => _nav.selectMode(m),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: selected ? _C.blue : Colors.white,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: selected ? _C.blue : _C.slate300),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              m == RouteMode.fast ? Icons.bolt : Icons.shield_outlined,
              color: selected ? Colors.white : _C.slate600,
              size: 14,
            ),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : _C.slate600,
                fontSize: 12,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusRow() {
    Widget chip(IconData icon, String text, bool ok) => Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 14, color: ok ? _C.green : _C.red),
          const SizedBox(width: 3),
          Text(text,
              style: TextStyle(fontSize: 12, color: ok ? _C.slate500 : _C.red, fontWeight: ok ? FontWeight.w500 : FontWeight.w700)),
        ]);

    final acc = _nav.accuracy;
    final last = _nav.lastSentAt;
    String sendText;
    var sendOk = true;
    if (_nav.testMode) {
      sendText = '테스트: 서버 전송 안 함';
    } else if (_nav.simulating && !_nav.simSendToServer) {
      sendText = '시뮬레이션: 서버 전송 안 함';
    } else if (last == null) {
      sendText = '아직 전송 전';
      sendOk = false;
    } else {
      final sec = DateTime.now().difference(last).inSeconds;
      sendText = '$sec초 전 전송';
      sendOk = sec < 30;
    }
    return Wrap(spacing: 12, runSpacing: 2, children: [
      chip(_nav.socketConnected ? Icons.cloud_done : Icons.cloud_off,
          _nav.socketConnected ? '서버 연결' : '서버 끊김', _nav.socketConnected),
      chip(_nav.gpsError == null ? Icons.gps_fixed : Icons.gps_off,
          _nav.gpsError ?? (acc == null ? 'GPS' : 'GPS ±${acc.round()}m'), _nav.gpsError == null),
      chip(Icons.upload, sendText, sendOk),
    ]);
  }

  // ───────────────────────── 지도 버튼 ─────────────────────────

  /// 오른쪽 위 (지도 확대·축소 버튼 아래) — 아래 패널·회전 안내와 겹치지 않음
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

  Widget _mapButton(IconData icon, String tooltip, VoidCallback? onTap) {
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
            child: Icon(icon, color: onTap == null ? _C.slate300 : _C.blue, semanticLabel: tooltip),
          ),
        ),
      ),
    );
  }
}
