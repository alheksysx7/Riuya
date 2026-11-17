import type { NextConfig } from "next";

const nextConfig: NextConfig = {
 output: process.env.RIUYA_STANDALONE === '1' ? 'standalone' : undefined,
 async headers(){return [{source:'/sw.js',headers:[
  {key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},
  {key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self'"}
 ]}];}
};
export default nextConfig;
