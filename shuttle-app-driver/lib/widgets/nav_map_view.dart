import 'dart:math' as math;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' hide Path;

import 'nav_map_controller.dart';
import 'nav_map_view_naver.dart';

export 'nav_map_controller.dart';

/// secrets.json (--dart-define-from-file) 에서 받는 네이버 지도 Client ID
const String naverMapClientId = String.fromEnvironment('NAVER_MAP_CLIENT_ID');

/// 네이버 지도 SDK 초기화/인증 성공 여부 (main.dart 에서 초기화 후 갱신, 인증 실패 시 false 로 바뀌어 이전 지도로 복귀)
final ValueNotifier<bool> naverMapAvailable = ValueNotifier<bool>(false);

/// 네이버 지도를 쓰지 못하고 OpenStreetMap 으로 대신 표시하는 이유 (디버그 화면 표시용)
final ValueNotifier<String> naverMapFallbackReason = ValueNotifier<String>('');

/// 지도 선택: NAVER_MAP_CLIENT_ID 가 있고 SDK 인증이 성공하면 네이버 지도.
/// 키가 없거나 인증/초기화에 실패한 경우(또는 웹)에만 OpenStreetMap 으로 대신 표시한다.
bool get _useNaver => naverMapClientId.isNotEmpty && !kIsWeb;

class NavMapView extends StatelessWidget {
  final NavMapController controller;

