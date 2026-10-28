import 'screens/teacher/homeroom_teacher_home_screen.dart';
import 'package:flutter/material.dart';
import 'services/api_service.dart';
import 'screens/login_screen.dart';
import 'screens/parent/parent_home_screen.dart';
import 'screens/staff/staff_dashboard_screen.dart';
import 'screens/driver/driver_home_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiService().init();
  runApp(const TakeMeApp());
}

class TakeMeApp extends StatelessWidget {
  const TakeMeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'TakeMe',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF2563EB),
          primary: const Color(0xFF2563EB),
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
            borderSide: const BorderSide(color: Color(0xFF2563EB), width: 1.5),
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: const Color(0xFF2563EB),
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
      home: const InitialRouterScreen(),
    );
  }
}

class InitialRouterScreen extends StatelessWidget {
  const InitialRouterScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final api = ApiService();
    if (!api.isLoggedIn || api.currentUser == null) {
      return const LoginScreen();
    }

    final user = api.currentUser!;
    final role = user.role;
    // 기사는 내비게이션 운행 화면
    if (role == 'DRIVER') {
      return const DriverHomeScreen();
    }
    // 담임교사: 유치원 교실, 클라우드 게시판 및 학급 메시지 소통
    if (role == 'HOMEROOM_TEACHER') {
      return const HomeroomTeacherHomeScreen();
    }
    // 지도교사: 통학차량 동승, 탑승 관리 및 탑승 QR
    if (role == 'SHUTTLE_TEACHER') {
      return const StaffDashboardScreen();
    }
    // 레거시 TEACHER 호환 (학급 배정 여부에 따라 분기)
    if (role == 'TEACHER') {
      final cls = user.assignedClass;
      if (cls != null && cls.isNotEmpty && cls != 'SHUTTLE') {
        return const HomeroomTeacherHomeScreen();
      }
      return const StaffDashboardScreen();
    }

    return const ParentHomeScreen();
  }
}
