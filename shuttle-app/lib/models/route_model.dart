class RouteStop {
  final String name;
  final double latitude;
  final double longitude;
  final String? address;
  final String? expectedTime;

  RouteStop({
    required this.name,
    required this.latitude,
    required this.longitude,
    this.address,
    this.expectedTime,
  });

  factory RouteStop.fromJson(Map<String, dynamic> json) {
    double parseCoord(dynamic val) {
      if (val is num) return val.toDouble();
      return double.tryParse(val?.toString() ?? '0') ?? 0.0;
    }

    return RouteStop(
      name: json['name'] ?? json['title'] ?? '',
      latitude: parseCoord(json['latitude'] ?? json['lat']),
      longitude: parseCoord(json['longitude'] ?? json['lng']),
      address: json['address'],
      expectedTime: json['expectedTime'],
    );
  }
}

class RouteDataModel {
  final int? vehicleId;
  final String? academyName;
  final double? academyLat;
  final double? academyLng;
  final List<RouteStop> stops;
  final List<Map<String, dynamic>> routePoints;

  RouteDataModel({
    this.vehicleId,
    this.academyName,
    this.academyLat,
    this.academyLng,
    required this.stops,
    required this.routePoints,
  });

  factory RouteDataModel.fromJson(Map<String, dynamic> json) {
    final academy = json['academy'] as Map<String, dynamic>?;
    final rawStops = json['stops'] as List<dynamic>? ?? [];
    final rawPoints = json['routePoints'] as List<dynamic>? ?? [];

    double? parseCoord(dynamic val) {
      if (val == null) return null;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString());
    }

    return RouteDataModel(
      vehicleId: json['vehicleId'] is int
          ? json['vehicleId']
          : int.tryParse(json['vehicleId']?.toString() ?? ''),
      academyName: academy?['name'],
      academyLat: parseCoord(academy?['latitude']),
      academyLng: parseCoord(academy?['longitude']),
      stops: rawStops.map((s) => RouteStop.fromJson(s as Map<String, dynamic>)).toList(),
      routePoints: rawPoints
          .map((p) => p is Map<String, dynamic> ? p : <String, dynamic>{})
          .toList(),
    );
  }
}
