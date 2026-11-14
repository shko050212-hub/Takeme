import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../models/route_model.dart';

class KakaoMapView extends StatefulWidget {
  final List<RouteStop> stops;
  final List<Map<String, dynamic>> routePoints;
  final List<dynamic>? actualRoadPath;
  final int progressIndex;
  final double? busLat;
  final double? busLng;
  final double? academyLat;
  final double? academyLng;
  final String? academyName;
  final String? myChildName;
  final String? myChildAddress;
  final bool isFullScreen;
  final VoidCallback? onToggleFullscreen;
  final void Function(int index, String name)? onStopTap;

  const KakaoMapView({
    super.key,
    required this.stops,
    required this.routePoints,
    this.actualRoadPath,
    this.progressIndex = 0,
    this.busLat,
    this.busLng,
    this.academyLat,
    this.academyLng,
    this.academyName,
    this.myChildName,
    this.myChildAddress,
    this.isFullScreen = false,
    this.onToggleFullscreen,
    this.onStopTap,
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
        ..addJavaScriptChannel(
          'StopClickHandler',
          onMessageReceived: (JavaScriptMessage msg) {
            try {
              final data = jsonDecode(msg.message);
              final idx = data['index'] as int?;
              final name = data['name'] as String? ?? '';
              if (idx != null && widget.onStopTap != null) {
                widget.onStopTap!(idx, name);
              }
            } catch (_) {}
          },
        )
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
      if (oldWidget.stops.length != widget.stops.length ||
          oldWidget.academyLat != widget.academyLat ||
          oldWidget.academyLng != widget.academyLng) {
        _updateMapData();
      }
      if (oldWidget.actualRoadPath != widget.actualRoadPath ||
          oldWidget.progressIndex != widget.progressIndex) {
        _updateRoutePath();
      }
    }
  }

  void _updateBusLocation() {
    if (widget.busLat != null && widget.busLng != null) {
      final js = 'if (window.updateBus) { window.updateBus(${widget.busLat}, ${widget.busLng}); }';
      _controller?.runJavaScript(js);
    }
  }

  void _updateRoutePath() {
    final roadPath = widget.actualRoadPath;
    if (roadPath != null && roadPath.isNotEmpty) {
      final roadJson = jsonEncode(roadPath.map((p) => [
        p['lat'] ?? p['latitude'],
        p['lng'] ?? p['longitude'],
      ]).where((p) => p[0] != null && p[1] != null).toList());
      final js = 'if (window.updateRoutePath) { window.updateRoutePath($roadJson, ${widget.progressIndex}); }';
      _controller?.runJavaScript(js);
    }
  }

  void _updateMapData() {
    final stopsJson = jsonEncode(widget.stops.map((s) => {
      'name': s.name,
      'isMyChild': s.isMyChild,
      'lat': s.latitude,
      'lng': s.longitude,
      'address': s.address ?? '',
    }).toList());

    final pointsJson = jsonEncode(widget.routePoints.map((p) => [
      p['latitude'] ?? p['lat'],
      p['longitude'] ?? p['lng'],
    ]).where((p) => p[0] != null && p[1] != null).toList());

    final roadPathJson = jsonEncode((widget.actualRoadPath ?? []).map((p) => [
      p['lat'] ?? p['latitude'],
      p['lng'] ?? p['longitude'],
    ]).where((p) => p[0] != null && p[1] != null).toList());

    final js = '''
      if (window.initData) {
        window.initData(
          $stopsJson, 
          $pointsJson, 
          ${widget.academyLat ?? 'null'}, 
          ${widget.academyLng ?? 'null'}, 
          "${widget.academyName ?? ''}", 
          ${widget.busLat ?? 'null'}, 
          ${widget.busLng ?? 'null'},
          $roadPathJson,
          ${widget.progressIndex}
        );
      }
    ''';
    _controller?.runJavaScript(js);
  }

  void _zoomIn() {
    _controller?.runJavaScript('if (window.zoomIn) { window.zoomIn(); }');
  }

  void _zoomOut() {
    _controller?.runJavaScript('if (window.zoomOut) { window.zoomOut(); }');
  }

  void _fitAll() {
    _controller?.runJavaScript('if (window.fitAll) { window.fitAll(); }');
  }

  void _focusMyChild() {
    _controller?.runJavaScript('if (window.focusMyChild) { window.focusMyChild(); }');
  }

