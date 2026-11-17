import type {MetadataRoute} from 'next';

export default function manifest():MetadataRoute.Manifest{
 return {name:'Riuya',short_name:'Riuya',description:'Noticias y distintas miradas',start_url:'/',scope:'/',display:'standalone',
  background_color:'#f4f7fb',theme_color:'#173e46',icons:[{src:'/assets/r8-icono-128.png',sizes:'128x128',type:'image/png'},{src:'/assets/r8-icono-256.png',sizes:'256x256',type:'image/png'},{src:'/assets/r8-icono-512.png',sizes:'512x512',type:'image/png'}]};
}
