import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Trash2 } from 'lucide-react-native';

const API_HOST = process.env.EXPO_PUBLIC_API_URL || 'http://52.63.245.203:3000';

export default function SettingsScreen() {
  const router = useRouter();
  const { email } = useLocalSearchParams();
  const [isDeleting, setIsDeleting] = useState(false);

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
          router.replace('/');
        } else {
          Alert.alert('탈퇴 완료', '회원 탈퇴가 정상적으로 처리되었습니다.', [
            { text: '확인', onPress: () => router.replace('/') }
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
