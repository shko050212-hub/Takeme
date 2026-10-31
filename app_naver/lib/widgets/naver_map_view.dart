import 'package:flutter/material.dart';
import 'naver_map_controller.dart';
import 'naver_map_view_mobile.dart' if (dart.library.html) 'naver_map_view_web.dart' as platform_impl;

export 'naver_map_controller.dart';

class NaverMapView extends StatelessWidget {
  final NaverMapController controller;

  const NaverMapView({super.key, required this.controller});

  @override
  Widget build(BuildContext context) {
    return platform_impl.NaverMapViewPlatform(controller: controller);
  }

  static NaverMapController createController({String clientId = ''}) {
    return platform_impl.createNaverMapController(clientId: clientId);
  }
}
