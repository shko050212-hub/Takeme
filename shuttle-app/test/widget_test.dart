import 'package:flutter_test/flutter_test.dart';
import 'package:shuttle_app/main.dart';

void main() {
  testWidgets('TakeMeApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const TakeMeApp());
    expect(find.byType(TakeMeApp), findsOneWidget);
  });
}
