import { User } from '../entities/user.entity';

export function isNotificationEnabled(
  user: User | null | undefined,
  type: 'change_request' | 'chat' | 'notice' | 'escort' | 'shuttle' | 'board' | 'post'
): boolean {
  if (!user) return true;
  const settings = user.notificationSettings;
  if (!settings) {
    if (type === 'shuttle' && user.notifyShuttleOperation === false) return false;
    if (type === 'notice' && (user.notifyNotice === false || user.notifyBoardPost === false)) return false;
    if ((type === 'post' || type === 'board') && (user.notifyPost === false || user.notifyBoardPost === false)) return false;
    return true;
  }

  // Master switch
  if (settings.all === false) return false;

  // Specific switch
  if (settings[type] === false) return false;

  // Compatibility checks
  if (type === 'shuttle' && (settings.notifyShuttleOperation === false || user.notifyShuttleOperation === false)) return false;
  if (type === 'notice') {
    if (settings.notifyNotice === false || user.notifyNotice === false) return false;
    if (settings.notice === false) return false;
    if (settings.notifyBoardPost === false || user.notifyBoardPost === false) return false;
  }
  if (type === 'post' || type === 'board') {
    if (settings.notifyPost === false || user.notifyPost === false) return false;
    if (settings.notifyBoardPost === false || user.notifyBoardPost === false) return false;
  }

  return true;
}

export function getUserNotificationSettings(user: User): Record<string, boolean> {
  const settings = user.notificationSettings || {};
  const role = user.role;

  if (role === 'HOMEROOM_TEACHER') {
    return {
      all: settings.all ?? true,
      change_request: settings.change_request ?? true,
      chat: settings.chat ?? true,
      notice: settings.notice ?? true,
    };
  } else if (role === 'TEACHER') {
    // 지도교사
    return {
      all: settings.all ?? true,
      change_request: settings.change_request ?? true,
      chat: settings.chat ?? true,
      notice: settings.notice ?? true,
    };
  } else if (role === 'DRIVER') {
    return {
      change_request: settings.change_request ?? true,
      escort: settings.escort ?? true,
      chat: settings.chat ?? true,
    };
  } else {
    // PARENT / ADMIN / etc.
    const legacyBoard = settings.notifyBoardPost ?? (user.notifyBoardPost !== false);
    const noticeVal = settings.notifyNotice ?? (user.notifyNotice !== undefined ? user.notifyNotice : legacyBoard);
    const postVal = settings.notifyPost ?? (user.notifyPost !== undefined ? user.notifyPost : legacyBoard);

    return {
      all: settings.all ?? true,
      notifyShuttleOperation: settings.notifyShuttleOperation ?? (user.notifyShuttleOperation !== false),
      notifyBoardPost: legacyBoard,
      notifyNotice: noticeVal,
      notifyPost: postVal,
      change_request: settings.change_request ?? true,
      chat: settings.chat ?? true,
      notice: noticeVal,
      post: postVal,
      ...settings,
    };
  }
}

