import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart' hide Path;

import 'nav_map_controller.dart';

export 'nav_map_controller.dart';

const String _vworldKey = String.fromEnvironment('VWORLD_KEY', defaultValue: '');

class NavMapView extends StatefulWidget {
  final NavMapController controller;

  const NavMapView({super.key, required this.controller});

  @override
  State<NavMapView> createState() => _NavMapViewState();
}

class _NavMapViewState extends State<NavMapView> with SingleTickerProviderStateMixin {
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
  double _currentMapRotation = 0.0;

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
  void didUpdateWidget(covariant NavMapView oldWidget) {
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
      final snapped = navigating ? _snapToRoute(rawLatLng, primary) : rawLatLng;
      _targetPos = snapped;

      if (!_hasInitialLocation) {
        _hasInitialLocation = true;
        _animatedLat = snapped.latitude;
        _animatedLng = snapped.longitude;
      }

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
      // 1. 위치 부드러운 보간 (GPS 약 1초 간격 보간)
      final posFactor = (clampedDt / NavMapConfig.posLerpDuration).clamp(0.0, 1.0);
      _animatedLat += (_targetPos.latitude - _animatedLat) * posFactor;
      _animatedLng += (_targetPos.longitude - _animatedLng) * posFactor;

      // 2. 방향 부드러운 보간 (최단 각도 회전)
      final headingFactor = (clampedDt / NavMapConfig.headingLerpDuration).clamp(0.0, 1.0);
      _animatedHeading += (_targetHeading - _animatedHeading) * headingFactor;

      // 3. 줌 레벨 부드러운 보간
      final zoomFactor = (clampedDt / NavMapConfig.zoomLerpDuration).clamp(0.0, 1.0);
      _animatedZoom += (_targetZoom - _animatedZoom) * zoomFactor;

      // 4. 화면 화살표 Y비율 부드러운 보간
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

  /// 경로선 30m 이내 스냅 계산 (투영점 산출)
  LatLng _snapToRoute(LatLng rawPos, List<LatLng>? primaryRoute) {
    if (primaryRoute == null || primaryRoute.length < 2) return rawPos;

    const rad = math.pi / 180.0;
    const latScale = 111132.954;
    final lngScale = 111412.84 * math.cos(rawPos.latitude * rad);

    final px = rawPos.longitude * lngScale;
    final py = rawPos.latitude * latScale;

    double bestDistSq =
        NavMapConfig.snapRouteDistanceMeters * NavMapConfig.snapRouteDistanceMeters;
    LatLng? bestPoint;

    for (int i = 0; i < primaryRoute.length - 1; i++) {
      final a = primaryRoute[i];
      final b = primaryRoute[i + 1];

      final ax = a.longitude * lngScale;
      final ay = a.latitude * latScale;
      final bx = b.longitude * lngScale;
      final by = b.latitude * latScale;

      final dx = bx - ax;
      final dy = by - ay;
      final segLenSq = dx * dx + dy * dy;
      if (segLenSq < 1e-6) continue;

      final t = ((px - ax) * dx + (py - ay) * dy) / segLenSq;
      final clampedT = t.clamp(0.0, 1.0);

      final cx = ax + clampedT * dx;
      final cy = ay + clampedT * dy;

      final distSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestPoint = LatLng(
          a.latitude + clampedT * (b.latitude - a.latitude),
          a.longitude + clampedT * (b.longitude - a.longitude),
        );
      }
    }

    return bestPoint ?? rawPos;
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

    // 2. 주 경로 기본 윤곽선 (진한 테두리선)
    final pri = _getPrimaryRouteLatLngs();
    if (pri != null && pri.length > 1) {
      lines.add(
        Polyline(
          points: pri,
          color: const Color(0xFF14532D).withValues(alpha: 0.4),
          strokeWidth: 12,
          strokeCap: StrokeCap.round,
          strokeJoin: StrokeJoin.round,
        ),
      );

      // 3. 교통 색상 경로 (정체 빨강, 서행 노랑, 원활 파랑/초록)
      final traffic = _impl.trafficSegments;
      if (traffic != null && traffic.isNotEmpty) {
        for (final seg in traffic) {
          final from = seg.from.clamp(0, pri.length - 1);
          final to = (seg.to + 1).clamp(0, pri.length);
          if (to > from + 1) {
            lines.add(
              Polyline(
                points: pri.sublist(from, to),
                color: _trafficColor(seg.state),
                strokeWidth: 8,
                strokeCap: StrokeCap.round,
                strokeJoin: StrokeJoin.round,
              ),
            );
          }
        }
      } else {
        lines.add(
          Polyline(
            points: pri,
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

    // 3. 내 위치 차량 마커 (흰 원 안의 파란 화살표, 진행 방향 회전)
    if (_hasInitialLocation) {
      // 화면 기준 화살표 회전각: 진행방향(animatedHeading) + 지도회전각(mapRotation)
      // headingUp 모드에서는 mapRotation = -animatedHeading 이므로 screenAngle = 0 (정확히 위쪽 12시 고정)
      final mapRot = _isMapReady ? _currentMapRotation : (_headingUp ? -_animatedHeading : 0.0);
      final screenAngleDeg = _animatedHeading + mapRot;

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
              _currentMapRotation = camera.rotation;
              if (hasGesture) {
                // 사용자가 직접 화면을 조작(드래그/핀치)하면 따라가기 해제
                _isFollowing = false;
                _targetYRatio = 0.5;
                _impl.onUserDrag?.call();
              }
            },
          ),
          children: [
            // 브이월드 또는 OpenStreetMap 타일 레이어 (캐시 및 panBuffer 최적화)
            TileLayer(
              urlTemplate: _vworldKey.isNotEmpty
                  ? 'https://api.vworld.kr/req/wmts/1.0.0/$_vworldKey/Base/{z}/{y}/{x}.png'
                  : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
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
