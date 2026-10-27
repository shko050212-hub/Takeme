import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../config.dart';
import '../driver/geo.dart';

/// 카카오맵(웹뷰)을 앱에서 조작하기 위한 컨트롤러
/// 기존 앱(shuttle-app/KakaoMap.tsx)과 같은 방식: 웹뷰 안에 카카오맵 JS를 띄움
class KakaoMapController {
  KakaoMapController() {
    web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF8FAFC))
      ..addJavaScriptChannel('TakemeMap', onMessageReceived: _onMessage)
      // 카카오 개발자 콘솔에 등록된 도메인(http://localhost)과 같아야 지도가 뜸
      ..loadHtmlString(_buildHtml(AppConfig.kakaoJsKey), baseUrl: 'http://localhost');
  }

  late final WebViewController web;
  final ValueNotifier<String?> error = ValueNotifier(null);
  bool _ready = false;
  final List<String> _pending = [];

  void _onMessage(JavaScriptMessage m) {
    final data = jsonDecode(m.message) as Map<String, dynamic>;
    if (data['type'] == 'ready') {
      _ready = true;
      for (final js in _pending) {
        web.runJavaScript(js);
      }
      _pending.clear();
    } else if (data['type'] == 'error') {
      error.value = '${data['data']}';
    }
  }

  void _run(String js) {
    if (_ready) {
      web.runJavaScript(js);
    } else {
      _pending.add(js);
    }
  }

  /// 도로 경로선, 정류장 번호 마커, 유치원 마커 그리기
  void setRoute({
    required List<GeoPoint> path,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
  }) {
    final p = jsonEncode(path.map((e) => e.toJson()).toList());
    final s = jsonEncode(stops);
    final a = jsonEncode(academy?.toJson());
    _run('window.setRoute($p, $s, $a); true;');
  }

  /// 버스 위치 이동 (지도 안에서 부드럽게 미끄러지듯 이동)
  void moveBus(GeoPoint p, {bool follow = true}) =>
      _run('window.moveBus(${p.lat}, ${p.lng}, $follow); true;');

  void markStopPassed(int index) => _run('window.markStop($index); true;');

  void fitAll() => _run('window.fitAll(); true;');
}

class KakaoMapView extends StatelessWidget {
  final KakaoMapController controller;
  const KakaoMapView({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        WebViewWidget(controller: controller.web),
        ValueListenableBuilder<String?>(
          valueListenable: controller.error,
          builder: (context, err, _) => err == null
              ? const SizedBox.shrink()
              : Positioned(
                  left: 12,
                  right: 12,
                  top: 12,
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: const Color(0xFFFEF2F2),
                      border: Border.all(color: const Color(0xFFF87171)),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text('카카오맵 안내: $err',
                        style: const TextStyle(color: Color(0xFF991B1B), fontSize: 12)),
                  ),
                ),
        ),
      ],
    );
  }
}

