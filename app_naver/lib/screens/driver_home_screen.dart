import 'dart:async';

import 'package:flutter/material.dart';
import '../config.dart';
import '../driver/driver_navigator.dart';
import '../driver/geo.dart';
import '../services/api_service.dart';
import '../services/destination_service.dart';
import '../widgets/naver_map_view.dart';
import 'destination_search_screen.dart';
import 'driver_login_screen.dart';
import 'driver_settings_screen.dart';

class DriverHomeScreen extends StatefulWidget {
  const DriverHomeScreen({super.key});

  @override
  State<DriverHomeScreen> createState() => _DriverHomeScreenState();
}

class _DriverHomeScreenState extends State<DriverHomeScreen> {
  late final NaverMapController _map;
  late final DriverNavigator _nav;
  Timer? _ticker;
  bool _confirmingStop = false;
  Timer? _confirmStopTimer;

  @override
  void initState() {
    super.initState();
    _map = NaverMapView.createController();
    _nav = DriverNavigator(_map)..init();

    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _confirmStopTimer?.cancel();
    _nav.dispose();
    super.dispose();
  }

  Future<void> _handleStopDrive() async {
    if (!_confirmingStop) {
      setState(() => _confirmingStop = true);
      _confirmStopTimer?.cancel();
      _confirmStopTimer = Timer(const Duration(seconds: 4), () {
        if (mounted) setState(() => _confirmingStop = false);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('운행을 종료하려면 [한 번 더 터치]하세요.'),
          backgroundColor: AppColors.dangerRed,
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    _confirmStopTimer?.cancel();
    _confirmingStop = false;
    await _nav.stop();
    if (mounted) {
      setState(() {});
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('운행이 정상적으로 종료되었습니다. (위치 전송 중단)'),
          backgroundColor: AppColors.slate900,
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  void _showStopListSheet() async {
    _map.setVisible(false);
    try {
      await showModalBottomSheet(
        context: context,
        backgroundColor: Colors.transparent,
        builder: (ctx) {
          return Container(
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: AppColors.slate300,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('전체 정류장 목록', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                    Text('${_nav.passedCount} / ${_nav.activeStops.length} 통과',
                        style: const TextStyle(fontWeight: FontWeight.w600, color: AppColors.naverGreenDark)),
                  ],
                ),
                const SizedBox(height: 12),
                Flexible(
                  child: ListView.separated(
                    shrinkWrap: true,
                    itemCount: _nav.activeStops.length,
                    separatorBuilder: (context, index) => const Divider(height: 1),
                    itemBuilder: (_, idx) {
                      final stop = _nav.activeStops[idx];
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          radius: 14,
                          backgroundColor: stop.passed ? AppColors.slate300 : AppColors.naverGreen,
                          child: Text(
                            '${idx + 1}',
                            style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                          ),
                        ),
                        title: Text(
                          stop.name,
                          style: TextStyle(
                            fontWeight: FontWeight.w600,
                            fontSize: 14,
                            decoration: stop.passed ? TextDecoration.lineThrough : null,
                            color: stop.passed ? AppColors.slate500 : AppColors.slate800,
                          ),
                        ),
                        trailing: stop.passed
                            ? const Text('[통과]', style: TextStyle(color: AppColors.slate500, fontSize: 12))
                            : const Text('[예정]', style: TextStyle(color: AppColors.naverGreenDark, fontSize: 12, fontWeight: FontWeight.bold)),
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      );
    } finally {
      _map.setVisible(true);
    }
  }

  void _openSettings() async {
    _map.setVisible(false);
    try {
      await Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => const DriverSettingsScreen()),
      );
    } finally {
      _map.setVisible(true);
      if (mounted) setState(() {});
    }
  }

  void _openDestinationSearch(BuildContext context) async {
    _map.setVisible(false);
    try {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => DestinationSearchScreen(
            nav: _nav,
            map: _map,
          ),
        ),
      );
    } finally {
      _map.setVisible(true);
      if (mounted) setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _nav,
      builder: (context, _) {
        final screenWidth = MediaQuery.of(context).size.width;
        final isWideScreen = screenWidth > 640;

        Widget content = Scaffold(
          backgroundColor: const Color(0xFFF1F5F9),
          appBar: _buildAppBar(),
          body: SafeArea(
            child: Column(
              children: [
                // 1. 상단 내비게이션 안내 카드
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
                  child: _buildTopNavCard(),
                ),

                // 2. 중앙 네이버 지도 (iframe은 이 독립된 영역에만 국한되어 하단 패널 클릭 방해 불가)
                Expanded(
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.1),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: NaverMapView(controller: _map),
                  ),
                ),

                // 3. 지도 조작 툴바 (내 위치, 전체 경로 보기, 배속)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 6, 16, 4),
                  child: _buildMapControlBar(),
                ),

                // 4. 하단 운행 컨트롤 패널 (경로 선택 카드, 운행 시작 버튼 등 - 지도와 절대 겹치지 않음)
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 2, 12, 12),
                  child: _buildBottomPanel(),
                ),
              ],
            ),
          ),
        );

        // PC 와이드 화면 지원 (가운데 폰/태블릿 프레임)
        if (isWideScreen) {
          return Scaffold(
            backgroundColor: const Color(0xFF0B0F19),
            body: Center(
              child: Container(
                width: 480,
                margin: const EdgeInsets.symmetric(vertical: 16),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(24),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.5),
                      blurRadius: 30,
                      spreadRadius: 2,
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: content,
              ),
            ),
          );
        }

