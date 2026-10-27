import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../models/route_model.dart';

class KakaoMapView extends StatefulWidget {
  final List<RouteStop> stops;
  final List<Map<String, dynamic>> routePoints;
  final double? busLat;
  final double? busLng;
  final double? academyLat;
  final double? academyLng;
  final String? academyName;

  const KakaoMapView({
    super.key,
    required this.stops,
    required this.routePoints,
    this.busLat,
    this.busLng,
    this.academyLat,
    this.academyLng,
    this.academyName,
  });

  @override
  State<KakaoMapView> createState() => _KakaoMapViewState();
}

class _KakaoMapViewState extends State<KakaoMapView> {
  WebViewController? _controller;
  bool _isMapLoaded = false;

  @override
  void initState() {
    super.initState();
    if (!kIsWeb) {
      _controller = WebViewController()
        ..setJavaScriptMode(JavaScriptMode.unrestricted)
        ..setNavigationDelegate(
          NavigationDelegate(
            onPageFinished: (_) {
              setState(() {
                _isMapLoaded = true;
              });
              _updateMapData();
            },
          ),
        )
        ..loadHtmlString(_generateHtml());
    }
  }

  @override
  void didUpdateWidget(covariant KakaoMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_isMapLoaded && _controller != null) {
      if (oldWidget.busLat != widget.busLat || oldWidget.busLng != widget.busLng) {
        _updateBusLocation();
      }
    }
  }

  void _updateBusLocation() {
    if (widget.busLat != null && widget.busLng != null) {
      final js = 'if (window.updateBus) { window.updateBus(${widget.busLat}, ${widget.busLng}); }';
      _controller?.runJavaScript(js);
    }
  }

  void _updateMapData() {
    final stopsJson = jsonEncode(widget.stops.map((s) => {
      'name': s.name,
      'lat': s.latitude,
      'lng': s.longitude,
    }).toList());

    final pointsJson = jsonEncode(widget.routePoints.map((p) => [
      p['latitude'] ?? p['lat'],
      p['longitude'] ?? p['lng'],
    ]).where((p) => p[0] != null && p[1] != null).toList());

    final js = '''
      if (window.initData) {
        window.initData($stopsJson, $pointsJson, ${widget.academyLat ?? 'null'}, ${widget.academyLng ?? 'null'}, "${widget.academyName ?? ''}", ${widget.busLat ?? 'null'}, ${widget.busLng ?? 'null'});
      }
    ''';
    _controller?.runJavaScript(js);
  }

  String _generateHtml() {
    final centerLat = widget.academyLat ?? widget.busLat ?? (widget.stops.isNotEmpty ? widget.stops.first.latitude : 37.5580);
    final centerLng = widget.academyLng ?? widget.busLng ?? (widget.stops.isNotEmpty ? widget.stops.first.longitude : 126.8240);

    return '''
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; background: #f8fafc; }
        .bus-marker {
          background-color: #2563eb;
          color: white;
          border-radius: 50%;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 11px;
          border: 3px solid white;
          box-shadow: 0 4px 6px rgba(0,0,0,0.3);
        }
        .stop-marker {
          background-color: #10b981;
          color: white;
          border-radius: 50%;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 10px;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .academy-marker {
          background-color: #f59e0b;
          color: white;
          border-radius: 8px;
          padding: 4px 8px;
          font-weight: bold;
          font-size: 11px;
          border: 2px solid white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          white-space: nowrap;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', { zoomControl: false }).setView([$centerLat, $centerLng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map);

        var busMarker = null;
        var polyline = null;

        window.updateBus = function(lat, lng) {
          if (!lat || !lng) return;
          if (busMarker) {
            busMarker.setLatLng([lat, lng]);
          } else {
            var icon = L.divIcon({
              className: '',
              html: '<div class="bus-marker">BUS</div>',
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });
            busMarker = L.marker([lat, lng], { icon: icon }).addTo(map);
          }
        };

        window.initData = function(stops, points, acLat, acLng, acName, bLat, bLng) {
          if (acLat && acLng) {
            var acIcon = L.divIcon({
              className: '',
              html: '<div class="academy-marker">' + (acName || '유치원') + '</div>',
              iconSize: [80, 24],
              iconAnchor: [40, 12]
            });
            L.marker([acLat, acLng], { icon: acIcon }).addTo(map);
          }

          if (stops && stops.length) {
            stops.forEach(function(s, idx) {
              if (s.lat && s.lng) {
                var icon = L.divIcon({
                  className: '',
                  html: '<div class="stop-marker">' + (idx + 1) + '</div>',
                  iconSize: [24, 24],
                  iconAnchor: [12, 12]
                });
                L.marker([s.lat, s.lng], { icon: icon }).bindPopup(s.name).addTo(map);
              }
            });
          }

          if (points && points.length) {
            if (polyline) map.removeLayer(polyline);
            polyline = L.polyline(points, { color: '#2563eb', weight: 4, opacity: 0.8 }).addTo(map);
            map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
          }

          if (bLat && bLng) {
            window.updateBus(bLat, bLng);
          }
        };
      </script>
    </body>
    </html>
    ''';
  }

  @override
  Widget build(BuildContext context) {
    if (kIsWeb || _controller == null) {
      return Container(
        color: const Color(0xFFF1F5F9),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.map, size: 48, color: Color(0xFF94A3B8)),
              const SizedBox(height: 8),
              Text(
                widget.academyName ?? '실시간 지도 정보',
                style: const TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF475569)),
              ),
              if (widget.stops.isNotEmpty)
                Text(
                  '등록된 탑승지 ${widget.stops.length}개소',
                  style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                ),
            ],
          ),
        ),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: WebViewWidget(controller: _controller!),
    );
  }
}
