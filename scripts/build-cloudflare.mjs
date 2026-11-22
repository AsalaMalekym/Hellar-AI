import { build } from 'esbuild';
import path from 'node:path';
const root = process.cwd();
await build({
  entryPoints:['cloudflare/index.ts'], outfile:'dist-worker/index.js', bundle:true,
  banner:{js: "import { createRequire } from 'node:module'; const require = createRequire('/');"},
  format:'esm', platform:'node', target:'es2022', sourcemap:true,
  external:['node:*','cloudflare:*'], loader:{'.sql':'text'},
  plugins:[{name:'cloudflare-adapters',setup(b) {
    b.onResolve({filter:/^(\.\/storage\.js|\.\/db\.js)$/},args => {
      if (args.resolveDir === path.join(root,'server')) return {path:path.join(root,'cloudflare',args.path.replace('.js','.ts'))};
    });
    b.onResolve({filter:/sync-inflate$/},args => args.resolveDir.includes('pngjs') ? {path:path.join(root,'cloudflare/inflate.cjs')} : undefined);
    b.onResolve({filter:/^sharp$/},() => ({path:path.join(root,'cloudflare/sharp.ts')}));
  }}],
});
