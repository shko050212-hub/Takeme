import { API_BASE_URL } from '../config';

let isRefreshing = false;
let refreshSubscribers = [];

function onRefreshed(newToken) {
  refreshSubscribers.forEach((cb) => cb(newToken));
  refreshSubscribers = [];
}

export function setupFetchInterceptor() {
  if (window._hasAuthFetchInterceptor) return;
  window._hasAuthFetchInterceptor = true;

  const originalFetch = window.fetch;

  window.fetch = async function (input, init = {}) {
    const token = localStorage.getItem('takeme_token');
    const headers = new Headers(init.headers || {});

    const urlStr = typeof input === 'string' ? input : input?.url || '';
    if (token && !headers.has('Authorization') && (urlStr.startsWith(API_BASE_URL) || urlStr.startsWith('/'))) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const modifiedInit = {
      ...init,
      headers,
    };

    try {
      const response = await originalFetch(input, modifiedInit);

      // 401 Unauthorized 감지 시 리프레시 토큰으로 자동 갱신 시도
      if (response.status === 401 && !urlStr.includes('/auth/login') && !urlStr.includes('/auth/refresh') && !urlStr.includes('/auth/self-unlock')) {
        const refreshToken = localStorage.getItem('takeme_refresh_token');
        if (!refreshToken) {
          return response;
        }

        if (!isRefreshing) {
          isRefreshing = true;
          try {
            const refreshRes = await originalFetch(`${API_BASE_URL}/auth/refresh`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });

            if (refreshRes.ok) {
              const data = await refreshRes.json();
              if (data.accessToken) {
                localStorage.setItem('takeme_token', data.accessToken);
                if (data.refreshToken) {
                  localStorage.setItem('takeme_refresh_token', data.refreshToken);
                }
                onRefreshed(data.accessToken);

                // 원래 요청 새 토큰으로 자동 재시도
                const retryHeaders = new Headers(init.headers || {});
                retryHeaders.set('Authorization', `Bearer ${data.accessToken}`);
                return originalFetch(input, { ...init, headers: retryHeaders });
              }
            } else {
              localStorage.removeItem('takeme_token');
              localStorage.removeItem('takeme_refresh_token');
              localStorage.removeItem('takeme_user');
              window.location.href = '/';
              return response;
            }
          } catch (err) {
            console.error('Token auto-refresh failed:', err);
            return response;
          } finally {
            isRefreshing = false;
          }
        } else {
          // 이미 갱신 중인 경우 대기열에 등록 후 새 토큰 도착 시 재시도
          return new Promise((resolve) => {
            refreshSubscribers.push((newToken) => {
              const retryHeaders = new Headers(init.headers || {});
              retryHeaders.set('Authorization', `Bearer ${newToken}`);
              resolve(originalFetch(input, { ...init, headers: retryHeaders }));
            });
          });
        }
      }

      return response;
    } catch (err) {
      throw err;
    }
  };
}
