// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use
import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';
import '../driver/geo.dart';
import 'naver_map_controller.dart';

class NaverMapControllerWeb implements NaverMapController {
  final String viewId;
  final String initialClientId;
  html.IFrameElement? _iframe;
  bool _ready = false;
  final List<Map<String, dynamic>> _pending = [];
  StreamSubscription<html.MessageEvent>? _sub;

  @override
  void Function(GeoPoint point)? onMapClick;

  NaverMapControllerWeb({required this.viewId, this.initialClientId = ''}) {
    _initIframe();
  }

  @override
  bool get isReady => _ready;

  void _initIframe() {
    final src = initialClientId.isNotEmpty
        ? 'naver_map.html?clientId=${Uri.encodeComponent(initialClientId)}'
        : 'naver_map.html';

    _iframe = html.IFrameElement()
      ..id = 'iframe_$viewId'
      ..src = src
      ..style.border = 'none'
      ..style.width = '100%'
      ..style.height = '100%';

    ui_web.platformViewRegistry.registerViewFactory(
      viewId,
      (int id) => _iframe!,
    );

    _sub = html.window.onMessage.listen((event) {
      final data = event.data;
      if (data is Map) {
        if (data['type'] == 'ready') {
          _ready = true;
          _flushPending();
        } else if (data['type'] == 'mapClicked' && data['lat'] != null && data['lng'] != null) {
          final lat = (data['lat'] as num).toDouble();
          final lng = (data['lng'] as num).toDouble();
          onMapClick?.call(GeoPoint(lat, lng));
        }
      } else if (data is String) {
        if (data.contains('"type":"ready"')) {
          _ready = true;
          _flushPending();
        } else if (data.contains('"type":"mapClicked"')) {
          try {
            final parsed = jsonDecode(data);
            if (parsed['lat'] != null && parsed['lng'] != null) {
              final lat = (parsed['lat'] as num).toDouble();
              final lng = (parsed['lng'] as num).toDouble();
              onMapClick?.call(GeoPoint(lat, lng));
            }
          } catch (_) {}
        }
      }
    });

    // 만약 메시지 이벤트가 지연될 경우 대비하여 1초 후 자동 활성화
    Timer(const Duration(milliseconds: 1200), () {
      if (!_ready) {
        _ready = true;
        _flushPending();
      }
    });
  }

  void _send(Map<String, dynamic> msg) {
    if (_ready && _iframe?.contentWindow != null) {
      try {
        _iframe!.contentWindow!.postMessage(jsonEncode(msg), '*');
      } catch (e) {
        debugPrint('[NaverMapViewWeb] postMessage error: $e');
      }
    } else {
      _pending.add(msg);
    }
  }

  void _flushPending() {
    if (_iframe?.contentWindow == null) return;
    for (final msg in _pending) {
      try {
        _iframe!.contentWindow!.postMessage(jsonEncode(msg), '*');
      } catch (e) {
        debugPrint('[NaverMapViewWeb] flush postMessage error: $e');
      }
    }
    _pending.clear();
  }

  @override
  void setRoutes({
    List<GeoPoint>? primary,
    List<GeoPoint>? alternate,
    required List<Map<String, dynamic>> stops,
    GeoPoint? academy,
    String? destinationName,
    bool fit = true,
  }) {
    _send({
      'action': 'setRoutes',
      'primary': primary?.map((e) => e.toJson()).toList(),
      'alternate': alternate?.map((e) => e.toJson()).toList(),
      'stops': stops,
      'academy': academy?.toJson(),
      'destinationName': destinationName,
      'fit': fit,
    });
  }

  @override
  void clearRoutes() {
    _send({'action': 'clearRoutes'});
  }

  @override
  void setMyLocation(GeoPoint p) {
    _send({
      'action': 'setMyLocation',
      'lat': p.lat,
      'lng': p.lng,
    });
  }

  @override
  void moveBus(GeoPoint p, {bool follow = true}) {
    _send({
      'action': 'moveBus',
      'lat': p.lat,
      'lng': p.lng,
      'follow': follow,
    });
  }

  @override
  void hideBus() {
    _send({'action': 'hideBus'});
  }

  @override
  void centerOn(GeoPoint p, {int zoom = 17}) {
    _send({
      'action': 'centerOn',
      'lat': p.lat,
      'lng': p.lng,
      'zoom': zoom,
    });
  }

  @override
  void markStopPassed(int index) {
    _send({
      'action': 'markStopPassed',
      'index': index,
    });
  }

  @override
  void fitAll() {
    _send({'action': 'fitAll'});
  }

  @override
  void setClientId(String clientId) {
    _send({
      'action': 'setClientId',
      'clientId': clientId,
    });
  }

  @override
  void setInteractive(bool interactive) {
    if (_iframe != null) {
      _iframe!.style.pointerEvents = interactive ? 'auto' : 'none';
    }
  }

  @override
  void setVisible(bool visible) {
    if (_iframe != null) {
      _iframe!.style.display = visible ? 'block' : 'none';
      _iframe!.style.pointerEvents = visible ? 'auto' : 'none';
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    _pending.clear();
  }
}

class NaverMapViewPlatform extends StatelessWidget {
  final NaverMapController controller;

  const NaverMapViewPlatform({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    if (controller is NaverMapControllerWeb) {
      final webCtrl = controller as NaverMapControllerWeb;
      return HtmlElementView(viewType: webCtrl.viewId);
    }
    return const Center(child: Text('네이버 지도 로딩 중...'));
  }
}

NaverMapController createNaverMapController({String clientId = ''}) {
  final uniqueId = 'naver_map_${DateTime.now().microsecondsSinceEpoch}';
  return NaverMapControllerWeb(viewId: uniqueId, initialClientId: clientId);
}
