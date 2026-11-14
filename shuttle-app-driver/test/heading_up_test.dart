import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

void main() {
  test('동쪽(90도) 주행 시 진행 방향 위 모드에서 동쪽이 화면 위에 위치하는지 검증', () {
    const center = LatLng(37.5000, 127.0000);
    const eastPoint = LatLng(37.5000, 127.0100); // 정확히 동쪽

    // nonRotatedSize: 400 x 800 화면
    const size = Size(400, 800);

    // 회전 0도 (북쪽 위)
    final camNorthUp = MapCamera(
      crs: const Epsg3857(),
      minZoom: 1,
      maxZoom: 20,
      center: center,
      zoom: 16,
      rotation: 0.0,
      nonRotatedSize: size,
    );

    final centerOffset0 = camNorthUp.latLngToScreenOffset(center);
    final eastOffset0 = camNorthUp.latLngToScreenOffset(eastPoint);

    expect(eastOffset0.dx, greaterThan(centerOffset0.dx), reason: '북쪽 위에서 동쪽은 화면 오른쪽');
    expect((eastOffset0.dy - centerOffset0.dy).abs(), lessThan(1.0), reason: '북쪽 위에서 위도 같으면 dy 유사');

    // 동쪽(heading = 90도)으로 주행할 때:
    // 진행 방향(동쪽)이 화면 위(12시, eastOffset.dy < centerOffset.dy)에 와야 함
    const heading = 90.0;
    // MapController.rotate(rotation) 에 전달할 각도 부호 검증
    // FlutterMap 에서 rotation = -heading 일 때의 결과 확인
    final camRotNeg = MapCamera(
      crs: const Epsg3857(),
      minZoom: 1,
      maxZoom: 20,
      center: center,
      zoom: 16,
      rotation: -heading, // -90.0
      nonRotatedSize: size,
    );

    final cNeg = camRotNeg.latLngToScreenOffset(center);
    final eNeg = camRotNeg.latLngToScreenOffset(eastPoint);

    // eNeg.dy < cNeg.dy 이어야 화면 위(12시)에 위치함
    expect(eNeg.dy, lessThan(cNeg.dy), reason: 'rotation = -heading(-90도) 일 때 동쪽이 화면 위(12시)에 위치해야 함');
    expect((eNeg.dx - cNeg.dx).abs(), lessThan(2.0), reason: 'rotation = -heading(-90도) 일 때 동쪽의 화면 x좌표는 중심과 일치(12시 정렬)');
  });
}
