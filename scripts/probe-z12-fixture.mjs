import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Solo se ejecuta en la conexión validada de la pila temporal del laboratorio.
export async function probeFixture({db,id}){
 const connection=db.connectionParameters;
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||connection.host!=='127.0.0.1'||Number(connection.port)===54322)throw Error('LAB_SCOPE_INVALID');
 const users=Array.from({length:10},()=>randomUUID()),articles=[],counts=[0,1,9,10];
 const categories=(await db.query('select id from private.categories where is_active order by slug')).rows;
 assert.equal(categories.length,6);
 assert.equal(Number((await db.query('select count(*) n from private.characters where is_active')).rows[0].n),8);
 await db.query('begin');
 try{
  for(let i=0;i<users.length;i++){
   await db.query("insert into auth.users(id,email,raw_app_meta_data) values($1,$2,'{\"fixture\":\"z12\"}'::jsonb)",[users[i],'z12-'+users[i]+'@example.invalid']);
   await db.query('insert into private.profiles(id) values($1)',[users[i]]);
   await db.query('insert into private.user_roles(user_id,role) values($1,$2)',[users[i],i===0?'admin':i===1?'editor':'user']);
  }
  async function createArticle(index,published=true){
   const article=randomUUID(),revision=randomUUID(),category=categories[index%categories.length].id;
   const n=index<4?counts[index]:null;
   await db.query('insert into private.articles(id,category_id) values($1,$2)',[article,category]);
   await db.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,$3,'Resumen ficticio para pruebas.',jsonb_build_array('Contenido ficticio.'))",[revision,article,'SIMULACIÓN Z12 · '+(n===null?'Noticia '+index:'N='+n)]);
   if(published){
    await db.query("insert into private.opinions(revision_id,character_id,body) select $1,id,'Opinión sintética de prueba.' from private.characters where is_active",[revision]);
    await db.query("update private.articles set status='published',published_at='2040-01-01T00:00:00Z',current_revision_id=$1 where id=$2",[revision,article]);
   }
   return {article,revision};
  }
  for(let i=0;i<24;i++)articles.push(await createArticle(i));
  await createArticle(24,false);
  const sampleIds=articles.map(x=>x.article);
  const evidence=await db.query("select count(*)::int total,count(*) filter (where (select count(*) from private.opinions o where o.revision_id=a.current_revision_id)=8)::int complete from private.articles a where a.id=any($1::uuid[])",[sampleIds]);
  assert.deepEqual(evidence.rows[0],{total:24,complete:24});
  assert.equal(Number((await db.query('select count(distinct role) n from private.user_roles where user_id=any($1::uuid[])',[users])).rows[0].n),3);
  for(let j=0;j<counts.length;j++){
   const {article,revision}=articles[j];
   for(let i=0;i<counts[j];i++){
    const participation=randomUUID(),kind=i>=8?'none':'voices';
    await db.query('insert into private.article_user_state(user_id,article_id) values($1,$2)',[users[i],article]);
    await db.query("insert into private.participations(id,user_id,article_id,revision_id,choice_kind,operation_id,payload_hash) values($1,$2,$3,$4,$5,$6,repeat('a',64))",[participation,users[i],article,revision,kind,randomUUID()]);
    const keys=i<5?['rami','beatriz']:i<7?['rami']:i===7?['leo']:[];
    if(keys.length)await db.query('insert into private.participation_choices(participation_id,opinion_id) select $1,o.id from private.opinions o join private.characters c on c.id=o.character_id where o.revision_id=$2 and c.stable_key=any($3::text[])',[participation,revision,keys]);
   }
  }
  await db.query("insert into private.article_user_state(user_id,article_id,omitted_at) values($1,$2,now())",[users[9],articles[0].article]);
  await db.query('set constraints all immediate');
  const feed=async cursor=>(await db.query('select api.reader_feed(null,$1::jsonb) result',[cursor?JSON.stringify(cursor):null])).rows[0].result;
  const first=await feed();assert.equal(first.items.length,10);assert.equal(first.hasMore,true);
  const newer=await createArticle(25);await db.query("update private.articles set published_at='2041-01-01T00:00:00Z' where id=$1",[newer.article]);
  const second=await feed(first.nextCursor),third=await feed(second.nextCursor);
  assert.equal(second.items.length,10);
  const pageItems=[...first.items,...second.items,...third.items].map(item=>item.id);
  assert.equal(new Set(pageItems).size,pageItems.length);
  assert.equal(pageItems.includes(newer.article),false);
  assert.equal(sampleIds.filter(value=>pageItems.includes(value)).length,24);
  for(let j=0;j<counts.length;j++){
   const user=users[j===0?9:0];
   await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
   const result=(await db.query('select api.access_results($1,2) result',[articles[j].article])).rows[0].result;
   assert.equal(result.mode,counts[j]===10?'complete':'preliminary');
   if(counts[j]<10)assert.equal(result.community,null);
   else{
    assert.equal(result.community.participants,10);
    const support=Object.fromEntries(result.community.support.map(x=>[x.key,x.percentage]));
    for(const [key,value] of Object.entries({rami:70,beatriz:50,leo:10,none:20}))assert.equal(support[key],value);
   }
  }
  console.log('Z12 fixture aislado: 24 noticias, ocho voces, tres roles, borrador, paginación y N=0/1/9/10: OK');
 }finally{
  await db.query('rollback');
 }
 const remaining=(await db.query('select count(*)::int n from private.articles where id=any($1::uuid[])',[articles.map(x=>x.article)])).rows[0].n;
 assert.equal(remaining,0,'LAB_FIXTURE_ROLLBACK_FAILED');
}
