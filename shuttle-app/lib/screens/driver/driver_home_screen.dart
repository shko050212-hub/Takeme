import 'package:flutter/material.dart';

import '../../driver/driver_navigator.dart';
import '../../driver/geo.dart';
import '../../services/api_service.dart';
import '../../widgets/nav_map_view.dart';
import '../settings_screen.dart';

/// 기사 전용 운행 화면 (팀 앱 StaffDashboardScreen 과 같은 디자인)
/// 운행 시작/종료 → 경로 선택(안전/빠른) → 길 안내 → 내비게이션 지도
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  static const _blue = Color(0xFF2563EB);
  static const _red = Color(0xFFDC2626);
  static const _slate800 = Color(0xFF1E293B);
  static const _slate600 = Color(0xFF475569);
  static const _slate500 = Color(0xFF64748B);
  static const _slate200 = Color(0xFFE2E8F0);
  static const _slate100 = Color(0xFFF1F5F9);

  late final NavMapController _map;
  late final DriverNavigator _nav;

  @override
  void initState() {
    super.initState();
    _map = NavMapController();
    _nav = DriverNavigator(_map)..init();
  }

  @override
  void dispose() {
    _nav.dispose();
    super.dispose();
  }

  Future<void> _toggleOperation() async {
    if (!_nav.operating) {
      await _nav.start();
      if (!mounted) return;
      if (_nav.operating) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('운행이 시작되었습니다. 실시간 위치가 전송됩니다.'), backgroundColor: Color(0xFF10B981)),
        );
      }
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('운행 종료', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
        content: const Text('운행을 종료하고 위치 전송을 멈출까요?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('종료', style: TextStyle(color: _red, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
    if (ok == true) {
      await _nav.stop();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('운행이 종료되었습니다.'), backgroundColor: Color(0xFF64748B)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ApiService().currentUser;
    return ListenableBuilder(
      listenable: _nav,
      builder: (context, _) => Scaffold(
        backgroundColor: const Color(0xFFF8FAFC),
        appBar: AppBar(
          title: Text(
            _nav.vehicleName.isEmpty ? '기사님 운행 대시보드' : '${_nav.vehicleName} 운행',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: _slate800),
          ),
          backgroundColor: Colors.white,
          elevation: 0,
          actions: [
            if (_nav.operating)
              IconButton(
                icon: Icon(_nav.simulating ? Icons.pause_circle_outline : Icons.science_outlined, color: _blue),
                tooltip: _nav.simulating ? '시뮬레이션 중지' : '주행 시뮬레이션 (테스트)',
                onPressed: _nav.toggleSimulation,
              ),
            IconButton(
              icon: const Icon(Icons.settings_outlined, color: _slate600),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const SettingsScreen())),
            ),
          ],
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(1),
            child: Container(color: _slate100, height: 1),
          ),
        ),
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: Colors.white,
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (user != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Text('${user.name} 기사님, 오늘도 안전운행을 부탁드립니다!',
                          style: const TextStyle(fontSize: 14, color: _slate500, fontWeight: FontWeight.w600)),
                    ),
                  _operationButton(),
                  const SizedBox(height: 10),
                  _routeModeSelector(),
                ],
              ),
            ),
            _guidePanel(),
            Expanded(child: _mapArea()),
            _statusBar(),
          ],
        ),
      ),
    );
  }

  // 운행 시작/종료 (팀 앱과 같은 버튼)
  Widget _operationButton() {
    final on = _nav.operating;
    return ElevatedButton.icon(
      onPressed: (_nav.busy || _nav.loading) ? null : _toggleOperation,
      icon: _nav.busy
          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
          : Icon(on ? Icons.stop_circle_outlined : Icons.play_circle_outline, color: Colors.white),
      label: Text(
        on ? '운행 종료 (위치 끄기)' : '운행 시작 (위치 켜기)',
        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15, color: Colors.white),
      ),
      style: ElevatedButton.styleFrom(
        backgroundColor: on ? _red : _blue,
        disabledBackgroundColor: const Color(0xFFCBD5E1),
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        elevation: 0,
      ),
    );
  }

  // 경로 선택
  Widget _routeModeSelector() {
    Widget chip(RouteMode m, String title, String sub) {
      final selected = _nav.mode == m;
      return Expanded(
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: _nav.routing ? null : () => _nav.setMode(m),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 10),
            decoration: BoxDecoration(
              color: selected ? const Color(0xFFEFF6FF) : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: selected ? _blue : _slate200, width: selected ? 1.5 : 1),
            ),
            child: Column(
              children: [
                Text(title,
                    style: TextStyle(fontWeight: FontWeight.w800, fontSize: 14, color: selected ? _blue : _slate600)),
                const SizedBox(height: 2),
                Text(sub, style: const TextStyle(fontSize: 11, color: _slate500)),
              ],
            ),
          ),
        ),
      );
    }

    return Row(
      children: [
        chip(RouteMode.safe, '안전 경로', '큰길 위주 · 유턴 회피'),
        const SizedBox(width: 10),
        chip(RouteMode.fast, '빠른 경로', '최단 시간'),
      ],
    );
  }

  // 길 안내 패널
  Widget _guidePanel() {
    if (_nav.loading) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator(color: _blue)),
      );
    }
    final error = _nav.error;

    if (!_nav.operating) {
      return Container(
        margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: _slate200),
        ),
        child: Text(
          error ?? '오늘 정류장 ${_nav.stops.length}곳 · 운행을 시작하면 길 안내가 시작됩니다.',
          style: TextStyle(color: error != null ? _red : _slate600, fontSize: 14),
        ),
      );
    }

    final next = _nav.nextStop;
    final nextDist = _nav.nextStopDistance;
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: _blue, borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _nav.routing ? '경로를 탐색하고 있습니다...' : (_nav.instruction.isEmpty ? '경로를 따라 주행하세요' : _nav.instruction),
            style: const TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Text(
            next == null
                ? '모든 정류장을 지났습니다 · 유치원으로 복귀'
                : '다음 정류장 ${next.name} (${_nav.passedCount + 1}/${_nav.stops.length})'
                    '${nextDist == null ? '' : ' · ${formatDistance(nextDist)}'}',
            style: const TextStyle(color: Color(0xFFDBEAFE), fontSize: 14, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 2),
          Text(
            '남은 거리 ${formatDistance(_nav.remainingM)} · ${_nav.remainingMinutesText} · 도착 ${_nav.etaText}',
            style: const TextStyle(color: Color(0xFFDBEAFE), fontSize: 13),
          ),
          if (error != null) ...[
            const SizedBox(height: 6),
            Text(error, style: const TextStyle(color: Color(0xFFFECACA), fontSize: 12)),
          ],
        ],
      ),
    );
  }

  Widget _mapArea() {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _slate200),
      ),
      child: Stack(
        children: [
          Positioned.fill(child: NavMapView(controller: _map)),
          if (_nav.simulating)
            Positioned(
              top: 10,
              left: 50,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: _slate800, borderRadius: BorderRadius.circular(20)),
                child: const Text('시뮬레이션 주행 중',
                    style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ),
          Positioned(
            right: 10,
            bottom: 10,
            child: FloatingActionButton.small(
              heroTag: 'driver-follow',
              backgroundColor: Colors.white,
              onPressed: () => _nav.setFollow(!_nav.follow),
              tooltip: _nav.follow ? '전체 경로 보기' : '내 위치 따라가기',
              child: Icon(_nav.follow ? Icons.zoom_out_map : Icons.navigation, color: _blue),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBar() {
    final acc = _nav.accuracy;
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(
        '서버 ${_nav.socketConnected ? '연결됨' : '연결 안 됨'} · 위치 전송 ${_nav.sentCount}회'
        '${acc == null ? '' : ' · GPS 정확도 ±${acc.round()}m'}',
        style: const TextStyle(fontSize: 12, color: _slate500),
      ),
    );
  }
}
