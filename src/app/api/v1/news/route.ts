import { feed } from '@/lib/reader';
export async function GET(request:Request) {
 const url=new URL(request.url); const category=url.searchParams.get('category'); const cursor=url.searchParams.get('cursor');
 try { const result=await feed(category,cursor); return Response.json(result,{headers:{'Cache-Control':'private, no-store'}}); }
 catch(error) { const message=error instanceof Error ? error.message : ''; const bad=message.includes('inválido'); return Response.json({error:bad?'Filtro o cursor inválido':'No se pudo cargar las noticias'}, {status:bad?400:503,headers:{'Cache-Control':'no-store'}}); }
}
