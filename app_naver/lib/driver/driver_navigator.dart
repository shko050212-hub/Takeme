import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';

import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../widgets/naver_map_controller.dart';
import 'geo.dart';

enum RouteMode { safe, fast }

extension RouteModeInfo on RouteMode {
  String get key => this == RouteMode.fast ? 'fast' : 'safe';
  String get title => this == RouteMode.fast ? '최단길 기준' : '큰길 기준';
  String get subTitle => this == RouteMode.fast ? '최단 시간 우선' : '대로 우선 · 유턴 회피';
  String get criteria => this == RouteMode.fast ? '최단 시간 우선' : '큰길 및 대로 우선 · 유턴 회피';
  RouteMode get other => this == RouteMode.fast ? RouteMode.safe : RouteMode.fast;
}

class NavException implements Exception {
  final String message;
  NavException(this.message);
  @override
  String toString() => message;
}

class NavStop {
  final String name;
  final GeoPoint point;
  final bool isTest;
  bool passed = false;
  int pathIndex = 0;
  NavStop(this.name, this.point, {this.isTest = false});
}

class NavGuide {
  final GeoPoint point;
  final String text;
  int pathIndex = 0;
  bool saidFar = false;
  bool saidNear = false;
  NavGuide(this.point, this.text);
}

class RoutePlan {
  final RouteMode mode;
  final GeoPoint origin;
  final List<GeoPoint> path;
  final List<double> cum;
  final List<NavGuide> guides;
  final double distanceM;
  final double durationS;
  final int turnCount;
  final String criteriaFromServer;
  final DateTime createdAt;

  RoutePlan({
    required this.mode,
    required this.origin,
    required this.path,
    required this.cum,
    required this.guides,
    required this.distanceM,
    required this.durationS,
    required this.turnCount,
    required this.criteriaFromServer,
  }) : createdAt = DateTime.now();

  double get avgSpeed => durationS > 0 ? math.max(2, distanceM / durationS) : 8;
  String get minutesText => '${(durationS / 60).ceil()}분';
}

enum PlanStatus { idle, loading, ready, error }

class PlanSlot {
  PlanStatus status = PlanStatus.idle;
  RoutePlan? plan;
  String? error;
}

class DriverNavigator extends ChangeNotifier {
  DriverNavigator(this.map);

  final NaverMapController map;
  final FlutterTts _tts = FlutterTts();

  // 노선 및 기본 정보
  bool loading = true;
  int? vehicleId;
  String vehicleName = '';
  GeoPoint? academy;
  String destinationName = '';
  GeoPoint? destination;
  bool pickOnMapMode = false;
  final List<NavStop> stops = [];
  String? loadError;

  // 경로 비교
  RouteMode mode = RouteMode.safe;
  final Map<RouteMode, PlanSlot> slots = {
    RouteMode.safe: PlanSlot(),
    RouteMode.fast: PlanSlot(),
  };
  int _previewSeq = 0;

  // 운행 상태
  bool driving = false;
  bool serverLive = false;
  bool testMode = false;
  bool busy = false;
  bool rerouting = false;
  RoutePlan? active;
  String? routeWarning;
  String? actionError;
  final List<NavStop> _testStops = [];
  int _progress = 0;

  // 위치 및 GPS
  GeoPoint? position;
  double? accuracy;
  String? gpsError;
  bool follow = true;
  int sentCount = 0;
  DateTime? lastSentAt;
  StreamSubscription<Position>? _gpsSub;

  // 시뮬레이션
  bool simulating = false;
  bool simSendToServer = false;
  double simSpeedMultiplier = 1.0;
  Timer? _simTimer;
  double _simMeters = 0;

  List<NavStop> get activeStops => testMode ? _testStops : stops;
  bool get socketConnected => SocketService().isConnected;

  int get totalDestinationsCount => activeStops.length + (destination != null ? 1 : 0);

