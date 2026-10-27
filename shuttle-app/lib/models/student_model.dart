class StudentModel {
  final int id;
  final String name;
  final String? realName;
  final String address;
  final String? boardingLocation;
  final double? latitude;
  final double? longitude;
  final String allergies;
  final bool boarded;
  final bool absent;
  final String expectedTime;
  final String? actualBoardTime;
  final String? teacherMemo;
  final String? parentMessage;
  final int runNumber;
  final bool isOverride;
  final String? className;
  final String? academyName;
  final String? vehicleName;
  final String? approvalStatus;

  StudentModel({
    required this.id,
    required this.name,
    this.realName,
    required this.address,
    this.boardingLocation,
    this.latitude,
    this.longitude,
    this.allergies = '',
    this.boarded = false,
    this.absent = false,
    this.expectedTime = '15:30',
    this.actualBoardTime,
    this.teacherMemo,
    this.parentMessage,
    this.runNumber = 1,
    this.isOverride = false,
    this.className,
    this.academyName,
    this.vehicleName,
    this.approvalStatus,
  });

  factory StudentModel.fromJson(Map<String, dynamic> json) {
    double? parseCoord(dynamic val) {
      if (val == null) return null;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString());
    }

    return StudentModel(
      id: json['id'] is int ? json['id'] : (int.tryParse(json['id']?.toString() ?? '0') ?? 0),
      name: json['name'] ?? '',
      realName: json['realName'],
      address: json['address'] ?? '',
      boardingLocation: json['boardingLocation'],
      latitude: parseCoord(json['latitude'] ?? json['lat']),
      longitude: parseCoord(json['longitude'] ?? json['lng']),
      allergies: json['allergies'] ?? '',
      boarded: json['boarded'] == true || json['boardStatus'] == 'BOARDED',
      absent: json['absent'] == true || json['boardStatus'] == 'ABSENT',
      expectedTime: json['expectedTime'] ?? '15:30',
      actualBoardTime: json['actualBoardTime']?.toString(),
      teacherMemo: json['teacherMemo'],
      parentMessage: json['parentMessage'],
      runNumber: json['runNumber'] is int ? json['runNumber'] : (int.tryParse(json['runNumber']?.toString() ?? '1') ?? 1),
      isOverride: json['isOverride'] == true,
      className: json['className'],
      academyName: json['academyName'],
      vehicleName: json['vehicleName'],
      approvalStatus: json['approvalStatus'],
    );
  }
}
