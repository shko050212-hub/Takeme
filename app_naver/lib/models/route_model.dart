import '../driver/geo.dart';

class RouteStop {
  final String id;
  final String name;
  final double latitude;
  final double longitude;
  final String? address;
  final String? expectedTime;
  final bool isTest;
  bool passed;

  RouteStop({
    required this.id,
    required this.name,
    required this.latitude,
    required this.longitude,
    this.address,
    this.expectedTime,
    this.isTest = false,
    this.passed = false,
  });

  GeoPoint get point => GeoPoint(latitude, longitude);

  factory RouteStop.fromJson(Map<String, dynamic> json) {
    double parseCoord(dynamic val) {
      if (val is num) return val.toDouble();
      return double.tryParse(val?.toString() ?? '0') ?? 0.0;
    }

    return RouteStop(
      id: json['id']?.toString() ?? '',
      name: json['name'] ?? json['title'] ?? '',
      latitude: parseCoord(json['latitude'] ?? json['lat']),
      longitude: parseCoord(json['longitude'] ?? json['lng']),
      address: json['address'],
      expectedTime: json['expectedTime'],
      isTest: json['isTest'] == true,
      passed: json['passed'] == true,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'lat': latitude,
    'lng': longitude,
    'address': address,
    'expectedTime': expectedTime,
    'test': isTest,
    'passed': passed,
  };
}

class RouteDataModel {
  final int? vehicleId;
  final String? routeName;
  final String? academyName;
  final double? academyLat;
  final double? academyLng;
  final List<RouteStop> stops;
  final List<GeoPoint> routePoints;

  RouteDataModel({
    this.vehicleId,
    this.routeName,
    this.academyName,
    this.academyLat,
    this.academyLng,
    required this.stops,
    required this.routePoints,
  });

  GeoPoint? get academyPoint =>
      (academyLat != null && academyLng != null) ? GeoPoint(academyLat!, academyLng!) : null;

  factory RouteDataModel.fromJson(Map<String, dynamic> json) {
    final academy = json['academy'] as Map<String, dynamic>?;
    final rawStops = json['stops'] as List<dynamic>? ?? [];
    final rawPoints = json['routePoints'] as List<dynamic>? ?? [];

    double? parseCoord(dynamic val) {
      if (val == null) return null;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString());
    }

    final stops = rawStops.map((s) => RouteStop.fromJson(s as Map<String, dynamic>)).toList();
    final points = <GeoPoint>[];

    for (final p in rawPoints) {
      if (p is Map<String, dynamic>) {
        final lat = parseCoord(p['latitude'] ?? p['lat']);
        final lng = parseCoord(p['longitude'] ?? p['lng']);
        if (lat != null && lng != null) points.add(GeoPoint(lat, lng));
      }
    }

    return RouteDataModel(
      vehicleId: json['vehicleId'] is int
          ? json['vehicleId']
          : int.tryParse(json['vehicleId']?.toString() ?? ''),
      routeName: json['routeName'] ?? json['route']?['name'],
      academyName: academy?['name'] ?? json['academyName'],
      academyLat: parseCoord(academy?['latitude'] ?? json['academyLat']),
      academyLng: parseCoord(academy?['longitude'] ?? json['academyLng']),
      stops: stops,
      routePoints: points,
    );
  }
}
