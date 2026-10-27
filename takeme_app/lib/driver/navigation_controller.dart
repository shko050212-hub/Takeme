import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../api/api_client.dart';
import '../config.dart';
import '../widgets/kakao_map_view.dart';
import 'geo.dart';

/// safe: 큰길 위주 안전 경로 (추천 경로 + 유턴 회피), fast: 빠른 경로 (최단 시간)
enum RouteMode { safe, fast }

class Stop {
  final dynamic id;
  final String name;
  final String? address;
  final String? expectedTime;
  final GeoPoint point;
  bool passed = false;
  int pathIndex = 0;

  Stop({required this.id, required this.name, required this.point, this.address, this.expectedTime});
}

class Guide {
  final GeoPoint point;
  final String text;
  int pathIndex = 0;
  bool saidFar = false;
  bool saidNear = false;

  Guide(this.point, this.text);
}

/// 기사 앱의 운행·내비게이션 상태를 관리
class DriverNavigationController extends ChangeNotifier {
  DriverNavigationController(this.map);

  final KakaoMapController map;
  final FlutterTts _tts = FlutterTts();

  // ── 화면에 보여줄 상태 ──
  bool loading = true;
  bool busy = false; // 운행 시작/종료 처리 중
  bool routing = false; // 경로 탐색 중
  bool operating = false;
  bool simulating = false;
  bool follow = true;
  String? error;

  int? vehicleId;
  String vehicleName = '';
  GeoPoint? academy;
  final List<Stop> stops = [];
  RouteMode mode = RouteMode.safe;

  GeoPoint? position;
  double? accuracy;
  String socketStatus = '연결 안 됨';
  int sentCount = 0;

  String instruction = '';
  double remainingM = 0;

  // ── 내부 상태 ──
  List<GeoPoint> _path = [];
  List<double> _cum = [];
  final List<Guide> _guides = [];
  double _avgSpeed = 8; // m/s, 경로 요약값으로 갱신
  int _progress = 0;
  int _offRouteCount = 0;
  DateTime _lastReroute = DateTime.fromMillisecondsSinceEpoch(0);

  io.Socket? _socket;
  StreamSubscription<Position>? _gpsSub;
  Timer? _simTimer;
  double _simMeters = 0;

  bool get hasRoute => _path.length > 1;

  Stop? get nextStop {
    for (final s in stops) {
      if (!s.passed) return s;
    }
    return null;
  }

  int get passedCount => stops.where((s) => s.passed).length;

  double? get nextStopDistance {
    final s = nextStop;
    if (s == null || position == null) return null;
    if (hasRoute && s.pathIndex >= _progress) {
      return _cum[s.pathIndex] - _cum[_progress];
    }
    return distanceM(position!, s.point);
  }

  String get etaText {
    if (!hasRoute || remainingM <= 0) return '-';
    final arrive = DateTime.now().add(Duration(seconds: (remainingM / _avgSpeed).round()));
    final h = arrive.hour.toString().padLeft(2, '0');
    final m = arrive.minute.toString().padLeft(2, '0');
    return '$h:$m';
  }

  String get remainingMinutesText {
    if (!hasRoute) return '-';
    final min = (remainingM / _avgSpeed / 60).ceil();
    return '약 $min분';
  }

  // ───────────────────────── 초기화 ─────────────────────────

  Future<void> init() async {
    try {
      await _tts.setLanguage('ko-KR');
      await _tts.setSpeechRate(0.5);
    } catch (_) {}

    try {
      final v = await ApiClient.instance.get('/teacher/my-vehicle');
      if (v is Map) {
        vehicleId = (v['id'] as num?)?.toInt();
        vehicleName = '${v['name'] ?? ''}';
      }
      await _loadStops();
    } catch (e) {
      error = e.toString() == 'Assigned vehicle not found'
          ? '배정된 차량이 없습니다. 원장님께 차량 배정을 요청하세요.'
          : e.toString();
    }
    loading = false;
    notifyListeners();
  }

  /// 오늘 정류장 목록 (서버가 가까운 순서로 정렬해서 줌)
  Future<void> _loadStops() async {
    final r = await ApiClient.instance.get('/teacher/route');
    if (r is! Map) return;
    vehicleId ??= (r['vehicleId'] as num?)?.toInt();

    final a = r['academy'];
    if (a is Map) {
      final lat = toDouble(a['latitude']);
      final lng = toDouble(a['longitude']);
      if (lat != null && lng != null) academy = GeoPoint(lat, lng);
    }

    stops.clear();
    for (final s in (r['stops'] as List? ?? [])) {
      final lat = toDouble(s['latitude']);
      final lng = toDouble(s['longitude']);
      if (lat == null || lng == null) continue;
      stops.add(Stop(
        id: s['id'],
        name: '${s['name'] ?? ''}',
        address: s['address']?.toString(),
        expectedTime: s['expectedTime']?.toString(),
        point: GeoPoint(lat, lng),
      ));
    }
    _drawMap();
  }

  void _drawMap() {
    map.setRoute(
      path: _path,
      stops: [
        for (final s in stops) {'lat': s.point.lat, 'lng': s.point.lng, 'passed': s.passed},
      ],
      academy: academy,
    );
  }

