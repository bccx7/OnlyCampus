import 'dotenv/config';
import mysql from 'mysql2/promise';
if(process.env.NODE_ENV==='production')throw Error('Demo data is not permitted in production.');
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'onlycampus'});
try {
  await db.query("SET time_zone='+00:00'");
  const [[author]]=await db.query("SELECT id FROM users WHERE username='author' AND role='USER'");
  if(!author)throw Error('Run db:init on a local demonstration database first.');
  const [existing]=await db.query("SELECT id FROM articles WHERE author_id=? AND title='后台审核演示文章' AND deleted_at IS NULL",[author.id]);
  if(!existing.length)await db.execute("INSERT INTO articles(author_id,title,summary,body_markdown,status) VALUES (?,?,?,?,'PENDING')",[author.id,'后台审核演示文章','这是一篇供本地演示审核、下架和站内通知使用的文章。','## 项目记录\n这篇文章是明确标记的演示内容。\n\n## 演示顺序\n管理员审核后，作者可以在通知页看到处理结果。']);
  console.log('Local pending article prepared. No existing article state was reset.');
} finally {await db.end();}
