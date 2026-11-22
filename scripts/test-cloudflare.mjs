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
api.intercept({path:'/v1/chat/completions',method:'POST'}).reply(200,
  'data: '+JSON.stringify({choices:[{index:0,delta:{content:'Проверка потока'},finish_reason:null}]})+'\n\ndata: [DONE]\n\n',
  {headers:{'content-type':'text/event-stream'}});
const png = PNG.sync.write(new PNG({width:1024,height:1024}));
api.intercept({path:'/v1/images/generations',method:'POST'}).reply(200,JSON.stringify({data:[{b64_json:png.toString('base64')}]}),{headers:{'content-type':'application/json'}});
const options={modules:true,scriptPath:'dist-worker/index.js',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  durableObjects:{HELLAR:{className:'HellarDatabase',useSQLite:true}},r2Buckets:['FILES'],
  durableObjectsPersist:path.join(state,'db'),r2Persist:path.join(state,'r2'),
  bindings:{APP_ORIGIN:origin,NODE_ENV:'development',COOKIE_SECURE:'false',SETUP_TOKEN:setup,OPENAI_API_KEY:'test-only-no-real-api-key'},cf:false,fetchMock:mock};
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
try {
  assert.equal((await a('GET','/health')).status,200);
  await a('GET','/auth/me');
  assert.equal((await a('POST','/setup',{name:'Владелец',email:'admin@example.com',password},{'x-setup-token':'invalid'})).status,403);
  assert.equal((await a('POST','/setup',{name:'Владелец',email:'admin@example.com',password},{'x-setup-token':setup})).status,200);
  assert.equal((await a('POST','/setup',{name:'Владелец',email:'other@example.com',password},{'x-setup-token':setup})).status,409);
  assert.equal((await a('POST','/auth/login',{email:'admin@example.com',password})).status,200);
  assert.equal((await a('POST','/admin/invitations',{}, {origin:'https://evil.invalid'})).status,403);
  const invitation=(await a('POST','/admin/invitations',{})).data.code;
  await b('GET','/auth/me');
  const registration=await b('POST','/auth/register',{name:'Участник',email:'member@example.com',password,confirmPassword:password,invitation});
  assert.equal(registration.status,200,registration.text);
  assert.equal((await b('GET','/admin/users')).status,403);
  await stranger('GET','/auth/me');
  assert.equal((await stranger('POST','/auth/register',{name:'Другой',email:'other@example.com',password,confirmPassword:password,invitation})).status,400);
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
  mock.assertNoPendingInterceptors();
  await mf.dispose();mf=new Miniflare(options);
  assert.equal((await b('GET','/chats/'+chat.id)).data.messages.length,2);
  assert.equal((await b('GET',`/images/${image.id}/file`)).status,200);
  console.log('Cloudflare integration passed: bootstrap, PBKDF2 login, CSRF, invitations, roles, ownership, SSE, R2 images, persistence across runtime restart. Real provider calls: 0.');
} finally {await mf.dispose();await rm(state,{recursive:true,force:true});}