  void _openFullscreen() {
    if (widget.onToggleFullscreen != null) {
      widget.onToggleFullscreen!();
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => KakaoMapFullscreenPage(
          stops: widget.stops,
          routePoints: widget.routePoints,
          actualRoadPath: widget.actualRoadPath,
          progressIndex: widget.progressIndex,
          busLat: widget.busLat,
          busLng: widget.busLng,
          academyLat: widget.academyLat,
          academyLng: widget.academyLng,
          academyName: widget.academyName,
          myChildName: widget.myChildName,
          myChildAddress: widget.myChildAddress,
        ),
      ),
    );
  }

  String _generateHtml() {
    final centerLat = widget.academyLat ?? widget.busLat ?? (widget.stops.isNotEmpty ? widget.stops.first.latitude : 37.5580);
    final centerLng = widget.academyLng ?? widget.busLng ?? (widget.stops.isNotEmpty ? widget.stops.first.longitude : 126.8240);

    return '''
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes">
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <style>
        html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; background: #f8fafc; }
        
        .bus-marker {
          background-color: #ef4444;
          color: white;
          border-radius: 50%;
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 11px;
          border: 3px solid white;
          box-shadow: 0 4px 10px rgba(239,68,68,0.5);
        }
        
        .stop-marker {
          background-color: #2563eb;
          color: white;
          border-radius: 50%;
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 11px;
          border: 2px solid white;
          box-shadow: 0 2px 5px rgba(0,0,0,0.25);
        }
        
        .my-child-marker {
          background: linear-gradient(135deg, #7c3aed, #4f46e5);
          color: #fef08a;
          border-radius: 50%;
          width: 38px;
          height: 38px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 900;
          font-size: 16px;
          border: 3px solid #fef08a;
          box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.4), 0 4px 10px rgba(0,0,0,0.3);
          position: relative;
        }
        
        .my-child-badge {
          position: absolute;
          top: -18px;
          left: 50%;
          transform: translateX(-50%);
          background: #7c3aed;
          color: white;
          font-size: 10px;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 8px;
          white-space: nowrap;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          border: 1px solid #fef08a;
        }
        
        .academy-marker {
          background-color: #f59e0b;
          color: white;
          border-radius: 8px;
          padding: 4px 10px;
          font-weight: 800;
          font-size: 12px;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.25);
          white-space: nowrap;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        var map = L.map('map', {
          zoomControl: false,
          attributionControl: false,
          tap: true,
          touchZoom: true,
          scrollWheelZoom: true,
          doubleClickZoom: true
        }).setView([$centerLat, $centerLng], 14);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map);

        var busMarker = null;
        var polyline = null;
        var myChildLatLng = null;
        var allBounds = null;

        window.zoomIn = function() { map.zoomIn(); };
        window.zoomOut = function() { map.zoomOut(); };
        window.fitAll = function() {
          if (allBounds && allBounds.isValid()) {
            map.fitBounds(allBounds, { padding: [40, 40] });
          }
        };
        window.focusMyChild = function() {
          if (myChildLatLng) {
            map.setView(myChildLatLng, 16);
          }
        };
        window.focusBus = function() {
          if (busMarker) {
            map.setView(busMarker.getLatLng(), 16);
          }
        };

        window.updateBus = function(lat, lng) {
          if (!lat || !lng) return;
          if (busMarker) {
            busMarker.setLatLng([lat, lng]);
          } else {
            var icon = L.divIcon({
              className: '',
              html: '<div class="bus-marker">BUS</div>',
              iconSize: [36, 36],
              iconAnchor: [18, 18]
            });
            busMarker = L.marker([lat, lng], { icon: icon }).bindPopup('<b>🚌 통학버스 현재 위치</b>').addTo(map);
          }
        };

        window.updateRoutePath = function(roadPath, progIdx) {
          if (polyline) {
            map.removeLayer(polyline);
            polyline = null;
          }
          if (roadPath && roadPath.length) {
            var active = roadPath.slice(progIdx || 0);
            if (active.length) {
              polyline = L.polyline(active, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map);
            }
          }
        };

        window.initData = function(stops, points, acLat, acLng, acName, bLat, bLng, roadPath, progIdx) {
          var pts = [];
          if (acLat && acLng) {
            var acIcon = L.divIcon({
              className: '',
              html: '<div class="academy-marker">🏫 ' + (acName || '유치원') + '</div>',
              iconSize: [110, 26],
              iconAnchor: [55, 13]
            });
            L.marker([acLat, acLng], { icon: acIcon }).bindPopup('<b>🏫 ' + (acName || '유치원') + '</b>').addTo(map);
            pts.push([acLat, acLng]);
          }

          if (stops && stops.length) {
            stops.forEach(function(s, idx) {
              if (s.lat && s.lng) {
                pts.push([s.lat, s.lng]);
                if (s.isMyChild) {
                  myChildLatLng = [s.lat, s.lng];
                  var myIcon = L.divIcon({
                    className: '',
                    html: '<div class="my-child-marker"><span class="my-child-badge">우리 아이</span>★</div>',
                    iconSize: [38, 38],
                    iconAnchor: [19, 19]
                  });
                  var marker = L.marker([s.lat, s.lng], { icon: myIcon, zIndexOffset: 1000 })
                    .bindPopup('<b>⭐ 우리 아이 탑승지</b><br/>' + (s.address || s.name))
                    .addTo(map);
                  marker.on('click', function() {
                    if (window.StopClickHandler) {
                      window.StopClickHandler.postMessage(JSON.stringify({ index: idx, name: s.name }));
                    }
                  });
                  marker.openPopup();
                } else {
                  var icon = L.divIcon({
                    className: '',
                    html: '<div class="stop-marker">' + (idx + 1) + '</div>',
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                  });
                  var m = L.marker([s.lat, s.lng], { icon: icon })
                    .bindPopup('<b>' + (idx + 1) + '번 경유지</b><br/>' + (s.address || s.name))
                    .addTo(map);
                  m.on('click', function() {
                    if (window.StopClickHandler) {
                      window.StopClickHandler.postMessage(JSON.stringify({ index: idx, name: s.name }));
                    }
                  });
                }
              }
            });
          }

          var activeRoute = (roadPath && roadPath.length) ? roadPath.slice(progIdx || 0) : (points || []);
          if (activeRoute && activeRoute.length) {
            if (polyline) map.removeLayer(polyline);
            polyline = L.polyline(activeRoute, { color: '#2563eb', weight: 5, opacity: 0.85 }).addTo(map);
            activeRoute.forEach(function(p) { pts.push(p); });
          }

          if (bLat && bLng) {
            window.updateBus(bLat, bLng);
            pts.push([bLat, bLng]);
          }

          if (pts.length > 0) {
            allBounds = L.latLngBounds(pts);
            map.fitBounds(allBounds, { padding: [40, 40] });
          }
        };
      </script>
    </body>
    </html>
    ''';
  }

  @override
  Widget build(BuildContext context) {
    final viewPadding = MediaQuery.viewPaddingOf(context);

    return Stack(
      children: [
        // Map Container
        ClipRRect(
          borderRadius: BorderRadius.circular(widget.isFullScreen ? 0 : 20),
          child: (kIsWeb || _controller == null)
              ? _buildWebPlaceholder()
              : WebViewWidget(controller: _controller!),
        ),

        // Controls Overlay
        Positioned(
          top: 12 + (widget.isFullScreen ? viewPadding.top : 0),
          right: 12 + (widget.isFullScreen ? viewPadding.right : 0),
          child: Column(
            children: [
              // Fullscreen Toggle
              _buildControlBtn(
                icon: widget.isFullScreen ? Icons.fullscreen_exit : Icons.fullscreen,
                tooltip: widget.isFullScreen ? '화면 축소' : '전체화면으로 보기',
                color: const Color(0xFF2563EB),
                iconColor: Colors.white,
                onTap: widget.isFullScreen
                    ? () => Navigator.pop(context)
                    : _openFullscreen,
              ),
              const SizedBox(height: 8),

              // Zoom In
              _buildControlBtn(
                icon: Icons.add,
                tooltip: '지도 확대',
                onTap: _zoomIn,
              ),
              const SizedBox(height: 4),

              // Zoom Out
              _buildControlBtn(
                icon: Icons.remove,
                tooltip: '지도 축소',
                onTap: _zoomOut,
              ),
              const SizedBox(height: 8),

              // Focus My Child
              _buildControlBtn(
                icon: Icons.star_rounded,
                tooltip: '우리 아이 탑승지로 이동',
                iconColor: const Color(0xFF7C3AED),
                onTap: _focusMyChild,
              ),
              const SizedBox(height: 4),

              // Fit All
              _buildControlBtn(
                icon: Icons.crop_free,
                tooltip: '전체 노선 한눈에 보기',
                onTap: _fitAll,
              ),
            ],
          ),
        ),

        // Academy Label Badge
        if (widget.academyName != null && !widget.isFullScreen)
          Positioned(
            top: 12,
            left: 12,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.92),
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 4, offset: const Offset(0, 1))
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.school, size: 14, color: Color(0xFF2563EB)),
                  const SizedBox(width: 4),
                  Text(
                    widget.academyName!,
                    style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Color(0xFF1E293B)),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildControlBtn({
    required IconData icon,
    required String tooltip,
    required VoidCallback onTap,
    Color color = Colors.white,
    Color iconColor = const Color(0xFF1E293B),
  }) {
    return Material(
      color: color,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(color: Colors.black.withValues(alpha: 0.08)),
      ),
      elevation: 2,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Tooltip(
          message: tooltip,
          child: Container(
            width: 38,
            height: 38,
            alignment: Alignment.center,
            child: Icon(icon, size: 20, color: iconColor),
          ),
        ),
      ),
    );
  }

  Widget _buildWebPlaceholder() {
    return Container(
      color: const Color(0xFFF1F5F9),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.map, size: 48, color: Color(0xFF2563EB)),
            const SizedBox(height: 8),
            Text(
              widget.academyName ?? '실시간 셔틀 노선 지도',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15, color: Color(0xFF1E293B)),
            ),
            const SizedBox(height: 4),
            Text(
              '배정 경유지 ${widget.stops.length}개소 · 실시간 버스 위치 수신 중',
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 12),
            ElevatedButton.icon(
              onPressed: _openFullscreen,
              icon: const Icon(Icons.fullscreen, size: 16),
              label: const Text('전체화면으로 크게 보기'),
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF2563EB),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class KakaoMapFullscreenPage extends StatefulWidget {
  final List<RouteStop> stops;
  final List<Map<String, dynamic>> routePoints;
  final List<dynamic>? actualRoadPath;
  final int progressIndex;
  final double? busLat;
  final double? busLng;
  final double? academyLat;
  final double? academyLng;
  final String? academyName;
  final String? myChildName;
  final String? myChildAddress;

  const KakaoMapFullscreenPage({
    super.key,
    required this.stops,
    required this.routePoints,
    this.actualRoadPath,
    this.progressIndex = 0,
    this.busLat,
    this.busLng,
    this.academyLat,
    this.academyLng,
    this.academyName,
    this.myChildName,
    this.myChildAddress,
  });

  @override
  State<KakaoMapFullscreenPage> createState() => _KakaoMapFullscreenPageState();
}

