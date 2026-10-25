import React, { useMemo, useRef } from 'react';
import { View, StyleSheet, Platform, Text } from 'react-native';
import { WebView } from 'react-native-webview';

interface Coordinate {
  latitude: number | string;
  longitude: number | string;
}

interface Stop {
  id?: number | string;
  name?: string;
  latitude: number | string;
  longitude: number | string;
  address?: string;
}

interface LeafletMapProps {
  center?: Coordinate | null;
  routePoints?: Coordinate[];
  stops?: Stop[];
  academy?: Coordinate | null;
  currentLoc?: Coordinate | null;
  busLocation?: Coordinate | null;
  style?: any;
}

export default function LeafletMap({
  center,
  routePoints = [],
  stops = [],
  academy,
  currentLoc,
  busLocation,
  style,
}: LeafletMapProps) {
  const webViewRef = useRef<WebView>(null);

  const cleanNum = (val: any, fallback: number): number => {
    const num = parseFloat(val);
    return isNaN(num) ? fallback : num;
  };

  const defaultCenter = useMemo(() => {
    if (center?.latitude && center?.longitude) {
      return { lat: cleanNum(center.latitude, 37.558), lng: cleanNum(center.longitude, 126.824) };
    }
    if (stops.length > 0 && stops[0].latitude && stops[0].longitude) {
      return { lat: cleanNum(stops[0].latitude, 37.558), lng: cleanNum(stops[0].longitude, 126.824) };
    }
    if (academy?.latitude && academy?.longitude) {
      return { lat: cleanNum(academy.latitude, 37.558), lng: cleanNum(academy.longitude, 126.824) };
    }
    return { lat: 37.558, lng: 126.824 };
  }, [center, stops, academy]);

  const htmlContent = useMemo(() => {
    const validPoints = (routePoints || [])
      .map(p => [cleanNum(p.latitude, 0), cleanNum(p.longitude, 0)])
      .filter(([lat, lng]) => lat !== 0 && lng !== 0);

    const validStops = (stops || [])
      .map((s, idx) => ({
        index: idx + 1,
        name: s.name || `정류장 ${idx + 1}`,
        lat: cleanNum(s.latitude, 0),
        lng: cleanNum(s.longitude, 0),
        address: s.address || '',
      }))
      .filter(s => s.lat !== 0 && s.lng !== 0);

    const busPos = busLocation || currentLoc;
    const validBus = busPos && busPos.latitude && busPos.longitude ? {
      lat: cleanNum(busPos.latitude, 0),
      lng: cleanNum(busPos.longitude, 0),
    } : null;

    const validAcademy = academy && academy.latitude && academy.longitude ? {
      lat: cleanNum(academy.latitude, 0),
      lng: cleanNum(academy.longitude, 0),
    } : null;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f1f5f9; }
    .stop-badge {
      background: #2563eb; color: #fff; width: 24px; height: 24px; border-radius: 50%;
      display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px;
      border: 2px solid #ffffff; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    .bus-badge {
      font-size: 26px; transform: translate(-13px, -13px); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }
    .academy-badge {
      font-size: 24px; transform: translate(-12px, -12px); filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
    }
  </style>
</head>
<body>
<div id="map"></div>
<script>
  var map = L.map('map', { zoomControl: false }).setView([${defaultCenter.lat}, ${defaultCenter.lng}], 14);

  // CartoDB Voyager Tile Layer (Reliable, fast, high-res worldwide and Korea)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '© CARTO'
  }).addTo(map);

  var bounds = [];

  // Route Polyline
  var routePoints = ${JSON.stringify(validPoints)};
  if (routePoints.length > 0) {
    L.polyline(routePoints, { color: '#2563eb', weight: 5, opacity: 0.85, lineJoin: 'round' }).addTo(map);
    routePoints.forEach(function(pt) { bounds.push(pt); });
  }

  // Stops
  var stops = ${JSON.stringify(validStops)};
  stops.forEach(function(s) {
    var icon = L.divIcon({
      className: '',
      html: '<div class="stop-badge">' + s.index + '</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker([s.lat, s.lng], { icon: icon }).bindPopup('<b>' + s.name + '</b><br>' + s.address).addTo(map);
    bounds.push([s.lat, s.lng]);
  });

  // Academy Marker
  var academy = ${JSON.stringify(validAcademy)};
  if (academy && academy.lat && academy.lng) {
    var acadIcon = L.divIcon({
      className: '',
      html: '<div class="academy-badge">🏫</div>',
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });
    L.marker([academy.lat, academy.lng], { icon: acadIcon }).bindPopup('유치원').addTo(map);
    bounds.push([academy.lat, academy.lng]);
  }

  // Bus Marker
  var bus = ${JSON.stringify(validBus)};
  if (bus && bus.lat && bus.lng) {
    var busIcon = L.divIcon({
      className: '',
      html: '<div class="bus-badge">🚌</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    L.marker([bus.lat, bus.lng], { icon: busIcon }).bindPopup('셔틀버스').addTo(map);
    bounds.push([bus.lat, bus.lng]);
  }

  // Fit bounds if coordinates exist
  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
</script>
</body>
</html>`;
  }, [defaultCenter, routePoints, stops, academy, currentLoc, busLocation]);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f1f5f9',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
