'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {isIP} from 'node:net';
import { supabase } from '@/lib/supabase';

const uuid = z.uuid();
function target(id: string, message: string): never { redirect(`/admin?id=${encodeURIComponent(id)}&msg=${encodeURIComponent(message)}`); }
async function client() { const db = await supabase(); const { data, error } = await db.auth.getUser(); if (error || !data.user) redirect('/admin?msg=Inicia%20sesi%C3%B3n'); return db; }
export async function login(f: FormData) {
 const db = await supabase(); const email = String(f.get('email') || ''); const password = String(f.get('password') || '');
 const { error } = await db.auth.signInWithPassword({ email, password }); if (error) redirect('/admin?msg=No%20se%20pudo%20iniciar%20sesi%C3%B3n'); redirect('/admin');
}
export async function logout() { const db = await supabase(); await db.auth.signOut(); redirect('/admin'); }
function payload(f: FormData) {
 const lines = String(f.get('sources') || '').split('\n').map(x => x.trim()).filter(Boolean);
 const sources = lines.map(line => { const [key, name, date, url, ...rest] = line.split('|').map(x => x.trim()); return { key, name, date, url, rest }; });
 if (sources.some(s => s.rest.length || !s.key || !s.name || !s.date || !s.url)) throw new Error('Cada fuente debe tener clave|nombre|fecha|URL');
 const keys = ['rami','beatriz','leo','dmitri','naoki','salma','tove','kavya'];
 const data = { categoryId: String(f.get('categoryId')), title: String(f.get('title') || ''), summary: String(f.get('summary') || ''), paragraphs: String(f.get('paragraphs') || '').split(/\n\s*\n/).map(x => x.trim()).filter(Boolean), sources: sources.map(({key,name,date,url})=>({key,name,date,url})), opinions: keys.map(characterKey => ({characterKey,body:String(f.get(characterKey) || '')})).filter(x=>x.body.trim()) };
 return data;
}
export async function save(_previous: {error: string}, f: FormData): Promise<{error: string}> {
 const db = await client(); const id = String(f.get('id') || ''); const version = Number(f.get('version')); if (id && (!uuid.safeParse(id).success || !Number.isInteger(version))) redirect('/admin?msg=Datos%20inv%C3%A1lidos'); let data; try { data=payload(f); } catch (error) { return {error: error instanceof Error ? error.message : 'Datos inválidos'}; }
 const { data: saved, error } = await db.schema('api').rpc('editor_save', { p_id: id || null, p_expected_version: id ? version : null, p_data: data });
 if (error) return {error: `No se guardó: ${error.message}`}; target(saved.id,'Borrador guardado');
}
export async function review(f: FormData) { const db=await client(); const id=String(f.get('id')); const version=Number(f.get('version')); if(!uuid.safeParse(id).success || !Number.isInteger(version)) redirect('/admin'); const {error}=await db.schema('api').rpc('editor_review',{p_id:id,p_expected_version:version}); if(error) target(id,`No se pudo revisar: ${error.message}`); target(id,'Revisa el contenido guardado y confirma la lista antes de publicar.'); }
export async function publish(f: FormData) { const db=await client(); const id=String(f.get('id')); const version=Number(f.get('version')); const revision=String(f.get('revision')); if(!uuid.safeParse(id).success || !uuid.safeParse(revision).success || !Number.isInteger(version)) redirect('/admin'); const {error}=await db.schema('api').rpc('editor_publish',{p_id:id,p_expected_version:version,p_revision_id:revision,p_review_hash:String(f.get('hash')),p_confirm:f.get('confirm')==='on'}); if(error) target(id,`No se publicó: ${error.message}`); target(id,'Noticia publicada'); }
export async function withdraw(f: FormData) { const db=await client(); const id=String(f.get('id')); const version=Number(f.get('version')); if(!uuid.safeParse(id).success || !Number.isInteger(version)) redirect('/admin'); const {error}=await db.schema('api').rpc('editor_withdraw',{p_id:id,p_expected_version:version,p_reason:String(f.get('reason')||'')}); if(error) target(id,`No se retiró: ${error.message}`); target(id,'Noticia retirada'); }

export async function correct(_previous: {error: string}, f: FormData): Promise<{error: string}> { const db=await client(); const id=String(f.get('id')); const version=Number(f.get('version')); if(!uuid.safeParse(id).success || !Number.isInteger(version)) redirect('/admin'); let data; try { data=payload(f); } catch (error) { return {error: error instanceof Error ? error.message : 'Datos inválidos'}; } const {error}=await db.schema('api').rpc('editor_correct',{p_id:id,p_expected_version:version,p_data:data,p_reason:String(f.get('reason')||''),p_confirm:f.get('confirm')==='on'}); if(error) return {error:`No se corrigió: ${error.message}`}; target(id,'Corrección publicada'); }

export async function generateFixture(f:FormData) {
 const db=await client();const requestId=String(f.get('requestId')||'');
 if(!uuid.safeParse(requestId).success)redirect('/admin?msg=Solicitud%20inv%C3%A1lida');
 const {error}=await db.schema('api').rpc('enqueue_fixture_draft',{p_request_id:requestId});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT429'?'Límite de cinco propuestas por hora.':'No se pudo crear el trabajo.'):'Trabajo ficticio en cola. Actualiza para ver el resultado.'));
}

