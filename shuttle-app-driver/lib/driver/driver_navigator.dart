import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:geolocator/geolocator.dart';

import '../config.dart';
import '../services/api_service.dart';
import '../services/socket_service.dart';
import '../widgets/nav_map_view.dart';
import 'geo.dart';
import 'stop_order.dart';

/// 경로 모드. 서버 /directions 가 카카오 길찾기에 실제로 보내는 기준:
/// - safe: priority=RECOMMEND + avoid=[uturn]  (큰 길·간선도로 추천 경로 + 유턴 회피)
/// - fast: priority=DISTANCE                   (최단 거리 우선 탐색)
enum RouteMode { safe, fast }

extension RouteModeInfo on RouteMode {
  String get key => this == RouteMode.fast ? 'fast' : 'safe';
  String get title => this == RouteMode.fast ? '빠른 경로' : '안전 경로';
  String get criteria => this == RouteMode.fast ? '거리 우선 탐색' : '큰 길 우선 · 유턴 회피';
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
  final String stopMemo; // 정차 위치 안내 메모 (예: "○○아파트 정문 앞, 오른쪽에 정차")
  final bool isTest; // 테스트 경로용 가짜 정류장 (서버·학부모에게 보내지 않음)
  final bool isOneTimeBoarding; // 하루 탑승
  final bool isOverride; // 탑승지/일정 변경
  final String? overrideType;
  bool passed = false;
  /// 들르지 않고 지나침(계획 순서와 다름). passed 도 true 다
  bool skipped = false;
  DateTime? arrivedAt;
  bool saidApproach = false;
  int pathIndex = 0;
  NavStop(
    this.name,
    this.point, {
    String? stopMemo,
    this.isTest = false,
    this.isOneTimeBoarding = false,
    this.isOverride = false,
    this.overrideType,
  }) : stopMemo = (stopMemo != null && stopMemo.trim().isNotEmpty)
            ? stopMemo.trim()
            : '$name 정문 앞, 오른쪽에 정차';
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
  final String? provider; // 5단계: 사용한 길찾기 서비스 ('kakao' | 'naver' | 'fallback')
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
    this.provider,
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

  static const MethodChannel _overlayChannel = MethodChannel('com.takeme.driver/overlay');

  final NavMapController map;
  final FlutterTts _tts = FlutterTts();

  // ── 다른 앱 위에 표시(오버레이) 권한 상태 ──
  bool overlayPermissionGranted = true;

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
  double _progressFrac = 0.0;
  int _offRouteCount = 0;
  DateTime _lastReroute = DateTime.fromMillisecondsSinceEpoch(0);
  // 재탐색을 해도 계속 경로 밖이면(예: 아파트 단지 안에 서 있음) 간격을 점점 늘려 무한 반복을 막는다.
  int _rerouteStreak = 0;
  static const int _rerouteBaseGapSec = 8;
  static const int _rerouteMaxGapSec = 120;
  DateTime _lastAutoRouteSync = DateTime.fromMillisecondsSinceEpoch(0);

  int _lastSyncedProgress = -1;
  DateTime _lastRoutePathSync = DateTime.fromMillisecondsSinceEpoch(0);

  // ── 안전 운전 보조 & 차량선생님 출발 신호 ──
  int speedKmh = 0;
  int _prevSpeedKmh = 0;
  DateTime _prevSpeedAt = DateTime.now();
  bool isOverspeeding = false;
  DateTime _lastOverspeedAlert = DateTime.fromMillisecondsSinceEpoch(0);
  DateTime _lastSuddenStopAlert = DateTime.fromMillisecondsSinceEpoch(0);
  String? departSignalBanner; // 차량선생님 "출발하셔도 됩니다" 배너 메시지
  Timer? _departBannerTimer;
  bool emergencySending = false;

  /// 시속 5km 이상 주행 중인지 여부 (주행 중 조작 잠금 기준)
  bool get isMovingFast => driving && speedKmh >= 5;

  // ── 위치 ──
  GeoPoint? position;
  double? accuracy;
  double? heading; // 진행 방향 (화살표 회전 및 12시 방향 정렬)
  bool headingUp = true; // 주행 중 진행 방향이 화면 위쪽(12시)을 향하도록 지도 회전
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
  int get offlineQueuedCount => SocketService().queuedLocationCount;

  NavStop? get nextStop {
    for (final s in activeStops) {
      if (!s.passed) return s;
    }
    return null;
  }

  int get passedCount => activeStops.where((s) => s.passed).length;

  /// 남은 정류장 수 (다음 정류장 포함)
  int get remainingStopCount => activeStops.where((s) => !s.passed).length;

  /// 가장 최근에 도착한 정류장 (건너뛴 정류장 제외)
  NavStop? get currentStop {
    NavStop? last;
    for (final s in activeStops) {
      if (s.passed && !s.skipped) {
        if (last == null || (s.arrivedAt != null && (last.arrivedAt == null || s.arrivedAt!.isAfter(last.arrivedAt!)))) last = s;
      }
    }
    return last;
  }

  /// 계획 순서와 다르게 건너뛴 정류장 수
  int get skippedCount => activeStops.where((s) => s.skipped).length;

  /// 정류장 도착·건너뜀 기록을 서버 운행 일지에 남긴다
  void _logStopEvent(String type, String detail) {
    unawaited(_logSafetyEventToServer(type, detail));
  }

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

  String get remainingKmNumberText {
    final km = remainingM / 1000;
    return km >= 10 ? '${km.round()}' : km.toStringAsFixed(1);
  }

  /// 티맵 하단바 표시용 (오전/오후, HH:MM)
  (String, String) get etaAmPmAndTime {
    final a = active;
    final t = a == null
        ? DateTime.now()
        : DateTime.now().add(Duration(seconds: (remainingM / a.avgSpeed).round()));
    final ampm = t.hour < 12 ? '오전' : '오후';
    final h12 = (t.hour % 12 == 0 ? 12 : t.hour % 12).toString().padLeft(2, '0');
    final min = t.minute.toString().padLeft(2, '0');
    return (ampm, '$h12:$min');
  }

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

  /// 5단계: 현재 활성 경로의 길찾기 제공자 ('kakao' | 'naver' | 'fallback')
  String? get currentProvider => active?.provider;

  /// 다음 회전 안내 (거리, 문구)
  (double, String)? get nextTurn {
    final a = active;
    if (a == null) return null;
    for (final g in a.guides) {
      if (g.pathIndex > _progress) return (a.cum[g.pathIndex] - a.cum[_progress], g.text);
    }
    return null;
  }

  /// 그다음(두 번째) 회전 안내 (거리, 문구) — 티맵 좌상단 보조 안내박스 및 백그라운드 오버레이 2단 표시용
  (double, String)? get secondTurn {
    final a = active;
    if (a == null) return null;
    var foundFirst = false;
    for (final g in a.guides) {
      if (g.pathIndex > _progress) {
        if (!foundFirst) {
          foundFirst = true;
        } else {
          return (a.cum[g.pathIndex] - a.cum[_progress], g.text);
        }
      }
    }
    return null;
  }

