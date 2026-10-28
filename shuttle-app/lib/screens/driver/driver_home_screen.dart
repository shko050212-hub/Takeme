import 'dart:async';

import 'package:flutter/material.dart';

import '../../driver/driver_navigator.dart';
import '../../driver/geo.dart';
import '../../widgets/nav_map_view.dart';
import '../settings_screen.dart';

/// 기사 전용 화면 (팀 앱 디자인 유지, 고령 운전자도 보기 쉽게 큰 글씨·큰 버튼)
/// - 운행 전: 지도(내 위치) + 안전/빠른 경로 비교 카드 + 큰 운행 시작 버튼
/// - 운행 중: 다음 회전·정류장 안내 + 큰 지도 + 남은 거리·도착 시간 + 운행 종료
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
  static const slate800 = Color(0xFF1E293B);
  static const slate600 = Color(0xFF475569);
  static const slate500 = Color(0xFF64748B);
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
    // '마지막 전송 N초 전' 표시를 갱신
    _ticker = Timer.periodic(const Duration(seconds: 2), (_) {
      if (mounted && _nav.driving) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _nav.dispose();
    super.dispose();
  }

  Future<void> _confirmStop() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(_nav.testMode ? '테스트 종료' : '운행 종료',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
        content: Text(
          _nav.testMode ? '테스트 주행을 끝낼까요?' : '운행을 종료하고 위치 전송을 멈출까요?',
          style: const TextStyle(fontSize: 18),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            style: TextButton.styleFrom(minimumSize: const Size(88, 48)),
            child: const Text('계속 운행', style: TextStyle(fontSize: 18)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(minimumSize: const Size(88, 48)),
            child: const Text('종료', style: TextStyle(fontSize: 18, color: _C.red, fontWeight: FontWeight.w800)),
          ),
        ],
      ),
    );
    if (ok == true) await _nav.stop();
  }

  Future<void> _confirmSendToServer(bool value) async {
    if (!value) {
      setState(() => _nav.simSendToServer = false);
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('시뮬레이션 위치를 서버로 보낼까요?'),
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
        await _confirmSendToServer(!_nav.simSendToServer);
      case 'settings':
        if (mounted) {
          Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen()));
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: _nav,
      builder: (context, _) => Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          toolbarHeight: 60,
          title: Text(
            _nav.testMode ? '테스트 주행 (실제 운행 아님)' : (_nav.driving ? '운행 중' : '운행 준비'),
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: _nav.testMode ? _C.orange : _C.slate800,
            ),
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
              : (_nav.driving ? _drivingLayout() : _preStartLayout()),
        ),
      ),
    );
  }

  Widget _menu() {
    final items = <PopupMenuEntry<String>>[];
    if (!_nav.driving) {
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
      icon: const Icon(Icons.more_vert, color: _C.slate800, size: 28),
      onSelected: _onMenu,
      itemBuilder: (_) => items,
    );
  }

  PopupMenuItem<String> _menuItem(String v, IconData icon, String text) => PopupMenuItem(
        value: v,
        height: 52,
        child: Row(children: [
          Icon(icon, color: _C.slate600),
          const SizedBox(width: 12),
          Flexible(child: Text(text, style: const TextStyle(fontSize: 17))),
        ]),
      );

  // ───────────────────────── 운행 전 ─────────────────────────

  Widget _preStartLayout() {
    final maxPanel = MediaQuery.of(context).size.height * 0.58;
    return Column(
      children: [
        Expanded(child: _mapArea()),
        Container(
          constraints: BoxConstraints(maxHeight: maxPanel),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            boxShadow: [BoxShadow(color: Color(0x1A000000), blurRadius: 12, offset: Offset(0, -2))],
          ),
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _todaySummary(),
                if (_nav.setupNotice != null) ...[
                  const SizedBox(height: 10),
                  _notice(_nav.setupNotice!, Icons.info_outline, _C.orange, _C.orangeBg),
                ],
                if (_nav.gpsError != null) ...[
                  const SizedBox(height: 10),
                  _notice('${_nav.gpsError} · 유치원 위치에서 출발하는 경로로 계산합니다.', Icons.gps_off, _C.red,
                      const Color(0xFFFEF2F2)),
                ],
                const SizedBox(height: 14),
                const Text('경로 선택',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: _C.slate600)),
                const SizedBox(height: 8),
                _planCard(RouteMode.safe, Icons.shield_outlined),
                const SizedBox(height: 10),
                _planCard(RouteMode.fast, Icons.bolt),
                const SizedBox(height: 8),
                _compareNote(),
                const SizedBox(height: 16),
                _startButton(),
                if (_nav.actionError != null) ...[
                  const SizedBox(height: 10),
                  Text(_nav.actionError!, style: const TextStyle(color: _C.red, fontSize: 16)),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _todaySummary() {
    return Wrap(
      spacing: 16,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(
          _nav.vehicleName.isEmpty ? '배정 차량 없음' : '오늘 차량  ${_nav.vehicleName}',
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: _C.slate800),
        ),
        Text('정류장 ${_nav.stops.length}곳',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: _C.blue)),
      ],
    );
  }

  Widget _notice(String text, IconData icon, Color color, Color bg) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(color: color, fontSize: 15, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }

  Widget _planCard(RouteMode m, IconData modeIcon) {
    final slot = _nav.slots[m]!;
    final selected = _nav.mode == m;
    final plan = slot.plan;

    Widget metrics;
    switch (slot.status) {
      case PlanStatus.loading:
        metrics = const Row(mainAxisSize: MainAxisSize.min, children: [
          SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.5)),
          SizedBox(width: 8),
          Text('계산 중', style: TextStyle(fontSize: 16, color: _C.slate500)),
        ]);
      case PlanStatus.error:
        metrics = TextButton.icon(
          onPressed: _nav.previewRoutes,
          style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
          icon: const Icon(Icons.refresh, color: _C.red),
          label: const Text('계산 실패 · 다시', style: TextStyle(color: _C.red, fontSize: 16)),
        );
      case PlanStatus.ready:
        metrics = Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(plan!.minutesText,
              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: _C.slate800)),
          Text('${formatDistance(plan.distanceM)} · 회전 ${plan.turnCount}회',
              style: const TextStyle(fontSize: 15, color: _C.slate600)),
        ]);
      case PlanStatus.idle:
        metrics = const Text('-', style: TextStyle(fontSize: 18, color: _C.slate500));
    }

    return Semantics(
      button: true,
      selected: selected,
      label: '${m.title}, ${m.criteria}${plan != null ? ', ${plan.minutesText}, ${formatDistance(plan.distanceM)}' : ''}',
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => _nav.selectMode(m),
        child: Container(
          constraints: const BoxConstraints(minHeight: 72),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: selected ? _C.blueBg : Colors.white,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: selected ? _C.blue : _C.slate200, width: selected ? 3 : 1.5),
          ),
          child: Row(
            children: [
              Icon(selected ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: selected ? _C.blue : _C.slate500, size: 30),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(children: [
                      Icon(modeIcon, size: 20, color: selected ? _C.blue : _C.slate600),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(m.title,
                            style: TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                                color: selected ? _C.blue : _C.slate800)),
                      ),
                    ]),
                    Text(m.criteria, style: const TextStyle(fontSize: 14, color: _C.slate500)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              metrics,
            ],
          ),
        ),
      ),
    );
  }

  Widget _compareNote() {
    final a = _nav.slots[RouteMode.safe]!.plan;
    final b = _nav.slots[RouteMode.fast]!.plan;
    String text = '지도: 파란 실선 = 선택한 경로, 회색 점선 = 다른 경로. '
        '안전 경로는 카카오 추천 경로에서 유턴을 피한 것으로, 도로 위험도까지 반영하지는 않습니다.';
    if (a != null && b != null && a.distanceM.round() == b.distanceM.round() && a.path.length == b.path.length) {
      text = '이 구간은 두 경로가 같게 나왔습니다. (가까운 거리에서는 추천 경로와 최단 시간 경로가 같은 경우가 많습니다) $text';
    }
    return Text(text, style: const TextStyle(fontSize: 13, color: _C.slate500, height: 1.4));
  }

  Widget _startButton() {
    final disabled = _nav.busy || _nav.vehicleId == null;
    return SizedBox(
      height: 64,
      child: ElevatedButton.icon(
        onPressed: disabled ? null : _nav.start,
        icon: _nav.busy
            ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
            : const Icon(Icons.play_circle_fill, size: 30, color: Colors.white),
        label: Text('운행 시작 · ${_nav.mode.title}',
            style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w900, color: Colors.white)),
        style: ElevatedButton.styleFrom(
          backgroundColor: _C.blue,
          disabledBackgroundColor: const Color(0xFFCBD5E1),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: 0,
        ),
      ),
    );
  }

  // ───────────────────────── 운행 중 ─────────────────────────

  Widget _drivingLayout() {
    return Column(
      children: [
        _guideBanner(),
        Expanded(child: _mapArea()),
        _bottomBar(),
      ],
    );
  }

  IconData _turnIcon(String text) {
    if (text.contains('유턴') || text.contains('U턴')) return Icons.u_turn_left;
    if (text.contains('좌회전')) return Icons.turn_left;
    if (text.contains('우회전')) return Icons.turn_right;
    if (text.contains('목적지') || text.contains('경유지')) return Icons.flag;
    return Icons.straight;
  }

  Widget _guideBanner() {
    final turn = _nav.nextTurn;
    final next = _nav.nextStop;
    final nd = _nav.nextStopDistance;
    final color = _nav.testMode ? _C.orange : _C.blue;
    final total = _nav.activeStops.length;

    return Container(
      width: double.infinity,
      color: color,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (_nav.rerouting)
                const SizedBox(
                    width: 36, height: 36, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
              else
                Icon(turn == null ? Icons.straight : _turnIcon(turn.$2), color: Colors.white, size: 44),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  _nav.rerouting
                      ? '경로를 다시 찾는 중...'
                      : (turn == null ? '경로를 따라 주행하세요' : '${formatDistance(turn.$1)} 앞 ${turn.$2}'),
                  style: const TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w900, height: 1.2),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            next == null
                ? '모든 정류장 완료 · 유치원으로 복귀'
                : '다음 정류장  ${next.name}  (${_nav.passedCount + 1}/$total)'
                    '${nd == null ? '' : ' · ${formatDistance(nd)}'}',
            style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w700),
          ),
          if (_nav.routeWarning != null) ...[
            const SizedBox(height: 6),
            Row(children: [
              const Icon(Icons.warning_amber, color: Color(0xFFFDE68A), size: 20),
              const SizedBox(width: 6),
              Expanded(
                child: Text(_nav.routeWarning!,
                    style: const TextStyle(color: Color(0xFFFDE68A), fontSize: 15, fontWeight: FontWeight.w600)),
              ),
            ]),
          ],
        ],
      ),
    );
  }

  Widget _bottomBar() {
    final a = _nav.active;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              // 지금 안내 중인 경로 (색 + 아이콘 + 글자)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: _C.blueBg,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: _C.blue, width: 1.5),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(a?.mode == RouteMode.fast ? Icons.bolt : Icons.shield_outlined, color: _C.blue, size: 20),
                  const SizedBox(width: 4),
                  Text(a?.mode.title ?? _nav.mode.title,
                      style: const TextStyle(color: _C.blue, fontSize: 16, fontWeight: FontWeight.w800)),
                ]),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  '남은 ${formatDistance(_nav.remainingM)} · ${_nav.remainingMinutesText} · 도착 ${_nav.etaText}',
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _C.slate800),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _statusRow(),
          const SizedBox(height: 10),
          SizedBox(
            height: 56,
            child: OutlinedButton.icon(
              onPressed: _nav.busy ? null : _confirmStop,
              icon: const Icon(Icons.stop_circle_outlined, color: _C.red, size: 26),
              label: Text(_nav.testMode ? '테스트 종료' : '운행 종료',
                  style: const TextStyle(color: _C.red, fontSize: 19, fontWeight: FontWeight.w800)),
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: _C.red, width: 2),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusRow() {
    Widget chip(IconData icon, String text, bool ok) => Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 18, color: ok ? _C.green : _C.red),
          const SizedBox(width: 4),
          Text(text,
              style: TextStyle(
                  fontSize: 14, color: ok ? _C.slate600 : _C.red, fontWeight: ok ? FontWeight.w500 : FontWeight.w800)),
        ]);

    final acc = _nav.accuracy;
    final last = _nav.lastSentAt;
    String sendText;
    bool sendOk = true;
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

    return Wrap(
      spacing: 14,
      runSpacing: 4,
      children: [
        chip(_nav.socketConnected ? Icons.cloud_done : Icons.cloud_off,
            _nav.socketConnected ? '서버 연결' : '서버 끊김', _nav.socketConnected),
        chip(_nav.gpsError == null ? Icons.gps_fixed : Icons.gps_off,
            _nav.gpsError ?? (acc == null ? 'GPS' : 'GPS ±${acc.round()}m'), _nav.gpsError == null),
        chip(Icons.upload, sendText, sendOk),
      ],
    );
  }

  // ───────────────────────── 지도 ─────────────────────────

  Widget _mapArea() {
    return Stack(
      children: [
        Positioned.fill(child: NavMapView(controller: _map)),
        if (_nav.simulating)
          Positioned(
            top: 12,
            left: 56,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(color: _C.slate800, borderRadius: BorderRadius.circular(20)),
              child: const Text('시뮬레이션 주행 중',
                  style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.w700)),
            ),
          ),
        // 지도 버튼: 오른쪽 가운데 아래 (안내·출처·확대 버튼과 겹치지 않게)
        Positioned(
          right: 12,
          bottom: 24,
          child: Column(
            children: [
              _mapButton(Icons.my_location, '내 위치로', _nav.position == null ? null : _nav.centerOnMe),
              const SizedBox(height: 12),
              _mapButton(Icons.zoom_out_map, '전체 경로 보기', () => _nav.setFollow(false)),
            ],
          ),
        ),
      ],
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
            width: 56,
            height: 56,
            child: Icon(icon, color: onTap == null ? _C.slate200 : _C.blue, size: 28, semanticLabel: tooltip),
          ),
        ),
      ),
    );
  }
}
