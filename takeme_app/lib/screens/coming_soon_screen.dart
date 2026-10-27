import 'package:flutter/material.dart';

import '../auth/auth_state.dart';
import '../theme.dart';

/// 기사 외 계정 (지도교사·학부모·원아·원장) 안내
class ComingSoonScreen extends StatelessWidget {
  const ComingSoonScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = AuthState.instance.user!;
    final isAdmin = user.role == 'ACADEMY_ADMIN' || user.role == 'SUPER_ADMIN';
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isAdmin
                      ? '원장선생님은 PC 관리자 웹을 이용해주세요.'
                      : '${user.roleLabel} 화면은 준비 중입니다.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 16, color: AppColors.slate600, fontWeight: FontWeight.w600),
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () => AuthState.instance.logout(),
                  child: const Text('로그아웃'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
