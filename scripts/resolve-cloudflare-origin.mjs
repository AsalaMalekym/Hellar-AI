import { appendFileSync } from 'node:fs';
export async function resolveOrigin(env, request = fetch) {
  if (env.HELLAR_APP_ORIGIN) {
    const value = env.HELLAR_APP_ORIGIN;
    if (new URL(value).origin !== value || !value.startsWith('https://')) throw Error('HELLAR_APP_ORIGIN must be HTTPS without a trailing slash');
    return value;
  }
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!/^[a-f0-9]{32}$/i.test(account || '') || !env.CLOUDFLARE_API_TOKEN) throw Error('Cloudflare credentials missing or malformed');
  const response = await request(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error(`Could not read Workers subdomain (HTTP ${response.status}); check token permissions and account ID`);
  const data = await response.json();
  const subdomain = data.result?.subdomain;
  if (!data.success || typeof subdomain !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(subdomain)) throw Error('Create a workers.dev subdomain in Cloudflare Workers & Pages first, or set HELLAR_APP_ORIGIN');
  return `https://hellar-ai-cosmic.${subdomain}.workers.dev`;
}
if (process.argv[1]?.endsWith('/resolve-cloudflare-origin.mjs')) {
  const origin = await resolveOrigin(process.env);
  if (!process.env.GITHUB_ENV) throw Error('This command must run inside GitHub Actions');
  appendFileSync(process.env.GITHUB_ENV, `HELLAR_APP_ORIGIN=${origin}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Hellar target address: ${origin}\n\nFirst-owner setup after deployment: ${origin}/setup\n`);
  console.log(`Hellar target address: ${origin}`);
}
