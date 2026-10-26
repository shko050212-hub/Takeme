import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { API_HOST, setAccessToken, authFetch } from '../lib/api';
import { ChevronLeft, Trash2 } from 'lucide-react-native';


export default function SettingsScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const [isDeleting, setIsDeleting] = useState(false);
  const [childInfo, setChildInfo] = useState<any>(null);
  const [allergies, setAllergies] = useState('');
  const [isSavingAllergy, setIsSavingAllergy] = useState(false);

  useEffect(() => {
    if (email) {
      fetchChildInfo();
    }
  }, [email]);

  const fetchChildInfo = async () => {
    try {
      const res = await authFetch(`${API_HOST}/parent/my-child?email=${email}`);
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setChildInfo(data);
          setAllergies(data.allergies || '');
        }
      }
    } catch (e) {
      console.log('Failed to fetch child info in settings', e);
    }
  };

  const handleSaveAllergy = async () => {
    setIsSavingAllergy(true);
    try {
      const res = await authFetch(`${API_HOST}/parent/my-child/allergies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, allergies: allergies.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setChildInfo((prev: any) => prev ? { ...prev, allergies: allergies.trim() } : prev);
        if (Platform.OS === 'web') window.alert('알레르기 정보가 수정되었습니다.');
        else Alert.alert('완료', '알레르기 정보가 수정되었습니다.');
      } else {
        const msg = data.message || '저장에 실패했습니다.';
        if (Platform.OS === 'web') window.alert(msg);
        else Alert.alert('오류', msg);
      }
    } catch (e) {
      if (Platform.OS === 'web') window.alert('서버 통신에 실패했습니다.');
      else Alert.alert('오류', '서버 통신에 실패했습니다.');
    } finally {
      setIsSavingAllergy(false);
    }
  };

  const handleDeleteAccount = () => {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm('정말로 회원 탈퇴하시겠습니까? 모든 정보가 즉시 삭제되며 복구할 수 없습니다.');
      if (confirmed) {
        executeDelete();
      }
    } else {
      Alert.alert(
        '회원 탈퇴',
        '정말로 회원 탈퇴하시겠습니까? 모든 정보가 즉시 삭제되며 복구할 수 없습니다.',
        [
          { text: '취소', style: 'cancel' },
          { 
            text: '탈퇴하기', 
            style: 'destructive',
            onPress: executeDelete
          }
        ]
      );
    }
  };

  const executeDelete = async () => {
    if (!email) {
      if (Platform.OS === 'web') window.alert('계정 정보를 찾을 수 없습니다.');
      else Alert.alert('오류', '계정 정보를 찾을 수 없습니다.');
      return;
    }
    
    setIsDeleting(true);
    try {
      const res = await fetch(`${API_HOST}/auth/account?email=${email}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await res.json();
      if (res.ok) {
        if (Platform.OS === 'web') {
          window.alert('회원 탈퇴가 정상적으로 처리되었습니다.');
          { setAccessToken(null); router.replace('/'); }
        } else {
          Alert.alert('탈퇴 완료', '회원 탈퇴가 정상적으로 처리되었습니다.', [
            { text: '확인', onPress: () => { setAccessToken(null); router.replace('/'); } }
          ]);
        }
      } else {
        if (Platform.OS === 'web') window.alert(data.message || '탈퇴 처리에 실패했습니다.');
        else Alert.alert('오류', data.message || '탈퇴 처리에 실패했습니다.');
      }
    } catch (e) {
      console.error(e);
      if (Platform.OS === 'web') window.alert('서버 통신에 실패했습니다.');
      else Alert.alert('오류', '서버 통신에 실패했습니다.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <ChevronLeft size={24} color="#64748b" />
          <Text style={styles.backButtonText}>뒤로</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>환경설정</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.content}>
        {childInfo && (
          <View style={{ marginBottom: 28 }}>
            <Text style={styles.sectionTitle}>자녀(원아) 정보 및 알레르기 설정</Text>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>원아 성명</Text>
                <Text style={styles.infoValue}>{childInfo.name} ({childInfo.className || '반 미배정'})</Text>
              </View>
              <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 10 }]}>
                <Text style={styles.infoLabel}>소속 유치원</Text>
                <Text style={styles.infoValue}>{childInfo.academyName || '소속 원'}</Text>
              </View>
              <View style={[styles.infoRow, { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10, marginTop: 10 }]}>
                <Text style={styles.infoLabel}>배정 통학차량</Text>
                <Text style={styles.infoValue}>{childInfo.vehicleName || '배정 대기'}</Text>
              </View>
              <View style={{ borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 12, marginTop: 10 }}>
                <Text style={[styles.infoLabel, { marginBottom: 6 }]}>알레르기 정보 (식품/약품 주의사항)</Text>
                <TextInput
                  style={styles.allergyInput}
                  value={allergies}
                  onChangeText={setAllergies}
                  placeholder="예: 땅콩, 복숭아, 유제품 알레르기 주의"
                  placeholderTextColor="#94a3b8"
                />
                <TouchableOpacity
                  style={styles.allergySaveBtn}
                  onPress={handleSaveAllergy}
                  disabled={isSavingAllergy}
                >
                  {isSavingAllergy ? (
                    <ActivityIndicator color="white" size="small" />
                  ) : (
                    <Text style={styles.allergySaveBtnText}>알레르기 저장</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        <Text style={styles.sectionTitle}>계정 관리</Text>
        
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>로그인 이메일</Text>
            <Text style={styles.infoValue}>{email || '알 수 없음'}</Text>
          </View>
        </View>

        <TouchableOpacity 
          style={styles.deleteButton} 
          onPress={handleDeleteAccount}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <ActivityIndicator color="#ef4444" />
          ) : (
            <>
              <Trash2 size={20} color="#ef4444" />
              <Text style={styles.deleteButtonText}>회원 탈퇴 (모든 정보 삭제)</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: -8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#64748b',
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1e293b',
  },
  content: {
    padding: 20,
  },
  allergyInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#1e293b',
    marginBottom: 10,
  },
  allergySaveBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  allergySaveBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: 12,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 16,
    color: '#475569',
    fontWeight: '500',
  },
  infoValue: {
    fontSize: 16,
    color: '#1e293b',
    fontWeight: '700',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fee2e2',
    paddingVertical: 16,
    borderRadius: 12,
    gap: 8,
  },
  deleteButtonText: {
    color: '#ef4444',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
