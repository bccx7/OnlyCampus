import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import {installOperations} from './operations.js';
import {notify} from './notifications.js';
import {installUploads} from './uploads.js';

const app=express();
const db=mysql.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'onlycampus',supportBigNumbers:true,bigNumberStrings:true,timezone:'Z'});
db.on('connection', connection=>connection.query("SET time_zone = '+00:00'"));
class MysqlStore extends session.Store {
  async get(id,cb){try{const [r]=await db.execute('SELECT data FROM sessions WHERE sid=? AND expires_at > NOW()',[id]);cb(null,r.length?JSON.parse(r[0].data):null)}catch(e){cb(e)}}
  async set(id,value,cb){try{await db.execute('REPLACE INTO sessions(sid,data,expires_at) VALUES (?,?,DATE_ADD(NOW(), INTERVAL 7 DAY))',[id,JSON.stringify(value)]);cb?.()}catch(e){cb?.(e)}}
  async destroy(id,cb){try{await db.execute('DELETE FROM sessions WHERE sid=?',[id]);cb?.()}catch(e){cb?.(e)}}
}
app.use(express.json({limit:'100kb'}));
if(process.env.NODE_ENV==='production')app.set('trust proxy',1);
if(process.env.NODE_ENV==='production' && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32)) throw Error('SESSION_SECRET must be at least 32 characters');
app.use(session({store:new MysqlStore(),secret:process.env.SESSION_SECRET||'development-only-change-this-secret',resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:604800000}}));
const ok=(res,data)=>res.json({code:'OK',message:'操作成功',data});
const fail=(status,message)=>Object.assign(new Error(message),{status});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.use('/api',wrap(async(req,res,next)=>{if(req.session.userId){const [[u]]=await db.execute('SELECT id,nickname,role,status,session_version FROM users WHERE id=?',[req.session.userId]); if(!u||u.status!=='ACTIVE'||Number(req.session.sessionVersion??0)!==u.session_version){req.session.destroy(()=>{});return next(fail(401,'账号不可用，请重新登录'))}else req.user=u;} next()}));
const auth=(req,res,next)=>req.user?.role==='USER'?next():next(fail(req.user?403:401,req.user?'无操作权限':'请先登录'));
const loggedIn=(req,res,next)=>req.user?next():next(fail(401,'请先登录'));
app.get('/api/auth/csrf',(req,res)=>{req.session.csrf ||= crypto.randomBytes(32).toString('hex');ok(res,{token:req.session.csrf})});
app.use('/api', (req,res,next)=>{if(['POST','PUT','PATCH','DELETE'].includes(req.method) && (!req.session.csrf || req.get('X-CSRF-Token')!==req.session.csrf)) return next(fail(403,'请求验证失败，请刷新页面')); next()});
app.get('/api/auth/me',(req,res)=>ok(res,req.user||null));
const loginAttempts=new Map();
const dummyPasswordHash=bcrypt.hashSync('onlycampus-invalid-account',12);
const loginWindow=15*60*1000;
const cleanupAttempts=setInterval(()=>{for(const [key,value] of loginAttempts)if(value.until<Date.now())loginAttempts.delete(key)},60000);cleanupAttempts.unref();
const registrationAttempts=new Map();
const cleanupRegistrations=setInterval(()=>{for(const [key,value] of registrationAttempts)if(value.until<Date.now())registrationAttempts.delete(key)},60000);cleanupRegistrations.unref();
async function establishUserSession(req,res,u){
  await new Promise((resolve,reject)=>req.session.regenerate(err=>err?reject(err):resolve()));
  req.session.userId=String(u.id);req.session.sessionVersion=u.session_version??0;req.session.csrf=crypto.randomBytes(32).toString('hex');
  await new Promise((resolve,reject)=>req.session.save(err=>err?reject(err):resolve()));
  ok(res,{user:{id:String(u.id),nickname:u.nickname,role:u.role||'USER'},csrfToken:req.session.csrf});
}
app.post('/api/auth/register',wrap(async(req,res)=>{
  const username=typeof req.body.username==='string'?req.body.username.trim():'';
  const nickname=typeof req.body.nickname==='string'?req.body.nickname.trim():'';
  const password=typeof req.body.password==='string'?req.body.password:'';
  if(!/^[a-zA-Z0-9_]{4,24}$/.test(username))throw fail(422,'账号需为4—24位字母、数字或下划线');
  if(nickname.length<2 || nickname.length>30)throw fail(422,'昵称需为2—30字');
  if(password.length<8 || password.length>64 || Buffer.byteLength(password)>72)throw fail(422,'密码需为8—64位');
  if(password!==req.body.passwordConfirmation)throw fail(422,'两次输入的密码不一致');
  let attempts=registrationAttempts.get(req.ip);if(!attempts || attempts.until<Date.now()){attempts={count:0,until:Date.now()+loginWindow};registrationAttempts.set(req.ip,attempts)}
  if(attempts.count>=10){res.set('Retry-After',String(Math.ceil((attempts.until-Date.now())/1000)));throw fail(429,'注册尝试过于频繁，请稍后再试')}attempts.count++;
  const hash=await bcrypt.hash(password,12);let result;
  try{[result]=await db.execute('INSERT INTO users(username,nickname,password_hash,role,status) VALUES (?,?,?,"USER","ACTIVE")',[username,nickname,hash])}catch(e){if(e.code==='ER_DUP_ENTRY')throw fail(409,'该账号已被使用，请换一个');throw e}
  await establishUserSession(req,res,{id:result.insertId,nickname});
}));
app.post('/api/auth/login',wrap(async(req,res)=>{
  const username=typeof req.body.username==='string'?req.body.username.trim():'';
  const password=typeof req.body.password==='string'?req.body.password:'';
  if(!/^[a-zA-Z0-9_]{4,24}$/.test(username) || password.length<8 || password.length>64)throw fail(422,'请输入4—24位账号和8—64位密码');
  const key=req.ip;let attempts=loginAttempts.get(key);
  if(!attempts || attempts.until<Date.now()){attempts={count:0,until:Date.now()+loginWindow};loginAttempts.set(key,attempts)}
  if(attempts.count>=20){res.set('Retry-After',String(Math.ceil((attempts.until-Date.now())/1000)));throw fail(429,'登录尝试过于频繁，请稍后再试')}
  attempts.count++;
  const [[u]]=await db.execute('SELECT id,password_hash,status,role,nickname,session_version FROM users WHERE username=?',[username]);
  const valid=await bcrypt.compare(password,u?.password_hash||dummyPasswordHash);
  if(!valid || !u || u.status!=='ACTIVE')throw fail(401,'账号或密码错误，或账号不可用');
  await establishUserSession(req,res,u);
}));
app.post('/api/auth/logout',wrap(async(req,res)=>{
  await new Promise((resolve,reject)=>req.session.destroy(err=>err?reject(err):resolve()));
  res.clearCookie('connect.sid',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'});ok(res,null);
}));
installOperations(app,db,{ok,fail,wrap});
installUploads(app,{ok,fail,wrap});
const articleSelect="SELECT CAST(a.id AS CHAR) id,a.title,a.summary,a.cover_path coverPath,a.published_at publishedAt,a.updated_at updatedAt,CAST(u.id AS CHAR) authorId,u.nickname author,c.name category,(SELECT COUNT(*) FROM comments cmt WHERE cmt.article_id=a.id AND cmt.status='VISIBLE') commentCount FROM articles a JOIN users u ON u.id=a.author_id LEFT JOIN categories c ON c.id=a.category_id";
const visible="a.status='PUBLISHED' AND a.deleted_at IS NULL";
const page=req=>({page:Math.max(1,Math.min(10000,parseInt(req.query.page)||1)),pageSize:Math.max(1,Math.min(50,parseInt(req.query.pageSize)||10))});
app.get('/api/taxonomy',wrap(async(req,res)=>{const [categories]=await db.query('SELECT CAST(id AS CHAR) id,name FROM categories WHERE is_enabled=1 ORDER BY sort_order,id');const [tags]=await db.query('SELECT CAST(id AS CHAR) id,name FROM tags WHERE is_enabled=1 ORDER BY id');ok(res,{categories,tags})}));
async function annotateFavorites(items,user){if(!user||!items.length)return items;const ids=[...new Set(items.map(item=>item.id))];const [rows]=await db.query(`SELECT CAST(article_id AS CHAR) id FROM favorites WHERE user_id=? AND article_id IN (?)`,[user.id,ids]);const saved=new Set(rows.map(row=>row.id));return items.map(item=>({...item,favorited:saved.has(item.id)}));}
app.get('/api/home',wrap(async(req,res)=>{const [featured]=await db.query(`${articleSelect} WHERE ${visible} AND a.is_featured=1 ORDER BY a.published_at DESC LIMIT 4`);const [latest]=await db.query(`${articleSelect} WHERE ${visible} ORDER BY a.published_at DESC,a.id DESC LIMIT 6`);const [series]=await db.query(`SELECT CAST(s.id AS CHAR) id,s.name,s.description,CAST(s.author_id AS CHAR) authorId FROM series s WHERE s.is_public=1 AND EXISTS(SELECT 1 FROM series_articles sa JOIN articles a ON a.id=sa.article_id WHERE sa.series_id=s.id AND ${visible}) LIMIT 6`);ok(res,{featured:await annotateFavorites(featured,req.user),latest:await annotateFavorites(latest,req.user),series})}));
app.get('/api/trends',wrap(async(req,res)=>{const [rows]=await db.query('SELECT term,count FROM search_terms ORDER BY count DESC,updated_at DESC,term LIMIT 10');ok(res,rows)}));
app.get('/api/articles',wrap(async(req,res,next)=>{const term=typeof req.query.q==='string'?req.query.q.trim().slice(0,100):'';if(term && !req.query.page)await db.execute('INSERT INTO search_terms(term) VALUES (?) ON DUPLICATE KEY UPDATE count=count+1,updated_at=NOW()',[term]);next()}));
app.get('/api/articles',wrap(async(req,res)=>{const {page:p,pageSize:n}=page(req);let where=[visible],args=[];if(req.query.q){where.push("(a.title LIKE ? ESCAPE '!' OR a.summary LIKE ? ESCAPE '!')");let q='%'+String(req.query.q).slice(0,100).replace(/[!%_]/g,'!$&')+'%';args.push(q,q)}if(req.query.categoryId){where.push('a.category_id=?');args.push(req.query.categoryId)}if(req.query.tagId){where.push('EXISTS(SELECT 1 FROM article_tags atg WHERE atg.article_id=a.id AND atg.tag_id=?)');args.push(req.query.tagId)}if(req.query.authorId){where.push('a.author_id=?');args.push(req.query.authorId)}let w=where.join(' AND '),sort=req.query.sort==='updated'?'a.updated_at':'a.published_at';const [[count]]=await db.execute(`SELECT COUNT(*) total FROM articles a WHERE ${w}`,args);const [items]=await db.query(`${articleSelect} WHERE ${w} ORDER BY ${sort} DESC,a.id DESC LIMIT ? OFFSET ?`,[...args,n,(p-1)*n]);ok(res,{items:await annotateFavorites(items,req.user),page:p,pageSize:n,total:count.total})}));
app.get('/api/articles/:id',wrap(async(req,res)=>{const [[a]]=await db.execute(`${articleSelect.replace(' FROM articles', ', a.body_markdown bodyMarkdown FROM articles')} WHERE a.id=? AND ${visible}`,[req.params.id]);if(!a)throw fail(404,'文章不存在或已不可用');const [tags]=await db.execute('SELECT t.name FROM tags t JOIN article_tags x ON x.tag_id=t.id WHERE x.article_id=?',[req.params.id]);const [[fav]]=req.user?await db.execute('SELECT 1 yes FROM favorites WHERE user_id=? AND article_id=?',[req.user.id,req.params.id]):[[]];const [[series]]=await db.execute('SELECT CAST(s.id AS CHAR) id,s.name FROM series s JOIN series_articles sa ON sa.series_id=s.id WHERE sa.article_id=? AND s.is_public=1',[req.params.id]);let previous=null,next=null;if(series){const [chapters]=await db.execute(`SELECT CAST(a.id AS CHAR) id,a.title FROM series_articles sa JOIN articles a ON a.id=sa.article_id WHERE sa.series_id=? AND ${visible} ORDER BY sa.sort_order,a.id`,[series.id]);const index=chapters.findIndex(chapter=>chapter.id===String(a.id));if(index>=0){previous=chapters[index-1]||null;next=chapters[index+1]||null}}ok(res,{...a,tags:tags.map(t=>t.name),favorited:!!fav,series:series?{...series,previous,next}:null})}));
app.get('/api/users/:id/profile',wrap(async(req,res)=>{const [[u]]=await db.execute('SELECT CAST(id AS CHAR) id,nickname,bio FROM users WHERE id=?',[req.params.id]);if(!u)throw fail(404,'用户不存在');ok(res,u)}));
app.get('/api/users/:id/series',wrap(async(req,res)=>{const [s]=await db.execute(`SELECT CAST(s.id AS CHAR) id,s.name,s.description FROM series s WHERE s.author_id=? AND s.is_public=1 AND EXISTS(SELECT 1 FROM series_articles sa JOIN articles a ON a.id=sa.article_id WHERE sa.series_id=s.id AND ${visible})`,[req.params.id]);ok(res,s)}));
app.get('/api/users/:id/replies',wrap(async(req,res)=>{const {page:p,pageSize:n}=page(req);const where=`c.user_id=? AND c.status='VISIBLE' AND ${visible}`;const [[count]]=await db.execute(`SELECT COUNT(*) total FROM comments c JOIN articles a ON a.id=c.article_id WHERE ${where}`,[req.params.id]);const [items]=await db.query(`SELECT CAST(c.id AS CHAR) id,c.content,c.created_at createdAt,CAST(c.article_id AS CHAR) articleId,a.title articleTitle,CAST(COALESCE(c.parent_id,c.id) AS CHAR) rootId,tu.nickname replyToNickname,CAST(t.user_id AS CHAR) replyToUserId FROM comments c JOIN articles a ON a.id=c.article_id LEFT JOIN comments t ON t.id=COALESCE(c.reply_to_id,c.parent_id) LEFT JOIN users tu ON tu.id=t.user_id WHERE ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`,[req.params.id,n,(p-1)*n]);ok(res,{items,page:p,pageSize:n,total:Number(count.total)})}));
async function assertArticle(conn,id){const [[a]]=await conn.execute(`SELECT a.author_id FROM articles a WHERE a.id=? AND ${visible}`,[id]);if(!a)throw fail(404,'文章不存在或已不可用');return a}
app.get('/api/articles/:id/comments',wrap(async(req,res)=>{await assertArticle(db,req.params.id);let {page:p,pageSize:n}=page(req);if(req.query.targetId){const [[target]]=await db.execute('SELECT COALESCE(parent_id,id) rootId FROM comments WHERE id=? AND article_id=?',[req.query.targetId,req.params.id]);if(target){const [[rank]]=await db.execute(`SELECT COUNT(*) total FROM comments c JOIN comments root ON root.id=? WHERE c.article_id=? AND c.parent_id IS NULL AND (c.status='VISIBLE' OR EXISTS(SELECT 1 FROM comments r WHERE r.parent_id=c.id AND r.status='VISIBLE')) AND (c.created_at>root.created_at OR (c.created_at=root.created_at AND c.id>root.id))`,[target.rootId,req.params.id]);p=Math.floor(Number(rank.total)/n)+1}}const [[c]]=await db.execute('SELECT COUNT(*) total FROM comments c WHERE c.article_id=? AND c.parent_id IS NULL AND (c.status="VISIBLE" OR EXISTS(SELECT 1 FROM comments r WHERE r.parent_id=c.id AND r.status="VISIBLE"))',[req.params.id]);const [parents]=await db.query('SELECT CAST(c.id AS CHAR) id,CAST(c.user_id AS CHAR) userId,u.nickname,c.status,IF(c.status="VISIBLE",c.content,NULL) content,c.created_at createdAt FROM comments c JOIN users u ON u.id=c.user_id WHERE c.article_id=? AND c.parent_id IS NULL AND (c.status="VISIBLE" OR EXISTS(SELECT 1 FROM comments r WHERE r.parent_id=c.id AND r.status="VISIBLE")) ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?',[req.params.id,n,(p-1)*n]);for(const parent of parents){const [replies]=await db.execute('SELECT CAST(c.id AS CHAR) id,CAST(c.user_id AS CHAR) userId,u.nickname,c.status,IF(c.status="VISIBLE",c.content,NULL) content,c.created_at createdAt,CAST(c.reply_to_id AS CHAR) replyToId,tu.nickname replyToNickname,CAST(t.user_id AS CHAR) replyToUserId FROM comments c JOIN users u ON u.id=c.user_id LEFT JOIN comments t ON t.id=COALESCE(c.reply_to_id,c.parent_id) LEFT JOIN users tu ON tu.id=t.user_id WHERE c.parent_id=? AND c.status="VISIBLE" ORDER BY c.created_at,c.id',[parent.id]);parent.replies=replies}ok(res,{items:parents,page:p,pageSize:n,total:c.total})}));
app.post('/api/articles/:id/comments',auth,wrap(async(req,res)=>{const content=typeof req.body.content==='string'?req.body.content.trim():'';if(!content||content.length>500)throw fail(422,'评论须为1至500字');const conn=await db.getConnection();try{await conn.beginTransaction();const a=await assertArticle(conn,req.params.id);let recipient=a.author_id,type='COMMENT',rootId=null,targetId=null;const requestedTarget=req.body.replyToId||req.body.parentId;if(requestedTarget){const [[p]]=await conn.execute('SELECT id,user_id,parent_id FROM comments WHERE id=? AND article_id=? AND status="VISIBLE"',[requestedTarget,req.params.id]);if(!p)throw fail(422,'回复目标不可用');recipient=p.user_id;type='REPLY';rootId=p.parent_id||p.id;targetId=p.id}const [r]=await conn.execute('INSERT INTO comments(article_id,user_id,parent_id,reply_to_id,content) VALUES (?,?,?,?,?)',[req.params.id,req.user.id,rootId,targetId,content]);await notify(conn,{recipientId:recipient,actorId:req.user.id,type,articleId:req.params.id,commentId:r.insertId,summary:content.slice(0,100),eventKey:`comment:${r.insertId}`});await conn.commit();ok(res,{id:String(r.insertId),rootId:rootId?String(rootId):null})}catch(e){await conn.rollback();throw e}finally{conn.release()}}));
app.delete('/api/comments/:id',auth,wrap(async(req,res)=>{const [r]=await db.execute('UPDATE comments SET status="DELETED" WHERE id=? AND user_id=? AND status="VISIBLE"',[req.params.id,req.user.id]);if(!r.affectedRows)throw fail(404,'评论不存在或不可删除');ok(res,null)}));
app.put('/api/articles/:id/favorite',loggedIn,wrap(async(req,res)=>{await assertArticle(db,req.params.id);await db.execute('INSERT IGNORE INTO favorites(user_id,article_id) VALUES (?,?)',[req.user.id,req.params.id]);ok(res,null)}));
app.delete('/api/articles/:id/favorite',loggedIn,wrap(async(req,res)=>{await db.execute('DELETE FROM favorites WHERE user_id=? AND article_id=?',[req.user.id,req.params.id]);ok(res,null)}));
app.get('/api/me/favorites',loggedIn,wrap(async(req,res)=>{const {page:p,pageSize:n}=page(req);const [[c]]=await db.execute('SELECT COUNT(*) total FROM favorites WHERE user_id=?',[req.user.id]);const [items]=await db.query(`SELECT CAST(f.article_id AS CHAR) id,IF(${visible},a.title,NULL) title,IF(${visible},a.summary,NULL) summary,IF(${visible},u.nickname,NULL) author,IF(${visible},1,0) available FROM favorites f JOIN articles a ON a.id=f.article_id JOIN users u ON u.id=a.author_id WHERE f.user_id=? ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,[req.user.id,n,(p-1)*n]);ok(res,{items:items.map(item=>({...item,available:Boolean(Number(item.available))})),page:p,pageSize:n,total:c.total})}));
app.use('/api',(req,res)=>res.status(404).json({code:'NOT_FOUND',message:'接口不存在'}));
app.use((err,req,res,next)=>{console.error(err);res.status(err.status||500).json({code:err.status?'REQUEST_ERROR':'SERVER_ERROR',message:err.status?err.message:'服务暂时不可用，请稍后重试'})});
app.listen(Number(process.env.PORT||3000),()=>console.log('OnlyCampus API listening'));
