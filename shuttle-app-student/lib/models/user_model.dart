class UserModel {
  final int? id;
  final String email;
  final String name;
  final String role;
  final String? token;
  final int? academyId;
  final String? assignedClass;

  UserModel({
    this.id,
    required this.email,
    required this.name,
    required this.role,
    this.token,
    this.academyId,
    this.assignedClass,
  });

  factory UserModel.fromJson(Map<String, dynamic> json, {String? token}) {
    return UserModel(
      id: json['id'] is int ? json['id'] : int.tryParse(json['id']?.toString() ?? ''),
      email: json['email'] ?? '',
      name: json['name'] ?? '',
      role: json['role'] ?? 'STUDENT',
      token: token ?? json['token'],
      academyId: json['academyId'] is int ? json['academyId'] : int.tryParse(json['academyId']?.toString() ?? ''),
      assignedClass: json['assignedClass'],
    );
  }

  static String getRoleKorean(String? role) {
    switch (role?.toUpperCase()) {
      case 'HOMEROOM_TEACHER':
        return '담임교사';
      case 'SHUTTLE_TEACHER':
        return '지도교사';
      case 'TEACHER':
        return '교사';
      case 'DRIVER':
        return '기사';
      case 'PARENT':
        return '학부모';
      case 'STUDENT':
        return '학생';
      case 'ACADEMY_ADMIN':
      case 'SUPER_ADMIN':
        return '기관 관리자';
      default:
        return '알 수 없음';
    }
  }

  String get roleKorean => getRoleKorean(role);

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'email': email,
      'name': name,
      'role': role,
      'token': token,
      'academyId': academyId,
      'assignedClass': assignedClass,
    };
  }
}
