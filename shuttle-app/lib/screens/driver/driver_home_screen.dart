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
  // 아래 패널 높이 (화면 비율): 접힘 / 기본 / 펼침
  static const _sheetMin = 0.2;
  static const _sheetMid = 0.48;
  static const _sheetMax = 0.85;

  late final NavMapController _map;
  late final DriverNavigator _nav;
  final _sheet = DraggableScrollableController();
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
    _sheet.dispose();
    _nav.dispose();
    super.dispose();
  }

  void _toggleSheet() {
    if (!_sheet.isAttached) return;
    final target = _sheet.size > (_sheetMin + 0.05) ? _sheetMin : _sheetMid;
    _sheet.animateTo(target, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
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
          title: Text(
            _nav.testMode
                ? '테스트 주행 (실제 운행 아님)'
                : (_nav.driving ? '운행 중' : (_nav.vehicleName.isEmpty ? '기사님 운행 대시보드' : '${_nav.vehicleName} 운행 준비')),
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
              : (_nav.driving ? _drivingLayout() : _preStartLayout()),
        ),
      ),
    );
  }

  Widget _menu() {
    final items = <PopupMenuEntry<String>>[];
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

  // ───────────────────────── 운행 전 ─────────────────────────

  Widget _preStartLayout() {
    return Stack(
      children: [
        Positioned.fill(child: NavMapView(controller: _map)),
        _mapButtons(top: 92), // 지도 확대·축소 버튼(오른쪽 위) 아래
        DraggableScrollableSheet(
          controller: _sheet,
          initialChildSize: _sheetMid,
          minChildSize: _sheetMin,
          maxChildSize: _sheetMax,
          snap: true,
          snapSizes: const [_sheetMid], // 접힘·펼침(min·max)은 자동 포함
          builder: (context, scroll) => Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
              boxShadow: [BoxShadow(color: Color(0x22000000), blurRadius: 12, offset: Offset(0, -2))],
            ),
            child: ListView(
              controller: scroll,
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
              children: [
                // 손잡이: 끌어서 내리고 올리기, 눌러서 접기·펴기
                Semantics(
                  button: true,
                  label: '아래 패널 접기 또는 펼치기',
                  child: InkWell(
                    onTap: _toggleSheet,
                    child: SizedBox(
                      height: 28,
                      child: Center(
                        child: Container(
                          width: 44,
                          height: 5,
                          decoration: BoxDecoration(color: _C.slate300, borderRadius: BorderRadius.circular(3)),
                        ),
                      ),
                    ),
                  ),
                ),
                _summaryRow(),
                const SizedBox(height: 12),
                _startButton(),
                if (_nav.actionError != null) ...[
                  const SizedBox(height: 8),
                  Text(_nav.actionError!, style: const TextStyle(color: _C.red, fontSize: 13)),
                ],
                if (_nav.setupNotice != null) ...[
                  const SizedBox(height: 12),
                  _notice(_nav.setupNotice!, Icons.info_outline, _C.orange, _C.orangeBg),
                ],
                if (_nav.gpsError != null) ...[
                  const SizedBox(height: 8),
                  _notice('${_nav.gpsError} · 유치원 위치에서 출발하는 경로로 계산합니다.', Icons.gps_off, _C.red,
                      const Color(0xFFFEF2F2)),
                ],
                const SizedBox(height: 16),
                const Text('경로 선택', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: _C.slate600)),
                const SizedBox(height: 8),
                _planCard(RouteMode.safe, Icons.shield_outlined),
                const SizedBox(height: 8),
                _planCard(RouteMode.fast, Icons.bolt),
                const SizedBox(height: 8),
                _compareNote(),
              ],
            ),
          ),
        ),
      ],
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
              Text('정류장 ${_nav.stops.length}곳',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _C.blue)),
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

  Widget _planCard(RouteMode m, IconData modeIcon) {
    final slot = _nav.slots[m]!;
    final selected = _nav.mode == m;
    final plan = slot.plan;

    Widget metrics;
    switch (slot.status) {
      case PlanStatus.loading:
        metrics = const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2));
      case PlanStatus.error:
        metrics = TextButton.icon(
          onPressed: _nav.previewRoutes,
          icon: const Icon(Icons.refresh, color: _C.red, size: 18),
          label: const Text('다시', style: TextStyle(color: _C.red)),
        );
      case PlanStatus.ready:
        metrics = Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(plan!.minutesText, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _C.slate800)),
          Text('${formatDistance(plan.distanceM)} · 회전 ${plan.turnCount}회',
              style: const TextStyle(fontSize: 12, color: _C.slate500)),
        ]);
      case PlanStatus.idle:
        metrics = const Text('-', style: TextStyle(color: _C.slate500));
    }

    return Semantics(
      button: true,
      selected: selected,
      label: '${m.title}, ${m.criteria}${plan != null ? ', ${plan.minutesText}, ${formatDistance(plan.distanceM)}' : ''}',
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _nav.selectMode(m),
        child: Container(
          constraints: const BoxConstraints(minHeight: 56),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? _C.blueBg : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: selected ? _C.blue : _C.slate200, width: selected ? 2 : 1),
          ),
          child: Row(
            children: [
              Icon(selected ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: selected ? _C.blue : _C.slate500, size: 22),
              const SizedBox(width: 10),
              Icon(modeIcon, size: 18, color: selected ? _C.blue : _C.slate600),
              const SizedBox(width: 4),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(m.title,
                        style: TextStyle(
                            fontSize: 15, fontWeight: FontWeight.w800, color: selected ? _C.blue : _C.slate800)),
                    Text(m.criteria, style: const TextStyle(fontSize: 11, color: _C.slate500)),
                  ],
                ),
              ),
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
    var text = '경로 색: 파랑 원활 · 노랑 서행 · 빨강 정체 / 회색 점선은 다른 경로. '
        '안전 경로는 추천 경로에서 유턴을 피한 것으로, 도로 위험도까지 반영하지는 않습니다.';
    if (a != null && b != null && a.distanceM.round() == b.distanceM.round() && a.path.length == b.path.length) {
      text = '이 구간은 두 경로가 같게 나왔습니다. $text';
    }
    return Text(text, style: const TextStyle(fontSize: 11, color: _C.slate500, height: 1.4));
  }

  Widget _startButton() {
    final disabled = _nav.busy || _nav.vehicleId == null;
    return ElevatedButton.icon(
      onPressed: disabled ? null : _nav.start,
      icon: _nav.busy
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
          : const Icon(Icons.play_circle_outline, color: Colors.white),
      label: Text('운행 시작 (위치 켜기) · ${_nav.mode.title}',
          style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white)),
      style: ElevatedButton.styleFrom(
        backgroundColor: _C.blue,
        disabledBackgroundColor: _C.slate300,
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        elevation: 0,
      ),
    );
  }

  // ───────────────────────── 운행 중 ─────────────────────────

  Widget _drivingLayout() {
    return Column(
      children: [
        Expanded(
          child: Stack(
            children: [
              Positioned.fill(child: NavMapView(controller: _map)),
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
        _bottomBar(),
      ],
    );
  }

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
    final next = _nav.nextStop;
    final nd = _nav.nextStopDistance;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            next == null
                ? '모든 정류장 완료 · 유치원으로 복귀'
                : '다음 정류장  ${next.name} (${_nav.passedCount + 1}/${_nav.activeStops.length})'
                    '${nd == null ? '' : ' · ${formatDistance(nd)}'}',
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: _C.slate800),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: _C.blueBg,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: _C.blue),
                ),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(a?.mode == RouteMode.fast ? Icons.bolt : Icons.shield_outlined, color: _C.blue, size: 14),
                  const SizedBox(width: 3),
                  Text(a?.mode.title ?? _nav.mode.title,
                      style: const TextStyle(color: _C.blue, fontSize: 12, fontWeight: FontWeight.w800)),
                ]),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  '남은 ${formatDistance(_nav.remainingM)} · ${_nav.remainingMinutesText} · 도착 ${_nav.etaText}',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: _C.slate600),
                ),
              ),
            ],
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
