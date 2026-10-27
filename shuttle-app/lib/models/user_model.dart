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
