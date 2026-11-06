import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// The project lives under a folder named "10%". Vite's index.html transform
// URI-decodes the absolute path and throws on the bare '%', so in dev we serve
// HTML pages ourselves (plus the HMR client). Builds are unaffected.
function servePlainIndex(): Plugin {
  return {
    name: 'serve-plain-index',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        let url = req.url?.split('?')[0] ?? '';
        if (url === '/') url = '/index.html';
        if (!url.endsWith('.html')) return next();
        let html: string;
        try {
          html = readFileSync(resolve(server.config.root, '.' + decodeURIComponent(url)), 'utf8');
        } catch {
          return next();
        }
        html = html.replace(
          '<head>',
          '<head><script type="module" src="/@vite/client"></script>',
        );
        res.setHeader('Content-Type', 'text/html');
        res.end(html);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [servePlainIndex()],
  server: { port: 5173 },
  // builds use relative paths, so the site works wherever it's hosted (e.g. https://<user>.github.io/econsim/)
  base: command === 'build' ? './' : '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
}));
