'use server';
import { redirect } from 'next/navigation';
import { z } from 'zod';
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
