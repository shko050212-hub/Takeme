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

/// 기사 내비게이션 지도 (Leaflet + OpenStreetMap)
/// - 주행 중 기본(follow=true): 진행 방향(heading)이 항상 화면 위쪽(12시 방향)을 향하도록 회전 (Heading-Up)
/// - 지도를 움직여 다른 도로를 확인할 때: 두 손가락으로 자유롭게 지도 방향 회전 + 흰 화면 깜빡임 없는 부드러운 확대/축소
/// - 내 위치: 티맵처럼 흰 원 안의 파란 화살표
class NavMapController {
  NavMapController() {
    web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF8FAFC))
      ..addJavaScriptChannel('TakemeNav', onMessageReceived: _onMessage)
      ..loadHtmlString(_html);
  }

  late final WebViewController web;
  VoidCallback? onUserDrag;
  bool _ready = false;
  final List<String> _pending = [];

  void _onMessage(JavaScriptMessage m) {
    if (m.message == 'ready') {
      _ready = true;
      for (final js in _pending) {
        web.runJavaScript(js);
      }
      _pending.clear();
    } else if (m.message == 'drag') {
      onUserDrag?.call();
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

  /// 내 위치 화살표 이동 (heading: 진행 방향, follow: 지도가 따라감, navigating: 주행 중 여부)
  void moveMe(GeoPoint p, {double? heading, bool follow = false, bool navigating = false}) =>
      _run('window.moveMe(${p.lat}, ${p.lng}, ${heading ?? 'null'}, $follow, $navigating);');

  void centerOn(GeoPoint p, {int zoom = 16}) => _run('window.centerOn(${p.lat}, ${p.lng}, $zoom);');

  void markStopPassed(int index) => _run('window.markStop($index);');

  void fitAll() => _run('window.fitAll();');

  void setHeadingUp(bool enabled) => _run('window.setHeadingUp($enabled);');

  /// 운행 종료 시 확대/회전 상태 초기화
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
    html, body {
      margin: 0; padding: 0; width: 100%; height: 100%;
      overflow: hidden; background: #f8fafc;
      touch-action: none; user-select: none; -webkit-user-select: none;
    }
    #map-wrap {
      position: relative; width: 100%; height: 100%;
      overflow: hidden; background: #f8fafc;
    }
    /* 회전 시 모서리가 잘리지 않도록 150% 크기로 배치 (확대 왜곡 없이 360도 회전) */
    #map {
      position: absolute;
      width: 150%; height: 150%;
      left: -25%; top: -25%;
      background: #f8fafc;
      transform-origin: 50% 50%;
      will-change: transform;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
    }
    .leaflet-tile-container {
      will-change: transform;
      backface-visibility: hidden;
    }
    .stop-marker {
      width: 28px; height: 28px; border-radius: 50%;
      background: #2563eb; color: #fff; font: bold 13px sans-serif;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      transform: var(--map-unrotate, rotate(0deg));
    }
    .stop-marker.passed { background: #94a3b8; }
    .stop-marker.test { background: #ea580c; border-style: dashed; }
    .academy-marker {
      height: 30px; padding: 0 8px; border-radius: 8px; background: #10b981; color: #fff;
      font: bold 12px sans-serif; display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(16,185,129,0.5); white-space: nowrap;
      transform: var(--map-unrotate, rotate(0deg));
    }
    /* 티맵 스타일: 흰 원 + 진행 방향 파란 화살표 */
    .me {
      width: 48px; height: 48px; border-radius: 50%; background: #fff;
      box-shadow: 0 3px 10px rgba(0,0,0,0.32);
      display: flex; align-items: center; justify-content: center;
    }
    .me .arrow { width: 28px; height: 28px; transition: transform 0.25s linear; }
  </style>
</head>
<body>
  <div id="map-wrap">
    <div id="map"></div>
  </div>
  <script>
    var mapEl = document.getElementById('map');
    var wrapEl = document.getElementById('map-wrap');

    var map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      touchZoom: false,
      bounceAtZoomLimits: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      fadeAnimation: false
    }).setView([37.5665, 126.9780], 15);

    var tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      minZoom: 7,
      keepBuffer: 8,
      updateWhenZooming: false,
      updateWhenIdle: true
    }).addTo(map);

    // 확대/축소 시 새 타일이 로드되기 전에 이전 타일이 먼저 지워져 0.1초 흰 화면이 뜨는 현상 방지
    (function () {
      var origPrune = tileLayer._pruneTiles;
      var pruneTimer = null;
      tileLayer._pruneTiles = function () {
        var self = this;
        if (pruneTimer) clearTimeout(pruneTimer);
        pruneTimer = setTimeout(function () { origPrune.call(self); }, 380);
      };
      tileLayer.on('load', function () {
        if (pruneTimer) { clearTimeout(pruneTimer); pruneTimer = null; }
        origPrune.call(tileLayer);
      });
    })();

    // 회전 및 확대 상태 변수
    var headingUp = true;       // 주행 중 진행 방향 = 12시 방향 기본 활성화
    var isNavFollowing = false; // 현재 내 위치를 따라가며 12시 방향 정렬 중인지 여부
    var lastHeading = 0;        // 차량 진행 방향 (도, 북=0, 동=90)
    var mapBearing = 0;         // 현재 지도의 CSS 회전 각도 (도)
    var manualBearing = null;   // 사용자가 두 손가락으로 직접 돌려놓은 각도
    var liveScale = 1;          // 두 손가락 핀치 줌 중 실시간 GPU 배율

    // 최단 각도 보간 (-180 ~ +180)
    function shortestAngle(from, to) {
      var diff = ((to - from + 540) % 360) - 180;
      return from + diff;
    }

    function applyTransform(smooth) {
      var target;
      if (manualBearing !== null) {
        target = manualBearing;
      } else if (isNavFollowing && headingUp) {
        // 차량 진행 방향(lastHeading)이 화면 위쪽(12시, 0도)을 향하도록 지도를 -lastHeading 만큼 회전
        target = -lastHeading;
      } else if (!isNavFollowing) {
        target = mapBearing;
      } else {
        target = 0;
      }
      mapBearing = shortestAngle(mapBearing, target);
      mapEl.style.transition = smooth ? 'transform 0.28s ease-out' : 'none';
      mapEl.style.transform = 'rotate(' + mapBearing.toFixed(2) + 'deg) scale(' + liveScale.toFixed(4) + ')';
      mapEl.style.setProperty('--map-unrotate', 'rotate(' + (-mapBearing).toFixed(2) + 'deg)');
    }

    // 지도가 회전된 상태에서도 한 손가락 드래그 방향과 화면 이동 방향이 정확히 일치하도록 보정
    (function () {
      var draggable = map.dragging && map.dragging._draggable;
      if (!draggable) return;
      var origUpdate = draggable._updatePosition;
      draggable._updatePosition = function () {
        if (this._startPos && this._newPos && !this._newPos._rotAdjusted &&
            (Math.abs(mapBearing) > 0.01 || Math.abs(liveScale - 1) > 0.001)) {
          var ox = this._newPos.x - this._startPos.x;
          var oy = this._newPos.y - this._startPos.y;
          var rad = -mapBearing * Math.PI / 180;
          var cos = Math.cos(rad), sin = Math.sin(rad);
          var s = liveScale || 1;
          var rx = (ox * cos - oy * sin) / s;
          var ry = (ox * sin + oy * cos) / s;
          this._newPos = new L.Point(this._startPos.x + rx, this._startPos.y + ry);
          this._newPos._rotAdjusted = true;
        }
        return origUpdate.call(this);
      };
    })();

    map.on('dragstart', function () {
      // 사용자가 다른 도로를 확인하려고 화면을 움직이면 자동 추적 해제 (현재 회전 각도는 유지)
      isNavFollowing = false;
      TakemeNav.postMessage('drag');
    });

    // 두 손가락 제스처: 자유로운 확대/축소(GPU 스케일) + 두 손가락 지도 방향 전환(회전)
    (function () {
      var gesturing = false;
      var startDist = 0;
      var startAngle = 0;
      var startZoom = 16;
      var startBearing = 0;
      var rotatedByGesture = false;

      function touchDist(t1, t2) {
        return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      }
      function touchAngle(t1, t2) {
        return Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180 / Math.PI;
      }

      wrapEl.addEventListener('touchstart', function (e) {
        if (e.touches.length === 2) {
          gesturing = true;
          rotatedByGesture = false;
          map.dragging.disable();
          startDist = Math.max(20, touchDist(e.touches[0], e.touches[1]));
          startAngle = touchAngle(e.touches[0], e.touches[1]);
          startZoom = map.getZoom();
          startBearing = mapBearing;
          liveScale = 1;
        }
      }, { passive: true });

      wrapEl.addEventListener('touchmove', function (e) {
        if (!gesturing || e.touches.length < 2) return;
        var d = Math.max(20, touchDist(e.touches[0], e.touches[1]));
        var ang = touchAngle(e.touches[0], e.touches[1]);

        // 1) 확대/축소 배율 (GPU transform scale로 즉시 반영 → 흰 화면 깜빡임 0)
        var ratio = d / startDist;
        var minScale = Math.pow(2, 7 - startZoom);
        var maxScale = Math.pow(2, 19 - startZoom);
        liveScale = Math.max(minScale, Math.min(maxScale, ratio));

        // 2) 두 손가락 화면 방향 전환(회전)
        var rawDelta = ((ang - startAngle + 540) % 360) - 180;
        // 다른 도로를 확인 중(!isNavFollowing)이거나 두 손가락을 3도 이상 비틀면 즉시 회전
        if (!isNavFollowing || Math.abs(rawDelta) > 3.0 || rotatedByGesture) {
          if (isNavFollowing && Math.abs(rawDelta) > 3.0) {
            isNavFollowing = false;
            TakemeNav.postMessage('drag');
          }
          rotatedByGesture = true;
          manualBearing = startBearing + rawDelta;
        }

        applyTransform(false);
      }, { passive: true });

      function finishGesture() {
        if (!gesturing) return;
        gesturing = false;
        var scaleChange = liveScale;
        liveScale = 1;
        applyTransform(false);
        if (Math.abs(scaleChange - 1) > 0.02) {
          var targetZoom = Math.max(7, Math.min(19, startZoom + Math.log2(scaleChange)));
          map.setZoom(targetZoom, { animate: false });
        }
        map.dragging.enable();
      }

      wrapEl.addEventListener('touchend', function (e) {
        if (e.touches.length < 2) finishGesture();
      }, { passive: true });
      wrapEl.addEventListener('touchcancel', finishGesture, { passive: true });
    })();

    var routeLayer = L.layerGroup().addTo(map);
    var altLine = null, academy = null, stopMarkers = [];
    var me = null, lastBounds = null, cur = null, anim = null, zoomedIn = false;

    var ARROW = '<svg class="arrow" viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 16.5 L4 21 Z" fill="#3b82f6" stroke="#1d4ed8" stroke-width="1" stroke-linejoin="round"/></svg>';

    function icon(cls, text, size) {
      return L.divIcon({ className: '', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
        html: '<div class="' + cls + '">' + text + '</div>' });
    }
    function toLL(path) { return (path || []).map(function (p) { return [p.lat, p.lng]; }); }
    function trafficColor(state) {
      if (state === 1 || state === 6) return '#ef4444';
      if (state === 2 || state === 3) return '#f59e0b';
      return '#16a34a';
    }

    window.setRoutes = function (pri, traffic, alt, stops, aca, fit) {
      var pts = [];
      routeLayer.clearLayers();
      if (altLine) { map.removeLayer(altLine); altLine = null; }
      if (alt && alt.length > 1) {
        altLine = L.polyline(toLL(alt), { color: '#64748b', weight: 5, opacity: 0.7, dashArray: '8 10' }).addTo(routeLayer);
        pts = pts.concat(toLL(alt));
      }
      if (pri && pri.length > 1) {
        var ll = toLL(pri);
        L.polyline(ll, { color: '#14532d', weight: 12, opacity: 0.4 }).addTo(routeLayer);
        if (traffic && traffic.length) {
          traffic.forEach(function (t) {
            var seg = ll.slice(t.from, t.to + 1);
            if (seg.length > 1) L.polyline(seg, { color: trafficColor(t.state), weight: 8, opacity: 0.95 }).addTo(routeLayer);
          });
        } else {
          L.polyline(ll, { color: '#16a34a', weight: 8, opacity: 0.95 }).addTo(routeLayer);
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
        if (fit && !zoomedIn) {
          isNavFollowing = false;
          manualBearing = 0;
          applyTransform(true);
          map.invalidateSize();
          map.fitBounds(lastBounds, { padding: [50, 50], maxZoom: 16 });
          setTimeout(function () {
            map.invalidateSize();
            if (!zoomedIn && !isNavFollowing && lastBounds) {
              map.fitBounds(lastBounds, { padding: [50, 50], maxZoom: 16 });
            }
          }, 150);
        }
      }
    };

    function setHeading(h) {
      if (h !== null && h !== undefined && !isNaN(h)) {
        lastHeading = h;
      }
      if (!me) return;
      var el = me.getElement && me.getElement();
      var a = el && el.querySelector('.arrow');
      if (a) a.style.transform = 'rotate(' + lastHeading + 'deg)';
    }

    // 이전 위치 → 새 위치로 부드럽게 이동 + 주행 중 진행 방향이 항상 12시(위쪽)를 향하도록 회전
    window.moveMe = function (lat, lng, heading, follow, navigating) {
      var to = { lat: lat, lng: lng };
      if (!me) {
        cur = to;
        me = L.marker([lat, lng], { icon: L.divIcon({ className: '', iconSize: [48, 48], iconAnchor: [24, 24],
          html: '<div class="me">' + ARROW + '</div>' }), zIndexOffset: 1000 }).addTo(map);
      }
      setHeading(heading);

      if (navigating && follow) {
        isNavFollowing = true;
        manualBearing = null;
        if (!zoomedIn) {
          map.setView([lat, lng], 16, { animate: false });
          zoomedIn = true;
        }
        applyTransform(true);
      } else if (!navigating) {
        isNavFollowing = false;
        manualBearing = 0;
        applyTransform(true);
      }

      if (anim) cancelAnimationFrame(anim);
      var from = { lat: cur.lat, lng: cur.lng }, start = performance.now(), dur = 850;
      function step(now) {
        var t = Math.min(1, (now - start) / dur);
        cur = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
        me.setLatLng([cur.lat, cur.lng]);
        if (follow && isNavFollowing) {
          map.panTo([cur.lat, cur.lng], { animate: false });
        }
        if (t < 1) anim = requestAnimationFrame(step);
      }
      anim = requestAnimationFrame(step);
    };

    window.setHeadingUp = function (enabled) {
      headingUp = !!enabled;
      if (headingUp) manualBearing = null;
      applyTransform(true);
    };

    window.centerOn = function (lat, lng, zoom) {
      map.invalidateSize();
      map.setView([lat, lng], zoom, { animate: false });
    };

    window.fitAll = function () {
      zoomedIn = false;
      isNavFollowing = false;
      manualBearing = 0;
      applyTransform(true);
      map.invalidateSize();
      if (lastBounds) map.fitBounds(lastBounds, { padding: [50, 50], maxZoom: 16 });
    };

    window.resetZoom = function () {
      zoomedIn = false;
      isNavFollowing = false;
      manualBearing = 0;
      liveScale = 1;
      applyTransform(true);
    };

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
