export async function processLocalNotification(client,job){
 const result=await client.query('select private.complete_local_notification($1,$2) ok',[job.id,job.leaseToken]);
 if(!result.rows[0].ok)throw Error('NOTIFICATION_LEASE_EXPIRED');
}
export function startNotificationScheduler(client,{onError=()=>{}}={}){
 let stopped=false,timer=null,running=false;
 async function tick(){
  if(stopped||running)return;running=true;
  try{await client.query('select private.schedule_notifications()');}catch{onError();}finally{
   running=false;if(!stopped)timer=setTimeout(tick,60000-Date.now()%60000+100);
  }
 }
 void tick();
 return ()=>{stopped=true;if(timer)clearTimeout(timer);};
}
