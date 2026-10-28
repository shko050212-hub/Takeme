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

/// safe: 큰길 위주 안전 경로 (추천 경로 + 유턴 회피), fast: 빠른 경로 (최단 시간)
enum RouteMode { safe, fast }

class NavException implements Exception {
  final String message;
  NavException(this.message);
  @override
  String toString() => message;
}

class NavStop {
  final String name;
  final GeoPoint point;
  bool passed = false;
  int pathIndex = 0;
  NavStop(this.name, this.point);
}

class _Guide {
  final GeoPoint point;
  final String text;
  int pathIndex = 0;
  bool saidFar = false;
  bool saidNear = false;
  _Guide(this.point, this.text);
}

/// 기사 앱의 운행·내비게이션 상태 관리
/// - 실제 도로 경로(카카오 길찾기 /directions), 안전/빠른 경로 선택
/// - GPS 위치를 서버로 실시간 전송 (학부모 앱·관리자 웹에서 확인)
/// - 회전·정류장 음성 안내, 경로 이탈 시 자동 재탐색
/// - 주행 시뮬레이션 (차 없이 테스트)
class DriverNavigator extends ChangeNotifier {
  DriverNavigator(this.map);

  final NavMapController map;
  final FlutterTts _tts = FlutterTts();

  bool loading = true;
  bool busy = false;
  bool routing = false;
  bool operating = false;
  bool simulating = false;
  bool follow = true;
  String? error;

  int? vehicleId;
  String vehicleName = '';
  GeoPoint? academy;
  final List<NavStop> stops = [];
  RouteMode mode = RouteMode.safe;

  GeoPoint? position;
  double? accuracy;
  int sentCount = 0;
  String instruction = '';
  double remainingM = 0;

  List<GeoPoint> _path = [];
  List<double> _cum = [];
  final List<_Guide> _guides = [];
  double _avgSpeed = 8;
  int _progress = 0;
  int _offRouteCount = 0;
  DateTime _lastReroute = DateTime.fromMillisecondsSinceEpoch(0);

  StreamSubscription<Position>? _gpsSub;
  Timer? _simTimer;
  double _simMeters = 0;

  bool get hasRoute => _path.length > 1;
  bool get socketConnected => SocketService().isConnected;

  NavStop? get nextStop {
    for (final s in stops) {
      if (!s.passed) return s;
    }
    return null;
  }

  int get passedCount => stops.where((s) => s.passed).length;

  double? get nextStopDistance {
    final s = nextStop;
    if (s == null || position == null) return null;
    if (hasRoute && s.pathIndex >= _progress) return _cum[s.pathIndex] - _cum[_progress];
    return distanceM(position!, s.point);
  }

  String get etaText {
    if (!hasRoute || remainingM <= 0) return '-';
    final t = DateTime.now().add(Duration(seconds: (remainingM / _avgSpeed).round()));
    return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  String get remainingMinutesText => hasRoute ? '약 ${(remainingM / _avgSpeed / 60).ceil()}분' : '-';

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

  // ───────────── 초기화 ─────────────

  Future<void> init() async {
    try {
      await _tts.setLanguage('ko-KR');
      await _tts.setSpeechRate(0.5);
    } catch (_) {}

    final user = ApiService().currentUser;
    if (user == null) return;
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
      if (vehicleId == null) {
        error = '배정된 차량이 없습니다. 원장님께 차량 배정을 요청하세요.';
      } else {
        SocketService().joinVehicleRoom(vehicleId!);
      }
      _drawMap();
    } catch (e) {
      error = '정보를 불러오지 못했습니다: $e';
    }
    loading = false;
    notifyListeners();
  }

  void _drawMap() {
    map.setRoute(
      path: _path,
      stops: [for (final s in stops) {'lat': s.point.lat, 'lng': s.point.lng, 'passed': s.passed}],
      academy: academy,
    );
  }

  // ───────────── 운행 시작·종료 ─────────────

