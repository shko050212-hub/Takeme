import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, StyleSheet, Alert, Platform } from 'react-native';

const API_HOST = Platform.OS === 'web' ? 'http://localhost:3000' : process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000';

export default function AbsenceModal({ visible, onClose, email }) {
  const [overrideType, setOverrideType] = useState('ABSENCE');
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // For Message Type
  const [targetRoles, setTargetRoles] = useState([]);

  // Default to tomorrow
  const getTomorrowString = () => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split('T')[0];
  };

  const [targetDate, setTargetDate] = useState(getTomorrowString());

  const showAlert = (title, message) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const handleSubmit = async () => {
    if (overrideType !== 'MESSAGE') {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(targetDate)) {
        return showAlert('오류', '날짜는 YYYY-MM-DD 형식으로 입력해주세요. (예: 2026-08-01)');
      }
    }

    if (overrideType === 'ABSENCE' && !reason.trim()) {
      return showAlert('오류', '결석 사유를 입력해주세요.');
    }
    if (overrideType === 'CHANGE_LOCATION' && !reason.trim()) {
      return showAlert('오류', '정확한 도로명 주소를 입력해주세요.');
    }
    if (overrideType === 'MESSAGE') {
      if (targetRoles.length === 0) return showAlert('오류', '수신 대상을 선택해주세요.');
      if (!reason.trim()) return showAlert('오류', '메시지 내용을 입력해주세요.');
    }

    setIsLoading(true);
    try {
      let url = `${API_HOST}/parent/override`;
      let payload = { email, targetDate, overrideType, reason };

      if (overrideType === 'MESSAGE') {
        url = `${API_HOST}/parent/message`;
        payload = { email, targetRoles, message: reason };
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (res.ok) {
        showAlert('성공', '신청이 정상적으로 접수되었습니다.');
        onClose();
        setReason(''); // Reset
      } else {
        showAlert('신청 실패', data.message || '오류가 발생했습니다.');
      }
    } catch (err) {
      showAlert('오류', '서버 통신에 실패했습니다.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent={true} animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>결석 / 변경 신청</Text>
          <Text style={styles.modalSubtitle}>언제든지 자유롭게 신청하실 수 있습니다.</Text>
          
          {overrideType !== 'MESSAGE' && (
            <>
              <Text style={styles.label}>적용 날짜</Text>
              <TextInput 
                style={styles.input} 
                value={targetDate} 
                onChangeText={setTargetDate} 
                placeholder="YYYY-MM-DD (예: 2026-08-01)" 
                keyboardType="numbers-and-punctuation"
              />
            </>
          )}

          <Text style={styles.label}>신청 유형</Text>
          <View style={styles.row}>
            <TouchableOpacity 
              style={[styles.typeBtn, overrideType === 'ABSENCE' && styles.activeTypeBtn]}
              onPress={() => setOverrideType('ABSENCE')}
            >
              <Text style={[styles.typeBtnText, overrideType === 'ABSENCE' && styles.activeTypeBtnText]}>결석</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeBtn, overrideType === 'CHANGE_LOCATION' && styles.activeTypeBtn]}
              onPress={() => setOverrideType('CHANGE_LOCATION')}
            >
              <Text style={[styles.typeBtnText, overrideType === 'CHANGE_LOCATION' && styles.activeTypeBtnText]}>탑승지 변경</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeBtn, overrideType === 'MESSAGE' && styles.activeTypeBtn]}
              onPress={() => setOverrideType('MESSAGE')}
            >
              <Text style={[styles.typeBtnText, overrideType === 'MESSAGE' && styles.activeTypeBtnText]}>기타(메시지)</Text>
            </TouchableOpacity>
          </View>

          {overrideType === 'MESSAGE' && (
            <View style={{ marginBottom: 15 }}>
              <Text style={styles.label}>수신 대상 (다중 선택 가능)</Text>
              <View style={styles.checkboxRow}>
                {['ACADEMY_ADMIN', 'DRIVER', 'TEACHER'].map(role => {
                  const isChecked = targetRoles.includes(role);
                  const label = role === 'ACADEMY_ADMIN' ? '학원장' : role === 'DRIVER' ? '해당 노선 기사님' : '해당 노선 지도교사님';
                  return (
                    <TouchableOpacity 
                      key={role}
                      style={[styles.checkbox, isChecked && styles.checkboxActive]}
                      onPress={() => {
                        if (isChecked) setTargetRoles(targetRoles.filter(r => r !== role));
                        else setTargetRoles([...targetRoles, role]);
                      }}
                    >
                      <Text style={[styles.checkboxText, isChecked && styles.checkboxTextActive]}>{label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <Text style={styles.label}>
            {overrideType === 'ABSENCE' ? '상세 사유' : overrideType === 'CHANGE_LOCATION' ? '정확한 도로명/지번 주소' : '메시지 내용'}
          </Text>
          <TextInput 
            style={[styles.input, (overrideType === 'ABSENCE' || overrideType === 'MESSAGE') && styles.textArea]} 
            placeholder={overrideType === 'ABSENCE' ? "결석 사유를 적어주세요" : overrideType === 'CHANGE_LOCATION' ? "예: 마곡중앙로 33" : "메시지를 적어주세요"}
            multiline={overrideType === 'ABSENCE' || overrideType === 'MESSAGE'}
            value={reason}
            onChangeText={setReason}
          />

          {overrideType === 'CHANGE_LOCATION' && (
            <Text style={styles.helpText}>
              * 입력하신 주소를 바탕으로 배차 구역을 자동 판별하여 해당 노선으로 임시 배정됩니다.
            </Text>
          )}

          <View style={styles.buttonRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={isLoading}>
              <Text style={styles.cancelBtnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={isLoading}>
              <Text style={styles.submitBtnText}>{isLoading ? '신청 중...' : '신청하기'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: 400,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#ef4444',
    marginBottom: 20,
    fontWeight: '600'
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  typeBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    backgroundColor: '#f8fafc'
  },
  activeTypeBtn: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  typeBtnText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: 'bold',
  },
  activeTypeBtnText: {
    color: '#2563eb',
  },
  checkboxRow: {
    flexDirection: 'column',
    gap: 8,
  },
  checkbox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#f8fafc',
  },
  checkboxActive: {
    borderColor: '#3b82f6',
    backgroundColor: '#eff6ff',
  },
  checkboxText: {
    color: '#64748b',
    fontSize: 14,
  },
  checkboxTextActive: {
    color: '#2563eb',
    fontWeight: 'bold',
  },
  helpText: {
    fontSize: 13,
    color: '#3b82f6',
    marginTop: 8,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 32,
  },
  cancelBtn: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#64748b',
  },
  submitBtn: {
    flex: 2,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
  }
});
