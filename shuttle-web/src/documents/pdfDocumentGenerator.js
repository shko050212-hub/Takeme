// Database-Integrated Clean PDF Print & Download Utility for Takeme Legal Documents

export function openPrintDocument(type, data = {}) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const autoDateKorean = `${year}년 ${month}월 ${day}일`;
  const academyName = data.academyName || 'Takeme 협력학원';

  const bus = data.selectedBus || null;
  const busStudents = data.busStudents || [];
  const student = data.selectedStudent || null;

  let title = '';
  let bodyHtml = '';

  if (type === 'safety') {
    const busNameText = bus ? `${bus.name || bus.busNumber || ''} ` : '';
    title = `어린이통학버스_${busNameText}일일안전점검표`;
    const plateText = bus ? (bus.plateNumber || `${bus.name} 전용차량`) : '';
    const driverText = bus ? (bus.driverName && bus.driverName !== '미정' ? `${bus.driverName} (인)` : '__________________ (인)') : '__________________ (인)';
    const companionText = bus ? (bus.teacherName && bus.teacherName !== '미정' ? `${bus.teacherName} (인)` : '__________________ (인)') : '__________________ (인)';

    bodyHtml = `
      <div class="doc-container">
        <div class="header-section">
          <div class="title-wrap">
            <h1>어린이통학버스 일일 안전점검표</h1>
            <p class="sub-text">도로교통법 제53조 및 어린이안전관리에 관한 법률 준수 표준서식 ${bus ? `[${bus.name}]` : ''}</p>
          </div>
          <table class="approval-table">
            <tr>
              <th rowspan="2" class="v-header">결<br>재</th>
              <th>점검자</th>
              <th>안전책임자</th>
              <th>원 장</th>
            </tr>
            <tr>
              <td class="sign-box"></td>
              <td class="sign-box"></td>
              <td class="sign-box"></td>
            </tr>
          </table>
        </div>

        <table class="info-table">
          <tr>
            <th style="width: 15%;">점검일자</th>
            <td style="width: 35%; font-weight: bold; color: #1e293b;">${autoDateKorean}</td>
            <th style="width: 15%;">학 원 명</th>
            <td style="width: 35%; font-weight: bold;">${academyName}</td>
          </tr>
          <tr>
            <th>호차 / 차량번호</th>
            <td style="font-weight: bold; color: #2563eb;">${bus ? `${bus.name} (${plateText})` : ''}</td>
            <th>운전자 / 동승자</th>
            <td>${driverText} &nbsp;/&nbsp; ${companionText}</td>
          </tr>
        </table>

        <table class="check-table">
          <thead>
            <tr>
              <th style="width: 7%;">번호</th>
              <th style="width: 25%;">점검 항목</th>
              <th style="width: 44%;">점검 기준 및 법정 요건</th>
              <th style="width: 24%;">점검 결과</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="center">1</td>
              <td class="bold">어린이 하차확인장치</td>
              <td>운행 종료 후 3분 내 확인벨 작동 및 경고음 상태</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">2</td>
              <td class="bold">전 좌석 어린이 안전띠</td>
              <td>안전띠 체결 및 길이 조절 장치 정상 작동 여부</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">3</td>
              <td class="bold">정지표시장치(스톱봉)</td>
              <td>승하차문 연동 개폐 및 표시등 정상 점등 여부</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">4</td>
              <td class="bold">광각 실외후사경/후방카메라</td>
              <td>차량 후방 및 양측 사각지대 확인 장치 정상 여부</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">5</td>
              <td class="bold">차량용 소화기 비치</td>
              <td>운전석 인근 규격 소화기 압력 게이지 정상 여부</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">6</td>
              <td class="bold">비상탈출용 비상망치</td>
              <td>차량 내 규격 비상망치 2개 이상 구비 및 상태</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">7</td>
              <td class="bold">응급 구급상자 구비</td>
              <td>소독약, 붕대, 거즈, 반창고 등 유효기간 및 보관</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">8</td>
              <td class="bold">타이어 및 브레이크</td>
              <td>공기압, 마모도, 제동장치 및 등화장치 정상 작동</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
            <tr>
              <td class="center">9</td>
              <td class="bold">차량 내·외부 청결 및 환기</td>
              <td>좌석 소독, 쓰레기 방치 여부 및 손잡이 청결</td>
              <td class="center font-check">[ &nbsp;&nbsp; ] 양호 &nbsp;&nbsp;&nbsp;&nbsp; [ &nbsp;&nbsp; ] 불량</td>
            </tr>
          </tbody>
        </table>

        <table class="notes-table">
          <tr>
            <th style="width: 15%;">특이사항<br>및 조치내용</th>
            <td style="height: 80px; vertical-align: top; padding: 8px;"></td>
          </tr>
        </table>

        <div class="footer-sign">
          위와 같이 통학버스 일일 안전점검을 성실히 실시하였음을 확인합니다.<br>
          <div class="date-line">${autoDateKorean}</div>
          <div class="sign-names">
            점검자(운전자): __________________ (인) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 동승보호자: __________________ (인)
          </div>
        </div>
      </div>
    `;
  } else if (type === 'companion') {
    const busNameText = bus ? `${bus.name || bus.busNumber || ''} ` : '';
    title = `동승보호자_${busNameText}탑승일지_및_승하차명부`;

    const plateText = bus ? (bus.plateNumber || `${bus.name} 차량`) : '';
    const companionText = bus ? (bus.teacherName && bus.teacherName !== '미정' ? `${bus.teacherName} (인)` : '__________________ (인)') : '__________________ (인)';
    const driverText = bus ? (bus.driverName && bus.driverName !== '미정' ? `${bus.driverName} (인)` : '__________________ (인)') : '__________________ (인)';
    const studentCount = busStudents.length;

    // Student roster rows
    let rosterRowsHtml = '';
    if (busStudents.length > 0) {
      rosterRowsHtml = busStudents.map((st, idx) => {
        const raw = st.raw || {};
        const schoolGrade = raw['학교명'] && raw['학년'] ? `${raw['학교명']} ${raw['학년']}` : (st.grade || '-');
        const phone = raw['보호자연락처'] || st.parentPhone || '-';
        const location = raw['비고'] || st.boardingLocation || st.address || '-';
        const cleanLocation = location.replace(/\[등\/하차 지점 상세\]:\s*/, '');

        return `
          <tr>
            <td class="center">${idx + 1}</td>
            <td class="center bold" style="font-size: 11px;">${st.name || st.realName}</td>
            <td class="center" style="font-size: 10px; color: #475569;">${schoolGrade}</td>
            <td style="font-size: 10px; color: #1e293b;" title="${cleanLocation}">${cleanLocation}</td>
            <td class="center" style="font-size: 10px; font-family: monospace;">${phone}</td>
            <td class="center font-check">[ &nbsp;&nbsp; ]</td>
            <td class="center font-check">[ &nbsp;&nbsp; ]</td>
          </tr>
        `;
      }).join('');
    } else {
      rosterRowsHtml = `
        <tr>
          <td colspan="7" class="center" style="padding: 12px; color: #94a3b8; font-size: 11px;">
            배정된 원생 정보가 없습니다. (수기로 작성 가능)
          </td>
        </tr>
      `;
    }

    bodyHtml = `
      <div class="doc-container">
        <div class="header-section">
          <div class="title-wrap">
            <h1>동승보호자 탑승일지 및 안전확인서</h1>
            <p class="sub-text">어린이통학버스 안전관리 법정 동승기록부 ${bus ? `[${bus.name} 배정원생 총 ${studentCount}명 연동]` : ''}</p>
          </div>
          <table class="approval-table">
            <tr>
              <th rowspan="2" class="v-header">결<br>재</th>
              <th>담 당</th>
              <th>원 장</th>
            </tr>
            <tr>
              <td class="sign-box"></td>
              <td class="sign-box"></td>
            </tr>
          </table>
        </div>

        <table class="info-table">
          <tr>
            <th style="width: 15%;">운행일자</th>
            <td style="width: 35%; font-weight: bold; color: #1e293b;">${autoDateKorean}</td>
            <th style="width: 15%;">학 원 명</th>
            <td style="width: 35%; font-weight: bold;">${academyName}</td>
          </tr>
          <tr>
            <th>호차 / 차량번호</th>
            <td style="font-weight: bold; color: #2563eb;">${bus ? `${bus.name} (${plateText})` : ''}</td>
            <th>동승보호자 / 기사</th>
            <td>${companionText} &nbsp;/&nbsp; ${driverText}</td>
          </tr>
        </table>

        <!-- Section: Student Boarding Roster -->
        <div style="margin-top: 15px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end;">
          <h2 style="font-size: 13px; font-weight: 800; color: #0f172a; margin: 0; display: flex; items-center gap: 4px;">
            ${bus ? `[${bus.name}]` : ''} 탑승 원생 명단 및 승하차 안전 확인부
          </h2>
          <span style="font-size: 11px; color: #2563eb; font-weight: bold;">
            배정 원생: ${studentCount}명
          </span>
        </div>

        <table class="check-table" style="margin-bottom: 15px;">
          <thead>
            <tr>
              <th style="width: 6%;">번호</th>
              <th style="width: 15%;">원생명</th>
              <th style="width: 18%;">학교 / 학년</th>
              <th style="width: 33%;">탑승지 (등/하차 지점)</th>
              <th style="width: 16%;">보호자 연락처</th>
              <th style="width: 6%;">승차</th>
              <th style="width: 6%;">하차</th>
            </tr>
          </thead>
          <tbody>
            ${rosterRowsHtml}
          </tbody>
        </table>

        <!-- Summary & Checklist for the day -->
        <table class="info-table" style="margin-bottom: 12px;">
          <tr>
            <th style="width: 25%;">전원 안전띠 착용 여부</th>
            <td style="width: 25%;" class="center font-check">[ &nbsp;&nbsp; ] 전원 확인완료</td>
            <th style="width: 25%;">차량 잔류 원생 확인</th>
            <td style="width: 25%;" class="center font-check">[ &nbsp;&nbsp; ] 잔류원생 없음</td>
          </tr>
        </table>

        <table class="notes-table">
          <tr>
            <th style="width: 15%;">운행 중 특이사항<br>및 전달사항</th>
            <td style="height: 60px; vertical-align: top; padding: 6px;"></td>
          </tr>
        </table>

        <div class="footer-sign" style="margin-top: 20px;">
          상기 차량에 동승하여 배정 어린이의 승하차 안전 및 전원 안전띠 착용 여부를 철저히 확인하였습니다.<br>
          <div class="date-line">${autoDateKorean}</div>
          <div class="sign-names">
            동승보호자: __________________ (인) &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; 운전자: __________________ (인)
          </div>
        </div>
      </div>
    `;
  } else {
    // Student Bus Application & Consent Form
    const stName = student ? (student.name || student.realName || '') : '';
    const raw = student ? (student.raw || {}) : {};
    const parentName = raw['보호자 성함'] || student?.parentName || '';
    const parentPhone = raw['보호자연락처'] || student?.parentPhone || '';
    const address = raw['주소'] || student?.address || '';
    const schoolGrade = raw['학교명'] && raw['학년'] ? `${raw['학교명']} ${raw['학년']}` : (student?.grade || '');
    const assignedBusName = raw['등원차량'] || student?.assignedVehicle?.name || (data.selectedBus?.name || '');

    title = `통학차량이용신청서_${stName || '원생'}`;
    bodyHtml = `
      <div class="doc-container">
        <div class="header-section">
          <div class="title-wrap" style="width: 100%; text-align: center;">
            <h1 style="font-size: 22px;">어린이 통학차량 이용 신청 및 안전동의서</h1>
            <p class="sub-text">${academyName ? `${academyName} 귀중` : '학원장 귀중'}</p>
          </div>
        </div>

        <table class="info-table" style="margin-top: 20px;">
          <tr>
            <th style="width: 18%;">원 생 명</th>
            <td style="width: 32%; font-weight: bold; font-size: 13px; color: #1e293b;">${stName}</td>
            <th style="width: 18%;">학교 / 학년</th>
            <td style="width: 32%; font-weight: bold;">${schoolGrade}</td>
          </tr>
          <tr>
            <th>보호자 성명</th>
            <td style="font-weight: bold;">${parentName}</td>
            <th>보호자 연락처</th>
            <td style="font-weight: bold; font-family: monospace;">${parentPhone}</td>
          </tr>
          <tr>
            <th>배정 희망 차량</th>
            <td style="font-weight: bold; color: #2563eb;">${assignedBusName || '학원 배차 규정에 따름'}</td>
            <th>탑승지 (주소)</th>
            <td style="font-size: 11px;">${address}</td>
          </tr>
        </table>

        <div style="margin: 25px 0; padding: 18px; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 6px;">
          <h3 style="font-size: 13px; font-weight: bold; margin-bottom: 10px; color: #1e293b;">[통학차량 안전수칙 준수 서약]</h3>
          <ol style="font-size: 11px; line-height: 2.0; color: #334155; padding-left: 20px; margin: 0;">
            <li>원생은 차량 탑승 즉시 좌석 안전띠를 반드시 착용하고, 차량이 완전히 멈출 때까지 절대 풀지 않습니다.</li>
            <li>차량 운행 중에는 창밖으로 손이나 머리를 내밀지 않으며, 자리에서 일어나거나 장난을 치지 않습니다.</li>
            <li>승·하차 시에는 동승보호자의 안내에 따라 차례대로 손잡이를 잡고 안전하게 승·하차합니다.</li>
            <li>지정된 탑승 시간 3분 전까지 정류장에 도착하여 대기하도록 지도하겠습니다.</li>
            <li>원생의 건강 이상이나 결석 발생 시 학원 및 담당 기사님께 사전에 미리 통보하겠습니다.</li>
          </ol>
        </div>

        <div class="footer-sign" style="margin-top: 50px;">
          본인은 상기 안전수칙을 충분히 숙지하였으며, 자녀의 안전한 통학차량 이용을 위해 적극 협조할 것에 동의합니다.<br><br>
          <div class="date-line">${autoDateKorean}</div>
          <div class="sign-names" style="margin-top: 35px;">
            보호자 성명: <span style="font-weight: bold; text-decoration: underline;">&nbsp;&nbsp;${parentName || '__________________'} &nbsp;&nbsp;</span> (자필 서명)
          </div>
        </div>
      </div>
    `;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('팝업 차단이 감지되었습니다. 브라우저 설정에서 팝업을 허용해주세요.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 12mm 15mm 12mm 15mm;
        }
        * {
          box-sizing: border-box;
          font-family: 'Pretendard', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
        }
        body {
          margin: 0;
          padding: 20px;
          color: #111827;
          background: #f1f5f9;
        }
        .doc-container {
          max-width: 210mm;
          margin: 0 auto;
          background: #ffffff;
          padding: 25px 30px;
          border-radius: 4px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .header-section {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 16px;
          border-bottom: 2px solid #0f172a;
          padding-bottom: 10px;
        }
        .title-wrap h1 {
          font-size: 19px;
          margin: 0 0 4px 0;
          font-weight: 900;
          letter-spacing: -0.5px;
          color: #0f172a;
        }
        .sub-text {
          font-size: 11px;
          color: #64748b;
          margin: 0;
        }
        .approval-table {
          border-collapse: collapse;
          font-size: 10px;
        }
        .approval-table th, .approval-table td {
          border: 1px solid #334155;
          text-align: center;
          padding: 3px 6px;
        }
        .approval-table th {
          background: #f8fafc;
          font-weight: 600;
        }
        .v-header {
          width: 20px;
          background: #f1f5f9 !important;
        }
        .sign-box {
          height: 44px;
          width: 55px;
        }
        .info-table, .check-table, .notes-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
          font-size: 11px;
        }
        .info-table th, .info-table td,
        .check-table th, .check-table td,
        .notes-table th, .notes-table td {
          border: 1px solid #cbd5e1;
          padding: 6px 8px;
        }
        .info-table th, .check-table th, .notes-table th {
          background: #f8fafc;
          color: #1e293b;
          font-weight: 700;
          text-align: center;
        }
        .center {
          text-align: center;
        }
        .bold {
          font-weight: 600;
        }
        .font-check {
          font-weight: 600;
          color: #334155;
          letter-spacing: 0.5px;
        }
        .footer-sign {
          margin-top: 25px;
          text-align: center;
          font-size: 12px;
          line-height: 1.8;
          color: #1e293b;
        }
        .date-line {
          font-weight: 700;
          margin: 10px 0;
          font-size: 13px;
        }
        .sign-names {
          font-size: 12px;
          font-weight: 600;
          margin-top: 12px;
        }
        .print-btn-bar {
          text-align: center;
          padding: 14px;
          background: #2563eb;
          color: white;
          font-weight: bold;
          font-size: 14px;
          margin-bottom: 20px;
          border-radius: 8px;
          cursor: pointer;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .print-btn-bar:hover {
          background: #1d4ed8;
        }
        @media print {
          body {
            background: #ffffff;
            padding: 0;
          }
          .doc-container {
            box-shadow: none;
            padding: 0;
            width: 100%;
          }
          .print-btn-bar {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="print-btn-bar" onclick="window.print()">
        [PDF로 저장 또는 인쇄하기] 클릭 (여기를 누르면 즉시 인쇄/PDF 저장 창이 열립니다)
      </div>
      ${bodyHtml}
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
          }, 300);
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();
}
