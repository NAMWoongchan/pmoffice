// Only a change counter and scope travel over Realtime. Business records stay behind RPC authorization.
export function watchAdminChanges(client,scopes,callback){
 if(typeof window==='undefined'||typeof client?.channel!=='function')return ()=>{}
 let stopped=false,pending=false
 const receive=payload=>{if(stopped||!scopes.includes(payload.new?.scope)||pending)return;pending=true;queueMicrotask(()=>{pending=false;if(!stopped)callback()})}
 const channel=client.channel('admin-changes-'+Math.random().toString(36).slice(2)).on('postgres_changes',{event:'*',schema:'public',table:'admin_change_signals'},receive).subscribe()
 return ()=>{stopped=true;client.removeChannel(channel)}
}
