import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

test('pagination, series visibility and authorization regression', async()=>{
  const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,supportBigNumbers:true,bigNumberStrings:true});
  const suffix=Date.now().toString(36);let userId,adminId,seriesId,ids=[];
  async function client(){let cookie='',csrf='';async function call(path,method='GET',body){const r=await fetch((process.env.TEST_BASE_URL||'http://localhost:3000/api')+path,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});let c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return {status:r.status,data:(await r.json()).data}} async function token(){csrf=(await call('/auth/csrf')).data.token}async function login(name){await token();assert.equal((await call('/auth/login','POST',{username:name,password:'campus123'})).status,200);await token()}return {call,token,login}}
  try{
    const hash=await bcrypt.hash('campus123',10);
    let [u]=await db.execute('INSERT INTO users(username,password_hash,nickname) VALUES (?,?,?)',['test'+suffix,hash,'测试用户']);userId=u.insertId;
    let [ad]=await db.execute('INSERT INTO users(username,password_hash,nickname,role) VALUES (?,?,?,?)',['admin'+suffix,hash,'测试管理员','ADMIN']);adminId=ad.insertId;
    let [sr]=await db.execute('INSERT INTO series(author_id,name,description) VALUES (?,?,?)',[userId,'测试专栏','分页测试']);seriesId=sr.insertId;
    for(let i=0;i<13;i++){let [a]=await db.execute('INSERT INTO articles(author_id,category_id,title,summary,body_markdown,status,published_at,first_published_at) VALUES (?,1,?,?,?, ?,NOW(),NOW())',[userId,`测试章节${i}`,`测试摘要${i}`,'## 标题\n测试正文',i===1?'DRAFT':'PUBLISHED']);ids.push(a.insertId);await db.execute('INSERT INTO series_articles(series_id,article_id,sort_order) VALUES (?,?,?)',[seriesId,a.insertId,i])}
    const guest=await client();await guest.token();assert.equal((await guest.call('/articles/'+ids[1])).status,404);assert.equal((await guest.call('/articles/'+ids[1]+'/comments')).status,404);assert.equal((await guest.call('/articles/'+ids[0]+'/favorite','PUT')).status,401);assert.equal((await guest.call('/me/favorites')).status,401);
    const first=await guest.call('/articles/'+ids[0]);assert.equal(first.data.series.next.id,String(ids[2]));assert.equal(first.data.series.previous,null);
    const second=await guest.call('/articles/'+ids[2]);assert.equal(second.data.series.previous.id,String(ids[0]));
    const authorPage1=await guest.call('/articles?authorId='+userId+'&page=1&pageSize=10');const authorPage2=await guest.call('/articles?authorId='+userId+'&page=2&pageSize=10');assert.equal(Number(authorPage1.data.total),12);assert.equal(authorPage1.data.items.length,10);assert.equal(authorPage2.data.items.length,2);
    const owner=await client();await owner.login('test'+suffix);
    for(let i=0;i<11;i++)assert.equal((await owner.call('/articles/'+ids[0]+'/comments','POST',{content:'分页评论 '+i})).status,200);
    const comments1=await guest.call('/articles/'+ids[0]+'/comments?page=1&pageSize=10');const comments2=await guest.call('/articles/'+ids[0]+'/comments?page=2&pageSize=10');assert.equal(Number(comments1.data.total),11);assert.equal(comments1.data.items.length,10);assert.equal(comments2.data.items.length,1);
    const stranger=await client();await stranger.login('reader');assert.equal((await stranger.call('/comments/'+comments1.data.items[0].id,'DELETE')).status,404);assert.equal((await stranger.call('/articles/'+ids[0]+'/comments','POST',{content:'x'.repeat(501)})).status,422);
    assert.equal((await stranger.call('/articles/'+ids[1]+'/favorite','PUT')).status,404);
    const rootComment=comments2.data.items[0].id;
    const directReply=await stranger.call('/articles/'+ids[0]+'/comments','POST',{content:'第一层回复',replyToId:rootComment});assert.equal(directReply.status,200);
    const nestedReply=await owner.call('/articles/'+ids[0]+'/comments','POST',{content:'回复第一层',replyToId:directReply.data.id});assert.equal(nestedReply.status,200);assert.equal(nestedReply.data.rootId,rootComment);
    const located=await guest.call('/articles/'+ids[0]+'/comments?targetId='+nestedReply.data.id);assert.equal(located.data.page,2);const thread=located.data.items.find(c=>c.id===rootComment);assert.equal(thread.replies.length,2);const nested=thread.replies.find(r=>r.id===nestedReply.data.id);assert.equal(nested.replyToId,directReply.data.id);assert.equal(nested.replyToNickname,'小周');
    const history=await guest.call('/users/'+userId+'/replies');assert.ok(history.data.items.some(c=>c.id===nestedReply.data.id));
    await db.execute('UPDATE articles SET status="OFFLINE" WHERE id=?',[ids[0]]);assert.equal((await guest.call('/users/'+userId+'/replies')).data.total,0);await db.execute('UPDATE articles SET status="PUBLISHED" WHERE id=?',[ids[0]]);
    assert.equal((await owner.call('/articles/'+ids[2]+'/comments','POST',{content:'跨帖子回复',replyToId:directReply.data.id})).status,422);

    assert.equal((await stranger.call('/articles/'+ids[0]+'/favorite','PUT')).status,200);await db.execute('UPDATE articles SET status="OFFLINE" WHERE id=?',[ids[0]]);assert.equal((await guest.call('/articles/'+ids[0])).status,404);assert.equal((await stranger.call('/articles/'+ids[0]+'/comments','POST',{content:'不能评论'})).status,404);const hidden=await stranger.call('/me/favorites');const entry=hidden.data.items.find(item=>item.id===String(ids[0]));assert.equal(entry.available,false);assert.equal(entry.title,null);assert.equal((await stranger.call('/articles/'+ids[0]+'/favorite','DELETE')).status,200);await db.execute('UPDATE articles SET status="PUBLISHED" WHERE id=?',[ids[0]]);
    const admin=await client();await admin.token();assert.equal((await admin.call('/auth/login','POST',{username:'admin'+suffix,password:'campus123'})).status,401);
    await db.execute('UPDATE users SET status="DISABLED" WHERE id=?',[userId]);assert.equal((await owner.call('/articles/'+ids[0]+'/favorite','PUT')).status,401);
  }finally{
    if(ids.length){const marks=ids.map(()=>'?').join(',');await db.query(`DELETE FROM notifications WHERE article_id IN (${marks})`,ids);await db.query(`DELETE FROM favorites WHERE article_id IN (${marks})`,ids);await db.query(`DELETE FROM comments WHERE article_id IN (${marks}) AND parent_id IS NOT NULL`,ids);await db.query(`DELETE FROM comments WHERE article_id IN (${marks})`,ids);await db.query(`DELETE FROM series_articles WHERE article_id IN (${marks})`,ids);await db.query(`DELETE FROM articles WHERE id IN (${marks})`,ids)}
    if(seriesId)await db.execute('DELETE FROM series WHERE id=?',[seriesId]);if(userId)await db.execute('DELETE FROM users WHERE id=?',[userId]);if(adminId)await db.execute('DELETE FROM users WHERE id=?',[adminId]);await db.end();
  }
});