  Future<void> start() async {
    if (vehicleId == null) {
      error = '배정된 차량이 없습니다.';
      notifyListeners();
      return;
    }
    busy = true;
    error = null;
    notifyListeners();
    try {
      final here = await _currentPosition();
      await _post('/teacher/start-operation');
      operating = true;
      sentCount = 0;
      SocketService().connect(ApiService().token);
      SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: true);
      _onPosition(here);
      await _requestRoute(from: here);
      _startGps();
      _speak('운행을 시작합니다. 오늘도 안전 운행 부탁드립니다.');
    } catch (e) {
      error = e.toString();
    }
    busy = false;
    notifyListeners();
  }

  Future<void> stop() async {
    busy = true;
    notifyListeners();
    _simTimer?.cancel();
    simulating = false;
    await _gpsSub?.cancel();
    _gpsSub = null;
    try {
      await _post('/teacher/end-operation');
    } catch (_) {}
    if (vehicleId != null) {
      SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: false);
    }
    operating = false;
    instruction = '';
    busy = false;
    notifyListeners();
    _speak('운행이 종료되었습니다. 수고하셨습니다.');
  }

  Future<void> setMode(RouteMode m) async {
    if (mode == m) return;
    mode = m;
    notifyListeners();
    if (operating && position != null) {
      _speak(m == RouteMode.safe ? '큰길 위주의 안전 경로로 안내합니다.' : '빠른 경로로 안내합니다.');
      await _requestRoute(from: position!);
    }
  }

  void setFollow(bool v) {
    follow = v;
    if (v && position != null) {
      map.moveBus(position!, follow: true);
    } else {
      map.fitAll();
    }
    notifyListeners();
  }

  // ───────────── 경로 탐색 (카카오 길찾기) ─────────────

  Future<void> _requestRoute({required GeoPoint from}) async {
    final remaining = stops.where((s) => !s.passed).toList();
    final GeoPoint? destination = academy ?? (remaining.isNotEmpty ? remaining.last.point : null);
    if (destination == null) {
      instruction = '오늘 운행할 정류장이 없습니다.';
      notifyListeners();
      return;
    }
    // 유치원 좌표가 없으면 마지막 정류장이 도착지
    final waypoints = academy != null ? remaining : remaining.sublist(0, math.max(0, remaining.length - 1));

    routing = true;
    notifyListeners();
    try {
      final r = await _post('/directions', {
        'origin': from.toJson(),
        'destination': destination.toJson(),
        'waypoints': waypoints.take(30).map((s) => s.point.toJson()).toList(),
        'mode': mode == RouteMode.fast ? 'fast' : 'safe',
      }) as Map<String, dynamic>;

      _path = [
        for (final p in (r['path'] as List? ?? [])) GeoPoint(toDouble(p['lat']) ?? 0, toDouble(p['lng']) ?? 0),
      ];
      if (_path.length < 2) throw NavException('경로를 찾지 못했습니다.');
      _cum = cumulativeDistances(_path);

      final dist = toDouble(r['distance']) ?? _cum.last;
      final dur = toDouble(r['duration']);
      if (dur != null && dur > 0) _avgSpeed = math.max(2, dist / dur);

      // 회전 안내·정류장을 경로 위의 위치(번호)로 바꿔 둔다
      _guides.clear();
      var from0 = 0;
      for (final g in (r['guides'] as List? ?? [])) {
        final lat = toDouble(g['lat']);
        final lng = toDouble(g['lng']);
        final text = '${g['guidance'] ?? ''}'.trim();
        if (lat == null || lng == null || text.isEmpty) continue;
        final guide = _Guide(GeoPoint(lat, lng), text);
        guide.pathIndex = nearestIndex(_path, guide.point, from: from0);
        from0 = guide.pathIndex;
        _guides.add(guide);
      }
      var from1 = 0;
      for (final s in remaining) {
        s.pathIndex = nearestIndex(_path, s.point, from: from1);
        from1 = s.pathIndex;
      }

      _progress = 0;
      _offRouteCount = 0;
      _simMeters = 0;
      error = null;
      _drawMap();
      _updateProgress();
    } catch (e) {
      error = '경로를 가져오지 못했습니다: $e';
    }
    routing = false;
    notifyListeners();
  }

  // ───────────── 위치 ─────────────

  Future<GeoPoint> _currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw NavException('휴대폰의 위치(GPS)를 켜주세요.');
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      throw NavException('위치 권한이 필요합니다. 설정에서 TakeMe의 위치 권한을 허용해주세요.');
    }
    final p = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
    accuracy = p.accuracy;
    return GeoPoint(p.latitude, p.longitude);
  }

  void _startGps() {
    _gpsSub?.cancel();
    _gpsSub = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.bestForNavigation, distanceFilter: 3),
    ).listen(
      (p) {
        if (!simulating) _onPosition(GeoPoint(p.latitude, p.longitude), acc: p.accuracy);
      },
      onError: (e) {
        error = 'GPS 오류: $e';
        notifyListeners();
      },
    );
  }

  /// 새 위치가 들어올 때마다 (실제 GPS 또는 시뮬레이션)
  void _onPosition(GeoPoint p, {double? acc}) {
    position = p;
    if (acc != null) accuracy = acc;
    map.moveBus(p, follow: follow);

    if (vehicleId != null && SocketService().isConnected) {
      SocketService().sendLocationUpdate(vehicleId: vehicleId!, lat: p.lat, lng: p.lng);
      sentCount++;
    }
    _checkStopArrival(p);
    _updateProgress();
    notifyListeners();
  }

  void _checkStopArrival(GeoPoint p) {
    for (var i = 0; i < stops.length; i++) {
      final s = stops[i];
      if (s.passed) continue;
      if (distanceM(p, s.point) < 40) {
        s.passed = true;
        map.markStopPassed(i);
        _speak('${s.name} 원아 정류장에 도착했습니다.');
      }
      break; // 다음 정류장 하나만 확인
    }
  }

  void _updateProgress() {
    final pos = position;
    if (!hasRoute || pos == null) return;

    final idx = nearestIndex(_path, pos, from: math.max(0, _progress - 5), to: _progress + 80);
    final offRoute = distanceM(_path[idx], pos);
    _progress = idx;
    remainingM = _cum.last - _cum[idx];

    // 70m 이상 벗어난 상태가 3번 연속이면 다시 탐색 (20초에 한 번까지)
    _offRouteCount = offRoute > 70 ? _offRouteCount + 1 : 0;
    if (_offRouteCount >= 3 && !routing && DateTime.now().difference(_lastReroute).inSeconds > 20) {
      _offRouteCount = 0;
      _lastReroute = DateTime.now();
      _speak('경로를 벗어났습니다. 경로를 다시 탐색합니다.');
      _requestRoute(from: pos);
      return;
    }

    _Guide? next;
    for (final g in _guides) {
      if (g.pathIndex > idx) {
        next = g;
        break;
      }
    }
    if (next == null) {
      instruction = remainingM < 60 ? '목적지 부근입니다' : '경로를 따라 주행하세요';
      return;
    }
    final d = _cum[next.pathIndex] - _cum[idx];
    instruction = '${formatDistance(d)} 앞 ${next.text}';
    if (d <= 300 && d > 100 && !next.saidFar) {
      next.saidFar = true;
      _speak('${(d / 10).round() * 10}미터 앞에서 ${next.text}');
    } else if (d <= 60 && !next.saidNear) {
      next.saidNear = true;
      next.saidFar = true;
      _speak(next.text);
    }
  }

  // ───────────── 주행 시뮬레이션 (테스트용) ─────────────

  /// 차를 타지 않고 경로를 따라 1초마다 가짜 위치를 보냄 (약 40km/h)
  void toggleSimulation() {
    if (simulating) {
      _simTimer?.cancel();
      simulating = false;
      notifyListeners();
      return;
    }
    if (!operating || !hasRoute) {
      error = '운행을 시작해서 경로가 표시된 뒤 사용할 수 있습니다.';
      notifyListeners();
      return;
    }
    simulating = true;
    _simMeters = _cum[_progress];
    _simTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!hasRoute) return;
      _simMeters = math.min(_simMeters + 11, _cum.last);
      _onPosition(pointAlong(_path, _cum, _simMeters));
      if (_simMeters >= _cum.last) {
        _simTimer?.cancel();
        simulating = false;
        notifyListeners();
      }
    });
    notifyListeners();
  }

  void _speak(String text) {
    _tts.stop();
    _tts.speak(text);
  }

  @override
  void dispose() {
    _simTimer?.cancel();
    _gpsSub?.cancel();
    _tts.stop();
    super.dispose();
  }
}
