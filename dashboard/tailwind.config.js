/** @type {import('tailwindcss').Config} */
// THE WINDOW — "Benchmark Terminal" identity.
// Forked from the sibling app; accent ramp swapped: warm GOLD = the public M-ONIA rate,
// cold CYAN = encrypted values. Near-black surfaces kept (cooler). JetBrains Mono for numerics.
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      animation: {
        'fade-in': 'fadeIn 0.6s ease-out forwards',
        'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
        'fade-in-down': 'fadeInDown 0.4s ease-out forwards',
        'slide-in-right': 'slideInRight 0.4s ease-out forwards',
        'slide-in-left': 'slideInLeft 0.4s ease-out forwards',
        'scale-in': 'scaleIn 0.3s ease-out forwards',
        'glow-pulse': 'glowPulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 3s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'gradient-shift': 'gradientShift 8s ease infinite',
        'text-shimmer': 'textShimmer 3s ease-in-out infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'shine': 'shine 2s ease-in-out infinite',
        'ticker-in': 'tickerIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          from: { opacity: '0', transform: 'translateY(-12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(-24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        slideInLeft: {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.92)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        glowPulse: {
          '0%, 100%': { boxShadow: '0 0 8px rgba(245,163,0,0.3), 0 0 24px rgba(245,163,0,0.1)' },
          '50%': { boxShadow: '0 0 16px rgba(245,163,0,0.5), 0 0 48px rgba(245,163,0,0.2)' },
        },
        shimmer: {
          from: { backgroundPosition: '-200% center' },
          to: { backgroundPosition: '200% center' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        gradientShift: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        textShimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        shine: {
          '0%': { left: '-100%' },
          '50%, 100%': { left: '100%' },
        },
        tickerIn: {
          from: { opacity: '0', transform: 'translateY(10px) scale(0.96)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      colors: {
        // PUBLIC rate — warm gold "ticker" (SOFR/Bloomberg amber)
        benchmark: {
          50: '#FFF8E6',
          100: '#FFECBF',
          200: '#FFDD8F',
          300: '#FFCB54',
          400: '#FFB92B',
          500: '#F5A300',
          600: '#D68600',
          700: '#A65F00',
          800: '#754000',
          900: '#4A2800',
        },
        // ENCRYPTED accent — cold cyan (locked, inert)
        cipher: {
          300: '#7DE3F4',
          400: '#38CFE6',
          500: '#12B5CE',
          600: '#0E90A6',
          700: '#0B6C7D',
        },
        // Semantic signals
        signal: {
          up: '#34D399',
          down: '#FB7185',
          stale: '#C79A3A',
          info: '#5EA0FF',
        },
        // Cooler near-black surface ramp
        surface: {
          0: '#08090c',
          1: '#0d0f14',
          2: '#141821',
          3: '#1b2130',
          4: '#232b3d',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      boxShadow: {
        'glow-sm': '0 0 8px rgba(245,163,0,0.3)',
        'glow': '0 0 16px rgba(245,163,0,0.4)',
        'glow-lg': '0 0 32px rgba(245,163,0,0.5)',
        'glow-cipher': '0 0 16px rgba(18,181,206,0.35)',
        'inner-glow': 'inset 0 1px 0 0 rgba(255,255,255,0.05)',
        'card': '0 4px 6px -1px rgba(0,0,0,0.3), 0 2px 4px -2px rgba(0,0,0,0.2)',
        'card-hover': '0 20px 25px -5px rgba(0,0,0,0.4), 0 8px 10px -6px rgba(0,0,0,0.3)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
