import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'fs';

// Load .env manually for vite.define (Vite only auto-loads VITE_ prefixed vars)
function loadEnv() {
  const env = {};
  try {
    const content = readFileSync('.env', 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      env[key] = val;
    }
  } catch {}
  return env;
}
const dotenv = loadEnv();

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: {
      enabled: true,
    },
    imageService: 'passthrough',
  }),
  vite: {
    plugins: [tailwindcss()],
    define: {
      'process.env.OPENAI_API_KEY': JSON.stringify(dotenv.OPENAI_API_KEY || ''),
      'process.env.OPENAI_BASE_URL': JSON.stringify(dotenv.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
      'process.env.DOCUMENT_AI_MODEL': JSON.stringify(dotenv.DOCUMENT_AI_MODEL || 'gpt-4o-mini'),
      'process.env.DOCUMENT_AI_WEBHOOK_URL': JSON.stringify(dotenv.DOCUMENT_AI_WEBHOOK_URL || ''),
      'process.env.DOCUMENT_AI_WEBHOOK_TOKEN': JSON.stringify(dotenv.DOCUMENT_AI_WEBHOOK_TOKEN || ''),
      'process.env.OCR_SPACE_API_KEY': JSON.stringify(dotenv.OCR_SPACE_API_KEY || ''),
      'process.env.PREDIAL_PROXY_URL': JSON.stringify(dotenv.PREDIAL_PROXY_URL || ''),
      'process.env.PREDIAL_PROXY_TOKEN': JSON.stringify(dotenv.PREDIAL_PROXY_TOKEN || ''),
    },
  }
});
