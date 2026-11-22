import assert from 'node:assert/strict';
import { Miniflare, createFetchMock } from 'miniflare';
import { PNG } from 'pngjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const state = await mkdtemp(path.join(tmpdir(),'hellar-worker-test-'));
const origin='http://localhost', setup='local-test-setup-token-never-for-production';
const mock = createFetchMock(); mock.disableNetConnect();
const api=mock.get('https://api.openai.com');
const mail = [];
mock.get('https://api.resend.com').intercept({path:'/emails',method:'POST'}).reply(200, async opts => {
  mail.push(await new Response(opts.body).json()); return JSON.stringify({id:'mail-test-id'});
}).persist();
const consumed = new Set();
mock.get('https://challenges.cloudflare.com').intercept({path:'/turnstile/v0/siteverify',method:'POST'}).reply(200, async opts => {
  const body = await new Response(opts.body).json(), action = body.response.split(':')[0];
  const success = !consumed.has(body.response) && action !== 'invalid'; consumed.add(body.response);
  return JSON.stringify({success,action,hostname:'localhost'});
}).persist();
api.intercept({path:'/v1/chat/completions',method:'POST'}).reply(200,
  'data: '+JSON.stringify({choices:[{index:0,delta:{content:'Проверка потока'},finish_reason:null}]})+'\n\ndata: [DONE]\n\n',
  {headers:{'content-type':'text/event-stream'}});
const png = PNG.sync.write(new PNG({width:1024,height:1024}));
api.intercept({path:'/v1/images/generations',method:'POST'}).reply(200,JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{headers:{'content-type':'application/json'}});
const options={modules:true,scriptPath:'dist-worker/index.js',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  durableObjects:{HELLAR:{className:'HellarDatabase',useSQLite:true}},r2Buckets:['FILES'],
  durableObjectsPersist:path.join(state,'db'),r2Persist:path.join(state,'r2'),
  bindings:{APP_ORIGIN:origin,NODE_ENV:'development',COOKIE_SECURE:'false',RESEND_API_KEY:'test-mail-key',MAIL_FROM:'Hellar <no-reply@example.com>',TURNSTILE_SITE_KEY:'test-site-key',TURNSTILE_SECRET_KEY:'test-secret-key',SETUP_TOKEN:setup,OPENAI_API_KEY:'test-only-no-real-api-key'},cf:false,fetchMock:mock};
let mf=new Miniflare(options);
function client() {
  const cookies=new Map(); let csrf='';
  return async function request(method,route,body,extra={}) {
    const r=await mf.dispatchFetch(origin+'/api'+route,{method,headers:{origin,'content-type':'application/json','x-csrf-token':csrf,cookie:[...cookies].map(([k,v])=>k+'='+v).join('; '),...extra},body:body===undefined?undefined:JSON.stringify(body)});
    for(const item of r.headers.getSetCookie()) { const pair=item.split(';')[0], at=pair.indexOf('=');cookies.set(pair.slice(0,at),pair.slice(at+1)); }
    const text=await r.text();let data;try{data=JSON.parse(text);}catch{}
    if(data?.csrf) csrf=data.csrf;
    return {status:r.status,data,text,headers:r.headers};
  };
}
const a=client(),b=client(), stranger=client();
const password='Local-test-password-2026!';
let counter=0;
const cap = action => action + ':' + ++counter;
const enter = async client => { await client('GET','/auth/me'); const r = await client('POST','/security/challenge',{captchaToken:cap('site_entry')}); assert.equal(r.status,200,r.text); };
const emailToken = () => mail.at(-1).text.match(/#([A-Za-z0-9_-]+)/)[1];
try {
  assert.equal((await a('GET','/health')).status,200);
  await a('GET','/auth/me');
  assert.equal((await a('POST','/auth/login',{email:'admin@example.com',password})).data.code,'CAPTCHA_REQUIRED');
  await enter(a);
  assert.equal((await a('POST','/setup',{name:'Владелец',email:'admin@example.com',password},{'x-setup-token':'invalid'})).status,403);
  assert.equal((await a('POST','/setup',{name:'Владелец',email:'admin@example.com',password},{'x-setup-token':setup})).status,200);
  assert.equal((await a('POST','/setup',{name:'Владелец',email:'other@example.com',password},{'x-setup-token':setup})).status,409);
  assert.equal((await a('POST','/auth/login',{email:'admin@example.com',password})).status,200);
  assert.equal((await a('POST','/admin/invitations',{}, {origin:'https://evil.invalid'})).status,403);
  const invitation=(await a('POST','/admin/invitations',{})).data.code;
  await enter(b);
  const registration=await b('POST','/auth/register',{name:'Участник',email:'member@example.com',invitation,captchaToken:cap('register')});
  assert.equal(registration.status,200,registration.text);
  assert.equal((await b('GET','/auth/me')).data.user,null);
  const confirm = {token:emailToken(),password,confirmPassword:password};
  assert.equal((await b('POST','/auth/verify-email',confirm)).status,200);
  assert.equal((await b('POST','/auth/verify-email',confirm)).status,400);
  assert.equal((await b('GET','/admin/users')).status,403);
  await enter(stranger);
  assert.equal((await stranger('POST','/auth/register',{name:'Другой',email:'other@example.com',password,confirmPassword:password,invitation,captchaToken:cap('register')})).status,400);
  const chat=(await b('POST','/chats',{})).data.chat;
  assert.equal((await a('GET','/chats/'+chat.id)).status,404);
  const stream=await b('POST',`/chats/${chat.id}/generate`,{content:'Проверка'});
  assert.equal(stream.status,200,stream.text);assert.match(stream.text,/event: delta/);assert.match(stream.text,/Проверка потока/);assert.match(stream.text,/event: done/);
  const history=(await b('GET','/chats/'+chat.id)).data.messages;
  assert.equal(history.length,2);assert.equal(history[1].status,'complete');
  const generated=await b('POST','/images',{prompt:'Космос',size:'1024x1024'});
  assert.equal(generated.status,200,generated.text);
  const image=generated.data.image;
  assert.equal((await a('GET',`/images/${image.id}/file`)).status,404);
  assert.equal((await b('GET',`/images/${image.id}/file`)).headers.get('content-type'),'image/png');
  assert.equal((await stranger('GET','/chats')).status,401);
  const noCsrf=await b('POST','/chats',{}, {'x-csrf-token':''});assert.equal(noCsrf.status,403);
  const resetRequest = await stranger('POST','/auth/forgot',{email:'member@example.com',captchaToken:cap('forgot')});
  assert.equal(resetRequest.status,200,resetRequest.text);
  const reset = {token:emailToken(),password:'New-password-for-testing!',confirmPassword:'New-password-for-testing!'};
  assert.equal((await stranger('POST','/auth/reset',reset)).status,200);
  assert.equal((await b('GET','/auth/me')).data.user,null);
  assert.equal((await b('POST','/auth/login',{email:'member@example.com',password:reset.password})).status,200);
  assert.equal((await stranger('POST','/auth/reset',reset)).status,400);
  mock.assertNoPendingInterceptors();
  await mf.dispose();mf=new Miniflare(options);
  assert.equal((await b('GET','/chats/'+chat.id)).data.messages.length,2);
  assert.equal((await b('GET',`/images/${image.id}/file`)).status,200);
  console.log('Cloudflare integration passed: captcha gate, verified-email registration, password reset, bootstrap, PBKDF2 login, CSRF, invitations, roles, ownership, SSE, R2 images, persistence across runtime restart. Real provider calls: 0.');
} finally {await mf.dispose();await rm(state,{recursive:true,force:true});}
