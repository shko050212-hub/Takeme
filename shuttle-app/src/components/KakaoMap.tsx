import React, { forwardRef, useImperativeHandle, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import { WebView } from 'react-native-webview';

const KAKAO_JS_KEY = process.env.EXPO_PUBLIC_KAKAO_JS_KEY || 'cdd5918d0722ccd39b08f2d09b102d31';
const BASE_URL = 'http://localhost';

interface LatLng {
  latitude: number | string;
  longitude: number | string;
}

interface StopItem extends LatLng {
  id?: string | number;
  name?: string;
  address?: string;
}

interface KakaoMapProps {
  appKey?: string;
  center?: { lat: number; lng: number };
  routePoints?: LatLng[];
  stops?: StopItem[];
  announcedStops?: Set<any> | any[];
  busLocation?: LatLng | null;
  academy?: LatLng | null;
  style?: any;
}

export interface KakaoMapRef {
  moveBus: (lat: number, lng: number) => void;
  fitBounds: () => void;
  fitToCoordinates: (points: any[], options?: any) => void;
}

function buildHtml(
  appKey: string,
  initialCenter: { lat: number; lng: number },
  initialRoute: { lat: number; lng: number }[],
  initialStops: { id?: any; name?: string; lat: number; lng: number }[],
  initialAcademy: { lat: number; lng: number } | null,
  initialBus: { lat: number; lng: number } | null
) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="referrer" content="no-referrer">
  <style>
    * { box-sizing: border-box; }
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: #f8fafc; }
    
    .stop-marker {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #2563eb;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      font-size: 13px;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      transform: translate(-50%, -50%);
    }
    .stop-marker.announced {
      background: #94a3b8;
    }
    
    .bus-marker {
      width: 36px;
      height: 36px;
      border-radius: 18px;
      background: #ffffff;
      border: 2px solid #ef4444;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 10px rgba(239,68,68,0.4);
      transform: translate(-50%, -50%);
      transition: transform 0.3s ease;
    }

    .academy-marker {
      width: 34px;
      height: 34px;
      border-radius: 17px;
      background: #ffffff;
      border: 2px solid #10b981;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      box-shadow: 0 3px 8px rgba(16,185,129,0.4);
      transform: translate(-50%, -50%);
    }

    .error-toast {
      position: absolute;
      top: 12px;
      left: 12px;
      right: 12px;
      padding: 12px 14px;
      background: #fef2f2;
      border: 1px solid #f87171;
      color: #991b1b;
      border-radius: 8px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 9999;
      display: none;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div id="error-toast" class="error-toast"></div>
  <div id="map"></div>

  <script>
    function post(type, data) {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, data: data }));
      }
    }
    function showError(msg) {
      var toast = document.getElementById('error-toast');
      if (toast) {
        toast.innerHTML = '<strong>카카오맵 안내:</strong> ' + msg;
        toast.style.display = 'block';
      }
      post('error', msg);
    }
    window.onerror = function(msg) {
      showError(String(msg));
    };
  </script>

  <script
    src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false"
    onerror="showError('카카오맵 SDK 로드 실패. 카카오 개발자 콘솔(developers.kakao.com) > 앱 설정 > 플랫폼 > Web 플랫폼 등록에서 사이트 도메인에 [http://localhost] 를 등록해주세요.')"
  ></script>

  <script>
    var map = null;
    var busOverlay = null;
    var academyOverlay = null;
    var stopOverlays = [];
    var polyline = null;

    if (typeof kakao === 'undefined') {
      showError('카카오맵 SDK 초기화 실패: Web 플랫폼 등록 도메인(http://localhost)과 JavaScript 키를 확인하세요.');
    } else {
      kakao.maps.load(function() {
        try {
          var centerCoord = new kakao.maps.LatLng(${initialCenter.lat}, ${initialCenter.lng});
          var mapContainer = document.getElementById('map');
          var mapOptions = {
            center: centerCoord,
            level: 5
          };
          map = new kakao.maps.Map(mapContainer, mapOptions);

          var zoomControl = new kakao.maps.ZoomControl();
          map.addControl(zoomControl, kakao.maps.ControlPosition.RIGHT);

          renderAll(
            ${JSON.stringify(initialRoute)},
            ${JSON.stringify(initialStops)},
            ${JSON.stringify(initialAcademy)},
            ${JSON.stringify(initialBus)}
          );

          post('ready', 'Kakao Map Loaded');
        } catch (e) {
          showError('지도 렌더링 중 오류: ' + e.message);
        }
      });
    }

    function renderAll(route, stops, academy, bus) {
      if (!map) return;

      var bounds = new kakao.maps.LatLngBounds();
      var hasBounds = false;

      // 1. 경로 폴리라인
      if (polyline) polyline.setMap(null);
      if (route && route.length > 1) {
        var path = route.map(function(p) {
          var latLng = new kakao.maps.LatLng(p.lat, p.lng);
          bounds.extend(latLng);
          hasBounds = true;
          return latLng;
        });
        polyline = new kakao.maps.Polyline({
          map: map,
          path: path,
          strokeWeight: 6,
          strokeColor: '#2563eb',
          strokeOpacity: 0.85,
          strokeStyle: 'solid'
        });
      }

      // 2. 유치원 마커
      if (academyOverlay) academyOverlay.setMap(null);
      if (academy && academy.lat && academy.lng) {
        var aCoord = new kakao.maps.LatLng(academy.lat, academy.lng);
        bounds.extend(aCoord);
        hasBounds = true;
        academyOverlay = new kakao.maps.CustomOverlay({
          map: map,
          position: aCoord,
          content: '<div class="academy-marker" title="유치원">🏫</div>',
          yAnchor: 0.5,
          xAnchor: 0.5
        });
      }

      // 3. 정류장 마커
      stopOverlays.forEach(function(o) { o.setMap(null); });
      stopOverlays = [];
      if (stops && stops.length > 0) {
        stops.forEach(function(stop, idx) {
          var sCoord = new kakao.maps.LatLng(stop.lat, stop.lng);
          bounds.extend(sCoord);
          hasBounds = true;
          var overlay = new kakao.maps.CustomOverlay({
            map: map,
            position: sCoord,
            content: '<div class="stop-marker" id="stop-' + (stop.id || idx) + '">' + (idx + 1) + '</div>',
            yAnchor: 0.5,
            xAnchor: 0.5
          });
          stopOverlays.push(overlay);
        });
      }

      // 4. 버스 마커
      if (busOverlay) busOverlay.setMap(null);
      if (bus && bus.lat && bus.lng) {
        var bCoord = new kakao.maps.LatLng(bus.lat, bus.lng);
        busOverlay = new kakao.maps.CustomOverlay({
          map: map,
          position: bCoord,
          content: '<div class="bus-marker" title="내 버스">🚌</div>',
          yAnchor: 0.5,
          xAnchor: 0.5,
          zIndex: 10
        });
      }

      if (hasBounds) {
        map.setBounds(bounds);
      }
    }

    var hasCenteredBus = false;
    window.updateBus = function(lat, lng, pan) {
      if (!map) return;
      var coord = new kakao.maps.LatLng(lat, lng);
      if (!busOverlay) {
        busOverlay = new kakao.maps.CustomOverlay({
          map: map,
          position: coord,
          content: '<div class="bus-marker" title="내 위치">🚌</div>',
          yAnchor: 0.5,
          xAnchor: 0.5,
          zIndex: 10
        });
        busOverlay.setMap(map);
      } else {
        busOverlay.setPosition(coord);
        if (!busOverlay.getMap()) {
          busOverlay.setMap(map);
        }
      }
      if (pan || !hasCenteredBus) {
        map.panTo(coord);
        hasCenteredBus = true;
      }
    };

    window.fitToCoordinates = function(points) {
      if (!map || !points || points.length === 0) return;
      var bounds = new kakao.maps.LatLngBounds();
      points.forEach(function(p) {
        bounds.extend(new kakao.maps.LatLng(p.lat, p.lng));
      });
      map.setBounds(bounds);
    };

    window.updateAnnounced = function(announcedIds) {
      if (!announcedIds) return;
      var set = new Set(announcedIds);
      stopOverlays.forEach(function(overlay, idx) {
        var el = document.getElementById('stop-' + idx);
        if (el) {
          if (set.has(idx) || set.has(String(idx))) {
            el.className = 'stop-marker announced';
          }
        }
      });
    };
  </script>