String _buildHtml(String appKey) => '''
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { box-sizing: border-box; }
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #f8fafc; }
    .stop-marker {
      width: 28px; height: 28px; border-radius: 50%;
      background: #2563eb; color: #ffffff;
      display: flex; align-items: center; justify-content: center;
      font-weight: bold; font-size: 13px; font-family: sans-serif;
      border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .stop-marker.passed { background: #94a3b8; }
    .bus-marker {
      width: 36px; height: 36px; border-radius: 18px; background: #ffffff;
      border: 2px solid #ef4444; display: flex; align-items: center; justify-content: center;
      font-size: 20px; box-shadow: 0 4px 10px rgba(239,68,68,0.4);
    }
    .academy-marker {
      width: 34px; height: 34px; border-radius: 17px; background: #ffffff;
      border: 2px solid #10b981; display: flex; align-items: center; justify-content: center;
      font-size: 18px; box-shadow: 0 3px 8px rgba(16,185,129,0.4);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    function post(type, data) {
      if (window.TakemeMap && window.TakemeMap.postMessage) {
        window.TakemeMap.postMessage(JSON.stringify({ type: type, data: data }));
      }
    }
    window.onerror = function (msg) { post('error', String(msg)); };
  </script>
  <script src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=$appKey&autoload=false"
    onerror="post('error', '카카오맵 SDK 로드 실패: 카카오 개발자 콘솔에 http://localhost 도메인과 JavaScript 키를 확인하세요.')"></script>
  <script>
    var map = null, line = null, bus = null, academyOv = null, stopOvs = [];
    var lastBounds = null, cur = null, anim = null, zoomedIn = false;

    if (typeof kakao === 'undefined') {
      post('error', '카카오맵 SDK를 불러오지 못했습니다.');
    } else {
      kakao.maps.load(function () {
        map = new kakao.maps.Map(document.getElementById('map'), {
          center: new kakao.maps.LatLng(37.5665, 126.9780), level: 5
        });
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        post('ready', 'ok');
      });
    }

    function ll(p) { return new kakao.maps.LatLng(p.lat, p.lng); }

    window.setRoute = function (path, stops, academy) {
      if (!map) return;
      var bounds = new kakao.maps.LatLngBounds(), has = false;

      if (line) line.setMap(null);
      line = null;
      if (path && path.length > 1) {
        var pts = path.map(function (p) { var x = ll(p); bounds.extend(x); has = true; return x; });
        line = new kakao.maps.Polyline({
          map: map, path: pts, strokeWeight: 7, strokeColor: '#2563eb', strokeOpacity: 0.85, strokeStyle: 'solid'
        });
      }

      stopOvs.forEach(function (o) { o.setMap(null); });
      stopOvs = [];
      (stops || []).forEach(function (s, i) {
        var x = ll(s); bounds.extend(x); has = true;
        stopOvs.push(new kakao.maps.CustomOverlay({
          map: map, position: x, xAnchor: 0.5, yAnchor: 0.5,
          content: '<div id="stop-' + i + '" class="stop-marker' + (s.passed ? ' passed' : '') + '">' + (i + 1) + '</div>'
        }));
      });

      if (academyOv) academyOv.setMap(null);
      academyOv = null;
      if (academy) {
        var a = ll(academy); bounds.extend(a); has = true;
        academyOv = new kakao.maps.CustomOverlay({
          map: map, position: a, xAnchor: 0.5, yAnchor: 0.5,
          content: '<div class="academy-marker" title="유치원">🏫</div>'
        });
      }

      if (has) { lastBounds = bounds; if (!zoomedIn) map.setBounds(bounds); }
    };

    window.fitAll = function () {
      if (map && lastBounds) { zoomedIn = false; map.setBounds(lastBounds); }
    };

    // 이전 위치 → 새 위치로 0.9초 동안 부드럽게 이동, follow 이면 지도도 따라감
    window.moveBus = function (lat, lng, follow) {
      if (!map) return;
      var to = { lat: lat, lng: lng };
      if (!bus) {
        cur = to;
        bus = new kakao.maps.CustomOverlay({
          map: map, position: ll(to), xAnchor: 0.5, yAnchor: 0.5, zIndex: 10,
          content: '<div class="bus-marker" title="내 버스">🚌</div>'
        });
      }
      if (follow && !zoomedIn) { map.setLevel(3); zoomedIn = true; }
      if (anim) cancelAnimationFrame(anim);
      var from = { lat: cur.lat, lng: cur.lng }, start = performance.now(), dur = 900;
      function step(now) {
        var t = Math.min(1, (now - start) / dur);
        cur = { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
        var pos = ll(cur);
        bus.setPosition(pos);
        if (follow) map.setCenter(pos);
        if (t < 1) anim = requestAnimationFrame(step);
      }
      anim = requestAnimationFrame(step);
    };

    window.markStop = function (i) {
      var el = document.getElementById('stop-' + i);
      if (el) el.className = 'stop-marker passed';
    };
  </script>
</body>
</html>
''';