        return content;
      },
    );
  }

  PreferredSizeWidget _buildAppBar() {
    final user = ApiService().currentUser;
    return AppBar(
      backgroundColor: Colors.white,
      foregroundColor: AppColors.slate800,
      elevation: 1,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.naverGreenLight,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: const Text('네이버 지도', style: TextStyle(color: AppColors.naverGreenDark, fontSize: 10, fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 6),
              Text(
                _nav.vehicleName.isNotEmpty ? _nav.vehicleName : '셔틀 차량',
                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15),
              ),
            ],
          ),
          if (user != null)
            Text(
              '${user.name} 기사님 (${user.academyName ?? "유치원"})',
              style: const TextStyle(fontSize: 11, color: AppColors.slate500),
            ),
        ],
      ),
      actions: [
        IconButton(
          icon: const Icon(Icons.list_alt, size: 22),
          tooltip: '정류장 목록',
          onPressed: _showStopListSheet,
        ),
        IconButton(
          icon: const Icon(Icons.settings_outlined, size: 22),
          tooltip: '설정',
          onPressed: _openSettings,
        ),
        IconButton(
          icon: const Icon(Icons.logout, size: 20),
          tooltip: '로그아웃',
          onPressed: () async {
            await ApiService().logout();
            if (mounted) {
              Navigator.of(context).pushReplacement(
                MaterialPageRoute(builder: (_) => const DriverLoginScreen()),
              );
            }
          },
        ),
      ],
    );
  }

  Widget _buildTopNavCard() {
    final next = _nav.nextStop;
    final nextTurn = _nav.nextTurn;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          // 다음 정류장 안내 행
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: _nav.driving ? AppColors.naverGreen : AppColors.primaryBlue,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Center(
                  child: Text(
                    _nav.driving ? '다음' : '대기',
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      next?.name ??
                          (_nav.driving
                              ? '목적지로 이동 중'
                              : (_nav.destinationName.isNotEmpty ? _nav.destinationName : '목적지를 설정해주세요')),
                      style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: AppColors.slate900),
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      nextTurn != null
                          ? '${formatDistance(nextTurn.$1)} 앞 ${nextTurn.$2}'
                          : (_nav.nextStopDistance != null
                              ? '다음 정류장까지 ${formatDistance(_nav.nextStopDistance!)}'
                              : (_nav.destination != null ? '출발 준비 완료' : '상단 또는 아래에서 목적지를 설정하세요')),
                      style: const TextStyle(fontSize: 12, color: AppColors.slate600, fontWeight: FontWeight.w500),
                    ),
                  ],
                ),
              ),
              // 운행 상태 뱃지
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: !_nav.driving
                      ? AppColors.slate100
                      : (_nav.testMode || _nav.simulating ? AppColors.warningOrangeBg : AppColors.naverGreenLight),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (_nav.driving && !_nav.simulating) ...[
                      Container(
                        width: 7,
                        height: 7,
                        decoration: const BoxDecoration(
                          color: AppColors.naverGreenDark,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      !_nav.driving
                          ? '대기 중'
                          : (_nav.testMode || _nav.simulating ? '모의 주행 중' : '실시간 GPS 추적 중'),
                      style: TextStyle(
                        color: !_nav.driving
                            ? AppColors.slate600
                            : (_nav.testMode || _nav.simulating ? AppColors.warningOrange : AppColors.naverGreenDark),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (_nav.driving) ...[
            const SizedBox(height: 10),
            const Divider(height: 1),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildInfoItem('남은 거리', formatDistance(_nav.remainingM)),
                _buildInfoItem('도착 예정', _nav.etaText),
                _buildInfoItem('정류장 통과', '${_nav.passedCount}/${_nav.activeStops.length}'),
              ],
            ),
          ],
          // 목적지 설정 바
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(
              color: AppColors.slate50,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: AppColors.slate200),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.flag,
                  size: 16,
                  color: _nav.destination != null ? AppColors.dangerRed : AppColors.slate500,
                ),
                const SizedBox(width: 6),
                const Text(
                  '목적지: ',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.slate600),
                ),
                Expanded(
                  child: Text(
                    _nav.destinationName.isNotEmpty ? _nav.destinationName : '미설정 (목적지를 설정해주세요)',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: _nav.destinationName.isNotEmpty ? AppColors.slate900 : AppColors.dangerRed,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (!_nav.driving) ...[
                  const SizedBox(width: 4),
                  OutlinedButton.icon(
                    onPressed: () {
                      if (_nav.destination == null) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('이미 목적지가 초기화(미설정)되어 있습니다.'),
                            duration: Duration(seconds: 1),
                          ),
                        );
                      } else {
                        _nav.clearDestination();
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('목적지가 초기화되었습니다.'),
                            backgroundColor: AppColors.slate800,
                            duration: Duration(seconds: 1),
                          ),
                        );
                      }
                    },
                    icon: Icon(
                      Icons.refresh,
                      size: 13,
                      color: _nav.destination != null ? AppColors.dangerRed : AppColors.slate600,
                    ),
                    label: Text(
                      '초기화',
                      style: TextStyle(
                        color: _nav.destination != null ? AppColors.dangerRed : AppColors.slate600,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    style: OutlinedButton.styleFrom(
                      backgroundColor: _nav.destination != null ? AppColors.dangerRedBg : AppColors.slate100,
                      side: BorderSide(
                        color: _nav.destination != null
                            ? AppColors.dangerRed.withValues(alpha: 0.4)
                            : AppColors.slate300,
                      ),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      minimumSize: const Size(0, 36),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                    ),
                  ),
                  const SizedBox(width: 6),
                  ElevatedButton.icon(
                    onPressed: () => _openDestinationSearch(context),
                    icon: const Icon(Icons.search, size: 14, color: Colors.white),
                    label: Text(
                      _nav.destination != null ? '변경' : '목적지 설정',
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _nav.destination != null ? AppColors.primaryBlue : AppColors.naverGreen,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      minimumSize: const Size(0, 36),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                    ),
                  ),
                ],
              ],
            ),
          ),
          if (_nav.pickOnMapMode) ...[
            const SizedBox(height: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: AppColors.warningOrangeBg,
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Row(
                children: [
                  Icon(Icons.touch_app, size: 14, color: AppColors.warningOrange),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      '지도의 원하는 곳을 클릭하면 목적지로 지정됩니다.',
                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: AppColors.warningOrange),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildInfoItem(String label, String value) {
    return Column(
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: AppColors.slate500)),
        const SizedBox(height: 2),
        Text(value, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: AppColors.slate800)),
      ],
    );
  }

  Widget _buildMapControlBar() {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: [
          _buildToolBtn(
            icon: Icons.my_location,
            label: '내 위치',
            onTap: _nav.centerOnMe,
            color: AppColors.naverGreenDark,
          ),
          const SizedBox(width: 8),
          _buildToolBtn(
            icon: Icons.gps_fixed,
            label: 'GPS 갱신',
            onTap: _nav.refreshCurrentGps,
            color: AppColors.primaryBlue,
          ),
          const SizedBox(width: 8),
          _buildToolBtn(
            icon: Icons.crop_free,
            label: '전체 경로',
            onTap: () => _nav.setFollow(false),
            color: AppColors.slate700,
          ),
          const SizedBox(width: 8),
          if (!_nav.driving) ...[
            _buildToolBtn(
              icon: Icons.flag_outlined,
              label: _nav.destination != null ? '목적지 변경' : '목적지 설정',
              onTap: () => _openDestinationSearch(context),
              color: AppColors.primaryBlue,
              bgColor: AppColors.primaryBlueBg,
            ),
            const SizedBox(width: 8),
            _buildToolBtn(
              icon: Icons.refresh,
              label: '목적지 초기화',
              onTap: () {
                if (_nav.destination == null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('이미 목적지가 초기화(미설정)되어 있습니다.'),
                      duration: Duration(seconds: 1),
                    ),
                  );
                } else {
                  _nav.clearDestination();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('목적지가 초기화되었습니다.'),
                      backgroundColor: AppColors.slate800,
                      duration: Duration(seconds: 1),
                    ),
                  );
                }
              },
              color: _nav.destination != null ? AppColors.dangerRed : AppColors.slate600,
              bgColor: _nav.destination != null ? AppColors.dangerRedBg : AppColors.slate100,
            ),
          ],
          if (_nav.simulating || _nav.testMode) ...[
            const SizedBox(width: 8),
            _buildToolBtn(
              icon: Icons.speed,
              label: '배속 ${_nav.simSpeedMultiplier.toInt()}x',
              onTap: () {
                final nextSpeed = _nav.simSpeedMultiplier == 1.0
                    ? 2.0
                    : (_nav.simSpeedMultiplier == 2.0 ? 5.0 : 1.0);
                _nav.setSimSpeed(nextSpeed);
              },
              color: AppColors.warningOrange,
              bgColor: AppColors.warningOrangeBg,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildToolBtn({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    required Color color,
    Color bgColor = Colors.white,
  }) {
    return SizedBox(
      height: 40,
      child: OutlinedButton.icon(
        onPressed: onTap,
        icon: Icon(icon, size: 16, color: color),
        label: Text(
          label,
          style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: color),
        ),
        style: OutlinedButton.styleFrom(
          backgroundColor: bgColor,
          foregroundColor: color,
          side: BorderSide(color: color.withValues(alpha: 0.35)),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 0),
          minimumSize: const Size(0, 40),
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          elevation: 0,
        ),
      ),
    );
  }

  Widget _buildBottomPanel() {
    if (_nav.driving) {
      // 운행 중 화면
      return Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.15),
              blurRadius: 16,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (!_nav.simulating) ...[
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                margin: const EdgeInsets.only(bottom: 10),
                decoration: BoxDecoration(
                  color: AppColors.naverGreenLight,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: AppColors.naverGreen.withValues(alpha: 0.3)),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.gps_fixed, size: 16, color: AppColors.naverGreenDark),
                    SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        '실시간 GPS 수신 중: 실제 이동 경로에 따라 지도가 실시간으로 추적됩니다.',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.naverGreenDark),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            Row(
              children: [
                if (_nav.simulating) ...[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {
                        if (_nav.simulating) {
                          _nav.stopSimulation();
                        } else {
                          _nav.startSimulation();
                        }
                      },
                      icon: Icon(
                        _nav.simulating ? Icons.pause : Icons.play_arrow,
                        size: 18,
                        color: AppColors.primaryBlue,
                      ),
                      label: Text(
                        _nav.simulating ? '시뮬레이션 일시정지' : '모의주행 계속',
                        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.primaryBlue),
                      ),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        side: const BorderSide(color: AppColors.primaryBlue),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                ] else ...[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _nav.centerOnMe,
                      icon: const Icon(Icons.my_location, size: 18, color: AppColors.primaryBlue),
                      label: const Text(
                        '내 위치로 맞춤',
                        style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.primaryBlue),
                      ),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        side: const BorderSide(color: AppColors.primaryBlue),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                    ),
                  ),
                  const SizedBox(width: 10),
                ],
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: _handleStopDrive,
                    onLongPress: () async {
                      _confirmStopTimer?.cancel();
                      _confirmingStop = false;
                      await _nav.stop();
                      if (mounted) {
                        setState(() {});
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('운행이 즉시 종료되었습니다.'),
                            backgroundColor: AppColors.slate900,
                            duration: Duration(seconds: 2),
                          ),
                        );
                      }
                    },
                    icon: Icon(
                      _confirmingStop ? Icons.warning_amber_rounded : Icons.stop_circle_outlined,
                      size: 20,
                      color: Colors.white,
                    ),
                    label: Text(
                      _confirmingStop ? '한 번 더 터치 (종료)' : '운행 종료',
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.white),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: _confirmingStop ? const Color(0xFFB91C1C) : AppColors.dangerRed,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 13),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      elevation: _confirmingStop ? 4 : 0,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      );
    }

    // 운행 전 화면 (경로 선택 및 운행 시작)
    final safeSlot = _nav.slots[RouteMode.safe]?.plan;
    final fastSlot = _nav.slots[RouteMode.fast]?.plan;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // 목적지 상태 및 목적지 초기화 바
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            margin: const EdgeInsets.only(bottom: 10),
            decoration: BoxDecoration(
              color: _nav.destination != null ? AppColors.dangerRedBg.withValues(alpha: 0.2) : AppColors.slate50,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: _nav.destination != null
                    ? AppColors.dangerRed.withValues(alpha: 0.25)
                    : AppColors.slate200,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  Icons.place,
                  size: 15,
                  color: _nav.destination != null ? AppColors.dangerRed : AppColors.slate500,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _nav.destination != null
                        ? '선택된 목적지: ${_nav.destinationName}'
                        : '현재 목적지: 미설정 상태',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                      color: _nav.destination != null ? AppColors.slate900 : AppColors.slate600,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                ElevatedButton.icon(
                  onPressed: () => _openDestinationSearch(context),
                  icon: const Icon(Icons.search, size: 14, color: Colors.white),
                  label: Text(
                    _nav.destination != null ? '변경' : '목적지 설정',
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.white),
                  ),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: _nav.destination != null ? AppColors.primaryBlue : AppColors.naverGreen,
                    foregroundColor: Colors.white,
                    elevation: 0,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    minimumSize: const Size(0, 36),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                  ),
                ),
                const SizedBox(width: 6),
                OutlinedButton.icon(
                  onPressed: () {
                    if (_nav.destination == null) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('이미 목적지가 초기화(미설정)되어 있습니다.'),
                          duration: Duration(seconds: 1),
                        ),
                      );
                    } else {
                      _nav.clearDestination();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('목적지가 초기화되었습니다.'),
                          backgroundColor: AppColors.slate800,
                          duration: Duration(seconds: 1),
                        ),
                      );
                    }
                  },
                  icon: Icon(
                    Icons.refresh,
                    size: 13,
                    color: _nav.destination != null ? AppColors.dangerRed : AppColors.slate600,
                  ),
                  label: const Text(
                    '목적지 초기화',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: _nav.destination != null ? AppColors.dangerRed : AppColors.slate600,
                    backgroundColor: _nav.destination != null ? AppColors.dangerRedBg : AppColors.slate100,
                    side: BorderSide(
                      color: _nav.destination != null
                          ? AppColors.dangerRed.withValues(alpha: 0.4)
                          : AppColors.slate300,
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    minimumSize: const Size(0, 36),
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
                  ),
                ),
              ],
            ),
          ),

          // 걸리는 시간 2종류: 큰길 기준 vs 최단길 기준 선택 카드
          Row(
            children: [
              Expanded(
                child: _buildRouteOptionTab(
                  mode: RouteMode.safe,
                  title: '큰길 기준',
                  criteria: '대로 우선 · 유턴 회피',
                  plan: safeSlot,
                  isSelected: _nav.mode == RouteMode.safe,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _buildRouteOptionTab(
                  mode: RouteMode.fast,
                  title: '최단길 기준',
                  criteria: '최단 시간 우선',
                  plan: fastSlot,
                  isSelected: _nav.mode == RouteMode.fast,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),

          // 큰 운행 시작 버튼 (실제 GPS 기반 추적)
          SizedBox(
            width: double.infinity,
            height: 52,
            child: ElevatedButton.icon(
              onPressed: () {
                if (_nav.busy) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('경로를 계산 중입니다. 잠시만 기다려주세요.'),
                      duration: Duration(seconds: 1),
                    ),
                  );
                  return;
                }
                if (_nav.destination == null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('목적지를 먼저 설정해주세요.'),
                      backgroundColor: AppColors.dangerRed,
                      duration: Duration(seconds: 2),
                    ),
                  );
                  _openDestinationSearch(context);
                  return;
                }
                _nav.startDrive(test: false);
              },
              icon: const Icon(Icons.navigation, color: Colors.white),
              label: const Text('운행 시작 (실제 GPS 추적)', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Colors.white)),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.naverGreen,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                elevation: 0,
              ),
            ),
          ),
          const SizedBox(height: 8),

          // 모의 주행 (PC 테스트용)
          SizedBox(
            width: double.infinity,
            height: 42,
            child: OutlinedButton.icon(
              onPressed: () async {
                if (_nav.busy) return;
                if (_nav.destination == null) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('목적지를 먼저 설정해주세요.'),
                      backgroundColor: AppColors.dangerRed,
                      duration: Duration(seconds: 2),
                    ),
                  );
                  _openDestinationSearch(context);
                  return;
                }
                await _nav.startDrive(test: true);
                _nav.startSimulation();
              },
              icon: const Icon(Icons.play_circle_outline, size: 18, color: AppColors.slate700),
              label: const Text(
                '모의 주행 테스트 (PC 가상 자동 이동)',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.slate700),
              ),
              style: OutlinedButton.styleFrom(
                backgroundColor: Colors.white,
                side: const BorderSide(color: AppColors.slate300),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteOptionTab({
    required RouteMode mode,
    required String title,
    required String criteria,
    required RoutePlan? plan,
    required bool isSelected,
  }) {
    return Material(
      color: isSelected ? AppColors.naverGreenLight : AppColors.slate50,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: () => _nav.selectMode(mode),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(
              color: isSelected ? AppColors.naverGreen : AppColors.slate200,
              width: isSelected ? 2 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: isSelected ? AppColors.naverGreenDark : AppColors.slate800,
                    ),
                  ),
                  if (isSelected)
                    const Icon(Icons.check_circle, size: 16, color: AppColors.naverGreenDark),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                _nav.destination != null
                    ? (plan != null ? plan.minutesText : '계산 중...')
                    : '미설정',
                style: TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 18,
                  color: isSelected ? AppColors.naverGreenDark : AppColors.slate900,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                _nav.destination != null
                    ? (plan != null ? '${formatDistance(plan.distanceM)} · $criteria' : criteria)
                    : '목적지 설정 시 소요시간 안내',
                style: const TextStyle(fontSize: 11, color: AppColors.slate500, fontWeight: FontWeight.w500),
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