  const NavMapView({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    if (!_useNaver) {
      return _withLabel(
        FlutterMapNavView(controller: controller),
        'OSM',
        kIsWeb
            ? '웹에서는 네이버 지도를 쓸 수 없음'
            : 'NAVER_MAP_CLIENT_ID 없음 (--dart-define-from-file=secrets.json 으로 실행하세요)',
      );
    }
    return ValueListenableBuilder<bool>(
      valueListenable: naverMapAvailable,
      builder: (context, ok, _) => ok
          ? _withLabel(NaverNavMapView(controller: controller), 'NAVER', null)
          : _withLabel(
              FlutterMapNavView(controller: controller),
              'OSM',
              naverMapFallbackReason.value.isEmpty ? '네이버 지도 초기화 대기/실패' : naverMapFallbackReason.value,
            ),
    );
  }

  /// 디버그 모드에서만 어떤 지도를 쓰는지 구석에 작게 표시 (대체 지도면 이유도 함께 표시)
  Widget _withLabel(Widget map, String name, String? warning) {
    if (!kDebugMode) return map;
    return Stack(
      children: [
        Positioned.fill(child: map),
        Positioned(
          top: 4,
          right: 4,
          left: warning == null ? null : 4,
          child: IgnorePointer(
            child: Align(
              alignment: Alignment.topRight,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                decoration: BoxDecoration(
                  color: warning == null ? Colors.black54 : const Color(0xCCEA580C),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  warning == null ? '지도: $name' : '지도: $name · $warning',
                  textAlign: TextAlign.right,
                  style: const TextStyle(color: Colors.white, fontSize: 10),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class FlutterMapNavView extends StatefulWidget {
  final NavMapController controller;

  const FlutterMapNavView({super.key, required this.controller});

  @override
  State<FlutterMapNavView> createState() => _FlutterMapNavViewState();
}

class _FlutterMapNavViewState extends State<FlutterMapNavView> with SingleTickerProviderStateMixin {
  late final MapController _mapController;
  late final Ticker _ticker;
  Duration? _lastTick;

  Size _mapSize = const Size(400, 800);

  // 현재 애니메이션 상태
  double _animatedLat = 37.5665;
  double _animatedLng = 126.9780;
  double _animatedHeading = 0.0;
  double _animatedZoom = NavMapConfig.defaultNavZoom;
  double _animatedYRatio = 0.5;

  // 목표 상태 (GPS 수신 및 상태 변경 시 갱신)
  LatLng _targetPos = const LatLng(37.5665, 126.9780);
  double _targetHeading = 0.0;
  double _lastValidHeading = 0.0;
  double _targetZoom = NavMapConfig.defaultNavZoom;
  double _targetYRatio = 0.5;

  bool _isFollowing = false;
  bool _isNavigating = false;
  bool _headingUp = true;
  bool _hasInitialLocation = false;
  bool _isInitialFitDone = false;
  bool _isMapReady = false;

  // 도로 추종 및 예측·보정 상태
  bool _isSnappedToRoute = false;
  DateTime? _lastGpsTime;
  double _correctionOffsetX = 0.0;
  double _correctionOffsetY = 0.0;
  double _correctionRemainingSec = 0.0;

  bool get _canUseMapController {
    if (!_isMapReady || !mounted) return false;
    try {
      // ignore: unnecessary_statements
      _mapController.camera;
      return true;
    } catch (_) {
      return false;
    }
  }

  NavMapControllerImpl get _impl => widget.controller as NavMapControllerImpl;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();

    _bindController();

    _ticker = createTicker(_onTick);
    _ticker.start();
  }

  void _bindController() {
    _impl.addListener(_onControllerUpdated);
    _impl.onCenterOn = (p, zoom) {
      _isFollowing = false;
      _targetYRatio = 0.5;
      _targetZoom = zoom.toDouble();
      _animatedZoom = zoom.toDouble();
      _animatedLat = p.lat;
      _animatedLng = p.lng;
      if (_canUseMapController) {
        try {
          _mapController.move(LatLng(p.lat, p.lng), _targetZoom, offset: Offset.zero);
          if (!_headingUp) {
            _mapController.rotate(0.0);
          }
        } catch (e) {
          debugPrint('[nav_map_view] onCenterOn error: $e');
        }
      }
    };
    _impl.onFitAll = _fitAllBounds;
    _impl.onResetZoom = () {
      _isFollowing = false;
      _targetYRatio = 0.5;
      _headingUp = false;
      if (_canUseMapController) {
        try {
          _mapController.rotate(0.0);
        } catch (e) {
          debugPrint('[nav_map_view] onResetZoom error: $e');
        }
      }
    };

    // 초기 상태 동기화
    _onControllerUpdated();
  }

  @override
  void didUpdateWidget(covariant FlutterMapNavView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      (oldWidget.controller as NavMapControllerImpl).removeListener(_onControllerUpdated);
      _bindController();
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _impl.removeListener(_onControllerUpdated);
    _impl.onCenterOn = null;
    _impl.onFitAll = null;
    _impl.onResetZoom = null;
    _mapController.dispose();
    super.dispose();
  }

  void _onControllerUpdated() {
    final curPos = _impl.currentPosition;
    final heading = _impl.currentHeading;
    final speed = _impl.currentSpeedKmh ?? 0.0;
    final follow = _impl.isFollowing;
    final navigating = _impl.isNavigating;
    final headingUp = _impl.headingUp;

    _isFollowing = follow;
    _isNavigating = navigating;
    _headingUp = headingUp;

    if (curPos != null) {
      final rawLat = curPos.lat;
      final rawLng = curPos.lng;
      final rawLatLng = LatLng(rawLat, rawLng);

      // 주행 중이면 경로선에 30m 이내 스냅
      final primary = _getPrimaryRouteLatLngs();
      final (snapped, segIdx, frac, isSnapped) = navigating
          ? _snapToRouteDetail(rawLatLng, primary)
          : (rawLatLng, 0, 0.0, false);
      _targetPos = snapped;
      _isSnappedToRoute = isSnapped;

      if (!_hasInitialLocation) {
        _hasInitialLocation = true;
        _animatedLat = snapped.latitude;
        _animatedLng = snapped.longitude;
        _correctionOffsetX = 0.0;
        _correctionOffsetY = 0.0;
        _correctionRemainingSec = 0.0;
      } else if (navigating) {
        // 새 GPS 가 오면 0.3초에 걸쳐 현재 표시 위치와 새 스냅 위치 사이 오차를 보정
        _correctionOffsetY = snapped.latitude - _animatedLat;
        _correctionOffsetX = snapped.longitude - _animatedLng;
        _correctionRemainingSec = NavMapConfig.reconciliationSeconds;
      }
      _lastGpsTime = DateTime.now();

      // 회전각 처리 (정지 상태 시 흔들림 방지)
      if (heading != null && !heading.isNaN) {
        if (speed >= NavMapConfig.stationarySpeedThreshold) {
          _lastValidHeading = heading;
          _targetHeading = _shortestAngle(_animatedHeading, heading);
        } else {
          // 정지 중에는 마지막 방향 유지
          _targetHeading = _shortestAngle(_animatedHeading, _lastValidHeading);
        }
      }

      // 속도에 따른 줌 및 화면 세로 화살표 비율 (카카오내비식 앞쪽 시야)
      if (navigating && follow && headingUp) {
        if (speed < NavMapConfig.speedLowThreshold) {
          _targetZoom = NavMapConfig.zoomLowSpeed;
          _targetYRatio = NavMapConfig.arrowRatioLowSpeed;
        } else if (speed < NavMapConfig.speedHighThreshold) {
          _targetZoom = NavMapConfig.zoomMidSpeed;
          _targetYRatio = NavMapConfig.arrowRatioMidSpeed;
        } else {
          _targetZoom = NavMapConfig.zoomHighSpeed;
          _targetYRatio = NavMapConfig.arrowRatioHighSpeed;
        }
      } else {
        _targetYRatio = 0.5; // 가운데
      }
    }

    if (_impl.shouldFitOnRoutes && !_isInitialFitDone && !_isNavigating && _canUseMapController) {
      _fitAllBounds();
      _isInitialFitDone = true;
    }

    if (mounted) setState(() {});
  }

  void _onTick(Duration elapsed) {
    if (!_canUseMapController) return;
    if (_lastTick == null) {
      _lastTick = elapsed;
      return;
    }
    final dt = (elapsed - _lastTick!).inMicroseconds / 1000000.0;
    _lastTick = elapsed;

    final clampedDt = dt.clamp(0.001, 0.1);

    if (_isFollowing && _isNavigating) {
      final now = DateTime.now();
      final speedMps = ((_impl.currentSpeedKmh ?? 0.0) / 3.6);
      final sinceGps = _lastGpsTime != null
          ? (now.difference(_lastGpsTime!).inMilliseconds / 1000.0)
          : 0.0;

      // 1. 도로 따라 예측 이동: GPS 사이에는 마지막 속도로 경로를 따라 예측 이동 (최대 2초, 속도 0 근처면 정지)
      if (_isSnappedToRoute && sinceGps <= NavMapConfig.predictionMaxSeconds && speedMps > 0.5) {
        final moveMeters = speedMps * clampedDt;
        final primary = _getPrimaryRouteLatLngs();
        _advanceAlongRoute(moveMeters, primary);
      }

      // 2. 새 GPS 가 오면 0.3초에 걸쳐 보정
      if (_correctionRemainingSec > 0.001) {
        final stepFactor = (clampedDt / _correctionRemainingSec).clamp(0.0, 1.0);
        _animatedLat += _correctionOffsetY * stepFactor;
        _animatedLng += _correctionOffsetX * stepFactor;
        _correctionOffsetY -= _correctionOffsetY * stepFactor;
        _correctionOffsetX -= _correctionOffsetX * stepFactor;
        _correctionRemainingSec -= clampedDt;
      } else if (!_isSnappedToRoute) {
        // 경로 밖(스냅 해제)일 때는 일반 부드러운 이동
        final posFactor = (clampedDt / 0.3).clamp(0.0, 1.0);
        _animatedLat += (_targetPos.latitude - _animatedLat) * posFactor;
        _animatedLng += (_targetPos.longitude - _animatedLng) * posFactor;
      }

      // 3. 방향 부드러운 보간 (최단 각도 회전)
      final headingFactor = (clampedDt / NavMapConfig.headingLerpDuration).clamp(0.0, 1.0);
      _animatedHeading += (_targetHeading - _animatedHeading) * headingFactor;

      // 4. 줌 레벨 부드러운 보간
      final zoomFactor = (clampedDt / NavMapConfig.zoomLerpDuration).clamp(0.0, 1.0);
      _animatedZoom += (_targetZoom - _animatedZoom) * zoomFactor;

      // 5. 화면 화살표 Y비율 부드러운 보간
      final ratioFactor = (clampedDt / NavMapConfig.ratioLerpDuration).clamp(0.0, 1.0);
      _animatedYRatio += (_targetYRatio - _animatedYRatio) * ratioFactor;

      _applyCameraUpdate();
    } else if (_isFollowing && !_isNavigating) {
      final posFactor = (clampedDt / 0.3).clamp(0.0, 1.0);
      _animatedLat += (_targetPos.latitude - _animatedLat) * posFactor;
      _animatedLng += (_targetPos.longitude - _animatedLng) * posFactor;
      _animatedYRatio = 0.5;

      try {
        _mapController.move(LatLng(_animatedLat, _animatedLng), _animatedZoom, offset: Offset.zero);
      } catch (e) {
        debugPrint('[nav_map_view] tick move error: $e');
      }
      if (mounted) setState(() {});
    }
  }

  void _applyCameraUpdate() {
    if (!mounted || !_canUseMapController) return;
    final viewHeight = _mapSize.height;
    final yOffset = viewHeight * (_animatedYRatio - 0.5);
    final offset = Offset(0, yOffset);

    try {
      if (_headingUp) {
        _mapController.rotate(-_animatedHeading);
        _mapController.move(
          LatLng(_animatedLat, _animatedLng),
          _animatedZoom,
          offset: offset,
        );
      } else {
        _mapController.rotate(0.0);
        _mapController.move(
          LatLng(_animatedLat, _animatedLng),
          _animatedZoom,
          offset: Offset.zero,
        );
      }
    } catch (e) {
      debugPrint('[nav_map_view] applyCameraUpdate error: $e');
    }

    setState(() {});
  }

  void _fitAllBounds() {
    if (!_canUseMapController) return;
    final pts = <LatLng>[];

    final pri = _getPrimaryRouteLatLngs();
    if (pri != null) pts.addAll(pri);

    final alt = _getAlternateRouteLatLngs();
    if (alt != null) pts.addAll(alt);

    for (final s in _impl.stops) {
      final lat = s['lat'] as num?;
      final lng = s['lng'] as num?;
      if (lat != null && lng != null) {
        pts.add(LatLng(lat.toDouble(), lng.toDouble()));
      }
    }

    if (_impl.academy != null) {
      pts.add(LatLng(_impl.academy!.lat, _impl.academy!.lng));
    }

    if (_impl.currentPosition != null) {
      pts.add(LatLng(_impl.currentPosition!.lat, _impl.currentPosition!.lng));
    }

    if (pts.isEmpty) return;

    final bounds = LatLngBounds.fromPoints(pts);
    try {
      _mapController.rotate(0.0);
      _mapController.fitCamera(
        CameraFit.bounds(
          bounds: bounds,
          padding: const EdgeInsets.all(50),
          maxZoom: 16.0,
        ),
      );
    } catch (e) {
      debugPrint('[nav_map_view] fitAllBounds error: $e');
    }
  }

  List<LatLng>? _getPrimaryRouteLatLngs() {
    if (_impl.primaryRoute == null) return null;
    return _impl.primaryRoute!.map((e) => LatLng(e.lat, e.lng)).toList();
  }

  List<LatLng>? _getAlternateRouteLatLngs() {
    if (_impl.alternateRoute == null) return null;
    return _impl.alternateRoute!.map((e) => LatLng(e.lat, e.lng)).toList();
  }

  static double _shortestAngle(double from, double to) {
    final diff = ((to - from + 540) % 360) - 180;
    return from + diff;
  }

  static double _angleDiff(double a, double b) {
    final d = ((a - b).abs()) % 360.0;
    return d > 180.0 ? 360.0 - d : d;
  }

  static double _bearingBetween(LatLng a, LatLng b) {
    const rad = math.pi / 180.0;
    final lat1 = a.latitude * rad;
    final lat2 = b.latitude * rad;
    final dLng = (b.longitude - a.longitude) * rad;
    final y = math.sin(dLng) * math.cos(lat2);
    final x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLng);
    return (math.atan2(y, x) * 180.0 / math.pi + 360.0) % 360.0;
  }

  static double _distanceMeters(LatLng a, LatLng b) {
    const rad = math.pi / 180.0;
    const r = 6371000.0;
    final dLat = (b.latitude - a.latitude) * rad;
    final dLng = (b.longitude - a.longitude) * rad;
    final sinLat = math.sin(dLat / 2);
    final sinLng = math.sin(dLng / 2);
    final h = sinLat * sinLat + math.cos(a.latitude * rad) * math.cos(b.latitude * rad) * sinLng * sinLng;
    return 2 * r * math.asin(math.min(1.0, math.sqrt(h)));
  }

  static LatLng _offsetPointRight(LatLng pt, double bearingDeg, double offsetMeters) {
    const rad = math.pi / 180.0;
    const latScale = 111132.954;
    final lngScale = 111412.84 * math.cos(pt.latitude * rad);
    final rightAngle = (bearingDeg + 90.0) * rad;
    final dy = math.cos(rightAngle) * offsetMeters;
    final dx = math.sin(rightAngle) * offsetMeters;
    return LatLng(pt.latitude + dy / latScale, pt.longitude + dx / lngScale);
  }

  static double _pointToSegDist(LatLng p, LatLng a, LatLng b) {
    const rad = math.pi / 180.0;
    const latScale = 111132.954;
    final lngScale = 111412.84 * math.cos(p.latitude * rad);
    final px = p.longitude * lngScale;
    final py = p.latitude * latScale;
    final ax = a.longitude * lngScale;
    final ay = a.latitude * latScale;
    final bx = b.longitude * lngScale;
    final by = b.latitude * latScale;
    final dx = bx - ax;
    final dy = by - ay;
    final lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return _distanceMeters(p, a);
    final t = (((px - ax) * dx + (py - ay) * dy) / lenSq).clamp(0.0, 1.0);
    final cx = ax + t * dx;
    final cy = ay + t * dy;
    return math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
  }

  List<LatLng> _getActiveRoutePoints() {
    final pri = _getPrimaryRouteLatLngs();
    if (pri == null || pri.isEmpty) return const [];
    if (_isNavigating) {
      final segIdx = _impl.routeProgressIndex.clamp(0, pri.length - 1);
      final curPos = LatLng(_animatedLat, _animatedLng);
      final active = <LatLng>[curPos];
      if (segIdx + 1 < pri.length) {
        active.addAll(pri.sublist(segIdx + 1));
      }
      return active;
    }
    return pri;
  }

  /// 경로선 상에서 moveMeters 만큼 전진하여 _animatedLat, _animatedLng를 갱신
  void _advanceAlongRoute(double moveMeters, List<LatLng>? primary) {
    if (primary == null || primary.length < 2) return;
    final segIdx = _impl.routeProgressIndex.clamp(0, primary.length - 2);
    final a = primary[segIdx];
    final b = primary[segIdx + 1];

    const rad = math.pi / 180.0;
    const latScale = 111132.954;
    final lngScale = 111412.84 * math.cos(_animatedLat * rad);

    final dxMeters = (b.longitude - a.longitude) * lngScale;
    final dyMeters = (b.latitude - a.latitude) * latScale;
    final segLen = math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);

    if (segLen < 1e-3) return;

    final unitX = dxMeters / segLen;
    final unitY = dyMeters / segLen;

    final deltaLng = (unitX * moveMeters) / lngScale;
    final deltaLat = (unitY * moveMeters) / latScale;

    _animatedLat += deltaLat;
    _animatedLng += deltaLng;
  }

  /// 경로선 30m 이내 스냅 상세 계산 (투영점, 세그먼트 인덱스, 비율, 스냅 여부 산출)
  /// 1단계 개선: 현재 진행 위치(_impl.routeProgressIndex) 기준 앞쪽 300m 이내의 구간만 후보로 하며,
  /// 속도 3m/s(약 11km/h) 이상 주행 시 진행 방향과 60도 초과 차이나는 반대 방향/이탈 구간은 스냅하지 않는다.
  (LatLng point, int segIndex, double t, bool isSnapped) _snapToRouteDetail(
    LatLng rawPos,
    List<LatLng>? primaryRoute,
  ) {
    if (primaryRoute == null || primaryRoute.length < 2) {
      return (rawPos, 0, 0.0, false);
    }

    const rad = math.pi / 180.0;
    const latScale = 111132.954;
    final lngScale = 111412.84 * math.cos(rawPos.latitude * rad);

    final px = rawPos.longitude * lngScale;
    final py = rawPos.latitude * latScale;

    const maxDist = NavMapConfig.snapRouteDistanceMeters;
    double bestDistSq = maxDist * maxDist;
    LatLng? bestPoint;
    int bestSeg = 0;
    double bestT = 0.0;

    final startIdx = _impl.routeProgressIndex.clamp(0, primaryRoute.length - 2);
    final speedMps = (_impl.currentSpeedKmh ?? 0.0) / 3.6;
    final carHeading = _impl.currentHeading;

    double cumDist = 0.0;
    for (int i = startIdx; i < primaryRoute.length - 1; i++) {
      final a = primaryRoute[i];
      final b = primaryRoute[i + 1];

      final ax = a.longitude * lngScale;
      final ay = a.latitude * latScale;
      final bx = b.longitude * lngScale;
      final by = b.latitude * latScale;

      final dx = bx - ax;
      final dy = by - ay;
      final segLenSq = dx * dx + dy * dy;
      final segLen = math.sqrt(segLenSq);
      if (segLenSq < 1e-6) continue;

      if (i > startIdx) {
        cumDist += segLen;
        if (cumDist > 300.0 && (i - startIdx) >= 2) {
          break; // 앞쪽 300m 이내만 탐색
        }
      }

      // 속도 3m/s 이상이고 방향값이 있으면 60도 초과 차이나는 반대 구간/역방향 제외
      if (speedMps >= 3.0 && carHeading != null && !carHeading.isNaN) {
        final segBearing = (math.atan2(dx, dy) * 180.0 / math.pi + 360.0) % 360.0;
        final angleDiff = ((carHeading - segBearing).abs()) % 360.0;
        final normalizedDiff = angleDiff > 180.0 ? 360.0 - angleDiff : angleDiff;
        if (normalizedDiff > 60.0) {
          continue;
        }
      }

      final t = ((px - ax) * dx + (py - ay) * dy) / segLenSq;
      final clampedT = t.clamp(0.0, 1.0);

      final cx = ax + clampedT * dx;
      final cy = ay + clampedT * dy;

      final distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestSeg = i;
        bestT = clampedT;
        bestPoint = LatLng(
          a.latitude + clampedT * (b.latitude - a.latitude),
          a.longitude + clampedT * (b.longitude - a.longitude),
        );
      }
    }

    if (bestPoint != null) {
      return (bestPoint, bestSeg, bestT, true);
    }
    return (rawPos, startIdx, 0.0, false);
  }

  List<Polyline> _buildPolylines() {
    final lines = <Polyline>[];

    // 1. 대체 경로 (회색 점선)
    final alt = _getAlternateRouteLatLngs();
    if (alt != null && alt.length > 1) {
      lines.add(
        Polyline(
          points: alt,
          color: const Color(0xFF64748B).withValues(alpha: 0.7),
          strokeWidth: 5,
          pattern: StrokePattern.dashed(segments: const [8, 10]),
        ),
      );
    }

    // 2. 주 경로 기본 윤곽선 및 교통 색상 (지나온 경로 지우기 및 유턴 겹침 분리)
    final pri = _getPrimaryRouteLatLngs();
    if (pri != null && pri.length > 1) {
      final activePoints = _getActiveRoutePoints();
      final int currentSegIdx = _isNavigating ? _impl.routeProgressIndex.clamp(0, pri.length - 1) : 0;

      // 4단계: 같은 도로를 반대 방향으로 다시 지나는 구간(유턴/복귀 구간) 검출
      // 먼저 지날 구간은 진한 색으로 위에, 나중 구간은 연한 색으로 아래에 그리고 진행 방향 오른쪽으로 3.5m 띄워 두 줄 표시
      final isOverlap = List<bool>.filled(math.max(0, activePoints.length - 1), false);
      if (activePoints.length >= 4) {
        for (int j = 2; j < activePoints.length - 1; j++) {
          final bj = _bearingBetween(activePoints[j], activePoints[j + 1]);
          final midJ = LatLng(
            (activePoints[j].latitude + activePoints[j + 1].latitude) / 2,
            (activePoints[j].longitude + activePoints[j + 1].longitude) / 2,
          );
          for (int i = 0; i < j - 1; i++) {
            final bi = _bearingBetween(activePoints[i], activePoints[i + 1]);
            if (_angleDiff(bi, bj) >= 135.0) {
              final dist = _pointToSegDist(midJ, activePoints[i], activePoints[i + 1]);
              if (dist <= 18.0) {
                isOverlap[j] = true;
                break;
              }
            }
          }
        }
      }

      // 나중(돌아오는) 겹침 구간: 진행 방향 오른쪽으로 3.5m 띄우고 연한 색으로 아래에 먼저 그림
      final returnRuns = <List<LatLng>>[];
      List<LatLng>? curRun;
      for (int k = 0; k < activePoints.length - 1; k++) {
        if (isOverlap[k]) {
          final bk = _bearingBetween(activePoints[k], activePoints[k + 1]);
          final p1 = _offsetPointRight(activePoints[k], bk, 3.5);
          final p2 = _offsetPointRight(activePoints[k + 1], bk, 3.5);
          if (curRun == null) {
            curRun = [p1, p2];
          } else {
            curRun.add(p2);
          }
        } else {
          if (curRun != null) {
            returnRuns.add(curRun);
            curRun = null;
          }
        }
      }
      if (curRun != null) returnRuns.add(curRun);

      for (final run in returnRuns) {
        if (run.length > 1) {
          lines.add(
            Polyline(
              points: run,
              color: const Color(0xFF86EFAC).withValues(alpha: 0.85), // 연한 색으로 아래에
              strokeWidth: 6,
              strokeCap: StrokeCap.round,
              strokeJoin: StrokeJoin.round,
            ),
          );
        }
      }

      if (activePoints.length > 1) {
        // 주 경로 기본 윤곽선 (진한 테두리선)
        lines.add(
          Polyline(
            points: activePoints,
            color: const Color(0xFF14532D).withValues(alpha: 0.4),
            strokeWidth: 12,
            strokeCap: StrokeCap.round,
            strokeJoin: StrokeJoin.round,
          ),
        );
      }

      // 3. 교통 색상 경로 (먼저 지날 주 경로는 진한 색으로 위에 그림)
      final traffic = _impl.trafficSegments;
      if (traffic != null && traffic.isNotEmpty) {
        for (final seg in traffic) {
          if (_isNavigating && seg.to < currentSegIdx) {
            continue;
          }

          final List<LatLng> segPoints;
          if (_isNavigating && seg.from <= currentSegIdx && currentSegIdx <= seg.to) {
            final curPos = LatLng(_animatedLat, _animatedLng);
            final nextIdx = (currentSegIdx + 1).clamp(0, pri.length);
            final toIdx = (seg.to + 1).clamp(0, pri.length);
            segPoints = [curPos];
            if (nextIdx < toIdx) {
              segPoints.addAll(pri.sublist(nextIdx, toIdx));
            }
          } else {
            final from = seg.from.clamp(0, pri.length - 1);
            final to = (seg.to + 1).clamp(0, pri.length);
            if (to > from + 1) {
              segPoints = pri.sublist(from, to);
            } else {
              segPoints = const [];
            }
          }

          if (segPoints.length > 1) {
            lines.add(
              Polyline(
                points: segPoints,
                color: _trafficColor(seg.state),
                strokeWidth: 8,
                strokeCap: StrokeCap.round,
                strokeJoin: StrokeJoin.round,
              ),
            );
          }
        }
      } else if (activePoints.length > 1) {
        lines.add(
          Polyline(
            points: activePoints,
            color: const Color(0xFF16A34A),
            strokeWidth: 8,
            strokeCap: StrokeCap.round,
            strokeJoin: StrokeJoin.round,
          ),
        );
      }
    }

    return lines;
  }

  Color _trafficColor(int state) {
    if (state == 1 || state == 6) return const Color(0xFFEF4444); // 정체 (빨강)
    if (state == 2 || state == 3) return const Color(0xFFF59E0B); // 서행/지체 (노랑/주황)
    return const Color(0xFF16A34A);                               // 원활 (초록/파랑)
  }

  List<Marker> _buildMarkers() {
    final markers = <Marker>[];

    // 1. 정류장 마커 (회전해도 글자 똑바로)
    for (int i = 0; i < _impl.stops.length; i++) {
      final s = _impl.stops[i];
      final lat = s['lat'] as num?;
      final lng = s['lng'] as num?;
      if (lat == null || lng == null) continue;

      final isPassed = _impl.passedStopIndices.contains(i) || s['passed'] == true;
      final isTest = s['test'] == true;

      markers.add(
        Marker(
          point: LatLng(lat.toDouble(), lng.toDouble()),
          width: 28,
          height: 28,
          rotate: true, // 회전되어도 글자 똑바로
          child: _StopMarkerWidget(
            index: i,
            isPassed: isPassed,
            isTest: isTest,
          ),
        ),
      );
    }

    // 2. 유치원 마커
    if (_impl.academy != null) {
      markers.add(
        Marker(
          point: LatLng(_impl.academy!.lat, _impl.academy!.lng),
          width: 64,
          height: 32,
          rotate: true,
          child: const _AcademyMarkerWidget(),
        ),
      );
    }

    // 3. 내 위치 차량 마커 (흰 원 안의 파란 화살표)
    if (_hasInitialLocation) {
      // 진행 방향 위 모드에서는 항상 12시(0도) 고정, 북쪽 위 모드에서는 실제 진행 방향(도)을 가리킴
      final screenAngleDeg = _headingUp ? 0.0 : _animatedHeading;

      markers.add(
        Marker(
          point: LatLng(_animatedLat, _animatedLng),
          width: 48,
          height: 48,
          rotate: false,
          child: _CarMarkerWidget(
            screenAngleDeg: screenAngleDeg,
          ),
        ),
      );
    }

    // 4. 유턴 지점 마커 (안내 경로 중 유턴 지점)
    final uturns = _impl.uturnPoints;
    if (uturns != null && uturns.isNotEmpty) {
      final pri = _getPrimaryRouteLatLngs();
      final curProgress = _isNavigating ? _impl.routeProgressIndex : 0;
      for (final u in uturns) {
        final uLatLng = LatLng(u.lat, u.lng);
        // 이미 지나온 유턴 마커는 주행 중 숨김
        if (_isNavigating && pri != null && pri.isNotEmpty) {
          int nearestIdx = 0;
          double minDist = double.infinity;
          for (int k = 0; k < pri.length; k++) {
            final d = _distanceMeters(uLatLng, pri[k]);
            if (d < minDist) {
              minDist = d;
              nearestIdx = k;
            }
          }
          if (nearestIdx < curProgress - 1) continue;
        }

        markers.add(
          Marker(
            point: uLatLng,
            width: 32,
            height: 32,
            rotate: true,
            child: const _UturnMarkerWidget(),
          ),
        );
      }
    }

    // 5. 진행 방향 화살표 무늬 (꺾쇠) 마커 (약 65m 간격)
    final activeForChevrons = _getActiveRoutePoints();
    if (activeForChevrons.length > 1) {
      double accDist = 0;
      double nextChevronDist = 40.0;
      int chevronCount = 0;
      for (int i = 0; i < activeForChevrons.length - 1 && chevronCount < 35; i++) {
        final a = activeForChevrons[i];
        final b = activeForChevrons[i + 1];
        final segLen = _distanceMeters(a, b);
        if (segLen < 1.0) continue;
        while (accDist + segLen >= nextChevronDist && chevronCount < 35) {
          final frac = ((nextChevronDist - accDist) / segLen).clamp(0.0, 1.0);
          final pt = LatLng(
            a.latitude + frac * (b.latitude - a.latitude),
            a.longitude + frac * (b.longitude - a.longitude),
          );
          final bearing = _bearingBetween(a, b);
          markers.add(
            Marker(
              point: pt,
              width: 16,
              height: 16,
              rotate: false,
              child: _RouteChevronWidget(bearingDeg: bearing),
            ),
          );
          chevronCount++;
          nextChevronDist += 65.0;
        }
        accDist += segLen;
      }
    }

    return markers;
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        _mapSize = Size(constraints.maxWidth, constraints.maxHeight);

        return FlutterMap(
          mapController: _mapController,
          options: MapOptions(
            initialCenter: LatLng(_animatedLat, _animatedLng),
            initialZoom: NavMapConfig.defaultOverviewZoom,
            initialRotation: 0.0,
            backgroundColor: const Color(0xFFF1F5F9), // 타일 도착 전 부드러운 연회색
            interactionOptions: const InteractionOptions(
              flags: InteractiveFlag.all,
            ),
            onMapReady: () {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (!mounted) return;
                _isMapReady = true;
                if (_impl.shouldFitOnRoutes && !_isInitialFitDone && !_isNavigating) {
                  _fitAllBounds();
                  _isInitialFitDone = true;
                } else if (_isFollowing) {
                  _applyCameraUpdate();
                }
                setState(() {});
              });
            },
            onPositionChanged: (camera, hasGesture) {
              if (hasGesture) {
                // 사용자가 직접 화면을 조작(드래그/핀치)하면 따라가기 해제
                _isFollowing = false;
                _targetYRatio = 0.5;
                _impl.onUserDrag?.call();
              }
            },
          ),
          children: [
            // OpenStreetMap 타일 레이어 (네이버 지도를 쓸 수 없을 때만 사용) (캐시 및 panBuffer 최적화)
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.takeme.driver',
              maxZoom: 19,
              minZoom: 6,
              keepBuffer: 3,
              panBuffer: 1,
              tileProvider: NetworkTileProvider(
                cachingProvider: BuiltInMapCachingProvider.getOrCreateInstance(),
              ),
              tileDisplay: const TileDisplay.fadeIn(duration: Duration(milliseconds: 150)),
              tileBuilder: (context, tileWidget, tile) => Container(
                color: const Color(0xFFF1F5F9),
                child: tileWidget,
              ),
            ),

            // 경로선 레이어
            PolylineLayer(
              polylines: _buildPolylines(),
            ),

            // 마커 레이어
            MarkerLayer(
              markers: _buildMarkers(),
            ),
          ],
        );
      },
    );
  }
}

