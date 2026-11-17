// Solo valida configuración; no escribe archivos ni muestra claves.
export function localTestEnvironment(environment,status){
 if(environment.APP_ORIGIN&&environment.APP_ORIGIN!=='http://127.0.0.1:3102')throw Error('LOCAL_ORIGIN_INVALID');
 if(status.API_URL!=='http://127.0.0.1:54321'||environment.NEXT_PUBLIC_SUPABASE_URL!==status.API_URL)throw Error('LOCAL_SUPABASE_URL_INVALID');
 const keys=[status.PUBLISHABLE_KEY,status.ANON_KEY].filter(value=>typeof value==='string'&&value.length>0);
 if(!keys.includes(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY))throw Error('LOCAL_SUPABASE_KEY_INVALID');
 return {...environment,RIUYA_ENABLE_ACCOUNT_DELETION:'0'};
}
