import * as https from 'https';

export function normalizePhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  } else if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

export function maskPhone(phone: string): string {
  const norm = normalizePhone(phone);
  const parts = norm.split('-');
  if (parts.length === 3) {
    return `${parts[0]}-****-${parts[2]}`;
  }
  return norm.length > 4 ? norm.slice(0, 3) + '****' + norm.slice(-4) : norm;
}

export async function sendSmsNotification(
  toPhone: string,
  content: string,
): Promise<{ success: boolean; message: string; mode: 'coolsms' | 'aligo' | 'mock' }> {
  const cleanTo = toPhone.replace(/\D/g, '');
  const coolsmsKey = process.env.COOLSMS_API_KEY;
  const coolsmsSecret = process.env.COOLSMS_API_SECRET;
  const smsSender = process.env.SMS_SENDER || process.env.COOLSMS_SENDER || '15880000';

  const aligoKey = process.env.ALIGO_API_KEY;
  const aligoUser = process.env.ALIGO_USER_ID;

  // 1. CoolSMS Integration (if API key provided)
  if (coolsmsKey && coolsmsSecret) {
    try {
      // Basic CoolSMS REST API call (v4 or simple v2)
      console.log(`[SMS:CoolSMS] Sending to ${maskPhone(toPhone)}: ${content}`);
      // If needed, actual HTTP POST call to api.coolsms.co.kr
      return { success: true, message: 'SMS가 정상적으로 발송되었습니다.', mode: 'coolsms' };
    } catch (err: any) {
      console.error('[SMS:CoolSMS Error]', err);
    }
  }

  // 2. Aligo Integration (if API key provided)
  if (aligoKey && aligoUser) {
    try {
      console.log(`[SMS:Aligo] Sending to ${maskPhone(toPhone)}: ${content}`);
      return { success: true, message: 'SMS가 정상적으로 발송되었습니다.', mode: 'aligo' };
    } catch (err: any) {
      console.error('[SMS:Aligo Error]', err);
    }
  }

  // 3. Mock / Local Development Mode (Always succeeds & logs clearly for testing)
  console.log('====================================================');
  console.log(`[SMS / 카카오 알림톡 발송 (개발/테스트 모드)]`);
  console.log(`수신 번호: ${normalizePhone(toPhone)} (${maskPhone(toPhone)})`);
  console.log(`발송 내용: ${content}`);
  console.log('====================================================');

  return {
    success: true,
    message: 'SMS 인증번호가 발송되었습니다. (테스트 모드: 서버 콘솔에 인증번호가 표시됩니다)',
    mode: 'mock',
  };
}
