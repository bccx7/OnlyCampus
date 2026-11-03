import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import {unlink} from 'node:fs/promises';

test('operations permissions, transactional review, notifications, moderation and revocation',async()=>{
  const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  const suffix=Date.now().toString(36),users=[];let article,category,tag,uploaded;
  function client(){let cookie='',csrf='';return {async upload(buffer,name='cover.png'){const form=new FormData();form.append('image',new Blob([buffer],{type:'image/png'}),name);const r=await fetch('http://localhost:3000/api/uploads/images',{method:'POST',headers:{cookie,'X-CSRF-Token':csrf},body:form});return {status:r.status,...await r.json()};},async call(path,method='GET',body){const r=await fetch((process.env.TEST_BASE_URL||'http://localhost:3000/api')+path,{method,headers:{cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,...await r.json()};},async login(username){csrf=(await this.call('/auth/csrf')).data.token;const r=await this.call('/auth/login','POST',{username,password:'testPassword123'});assert.equal(r.status,200,JSON.stringify(r));csrf=r.data.csrfToken;return r;}};}
  const admin=client(),owner=client(),stranger=client(),stale=client(),guest=client();
  const call=async(c,path,method,body,expected=200)=>{const r=await c.call(path,method,body);assert.equal(r.status,expected,JSON.stringify(r));return r.data;};
  try{
    const hash=await bcrypt.hash('testPassword123',10);
    for(const [name,role] of [['opsadmin','ADMIN'],['opsowner','USER'],['opsreader','USER']]){const [r]=await db.execute('INSERT INTO users(username,password_hash,nickname,role) VALUES (?,?,?,?)',[name+suffix,hash,name,role]);users.push(r.insertId);}
    const adminLogin=await admin.login('opsadmin'+suffix);assert.equal(adminLogin.data.user.role,'ADMIN');await owner.login('opsowner'+suffix);await stranger.login('opsreader'+suffix);await stale.login('opsowner'+suffix);
    await call(guest,'/admin/overview','GET',null,401);await call(owner,'/admin/overview','GET',null,403);
    category=(await call(admin,'/admin/categories','POST',{name:'测试分类'+suffix,enabled:true,sortOrder:3})).id;
    tag=(await call(admin,'/admin/tags','POST',{name:'测试标签'+suffix,enabled:true,sortOrder:0})).id;
    const [a]=await db.execute("INSERT INTO articles(author_id,category_id,title,summary,body_markdown,status) VALUES (?,?,?,? ,?,'PENDING')",[users[1],category,'审核测试'+suffix,'用于验证审核流程的文章摘要','## 测试正文\n这是后台测试准备的内容。']);article=a.insertId;
    await call(admin,'/admin/categories/'+category,'DELETE',null,409);
    await call(admin,'/admin/articles/'+article+'/review','POST',{action:'REJECT',version:1,reason:''},422);
    const race=await Promise.all([admin.call('/admin/articles/'+article+'/review','POST',{action:'APPROVE',version:1,reason:''}),admin.call('/admin/articles/'+article+'/review','POST',{action:'APPROVE',version:1,reason:''})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const [[events]]=await db.execute('SELECT COUNT(*) count FROM publication_events WHERE article_id=?',[article]);assert.equal(events.count,1);
    const notices=await call(owner,'/me/notifications');assert.equal(notices.total,1);const notice=notices.items[0];
    await call(stranger,'/me/notifications/'+notice.id+'/read','PATCH',{},404);
    await call(owner,'/me/notifications/'+notice.id+'/read','PATCH',{});assert.equal((await call(owner,'/me/notifications/unread-count')).count,0);
    await call(admin,'/admin/articles/'+article+'/featured','PATCH',{featured:true});
    await call(admin,'/admin/articles/'+article+'/offline','POST',{version:2,reason:'需要补充来源'});
    await call(guest,'/articles/'+article,'GET',null,404);
    assert.equal((await call(admin,'/admin/articles/'+article)).featured,0);
    await db.execute("UPDATE articles SET status='PENDING',version=4 WHERE id=?",[article]);
    await call(admin,'/admin/articles/'+article+'/review','POST',{action:'REJECT',version:4,reason:'请补充具体内容'});
    await db.execute("UPDATE articles SET status='PENDING',version=6 WHERE id=?",[article]);
    await call(admin,'/admin/articles/'+article+'/review','POST',{action:'APPROVE',version:6});
    const [[repub]]=await db.execute('SELECT COUNT(*) count FROM publication_events WHERE article_id=?',[article]);assert.equal(repub.count,1);
    // Force notification failure: article status and audit history must roll back too.
    await db.execute("UPDATE articles SET status='PENDING',version=8 WHERE id=?",[article]);
    await db.execute("INSERT INTO notifications(recipient_id,actor_id,type,article_id,summary,event_key) VALUES (?,?,'APPROVED',?,'故障注入',?)",[users[1],users[0],article,`review:${article}:9`]);
    await call(admin,'/admin/articles/'+article+'/review','POST',{action:'APPROVE',version:8},500);
    const after=await call(admin,'/admin/articles/'+article);assert.equal(after.status,'PENDING');assert.equal(after.version,8);assert.equal(after.history.length,4);
    await db.execute("UPDATE articles SET status='PUBLISHED',version=9 WHERE id=?",[article]);
    const comment=await call(stranger,'/articles/'+article+'/comments','POST',{content:'通知与治理测试'});
    await call(admin,'/admin/comments/'+comment.id+'/status','PATCH',{status:'HIDDEN',reason:'测试隐藏评论'});
    await call(admin,'/admin/comments/'+comment.id+'/status','PATCH',{status:'VISIBLE',reason:'尝试恢复'},422);
    await call(owner,'/me/notifications/read-all','POST');assert.equal((await call(owner,'/me/notifications/unread-count')).count,0);
    const trend=await call(admin,'/admin/statistics/publications');assert.equal(trend.length,7);assert.ok(trend.every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.day)));assert.ok(trend.some(d=>Number(d.count)===0));
    const month=await call(admin,'/admin/statistics/publications?days=30');assert.equal(month.length,30);await call(admin,'/admin/statistics/publications?days=366','GET',null,400);
    const searched=await call(admin,'/admin/users?q='+encodeURIComponent('opsowner'+suffix));assert.equal(searched.total,1);assert.equal(searched.items[0].id,String(users[1]));const literal=await call(admin,'/admin/users?q=%25');assert.ok(literal.items.every(u=>u.username.includes('%')||u.nickname.includes('%')));
    await call(admin,'/admin/users/'+users[0]+'/status','PATCH',{status:'DISABLED',reason:'测试保护管理员'},403);
    await call(admin,'/admin/users/'+users[1]+'/status','PATCH',{status:'DISABLED',reason:'测试账号禁用'});
    await call(owner,'/auth/me','GET',null,401);
    await call(admin,'/admin/users/'+users[1]+'/status','PATCH',{status:'ACTIVE',reason:'测试恢复账号'});
    await call(stale,'/auth/me','GET',null,401);await owner.login('opsowner'+suffix);
    await call(admin,'/admin/tags/'+tag,'DELETE');tag=null;
    const invalid=await owner.upload(Buffer.from('<script>alert(1)</script>'));assert.equal(invalid.status,422);
    const png=await sharp({create:{width:2,height:2,channels:3,background:'#2f5d50'}}).png().toBuffer();const image=await owner.upload(png);assert.equal(image.status,200,JSON.stringify(image));uploaded=image.data.path;assert.match(uploaded,/^\/uploads\/[a-f0-9-]+\.webp$/);
    assert.equal((await fetch('http://localhost:3000'+uploaded)).headers.get('content-type'),'image/webp');
  }finally{
    if(uploaded)await unlink(new URL('../backend'+uploaded,import.meta.url));
    if(article){for(const t of ['notifications','review_records','publication_events','favorites','comments'])await db.execute(`DELETE FROM ${t} WHERE article_id=?`,[article]);await db.execute('DELETE FROM articles WHERE id=?',[article]);}
    if(users[0])await db.execute('DELETE FROM admin_logs WHERE actor_id=?',[users[0]]);
    if(category)await db.execute('DELETE FROM categories WHERE id=?',[category]);if(tag)await db.execute('DELETE FROM tags WHERE id=?',[tag]);
    for(const u of users)await db.execute('DELETE FROM users WHERE id=?',[u]);await db.end();
  }
});
