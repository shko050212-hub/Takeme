import 'package:flutter/material.dart';

/// 앱 전역 설정 및 디자인 상수
class AppConfig {
  static const String appName = 'TakeMe 기사 내비게이션 (네이버 지도)';
  static const String appVersion = '1.0.0';

  // 백엔드 기본 서버 주소 (EC2 배포 서버)
  static const String defaultBaseUrl = 'https://52.63.245.203.sslip.io';

  // 네이버 클라우드 플랫폼 (NCP) Maps Client ID 기본값
  // 사용자가 설정 화면에서 언제든 입력 및 수정할 수 있습니다.
  static const String defaultNaverClientId = '';

  // 기본 지도 중심 좌표 (서울 시청 부근)
  static const double defaultLat = 37.5665;
  static const double defaultLng = 126.9780;
}

/// 네이버 지도 기사앱 전용 색상 테마 (이모티콘 없이 깔끔하고 높은 시인성)
class AppColors {
  // 네이버 브랜드 그린
  static const Color naverGreen = Color(0xFF03C75A);
  static const Color naverGreenDark = Color(0xFF029744);
  static const Color naverGreenLight = Color(0xFFE8F9F0);

  // 주행 및 안내 색상
  static const Color primaryBlue = Color(0xFF2563EB);
  static const Color primaryBlueBg = Color(0xFFEFF6FF);
  static const Color dangerRed = Color(0xFFDC2626);
  static const Color dangerRedBg = Color(0xFFFEF2F2);
  static const Color warningOrange = Color(0xFFEA580C);
  static const Color warningOrangeBg = Color(0xFFFFF7ED);
  static const Color successGreen = Color(0xFF059669);

  // 다크/슬레이트 계열
  static const Color slate900 = Color(0xFF0F172A);
  static const Color slate800 = Color(0xFF1E293B);
  static const Color slate700 = Color(0xFF334155);
  static const Color slate600 = Color(0xFF475569);
  static const Color slate500 = Color(0xFF64748B);
  static const Color slate400 = Color(0xFF94A3B8);
  static const Color slate300 = Color(0xFFCBD5E1);
  static const Color slate200 = Color(0xFFE2E8F0);
  static const Color slate100 = Color(0xFFF1F5F9);
  static const Color slate50 = Color(0xFFF8FAFC);
}
