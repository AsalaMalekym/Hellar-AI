const account=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN;
if(!/^[a-f0-9]{32}$/i.test(account||'') || !token) throw Error('Cloudflare credentials missing or account ID malformed');
const name='hellar-ai-cosmic-files';
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
const existing=await fetch(`${base}/${name}`,{headers});
if(existing.ok) { console.log('Dedicated R2 bucket exists.'); }
else if(existing.status===404) {
  const result=await fetch(base,{method:'POST',headers,body:JSON.stringify({name})});
  if(!result.ok) throw Error(`Could not create dedicated R2 bucket (HTTP ${result.status}); verify R2 is enabled and the token has R2 Storage Edit permission`);
  console.log('Dedicated R2 bucket created.');
} else throw Error(`Cannot check R2 bucket (HTTP ${existing.status}); verify R2 and token permissions`);
