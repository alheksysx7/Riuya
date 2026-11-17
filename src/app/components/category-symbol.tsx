// Ilustraciones decorativas: el nombre de categoría permanece visible.
import Image from 'next/image';
import {useState} from 'react';
import manifest from '../../../public/assets/categorias/manifest.json';
export function CategorySymbol({category}:{category:string}){
 const [failedPath,setFailedPath]=useState<string|null>(null);
 const paths:Record<string,React.ReactNode>={
  politica:<><path d="M4 11h28L18 4 4 11ZM7 14v13m7-13v13m8-13v13m7-13v13M4 30h28"/></>,
  economia:<><path d="M5 28h26M8 24V14m7 10V9m7 15v-7m7 7V5"/></>,
  tecnologia:<><rect x="8" y="8" width="20" height="20" rx="4"/><path d="M13 13h10v10H13zM13 4v4m10-4v4M13 28v4m10-4v4M4 13h4m-4 10h4m20-10h4m-4 10h4"/></>,
  ciencia:<><circle cx="18" cy="18" r="3"/><ellipse cx="18" cy="18" rx="14" ry="6"/><ellipse cx="18" cy="18" rx="14" ry="6" transform="rotate(60 18 18)"/><ellipse cx="18" cy="18" rx="14" ry="6" transform="rotate(120 18 18)"/></>,
  sociedad:<><circle cx="18" cy="12" r="4"/><path d="M10 28v-2a8 8 0 0 1 16 0v2M7 11a4 4 0 0 0 0 8M29 11a4 4 0 0 1 0 8M4 27v-2a6 6 0 0 1 5-6m23 8v-2a6 6 0 0 0-5-6"/></>,
  cultura:<><path d="M14 26V9l14-3v17M14 12l14-3"/><ellipse cx="10" cy="27" rx="4" ry="3"/><ellipse cx="24" cy="24" rx="4" ry="3"/></>
 };
 const assets:Record<string,{path:string}>=manifest.assets;
 const path=Object.hasOwn(assets,category)?assets[category].path:null;
 return <span className="category-symbol" aria-hidden="true">{path&&failedPath!==path?<Image className="category-art" src={path} alt="" width={160} height={106} onError={()=>setFailedPath(path)}/>:<svg viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{Object.hasOwn(paths,category)?paths[category]:<circle cx="18" cy="18" r="10"/>}</svg>}</span>;
}
