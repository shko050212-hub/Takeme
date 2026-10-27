import 'package:flutter/material.dart';

import '../auth/auth_state.dart';
import '../driver/geo.dart';
import '../driver/navigation_controller.dart';
import '../theme.dart';
import '../widgets/kakao_map_view.dart';

/// 기사 앱 메인 화면 (기존 앱 TeacherDashboard 의 기사 화면과 같은 구성)
/// 상단 인사 → 운행 시작/종료 · 운행 일지 → 경로 선택 → 길 안내 → 지도
class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  late final KakaoMapController _map;
  late final DriverNavigationController _nav;

  @override
  void initState() {
    super.initState();
    _map = KakaoMapController();
    _nav = DriverNavigationController(_map)..init();
  }

  @override
  void dispose() {
    _nav.dispose();
    super.dispose();
  }

  Future<void> _confirmStop() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('운행 종료'),
        content: const Text('운행을 종료하고 위치 전송을 멈출까요?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('종료', style: TextStyle(color: AppColors.red500)),
          ),
        ],
      ),
    );
    if (ok == true) await _nav.stop();
  }

  Future<void> _onMenu(String value) async {
    switch (value) {
      case 'sim':
        _nav.toggleSimulation();
      case 'logout':
        if (_nav.operating) await _nav.stop();
        await AuthState.instance.logout();
    }
  }

  void _soon(String what) => ScaffoldMessenger.of(context)
      .showSnackBar(SnackBar(content: Text('$what은(는) 다음 단계에서 추가됩니다.')));

  @override
  Widget build(BuildContext context) {
    final user = AuthState.instance.user!;
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: ListenableBuilder(
          listenable: _nav,
          builder: (context, _) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _header(user.name),
              _operationButtons(),
              _routeModeSelector(),
              _guidePanel(),
              Expanded(child: _mapArea()),
              _statusBar(),
            ],
          ),
        ),
      ),
    );
  }

  // 상단 인사 (기존 앱 headerArea)
  Widget _header(String name) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 10, 8, 16),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$name 기사님,',
                    style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w900, color: AppColors.slate800)),
                const SizedBox(height: 4),
                Text(
                  _nav.vehicleName.isEmpty ? '오늘도 안전운행을 부탁드립니다!' : '${_nav.vehicleName} · 오늘도 안전운행을 부탁드립니다!',
                  style: const TextStyle(fontSize: 14, color: AppColors.slate500),
                ),
              ],
            ),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert, color: AppColors.slate800),
            onSelected: _onMenu,
            itemBuilder: (_) => [
              PopupMenuItem(
                value: 'sim',
                child: Text(_nav.simulating ? '주행 시뮬레이션 중지' : '주행 시뮬레이션 (테스트)'),
              ),
              const PopupMenuItem(value: 'logout', child: Text('로그아웃')),
            ],
          ),
        ],
      ),
    );
  }

  // 운행 시작/종료 + 운행 일지 (기존 앱과 같은 색·모양)
  Widget _operationButtons() {
    final on = _nav.operating;
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
      child: Row(
        children: [
          Expanded(
            child: ElevatedButton(
              onPressed: (_nav.busy || _nav.loading) ? null : (on ? _confirmStop : _nav.start),
              style: ElevatedButton.styleFrom(
                backgroundColor: on ? AppColors.red500 : AppColors.blue600,
                foregroundColor: Colors.white,
                disabledBackgroundColor: AppColors.slate300,
                padding: const EdgeInsets.symmetric(vertical: 14),
                elevation: 2,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              child: _nav.busy
                  ? const SizedBox(
                      width: 22, height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white))
                  : FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(on ? '⏹ 운행 종료 (위치 끄기)' : '▶ 운행 시작 (위치 켜기)',
                          style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 18)),
                    ),
            ),
          ),
          const SizedBox(width: 12),
          ElevatedButton.icon(
            onPressed: () => _soon('운행 일지'),
            icon: const Icon(Icons.calendar_today, size: 20),
            label: const Text('운행 일지', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.sky500,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  // 경로 선택: 안전 경로(큰길 위주) / 빠른 경로
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
              color: selected ? AppColors.blue50 : Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: selected ? AppColors.blue600 : AppColors.slate200, width: selected ? 1.5 : 1),
            ),
            child: Column(
              children: [
                Text(title,
                    style: TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 15,
                        color: selected ? AppColors.blue600 : AppColors.slate600)),
                const SizedBox(height: 2),
                Text(sub, style: const TextStyle(fontSize: 12, color: AppColors.slate500)),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 0, 24, 12),
      child: Row(
        children: [
          chip(RouteMode.safe, '안전 경로', '큰길 위주 · 유턴 회피'),
          const SizedBox(width: 10),
          chip(RouteMode.fast, '빠른 경로', '최단 시간'),
        ],
      ),
    );
  }

  // 길 안내 패널
  Widget _guidePanel() {
    if (_nav.loading) {
      return const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator()));
    }

    final error = _nav.error;
    if (!_nav.operating) {
      return Container(
        margin: const EdgeInsets.fromLTRB(24, 0, 24, 12),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.slate50,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.slate200),
        ),
        child: Text(
          error ?? '오늘 정류장 ${_nav.stops.length}곳 · 운행을 시작하면 길 안내가 시작됩니다.',
          style: TextStyle(color: error != null ? AppColors.red600 : AppColors.slate600, fontSize: 14),
        ),
      );
    }

    final next = _nav.nextStop;
    final nextDist = _nav.nextStopDistance;
    final total = _nav.stops.length;
    return Container(
      margin: const EdgeInsets.fromLTRB(24, 0, 24, 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: AppColors.blue600, borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _nav.routing ? '경로를 탐색하고 있습니다...' : (_nav.instruction.isEmpty ? '경로를 따라 주행하세요' : _nav.instruction),
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Text(
            next == null
                ? '모든 정류장을 지났습니다 · 유치원으로 복귀'
                : '다음 정류장 ${next.name} (${_nav.passedCount + 1}/$total)'
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
      decoration: const BoxDecoration(
        color: AppColors.slate100,
        border: Border(top: BorderSide(color: AppColors.slate300)),
      ),
      child: Stack(
        children: [
          Positioned.fill(child: KakaoMapView(controller: _map)),
          if (_nav.simulating)
            Positioned(
              top: 12,
              left: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(color: AppColors.slate800, borderRadius: BorderRadius.circular(20)),
                child: const Text('시뮬레이션 주행 중',
                    style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700)),
              ),
            ),
          Positioned(
            right: 12,
            bottom: 12,
            child: FloatingActionButton.small(
              heroTag: 'follow',
              backgroundColor: Colors.white,
              onPressed: () => _nav.setFollow(!_nav.follow),
              tooltip: _nav.follow ? '전체 경로 보기' : '내 위치 따라가기',
              child: Icon(_nav.follow ? Icons.zoom_out_map : Icons.navigation, color: AppColors.blue600),
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBar() {
    final acc = _nav.accuracy;
    return Container(
      color: AppColors.slate50,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Text(
        '서버 ${_nav.socketStatus} · 위치 전송 ${_nav.sentCount}회'
        '${acc == null ? '' : ' · GPS 정확도 ±${acc.round()}m'}',
        style: const TextStyle(fontSize: 12, color: AppColors.slate500),
      ),
    );
  }
}
