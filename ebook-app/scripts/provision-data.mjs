// Explicit operator command. Existing/public repositories are never overwritten or made private automatically.
const owner=process.env.EBOOK_GITHUB_OWNER||'NAMWoongchan',name='pmoffice-ebook-data',token=process.env.GITHUB_ADMIN_TOKEN;
if(!token)throw Error('Set GITHUB_ADMIN_TOKEN in this process environment using your secret manager. Do not put it in a file or chat.');
async function request(path,options={}){return fetch('https://api.github.com'+path,{...options,headers:{Authorization:'Bearer '+token,'User-Agent':'PMOffice-Ebook-Provision','X-GitHub-Api-Version':'2022-11-28',Accept:'application/vnd.github+json',...options.headers}})}
const existing=await request(`/repos/${owner}/${name}`);
if(existing.ok){const repo=await existing.json();if(!repo.private)throw Error('Existing data repository is PUBLIC. Stop and review before connecting customer data.');console.log('Verified private repository:',repo.html_url);process.exit(0)}
if(existing.status!==404)throw Error('Cannot determine repository access. No repository was created.');
const who=await request('/user');if(!who.ok)throw Error('GitHub authentication failed.');const account=await who.json();if(account.login.toLowerCase()!==owner.toLowerCase())throw Error('Repository owner differs from authenticated account. No repository was created.');
if(!process.argv.includes('--apply')){console.log(`Ready to create PRIVATE ${owner}/${name}. Run with --apply to create. No change made.`);process.exit(0)}
const created=await request('/user/repos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,private:true,auto_init:true,description:'Private source and generated assets for PMOffice E-book Generator'})});if(!created.ok)throw Error('Private repository creation failed. No credentials logged.');const repo=await created.json();if(!repo.private)throw Error('Repository privacy verification failed.');console.log('Created private repository:',repo.html_url);
