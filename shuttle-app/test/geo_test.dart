import 'package:flutter_test/flutter_test.dart';
import 'package:shuttle_app/driver/geo.dart';

void main() {
  group('geo', () {
    test('위도 0.001도는 약 111m', () {
      final d = distanceM(const GeoPoint(37.5, 127.0), const GeoPoint(37.501, 127.0));
      expect(d, closeTo(111.2, 1.0));
    });

    test('누적 거리와 경로 위 지점 계산', () {
      const path = [GeoPoint(37.5, 127.0), GeoPoint(37.501, 127.0), GeoPoint(37.502, 127.0)];
      final cum = cumulativeDistances(path);
      expect(cum.length, 3);
      expect(cum.last, closeTo(222.4, 2.0));

      final mid = pointAlong(path, cum, cum.last / 2);
      expect(mid.lat, closeTo(37.501, 0.0001));
      expect(pointAlong(path, cum, -5).lat, 37.5); // 시작 전은 첫 점
      expect(pointAlong(path, cum, 99999).lat, 37.502); // 끝 이후는 마지막 점
    });

    test('가장 가까운 경로 점 찾기 (검색 범위 제한)', () {
      const path = [GeoPoint(37.5, 127.0), GeoPoint(37.501, 127.0), GeoPoint(37.502, 127.0)];
      const p = GeoPoint(37.5021, 127.0);
      expect(nearestIndex(path, p), 2);
      expect(nearestIndex(path, p, from: 0, to: 1), 1); // 범위 밖(2)은 고려하지 않음
    });

    test('거리 표시', () {
      expect(formatDistance(343), '340m');
      expect(formatDistance(1260), '1.3km');
    });
    test('진행 방향 (북 0도, 동 90도)', () {
      const a = GeoPoint(37.5, 127.0);
      expect(bearingDeg(a, const GeoPoint(37.501, 127.0)), closeTo(0, 0.5));
      expect(bearingDeg(a, const GeoPoint(37.5, 127.001)), closeTo(90, 0.5));
      expect(bearingDeg(a, const GeoPoint(37.499, 127.0)), closeTo(180, 0.5));
    });
  });
}
