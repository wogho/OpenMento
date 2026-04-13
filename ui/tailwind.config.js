/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
  	extend: {
  		borderRadius: {
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: 'hsl(var(--muted))',
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			brand: 'hsl(var(--brand))',
  			bubble: {
  				user: '#2563eb',
  				'user-text': '#ffffff',
  				ai: '#FFFFFF',
  				'ai-dark': '#F8F8F8'
  			},
  			'brand-foreground': 'hsl(var(--brand-foreground))',
  			'muted-foreground': 'hsl(var(--muted-foreground))'
  		},
  		animation: {
  			'typing-dot': 'typing-dot 1.4s infinite ease-in-out',
  			'fade-in': 'fade-in 0.3s ease-out forwards',
  			'appear-zoom': 'appear-zoom 0.8s ease-out forwards',
  			appear: 'appear 0.5s ease-out forwards',
  			'bell-glow': 'bell-glow 1.8s ease-in-out infinite',
  			'border-glow': 'border-glow 3s ease-in-out infinite',
  		},
  		keyframes: {
  			'border-glow': {
  				'0%, 100%': {
  					boxShadow: '0 0 20px -4px rgba(99,102,241,0.4), 0 0 60px -12px rgba(99,102,241,0.2)',
  				},
  				'50%': {
  					boxShadow: '0 0 50px -4px rgba(139,92,246,0.7), 0 0 100px -12px rgba(99,102,241,0.5)',
  				},
  			},
  			'bell-glow': {
  				'0%, 100%': {
  					boxShadow: '0 0 0 0 rgba(245, 158, 11, 0.7)',
  					transform: 'scale(1)',
  				},
  				'50%': {
  					boxShadow: '0 0 0 8px rgba(245, 158, 11, 0)',
  					transform: 'scale(1.08)',
  				},
  			},
  			'typing-dot': {
  				'0%, 80%, 100%': {
  					transform: 'scale(0.6)',
  					opacity: '0.4'
  				},
  				'40%': {
  					transform: 'scale(1)',
  					opacity: '1'
  				}
  			},
  			'fade-in': {
  				'0%': {
  					opacity: '0',
  					transform: 'translateY(10px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			'appear-zoom': {
  				'0%': {
  					opacity: '0',
  					transform: 'scale(0.98)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'scale(1)'
  				}
  			},
  			appear: {
  				'0%': {
  					opacity: '0',
  					transform: 'translateY(10px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			}
  		}
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