export async function saveSource(f:FormData){
 const db=await client();const id=String(f.get('id')||'');const version=Number(f.get('version'));let url:URL;
 try{url=new URL(String(f.get('url')||''));if(!['http:','https:'].includes(url.protocol)||url.username||url.password||isIP(url.hostname.replace(/^\[|\]$/g,''))||(url.port&&url.port!==(url.protocol==='https:'?'443':'80')))throw Error();}catch{redirect('/admin?msg='+encodeURIComponent('La URL de la fuente no es válida.'));}
 if(id&&(!uuid.safeParse(id).success||!Number.isInteger(version)))redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('editor_save_source',{p_id:id||null,p_expected_version:id?version:null,p_name:String(f.get('name')||''),p_base_url:url.href,p_domain:url.hostname.toLowerCase().replace(/\.$/,''),p_type:String(f.get('type')||''),p_policy:String(f.get('policy')||''),p_confirm:f.get('confirm')==='on'});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT409'?'La fuente cambió; actualiza antes de guardar.':'No se pudo guardar la fuente.'):'Fuente verificada guardada.'));
}
export async function fetchSource(f:FormData){
 const db=await client();const id=String(f.get('id')||'');const version=Number(f.get('version'));
 if(!uuid.safeParse(id).success||!Number.isInteger(version))redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('editor_fetch_source',{p_id:id,p_expected_version:version});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT429'?'Aún no ha transcurrido el intervalo de consulta de esta fuente.':'No se pudo solicitar la ingesta.'):'Ingesta en cola. Actualiza para ver los elementos.'));
}

export async function decideGroup(f:FormData){
 const db=await client();const id=String(f.get('id')||'');const version=Number(f.get('version'));const decision=String(f.get('decision')||'');
 if(!uuid.safeParse(id).success||!Number.isInteger(version)||!['confirm','reject'].includes(decision))redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('editor_decide_group',{p_id:id,p_version:version,p_decision:decision});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT409'?'La agrupación cambió o entra en conflicto; actualiza antes de decidir.':'No se pudo guardar la decisión.'):'Decisión editorial guardada.'));
}

export async function generateOllama(f:FormData){
 const db=await client();const requestId=String(f.get('requestId')||'');const itemId=String(f.get('itemId')||'');
 if(!uuid.safeParse(requestId).success||!uuid.safeParse(itemId).success)redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('enqueue_ollama_draft',{p_item_id:itemId,p_request_id:requestId});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT429'?'Límite de cinco propuestas por hora.':'No se pudo encolar la propuesta.'):'Propuesta para Ollama en cola. El worker local debe estar activo.'));
}
export async function cancelJob(f:FormData){
 const db=await client();const id=String(f.get('id')||'');
 if(!uuid.safeParse(id).success)redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('cancel_editor_job',{p_id:id});
 redirect('/admin?msg='+encodeURIComponent(error?'No se pudo cancelar el trabajo.':'Trabajo cancelado.'));
}

export async function setEventPrimary(f:FormData){
 const db=await client();const event=String(f.get('event')||'');const eventVersion=Number(f.get('eventVersion'));const [article,articleVersionText]=String(f.get('article')||'').split('|');const articleVersion=Number(articleVersionText);
 if(!uuid.safeParse(event).success||!uuid.safeParse(article).success||!Number.isInteger(eventVersion)||!Number.isInteger(articleVersion))redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('editor_set_event_primary',{p_event_id:event,p_event_version:eventVersion,p_article_id:article,p_article_version:articleVersion,p_confirm:f.get('confirm')==='on'});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT409'?'El acontecimiento o la noticia cambió; actualiza antes de continuar.':'No se pudo asignar la publicación principal.'):'Publicación principal asignada.'));
}

export async function importDraft(f:FormData){
 const db=await client();const job=String(f.get('job')||'');const category=String(f.get('category')||'');
 if(!uuid.safeParse(job).success||!uuid.safeParse(category).success)redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {data,error}=await db.schema('api').rpc('import_generated_draft',{p_job_id:job,p_category_id:category,p_confirm:f.get('confirm')==='on'});
 if(error||!data?.id)redirect('/admin?msg='+encodeURIComponent('No se pudo crear el borrador.'));
 target(data.id,'Borrador creado. Revisa y completa todo el contenido antes de publicarlo.');
}

export async function setSourceActive(f:FormData){
 const db=await client();const id=String(f.get('id')||'');const version=Number(f.get('version'));const target=String(f.get('active')||'');
 if(!uuid.safeParse(id).success||!Number.isInteger(version)||!['true','false'].includes(target))redirect('/admin?msg=Datos%20inv%C3%A1lidos');
 const {error}=await db.schema('api').rpc('editor_set_source_active',{p_id:id,p_expected_version:version,p_active:target==='true'});
 redirect('/admin?msg='+encodeURIComponent(error?(error.code==='PT409'?'La fuente cambió; actualiza la página.':'No se pudo cambiar el estado de la fuente.'):'Estado de la fuente actualizado.'));
}
