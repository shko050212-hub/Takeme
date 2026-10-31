import 'dart:math' as math;

class GeoPoint {
  final double lat;
  final double lng;
  const GeoPoint(this.lat, this.lng);

  Map<String, dynamic> toJson() => {'lat': lat, 'lng': lng};

  factory GeoPoint.fromJson(Map<String, dynamic> json) {
    final latVal = toDouble(json['lat'] ?? json['latitude']) ?? 0.0;
    final lngVal = toDouble(json['lng'] ?? json['longitude']) ?? 0.0;
    return GeoPoint(latVal, lngVal);
  }

  @override
  String toString() => 'GeoPoint($lat, $lng)';
}

double? toDouble(dynamic v) {
  if (v == null) return null;
  if (v is num) return v.toDouble();
  return double.tryParse(v.toString());
}

/// 두 좌표 사이 구면 거리 (m)
double distanceM(GeoPoint a, GeoPoint b) {
  const r = 6371000.0;
  final dLat = _rad(b.lat - a.lat);
  final dLng = _rad(b.lng - a.lng);
  final h = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(_rad(a.lat)) * math.cos(_rad(b.lat)) * math.sin(dLng / 2) * math.sin(dLng / 2);
  return 2 * r * math.asin(math.sqrt(h));
}

double _rad(double d) => d * math.pi / 180;

/// 경로(점 목록)를 따라 누적 거리를 미리 계산
List<double> cumulativeDistances(List<GeoPoint> path) {
  if (path.isEmpty) return [0.0];
  final cum = <double>[0];
  for (var i = 1; i < path.length; i++) {
    cum.add(cum[i - 1] + distanceM(path[i - 1], path[i]));
  }
  return cum;
}

/// [from]~[to] 범위에서 p와 가장 가까운 경로 점의 인덱스
int nearestIndex(List<GeoPoint> path, GeoPoint p, {int from = 0, int? to}) {
  if (path.isEmpty) return 0;
  final end = math.min(to ?? path.length - 1, path.length - 1);
  var best = math.max(0, from);
  var bestD = double.infinity;
  for (var i = math.max(0, from); i <= end; i++) {
    final d = distanceM(path[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/// 경로 시작점에서 [meters] 만큼 이동한 지점 (시뮬레이션 주행용 보간)
GeoPoint pointAlong(List<GeoPoint> path, List<double> cum, double meters) {
  if (path.isEmpty) return const GeoPoint(37.5665, 126.9780);
  if (meters <= 0) return path.first;
  if (meters >= cum.last) return path.last;
  var i = 1;
  while (i < cum.length && cum[i] < meters) {
    i++;
  }
  final seg = cum[i] - cum[i - 1];
  final t = seg == 0 ? 0.0 : (meters - cum[i - 1]) / seg;
  final a = path[i - 1];
  final b = path[i];
  return GeoPoint(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
}

/// 거리 포맷팅 (m 또는 km 단위)
String formatDistance(double m) {
  if (m < 1000) return '${(m / 10).round() * 10}m';
  return '${(m / 1000).toStringAsFixed(1)}km';
}

/// 두 점 사이의 방위각 (0~360도)
double calculateHeading(GeoPoint from, GeoPoint to) {
  final dLng = _rad(to.lng - from.lng);
  final lat1 = _rad(from.lat);
  final lat2 = _rad(to.lat);

  final y = math.sin(dLng) * math.cos(lat2);
  final x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLng);

  final radians = math.atan2(y, x);
  return (radians * 180 / math.pi + 360) % 360;
}
