export const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.origin && window.location.origin.startsWith('http') ? window.location.origin : 'http://54.253.50.203:3000');

