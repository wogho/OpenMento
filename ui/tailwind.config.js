/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 카카오톡 스타일 팔레트
        kakao: {
          yellow: '#FEE500',
          'yellow-dark': '#E6CE00',
        },
        bubble: {
          user: '#FEE500',       // 본인 메시지
          ai: '#FFFFFF',          // AI 메시지
          'ai-dark': '#F8F8F8',
        },
      },
      animation: {
        'typing-dot': 'typing-dot 1.4s infinite ease-in-out',
        'fade-in': 'fade-in 0.3s ease-out forwards',
      },
      keyframes: {
        'typing-dot': {
          '0%, 80%, 100%': { transform: 'scale(0.6)', opacity: '0.4' },
          '40%': { transform: 'scale(1)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