  // ───────────── 백그라운드 다른 앱 위에 표시(오버레이) 및 화면 켜짐 유지 ─────────────

  String _turnTypeOf(String text) {
    if (text.contains('유턴') || text.contains('U턴')) return 'uturn';
    if (text.contains('좌회전')) return 'left';
    if (text.contains('우회전')) return 'right';
    if (text.contains('왼쪽')) return 'slight_left';
    if (text.contains('오른쪽')) return 'slight_right';
    if (text.contains('목적지') || text.contains('경유지')) return 'goal';
    return 'straight';
  }

  Future<void> _setKeepScreenOn(bool enabled) async {
    try {
      await _overlayChannel.invokeMethod<bool>('setKeepScreenOn', {'enabled': enabled});
    } catch (_) {}
  }

  Future<void> refreshOverlayPermission() async {
    try {
      final ok = await _overlayChannel.invokeMethod<bool>('canDrawOverlays');
      if (ok != null && ok != overlayPermissionGranted) {
        overlayPermissionGranted = ok;
        notifyListeners();
      }
    } catch (_) {}
  }

  /// 운행 시작 시 오버레이 권한 확인: 미허용이면 푸시 알림을 발송하여 설정으로 유도
  Future<void> _ensureOverlayPermissionOnStart() async {
    try {
      final ok = await _overlayChannel.invokeMethod<bool>('ensureOverlayPermission');
      if (ok != null) {
        overlayPermissionGranted = ok;
        notifyListeners();
      }
    } catch (_) {}
  }

  Future<void> openOverlaySettings() async {
    try {
      await _overlayChannel.invokeMethod<bool>('openOverlaySettings');
    } catch (_) {}
  }

  void _syncOverlay() {
    final t1 = nextTurn;
    final t2 = secondTurn;
    _overlayChannel.invokeMethod('updateOverlay', {
      'driving': driving,
      'turn1Dist': t1 == null ? '직진' : formatDistance(t1.$1),
      'turn1Text': t1 == null ? '경로를 따라 주행' : t1.$2,
      'turn1Type': t1 == null ? 'straight' : _turnTypeOf(t1.$2),
      'turn2Dist': t2 == null ? '' : formatDistance(t2.$1),
      'turn2Type': t2 == null ? 'straight' : _turnTypeOf(t2.$2),
    }).catchError((_) {});
  }

  /// 주행 중(시속 5km 이상) 조작 잠금 시 음성 안내
  void warnLockedWhileMoving() {
    _speak('주행 중에는 안전을 위해 조작이 제한됩니다. 정차 후 이용해 주세요.');
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
    if (res.statusCode >= 300 && res.statusCode < 400) {
      throw NavException('서버 리다이렉트 응답(${res.statusCode})이 발생했습니다. 요청 경로를 확인해 주세요.');
    }
    if (res.statusCode >= 400) {
      final msg = data is Map ? data['message'] : null;
      throw NavException(msg is List ? msg.join(', ') : (msg?.toString() ?? '요청 실패 (${res.statusCode})'));
    }
    if (data == null && text.isNotEmpty) {
      throw NavException('서버에서 올바른 JSON 응답을 받지 못했습니다.');
    }
    return data;
  }

  /// 급정거·과속 등 안전운전 기록을 서버 운행 일지에 자동 전송 (기사 수동 입력 불필요)
  Future<void> _logSafetyEventToServer(String type, String detail) async {
    if (!serverLive || testMode) return;
    try {
      await _post('/teacher/driving-event', {'type': type, 'detail': detail});
    } catch (e) {
      debugPrint('[nav] logDrivingEvent failed: $e');
    }
  }

  /// 실제 도로 경로와 진행률을 서버로 전송 (학부모·지도교사 지도 실시간 공유)
  Future<void> _syncRoutePathToServer({bool force = false}) async {
    final mayLeaveDevice = serverLive && !testMode;
    if (!mayLeaveDevice || vehicleId == null) return;
    final a = active;
    if (a == null || a.path.isEmpty) return;

    final now = DateTime.now();
    if (!force && (_progress - _lastSyncedProgress).abs() < 5 && now.difference(_lastRoutePathSync).inSeconds < 10) {
      return;
    }

    _lastSyncedProgress = _progress;
    _lastRoutePathSync = now;

    try {
      final rawPath = a.path;
      final step = math.max(1, (rawPath.length / 300).ceil());
      final simplified = <Map<String, double>>[];
      for (var i = 0; i < rawPath.length; i += step) {
        simplified.add({'lat': rawPath[i].lat, 'lng': rawPath[i].lng});
      }
      if (rawPath.isNotEmpty && (simplified.isEmpty || simplified.last['lat'] != rawPath.last.lat)) {
        simplified.add({'lat': rawPath.last.lat, 'lng': rawPath.last.lng});
      }

      final scaledProgress = (_progress / step).floor().clamp(0, simplified.length - 1);

      await _post('/teacher/route-path', {
        'vehicleId': vehicleId,
        'path': simplified,
        'progressIndex': scaledProgress,
      });
    } catch (e) {
      debugPrint('[nav] syncRoutePathToServer error: $e');
    }
  }

  /// 긴급 버튼 (길게 눌렀을 때만 호출): 사고·고장 시 원장님 및 타 호차에 즉시 알림 전송
  Future<bool> triggerEmergency() async {
    if (emergencySending) return false;
    emergencySending = true;
    notifyListeners();
    try {
      await _post('/teacher/emergency');
      _speak('긴급 사고 및 고장 알림을 원장님과 타 차량에 전송했습니다. 안전한 곳에 정차해 주세요.');
      emergencySending = false;
      notifyListeners();
      return true;
    } catch (e) {
      actionError = '긴급 알림 전송 실패: $e';
      _speak('긴급 알림 전송에 실패했습니다.');
      emergencySending = false;
      notifyListeners();
      return false;
    }
  }

