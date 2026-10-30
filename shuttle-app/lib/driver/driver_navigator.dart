import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';

import '../config.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../widgets/nav_map_view.dart';
import 'geo.dart';

/// 경로 모드. 서버 /directions 가 카카오 길찾기에 실제로 보내는 기준:
/// - safe: priority=RECOMMEND + avoid=[uturn]  (추천 경로 + 유턴 회피)
/// - fast: priority=TIME                        (최단 시간)
/// 카카오 API 에는 도로 위험도 정보가 없으므로, '안전'은 이 두 기준까지만 의미한다.
enum RouteMode { safe, fast }

extension RouteModeInfo on RouteMode {
  String get key => this == RouteMode.fast ? 'fast' : 'safe';
  String get title => this == RouteMode.fast ? '빠른 경로' : '안전 경로';
  String get criteria => this == RouteMode.fast ? '최단 시간 우선' : '추천 도로 · 유턴 회피';
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
  final bool isTest; // 테스트 경로용 가짜 정류장 (서버·학부모에게 보내지 않음)
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

/// 서버에서 받은 경로 하나
class RoutePlan {
  final RouteMode mode;
  final GeoPoint origin;
  final List<GeoPoint> path;
  final List<double> cum;
  final List<NavGuide> guides;
  final double distanceM;
  final double durationS;
  final int turnCount;
  final List<TrafficSegment> traffic; // 교통 상황 색 표시용
  final String criteriaFromServer; // 서버가 실제로 적용했다고 알려준 기준 (검증용)
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
    required this.traffic,
    required this.criteriaFromServer,
  }) : createdAt = DateTime.now();

  double get avgSpeed => durationS > 0 ? math.max(2, distanceM / durationS) : 8;
  String get minutesText => '${(durationS / 60).ceil()}분';
  String get kmText => '${(distanceM / 1000).toStringAsFixed(1)}km';
  String get etaClockText {
    final t = DateTime.now().add(Duration(seconds: durationS.round()));
    final ampm = t.hour < 12 ? '오전' : '오후';
    final h12 = t.hour % 12 == 0 ? 12 : t.hour % 12;
    return '$ampm $h12:${t.minute.toString().padLeft(2, '0')} 도착 예정';
  }
}

enum PlanStatus { idle, loading, ready, error }

class PlanSlot {
  PlanStatus status = PlanStatus.idle;
  RoutePlan? plan;
  String? error;
}

class _RouteInput {
  final List<NavStop> waypoints;
  final GeoPoint destination;
  _RouteInput(this.waypoints, this.destination);
}

/// 기사 앱의 운행·내비게이션 상태
class DriverNavigator extends ChangeNotifier {
  DriverNavigator(this.map) {
    map.onUserDrag = () {
      if (follow) {
        follow = false;
        notifyListeners();
      }
    };
  }

  final NavMapController map;
  final FlutterTts _tts = FlutterTts();

  // ── 불러온 정보 ──
  bool loading = true;
  int? vehicleId;
  String vehicleName = '';
  GeoPoint? academy;
  final List<NavStop> stops = [];
  String? loadError;

  // ── 경로 비교 (운행 전) ──
  bool routePreviewing = false; // '경로 탐색' 버튼을 눌러 안전/빠른 경로를 비교·선택 중인 화면 여부
  RouteMode mode = RouteMode.safe;
  final Map<RouteMode, PlanSlot> slots = {RouteMode.safe: PlanSlot(), RouteMode.fast: PlanSlot()};
  int _previewSeq = 0;

  // ── 운행 ──
  bool driving = false; // 길 안내 중 (실제 운행 또는 테스트)
  bool serverLive = false; // 실제 운행 (서버에 운행 시작을 알림, 위치 전송)
  bool testMode = false; // 테스트 경로 (서버에 아무것도 보내지 않음)
  bool busy = false;
  bool rerouting = false;
  RoutePlan? active; // 지금 안내 중인 경로
  String? routeWarning; // 재탐색 실패 등
  String? actionError;
  final List<NavStop> _testStops = [];
  int _routeSeq = 0;
  int _progress = 0;
  int _offRouteCount = 0;
  DateTime _lastReroute = DateTime.fromMillisecondsSinceEpoch(0);

