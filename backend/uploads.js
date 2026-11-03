import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

export function installUploads(app,{ok,fail,wrap}) {
  const directory=fileURLToPath(new URL('./uploads/',import.meta.url));
  const receive=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,parts:3}}).single('image');
  app.use('/uploads',express.static(directory,{dotfiles:'deny',index:false,maxAge:'1d',setHeaders(res){res.set('X-Content-Type-Options','nosniff');}}));
  app.post('/api/uploads/images',(req,res,next)=>req.user?next():next(fail(401,'请先登录')),
    (req,res,next)=>receive(req,res,e=>e?next(fail(422,e.code==='LIMIT_FILE_SIZE'?'图片不能超过5MB':'请选择一张图片并使用image字段上传')):next()),
    wrap(async(req,res)=>{
      if(!req.file)throw fail(422,'请选择图片');
      let buffer;
      try {
        const image=sharp(req.file.buffer,{limitInputPixels:20000000,failOn:'warning'});
        const metadata=await image.metadata();
        if(!['jpeg','png','webp'].includes(metadata.format))throw Error('unsupported');
        // Decode and re-encode to reject disguised files and discard active payloads and EXIF metadata.
        buffer=await image.rotate().resize({width:1920,height:1920,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer();
      } catch {throw fail(422,'只支持有效的JPEG、PNG、WebP图片，且像素总数不超过2000万');}
      await mkdir(directory,{recursive:true});const name=randomUUID()+'.webp';await writeFile(directory+name,buffer,{flag:'wx'});
      ok(res,{path:'/uploads/'+name});
    }));
}