  /// 서버에서 배정 차량·유치원·정류장(원아+탑승지) 목록을 새로 불러와 경로를 갱신한다.
  Future<void> refreshRouteFromServer({bool speak = false, String? customSpeakText}) async {
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
        final prevByName = {for (final s in stops) s.name: s};
        final prevList = List<NavStop>.from(stops);
        final approachedNames = stops.where((s) => s.saidApproach).map((s) => s.name).toSet();
        stops
          ..clear()
          ..addAll(route.stops.map((s) {
            final stop = NavStop(
              s.name,
              GeoPoint(s.latitude, s.longitude),
              stopMemo: s.stopMemo ?? s.address,
              isOneTimeBoarding: s.isOneTimeBoarding,
              isOverride: s.isOverride,
              overrideType: s.overrideType,
            );
            stop.passed = passedNames.contains(s.name);
            stop.saidApproach = approachedNames.contains(s.name);
            final prev = prevByName[s.name];
            if (prev != null) {
              stop.skipped = prev.skipped;
              stop.arrivedAt = prev.arrivedAt;
            }
            return stop;
          }));
        // 운행 중이면 정해 둔 순서는 그대로 두고, 새 정류장만 가장 덜 돌아가는 자리에 끼워 넣는다
        if (driving && !testMode) _keepOrderAndInsertNew(prevList);
      }
      loadError = null;
      notifyListeners();
      if (driving && !testMode) {
        if (customSpeakText != null) {
          _speak(customSpeakText);
        } else if (speak) {
          _speak('변경된 탑승지를 반영하여 경로를 다시 안내합니다.');
        }
        await _reroute(reason: 'route-updated', fit: false);
      } else if (!driving) {
        if (customSpeakText != null) {
          _speak(customSpeakText);
        } else if (speak) {
          _speak('노선과 탑승지 정보를 새로고침했습니다.');
        }
        await previewRoutes();
      }
    } catch (e) {
      loadError = '정보를 불러오지 못했습니다. ${friendlyError(e)}';
      notifyListeners();
    }
  }

  // ───────────── 초기화 ─────────────

  Future<void> init() async {
    try {
      await _tts.setLanguage('ko-KR');
      await _tts.setSpeechRate(0.45); // 조금 천천히
    } catch (_) {}

    await refreshOverlayPermission();

    final user = ApiService().currentUser;
    if (user != null) {
      SocketService().connect(ApiService().token);
      _registerSocketListeners();
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
            ..addAll(route.stops.map((s) => NavStop(
                  s.name,
                  GeoPoint(s.latitude, s.longitude),
                  stopMemo: s.stopMemo ?? s.address,
                )));
        }
        if (vehicleId != null) SocketService().joinVehicleRoom(vehicleId!);
      } catch (e) {
        loadError = '정보를 불러오지 못했습니다. ${friendlyError(e)}';
      }
    }
    loading = false;
    _drawPreview();
    notifyListeners();

    await _startLocation(); // 첫 위치가 잡히면 경로 비교를 시작
    if (position == null) await previewRoutes(); // GPS 가 없어도 유치원 기준으로 비교
  }

  void _registerSocketListeners() {
    // 1) 차량선생님 "출발하셔도 됩니다" 신호 수신
    SocketService().onDriverDepartSignal((data) {
      final vId = int.tryParse('${data['vehicleId'] ?? ''}');
      if (vehicleId != null && vId != null && vId != vehicleId) return;
      _onReceiveDepartSignal(stopName: data['stopName']?.toString());
    });

    // 2) 차량선생님 학부모 메시지 응답 등 기사 TTS 수신
    SocketService().onDriverTts((data) {
      final msg = data['message']?.toString();
      if (msg != null && msg.isNotEmpty) {
        _speak(msg);
      }
    });

    // 3) 학부모 결석 신청 / 원장 탑승지 변경 시 경로 자동 갱신
    SocketService().onRouteUpdated((data) {
      final now = DateTime.now();
      if (now.difference(_lastAutoRouteSync).inSeconds < 2) return;
      _lastAutoRouteSync = now;
      refreshRouteFromServer(
        speak: true,
        customSpeakText: driving ? '경로가 변경되었습니다. 바뀐 경로로 다시 안내합니다.' : null,
      );
    });
  }

  void _onReceiveDepartSignal({String? stopName}) {
    // 현재 정류장 부근(80m 이내)에 정차 중이면 해당 정류장을 통과 완료 처리하고 다음 정류장으로 전환
    final s = nextStop;
    if (s != null && position != null && distanceM(position!, s.point) <= 80) {
      final idx = activeStops.indexOf(s);
      s.passed = true;
      s.arrivedAt ??= DateTime.now();
      if (idx >= 0) map.markStopPassed(idx);
    }

    final next = nextStop;
    departSignalBanner = next != null ? '출발하셔도 됩니다 · 다음: ${next.name}' : '출발하셔도 됩니다 · 유치원으로 이동';
    _departBannerTimer?.cancel();
    _departBannerTimer = Timer(const Duration(seconds: 7), () {
      departSignalBanner = null;
      notifyListeners();
    });

    _speak(next != null ? '출발하셔도 됩니다. 다음 정류장은 ${next.name}입니다.' : '출발하셔도 됩니다. 유치원으로 이동합니다.');
    notifyListeners();
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

      // 1. 마지막으로 알려진 위치(getLastKnownPosition)로 먼저 지도와 경로를 즉시 표시
      try {
        final last = await Geolocator.getLastKnownPosition();
        if (last != null && position == null) {
          _onPosition(
            GeoPoint(last.latitude, last.longitude),
            acc: last.accuracy,
            gpsHeading: last.heading,
            speedMps: last.speed,
          );
          if (!routePreviewing && !driving) {
            map.centerOn(position!, zoom: 15);
          }
          unawaited(previewRoutes());
        }
      } catch (e) {
        debugPrint('[nav] getLastKnownPosition failed: $e');
      }

      // 2. 정확한 실시간 위치 요청 및 갱신
      try {
        final first = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(
            accuracy: LocationAccuracy.high,
            timeLimit: Duration(seconds: 8),
          ),
        );
        _onPosition(
          GeoPoint(first.latitude, first.longitude),
          acc: first.accuracy,
          gpsHeading: first.heading,
          speedMps: first.speed,
        );
        if (!routePreviewing && !driving) {
          map.centerOn(position!, zoom: 15);
        }
        await previewRoutes();
      } catch (e) {
        gpsError = '실내 또는 GPS 신호 약함';
        debugPrint('[nav] initial position timeout/error: $e');
        notifyListeners();
      }

      _gpsSub?.cancel();
      late final LocationSettings locationSettings;
      if (defaultTargetPlatform == TargetPlatform.android) {
        locationSettings = AndroidSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          intervalDuration: const Duration(seconds: 1),
          distanceFilter: 0,
        );
      } else if (defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.macOS) {
        locationSettings = AppleSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          distanceFilter: 0,
        );
      } else {
        locationSettings = const LocationSettings(
          accuracy: LocationAccuracy.bestForNavigation,
          distanceFilter: 0,
        );
      }
      _gpsSub = Geolocator.getPositionStream(
        locationSettings: locationSettings,
      ).listen(
        (p) {
          gpsError = null;
          // 시뮬레이션·테스트 경로 중에는 실제 GPS 로 버스를 움직이지 않음
          if (!simulating && !testMode) {
            final hadPosition = position != null;
            // 움직일 때만 GPS 방향을 믿음 (정지 중에는 방향 값이 흔들림)
            _onPosition(
              GeoPoint(p.latitude, p.longitude),
              acc: p.accuracy,
              gpsHeading: p.speed > 1 ? p.heading : null,
              speedMps: p.speed,
            );
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

  /// 운행 전: 차의 현재 위치(없으면 유치원)에서 출발해 유치원으로 돌아오는 가장 짧은 순서로 남은 정류장을 다시 정한다.
  /// (서버 순서는 '유치원에서 가까운 순'이라 차 위치를 몰라서, 차가 반대편에 있으면 크게 돌아가는 경로가 나온다)
  void _optimizeStopOrder() {
    if (driving || academy == null) return;
    final passed = stops.where((s) => s.passed).toList();
    final rest = stops.where((s) => !s.passed).toList();
    if (rest.length < 2) return;
    final order = bestOrder([for (final s in rest) s.point], start: position ?? academy, end: academy);
    var changed = false;
    for (var i = 0; i < order.length; i++) {
      if (order[i] != i) changed = true;
    }
    if (!changed) return;
    debugPrint('[nav] 정류장 순서 정리: ${rest.map((s) => s.name).join(' → ')} ⇒ ${order.map((i) => rest[i].name).join(' → ')}');
    stops
      ..clear()
      ..addAll(passed)
      ..addAll(order.map((i) => rest[i]));
  }

  /// 운행 중 서버에서 목록을 다시 받았을 때: 이전에 정한 순서를 유지하고 새 정류장(또는 위치가 크게 바뀐 정류장)만
  /// 현재 위치 기준으로 돌아가는 거리가 가장 적은 자리에 끼워 넣는다. 지나친 정류장은 그대로 앞에 둔다.
  void _keepOrderAndInsertNew(List<NavStop> prev) {
    final fresh = List<NavStop>.from(stops);
    final prevIndex = {for (var i = 0; i < prev.length; i++) prev[i].name: i};
    bool isKnown(NavStop s) {
      final i = prevIndex[s.name];
      return i != null && distanceM(prev[i].point, s.point) < 30;
    }

    final known = fresh.where(isKnown).toList()
      ..sort((a, b) => prevIndex[a.name]!.compareTo(prevIndex[b.name]!));
    final added = fresh.where((s) => !isKnown(s)).toList();
    final passed = known.where((s) => s.passed).toList();
    final seq = known.where((s) => !s.passed).toList();
    final start = position ?? academy;
    for (final s in added) {
      if (s.passed) {
        passed.add(s);
        continue;
      }
      final idx = cheapestInsertIndex([for (final x in seq) x.point], s.point, start: start, end: academy);
      seq.insert(idx, s);
      debugPrint('[nav] 새 정류장 ${s.name}: ${idx + 1}번째로 끼워 넣음 (${seq.map((x) => x.name).join(' → ')})');
    }
    stops
      ..clear()
      ..addAll(passed)
      ..addAll(seq);
  }

  _RouteInput? _inputFor(List<NavStop> list) {
    final remaining = list.where((s) => !s.passed).toList();
    if (academy != null) return _RouteInput(remaining, academy!);
    if (remaining.isEmpty) return null;
    return _RouteInput(remaining.sublist(0, remaining.length - 1), remaining.last.point);
  }

  Future<RoutePlan> _fetchPlan(RouteMode m, GeoPoint origin, _RouteInput input, {double? headingDeg}) async {
    var effectiveOrigin = origin;
    if (input.waypoints.isNotEmpty && distanceM(origin, input.destination) < 25) {
      effectiveOrigin = GeoPoint(origin.lat + 0.0002, origin.lng + 0.0002);
    }
    // 경로가 돌아갈 때 원인(출발점·정류장 순서)을 찾기 위해 서버로 보내는 좌표를 기록에 남긴다
    final shifted = effectiveOrigin.lat != origin.lat || effectiveOrigin.lng != origin.lng;
    debugPrint('[nav] 요청 ${m.key}: 출발 ${origin.lat},${origin.lng}'
        '${shifted ? ' (출발=도착이라 ${effectiveOrigin.lat},${effectiveOrigin.lng} 로 옮겨 보냄)' : ''}'
        ' / 도착 ${input.destination.lat},${input.destination.lng}'
        ' / 경유지 ${input.waypoints.length}개: '
        '${[for (var i = 0; i < input.waypoints.length; i++) '${i + 1}.${input.waypoints[i].name}(${input.waypoints[i].point.lat},${input.waypoints[i].point.lng})'].join(' → ')}');
    final raw = await _post('/directions/', {
      'origin': effectiveOrigin.toJson(),
      'destination': input.destination.toJson(),
      'waypoints': input.waypoints.take(30).map((s) => s.point.toJson()).toList(),
      'mode': m.key,
      if (headingDeg != null) 'heading': headingDeg.round() % 360,
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
    final provider = r['provider'] as String?;
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
      provider: provider,
    );
    debugPrint('[nav] ${m.key}: ${plan.distanceM.round()}m ${plan.durationS.round()}s '
        'turns=${plan.turnCount} points=${path.length} provider=$provider ($criteria)');
    return plan;
  }

  /// 운행 전: 안전·빠른 경로를 같은 출발지·경유지·도착지로 동시에 계산
  Future<void> previewRoutes() async {
    if (driving) return;
    _optimizeStopOrder();
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
        if (seq != _previewSeq) return;
        slots[m]!
          ..plan = plan
          ..status = PlanStatus.ready
          ..error = null;
      } catch (e) {
        if (seq != _previewSeq) return;
        slots[m]!
          ..plan = null
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
    final uturns = slots[mode]!.plan?.guides
        .where((g) => g.text.contains('유턴') || g.text.contains('U턴'))
        .map((g) => g.point)
        .toList();
    map.setRoutes(
      primary: slots[mode]!.plan?.path,
      traffic: slots[mode]!.plan?.traffic,
      alternate: slots[mode.other]!.plan?.path,
      stops: _stopsJson(stops),
      academy: academy,
      uturnPoints: uturns,
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
      // 달리는 중이면 차가 향하는 방향을 함께 보내고, 뒤로 출발하는 경로는 한 번 더 따져 본다
      final h = heading;
      final moving = driving && speedKmh >= _movingKmh && h != null;
      var plan = await _fetchPlan(mode, pos, input, headingDeg: moving ? h : null);
      if (seq != _routeSeq) return;
      if (moving) {
        plan = await _preferSensibleStart(plan, pos, h, input);
        if (seq != _routeSeq) return;
      }
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

  // 재탐색 방향 판단 기준
  static const double _movingKmh = 10; // 이 속도 이상일 때만 "앞으로 달리는 중"으로 본다
  static const double _backwardDeg = 120; // 차 방향과 이만큼 어긋나면 "뒤로 출발하는 경로"
  static const double _probeAheadM = 60; // 비교용으로 차 앞쪽 이만큼에서 다시 경로를 받는다
  static const double _uTurnMinSavingS = 90; // 뒤로 도는 경로를 고르려면 최소 이만큼(초) 빨라야 한다
  static const double _uTurnMinSavingRatio = 0.15; // …그리고 전체 시간의 15% 이상

  /// 달리는 중인데 새 경로가 차 뒤쪽으로 출발하면(유턴·반대 방향), 차 앞쪽에서 출발하는 경로도 받아 비교한다.
  /// - 유턴·반대 방향이 정말 빠르면(1분 30초 이상이면서 15% 이상) 그 경로를 그대로 쓴다.
  /// - 앞쪽 출발 경로도 결국 뒤로 돌라고 하면(막다른 길 등) 그 경로가 맞으므로 그대로 쓴다.
  /// - 그 밖에는 차가 가던 방향으로 이어지는 경로를 쓴다. (말도 안 되게 뒤로 돌리는 재탐색 방지)
  Future<RoutePlan> _preferSensibleStart(RoutePlan plan, GeoPoint pos, double h, _RouteInput input) async {
    final start = startBearing(plan.path);
    if (start == null || _angleDiff(start, h) < _backwardDeg) return plan;

    final ahead = offsetPoint(pos, h, _probeAheadM);
    final RoutePlan fwd;
    try {
      fwd = await _fetchPlan(plan.mode, ahead, input, headingDeg: h);
    } catch (e) {
      debugPrint('[nav] 앞쪽 출발 경로 조회 실패, 받은 경로 사용: $e');
      return plan;
    }
    final fwdStart = startBearing(fwd.path);
    if (fwdStart != null && _angleDiff(fwdStart, h) >= _backwardDeg) {
      debugPrint('[nav] 앞쪽에서 출발해도 뒤로 돌라고 함 → 유턴 경로 사용');
      return plan;
    }
    final speedMps = math.max(3.0, speedKmh / 3.6);
    final fwdTotalS = fwd.durationS + _probeAheadM / speedMps;
    final savingS = fwdTotalS - plan.durationS;
    if (savingS >= math.max(_uTurnMinSavingS, fwdTotalS * _uTurnMinSavingRatio)) {
      debugPrint('[nav] 유턴 경로가 ${savingS.round()}초 빠름 → 유턴 경로 사용');
      return plan;
    }
    debugPrint('[nav] 유턴 경로 이득 ${savingS.round()}초뿐 → 가던 방향 경로 사용');
    return _withLeadIn(fwd, pos);
  }

  /// 앞쪽에서 받은 경로 앞에 현재 위치를 붙여, 차가 경로 시작점까지 자연스럽게 이어지게 한다.
  RoutePlan _withLeadIn(RoutePlan p, GeoPoint pos) {
    final path = [pos, ...p.path];
    final leadM = distanceM(pos, p.path.first);
    for (final g in p.guides) {
      g.pathIndex += 1;
    }
    return RoutePlan(
      mode: p.mode,
      origin: pos,
      path: path,
      cum: cumulativeDistances(path),
      guides: p.guides,
      distanceM: p.distanceM + leadM,
      durationS: p.durationS + leadM / math.max(3.0, speedKmh / 3.6),
      turnCount: p.turnCount,
      traffic: [for (final t in p.traffic) TrafficSegment(t.from + 1, t.to + 1, t.state)],
      criteriaFromServer: p.criteriaFromServer,
      provider: p.provider,
    );
  }

  double? _roadBearingAt(List<GeoPoint> path, int index) {
    if (path.length < 2) return null;
    final startIdx = math.min(math.max(index, 0), path.length - 1);
    for (var i = startIdx + 1; i < path.length; i++) {
      if (distanceM(path[startIdx], path[i]) > 3) {
        return bearingDeg(path[startIdx], path[i]);
      }
    }
    return null;
  }

  void _activate(RoutePlan plan, {bool fit = false}) {
    active = plan;
    // 달리는 중에는 실제 진행 방향(GPS)을 그대로 둔다.
    // 새 경로의 첫 방향으로 덮어쓰면, 유턴 경로를 받았을 때 화살표가 뒤로 돌아
    // 바로 "진행 방향 어긋남"으로 다시 재탐색하는 반복이 생긴다.
    final initialRoadHeading = _roadBearingAt(plan.path, 0);
    final keepGpsHeading = driving && speedKmh >= _movingKmh && heading != null;
    if (initialRoadHeading != null && !keepGpsHeading) {
      heading = initialRoadHeading;
    }
    var from = 0;
    for (final s in activeStops.where((s) => !s.passed)) {
      s.pathIndex = nearestIndex(plan.path, s.point, from: from);
      from = s.pathIndex;
    }
    _progress = 0;
    _progressFrac = 0.0;
    _offRouteCount = 0;
    _simMeters = 0;

    final shouldFitOverview = fit && (!driving || !follow);
    if (shouldFitOverview) map.resetZoom();
    map.setHeadingUp(headingUp);
    final uturns = plan.guides
        .where((g) => g.text.contains('유턴') || g.text.contains('U턴'))
        .map((g) => g.point)
        .toList();
    map.setRoutes(
      primary: plan.path,
      traffic: plan.traffic,
      stops: _stopsJson(activeStops),
      academy: academy,
      uturnPoints: uturns,
      fit: shouldFitOverview,
    );
    map.updateRouteProgress(segmentIndex: 0, fraction: 0.0);
    _updateProgress();
    _syncRoutePathToServer(force: true);
    if (driving && position != null) {
      map.moveMe(position!, heading: heading, follow: follow, navigating: true, speedKmh: speedKmh.toDouble());
    }

    // 3단계: 새 경로를 받으면 첫 안내 음성을 즉시 냄
    if (driving) {
      final turn = nextTurn;
      if (turn != null) {
        final (d, text) = turn;
        NavGuide? g;
        for (final x in plan.guides) {
          if (x.pathIndex > _progress) {
            g = x;
            break;
          }
        }
        if (d <= 60) {
          if (g != null) {
            g.saidNear = true;
            g.saidFar = true;
          }
          _speak('곧 $text');
        } else {
          if (g != null) {
            g.saidFar = true;
          }
          _speak('${(d / 10).round() * 10}미터 앞에서 $text');
        }
      }
    }
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
      try {
        await _post('/teacher/start-operation');
      } catch (e) {
        debugPrint('[nav] start-operation API failed (404 ignored): $e');
      }
      routePreviewing = false;
      driving = true;
      serverLive = true;
      testMode = false;
      sentCount = 0;
      follow = true;
      headingUp = true;
      SocketService().connect(ApiService().token);
      _registerSocketListeners();
      if (vehicleId != null) SocketService().joinVehicleRoom(vehicleId!);
      SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: true);

      // 운행 중 화면 꺼짐 방지 활성화 + 다른 앱 위에 표시 권한 확인
      unawaited(_setKeepScreenOn(true));
      unawaited(_ensureOverlayPermissionOnStart());

      final ready = slots[mode]!.plan;
      if (ready != null &&
          distanceM(ready.origin, position!) < 150 &&
          DateTime.now().difference(ready.createdAt).inMinutes < 10) {
        _activate(ready, fit: false);
      } else {
        await _reroute(reason: 'start', fit: false);
      }
      _onPosition(position!, acc: accuracy);
      _syncOverlay();
    _syncRoutePathToServer();
      _speak('운행을 시작합니다. ${mode.title}로 안내합니다. 오늘도 안전 운행 부탁드립니다.');
    } catch (e) {
      actionError = e.toString();
    }
    busy = false;
    notifyListeners();
  }

  /// 아직 하차 처리 안 된(차에 타고 있는) 원아 이름. 확인하지 못하면 null
  Future<List<String>?> fetchUndroppedNames() async {
    if (!serverLive || testMode) return const [];
    try {
      final res = await ApiService()
          .getWithAuth(Uri.parse('${AppConfig.apiHost}/teacher/undropped-students'))
          .timeout(const Duration(seconds: 6));
      if (res.statusCode != 200) return null;
      final data = jsonDecode(utf8.decode(res.bodyBytes));
      final list = data is Map ? data['students'] : null;
      if (list is! List) return const [];
      return list.whereType<Map>().map((e) => e['name']?.toString() ?? '').where((n) => n.isNotEmpty).toList();
    } catch (_) {
      return null;
    }
  }

  /// 운행 종료. 서버가 "하차 안 된 원아가 있다"고 막으면 그 이름 목록을 돌려주고 운행은 그대로 둔다.
  /// ignoreUndropped: 기사가 경고를 보고도 종료하기로 한 경우 (서버에 기록이 남고 원장님께 알림)
  Future<List<String>?> stop({bool interiorChecked = true, bool ignoreUndropped = false}) async {
    busy = true;
    notifyListeners();
    if (serverLive && !testMode) {
      try {
        final res = await ApiService().postWithAuth(
          Uri.parse('${AppConfig.apiHost}/teacher/end-operation'),
          {'interiorChecked': interiorChecked, 'ignoreUndropped': ignoreUndropped},
        );
        if (res.statusCode == 409) {
          final data = jsonDecode(utf8.decode(res.bodyBytes));
          final list = data is Map ? (data['students'] ?? (data['message'] is Map ? data['message']['students'] : null)) : null;
          final names = list is List
              ? list.whereType<Map>().map((e) => e['name']?.toString() ?? '').where((n) => n.isNotEmpty).toList()
              : <String>[];
          busy = false;
          notifyListeners();
          return names.isEmpty ? ['(이름 확인 필요)'] : names;
        }
        if (res.statusCode >= 400) {
          actionError = '운행 종료가 서버에 전달되지 않았습니다. (${res.statusCode}) 연결 후 다시 운행 종료를 눌러 주세요.';
        }
      } catch (e) {
        // 화면상으로는 운행이 끝나지만 서버에는 아직 운행 중으로 남을 수 있다 -> 반드시 알린다
        actionError = '운행 종료가 서버에 전달되지 않았습니다. ${friendlyError(e)} 연결 후 다시 운행 종료를 눌러 주세요.';
      }
    }
    _stopSimulation();
    unawaited(_setKeepScreenOn(false));
    if (serverLive && vehicleId != null) {
      SocketService().sendOperationStatus(vehicleId: vehicleId!, isOperating: false);
    }
    _resetDriving();
    _syncOverlay();
    _syncRoutePathToServer();
    busy = false;
    notifyListeners();
    _speak(testMode ? '테스트를 종료합니다.' : '차량 내부 확인이 완료되어 운행을 종료합니다. 수고하셨습니다.');
    testMode = false;
    _testStops.clear();
    for (final s in stops) {
      s.passed = false;
      s.saidApproach = false;
    }
    if (position != null) {
      map.moveMe(position!, heading: heading);
      map.centerOn(position!, zoom: 15);
    }
    await previewRoutes();
    return null;
  }

  void _resetDriving() {
    driving = false;
    routePreviewing = false;
    serverLive = false;
    active = null;
    rerouting = false;
    routeWarning = null;
    speedKmh = 0;
    isOverspeeding = false;
    departSignalBanner = null;
    _departBannerTimer?.cancel();
    _routeSeq++;
    map.resetZoom();
  }

  void setFollow(bool v) {
    follow = v;
    if (v && position != null) {
      if (driving) {
        headingUp = true;
        map.setHeadingUp(true);
        map.moveMe(position!, heading: heading, follow: true, navigating: true, speedKmh: speedKmh.toDouble());
      } else {
        map.centerOn(position!, zoom: 15);
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
      map.centerOn(position!, zoom: 15);
    }
  }

  /// 주행 중 화면 방향 전환 (진행 방향 위 ↔ 북쪽 고정)
  void toggleHeadingUp() {
    headingUp = !headingUp;
    map.setHeadingUp(headingUp);
    if (driving && position != null) {
      setFollow(true);
    }
    notifyListeners();
  }

  // ───────────── 위치 및 안전 운전 처리 ─────────────

  void _evaluateSafety(GeoPoint p, {double? speedMps, required bool simulated}) {
    final now = DateTime.now();
    final newSpeed = simulated
        ? 28
        : (speedMps != null && speedMps > 0.5 ? (speedMps * 3.6).round() : 0);

    // 1) 급정거 감지 (1.5초 이내에 시속 14km 이상 급감속)
    final dtMs = now.difference(_prevSpeedAt).inMilliseconds;
    if (driving && dtMs > 150 && dtMs <= 2000 && (_prevSpeedKmh - newSpeed) >= 14) {
      if (now.difference(_lastSuddenStopAlert).inSeconds > 20) {
        _lastSuddenStopAlert = now;
        _speak('급정거가 감지되었습니다. 안전 거리를 유지해 주세요.');
        unawaited(_logSafetyEventToServer(
          'SUDDEN_STOP',
          '안전운전 기록: 급정거 감지 (${_prevSpeedKmh}km/h → ${newSpeed}km/h)',
        ));
      }
    }
    _prevSpeedKmh = speedKmh;
    _prevSpeedAt = now;
    speedKmh = newSpeed;

    // 2) 과속 감지 (일반도로 80km/h 초과)
    const limit = 80;
    isOverspeeding = driving && speedKmh > limit;
    if (isOverspeeding && now.difference(_lastOverspeedAlert).inSeconds > 25) {
      _lastOverspeedAlert = now;
      _speak('과속입니다. 규정 속도를 준수해 주세요.');
      unawaited(_logSafetyEventToServer(
        'OVERSPEED',
        '안전운전 기록: 과속 감지 (${speedKmh}km/h)',
      ));
    }
  }

  void _onPosition(GeoPoint p, {double? acc, double? gpsHeading, double? speedMps, bool simulated = false}) {
    final prev = position;
    position = p;
    if (acc != null) accuracy = acc;

    _evaluateSafety(p, speedMps: speedMps, simulated: simulated);

    if (!driving) {
      final speedMpsVal = speedMps ?? (speedKmh / 3.6);
      if (speedMpsVal >= 2.0 && gpsHeading != null && gpsHeading >= 0) {
        heading = gpsHeading;
      } else if (speedMpsVal >= 2.0 && prev != null && distanceM(prev, p) > 2) {
        heading = bearingDeg(prev, p);
      }
      map.moveMe(p, heading: heading, speedKmh: speedKmh.toDouble());
      notifyListeners();
      return;
    }

    _checkStopArrival(p);
    _updateProgress(gpsHeading: gpsHeading, speedMps: speedMps, prev: prev);
    map.moveMe(
      p,
      heading: heading,
      follow: follow,
      navigating: true,
      speedKmh: speedKmh.toDouble(),
      routeProgressIndex: _progress,
      routeProgressFraction: _progressFrac,
    );

    // 실제 도로 기준 남은 시간(ETA)과 위치를 서버로 자동 전송 (오프라인 시 큐에 저장 후 자동 재전송)
    final mayLeaveDevice = serverLive && !testMode && (!simulated || simSendToServer);
    if (mayLeaveDevice && vehicleId != null) {
      final a = active;
      final remSec = a == null ? null : (remainingM / a.avgSpeed).round();
      final nextDist = nextStopDistance;
      final nextEtaSec = (a != null && nextDist != null) ? (nextDist / a.avgSpeed).round() : null;
      SocketService().sendLocationUpdate(
        vehicleId: vehicleId!,
        lat: p.lat,
        lng: p.lng,
        remainingSeconds: remSec,
        remainingMeters: remainingM.round(),
        nextStopName: nextStop?.name,
        nextStopEtaSeconds: nextEtaSec,
        speedKmh: speedKmh,
      );
      if (SocketService().isConnected) {
        sentCount++;
        lastSentAt = DateTime.now();
      }
    }
    notifyListeners();
  }

  void _checkStopArrival(GeoPoint p) {
    final list = activeStops;
    final nextIdx = list.indexWhere((s) => !s.passed);
    if (nextIdx < 0) return;

    // 1) 다음 정류장 160m 전방 접근 시 정확한 정차 지점 메모 음성 안내
    final next = list[nextIdx];
    final nextDist = distanceM(p, next.point);
    if (nextDist <= 160 && nextDist > 45 && !next.saidApproach) {
      next.saidApproach = true;
      _speak('잠시 후 다음 정류장, ${next.name}, ${next.stopMemo}해 주세요.');
    }

    // 2) 정류장 도착 (40m 이내). 다음 정류장이 아닌 뒤 정류장에 먼저 닿으면(순서가 바뀌거나 들르지 않음)
    //    그 앞의 남은 정류장은 '건너뜀'으로 표시해서 다음 정류장이 막혀 있지 않게 한다.
    for (var i = nextIdx; i < list.length; i++) {
      final s = list[i];
      if (s.passed) continue;
      if (distanceM(p, s.point) >= 40) continue;
      final skippedNames = <String>[];
      for (var j = nextIdx; j < i; j++) {
        final sk = list[j];
        if (sk.passed) continue;
        sk.passed = true;
        sk.skipped = true;
        sk.arrivedAt = DateTime.now();
        map.markStopPassed(j);
        skippedNames.add(sk.name);
      }
      s.passed = true;
      s.saidApproach = true;
      s.arrivedAt = DateTime.now();
      map.markStopPassed(i);
      _logStopEvent('STOP_ARRIVED', '${s.name} 정류장 도착');
      if (skippedNames.isNotEmpty) {
        _logStopEvent('STOP_SKIPPED', '${skippedNames.join(', ')} 정류장을 들르지 않고 ${s.name} 정류장에 먼저 도착 (계획 순서와 다름)');
        _speak('${skippedNames.join(', ')} 정류장을 들르지 않았습니다. 확인해 주세요.');
      }
      _speak('${s.name} 정류장에 도착했습니다. ${s.stopMemo}. 원아 탑승 후 차량선생님의 출발 신호를 기다려 주세요.');
      break;
    }
  }

  static double _angleDiff(double a, double b) {
    final d = ((a - b).abs()) % 360.0;
    return d > 180.0 ? 360.0 - d : d;
  }

  /// 경로 선분 중 p 와 가장 가까운 선분 인덱스, 선분 내 비율(0~1), 스냅 좌표, 이탈 거리(m), 도로 방향(도), 유효 스냅 여부를 구한다.
  /// 1단계 개선: 현재 진행 위치(_progress) 기준 앞쪽 300m 이내의 구간만 후보로 하며,
  /// 속도 3m/s 이상 주행 시 진행 방향과 60도 초과 차이나는 반대 방향/이탈 구간은 스냅하지 않는다.
  (int, double, GeoPoint, double, double, bool) _findNearestSegment(
    List<GeoPoint> path,
    GeoPoint p, {
    int from = 0,
    List<double>? cumDist,
    double forwardMeters = 300.0,
    double? gpsHeading,
    double? speedMps,
  }) {
    if (path.isEmpty) return (0, 0.0, p, 0.0, 0.0, false);
    if (path.length == 1) {
      final d = distanceM(path[0], p);
      return (0, 0.0, path[0], d, 0.0, d <= 35.0);
    }

    final start = math.max(0, from).clamp(0, path.length - 2);
    final maxEnd = path.length - 2;

    int end = start;
    if (cumDist != null && cumDist.length == path.length) {
      final baseCum = cumDist[start];
      while (end < maxEnd) {
        if (cumDist[end + 1] - baseCum > forwardMeters && (end - start) >= 2) {
          break;
        }
        end++;
      }
    } else {
      double acc = 0;
      while (end < maxEnd) {
        acc += distanceM(path[end], path[end + 1]);
        if (acc > forwardMeters && (end - start) >= 2) {
          break;
        }
        end++;
      }
    }

    var bestSeg = start;
    var bestT = 0.0;
    var bestPoint = path[start];
    var bestDist = double.infinity;
    var bestBearing = bearingDeg(path[start], path[start + 1]);
    bool foundValid = false;

    final filterHeading = (speedMps != null && speedMps >= 3.0 && gpsHeading != null && gpsHeading >= 0);

    for (var i = start; i <= end; i++) {
      final a = path[i];
      final b = path[i + 1];

      final segBearing = bearingDeg(a, b);
      if (filterHeading && _angleDiff(segBearing, gpsHeading) > 60.0) {
        // 주행 중 진행 방향과 60도 초과 차이나는 반대 구간/역방향 제외
        continue;
      }

      final cosLat = math.cos(a.lat * math.pi / 180.0);
      final dx = (b.lng - a.lng) * cosLat;
      final dy = b.lat - a.lat;
      final lenSq = dx * dx + dy * dy;

      double t;
      if (lenSq < 1e-12) {
        t = 0.0;
      } else {
        final px = (p.lng - a.lng) * cosLat;
        final py = p.lat - a.lat;
        t = ((px * dx) + (py * dy)) / lenSq;
        t = t.clamp(0.0, 1.0);
      }

      final projLat = a.lat + t * (b.lat - a.lat);
      final projLng = a.lng + t * (b.lng - a.lng);
      final projPoint = GeoPoint(projLat, projLng);
      final dist = distanceM(projPoint, p);

      if (dist < bestDist) {
        bestDist = dist;
        bestSeg = i;
        bestT = t;
        bestPoint = projPoint;
        bestBearing = segBearing;
        foundValid = true;
      }
    }

    final isSnapped = foundValid && bestDist <= 35.0;
    if (!isSnapped) {
      final fallbackDist = distanceM(path[start], p);
      final fallbackBearing = bearingDeg(path[start], path[math.min(start + 1, path.length - 1)]);
      return (start, 0.0, path[start], fallbackDist, fallbackBearing, false);
    }

    return (bestSeg, bestT, bestPoint, bestDist, bestBearing, true);
  }

  void _updateProgress({double? gpsHeading, double? speedMps, GeoPoint? prev}) {
    final a = active;
    final pos = position;
    if (a == null || pos == null) return;

    final speedMpsVal = speedMps ?? (speedKmh / 3.6);

    final (segIdx, frac, _, off, roadBearing, isSnapped) = _findNearestSegment(
      a.path,
      pos,
      from: _progress,
      cumDist: a.cum,
      forwardMeters: 300.0,
      gpsHeading: gpsHeading,
      speedMps: speedMpsVal,
    );

    // 1단계: 진행 위치는 항상 앞으로만 움직임
    if (isSnapped) {
      if (segIdx > _progress || (segIdx == _progress && frac >= _progressFrac)) {
        _progress = segIdx;
        _progressFrac = frac;
      }
    }

    // 2단계 화살표 방향:
    // 속도가 3m/s 이상이면 GPS 방향, 그 아래는 1단계의 앞방향 도로 구간 방향, 정지 중(0.5m/s 미만)에는 마지막 값 유지.
    // 도로 반대 방향은 절대 쓰지 않는다.
    if (speedMpsVal >= 3.0 && gpsHeading != null && gpsHeading >= 0) {
      heading = gpsHeading;
    } else if (speedMpsVal >= 3.0 && prev != null && distanceM(prev, pos) > 2) {
      heading = bearingDeg(prev, pos);
    } else if (speedMpsVal >= 0.5 && isSnapped) {
      heading = roadBearing;
    }
    // speedMpsVal < 0.5 이면 이전 heading 유지

    // 3단계 빠른 재탐색:
    // 이탈 조건: 경로와 거리 35m 이상이거나, 진행 방향과 경로 방향 차이가 100도 이상인 상태가 연속 2회
    final curHeading = heading;
    final headingDeviated = (speedMpsVal >= 3.0 && curHeading != null)
        ? _angleDiff(curHeading, roadBearing) >= 100.0
        : false;
    // 멈춰 있을 때(시속 3.6km 미만)는 GPS 흔들림일 뿐이라 이탈로 보지 않는다 (제자리에서 재탐색 반복 방지)
    final isStationary = speedMpsVal < 1.0 && !simulating;
    final isOff = !isStationary && ((!isSnapped && off >= 35.0) || headingDeviated);

    // 경로 위로 돌아오면 재탐색 간격을 처음(8초)으로 되돌린다
    if (isSnapped && !headingDeviated) _rerouteStreak = 0;

    _offRouteCount = isOff ? _offRouteCount + 1 : 0;
    // 재탐색 간격: 8초 → 16초 → 32초 … 최대 120초 (재탐색해도 계속 경로 밖이면 점점 드물게)
    final gapSec = math.min(_rerouteMaxGapSec, _rerouteBaseGapSec * (1 << math.min(_rerouteStreak, 4)));
    if (_offRouteCount >= 2 && !rerouting && DateTime.now().difference(_lastReroute).inSeconds >= gapSec) {
      _offRouteCount = 0;
      _lastReroute = DateTime.now();
      // 음성 안내는 처음 한 번만 (계속 '다시 찾습니다'라고 말하지 않게)
      if (_rerouteStreak == 0) _speak('경로를 다시 찾습니다.');
      _rerouteStreak++;
      _reroute(reason: 'off-route');
      return;
    }

    _syncOverlay();
    _syncRoutePathToServer();

    final turn = nextTurn;
    if (turn == null) return;
    final (d, text) = turn;
    NavGuide? g;
    for (final x in a.guides) {
      if (x.pathIndex > _progress) {
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
    const offsets = [
      (0.004, 0.003, '1단지 정문 앞, 오른쪽에 정차'),
      (0.006, -0.002, '상가 입구 앞, 오른쪽에 정차'),
      (0.002, -0.005, '어린이놀이터 앞, 오른쪽에 정차'),
      (-0.003, -0.003, '사거리 모퉁이 지나 오른쪽에 정차'),
    ];
    _testStops
      ..clear()
      ..addAll([
        for (var i = 0; i < offsets.length; i++)
          NavStop(
            '테스트 ${i + 1}단지',
            GeoPoint(center.lat + offsets[i].$1, center.lng + offsets[i].$2),
            stopMemo: offsets[i].$3,
            isTest: true,
          ),
      ]);
    testMode = true;
    driving = true;
    serverLive = false;
    follow = true;
    headingUp = true;
    position = center;
    unawaited(_setKeepScreenOn(true));
    unawaited(_ensureOverlayPermissionOnStart());
    await _reroute(reason: 'test', fit: false);
    busy = false;
    notifyListeners();
    if (active != null) {
      _syncOverlay();
    _syncRoutePathToServer();
      _speak('테스트 경로를 시작합니다. 실제 운행이 아닙니다.');
      startSimulation();
    } else {
      testMode = false;
      _resetDriving();
      _syncOverlay();
    _syncRoutePathToServer();
      _testStops.clear();
      _drawPreview();
      notifyListeners();
    }
  }

  /// 경로를 따라 1초마다 가짜 위치 이동 (약 28km/h)
  void startSimulation() {
    if (!driving || active == null || simulating) return;
    simulating = true;
    _simMeters = active!.cum[_progress];
    _simTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      final a = active;
      if (a == null) return;
      _simMeters = math.min(_simMeters + 11, a.cum.last);
      var p = pointAlong(a.path, a.cum, _simMeters);
      double? simHeading;

      if (_wrongTurnTicks > 0) {
        _wrongTurnTicks--;
        // 6단계 ②: 교차로에서 반대 방향으로 잘못 진입 (도로 방향과 180도 반대로 주행)
        final roadHeading = _roadBearingAt(a.path, _progress) ?? 0.0;
        simHeading = (roadHeading + 180.0) % 360.0;
        p = GeoPoint(p.lat - 0.0004, p.lng);
      } else if (_offRouteTestTicks > 0) {
        _offRouteTestTicks--;
        p = GeoPoint(p.lat + 0.0012, p.lng); // 북쪽으로 약 130m 벗어남
      }

      _onPosition(p, gpsHeading: simHeading, speedMps: 11.0, simulated: true);
      if (_simMeters >= a.cum.last) _stopSimulation();
    });
    notifyListeners();
  }

  void _stopSimulation() {
    _simTimer?.cancel();
    _simTimer = null;
    simulating = false;
    speedKmh = 0;
    _offRouteTestTicks = 0;
    _wrongTurnTicks = 0;
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
    _rerouteStreak = 0;
    notifyListeners();
  }

  int _wrongTurnTicks = 0;

  /// 6단계 ②: 교차로에서 반대 방향으로 잘못 진입 테스트 (2~3초 내 재탐색 확인용)
  void simulateWrongTurn() {
    if (!simulating) return;
    _wrongTurnTicks = 3;
    _lastReroute = DateTime.fromMillisecondsSinceEpoch(0);
    _rerouteStreak = 0;
    notifyListeners();
  }

  void _speak(String text) {
    _tts.stop();
    _tts.speak(text);
  }

  @override
  void dispose() {
    _departBannerTimer?.cancel();
    _stopSimulation();
    _gpsSub?.cancel();
    _tts.stop();
    unawaited(_setKeepScreenOn(false));
    super.dispose();
  }
}
