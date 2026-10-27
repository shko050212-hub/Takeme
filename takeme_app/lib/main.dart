import 'package:flutter/material.dart';

import 'api/api_client.dart';
import 'auth/auth_state.dart';
import 'screens/coming_soon_screen.dart';
import 'screens/driver_home_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  ApiClient.instance.onUnauthorized = () => AuthState.instance.logout();
  await AuthState.instance.restore();
  runApp(const TakemeApp());
}

class TakemeApp extends StatelessWidget {
  const TakemeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Takeme',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: ListenableBuilder(
        listenable: AuthState.instance,
        builder: (context, _) {
          final user = AuthState.instance.user;
          if (user == null) return const LoginScreen();
          // 지금은 기사 앱에 집중. 지도교사·학부모·원아 화면은 다음 단계에서 추가
          if (user.role == 'DRIVER') return const DriverHomeScreen();
          return const ComingSoonScreen();
        },
      ),
    );
  }
}
