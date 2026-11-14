import 'dart:async';
import 'package:flutter/material.dart';
import '../../models/student_model.dart';
import '../chat/chat_room_list_screen.dart';

class TeacherMessageView extends StatelessWidget {
  final List<StudentModel> students;

  const TeacherMessageView({super.key, this.students = const []});

  @override
  Widget build(BuildContext context) {
    return const ChatRoomListScreen(isEmbeddedTab: true);
  }
}
