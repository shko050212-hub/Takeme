import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../driver/geo.dart';

/// 교통 상태 구간 (경로 좌표 인덱스 from~to)
class TrafficSegment {
  final int from;
  final int to;
  final int state; // 카카오 traffic_state: 0 정보없음, 1 정체, 2 지체, 3 서행, 4 원활
  const TrafficSegment(this.from, this.to, this.state);
  Map<String, dynamic> toJson() => {'from': from, 'to': to, 'state': state};
}

/// 기사 내비게이션 지도 (팀 앱과 같은 Leaflet + OpenStreetMap)
/// - 내 위치: 카카오내비처럼 흰 원 안의 화살표, 진행 방향으로 회전
/// - 선택한 경로: 교통 상황 색 (원활 파랑 / 서행·지체 노랑 / 정체 빨강)
/// - 비교용 다른 경로: 회색 점선
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

  void setRoutes({
    List<GeoPoint>? primary,
    List<TrafficSegment>? traffic,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    bool fit = true,
  }) {
    final t = jsonEncode(traffic?.map((e) => e.toJson()).toList());
    _run('window.setRoutes(${_pts(primary)}, $t, ${_pts(alternate)}, ${jsonEncode(stops)}, '
        '${jsonEncode(academy?.toJson())}, $fit);');
  }

  /// 내 위치 화살표 이동 (heading: 진행 방향, follow: 지도가 따라감)
  void moveMe(GeoPoint p, {double? heading, bool follow = false, bool navigating = false}) =>
      _run('window.moveMe(${p.lat}, ${p.lng}, ${heading ?? 'null'}, $follow, $navigating);');

  void centerOn(GeoPoint p, {int zoom = 17}) => _run('window.centerOn(${p.lat}, ${p.lng}, $zoom);');

  void markStopPassed(int index) => _run('window.markStop($index);');

  void fitAll() => _run('window.fitAll();');

  /// 운행 종료 시 확대 상태 초기화
  void resetZoom() => _run('window.resetZoom();');
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
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    }
    .stop-marker.passed { background: #94a3b8; }
    .stop-marker.test { background: #ea580c; border-style: dashed; }
    .academy-marker {
      height: 30px; padding: 0 8px; border-radius: 8px; background: #10b981; color: #fff;
      font: bold 12px sans-serif; display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(16,185,129,0.5); white-space: nowrap;
    }
    /* 카카오내비처럼: 흰 원 + 진행 방향 화살표 */
    .me { width: 46px; height: 46px; border-radius: 50%; background: #fff;
          box-shadow: 0 3px 10px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; }
    .me .arrow { width: 28px; height: 28px; transition: transform 0.4s linear; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([37.5665, 126.9780], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('&copy; OpenStreetMap').addTo(map);

    var routeLayer = L.layerGroup().addTo(map);
    var altLine = null, academy = null, stopMarkers = [];
    var me = null, lastBounds = null, cur = null, anim = null, zoomedIn = false;

    var ARROW = '<svg class="arrow" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="#2563eb" stroke="#1e3a8a" stroke-width="1" stroke-linejoin="round"/></svg>';

    function icon(cls, text, size) {
      return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: '<div class="' + cls + '">' + text + '</div>' });
    }
    function toLL(path) { return (path || []).map(function (p) { return [p.lat, p.lng]; }); }
    // 교통 상태 색: 원활·정보없음 파랑, 서행·지체 노랑, 정체 빨강
    function trafficColor(state) {
      if (state === 1 || state === 6) return '#ef4444';
      if (state === 2 || state === 3) return '#facc15';
      return '#2563eb';
    }

    window.setRoutes = function (pri, traffic, alt, stops, aca, fit) {
      var pts = [];
      routeLayer.clearLayers();
      if (altLine) { map.removeLayer(altLine); altLine = null; }
      if (alt && alt.length > 1) {
        altLine = L.polyline(toLL(alt), { color: '#64748b', weight: 5, opacity: 0.7, dashArray: '8 10' }).addTo(map);
        pts = pts.concat(toLL(alt));
      }
      if (pri && pri.length > 1) {
        var ll = toLL(pri);
        // 테두리 (도로 위에서 잘 보이게)
        L.polyline(ll, { color: '#1e3a8a', weight: 11, opacity: 0.35 }).addTo(routeLayer);
        if (traffic && traffic.length) {
          traffic.forEach(function (t) {
            var seg = ll.slice(t.from, t.to + 1);
            if (seg.length > 1) L.polyline(seg, { color: trafficColor(t.state), weight: 7, opacity: 0.95 }).addTo(routeLayer);
          });
        } else {
          L.polyline(ll, { color: '#2563eb', weight: 7, opacity: 0.95 }).addTo(routeLayer);
        }
        pts = pts.concat(ll);
      }
      stopMarkers.forEach(function (m) { map.removeLayer(m); });
      stopMarkers = [];
      (stops || []).forEach(function (s, i) {
        var cls = 'stop-marker' + (s.test ? ' test' : '') + (s.passed ? ' passed' : '');
        stopMarkers.push(L.marker([s.lat, s.lng], { icon: icon(cls, (s.test ? 'T' : '') + (i + 1), 28) }).addTo(map));
        pts.push([s.lat, s.lng]);
      });
      if (academy) { map.removeLayer(academy); academy = null; }
      if (aca) {
        academy = L.marker([aca.lat, aca.lng], { icon: icon('academy-marker', '유치원', 30) }).addTo(map);
        pts.push([aca.lat, aca.lng]);
      }
      if (me) pts.push(me.getLatLng());
      if (pts.length > 0) {
        lastBounds = L.latLngBounds(pts);
        if (fit && !zoomedIn) map.fitBounds(lastBounds, { padding: [40, 40] });
      }
    };

    function setHeading(h) {
      if (h === null || !me) return;
      var el = me.getElement && me.getElement();
      var a = el && el.querySelector('.arrow');
      if (a) a.style.transform = 'rotate(' + h + 'deg)';
    }

    // 이전 위치 → 새 위치로 0.9초 동안 부드럽게 이동
    window.moveMe = function (lat, lng, heading, follow, navigating) {
      var to = { lat: lat, lng: lng };
      if (!me) {
        cur = to;
        me = L.marker([lat, lng], { icon: L.divIcon({ className: '', iconSize: [46, 46], iconAnchor: [23, 23],
          html: '<div class="me">' + ARROW + '</div>' }), zIndexOffset: 1000 }).addTo(map);
      }
      setHeading(heading);
      if (navigating && follow && !zoomedIn) { map.setView([lat, lng], 17); zoomedIn = true; }
      if (anim) cancelAnimationFrame(anim);
      var from = { lat: cur.lat, lng: cur.lng }, start = performance.now(), dur = 900;
      function step(now) {
        var t = Math.min(1, (now - start) / dur);
        cur = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
        me.setLatLng([cur.lat, cur.lng]);
        if (follow) map.panTo([cur.lat, cur.lng], { animate: false });
        if (t < 1) anim = requestAnimationFrame(step);
      }
      anim = requestAnimationFrame(step);
    };

    window.centerOn = function (lat, lng, zoom) { map.setView([lat, lng], zoom); };
    window.fitAll = function () { zoomedIn = false; if (lastBounds) map.fitBounds(lastBounds, { padding: [40, 40] }); };
    window.resetZoom = function () { zoomedIn = false; };

    window.markStop = function (i) {
      var m = stopMarkers[i];
      var el = m && m.getElement && m.getElement();
      var div = el && el.querySelector('.stop-marker');
      if (div && div.className.indexOf('passed') < 0) div.className += ' passed';
    };

    TakemeNav.postMessage('ready');
  </script>
</body>
</html>
''';
