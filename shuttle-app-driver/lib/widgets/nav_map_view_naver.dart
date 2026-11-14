import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_naver_map/flutter_naver_map.dart';
import 'package:latlong2/latlong.dart' hide Path;

import 'nav_map_controller.dart';

/// Map Style Editor 사용자 스타일 ID (secrets.json 의 NAVER_MAP_STYLE_ID). 비어 있으면 기본 스타일.
const String naverMapStyleId = String.fromEnvironment('NAVER_MAP_STYLE_ID');

/// 야간 모드 (지금은 항상 꺼짐. 나중에 설정으로 켤 수 있도록 상수로 분리)
const bool _naverNightMode = false;

/// 네이버 지도 기반 내비게이션 지도 (flutter_naver_map).
/// NavMapController 의 기존 메서드/동작은 그대로 유지하고 지도 렌더링만 네이버 지도로 처리한다.
class NaverNavMapView extends StatefulWidget {
  final NavMapController controller;

  const NaverNavMapView({super.key, required this.controller});

  @override
  State<NaverNavMapView> createState() => _NaverNavMapViewState();
}

class _PathSpec {
  final String id;
  final List<LatLng> points;
  final Color color;
  final double width;
  final Color outlineColor;
  final double outlineWidth;
  final bool dashed;
  final bool chevron;
  const _PathSpec({
    required this.id,
    required this.points,
    required this.color,
    required this.width,
    this.outlineColor = Colors.transparent,
    this.outlineWidth = 0,
    this.dashed = false,
    this.chevron = false,
  });
}

class _NaverNavMapViewState extends State<NaverNavMapView> with SingleTickerProviderStateMixin {
  NaverMapController? _map;
  late final Ticker _ticker;
  Duration? _lastTick;

  double _animatedLat = 37.5665;
  double _animatedLng = 126.9780;
  double _animatedHeading = 0.0;
  double _animatedZoom = NavMapConfig.defaultNavZoom;
  double _animatedYRatio = 0.5;

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

  bool _isSnappedToRoute = false;
  DateTime? _lastGpsTime;
  double _correctionOffsetX = 0.0;
  double _correctionOffsetY = 0.0;
  double _correctionRemainingSec = 0.0;

  // 오버레이 상태
  final Map<String, NAddableOverlay> _overlays = {};
  final Map<String, NOverlayImage> _imageCache = {};
  NMarker? _meMarker;
  bool _syncing = false;
  bool _syncPending = false;
  DateTime _lastSync = DateTime.fromMillisecondsSinceEpoch(0);
  bool _cameraBusy = false;

  NavMapControllerImpl get _impl => widget.controller as NavMapControllerImpl;

  @override
  void initState() {
    super.initState();
    _bindController();
    _ticker = createTicker(_onTick);
    _ticker.start();
  }

  void _bindController() {
    _impl.addListener(_onControllerUpdated);
    _impl.onCenterOn = (p, zoom) {
      _isFollowing = false;
      _targetYRatio = 0.5;
      _animatedYRatio = 0.5;
      _targetZoom = zoom.toDouble();
      _animatedZoom = zoom.toDouble();
      _animatedLat = p.lat;
      _animatedLng = p.lng;
      _moveCamera(LatLng(p.lat, p.lng), _animatedZoom, _headingUp ? null : 0.0, 0.5);
    };
    _impl.onFitAll = _fitAllBounds;
    _impl.onResetZoom = () {
      _isFollowing = false;
      _targetYRatio = 0.5;
      _headingUp = false;
      _moveCamera(null, null, 0.0, 0.5);
    };
    _onControllerUpdated();
  }

  @override
  void didUpdateWidget(covariant NaverNavMapView oldWidget) {
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
    super.dispose();
  }

