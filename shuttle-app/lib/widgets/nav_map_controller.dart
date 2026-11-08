import 'package:flutter/foundation.dart';
import '../driver/geo.dart';

/// 교통 상태 구간 (경로 좌표 인덱스 from~to)
class TrafficSegment {
  final int from;
  final int to;
  final int state; // 카카오 traffic_state: 0 정보없음, 1 정체, 2 지체, 3 서행, 4 원활
  const TrafficSegment(this.from, this.to, this.state);
  Map<String, dynamic> toJson() => {'from': from, 'to': to, 'state': state};
}

/// 내비게이션 지도 설정 상수 (속도별 줌 레벨, 화살표 위치 비율, 스냅 거리 등)
class NavMapConfig {
  // 속도 구간 임계값 (km/h)
  static const double speedLowThreshold = 30.0;
  static const double speedHighThreshold = 60.0;

  // 속도별 줌 레벨
  static const double zoomLowSpeed = 17.5;      // < 30 km/h
  static const double zoomMidSpeed = 17.0;      // 30 ~ 60 km/h
  static const double zoomHighSpeed = 16.0;     // >= 60 km/h

  // 속도별 화살표 화면 위치 비율 (상단 기준 세로 위치)
  static const double arrowRatioLowSpeed = 0.70;  // < 30 km/h (상단에서 약 70%)
  static const double arrowRatioMidSpeed = 0.75;  // 30 ~ 60 km/h (상단에서 약 75%)
  static const double arrowRatioHighSpeed = 0.78; // >= 60 km/h (상단에서 약 78%)

  // 기본/개요 줌
  static const double defaultOverviewZoom = 15.0;
  static const double defaultNavZoom = 17.0;

  // 경로선 스냅 허용 거리 (미터)
  static const double snapRouteDistanceMeters = 30.0;

  // 정지 판단 속도 (km/h, 이 속도 미만이면 회전 흔들림 방지를 위해 마지막 방향 유지)
  static const double stationarySpeedThreshold = 3.0;

  // 보간 시간 계수 (초)
  static const double posLerpDuration = 0.85;
  static const double headingLerpDuration = 0.35;
  static const double zoomLerpDuration = 1.0;
  static const double ratioLerpDuration = 1.0;
}

abstract class NavMapController {
  factory NavMapController() => NavMapControllerImpl();

  VoidCallback? onUserDrag;

  void setRoutes({
    List<GeoPoint>? primary,
    List<TrafficSegment>? traffic,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    bool fit = true,
  });

  /// 내 위치 화살표 이동 (heading: 진행 방향, follow: 지도가 따라감, navigating: 주행 중 여부, speedKmh: 주행 속도)
  void moveMe(
    GeoPoint p, {
    double? heading,
    bool follow = false,
    bool navigating = false,
    double? speedKmh,
  });

  void centerOn(GeoPoint p, {int zoom = 16});
  void markStopPassed(int index);
  void fitAll();
  void setHeadingUp(bool enabled);
  void resetZoom();

  // Legacy/compatibility methods
  void setMyLocation(GeoPoint p);
  void moveBus(GeoPoint p, {bool follow = true});
  void hideBus();
  void setInteractive(bool interactive);
}

class NavMapControllerImpl implements NavMapController {
  @override
  VoidCallback? onUserDrag;

  // 내부 상태 보관 (View가 늦게 빌드되거나 재빌드되어도 데이터 유지)
  List<GeoPoint>? primaryRoute;
  List<TrafficSegment>? trafficSegments;
  List<GeoPoint>? alternateRoute;
  List<Map<String, dynamic>> stops = [];
  GeoPoint? academy;
  bool shouldFitOnRoutes = true;

  GeoPoint? currentPosition;
  double? currentHeading;
  bool isFollowing = false;
  bool isNavigating = false;
  double? currentSpeedKmh;

  bool headingUp = true;
  final Set<int> passedStopIndices = {};

  // View 바인딩 리스너
  final List<VoidCallback> _listeners = [];
  void addListener(VoidCallback l) => _listeners.add(l);
  void removeListener(VoidCallback l) => _listeners.remove(l);
  void _notify() {
    for (final l in List<VoidCallback>.from(_listeners)) {
      l();
    }
  }

  // View 특정 명령 콜백 (View가 붙어 있을 때 직접 트리거)
  void Function(GeoPoint p, int zoom)? onCenterOn;
  VoidCallback? onFitAll;
  VoidCallback? onResetZoom;

  @override
  void setRoutes({
    List<GeoPoint>? primary,
    List<TrafficSegment>? traffic,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    bool fit = true,
  }) {
    primaryRoute = primary;
    trafficSegments = traffic;
    alternateRoute = alternate;
    this.stops = List<Map<String, dynamic>>.from(stops);
    this.academy = academy;
    shouldFitOnRoutes = fit;
    passedStopIndices.clear();
    for (int i = 0; i < stops.length; i++) {
      if (stops[i]['passed'] == true) {
        passedStopIndices.add(i);
      }
    }
    _notify();
  }

  @override
  void moveMe(
    GeoPoint p, {
    double? heading,
    bool follow = false,
    bool navigating = false,
    double? speedKmh,
  }) {
    currentPosition = p;
    if (heading != null && !heading.isNaN) {
      currentHeading = heading;
    }
    isFollowing = follow;
    isNavigating = navigating;
    if (speedKmh != null) {
      currentSpeedKmh = speedKmh;
    }
    _notify();
  }

  @override
  void centerOn(GeoPoint p, {int zoom = 16}) {
    isFollowing = false;
    currentPosition = p;
    onCenterOn?.call(p, zoom);
    _notify();
  }

  @override
  void markStopPassed(int index) {
    passedStopIndices.add(index);
    if (index >= 0 && index < stops.length) {
      stops[index]['passed'] = true;
    }
    _notify();
  }

  @override
  void fitAll() {
    isFollowing = false;
    headingUp = false;
    onFitAll?.call();
    _notify();
  }

  @override
  void setHeadingUp(bool enabled) {
    headingUp = enabled;
    _notify();
  }

  @override
  void resetZoom() {
    isFollowing = false;
    onResetZoom?.call();
    _notify();
  }

  @override
  void setMyLocation(GeoPoint p) => moveMe(p);

  @override
  void moveBus(GeoPoint p, {bool follow = true}) => moveMe(p, follow: follow);

  @override
  void hideBus() {}

  @override
  void setInteractive(bool interactive) {}
}

NavMapController createNavMapController() => NavMapControllerImpl();