class _KakaoMapFullscreenPageState extends State<KakaoMapFullscreenPage> {
  bool _isCardDismissed = false;

  @override
  void initState() {
    super.initState();
    _checkCardDismissed();
  }

  Future<void> _checkCardDismissed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final dismissedDate = prefs.getString('hide_child_stop_card_date');
      final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
      if (dismissedDate == today && mounted) {
        setState(() {
          _isCardDismissed = true;
        });
      }
    } catch (_) {}
  }

  Future<void> _dismissCardForToday() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final today = DateFormat('yyyy-MM-dd').format(DateTime.now());
      await prefs.setString('hide_child_stop_card_date', today);
    } catch (_) {}
    if (mounted) {
      setState(() {
        _isCardDismissed = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final myStop = widget.stops.cast<RouteStop?>().firstWhere((s) => s?.isMyChild == true, orElse: () => null);
    final viewPadding = MediaQuery.viewPaddingOf(context);

    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.academyName ?? '유치원 통학차량 실시간 지도',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
            ),
            if (widget.myChildName != null)
              Text(
                '${widget.myChildName} 원아 탑승 노선',
                style: const TextStyle(fontSize: 11, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
              ),
          ],
        ),
        backgroundColor: Colors.white,
        elevation: 1,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, size: 20, color: Color(0xFF0F172A)),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.fullscreen_exit, size: 24, color: Color(0xFF2563EB)),
            tooltip: '축소하기',
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
      body: Stack(
        children: [
          // Fullscreen Map View
          Positioned.fill(
            child: KakaoMapView(
              stops: widget.stops,
              routePoints: widget.routePoints,
              actualRoadPath: widget.actualRoadPath,
              progressIndex: widget.progressIndex,
              busLat: widget.busLat,
              busLng: widget.busLng,
              academyLat: widget.academyLat,
              academyLng: widget.academyLng,
              academyName: widget.academyName,
              myChildName: widget.myChildName,
              myChildAddress: widget.myChildAddress,
              isFullScreen: true,
            ),
          ),

          // Bottom Info Card ("우리 아이 탑승 장소" / "탑승지 설정됨")
          if (!_isCardDismissed)
            Positioned(
              left: 16 + viewPadding.left,
              right: 16 + viewPadding.right,
              bottom: 24 + viewPadding.bottom,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(16),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.12),
                      blurRadius: 16,
                      offset: const Offset(0, 4),
                    ),
                  ],
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: const Color(0xFFF5F3FF),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: const Color(0xFFDDD6FE)),
                      ),
                      child: const Icon(Icons.stars_rounded, color: Color(0xFF7C3AED), size: 26),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Row(
                            children: [
                              const Text(
                                '우리 아이 탑승 장소',
                                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: Color(0xFF7C3AED)),
                              ),
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFEFF6FF),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '총 ${widget.stops.length}개 정류장',
                                  style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 2),
                          Text(
                            myStop?.address ?? widget.myChildAddress ?? (myStop?.name ?? '탑승지 설정됨'),
                            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Close button (X) to dismiss for today
                    InkWell(
                      onTap: _dismissCardForToday,
                      borderRadius: BorderRadius.circular(20),
                      child: Container(
                        padding: const EdgeInsets.all(6),
                        decoration: const BoxDecoration(
                          color: Color(0xFFF1F5F9),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.close,
                          size: 16,
                          color: Color(0xFF64748B),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