  bool get _canUseMap => _isMapReady && mounted && _map != null;

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
      final rawLatLng = LatLng(curPos.lat, curPos.lng);
      final primary = _getPrimaryRouteLatLngs();
      final (snapped, _, _, isSnapped) = navigating
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
        _correctionOffsetY = snapped.latitude - _animatedLat;
        _correctionOffsetX = snapped.longitude - _animatedLng;
        _correctionRemainingSec = NavMapConfig.reconciliationSeconds;
      }
      _lastGpsTime = DateTime.now();

      if (heading != null && !heading.isNaN) {
        if (speed >= NavMapConfig.stationarySpeedThreshold) {
          _lastValidHeading = heading;
          _targetHeading = _shortestAngle(_animatedHeading, heading);
        } else {
          _targetHeading = _shortestAngle(_animatedHeading, _lastValidHeading);
        }
      }

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
        _targetYRatio = 0.5;
      }
    }

    if (_impl.shouldFitOnRoutes && !_isInitialFitDone && !_isNavigating && _canUseMap) {
      _fitAllBounds();
      _isInitialFitDone = true;
    }

    _requestSync();
  }

  void _onTick(Duration elapsed) {
    if (!_canUseMap) return;
    if (_lastTick == null) {
      _lastTick = elapsed;
      return;
    }
    final dt = (elapsed - _lastTick!).inMicroseconds / 1000000.0;
    _lastTick = elapsed;
    final clampedDt = dt.clamp(0.001, 0.1);

    if (_isFollowing && _isNavigating) {
      final speedMps = ((_impl.currentSpeedKmh ?? 0.0) / 3.6);
      final sinceGps = _lastGpsTime != null
          ? (DateTime.now().difference(_lastGpsTime!).inMilliseconds / 1000.0)
          : 0.0;

      if (_isSnappedToRoute && sinceGps <= NavMapConfig.predictionMaxSeconds && speedMps > 0.5) {
        _advanceAlongRoute(speedMps * clampedDt, _getPrimaryRouteLatLngs());
      }

      if (_correctionRemainingSec > 0.001) {
        final stepFactor = (clampedDt / _correctionRemainingSec).clamp(0.0, 1.0);
        _animatedLat += _correctionOffsetY * stepFactor;
        _animatedLng += _correctionOffsetX * stepFactor;
        _correctionOffsetY -= _correctionOffsetY * stepFactor;
        _correctionOffsetX -= _correctionOffsetX * stepFactor;
        _correctionRemainingSec -= clampedDt;
      } else if (!_isSnappedToRoute) {
        final posFactor = (clampedDt / 0.3).clamp(0.0, 1.0);
        _animatedLat += (_targetPos.latitude - _animatedLat) * posFactor;
        _animatedLng += (_targetPos.longitude - _animatedLng) * posFactor;
      }

      _animatedHeading += (_targetHeading - _animatedHeading) * (clampedDt / NavMapConfig.headingLerpDuration).clamp(0.0, 1.0);
      _animatedZoom += (_targetZoom - _animatedZoom) * (clampedDt / NavMapConfig.zoomLerpDuration).clamp(0.0, 1.0);
      _animatedYRatio += (_targetYRatio - _animatedYRatio) * (clampedDt / NavMapConfig.ratioLerpDuration).clamp(0.0, 1.0);

      _applyCameraUpdate();
    } else if (_isFollowing && !_isNavigating) {
      final posFactor = (clampedDt / 0.3).clamp(0.0, 1.0);
      _animatedLat += (_targetPos.latitude - _animatedLat) * posFactor;
      _animatedLng += (_targetPos.longitude - _animatedLng) * posFactor;
      _animatedYRatio = 0.5;
      _moveCamera(LatLng(_animatedLat, _animatedLng), _animatedZoom, null, 0.5);
    }

    _updateMeMarker();
    // 경로선/마커는 부하를 줄이기 위해 약 4Hz 로만 갱신
    if (_isNavigating && DateTime.now().difference(_lastSync).inMilliseconds > 250) {
      _requestSync();
    }
  }

  void _applyCameraUpdate() {
    if (!_canUseMap) return;
    if (_headingUp) {
      _moveCamera(LatLng(_animatedLat, _animatedLng), _animatedZoom, _animatedHeading, _animatedYRatio);
    } else {
      _moveCamera(LatLng(_animatedLat, _animatedLng), _animatedZoom, 0.0, 0.5);
    }
  }

  /// 카메라 이동 (애니메이션 없음, 이전 호출이 끝나기 전에는 건너뜀)
  Future<void> _moveCamera(LatLng? target, double? zoom, double? bearing, double yRatio) async {
    final map = _map;
    if (!_canUseMap || map == null || _cameraBusy) return;
    _cameraBusy = true;
    try {
      final update = NCameraUpdate.withParams(
        target: target == null ? null : NLatLng(target.latitude, target.longitude),
        zoom: zoom,
        bearing: bearing,
        tilt: 0,
      )
        ..setPivot(NPoint(0.5, yRatio))
        ..setAnimation(animation: NCameraAnimation.none, duration: Duration.zero);
      await map.updateCamera(update);
    } catch (e) {
      debugPrint('[nav_map_naver] moveCamera error: $e');
    } finally {
      _cameraBusy = false;
    }
  }

  Future<void> _fitAllBounds() async {
    final map = _map;
    if (!_canUseMap || map == null) return;
    final pts = <NLatLng>[];
    void add(double lat, double lng) => pts.add(NLatLng(lat, lng));

    for (final p in _impl.primaryRoute ?? const []) {
      add(p.lat, p.lng);
    }
    for (final p in _impl.alternateRoute ?? const []) {
      add(p.lat, p.lng);
    }
    for (final s in _impl.stops) {
      final lat = s['lat'] as num?;
      final lng = s['lng'] as num?;
      if (lat != null && lng != null) add(lat.toDouble(), lng.toDouble());
    }
    if (_impl.academy != null) add(_impl.academy!.lat, _impl.academy!.lng);
    if (_impl.currentPosition != null) add(_impl.currentPosition!.lat, _impl.currentPosition!.lng);
    if (pts.isEmpty) return;

    try {
      await map.updateCamera(
        NCameraUpdate.withParams(bearing: 0, tilt: 0)
          ..setPivot(NPoint.relativeCenter)
          ..setAnimation(animation: NCameraAnimation.none, duration: Duration.zero),
      );
      final bounds = NLatLngBounds.from(pts);
      await map.updateCamera(
        NCameraUpdate.fitBounds(bounds, padding: const EdgeInsets.all(50))
          ..setAnimation(animation: NCameraAnimation.none, duration: Duration.zero),
      );
      final cam = await map.getCameraPosition();
      if (cam.zoom > 16.0) {
        await map.updateCamera(
          NCameraUpdate.withParams(zoom: 16.0)
            ..setAnimation(animation: NCameraAnimation.none, duration: Duration.zero),
        );
      }
    } catch (e) {
      debugPrint('[nav_map_naver] fitAllBounds error: $e');
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

  // ───────────────────────── 경로선 구성 ─────────────────────────

  List<_PathSpec> _buildPathSpecs() {
    final specs = <_PathSpec>[];

    final alt = _getAlternateRouteLatLngs();
    if (alt != null && alt.length > 1) {
      specs.add(_PathSpec(
        id: 'alt',
        points: alt,
        color: const Color(0xFF64748B).withValues(alpha: 0.7),
        width: 5,
        dashed: true,
      ));
    }

    final pri = _getPrimaryRouteLatLngs();
    if (pri == null || pri.length < 2) return specs;

    final activePoints = _getActiveRoutePoints();
    final int currentSegIdx = _isNavigating ? _impl.routeProgressIndex.clamp(0, pri.length - 1) : 0;

    // 같은 도로를 반대 방향으로 다시 지나는 구간(유턴/복귀) 검출
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
          if (_angleDiff(bi, bj) >= 135.0 && _pointToSegDist(midJ, activePoints[i], activePoints[i + 1]) <= 18.0) {
            isOverlap[j] = true;
            break;
          }
        }
      }
    }

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
      } else if (curRun != null) {
        returnRuns.add(curRun);
        curRun = null;
      }
    }
    if (curRun != null) returnRuns.add(curRun);

    for (int r = 0; r < returnRuns.length; r++) {
      if (returnRuns[r].length > 1) {
        specs.add(_PathSpec(
          id: 'ret_$r',
          points: returnRuns[r],
          color: const Color(0xFF86EFAC).withValues(alpha: 0.85),
          width: 6,
        ));
      }
    }

    // 경로선 테두리(진한 윤곽)는 각 경로선의 outline 으로 유지한다
    const outlineColor = Color(0xFF14532D);
    const lineWidth = 9.0;
    const outlineWidth = 2.0;

    final traffic = _impl.trafficSegments;
    if (traffic != null && traffic.isNotEmpty) {
      for (int t = 0; t < traffic.length; t++) {
        final seg = traffic[t];
        if (_isNavigating && seg.to < currentSegIdx) continue;

        final List<LatLng> segPoints;
        if (_isNavigating && seg.from <= currentSegIdx && currentSegIdx <= seg.to) {
          final curPos = LatLng(_animatedLat, _animatedLng);
          final nextIdx = (currentSegIdx + 1).clamp(0, pri.length);
          final toIdx = (seg.to + 1).clamp(0, pri.length);
          segPoints = [curPos];
          if (nextIdx < toIdx) segPoints.addAll(pri.sublist(nextIdx, toIdx));
        } else {
          final from = seg.from.clamp(0, pri.length - 1);
          final to = (seg.to + 1).clamp(0, pri.length);
          segPoints = to > from + 1 ? pri.sublist(from, to) : const [];
        }

        if (segPoints.length > 1) {
          specs.add(_PathSpec(
            id: 'traffic_$t',
            points: segPoints,
            color: _trafficColor(seg.state),
            width: lineWidth,
            outlineColor: outlineColor,
            outlineWidth: outlineWidth,
            chevron: true,
          ));
        }
      }
    } else if (activePoints.length > 1) {
      specs.add(_PathSpec(
        id: 'main',
        points: activePoints,
        color: const Color(0xFF16A34A),
        width: lineWidth,
        outlineColor: outlineColor,
        outlineWidth: outlineWidth,
        chevron: true,
      ));
    }
    return specs;
  }

  Color _trafficColor(int state) {
    if (state == 1 || state == 6) return const Color(0xFFEF4444);
    if (state == 2 || state == 3) return const Color(0xFFF59E0B);
    return const Color(0xFF16A34A);
  }

  // ───────────────────────── 오버레이 동기화 ─────────────────────────

  Future<NOverlayImage> _image(String key, Widget widget, Size size) async {
    final cached = _imageCache[key];
    if (cached != null) return cached;
    final img = await NOverlayImage.fromWidget(
      widget: Directionality(textDirection: TextDirection.ltr, child: widget),
      size: size,
      context: context,
    );
    _imageCache[key] = img;
    return img;
  }

  void _requestSync() {
    if (!_canUseMap) return;
    if (_syncing) {
      _syncPending = true;
      return;
    }
    _syncOverlays();
  }

  final Map<String, String> _overlayKeys = {};

  Future<void> _syncOverlays() async {
    final map = _map;
    if (!_canUseMap || map == null) return;
    _syncing = true;
    _lastSync = DateTime.now();
    try {
      final chevron = await _image(
        'chevron',
        const _RouteChevronWidget(bearingDeg: 0),
        const Size(16, 16),
      );
      if (!_canUseMap) return;

      final wanted = <String>{};
      int order = 0;

      // 경로선
      for (final spec in _buildPathSpecs()) {
        wanted.add(spec.id);
        final coords = spec.points.map((p) => NLatLng(p.latitude, p.longitude)).toList();
        final key = '${spec.points.length}|${spec.points.first.latitude}|${spec.points.first.longitude}|'
            '${spec.points.last.latitude}|${spec.points.last.longitude}|${spec.color.toARGB32()}';
        final existing = _overlays[spec.id];
        if (existing == null) {
          final NAddableOverlay ov;
          if (spec.dashed) {
            ov = NPolylineOverlay(
              id: spec.id,
              coords: coords,
              color: spec.color,
              width: spec.width,
              lineCap: NLineCap.round,
              lineJoin: NLineJoin.round,
              pattern: const [8, 10],
            );
          } else {
            ov = NPathOverlay(
              id: spec.id,
              coords: coords,
              color: spec.color,
              width: spec.width,
              outlineColor: spec.outlineColor,
              outlineWidth: spec.outlineWidth,
              patternImage: spec.chevron ? chevron : null,
              patternInterval: 60,
            );
          }
          ov.setGlobalZIndex(-50000 + order);
          _overlays[spec.id] = ov;
          _overlayKeys[spec.id] = key;
          await map.addOverlay(ov);
        } else if (_overlayKeys[spec.id] != key || _isNavigating) {
          if (existing is NPathOverlay) {
            existing.setCoords(coords);
            existing.setColor(spec.color);
          } else if (existing is NPolylineOverlay) {
            existing.setCoords(coords);
            existing.setColor(spec.color);
          }
          _overlayKeys[spec.id] = key;
        }
        order++;
      }

      // 정류장 마커
      for (int i = 0; i < _impl.stops.length; i++) {
        final s = _impl.stops[i];
        final lat = s['lat'] as num?;
        final lng = s['lng'] as num?;
        if (lat == null || lng == null) continue;
        final isPassed = _impl.passedStopIndices.contains(i) || s['passed'] == true;
        final isTest = s['test'] == true;
        final id = 'stop_$i';
        wanted.add(id);
        final imgKey = 'stop_${i}_${isPassed}_$isTest';
        final icon = await _image(
          imgKey,
          _StopMarkerWidget(index: i, isPassed: isPassed, isTest: isTest),
          const Size(28, 28),
        );
        if (!_canUseMap) return;
        final existing = _overlays[id];
        if (existing == null) {
          final m = NMarker(
            id: id,
            position: NLatLng(lat.toDouble(), lng.toDouble()),
            icon: icon,
            anchor: NPoint.relativeCenter,
          );
          m.setGlobalZIndex(200000);
          _overlays[id] = m;
          _overlayKeys[id] = imgKey;
          await map.addOverlay(m);
        } else if (_overlayKeys[id] != imgKey && existing is NMarker) {
          existing.setIcon(icon);
          _overlayKeys[id] = imgKey;
        }
      }

      // 유치원 마커
      final academy = _impl.academy;
      if (academy != null) {
        wanted.add('academy');
        final icon = await _image('academy', const _AcademyMarkerWidget(), const Size(64, 32));
        if (!_canUseMap) return;
        final pos = NLatLng(academy.lat, academy.lng);
        final existing = _overlays['academy'];
        if (existing == null) {
          final m = NMarker(id: 'academy', position: pos, icon: icon, anchor: NPoint.relativeCenter);
          m.setGlobalZIndex(200001);
          _overlays['academy'] = m;
          await map.addOverlay(m);
        } else if (existing is NMarker) {
          existing.setPosition(pos);
        }
      }

      // 유턴 지점 마커 (지나온 것은 주행 중 숨김)
      final uturns = _impl.uturnPoints;
      if (uturns != null && uturns.isNotEmpty) {
        final pri = _getPrimaryRouteLatLngs();
        final curProgress = _isNavigating ? _impl.routeProgressIndex : 0;
        final icon = await _image('uturn', const _UturnMarkerWidget(), const Size(32, 32));
        if (!_canUseMap) return;
        for (int k = 0; k < uturns.length; k++) {
          final u = uturns[k];
          final uLatLng = LatLng(u.lat, u.lng);
          if (_isNavigating && pri != null && pri.isNotEmpty) {
            int nearestIdx = 0;
            double minDist = double.infinity;
            for (int j = 0; j < pri.length; j++) {
              final d = _distanceMeters(uLatLng, pri[j]);
              if (d < minDist) {
                minDist = d;
                nearestIdx = j;
              }
            }
            if (nearestIdx < curProgress - 1) continue;
          }
          final id = 'uturn_$k';
          wanted.add(id);
          if (_overlays[id] == null) {
            final m = NMarker(
              id: id,
              position: NLatLng(u.lat, u.lng),
              icon: icon,
              anchor: NPoint.relativeCenter,
            );
            m.setGlobalZIndex(200002);
            _overlays[id] = m;
            await map.addOverlay(m);
          }
        }
      }

      // 내 위치 차량 마커
      if (_hasInitialLocation && _meMarker == null) {
        final icon = await _image('car', const _CarMarkerWidget(screenAngleDeg: 0), const Size(48, 48));
        if (!_canUseMap) return;
        final m = NMarker(
          id: 'me',
          position: NLatLng(_animatedLat, _animatedLng),
          icon: icon,
          anchor: NPoint.relativeCenter,
          angle: _headingUp ? 0.0 : _animatedHeading,
        );
        m.setGlobalZIndex(300000);
        _meMarker = m;
        await map.addOverlay(m);
      }

      // 더 이상 필요 없는 오버레이 제거
      final stale = _overlays.keys.where((id) => !wanted.contains(id)).toList();
      for (final id in stale) {
        final ov = _overlays.remove(id);
        _overlayKeys.remove(id);
        if (ov != null) {
          await map.deleteOverlay(ov.info);
        }
      }
    } catch (e) {
      debugPrint('[nav_map_naver] syncOverlays error: $e');
    } finally {
      _syncing = false;
      if (_syncPending) {
        _syncPending = false;
        _requestSync();
      }
    }
  }

  void _updateMeMarker() {
    final m = _meMarker;
    if (m == null || !_hasInitialLocation) return;
    // 진행 방향 위 모드에서는 항상 12시(0도) 고정, 북쪽 위 모드에서는 실제 진행 방향을 가리킴
    m.setPosition(NLatLng(_animatedLat, _animatedLng));
    m.setAngle(_headingUp ? 0.0 : _animatedHeading);
  }

  // ───────────────────────── 빌드 ─────────────────────────

  @override
  Widget build(BuildContext context) {
    return NaverMap(
      options: NaverMapViewOptions(
        initialCameraPosition: NCameraPosition(
          target: NLatLng(_animatedLat, _animatedLng),
          zoom: NavMapConfig.defaultOverviewZoom,
        ),
        mapType: NMapType.basic, // 일반 지도 (밝은 테마)
        nightModeEnable: _naverNightMode,
        liteModeEnable: false,
        indoorEnable: false, // 실내 지도 끔
        buildingHeight: 0, // 건물 3D 끔
        symbolScale: 1.15, // 지도 글자 크기를 기본보다 조금 크게
        tiltGesturesEnable: false,
        maxTilt: 0,
        rotationGesturesEnable: true,
        compassEnable: false,
        scaleBarEnable: false,
        locationButtonEnable: false,
        indoorLevelPickerEnable: false,
        logoAlign: NLogoAlign.leftBottom,
        logoMargin: const EdgeInsets.only(left: 12, bottom: 12),
        minZoom: 6,
        maxZoom: 19,
        customStyleId: naverMapStyleId.isEmpty ? null : naverMapStyleId,
      ),
      onMapReady: (controller) {
        _map = controller;
        _isMapReady = true;
        if (_impl.shouldFitOnRoutes && !_isInitialFitDone && !_isNavigating) {
          _fitAllBounds();
          _isInitialFitDone = true;
        } else if (_isFollowing) {
          _applyCameraUpdate();
        }
        _requestSync();
      },
      onCameraChange: (reason, animated) {
        if (reason == NCameraUpdateReason.gesture) {
          // 사용자가 직접 화면을 조작(드래그/핀치/회전)하면 따라가기 해제
          _isFollowing = false;
          _targetYRatio = 0.5;
          _impl.onUserDrag?.call();
        }
      },
      onCustomStyleLoadFailed: (e) => debugPrint('[nav_map_naver] custom style load failed: $e'),
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