</body>
</html>`;
}

export const KakaoMap = forwardRef<KakaoMapRef, KakaoMapProps>(function KakaoMap(
  {
    appKey = KAKAO_JS_KEY,
    center,
    routePoints = [],
    stops = [],
    announcedStops,
    busLocation,
    academy,
    style,
  },
  ref
) {
  const webRef = useRef<WebView>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const parseCoord = (item?: LatLng | null) => {
    if (!item) return null;
    const lat = typeof item.latitude === 'string' ? parseFloat(item.latitude) : item.latitude;
    const lng = typeof item.longitude === 'string' ? parseFloat(item.longitude) : item.longitude;
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  };

  const cleanCenter = useMemo(() => {
    const parsed = parseCoord(academy) || parseCoord(busLocation);
    if (parsed) return parsed;
    if (stops.length > 0) {
      const s = parseCoord(stops[0]);
      if (s) return s;
    }
    return center || { lat: 37.558, lng: 126.824 };
  }, [academy, busLocation, stops, center]);

  const cleanRoute = useMemo(() => {
    return (routePoints || [])
      .map(p => parseCoord(p))
      .filter((p): p is { lat: number; lng: number } => p !== null);
  }, [routePoints]);

  const cleanStops = useMemo(() => {
    return (stops || [])
      .map(s => {
        const c = parseCoord(s);
        if (!c) return null;
        return { id: s.id, name: s.name, lat: c.lat, lng: c.lng };
      })
      .filter((s): s is { id?: any; name?: string; lat: number; lng: number } => s !== null);
  }, [stops]);

  const cleanAcademy = useMemo(() => parseCoord(academy), [academy]);
  const cleanBus = useMemo(() => parseCoord(busLocation), [busLocation]);

  const html = useMemo(() => {
    return buildHtml(appKey, cleanCenter, cleanRoute, cleanStops, cleanAcademy, cleanBus);
  }, [appKey]);

  useEffect(() => {
    if (isLoaded && cleanBus) {
      webRef.current?.injectJavaScript(`window.updateBus && window.updateBus(${cleanBus.lat}, ${cleanBus.lng}, false); true;`);
    }
  }, [cleanBus, isLoaded]);

  useEffect(() => {
    if (isLoaded && announcedStops) {
      const ids = Array.from(announcedStops instanceof Set ? announcedStops : announcedStops);
      webRef.current?.injectJavaScript(`window.updateAnnounced && window.updateAnnounced(${JSON.stringify(ids)}); true;`);
    }
  }, [announcedStops, isLoaded]);

  useImperativeHandle(ref, () => ({
    moveBus(lat: number, lng: number) {
      webRef.current?.injectJavaScript(`window.updateBus && window.updateBus(${lat}, ${lng}, true); true;`);
    },
    fitBounds() {
      // fit
    },
    fitToCoordinates(points: any[], options?: any) {
      if (points && points.length > 0) {
        const coords = points.map(p => ({
          lat: typeof p.latitude === 'string' ? parseFloat(p.latitude) : p.latitude,
          lng: typeof p.longitude === 'string' ? parseFloat(p.longitude) : p.longitude,
        })).filter(p => !isNaN(p.lat) && !isNaN(p.lng));
        if (coords.length > 0) {
          webRef.current?.injectJavaScript(`window.fitToCoordinates && window.fitToCoordinates(${JSON.stringify(coords)}); true;`);
        }
      }
    },
  }));

  const handleMessage = (event: any) => {
    try {
      const { type, data } = JSON.parse(event.nativeEvent.data);
      if (type === 'ready') {
        setIsLoaded(true);
        setLoadError(null);
      } else if (type === 'error') {
        setLoadError(data);
      }
    } catch {
      // 무시
    }
  };

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        originWhitelist={['*']}
        source={{ html, baseUrl: BASE_URL }}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        allowFileAccess={true}
        allowFileAccessFromFileURLs={true}
        allowUniversalAccessFromFileURLs={true}
        onMessage={handleMessage}
        style={styles.webview}
      />
      {!isLoaded && !loadError && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#2563eb" />
          <Text style={styles.loadingText}>카카오 지도 불러오는 중...</Text>
        </View>
      )}
      {loadError && (
        <View style={styles.errorOverlay}>
          <Text style={styles.errorText}>⚠️ 카카오 지도 안내</Text>
          <Text style={styles.errorSub}>{loadError}</Text>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#f8fafc',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(241, 245, 249, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  errorOverlay: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(254, 242, 242, 0.95)',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 12,
    zIndex: 99,
  },
  errorText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#b91c1c',
  },
  errorSub: {
    fontSize: 11,
    color: '#7f1d1d',
    marginTop: 4,
    lineHeight: 16,
  },
});

export default KakaoMap;