  List<NavStop> get allDestinationsInOrder {
    final list = <NavStop>[...activeStops];
    if (destination != null) {
      list.add(NavStop(destinationName, destination!));
    }
    return list;
  }

  String get stopsSummaryText {
    if (destination == null && activeStops.isEmpty) return '미설정';
    final names = activeStops.map((s) => s.name).toList();
    if (destinationName.isNotEmpty) names.add(destinationName);
    return names.join(' → ');
  }

  NavStop? get nextStop {
    for (final s in activeStops) {
      if (!s.passed) return s;
    }
    return null;
  }

  int get passedCount => activeStops.where((s) => s.passed).length;

  double get remainingM {
    final a = active;
    if (a == null) return 0;
    final i = math.min(math.max(_progress, 0), a.cum.length - 1);
    return math.max(0, a.cum.last - a.cum[i]);
  }

  double? get nextStopDistance {
    final s = nextStop;
    final a = active;
    if (s == null || position == null) return null;
    if (a != null && s.pathIndex >= _progress) return a.cum[s.pathIndex] - a.cum[_progress];
    return distanceM(position!, s.point);
  }

  String get etaText {
    final a = active;
    if (a == null) return '-';
    final t = DateTime.now().add(Duration(seconds: (remainingM / a.avgSpeed).round()));
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  String get remainingMinutesText {
    final a = active;
    return a == null ? '-' : '${(remainingM / a.avgSpeed / 60).ceil()}분';
  }

  (double, String)? get nextTurn {
    final a = active;
    if (a == null) return null;
    for (final g in a.guides) {
      if (g.pathIndex > _progress) return (a.cum[g.pathIndex] - a.cum[_progress], g.text);
    }
    return null;
  }

  // 초기화
  Future<void> init() async {
    try {
      try {
        await _tts.setLanguage('ko-KR');
        await _tts.setSpeechRate(0.5);
      } catch (_) {}

      final user = ApiService().currentUser;
      final isDemo = ApiService().isDemo || (user != null && user.email.toLowerCase().contains('demo'));

      // demo 계정이 아닌 정식 로그인 기사일 때만 백엔드 배정 차량 및 노선 조회
      if (user != null && !isDemo) {
        SocketService().connect(ApiService().token);
        try {
          final v = await ApiService().getDriverVehicle(user.email);
          if (v != null) {
            vehicleId = int.tryParse(v.id);
            vehicleName = v.model;
          }

          final route = await ApiService().getDriverRoute(user.email);
          if (route != null) {
            vehicleId ??= route.vehicleId;
            if (route.academyLat != null && route.academyLng != null) {
              academy = GeoPoint(route.academyLat!, route.academyLng!);
            }
            stops
              ..clear()
              ..addAll(route.stops.map((s) => NavStop(s.name, s.point)));
          }
        } catch (e) {
          debugPrint('[DriverNav] Route load warning: $e');
        }
      } else {
        _loadDemoRoute();
      }

      // 기본 목적지 초기화: 사용자가 목적지를 설정하기 전까지 비워둡니다.
      destination = null;
      destinationName = '';
      academy = null;

      // 지도 클릭 시 목적지 설정 콜백 연결
      map.onMapClick = (p) {
        if (pickOnMapMode) {
          if (destination != null) {
            addWaypoint('지정한 위치 (${totalDestinationsCount + 1}차)', p);
          } else {
            setDestination('지도에서 지정한 위치', p);
          }
          pickOnMapMode = false;
        }
      };

      loading = false;
      notifyListeners();

      _startGps();
      await previewRoutes();
    } catch (e) {
      debugPrint('[DriverNav] init general error: $e');
      loading = false;
      notifyListeners();
    }
  }

  /// 목적지 새로 설정하기 (단독 설정)
  Future<void> setDestination(String name, GeoPoint point) async {
    destinationName = name;
    destination = point;
    academy = point;
    stops.clear();
    notifyListeners();

    _speak('$name(으)로 목적지를 설정했습니다.');
    await previewRoutes();
    if (position != null) {
      map.centerOn(position!, zoom: 15);
    }
  }

  /// 경유지 / 추가 목적지 경로에 추가하기 (다중 목적지 지원)
  Future<void> addWaypoint(String name, GeoPoint point, {bool asFinal = true}) async {
    if (destination == null) {
      await setDestination(name, point);
      return;
    }

    if (asFinal) {
      // 기존 최종 목적지를 경유지 목록으로 이전하고 새 위치를 최종 목적지로 지정
      stops.add(NavStop(destinationName, destination!));
      destinationName = name;
      destination = point;
      academy = point;
    } else {
      // 기존 최종 목적지 앞의 경유지로 삽입
      stops.add(NavStop(name, point));
    }

    notifyListeners();
    _speak('$name(이)가 경로에 추가되었습니다. 총 $totalDestinationsCount개 목적지입니다.');
    await previewRoutes();
    if (position != null) {
      map.centerOn(position!, zoom: 15);
    }
  }

  /// 특정 순서의 목적지/경유지 삭제
  Future<void> removeDestinationAt(int index) async {
    if (index < 0 || index >= totalDestinationsCount) return;

    if (index < stops.length) {
      // 경유지 목록에서 삭제
      stops.removeAt(index);
    } else {
      // 최종 목적지 삭제 -> stops의 마지막 항목이 새로운 최종 목적지가 됨
      if (stops.isNotEmpty) {
        final newLast = stops.removeLast();
        destinationName = newLast.name;
        destination = newLast.point;
        academy = newLast.point;
      } else {
        clearDestination();
        return;
      }
    }

    notifyListeners();
    _speak('목적지가 삭제되었습니다.');
    await previewRoutes();
  }

  /// 목적지 순서 변경
  Future<void> reorderDestinations(int oldIndex, int newIndex) async {
    final all = allDestinationsInOrder;
    if (oldIndex < 0 || oldIndex >= all.length || newIndex < 0 || newIndex > all.length) return;
    if (oldIndex < newIndex) newIndex -= 1;
    final item = all.removeAt(oldIndex);
    all.insert(newIndex, item);

    final newFinal = all.removeLast();
    destinationName = newFinal.name;
    destination = newFinal.point;
    academy = newFinal.point;
    stops.clear();
    stops.addAll(all);

    notifyListeners();
    await previewRoutes();
  }

  /// 목적지 전체 초기화 (경유지 포함)
  void clearDestination() {
    destinationName = '';
    destination = null;
    academy = null;
    stops.clear();
    for (final s in slots.values) {
      s.status = PlanStatus.idle;
      s.plan = null;
      s.error = null;
    }
    map.clearRoutes();
    _drawPreview();
    notifyListeners();
    _speak('모든 목적지가 초기화되었습니다.');
  }

  /// 지도에서 직접 목적지 핀 찍기 모드 토글
  void togglePickOnMapMode() {
    pickOnMapMode = !pickOnMapMode;
    notifyListeners();
  }

  /// 현재 브라우저/기기의 실제 GPS 위치로 갱신하기
  Future<void> refreshCurrentGps() async {
    try {
      final pos = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 4),
      );
      final p = GeoPoint(pos.latitude, pos.longitude);
      gpsError = null;
      _onPosition(p, acc: pos.accuracy);
      map.setMyLocation(p);
      map.centerOn(p, zoom: 16);
      if (destination != null) {
        await previewRoutes();
      }
    } catch (e) {
      debugPrint('[DriverNav] refreshCurrentGps warning: $e');
    }
  }

  void _loadDemoRoute() {
    vehicleName = '1호차 (12가 3456)';
    vehicleId = 1;
    destination = null;
    destinationName = '';
    academy = null;
    stops.clear();
  }

  Future<void> _startGps() async {
    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        gpsError = '위치 권한이 차단되었습니다. 브라우저/기기 설정에서 허용해주세요.';
        notifyListeners();
        return;
      }
    } catch (e) {
      debugPrint('[DriverNav] GPS permission check warning: $e');
    }

    try {
      _gpsSub?.cancel();
      _gpsSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          distanceFilter: 2,
        ),
      ).listen(
        (pos) {
          gpsError = null;
          final p = GeoPoint(pos.latitude, pos.longitude);
          // 모의 주행(가상 시뮬레이션) 중이 아닐 때 실제 센서 GPS 좌표로 지도 및 차량 위치 갱신
          if (!simulating) {
            _onPosition(p, acc: pos.accuracy);
          }
        },
        onError: (e) {
          debugPrint('[DriverNav] GPS stream error: $e');
          gpsError = 'GPS 수신 대기 중';
          notifyListeners();
        },
      );

      // Web 및 기기 초기 위치 즉시 획득
      Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 4),
      ).then((pos) {
        gpsError = null;
        final p = GeoPoint(pos.latitude, pos.longitude);
        if (!simulating) {
          _onPosition(p, acc: pos.accuracy);
          if (!driving) {
            map.setMyLocation(p);
            map.centerOn(p, zoom: 16);
          }
        }
      }).catchError((e) {
        debugPrint('[DriverNav] initial getCurrentPosition warning: $e');
        if (position == null) {
          const defP = GeoPoint(37.5665, 126.9780);
          _onPosition(defP);
        }
      });
    } catch (e) {
      debugPrint('[DriverNav] GPS stream init error: $e');
      gpsError = 'GPS 수신 대기 중';
      if (position == null) {
        _onPosition(const GeoPoint(37.5665, 126.9780));
      }
      notifyListeners();
    }
  }

  Future<void> selectMode(RouteMode m) async {
    if (mode == m) return;
    mode = m;
    notifyListeners();
    if (driving) {
      await _reroute(reason: '모드 변경');
    } else {
      _drawPreview();
    }
  }

  Future<void> previewRoutes() async {
    if (driving) return;
    if (destination == null && academy == null) {
      for (final s in slots.values) {
        s.status = PlanStatus.idle;
        s.plan = null;
        s.error = null;
      }
      map.clearRoutes();
      _drawPreview();
      notifyListeners();
      return;
    }

    final origin = position ?? (stops.isNotEmpty ? stops.first.point : academy ?? const GeoPoint(37.5665, 126.9780));

    final seq = ++_previewSeq;
    for (final s in slots.values) {
      s.status = PlanStatus.loading;
      s.error = null;
    }
    notifyListeners();

    for (final m in RouteMode.values) {
      try {
        final plan = await _fetchPlan(m, origin);
        if (_previewSeq != seq) return;
        slots[m]!.status = PlanStatus.ready;
        slots[m]!.plan = plan;
      } catch (e) {
        if (_previewSeq != seq) return;
        slots[m]!.status = PlanStatus.error;
        slots[m]!.error = e.toString();
      }
    }
    _drawPreview();
    notifyListeners();
  }

  Future<RoutePlan> _fetchPlan(RouteMode m, GeoPoint origin) async {
    final GeoPoint dest;
    final List<Map<String, dynamic>> waypoints;
    if (destination != null) {
      dest = destination!;
      waypoints = stops.take(30).map((s) => s.point.toJson()).toList();
    } else if (academy != null) {
      dest = academy!;
      waypoints = stops.take(30).map((s) => s.point.toJson()).toList();
    } else if (stops.isNotEmpty) {
      dest = stops.last.point;
      waypoints = stops.take(stops.length - 1).map((s) => s.point.toJson()).toList();
    } else {
      throw NavException('목적지가 설정되지 않았습니다.');
    }
    try {
      final res = await ApiService().getDirections(
        origin: origin.toJson(),
        destination: dest.toJson(),
        waypoints: waypoints,
        mode: m.key,
      );

      final path = [
        for (final p in (res['path'] as List? ?? []))
          GeoPoint(toDouble(p['lat']) ?? 0.0, toDouble(p['lng']) ?? 0.0),
      ];

      if (path.length < 2) throw NavException('경로 포인트가 충분하지 않습니다.');
      final cum = cumulativeDistances(path);

      final guides = <NavGuide>[];
      var from = 0;
      for (final g in (res['guides'] as List? ?? [])) {
        final lat = toDouble(g['lat']);
        final lng = toDouble(g['lng']);
        final text = '${g['guidance'] ?? ''}'.trim();
        if (lat == null || lng == null || text.isEmpty) continue;
        final guide = NavGuide(GeoPoint(lat, lng), text);
        guide.pathIndex = nearestIndex(path, guide.point, from: from);
        from = guide.pathIndex;
        guides.add(guide);
      }

      return RoutePlan(
        mode: m,
        origin: origin,
        path: path,
        cum: cum,
        guides: guides,
        distanceM: toDouble(res['distance']) ?? cum.last,
        durationS: toDouble(res['duration']) ?? cum.last / 8,
        turnCount: (res['turnCount'] as num?)?.toInt() ?? guides.length,
        criteriaFromServer: m.title,
      );
    } catch (e) {
      debugPrint('[DriverNav] _fetchPlan fail for ${m.key}: $e, fallback to synthetic');
      return _generateFallbackPlan(m, origin);
    }
  }

  RoutePlan _generateFallbackPlan(RouteMode m, GeoPoint origin) {
    final dest = destination ?? academy;
    final pts = <GeoPoint>[origin];
    for (final s in stops) {
      pts.add(s.point);
    }
    if (dest != null) {
      pts.add(dest);
    } else {
      pts.add(GeoPoint(origin.lat + 0.01, origin.lng + 0.01));
    }

    final isFast = m == RouteMode.fast;
    final finePath = <GeoPoint>[];
    for (var i = 0; i < pts.length - 1; i++) {
      final a = pts[i];
      final b = pts[i + 1];
      const steps = 15;
      for (var s = 0; s < steps; s++) {
        final t = s / steps;
        // 큰길 기준은 주요 도로를 경유하는 곡선 우회 가미
        final latOffset = isFast ? 0.0 : math.sin(t * math.pi) * 0.0006;
        final lngOffset = isFast ? 0.0 : math.sin(t * math.pi) * 0.0008;
        finePath.add(GeoPoint(
          a.lat + (b.lat - a.lat) * t + latOffset,
          a.lng + (b.lng - a.lng) * t + lngOffset,
        ));
      }
    }
    finePath.add(pts.last);

    final cum = cumulativeDistances(finePath);
    // 큰길 기준: 약 18% 우회 거리, 평균 30km/h (8.3 m/s)
    // 최단길 기준: 최단 직행, 평균 42km/h (11.6 m/s)
    final distanceM = cum.last * (isFast ? 1.0 : 1.18);
    final durationS = isFast ? (distanceM / 11.6) : (distanceM / 8.3);

    final guides = <NavGuide>[];
    for (var i = 0; i < stops.length; i++) {
      final g = NavGuide(stops[i].point, '${i + 1}차 경유지: ${stops[i].name} 도착 예정');
      g.pathIndex = nearestIndex(finePath, stops[i].point);
      guides.add(g);
    }
    if (dest != null) {
      final g = NavGuide(dest, '최종 목적지: $destinationName 도착 예정');
      g.pathIndex = finePath.length - 1;
      guides.add(g);
    }

    return RoutePlan(
      mode: m,
      origin: origin,
      path: finePath,
      cum: cum,
      guides: guides,
      distanceM: distanceM,
      durationS: durationS,
      turnCount: stops.length + (isFast ? 4 : 8),
      criteriaFromServer: m.criteria,
    );
  }

  void _drawPreview() {
    final cur = slots[mode]?.plan;
    final other = slots[mode.other]?.plan;

    map.setRoutes(
      primary: cur?.path,
      alternate: other?.path,
      stops: activeStops.map((s) => {
        'lat': s.point.lat,
        'lng': s.point.lng,
        'name': s.name,
        'test': s.isTest,
        'passed': s.passed,
      }).toList(),
      academy: destination ?? academy,
      destinationName: destinationName,
      fit: (destination != null || academy != null || activeStops.isNotEmpty),
    );
  }

  Future<void> startDrive({bool test = false}) async {
    debugPrint('[DriverNav] startDrive invoked (testMode=$test)');
    if (destination == null && academy == null) {
      actionError = '목적지를 먼저 설정해주세요.';
      notifyListeners();
      return;
    }

    busy = true;
    actionError = null;
    notifyListeners();

    try {
      // 1. 유효한 현재 GPS 위치 확보
      final currentLoc = position ?? const GeoPoint(37.5665, 126.9780);
      position = currentLoc;

      // 2. 주행 상태 즉시 활성화
      driving = true;
      testMode = test;
      serverLive = !test;
      sentCount = 0;
      follow = true;

      // 3. 지도에 내 위치 & 버스 마커 즉시 표시하고 카메라 줌인
      map.setMyLocation(currentLoc);
      map.moveBus(currentLoc, follow: true);
      map.centerOn(currentLoc, zoom: 17);

      // 4. 경로 플랜 활성화 (준비된 플랜이 있으면 활성화, 없으면 즉시 fallback 플랜 생성)
      var ready = slots[mode]?.plan;
      if (ready == null || ready.path.isEmpty) {
        ready = _generateFallbackPlan(mode, currentLoc);
        slots[mode]!.plan = ready;
        slots[mode]!.status = PlanStatus.ready;
      }
      _activate(ready);

      // 5. 모의 주행 테스트(PC 자동 주행)일 때만 가상 시뮬레이터 실행!
      // 실제 운행(test == false)은 스마트폰/브라우저 기기의 실제 GPS 센서 스트림으로만 실시간 위치를 추적합니다.
      if (test) {
        startSimulation();
      } else {
        stopSimulation();
      }

      // 6. 위치 전달 및 음성 안내
      _onPosition(currentLoc);
      if (test) {
        _speak('모의 주행 테스트를 시작합니다.');
      } else {
        _speak('운행을 시작합니다. 사용자 GPS를 기반으로 실시간 안내합니다.');
      }

      // 7. GPS 최신 위치 비동기 확인
      refreshCurrentGps();

      if (serverLive && vehicleId != null && SocketService().isConnected) {
        SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: true);
      }
    } catch (e, st) {
      debugPrint('[DriverNav] startDrive error: $e\n$st');
      actionError = e.toString();
    } finally {
      busy = false;
      notifyListeners();
    }
  }

  Future<void> stop() async {
    busy = true;
    notifyListeners();
    stopSimulation();

    if (serverLive) {
      await ApiService().endOperation();
      if (vehicleId != null) {
        SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: false);
      }
    }

    _resetDriving();
    busy = false;
    notifyListeners();
    _speak('운행이 종료되었습니다. 수고하셨습니다.');

    for (final s in activeStops) {
      s.passed = false;
    }
    if (position != null) map.setMyLocation(position!);
    await previewRoutes();
  }

  void _resetDriving() {
    driving = false;
    serverLive = false;
    active = null;
    rerouting = false;
    routeWarning = null;
    map.hideBus();
  }

  void _activate(RoutePlan p) {
    active = p;
    _progress = 0;

    for (final s in activeStops) {
      s.pathIndex = nearestIndex(p.path, s.point);
    }
    for (final g in p.guides) {
      g.pathIndex = nearestIndex(p.path, g.point);
      g.saidFar = false;
      g.saidNear = false;
    }

    map.setRoutes(
      primary: p.path,
      stops: activeStops.map((s) => {
        'lat': s.point.lat,
        'lng': s.point.lng,
        'name': s.name,
        'test': s.isTest,
        'passed': s.passed,
      }).toList(),
      academy: destination ?? academy,
      destinationName: destinationName,
      fit: false,
    );
  }

  Future<void> _reroute({required String reason}) async {
    if (rerouting) return;
    rerouting = true;
    notifyListeners();

    final origin = position ?? (stops.isNotEmpty ? stops.first.point : academy ?? const GeoPoint(37.5665, 126.9780));
    try {
      final p = await _fetchPlan(mode, origin);
      _activate(p);
      routeWarning = null;
    } catch (e) {
      routeWarning = '경로 재탐색 실패: $e';
    } finally {
      rerouting = false;
      notifyListeners();
    }
  }

  void _onPosition(GeoPoint p, {double? acc, bool simulated = false}) {
    position = p;
    if (acc != null) accuracy = acc;

    if (!driving) {
      map.setMyLocation(p);
      notifyListeners();
      return;
    }

    map.moveBus(p, follow: follow);

    if (serverLive && vehicleId != null && SocketService().isConnected) {
      SocketService().sendLocationUpdate(vehicleId: vehicleId!, lat: p.lat, lng: p.lng);
      sentCount++;
      lastSentAt = DateTime.now();
    }

    _checkProgressAndArrival(p);
    notifyListeners();
  }

  void _checkProgressAndArrival(GeoPoint p) {
    final a = active;
    if (a == null) return;

    _progress = nearestIndex(a.path, p, from: _progress);

    for (var i = 0; i < activeStops.length; i++) {
      final s = activeStops[i];
      if (s.passed) continue;
      final d = distanceM(p, s.point);
      if (d <= 35) {
        s.passed = true;
        map.markStopPassed(i);
        final next = nextStop;
        if (next != null) {
          _speak('${s.name}에 도착했습니다. 다음 목적지 ${next.name}(으)로 이동합니다.');
        } else if (destinationName.isNotEmpty) {
          _speak('${s.name}에 도착했습니다. 최종 목적지 $destinationName(으)로 이동합니다.');
        } else {
          _speak('${s.name}에 도착했습니다.');
        }
        break;
      }
    }

    if (destination != null && activeStops.every((s) => s.passed)) {
      final destDist = distanceM(p, destination!);
      if (destDist <= 40) {
        _speak('최종 목적지 $destinationName에 도착했습니다. 모든 운행을 완료했습니다.');
      }
    }
  }

  // 주행 시뮬레이션
  void startSimulation() {
    if (active == null) {
      if (slots[mode]?.plan != null) {
        _activate(slots[mode]!.plan!);
      } else {
        return;
      }
    }
    simulating = true;
    _simMeters = 0;
    _simTimer?.cancel();

    _simTimer = Timer.periodic(const Duration(milliseconds: 300), (_) {
      final a = active;
      if (a == null) return;
      _simMeters += (8 * simSpeedMultiplier * 0.3);

      if (_simMeters >= a.cum.last) {
        stopSimulation();
        _speak('목적지에 도착했습니다.');
        return;
      }

      final p = pointAlong(a.path, a.cum, _simMeters);
      _onPosition(p, simulated: true);
    });
    notifyListeners();
  }

  void stopSimulation() {
    _simTimer?.cancel();
    _simTimer = null;
    simulating = false;
    notifyListeners();
  }

  void setSimSpeed(double mult) {
    simSpeedMultiplier = mult;
    notifyListeners();
  }

  void setFollow(bool v) {
    follow = v;
    if (v && position != null) {
      if (driving) {
        map.moveBus(position!, follow: true);
      } else {
        map.centerOn(position!);
      }
    } else {
      map.fitAll();
    }
    notifyListeners();
  }

  void centerOnMe() {
    if (position == null) return;
    if (driving) {
      setFollow(true);
      map.centerOn(position!, zoom: 17);
    } else {
      map.centerOn(position!, zoom: 17);
    }
  }

  void _speak(String text) {
    try {
      _tts.speak(text).catchError((_) {});
    } catch (_) {}
  }

  @override
  void dispose() {
    _simTimer?.cancel();
    _gpsSub?.cancel();
    map.dispose();
    super.dispose();
  }
}
