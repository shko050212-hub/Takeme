import 'dart:math' as math;
import 'package:flutter_test/flutter_test.dart';
import 'package:shuttle_app_driver/driver/geo.dart';

double _angleDiff(double a, double b) {
  final d = ((a - b).abs()) % 360.0;
  return d > 180.0 ? 360.0 - d : d;
}

(int, double, GeoPoint, double, double, bool) findNearestSegmentTest(
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

void main() {
  group('주행 시뮬레이션 및 경로 스냅·재탐색 알고리즘 검증', () {
    test('① 정상 주행: 경로를 따라 앞으로 진행하며 올바르게 스냅되고 순차 전진함', () {
      final path = [
        const GeoPoint(37.5000, 127.0000),
        const GeoPoint(37.5005, 127.0000),
        const GeoPoint(37.5010, 127.0000),
        const GeoPoint(37.5015, 127.0000),
        const GeoPoint(37.5020, 127.0000),
      ];

      // 차량이 0번 세그먼트 중간에서 북쪽으로 30km/h(8.3m/s) 주행 중
      final pos = const GeoPoint(37.50025, 127.0000);
      final (segIdx, frac, _, off, roadBearing, isSnapped) = findNearestSegmentTest(
        path,
        pos,
        from: 0,
        gpsHeading: 0.0,
        speedMps: 8.3,
      );

      expect(isSnapped, isTrue);
      expect(segIdx, equals(0));
      expect(frac, closeTo(0.5, 0.05));
      expect(off, lessThan(1.0));
      expect(roadBearing, closeTo(0.0, 1.0)); // 북쪽
    });

    test('② 교차로에서 반대 방향으로 잘못 진입 시 2~3초(연속 2회) 내 재탐색 트리거 조건 충족', () {
      final path = [
        const GeoPoint(37.5000, 127.0000),
        const GeoPoint(37.5010, 127.0000),
        const GeoPoint(37.5020, 127.0000),
      ];

      // 차량이 북쪽(0도) 경로에서 교차로를 지나 남쪽(180도)으로 잘못 진행
      const speedMps = 8.3; // 약 30km/h
      const wrongHeading = 180.0;
      final wrongPos1 = const GeoPoint(37.5008, 127.0000);

      // Tick 1 (1초):
      final (_, _, _, off1, roadBearing1, isSnapped1) = findNearestSegmentTest(
        path,
        wrongPos1,
        from: 0,
        gpsHeading: wrongHeading,
        speedMps: speedMps,
      );

      // 도로 방향(0도)과 차량 방향(180도) 차이가 180도 > 60도이므로 스냅 제외됨
      expect(isSnapped1, isFalse);
      final diff1 = _angleDiff(wrongHeading, roadBearing1);
      expect(diff1, greaterThanOrEqualTo(100.0));
      final isOff1 = (!isSnapped1 && off1 >= 35.0) || (diff1 >= 100.0);
      expect(isOff1, isTrue);

      // Tick 2 (2초 후):
      final wrongPos2 = const GeoPoint(37.5005, 127.0000);
      final (_, _, _, off2, roadBearing2, isSnapped2) = findNearestSegmentTest(
        path,
        wrongPos2,
        from: 0,
        gpsHeading: wrongHeading,
        speedMps: speedMps,
      );
      final diff2 = _angleDiff(wrongHeading, roadBearing2);
      final isOff2 = (!isSnapped2 && off2 >= 35.0) || (diff2 >= 100.0);
      expect(isOff2, isTrue);

      // 연속 2회 만족 -> 재탐색 즉시 트리거 (2초 시점, 2~3초 내 재탐색 요건 충족)
      int offRouteCount = 0;
      if (isOff1) offRouteCount++;
      if (isOff2) offRouteCount++;
      expect(offRouteCount, equals(2));
    });

    test('③ 유턴 경로 주행: 13m 옆 반대편 차선(돌아오는 구간)이 있더라도 잘못 붙지 않음', () {
      // 가는 길(북쪽 0도)과 돌아오는 길(남쪽 180도)이 13m 폭으로 평행한 유턴 코스
      final path = [
        const GeoPoint(37.5000, 127.0000), // 0
        const GeoPoint(37.5010, 127.0000), // 1: 가는 길 (0도 북쪽)
        const GeoPoint(37.5020, 127.0000), // 2: 유턴 진입 전
        const GeoPoint(37.5020, 127.00015), // 3: 유턴 회전
        const GeoPoint(37.5010, 127.00015), // 4: 돌아오는 길 (180도 남쪽)
        const GeoPoint(37.5000, 127.00015), // 5: 돌아오는 길 끝
      ];

      // 차량이 가는 길(인덱스 0->1 구간)을 북쪽(heading = 0도)으로 30km/h 주행 중
      // 위치는 127.0000에서 약간 우측(127.00006)으로 치우쳐 돌아오는 길(127.00015)과 불과 8m 거리!
      const currentPos = GeoPoint(37.5005, 127.00006);
      const carHeading = 0.0; // 북쪽 진행

      final (segIdx, _, _, _, roadBearing, isSnapped) = findNearestSegmentTest(
        path,
        currentPos,
        from: 0,
        gpsHeading: carHeading,
        speedMps: 8.3,
      );

      expect(isSnapped, isTrue);
      // 돌아오는 구간(인덱스 4, 180도)으로 잘못 튀지 않고, 반드시 가는 길(인덱스 0, 0도)에 붙어야 함!
      expect(segIdx, equals(0));
      expect(roadBearing, closeTo(0.0, 1.0));
      expect(segIdx, isNot(equals(4))); // 돌아오는 구간 미스냅 확인
    });
  });
}
