import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { WebView } from 'react-native-webview';

// 카카오 개발자 사이트 > 플랫폼 > Web 에 등록한 도메인과 반드시 같아야 지도가 뜸
const BASE_URL = 'http://localhost';

function buildHtml(appKey, center, route) {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; }
  .bus { font-size: 26px; transform: translate(-50%, -50%); }
</style>
</head>
<body>
<div id="map"></div>
<script>
  function send(type, payload) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, payload: payload }));
  }
  window.onerror = function (msg) { send('error', String(msg)); };
</script>
<script
  src="https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false"
  onerror="send('error', '카카오맵 SDK를 불러오지 못했어요. 앱 키와 등록 도메인을 확인하세요.')"></script>
<script>
  var map, busOverlay, anim;
  var current = { lat: ${center.lat}, lng: ${center.lng} };

  if (typeof kakao === 'undefined') {
    send('error', '카카오맵 SDK 로딩 실패 - JavaScript SDK 도메인(http://localhost), 카카오맵 사용 설정, JavaScript 키를 확인하세요.');
  } else kakao.maps.load(function () {
    var c = new kakao.maps.LatLng(current.lat, current.lng);
    map = new kakao.maps.Map(document.getElementById('map'), { center: c, level: 4 });

    // 노선 경로 (나중에는 백엔드가 Kakao Mobility에서 받아온 좌표로 교체)
    var route = ${JSON.stringify(route)};
    if (route.length > 1) {
      new kakao.maps.Polyline({
        map: map,
        path: route.map(function (p) { return new kakao.maps.LatLng(p.lat, p.lng); }),
        strokeWeight: 6, strokeColor: '#2F6FDE', strokeOpacity: 0.9
      });
    }

    busOverlay = new kakao.maps.CustomOverlay({
      map: map, position: c, content: '<div class="bus">🚌</div>', yAnchor: 0.5
    });
    send('ready');
  });

  // 앱에서 호출: 이전 위치 → 새 위치로 duration(ms) 동안 부드럽게 이동
  window.moveBus = function (lat, lng, duration) {
    if (!busOverlay) return;
    cancelAnimationFrame(anim);
    var from = { lat: current.lat, lng: current.lng };
    var start = performance.now();
    duration = duration || 1000;
    function step(now) {
      var t = Math.min(1, (now - start) / duration);
      current = { lat: from.lat + (lat - from.lat) * t, lng: from.lng + (lng - from.lng) * t };
      busOverlay.setPosition(new kakao.maps.LatLng(current.lat, current.lng));
      if (t < 1) anim = requestAnimationFrame(step);
    }
    anim = requestAnimationFrame(step);
  };

  window.followBus = function () {
    if (map) map.panTo(new kakao.maps.LatLng(current.lat, current.lng));
  };
</script>
</body>
</html>`;
}

const KakaoMap = forwardRef(function KakaoMap({ appKey, center, route = [], onReady, onError }, ref) {
  const webRef = useRef(null);

  // html은 처음 한 번만 만들기 (다시 만들면 지도가 새로 로딩됨)
  const html = useMemo(() => buildHtml(appKey, center, route), [appKey]);

  useImperativeHandle(ref, () => ({
    moveBus(lat, lng, duration = 1000) {
      webRef.current?.injectJavaScript(`window.moveBus(${lat}, ${lng}, ${duration}); true;`);
    },
    followBus() {
      webRef.current?.injectJavaScript('window.followBus(); true;');
    },
  }));

  const handleMessage = (e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') onReady?.();
      if (msg.type === 'error') onError?.(msg.payload);
    } catch {
      // 웹뷰에서 온 알 수 없는 메시지는 무시
    }
  };

  return (
    <WebView
      ref={webRef}
      originWhitelist={['*']}
      source={{ html, baseUrl: BASE_URL }}
      javaScriptEnabled
      domStorageEnabled
      mixedContentMode="always"
      onMessage={handleMessage}
      style={{ flex: 1 }}
    />
  );
});

export default KakaoMap;