  // ── 위치 ──
  GeoPoint? position;
  double? accuracy;
  double? heading; // 진행 방향 (화살표 회전)
  String? gpsError;
  bool follow = true;
  int sentCount = 0;
  DateTime? lastSentAt;
  StreamSubscription<Position>? _gpsSub;

  // ── 시뮬레이션 ──
  bool simulating = false;
  bool simSendToServer = false; // 학부모 화면 테스트용 (기본 꺼짐: 실제 도착 알림이 갈 수 있음)
  Timer? _simTimer;
  double _simMeters = 0;
  int _offRouteTestTicks = 0;

  List<NavStop> get activeStops => testMode ? _testStops : stops;
  bool get socketConnected => SocketService().isConnected;

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

  String get remainingKmText => '${(remainingM / 1000).toStringAsFixed(1)}km';

  String get etaText {
    final a = active;
    if (a == null) return '-';
    final t = DateTime.now().add(Duration(seconds: (remainingM / a.avgSpeed).round()));
    final ampm = t.hour < 12 ? '오전' : '오후';
    final h12 = t.hour % 12 == 0 ? 12 : t.hour % 12;
    return '$ampm $h12:${t.minute.toString().padLeft(2, '0')} 도착 예정';
  }

  String get remainingMinutesText {
    final a = active;
    return a == null ? '-' : '${(remainingM / a.avgSpeed / 60).ceil()}분';
  }

  /// 다음 회전 안내 (거리, 문구)
  (double, String)? get nextTurn {
    final a = active;
    if (a == null) return null;
    for (final g in a.guides) {
      if (g.pathIndex > _progress) return (a.cum[g.pathIndex] - a.cum[_progress], g.text);
    }
    return null;
  }

  /// 운행 전 화면에 보여줄 데이터 문제 안내
  String? get setupNotice {
    if (loadError != null) return loadError;
    if (vehicleId == null) return '배정된 차량이 없습니다. 원장님께 차량 배정을 요청하세요.';
    if (academy == null && stops.isEmpty) return '유치원 위치와 정류장 정보가 없어 경로를 계산할 수 없습니다.';
    if (stops.isEmpty && position != null && academy != null && distanceM(position!, academy!) < 60) {
      return '현재 위치가 목적지(유치원)와 거의 같습니다. 원장 웹에서 탑승지를 추가하거나 유치원 위치를 변경해 주세요.';
    }
    if (stops.isEmpty) return '오늘 배정된 정류장이 없습니다. 유치원까지의 경로만 표시합니다. (관리자 웹에서 원아·탑승지를 추가하세요)';
    if (academy == null) return '유치원 위치가 없어 마지막 정류장을 도착지로 사용합니다.';
    return null;
  }

  // ───────────── 서버 요청 (팀 앱 ApiService: 토큰 자동 갱신 포함) ─────────────

  Future<dynamic> _post(String path, [Map<String, dynamic>? body]) async {
    final res = await ApiService().postWithAuth(Uri.parse('${AppConfig.apiHost}$path'), body ?? {});
    final text = utf8.decode(res.bodyBytes);
    dynamic data;
    try {
      data = text.isEmpty ? null : jsonDecode(text);
    } catch (_) {
      data = null;
    }
    if (res.statusCode >= 400) {
      final msg = data is Map ? data['message'] : null;
      throw NavException(msg is List ? msg.join(', ') : (msg?.toString() ?? '요청 실패 (${res.statusCode})'));
    }
    return data;
  }

  /// 서버에서 배정 차량·유치원·정류장(원아+탑승지) 목록을 새로 불러와 경로를 갱신한다.
  Future<void> refreshRouteFromServer({bool speak = false}) async {
    final user = ApiService().currentUser;
    if (user == null) return;
    try {
      final v = await ApiService().getTeacherVehicle(user.email);
      if (v != null) {
        vehicleId = int.tryParse('${v['id']}');
        vehicleName = '${v['name'] ?? ''}';
      }
      final route = await ApiService().getTeacherRoute(user.email);
      if (route != null) {
        vehicleId ??= route.vehicleId;
        if (route.academyLat != null && route.academyLng != null) {
          academy = GeoPoint(route.academyLat!, route.academyLng!);
        }
        final passedNames = stops.where((s) => s.passed).map((s) => s.name).toSet();
        stops
          ..clear()
          ..addAll(route.stops.map((s) {
            final stop = NavStop(s.name, GeoPoint(s.latitude, s.longitude));
            stop.passed = passedNames.contains(s.name);
            return stop;
          }));
      }
      loadError = null;
      notifyListeners();
      if (driving && !testMode) {
        if (speak) _speak('변경된 탑승지를 반영하여 경로를 다시 안내합니다.');
        await _reroute(reason: 'route-updated', fit: true);
      } else if (!driving) {
        if (speak) _speak('노선과 탑승지 정보를 새로고침했습니다.');
        await previewRoutes();
      }
    } catch (e) {
      loadError = '정보를 불러오지 못했습니다: $e';
      notifyListeners();
    }
  }

