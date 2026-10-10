import http from 'http';
import https from 'https';

export const BLOCKED_HOSTS = [
  'api.tavily.com',
  'api.firecrawl.dev',
  'generativelanguage.googleapis.com'
];

export const FORBIDDEN_PROVIDER_KEYS = [
  'TAVILY_API_KEY',
  'FIRECRAWL_API_KEY',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'RENDER_API_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_D1_API_TOKEN'
];

// 1. Force NODE_ENV to test
process.env.NODE_ENV = 'test';

// 2. Strip live provider keys from process.env immediately
for (const key of FORBIDDEN_PROVIDER_KEYS) {
  delete process.env[key];
}

// 3. Intercept globalThis.fetch to block network calls to external providers
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: any, init?: any) => {
  const urlStr = typeof input === 'string' ? input : (input?.url || input?.href || String(input));
  for (const blocked of BLOCKED_HOSTS) {
    if (urlStr.includes(blocked)) {
      throw new Error(`[HERMETIC_TEST_FAILURE] Live network call to '${blocked}' is strictly blocked in tests! Target: ${urlStr}`);
    }
  }
  return originalFetch(input, init);
};

// 4. Intercept http.request and https.request for defense in depth
function wrapRequest(originalFn: any, protocol: string) {
  return function (this: any, ...args: any[]) {
    let host = '';
    const arg0 = args[0];
    if (typeof arg0 === 'string') {
      try {
        const u = new URL(arg0);
        host = u.hostname;
      } catch {
        host = arg0;
      }
    } else if (arg0 && typeof arg0 === 'object') {
      host = arg0.hostname || arg0.host || '';
    }
    for (const blocked of BLOCKED_HOSTS) {
      if (host.includes(blocked)) {
        throw new Error(`[HERMETIC_TEST_FAILURE] Live network call to '${blocked}' via ${protocol} is strictly blocked in tests! Host: ${host}`);
      }
    }
    return originalFn.apply(this, args);
  };
}

http.request = wrapRequest(http.request, 'http') as any;
http.get = wrapRequest(http.get, 'http') as any;
https.request = wrapRequest(https.request, 'https') as any;
https.get = wrapRequest(https.get, 'https') as any;
