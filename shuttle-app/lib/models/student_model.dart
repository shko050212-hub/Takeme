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
  final bool droppedOff;
  final bool handoverFailed;
  final String boardStatus;
  final String expectedTime;
  final String? actualBoardTime;
  final String? actualDropTime;
  final String? teacherMemo;
  final String? parentMessage;
  final int runNumber;
  final int? stopOrder;
  final bool isOverride;
  final String? className;
  final String? academyName;
  final String? vehicleName;
  final String? approvalStatus;
  final String? parentPhone;
  final String? parentName;

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
    this.droppedOff = false,
    this.handoverFailed = false,
    this.boardStatus = 'WAITING',
    this.expectedTime = '15:30',
    this.actualBoardTime,
    this.actualDropTime,
    this.teacherMemo,
    this.parentMessage,
    this.runNumber = 1,
    this.stopOrder,
    this.isOverride = false,
    this.className,
    this.academyName,
    this.vehicleName,
    this.approvalStatus,
    this.parentPhone,
    this.parentName,
  });

  bool get isWaiting => boardStatus == 'WAITING';
  bool get isBoarded => boardStatus == 'BOARDED';
  bool get isAbsent => boardStatus == 'ABSENT';
  bool get isDroppedOff => boardStatus == 'DROPPED_OFF';
  bool get isHandoverFailed => boardStatus == 'HANDOVER_FAILED';

  factory StudentModel.fromJson(Map<String, dynamic> json) {
    double? parseCoord(dynamic val) {
      if (val == null) return null;
      if (val is num) return val.toDouble();
      return double.tryParse(val.toString());
    }

    final rawStatus = (json['boardStatus'] ?? (json['boarded'] == true ? 'BOARDED' : (json['absent'] == true ? 'ABSENT' : 'WAITING'))).toString();

    return StudentModel(
      id: json['id'] is int ? json['id'] : (int.tryParse(json['id']?.toString() ?? '0') ?? 0),
      name: json['name'] ?? '',
      realName: json['realName'],
      address: json['address'] ?? '',
      boardingLocation: json['boardingLocation'],
      latitude: parseCoord(json['latitude'] ?? json['lat']),
      longitude: parseCoord(json['longitude'] ?? json['lng']),
      allergies: json['allergies'] ?? '',
      boarded: rawStatus == 'BOARDED' || json['boarded'] == true,
      absent: rawStatus == 'ABSENT' || json['absent'] == true,
      droppedOff: rawStatus == 'DROPPED_OFF' || json['droppedOff'] == true,
      handoverFailed: rawStatus == 'HANDOVER_FAILED' || json['handoverFailed'] == true,
      boardStatus: rawStatus,
      expectedTime: json['expectedTime'] ?? '15:30',
      actualBoardTime: json['actualBoardTime']?.toString(),
      actualDropTime: json['actualDropTime']?.toString(),
      teacherMemo: json['teacherMemo'],
      parentMessage: json['parentMessage'],
      runNumber: json['runNumber'] is int ? json['runNumber'] : (int.tryParse(json['runNumber']?.toString() ?? '1') ?? 1),
      stopOrder: json['stopOrder'] != null ? int.tryParse(json['stopOrder'].toString()) : null,
      isOverride: json['isOverride'] == true,
      className: json['className'],
      academyName: json['academyName'],
      vehicleName: json['vehicleName'],
      approvalStatus: json['approvalStatus'],
      parentPhone: json['parentPhone']?.toString(),
      parentName: json['parentName']?.toString(),
    );
  }
}
