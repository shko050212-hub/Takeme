import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../driver/geo.dart';
import 'naver_map_controller.dart';

class NaverMapControllerMobile implements NaverMapController {
  late final WebViewController web;
  final String initialClientId;
  bool _ready = false;
  final List<String> _pending = [];

  @override
  void Function(GeoPoint point)? onMapClick;

  NaverMapControllerMobile({this.initialClientId = ''}) {
    web = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF8FAFC))
      ..addJavaScriptChannel('TakemeNav', onMessageReceived: _onMessage);

    _loadContent();
  }

  @override
  bool get isReady => _ready;

  Future<void> _loadContent() async {
    try {
      final html = await rootBundle.loadString('assets/naver_map.html');
      await web.loadHtmlString(html);
    } catch (_) {
      // Fallback if asset load fails
      await web.loadHtmlString('<html><body><div id="map"></div></body></html>');
    }
  }

  void _onMessage(JavaScriptMessage m) {
    if (m.message.contains('ready')) {
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

  @override
  void setRoutes({
    List<GeoPoint>? primary,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    String? destinationName,
    bool fit = true,
  }) {
    _run('window.setRoutes(${_pts(primary)}, ${_pts(alternate)}, ${jsonEncode(stops)}, '
        '${jsonEncode(academy?.toJson())}, $fit, ${jsonEncode(destinationName)});');
  }

  @override
  void clearRoutes() => _run('window.clearRoutes();');

  @override
  void setMyLocation(GeoPoint p) => _run('window.setMyLocation(${p.lat}, ${p.lng});');

  @override
  void moveBus(GeoPoint p, {bool follow = true}) => _run('window.moveBus(${p.lat}, ${p.lng}, $follow);');

  @override
  void hideBus() => _run('window.hideBus();');

  @override
  void centerOn(GeoPoint p, {int zoom = 17}) => _run('window.centerOn(${p.lat}, ${p.lng}, $zoom);');

  @override
  void markStopPassed(int index) => _run('window.markStopPassed($index);');

  @override
  void fitAll() => _run('window.fitAll();');

  @override
  void setClientId(String clientId) => _run('window.setClientId("$clientId");');

  @override
  void setInteractive(bool interactive) {}

  @override
  void setVisible(bool visible) {}

  @override
  void dispose() {
    _pending.clear();
  }
}

class NaverMapViewPlatform extends StatelessWidget {
  final NaverMapController controller;

  const NaverMapViewPlatform({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    if (controller is NaverMapControllerMobile) {
      final mobileCtrl = controller as NaverMapControllerMobile;
      return WebViewWidget(controller: mobileCtrl.web);
    }
    return const Center(child: Text('네이버 지도 로딩 중...'));
  }
}

NaverMapController createNaverMapController({String clientId = ''}) {
  return NaverMapControllerMobile(initialClientId: clientId);
}
