class UserModel {
  final String id;
  final String email;
  final String name;
  final String role;
  final String? academyId;
  final String? academyName;

  UserModel({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
    this.academyId,
    this.academyName,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: json['id']?.toString() ?? '',
      email: json['email'] ?? '',
      name: json['name'] ?? '',
      role: json['role'] ?? 'DRIVER',
      academyId: json['academyId']?.toString(),
      academyName: json['academyName'] ?? json['academy']?['name'],
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'name': name,
    'role': role,
    'academyId': academyId,
    'academyName': academyName,
  };
}

class VehicleModel {
  final String id;
  final String plateNumber;
  final String model;
  final int capacity;
  final String? routeId;
  final String? routeName;

  VehicleModel({
    required this.id,
    required this.plateNumber,
    required this.model,
    required this.capacity,
    this.routeId,
    this.routeName,
  });

  factory VehicleModel.fromJson(Map<String, dynamic> json) {
    return VehicleModel(
      id: json['id']?.toString() ?? '',
      plateNumber: json['plateNumber'] ?? json['licensePlate'] ?? '',
      model: json['model'] ?? json['vehicleName'] ?? '',
      capacity: json['capacity'] ?? 15,
      routeId: json['routeId']?.toString() ?? json['route']?['id']?.toString(),
      routeName: json['routeName'] ?? json['route']?['name'],
    );
  }
}
