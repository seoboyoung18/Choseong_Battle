import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 앱인토스는 CSR/SSG만 허용한다 (SSR 금지) — 기본 SPA 빌드를 그대로 쓴다.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // QR 테스트용으로 같은 네트워크의 폰에서 접근할 수 있게 열어둔다
  },
  build: {
    target: 'es2020',
    sourcemap: true,
  },
});