  // ───────────── 초기화 ─────────────

  Future<void> init() async {
    try {
      await _tts.setLanguage('ko-KR');
      await _tts.setSpeechRate(0.45); // 조금 천천히
    } catch (_) {}

    final user = ApiService().currentUser;
    if (user != null) {
      SocketService().connect(ApiService().token);
      try {
        final v = await ApiService().getTeacherVehicle(user.email);
        if (v != null) {
          vehicleId = int.tryParse('${v['id']}');
          vehicleName = '${v['name'] ?? ''}';
        }
        final route = await ApiService().getTeacherRoute(user.email);
        if (route != null) {
          vehicleId ??= route.vehicleId;
          if (route.academyLat != null && route.academyLng != null) {
            academy = GeoPoint(route.academyLat!, route.academyLng!);
          }
          stops
            ..clear()
            ..addAll(route.stops.map((s) => NavStop(s.name, GeoPoint(s.latitude, s.longitude))));
        }
        if (vehicleId != null) SocketService().joinVehicleRoom(vehicleId!);
      } catch (e) {
        loadError = '정보를 불러오지 못했습니다: $e';
      }
    }
    loading = false;
    _drawPreview();
    notifyListeners();

    await _startLocation(); // 첫 위치가 잡히면 경로 비교를 시작
    if (position == null) await previewRoutes(); // GPS 가 없어도 유치원 기준으로 비교
  }

  // ───────────── 위치 (운행 전부터 내 위치 표시) ─────────────

