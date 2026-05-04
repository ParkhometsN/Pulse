import axios from 'axios';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://127.0.0.1:8000' : '/api');

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Добавляем перехватчик для обработки ошибок
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Можно добавить глобальную обработку ошибок
    console.error('API Error:', error);
    return Promise.reject(error);
  }
);

export default api;