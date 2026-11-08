class RouteStop {
  final String name;
  final String? rawName;
  final bool isMyChild;
  final double latitude;
  final double longitude;
  final String? address;
  final String? expectedTime;

  RouteStop({
    required this.name,
    this.rawName,
    this.isMyChild = false,
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
      rawName: json['rawName'],
      isMyChild: json['isMyChild'] == true,
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
  final RouteStop? myChildStop;

  RouteDataModel({
    this.vehicleId,
    this.academyName,
    this.academyLat,
    this.academyLng,
    required this.stops,
    required this.routePoints,
    this.myChildStop,
  });

  factory RouteDataModel.fromJson(Map<String, dynamic> json) {
    final academy = json['academy'] as Map<String, dynamic>?;
    final rawStops = json['stops'] as List<dynamic>? ?? [];
    final rawPoints = json['routePoints'] as List<dynamic>? ?? [];
    final rawMyChild = json['myChildStop'] as Map<String, dynamic>?;

    double? parseCoord(dynamic val) {
      if (val == null) return null;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString());
    }

    final stopsList = rawStops.map((s) => RouteStop.fromJson(s as Map<String, dynamic>)).toList();

    return RouteDataModel(
      vehicleId: json['vehicleId'] is int
          ? json['vehicleId']
          : int.tryParse(json['vehicleId']?.toString() ?? ''),
      academyName: academy?['name'],
      academyLat: parseCoord(academy?['latitude']),
      academyLng: parseCoord(academy?['longitude']),
      stops: stopsList,
      routePoints: rawPoints
          .map((p) => p is Map<String, dynamic> ? p : <String, dynamic>{})
          .toList(),
      myChildStop: rawMyChild != null
          ? RouteStop.fromJson(rawMyChild)
          : stopsList.cast<RouteStop?>().firstWhere((s) => s?.isMyChild == true, orElse: () => null),
    );
  }
}
