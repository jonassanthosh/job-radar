import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Relative base + hash routing works for any GitHub Pages path (/<repo>/) without configuration.
export default defineConfig({ base: './', plugins: [react(), tailwindcss()] });
