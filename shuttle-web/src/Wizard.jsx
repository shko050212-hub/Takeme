import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { API_BASE_URL } from './config';

export default function Wizard() {
  const [step, setStep] = useState(1);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [parsedData, setParsedData] = useState([]);
  const [vehicles, setVehicles] = useState([]); // [{id: 1, busNumber: '', driverName: '', driverPhone: '', teacherName: '', teacherPhone: '', capacity: 25}]
  
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);
      
      setParsedData(data);
      
      // Extract unique bus numbers from 등원차량, 하원차량
      const busSet = new Set();
      data.forEach(row => {
        if (row['등원차량']) busSet.add(row['등원차량'].toString().trim());
        if (row['하원차량']) busSet.add(row['하원차량'].toString().trim());
      });
      
      const count = busSet.size > 0 ? busSet.size : 1;
      setVehicleCount(count);
      
      // Initialize dynamic form
      const initialVehicles = Array.from({ length: count }).map((_, i) => ({
        id: i + 1,
        busNumber: Array.from(busSet)[i] || `${i + 1}호차`,
        plateNumber: '',
        driverName: '',
        driverPhone: '',
        teacherName: '',
        teacherPhone: '',
        capacity: 25
      }));
      setVehicles(initialVehicles);
      setStep(2);
    };
    reader.readAsBinaryString(file);
  };

  const handleKoreanOnly = (value) => {
    return value.replace(/[^가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
  };

  const handlePhoneFormat = (value) => {
    const nums = value.replace(/\D/g, '');
    if (nums.length <= 3) return nums;
    if (nums.length <= 7) return `${nums.slice(0, 3)}-${nums.slice(3)}`;
    return `${nums.slice(0, 3)}-${nums.slice(3, 7)}-${nums.slice(7, 11)}`;
  };

  const updateVehicle = (index, field, value) => {
    const newVehicles = [...vehicles];
    if (field === 'driverName' || field === 'teacherName') {
      newVehicles[index][field] = handleKoreanOnly(value);
    } else if (field === 'driverPhone' || field === 'teacherPhone') {
      newVehicles[index][field] = handlePhoneFormat(value);
    } else {
      newVehicles[index][field] = value;
    }
    setVehicles(newVehicles);
  };

  const isFormValid = () => {
    return vehicles.every(v => 
      v.busNumber && v.plateNumber &&
      v.driverName && v.driverPhone.length >= 12 && 
      v.teacherName && v.teacherPhone.length >= 12 &&
      v.capacity > 0
    );
  };

  const submitWizard = async () => {
    if (!isFormValid()) return alert('모든 차량 정보를 올바르게 입력해주세요.');
    
    try {
      const res = await fetch(`${API_BASE_URL}/routing/init-zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicles, parsedData })
      });
      const data = await res.json();
      
      alert('차량 정보 및 기본 구역 데이터가 등록되었습니다!');
      // Pass the generated buses array to the dashboard via state
      navigate('/dashboard', { state: { buses: data } });
    } catch (e) {
      alert('데이터 저장 및 구역 생성에 실패했습니다.');
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        
        {/* Header */}
        <div className="bg-blue-600 px-8 py-6 text-white">
          <h2 className="text-2xl font-bold">초기 배차 환경 설정 (온보딩 위저드)</h2>
          <p className="text-blue-100 mt-1">
            {step === 1 ? '1단계: 전년도 배차 엑셀을 업로드하여 차량 대수를 파악합니다.' : '2단계: 추출된 차량들의 담당자 및 상세 정보를 입력합니다.'}
          </p>
        </div>

        <div className="p-8">
          {step === 1 && (
            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50">
              <div className="text-6xl mb-4">📊</div>
              <h3 className="text-xl font-bold mb-2">전년도 배차참조용 양식 업로드</h3>
              <p className="text-slate-500 mb-6 text-center text-sm">
                파일을 업로드하면 백엔드에서 주소를 분석하고<br/>운행 중인 총 차량 대수를 자동 추출합니다.
              </p>
              
              <button onClick={() => alert('서식 다운로드 기능 연결 예정')} className="mb-4 text-blue-600 hover:underline text-sm font-medium">
                전년도_배차참조용_양식.xlsx 다운로드
              </button>

              <input 
                type="file" 
                accept=".xlsx, .xls" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
              />
              <button 
                onClick={() => fileInputRef.current.click()} 
                className="btn-primary px-8 py-3"
              >
                엑셀 파일 선택 (Drag & Drop 지원예정)
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-blue-50 p-4 rounded-lg border border-blue-100">
                <span className="font-bold text-blue-800">추출된 총 차량 대수: {vehicleCount}대</span>
                <span className="text-sm text-blue-600">이름은 한글만, 전화번호는 자동으로 하이픈이 입력됩니다.</span>
              </div>

              {vehicles.map((v, idx) => (
                <div key={v.id} className="grid grid-cols-7 gap-4 p-4 border border-slate-200 rounded-xl bg-slate-50 relative">
                  <div className="absolute top-0 left-0 bg-slate-800 text-white text-xs font-bold px-3 py-1 rounded-br-lg rounded-tl-xl">
                    {idx + 1}번째 차량
                  </div>
                  
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">배차 명칭</label>
                    <input type="text" className="form-input text-sm" value={v.busNumber} onChange={e=>updateVehicle(idx, 'busNumber', e.target.value)} placeholder="1호차" />
                  </div>
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">차량 번호</label>
                    <input type="text" className="form-input text-sm" value={v.plateNumber} onChange={e=>updateVehicle(idx, 'plateNumber', e.target.value)} placeholder="12가 3456" />
                  </div>
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">기사 이름</label>
                    <input type="text" className="form-input text-sm" value={v.driverName} onChange={e=>updateVehicle(idx, 'driverName', e.target.value)} placeholder="홍길동" />
                  </div>
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">기사 연락처</label>
                    <input type="text" className="form-input text-sm" value={v.driverPhone} onChange={e=>updateVehicle(idx, 'driverPhone', e.target.value)} placeholder="010-0000-0000" maxLength={13} />
                  </div>
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">지도교사 이름</label>
                    <input type="text" className="form-input text-sm" value={v.teacherName} onChange={e=>updateVehicle(idx, 'teacherName', e.target.value)} placeholder="이순신" />
                  </div>
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">교사 연락처</label>
                    <input type="text" className="form-input text-sm" value={v.teacherPhone} onChange={e=>updateVehicle(idx, 'teacherPhone', e.target.value)} placeholder="010-0000-0000" maxLength={13} />
                  </div>
                  <div className="col-span-1 mt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-1">탑승 인원</label>
                    <input type="number" className="form-input text-sm" value={v.capacity} onChange={e=>updateVehicle(idx, 'capacity', e.target.value)} min={1} />
                  </div>
                </div>
              ))}

              <div className="flex justify-end pt-4">
                <button 
                  onClick={submitWizard} 
                  disabled={!isFormValid()}
                  className="btn-primary px-8 py-3"
                >
                  메인 화면으로 이동
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