  // ───────────────────────── 운행 시작·종료 ─────────────────────────

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
      await ApiClient.instance.post('/teacher/start-operation');
      operating = true;
      sentCount = 0;
      _connectSocket();
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
      await ApiClient.instance.post('/teacher/end-operation');
    } catch (_) {}
    _socket?.dispose();
    _socket = null;
    socketStatus = '연결 안 됨';
    operating = false;
    instruction = '';
    busy = false;
    notifyListeners();
    _speak('운행이 종료되었습니다. 수고하셨습니다.');
  }

  /// 안전 경로 / 빠른 경로 바꾸기 (운행 중이면 지금 위치에서 다시 탐색)
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

  // ───────────────────────── 경로 탐색 ─────────────────────────

  Future<void> _requestRoute({required GeoPoint from}) async {
    final remaining = stops.where((s) => !s.passed).toList();
    final GeoPoint? destination = academy ?? (remaining.isNotEmpty ? remaining.last.point : null);
    if (destination == null) {
      instruction = '오늘 운행할 정류장이 없습니다.';
      notifyListeners();
      return;
    }
    // 유치원이 없으면 마지막 정류장이 도착지
    final waypoints = academy != null ? remaining : remaining.sublist(0, math.max(0, remaining.length - 1));

    routing = true;
    notifyListeners();
    try {
      final r = await ApiClient.instance.post('/directions', {
        'origin': from.toJson(),
        'destination': destination.toJson(),
        'waypoints': waypoints.take(30).map((s) => s.point.toJson()).toList(),
        'mode': mode == RouteMode.fast ? 'fast' : 'safe',
      }) as Map<String, dynamic>;

      _path = [
        for (final p in (r['path'] as List? ?? []))
          GeoPoint(toDouble(p['lat']) ?? 0, toDouble(p['lng']) ?? 0),
      ];
      if (_path.length < 2) throw ApiException('경로를 찾지 못했습니다.');
      _cum = cumulativeDistances(_path);

      final dist = toDouble(r['distance']) ?? _cum.last;
      final dur = toDouble(r['duration']);
      if (dur != null && dur > 0) _avgSpeed = math.max(2, dist / dur);

      // 회전 안내 지점을 경로 위의 위치(번호)로 바꿔 둔다
      _guides.clear();
      var from0 = 0;
      for (final g in (r['guides'] as List? ?? [])) {
        final lat = toDouble(g['lat']);
        final lng = toDouble(g['lng']);
        final text = '${g['guidance'] ?? ''}'.trim();
        if (lat == null || lng == null || text.isEmpty) continue;
        final guide = Guide(GeoPoint(lat, lng), text);
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

  // ───────────────────────── 위치 ─────────────────────────

  Future<GeoPoint> _currentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw ApiException('휴대폰의 위치(GPS)를 켜주세요.');
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      throw ApiException('위치 권한이 필요합니다. 설정에서 Takeme의 위치 권한을 허용해주세요.');
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
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.bestForNavigation,
        distanceFilter: 3,
      ),
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

    final s = _socket;
    if (s != null && s.connected && vehicleId != null) {
      s.emit('driverLocationUpdate', {'vehicleId': vehicleId, 'lat': p.lat, 'lng': p.lng});
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

    // 경로 이탈: 70m 이상 벗어난 상태가 3번 연속이면 다시 탐색 (20초에 한 번까지)
    _offRouteCount = offRoute > 70 ? _offRouteCount + 1 : 0;
    if (_offRouteCount >= 3 && !routing && DateTime.now().difference(_lastReroute).inSeconds > 20) {
      _offRouteCount = 0;
      _lastReroute = DateTime.now();
      _speak('경로를 벗어났습니다. 경로를 다시 탐색합니다.');
      _requestRoute(from: pos);
      return;
    }

    // 다음 회전 안내
    Guide? next;
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

  // ───────────────────────── 실시간 전송 (소켓) ─────────────────────────

  void _connectSocket() {
    _socket?.dispose();
    final s = io.io(
      AppConfig.apiUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .setAuth({'token': ApiClient.instance.token})
          .build(),
    );
    s.onConnect((_) {
      socketStatus = '연결됨';
      if (vehicleId != null) s.emit('joinVehicleRoom', {'vehicleId': vehicleId});
      notifyListeners();
    });
    s.onDisconnect((_) {
      socketStatus = '연결 끊김';
      notifyListeners();
    });
    s.onConnectError((_) {
      socketStatus = '연결 실패';
      notifyListeners();
    });
    s.on('authError', (d) {
      error = d is Map ? '${d['message']}' : '위치 전송 권한이 없습니다.';
      notifyListeners();
    });
    s.connect();
    _socket = s;
  }

  // ───────────────────────── 주행 시뮬레이션 (테스트용) ─────────────────────────

  /// 차를 타지 않고 경로를 따라 가짜 위치를 1초마다 보냄 (약 40km/h)
  /// 학부모 앱·관리자 웹에서 버스가 움직이는지 책상에서 확인할 때 사용
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
    _socket?.dispose();
    _tts.stop();
    super.dispose();
  }
}