/// 내 위치 차량 화살표 마커 (흰 원 + 드롭 섀도우 + 파란 내비 화살표)
class _CarMarkerWidget extends StatelessWidget {
  final double screenAngleDeg;

  const _CarMarkerWidget({required this.screenAngleDeg});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 48,
      height: 48,
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Color(0x52000000),
            blurRadius: 10,
            offset: Offset(0, 3),
          ),
        ],
      ),
      child: Center(
        child: Transform.rotate(
          angle: screenAngleDeg * math.pi / 180.0,
          child: CustomPaint(
            size: const Size(28, 28),
            painter: _NavArrowPainter(),
          ),
        ),
      ),
    );
  }
}

class _NavArrowPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final w = size.width;
    final h = size.height;

    final path = Path()
      ..moveTo(w * 0.5, h * 0.08)
      ..lineTo(w * 0.88, h * 0.92)
      ..lineTo(w * 0.5, h * 0.72)
      ..lineTo(w * 0.12, h * 0.92)
      ..close();

    final fillPaint = Paint()
      ..color = const Color(0xFF3B82F6)
      ..style = PaintingStyle.fill;

    final strokePaint = Paint()
      ..color = const Color(0xFF1D4ED8)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5
      ..strokeJoin = StrokeJoin.round;

    canvas.drawPath(path, fillPaint);
    canvas.drawPath(path, strokePaint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}

