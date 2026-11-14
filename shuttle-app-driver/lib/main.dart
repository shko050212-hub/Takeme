import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_naver_map/flutter_naver_map.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'services/api_service.dart';
import 'screens/login_screen.dart';
import 'screens/driver/driver_home_screen.dart';
import 'widgets/nav_map_view.dart';
import 'utils/network_helper.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  setupNetworkSecurity();
  await initializeDateFormatting('ko_KR', null);
  await ApiService().init();
  if (naverMapClientId.isNotEmpty && !kIsWeb) {
    try {
      await FlutterNaverMap().init(
        clientId: naverMapClientId,
        onAuthFailed: (e) {
          debugPrint('[naver_map] 인증 실패, 대체 지도로 전환: $e');
          naverMapFallbackReason.value = '네이버 인증 실패 (클라이언트 ID/패키지명 등록 확인): $e';
          naverMapAvailable.value = false;
        },
      );
      naverMapAvailable.value = true;
    } catch (e) {
      debugPrint('[naver_map] 초기화 실패, 대체 지도로 전환: $e');
      naverMapFallbackReason.value = '네이버 SDK 초기화 실패: $e';
    }
  }
  runApp(const TakeMeDriverApp());
}

class TakeMeDriverApp extends StatelessWidget {
  const TakeMeDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TakeMe 기사',
      debugShowCheckedModeBanner: false,
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [
        Locale('ko', 'KR'),
        Locale('en', 'US'),
      ],
      locale: const Locale('ko', 'KR'),
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1D4ED8),
          primary: const Color(0xFF1D4ED8),
          surface: const Color(0xFFF8FAFC),
        ),
        scaffoldBackgroundColor: const Color(0xFFF8FAFC),
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: Color(0xFF0F172A),
          elevation: 0,
          scrolledUnderElevation: 1,
          titleTextStyle: TextStyle(
            color: Color(0xFF0F172A),
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        cardTheme: CardThemeData(
          color: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: Color(0xFFE2E8F0)),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: const Color(0xFFF8FAFC),
          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFCBD5E1)),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFFE2E8F0)),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: Color(0xFF1D4ED8), width: 1.5),
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF1D4ED8),
            foregroundColor: Colors.white,
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            textStyle: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ),
      home: const DriverInitialRouterScreen(),
    );
  }
}

class DriverInitialRouterScreen extends StatelessWidget {
  const DriverInitialRouterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final api = ApiService();
    if (!api.isLoggedIn || api.currentUser == null) {
      return const LoginScreen();
    }

    final user = api.currentUser!;
    if (user.role == 'DRIVER') {
      return const DriverHomeScreen();
    }

    // 기사 계정이 아닌 경우 로그아웃 후 로그인 화면으로 안내
    WidgetsBinding.instance.addPostFrameCallback((_) {
      api.logout();
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Text('접근 권한 안내', style: TextStyle(fontWeight: FontWeight.bold)),
          content: const Text('본 앱은 [셔틀 기사님 전용 앱]입니다.\n교사 또는 학부모 계정은 해당 전용 앱을 이용해 주시기 바랍니다.'),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('확인', style: TextStyle(fontWeight: FontWeight.bold)),
            ),
          ],
        ),
      );
    });

    return const LoginScreen();
  }
}
