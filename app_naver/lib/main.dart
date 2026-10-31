import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'config.dart';
import 'models/user_model.dart';
import 'screens/driver_home_screen.dart';
import 'screens/driver_login_screen.dart';
import 'services/api_service.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiService().init();

  // 웹 브라우저 편의 지원: URL에 ?demo=true가 있거나 세션이 없어도 자동 진입 옵션
  if (kIsWeb && !ApiService().isLoggedIn) {
    final query = Uri.base.queryParameters;
    if (query['demo'] == 'true' || query['auto'] == 'true') {
      await ApiService().setAuth(
        'demo_token',
        UserModel(
          id: 'demo_driver_1',
          email: 'demo@takeme.com',
          name: '체험 기사님',
          role: 'DRIVER',
          academyName: '해맑은 유치원',
        ),
      );
    }
  }

  runApp(const TakeMeDriverApp());
}

class TakeMeDriverApp extends StatelessWidget {
  const TakeMeDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    final isLoggedIn = ApiService().isLoggedIn;

    return MaterialApp(
      title: AppConfig.appName,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.naverGreen,
          primary: AppColors.naverGreen,
          secondary: AppColors.primaryBlue,
          surface: Colors.white,
        ),
        fontFamily: 'Pretendard',
        scaffoldBackgroundColor: AppColors.slate50,
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: AppColors.slate900,
          elevation: 0,
          centerTitle: false,
        ),
      ),
      home: isLoggedIn ? const DriverHomeScreen() : const DriverLoginScreen(),
    );
  }
}