/// 정류장 마커 (원형, 번호 표시, 지난 정류장 회색, 테스트 정류장 주황 T)
class _StopMarkerWidget extends StatelessWidget {
  final int index;
  final bool isPassed;
  final bool isTest;

  const _StopMarkerWidget({
    required this.index,
    this.isPassed = false,
    this.isTest = false,
  });

  @override
  Widget build(BuildContext context) {
    Color bg = const Color(0xFF2563EB);
    if (isPassed) {
      bg = const Color(0xFF94A3B8);
    } else if (isTest) {
      bg = const Color(0xFFEA580C);
    }

    return Container(
      width: 28,
      height: 28,
      decoration: BoxDecoration(
        color: bg,
        shape: BoxShape.circle,
        border: Border.all(
          color: Colors.white,
          width: 2,
        ),
        boxShadow: const [
          BoxShadow(
            color: Color(0x59000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: Center(
        child: Text(
          '${isTest ? "T" : ""}${index + 1}',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }
}

/// 유치원 마커
class _AcademyMarkerWidget extends StatelessWidget {
  const _AcademyMarkerWidget();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF10B981),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x8010B981),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: const Center(
        child: Text(
          '유치원',
          style: TextStyle(
            color: Colors.white,
            fontSize: 12,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }
}

/// 경로선 위 진행 방향 화살표 무늬 (꺾쇠 모양)
class _RouteChevronWidget extends StatelessWidget {
  final double bearingDeg;

  const _RouteChevronWidget({required this.bearingDeg});

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: bearingDeg * math.pi / 180.0,
      child: const Center(
        child: Icon(
          Icons.keyboard_arrow_up_rounded,
          size: 16,
          color: Colors.white,
          shadows: [
            Shadow(
              color: Color(0x66000000),
              blurRadius: 2,
              offset: Offset(0, 1),
            ),
          ],
        ),
      ),
    );
  }
}

/// 유턴 지점 마커 위젯 (파란 원형 표지판 + 흰색 유턴 아이콘)
class _UturnMarkerWidget extends StatelessWidget {
  const _UturnMarkerWidget();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 32,
      height: 32,
      decoration: BoxDecoration(
        color: const Color(0xFF2563EB),
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: const [
          BoxShadow(
            color: Color(0x52000000),
            blurRadius: 6,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: const Center(
        child: Icon(
          Icons.u_turn_left_rounded,
          color: Colors.white,
          size: 20,
        ),
      ),
    );
  }
}