  Future<void> _startLocation() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        gpsError = '휴대폰 위치(GPS)가 꺼져 있습니다';
        notifyListeners();
        return;
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
        gpsError = '위치 권한이 없습니다 (설정에서 허용)';
        notifyListeners();
        return;
      }
      gpsError = null;
      try {
        final first = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 8),
          ),
        );
        _onPosition(GeoPoint(first.latitude, first.longitude), acc: first.accuracy, gpsHeading: first.heading);
        if (!routePreviewing) {
          map.centerOn(position!, zoom: 15);
        }
        await previewRoutes();
      } catch (e) {
        gpsError = '실내 또는 GPS 신호 약함';
        debugPrint('[nav] initial position timeout/error: $e');
        notifyListeners();
      }

      _gpsSub?.cancel();
      _gpsSub = Geolocator.getPositionStream(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.bestForNavigation, distanceFilter: 3),
      ).listen(
        (p) {
          gpsError = null;
          // 시뮬레이션·테스트 경로 중에는 실제 GPS 로 버스를 움직이지 않음
          if (!simulating && !testMode) {
            final hadPosition = position != null;
            // 움직일 때만 GPS 방향을 믿음 (정지 중에는 방향 값이 흔들림)
            _onPosition(GeoPoint(p.latitude, p.longitude),
                acc: p.accuracy, gpsHeading: p.speed > 1 ? p.heading : null);
            if (!hadPosition && !driving) {
              if (!routePreviewing) {
                map.centerOn(position!, zoom: 15);
              }
              previewRoutes();
            }
          }
        },
        onError: (e) {
          gpsError = 'GPS 오류: $e';
          notifyListeners();
        },
      );
    } catch (e) {
      gpsError = '위치를 가져오지 못했습니다';
      debugPrint('[nav] location error: $e');
      notifyListeners();
    }
  }

  // ───────────── 경로 계산 ─────────────

  _RouteInput? _inputFor(List<NavStop> list) {
    final remaining = list.where((s) => !s.passed).toList();
    if (academy != null) return _RouteInput(remaining, academy!);
    if (remaining.isEmpty) return null;
    return _RouteInput(remaining.sublist(0, remaining.length - 1), remaining.last.point);
  }

  Future<RoutePlan> _fetchPlan(RouteMode m, GeoPoint origin, _RouteInput input) async {
    // 출발지와 도착지가 거의 같고 경유지가 있는 경우(유치원 출발 -> 탑승지 경유 -> 유치원 복귀),
    // 카카오 API가 출발·도착 동일 좌표 오류를 내지 않도록 출발지를 약 20m 보정한다.
    var effectiveOrigin = origin;
    if (input.waypoints.isNotEmpty && distanceM(origin, input.destination) < 25) {
      effectiveOrigin = GeoPoint(origin.lat + 0.0002, origin.lng + 0.0002);
    }
    // Nginx proxy_pass ('/directions/') 리다이렉트 시 POST 가 GET 으로 바뀌는 문제 방지
    final raw = await _post('/directions/', {
      'origin': effectiveOrigin.toJson(),
      'destination': input.destination.toJson(),
      'waypoints': input.waypoints.take(30).map((s) => s.point.toJson()).toList(),
      'mode': m.key,
    });
    if (raw is! Map<String, dynamic>) {
      throw NavException('경로 서버 응답 형식이 올바르지 않습니다.');
    }
    final r = raw;

    final path = [
      for (final p in (r['path'] as List? ?? [])) GeoPoint(toDouble(p['lat']) ?? 0, toDouble(p['lng']) ?? 0),
    ];
    if (path.length < 2) throw NavException('경로를 찾지 못했습니다.');
    final cum = cumulativeDistances(path);

    final guides = <NavGuide>[];
    var from = 0;
    for (final g in (r['guides'] as List? ?? [])) {
      final lat = toDouble(g['lat']);
      final lng = toDouble(g['lng']);
      final text = '${g['guidance'] ?? ''}'.trim();
      final type = (g['type'] as num?)?.toInt();
      if (lat == null || lng == null || text.isEmpty) continue;
      if (type == 100) continue; // '출발지' 안내는 생략
      final guide = NavGuide(GeoPoint(lat, lng), text);
      guide.pathIndex = nearestIndex(path, guide.point, from: from);
      from = guide.pathIndex;
      guides.add(guide);
    }

    final c = r['criteria'];
    final criteria = c is Map
        ? 'priority=${c['priority']}, avoid=${(c['avoid'] as List?)?.join(',') ?? '-'}'
        : '서버가 기준을 알려주지 않음 (서버 업데이트 필요)';
    final traffic = <TrafficSegment>[
      for (final t in (r['traffic'] as List? ?? []))
        TrafficSegment((t['from'] as num).toInt(), (t['to'] as num).toInt(), (t['state'] as num?)?.toInt() ?? 0),
    ];
    final plan = RoutePlan(
      mode: m,
      origin: origin,
      path: path,
      cum: cum,
      guides: guides,
      distanceM: toDouble(r['distance']) ?? cum.last,
      durationS: toDouble(r['duration']) ?? cum.last / 8,
      turnCount: (r['turnCount'] as num?)?.toInt() ?? guides.length,
      traffic: traffic,
      criteriaFromServer: criteria,
    );
    debugPrint('[nav] ${m.key}: ${plan.distanceM.round()}m ${plan.durationS.round()}s '
        'turns=${plan.turnCount} points=${path.length} ($criteria)');
    return plan;
  }

  /// 운행 전: 안전·빠른 경로를 같은 출발지·경유지·도착지로 동시에 계산
  Future<void> previewRoutes() async {
    if (driving) return;
    final input = _inputFor(stops);
    final origin = position ?? academy;
    if (input == null || origin == null) {
      _drawPreview();
      notifyListeners();
      return;
    }
    final seq = ++_previewSeq;
    for (final s in slots.values) {
      s.status = PlanStatus.loading;
      s.error = null;
    }
    notifyListeners();

    await Future.wait(RouteMode.values.map((m) async {
      try {
        final plan = await _fetchPlan(m, origin, input);
        if (seq != _previewSeq) return; // 더 최근 요청이 있으면 버림 (응답 역전 방지)
        slots[m]!
          ..plan = plan
          ..status = PlanStatus.ready
          ..error = null;
      } catch (e) {
        if (seq != _previewSeq) return;
        slots[m]!
          ..plan = null // 실패한 모드에 예전 경로를 남겨 두지 않음
          ..status = PlanStatus.error
          ..error = e.toString();
      }
    }));
    if (seq != _previewSeq) return;

    final a = slots[RouteMode.safe]!.plan;
    final b = slots[RouteMode.fast]!.plan;
    if (a != null && b != null) {
      final same = a.distanceM.round() == b.distanceM.round() && a.path.length == b.path.length;
      debugPrint('[nav] 비교: safe ${a.distanceM.round()}m/${a.durationS.round()}s, '
          'fast ${b.distanceM.round()}m/${b.durationS.round()}s → ${same ? '같은 경로' : '다른 경로'}');
    }
    _drawPreview();
    notifyListeners();
  }

  /// '경로 탐색' 버튼 클릭 시: 안전 경로를 기본 선택하고 전체 경로가 한눈에 보이도록 지도를 축소·비교
  Future<void> openRoutePreview() async {
    actionError = null;
    mode = RouteMode.safe;
    routePreviewing = true;
    map.resetZoom();
    _drawPreview();
    notifyListeners();
    if (position == null) {
      await _startLocation();
    }
    await previewRoutes();
    map.fitAll();
  }

  /// 경로 탐색 화면에서 이전 준비 화면으로 돌아가기
  void closeRoutePreview() {
    routePreviewing = false;
    actionError = null;
    _drawPreview();
    if (position != null) {
      map.centerOn(position!, zoom: 15);
    }
    notifyListeners();
  }

  void _drawPreview() {
    if (driving) return;
    if (!routePreviewing) {
      map.setRoutes(
        stops: _stopsJson(stops),
        academy: academy,
        fit: position == null,
      );
      return;
    }
    map.resetZoom();
    map.setRoutes(
      primary: slots[mode]!.plan?.path,
      traffic: slots[mode]!.plan?.traffic,
      alternate: slots[mode.other]!.plan?.path,
      stops: _stopsJson(stops),
      academy: academy,
      fit: true,
    );
  }

  List<Map<String, dynamic>> _stopsJson(List<NavStop> list) => [
        for (final s in list) {'lat': s.point.lat, 'lng': s.point.lng, 'passed': s.passed, 'test': s.isTest},
      ];

  /// 경로 모드 선택
  Future<void> selectMode(RouteMode m) async {
    if (mode == m) return;
    mode = m;
    notifyListeners();
    if (!driving) {
      if (slots[m]!.status == PlanStatus.error || slots[m]!.status == PlanStatus.idle) {
        await previewRoutes();
      } else {
        _drawPreview();
      }
      return;
    }
    _speak('${m.title}로 다시 안내합니다.');
    await _reroute(reason: 'mode');
  }

  /// 운행 중 재탐색 (최근 요청만 반영, 실패하면 이전 경로를 유지하고 경고 표시)
  Future<void> _reroute({required String reason, bool fit = false}) async {
    final pos = position;
    final input = _inputFor(activeStops);
    if (pos == null || input == null) return;
    final seq = ++_routeSeq;
    rerouting = true;
    notifyListeners();
    try {
      final plan = await _fetchPlan(mode, pos, input);
      if (seq != _routeSeq) return;
      _activate(plan, fit: fit);
      routeWarning = null;
    } catch (e) {
      if (seq != _routeSeq) return;
      routeWarning = active == null
          ? '경로를 가져오지 못했습니다: $e'
          : '경로 갱신 실패 ($e) · 이전 ${active!.mode.title}로 안내 중';
      debugPrint('[nav] reroute($reason) failed: $e');
    } finally {
      if (seq == _routeSeq) {
        rerouting = false;
        notifyListeners();
      }
    }
  }

  void _activate(RoutePlan plan, {bool fit = false}) {
    active = plan;
    var from = 0;
    for (final s in activeStops.where((s) => !s.passed)) {
      s.pathIndex = nearestIndex(plan.path, s.point, from: from);
      from = s.pathIndex;
    }
    _progress = 0;
    _offRouteCount = 0;
    _simMeters = 0;
    if (fit) map.resetZoom();
    map.setRoutes(
        primary: plan.path, traffic: plan.traffic, stops: _stopsJson(activeStops), academy: academy, fit: fit);
    _updateProgress();
  }

  // ───────────── 실제 운행 ─────────────

  Future<void> start() async {
    if (vehicleId == null) {
      actionError = '배정된 차량이 없습니다.';
      notifyListeners();
      return;
    }
    busy = true;
    actionError = null;
    notifyListeners();
    try {
      if (position == null) await _startLocation();
      if (position == null) throw NavException(gpsError ?? '현재 위치를 확인할 수 없습니다.');
      await _post('/teacher/start-operation');
      routePreviewing = false;
      driving = true;
      serverLive = true;
      testMode = false;
      sentCount = 0;
      follow = true;
      SocketService().connect(ApiService().token);
      SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: true);

      // 경로 탐색 화면에서 선택한 경로가 지금 위치 근처에서 출발하면 그대로 사용하고, 아니면 새로 탐색
      final ready = slots[mode]!.plan;
      if (ready != null &&
          distanceM(ready.origin, position!) < 150 &&
          DateTime.now().difference(ready.createdAt).inMinutes < 10) {
        _activate(ready, fit: true);
      } else {
        await _reroute(reason: 'start', fit: true);
      }
      _onPosition(position!, acc: accuracy);
      _speak('운행을 시작합니다. ${mode.title}로 안내합니다. 오늘도 안전 운행 부탁드립니다.');
    } catch (e) {
      actionError = e.toString();
    }
    busy = false;
    notifyListeners();
  }

  Future<void> stop() async {
    busy = true;
    notifyListeners();
    _stopSimulation();
    if (serverLive) {
      try {
        await _post('/teacher/end-operation');
      } catch (_) {}
      if (vehicleId != null) SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: false);
    }
    _resetDriving();
    busy = false;
    notifyListeners();
    _speak(testMode ? '테스트를 종료합니다.' : '운행이 종료되었습니다. 수고하셨습니다.');
    testMode = false;
    _testStops.clear();
    for (final s in stops) {
      s.passed = false;
    }
    if (position != null) {
      map.moveMe(position!, heading: heading);
      map.centerOn(position!, zoom: 15);
    }
    await previewRoutes();
  }

  void _resetDriving() {
    driving = false;
    routePreviewing = false;
    serverLive = false;
    active = null;
    rerouting = false;
    routeWarning = null;
    _routeSeq++;
    map.resetZoom();
  }

  void setFollow(bool v) {
    follow = v;
    if (v && position != null) {
      if (driving) {
        map.moveMe(position!, heading: heading, follow: true, navigating: true);
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
    } else {
      map.centerOn(position!);
    }
  }

  // ───────────── 위치 처리 ─────────────

  void _onPosition(GeoPoint p, {double? acc, double? gpsHeading, bool simulated = false}) {
    final prev = position;
    position = p;
    if (acc != null) accuracy = acc;
    // 진행 방향: GPS 방향이 있으면 사용, 없으면 이전 위치에서 계산 (2m 이상 움직였을 때)
    if (gpsHeading != null && gpsHeading >= 0) {
      heading = gpsHeading;
    } else if (prev != null && distanceM(prev, p) > 2) {
      heading = bearingDeg(prev, p);
    }

    if (!driving) {
      map.moveMe(p, heading: heading);
      notifyListeners();
      return;
    }

    map.moveMe(p, heading: heading, follow: follow, navigating: true);
    final mayLeaveDevice = serverLive && !testMode && (!simulated || simSendToServer);
    if (mayLeaveDevice && vehicleId != null && SocketService().isConnected) {
      SocketService().sendLocationUpdate(vehicleId: vehicleId!, lat: p.lat, lng: p.lng);
      sentCount++;
      lastSentAt = DateTime.now();
    }
    _checkStopArrival(p);
    _updateProgress();
    notifyListeners();
  }

  void _checkStopArrival(GeoPoint p) {
    final list = activeStops;
    for (var i = 0; i < list.length; i++) {
      final s = list[i];
      if (s.passed) continue;
      if (distanceM(p, s.point) < 40) {
        s.passed = true;
        map.markStopPassed(i);
        final next = nextStop;
        _speak('${s.name} 정류장에 도착했습니다.${next == null ? ' 유치원으로 복귀합니다.' : ' 다음은 ${next.name} 정류장입니다.'}');
      }
      break; // 다음 정류장 하나만 확인
    }
  }

  void _updateProgress() {
    final a = active;
    final pos = position;
    if (a == null || pos == null) return;

    final idx = nearestIndex(a.path, pos, from: math.max(0, _progress - 5), to: _progress + 80);
    final off = distanceM(a.path[idx], pos);
    _progress = idx;

    // 70m 이상 벗어난 상태가 3번 연속이면 재탐색 (20초에 한 번, 중복 요청 방지)
    _offRouteCount = off > 70 ? _offRouteCount + 1 : 0;
    if (_offRouteCount >= 3 && !rerouting && DateTime.now().difference(_lastReroute).inSeconds > 20) {
      _offRouteCount = 0;
      _lastReroute = DateTime.now();
      _speak('경로를 벗어났습니다. 경로를 다시 찾습니다.');
      _reroute(reason: 'off-route');
      return;
    }

    final turn = nextTurn;
    if (turn == null) return;
    final (d, text) = turn;
    NavGuide? g;
    for (final x in a.guides) {
      if (x.pathIndex > idx) {
        g = x;
        break;
      }
    }
    if (g == null) return;
    if (d <= 300 && d > 100 && !g.saidFar) {
      g.saidFar = true;
      _speak('${(d / 10).round() * 10}미터 앞에서 $text');
    } else if (d <= 60 && !g.saidNear) {
      g.saidNear = true;
      g.saidFar = true;
      _speak('곧 $text');
    }
  }

  // ───────────── 테스트 경로 & 시뮬레이션 ─────────────

  /// 테스트 경로: 유치원(없으면 내 위치) 주변에 가짜 정류장 4곳을 만들어 휴대폰 안에서만 주행
  /// 서버에 운행 시작·위치·도착 알림을 보내지 않음
  Future<void> startTestDrive() async {
    final center = academy ?? position;
    if (center == null) {
      actionError = '테스트 경로를 만들 기준 위치(유치원 또는 내 위치)가 없습니다.';
      notifyListeners();
      return;
    }
    busy = true;
    actionError = null;
    notifyListeners();
    const offsets = [(0.004, 0.003), (0.006, -0.002), (0.002, -0.005), (-0.003, -0.003)];
    _testStops
      ..clear()
      ..addAll([
        for (var i = 0; i < offsets.length; i++)
          NavStop('테스트 ${i + 1}', GeoPoint(center.lat + offsets[i].$1, center.lng + offsets[i].$2), isTest: true),
      ]);
    testMode = true;
    driving = true;
    serverLive = false;
    follow = true;
    position = center;
    await _reroute(reason: 'test');
    busy = false;
    notifyListeners();
    if (active != null) {
      _speak('테스트 경로를 시작합니다. 실제 운행이 아닙니다.');
      startSimulation();
    } else {
      testMode = false;
      _resetDriving();
      _testStops.clear();
      _drawPreview();
      notifyListeners();
    }
  }

  /// 경로를 따라 1초마다 가짜 위치 이동 (약 40km/h)
  void startSimulation() {
    if (!driving || active == null || simulating) return;
    simulating = true;
    _simMeters = active!.cum[_progress];
    _simTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final a = active;
      if (a == null) return;
      _simMeters = math.min(_simMeters + 11, a.cum.last);
      var p = pointAlong(a.path, a.cum, _simMeters);
      if (_offRouteTestTicks > 0) {
        _offRouteTestTicks--;
        p = GeoPoint(p.lat + 0.0012, p.lng); // 북쪽으로 약 130m 벗어남
      }
      _onPosition(p, simulated: true);
      if (_simMeters >= a.cum.last) _stopSimulation();
    });
    notifyListeners();
  }

  void _stopSimulation() {
    _simTimer?.cancel();
    _simTimer = null;
    simulating = false;
    _offRouteTestTicks = 0;
  }

  void stopSimulation() {
    _stopSimulation();
    notifyListeners();
  }

  /// 경로 이탈 테스트: 시뮬레이션 위치를 4초 동안 경로 밖으로 보냄 → 재탐색 확인
  void simulateOffRoute() {
    if (!simulating) return;
    _offRouteTestTicks = 4;
    _lastReroute = DateTime.fromMillisecondsSinceEpoch(0);
    notifyListeners();
  }

  void _speak(String text) {
    _tts.stop();
    _tts.speak(text);
  }

  @override
  void dispose() {
    _stopSimulation();
    _gpsSub?.cancel();
    _tts.stop();
    super.dispose();
  }
}
