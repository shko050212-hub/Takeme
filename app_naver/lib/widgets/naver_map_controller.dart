import '../driver/geo.dart';

abstract class NaverMapController {
  bool get isReady;
  void Function(GeoPoint point)? onMapClick;

  void setRoutes({
    List<GeoPoint>? primary,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    String? destinationName,
    bool fit = true,
  });

  void clearRoutes();
  void setMyLocation(GeoPoint p);
  void moveBus(GeoPoint p, {bool follow = true});
  void hideBus();
  void centerOn(GeoPoint p, {int zoom = 17});
  void markStopPassed(int index);
  void fitAll();
  void setClientId(String clientId);
  void dispose();
}
