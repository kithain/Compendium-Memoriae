import {defineConfig,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {lstat,readdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PUBLIC_IMAGE_CATEGORIES,isJpeg,publicImagePath} from './src/lib/image-paths';

const publicRoot=fileURLToPath(new URL('./public',import.meta.url));

async function readIllustration(path:string){
  // Public assets must be regular files in the seven selected folders.
  // Following a link here could accidentally publish a private source folder.
  const category=path.split('/')[1];
  for(const directory of [publicRoot,resolve(publicRoot,'images'),resolve(publicRoot,'images',category)]){
    const stat=await lstat(directory);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Les illustrations publiques doivent être dans des dossiers ordinaires.');
  }
  const file=resolve(publicRoot,path);
  const stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Les illustrations publiques doivent être des fichiers ordinaires.');
  const bytes=await readFile(file);
  if(!isJpeg(bytes))throw new Error(`Illustration JPG invalide : ${path}`);
  return bytes;
}

function publicIllustrations():Plugin{
  return {
    name:'compendium-public-illustrations',
    async generateBundle(){
      for(const category of PUBLIC_IMAGE_CATEGORIES){
        const directory=resolve(publicRoot,'images',category);
        let entries;
        try{entries=await readdir(directory,{withFileTypes:true});}
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
        for(const entry of entries){
          const path=`images/${category}/${entry.name}`;
          if(!entry.isFile()||publicImagePath(path)!==path)continue;
          this.emitFile({type:'asset',fileName:path,source:await readIllustration(path)});
        }
      }
    },
    configureServer(server){
      const base=server.config.base.replace(/\/$/,'');
      server.middlewares.use((request,response,next)=>{
        const pathname=request.url?.split(/[?#]/,1)[0]??'';
        if(!pathname.startsWith(`${base}/images/`))return next();
        if(request.method!=='GET'&&request.method!=='HEAD'){
          response.statusCode=405;response.end();return;
        }
        let path:string;
        try{path=decodeURIComponent(pathname.slice(base.length+1));}
        catch{response.statusCode=400;response.end();return;}
        if(/%2f|%5c/i.test(pathname)||publicImagePath(path)!==path){
          response.statusCode=404;response.end();return;
        }
        void readIllustration(path).then(bytes=>{
          response.statusCode=200;
          response.setHeader('Content-Type','image/jpeg');
          response.setHeader('Content-Length',bytes.length);
          response.setHeader('Cache-Control','no-cache');
          response.setHeader('X-Content-Type-Options','nosniff');
          response.end(request.method==='HEAD'?undefined:bytes);
        }).catch(error=>{
          response.statusCode=(error as NodeJS.ErrnoException).code==='ENOENT'?404:500;
          response.end();
        });
      });
    },
  };
}

export default defineConfig({plugins:[react(),publicIllustrations()],publicDir:false,base:'/Compendium-Memoriae/',resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{host:'127.0.0.1'}});
