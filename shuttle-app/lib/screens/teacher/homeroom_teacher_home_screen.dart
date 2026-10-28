import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../settings_screen.dart';
import '../staff/teacher_board_view.dart';
import '../staff/teacher_message_view.dart';

class HomeroomTeacherHomeScreen extends StatefulWidget {
  const HomeroomTeacherHomeScreen({super.key});

  @override
  State<HomeroomTeacherHomeScreen> createState() => _HomeroomTeacherHomeScreenState();
}

class _HomeroomTeacherHomeScreenState extends State<HomeroomTeacherHomeScreen> {
  int _selectedTabIndex = 0;

  @override
  Widget build(BuildContext context) {
    final user = ApiService().currentUser;
    final teacherName = user?.name ?? '담임교사';
    final assignedClass = (user?.assignedClass != null && user!.assignedClass!.isNotEmpty)
        ? user.assignedClass!
        : '담당 학급';

    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  _selectedTabIndex == 0 ? '클라우드 게시판' : '학급 메시지 소통',
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: Color(0xFF1E293B)),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(
                    color: const Color(0xFFEFF6FF),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: const Color(0xFFBFDBFE)),
                  ),
                  child: Text(
                    '$assignedClass 담임',
                    style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Color(0xFF2563EB)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              '$teacherName 담임선생님',
              style: const TextStyle(fontSize: 11, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
            ),
          ],
        ),
        backgroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: Color(0xFF475569)),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SettingsScreen()),
              );
            },
          ),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Container(color: const Color(0xFFF1F5F9), height: 1),
        ),
      ),
      body: IndexedStack(
        index: _selectedTabIndex,
        children: const [
          TeacherBoardView(),
          TeacherMessageView(),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedTabIndex,
        onTap: (idx) => setState(() => _selectedTabIndex = idx),
        selectedItemColor: const Color(0xFF2563EB),
        unselectedItemColor: const Color(0xFF64748B),
        backgroundColor: Colors.white,
        type: BottomNavigationBarType.fixed,
        selectedLabelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
        unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 12),
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.photo_library_outlined),
            activeIcon: Icon(Icons.photo_library),
            label: '클라우드 게시판',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.mail_outline),
            activeIcon: Icon(Icons.mail),
            label: '학급 메시지함',
          ),
        ],
      ),
    );
  }
}
