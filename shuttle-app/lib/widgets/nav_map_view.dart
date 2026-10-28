import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../driver/geo.dart';

/// 기사 내비게이션 지도 (팀 앱과 같은 Leaflet + OpenStreetMap)
/// - 선택한 경로(파란 실선)와 비교용 다른 경로(회색 점선)
/// - 정류장 번호, 테스트 정류장(주황 T), 유치원
/// - 운행 전: 내 위치(파란 점) / 운행 중: 버스 마커가 부드럽게 이동
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

  String _pts(List<GeoPoint>? p) => jsonEncode(p?.map((e) => e.toJson()).toList());

  /// primary: 선택한 경로, alternate: 비교용 경로 (없으면 null)
  void setRoutes({
    List<GeoPoint>? primary,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    bool fit = true,
  }) {
    _run('window.setRoutes(${_pts(primary)}, ${_pts(alternate)}, ${jsonEncode(stops)}, '
        '${jsonEncode(academy?.toJson())}, $fit);');
  }

  /// 운행 전 내 위치 (서버로 보내지 않음)
  void setMyLocation(GeoPoint p) => _run('window.setMyLocation(${p.lat}, ${p.lng});');

  /// 운행 중 버스 위치
  void moveBus(GeoPoint p, {bool follow = true}) => _run('window.moveBus(${p.lat}, ${p.lng}, $follow);');

  void hideBus() => _run('window.hideBus();');

  void centerOn(GeoPoint p, {int zoom = 17}) => _run('window.centerOn(${p.lat}, ${p.lng}, $zoom);');

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
      width: 30px; height: 30px; border-radius: 50%;
      background: #2563eb; color: #fff; font: bold 14px sans-serif;
      display: flex; align-items: center; justify-content: center;
      border: 3px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    }
    .stop-marker.passed { background: #94a3b8; text-decoration: line-through; }
    .stop-marker.test { background: #ea580c; border-style: dashed; }
    .academy-marker {
      min-width: 34px; height: 34px; padding: 0 6px; border-radius: 8px; background: #10b981; color: #fff;
      font: bold 13px sans-serif; display: flex; align-items: center; justify-content: center;
      border: 3px solid #fff; box-shadow: 0 2px 6px rgba(16,185,129,0.5); white-space: nowrap;
    }
    .bus-marker {
      width: 38px; height: 38px; border-radius: 50%; background: #ef4444;
      border: 3px solid #fff; box-shadow: 0 3px 10px rgba(239,68,68,0.6);
      display: flex; align-items: center; justify-content: center; color: #fff; font: bold 11px sans-serif;
    }
    .me-marker {
      width: 20px; height: 20px; border-radius: 50%; background: #2563eb;
      border: 4px solid #fff; box-shadow: 0 0 0 6px rgba(37,99,235,0.25);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([37.5665, 126.9780], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    // 출처 표시는 왼쪽 아래로 (오른쪽 아래는 앱의 지도 버튼 자리)
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('&copy; OpenStreetMap').addTo(map);

    var primary = null, alternate = null, academy = null, stopMarkers = [];
    var me = null, bus = null, lastBounds = null, cur = null, anim = null, zoomedIn = false;

    function icon(cls, text, size) {
      return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: '<div class="' + cls + '">' + text + '</div>' });
    }
    function toLL(path) { return (path || []).map(function (p) { return [p.lat, p.lng]; }); }

    window.setRoutes = function (pri, alt, stops, aca, fit) {
      var pts = [];
      if (alternate) { map.removeLayer(alternate); alternate = null; }
      if (primary) { map.removeLayer(primary); primary = null; }
      if (alt && alt.length > 1) {
        alternate = L.polyline(toLL(alt), { color: '#64748b', weight: 5, opacity: 0.7, dashArray: '8 10' }).addTo(map);
        pts = pts.concat(toLL(alt));
      }
      if (pri && pri.length > 1) {
        primary = L.polyline(toLL(pri), { color: '#2563eb', weight: 8, opacity: 0.9 }).addTo(map);
        pts = pts.concat(toLL(pri));
      }
      stopMarkers.forEach(function (m) { map.removeLayer(m); });
      stopMarkers = [];
      (stops || []).forEach(function (s, i) {
        var cls = 'stop-marker' + (s.test ? ' test' : '') + (s.passed ? ' passed' : '');
        var label = (s.test ? 'T' : '') + (i + 1);
        stopMarkers.push(L.marker([s.lat, s.lng], { icon: icon(cls, label, 30) }).addTo(map));
        pts.push([s.lat, s.lng]);
      });
      if (academy) { map.removeLayer(academy); academy = null; }
      if (aca) {
        academy = L.marker([aca.lat, aca.lng], { icon: icon('academy-marker', '유치원', 34) }).addTo(map);
        pts.push([aca.lat, aca.lng]);
      }
      if (me) pts.push(me.getLatLng());
      if (pts.length > 0) {
        lastBounds = L.latLngBounds(pts);
        if (fit && !zoomedIn) map.fitBounds(lastBounds, { padding: [40, 40] });
      }
    };

    window.setMyLocation = function (lat, lng) {
      if (!me) me = L.marker([lat, lng], { icon: icon('me-marker', '', 20), zIndexOffset: 900 }).addTo(map);
      else me.setLatLng([lat, lng]);
    };

    window.centerOn = function (lat, lng, zoom) { map.setView([lat, lng], zoom); };

    window.fitAll = function () {
      zoomedIn = false;
      if (lastBounds) map.fitBounds(lastBounds, { padding: [40, 40] });
    };

    // 이전 위치 → 새 위치로 0.9초 동안 부드럽게 이동
    window.moveBus = function (lat, lng, follow) {
      var to = { lat: lat, lng: lng };
      if (me) { map.removeLayer(me); me = null; }
      if (!bus) {
        cur = to;
        bus = L.marker([lat, lng], { icon: icon('bus-marker', 'BUS', 38), zIndexOffset: 1000 }).addTo(map);
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

    window.hideBus = function () {
      if (anim) cancelAnimationFrame(anim);
      if (bus) { map.removeLayer(bus); bus = null; }
      zoomedIn = false;
    };

    window.markStop = function (i) {
      var m = stopMarkers[i];
      if (!m) return;
      var el = m.getElement && m.getElement();
      var div = el && el.querySelector('.stop-marker');
      if (div && div.className.indexOf('passed') < 0) div.className += ' passed';
    };

    TakemeNav.postMessage('ready');
  </script>
</body>
</html>
''';
