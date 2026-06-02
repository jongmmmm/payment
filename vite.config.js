import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// 로컬 개발(dev)은 루트('/')에서, 배포 빌드(build)는 GitHub Pages 경로('/payment/')에서 서빙
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? '/payment/' : '/',
}))
