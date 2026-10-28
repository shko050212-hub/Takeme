import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../driver/geo.dart';

/// 기사 내비게이션용 지도 (팀 앱의 KakaoMapView 와 같은 Leaflet + OpenStreetMap)
/// 버스가 새 위치로 부드럽게 이동하고, 따라가기 모드에서는 지도가 버스를 따라간다.
class NavMapController {
  NavMapController() {
    web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF8FAFC))
      ..addJavaScriptChannel('TakemeNav', onMessageReceived: _onMessage)
      ..loadHtmlString(_html);
  }

  late final WebViewController web;
  bool _ready = false;
  final List<String> _pending = [];

  void _onMessage(JavaScriptMessage m) {
    if (m.message == 'ready') {
      _ready = true;
      for (final js in _pending) {
        web.runJavaScript(js);
      }
      _pending.clear();
    }
  }

  void _run(String js) {
    if (_ready) {
      web.runJavaScript(js);
    } else {
      _pending.add(js);
    }
  }

  void setRoute({
    required List<GeoPoint> path,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
  }) {
    final p = jsonEncode(path.map((e) => e.toJson()).toList());
    final s = jsonEncode(stops);
    final a = jsonEncode(academy?.toJson());
    _run('window.setRoute($p, $s, $a);');
  }

  void moveBus(GeoPoint p, {bool follow = true}) => _run('window.moveBus(${p.lat}, ${p.lng}, $follow);');

  void markStopPassed(int index) => _run('window.markStop($index);');

  void fitAll() => _run('window.fitAll();');
}

class NavMapView extends StatelessWidget {
  final NavMapController controller;
  const NavMapView({super.key, required this.controller});

  @override
  Widget build(BuildContext context) => WebViewWidget(controller: controller.web);
}

const String _html = '''
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f8fafc; }
    .stop-marker {
      width: 28px; height: 28px; border-radius: 50%;
      background: #2563eb; color: #fff; font: bold 13px sans-serif;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .stop-marker.passed { background: #94a3b8; }
    .academy-marker {
      width: 30px; height: 30px; border-radius: 8px; background: #10b981; color: #fff;
      font: bold 13px sans-serif; display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(16,185,129,0.5);
    }
    .bus-marker {
      width: 34px; height: 34px; border-radius: 50%; background: #ef4444;
      border: 3px solid #fff; box-shadow: 0 3px 10px rgba(239,68,68,0.6);
      display: flex; align-items: center; justify-content: center; color: #fff; font: bold 11px sans-serif;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: true }).setView([37.5665, 126.9780], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    var line = null, bus = null, academy = null, stopMarkers = [];
    var lastBounds = null, cur = null, anim = null, zoomedIn = false;

    function icon(cls, text, size) {
      return L.divIcon({
        className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: '<div class="' + cls + '">' + text + '</div>'
      });
    }

    window.setRoute = function (path, stops, aca) {
      var pts = [];
      if (line) { map.removeLayer(line); line = null; }
      if (path && path.length > 1) {
        var ll = path.map(function (p) { return [p.lat, p.lng]; });
        line = L.polyline(ll, { color: '#2563eb', weight: 7, opacity: 0.85 }).addTo(map);
        pts = pts.concat(ll);
      }
      stopMarkers.forEach(function (m) { map.removeLayer(m); });
      stopMarkers = [];
      (stops || []).forEach(function (s, i) {
        var m = L.marker([s.lat, s.lng], {
          icon: icon('stop-marker' + (s.passed ? ' passed' : ''), String(i + 1), 28)
        }).addTo(map);
        stopMarkers.push(m);
        pts.push([s.lat, s.lng]);
      });
      if (academy) { map.removeLayer(academy); academy = null; }
      if (aca) {
        academy = L.marker([aca.lat, aca.lng], { icon: icon('academy-marker', '원', 30) }).addTo(map);
        pts.push([aca.lat, aca.lng]);
      }
      if (pts.length > 0) {
        lastBounds = L.latLngBounds(pts);
        if (!zoomedIn) map.fitBounds(lastBounds, { padding: [30, 30] });
      }
    };

    window.fitAll = function () {
      zoomedIn = false;
      if (lastBounds) map.fitBounds(lastBounds, { padding: [30, 30] });
    };

    // 이전 위치 → 새 위치로 0.9초 동안 부드럽게 이동
    window.moveBus = function (lat, lng, follow) {
      var to = { lat: lat, lng: lng };
      if (!bus) {
        cur = to;
        bus = L.marker([lat, lng], { icon: icon('bus-marker', 'BUS', 34), zIndexOffset: 1000 }).addTo(map);
      }
      if (follow && !zoomedIn) { map.setView([lat, lng], 17); zoomedIn = true; }
      if (anim) cancelAnimationFrame(anim);
      var from = { lat: cur.lat, lng: cur.lng }, start = performance.now(), dur = 900;
      function step(now) {
        var t = Math.min(1, (now - start) / dur);
        cur = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
        bus.setLatLng([cur.lat, cur.lng]);
        if (follow) map.panTo([cur.lat, cur.lng], { animate: false });
        if (t < 1) anim = requestAnimationFrame(step);
      }
      anim = requestAnimationFrame(step);
    };

    window.markStop = function (i) {
      var m = stopMarkers[i];
      if (m) m.setIcon(icon('stop-marker passed', String(i + 1), 28));
    };

    TakemeNav.postMessage('ready');
  </script>
</body>
</html>
''';
