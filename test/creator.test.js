import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

test('author lifecycle, review races, ownership, series visibility and profile persistence',async()=>{
  const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'onlycampus',timezone:'Z'});
  const suffix=Date.now().toString(36),users=[],articles=[],seriesIds=[];
  const client=()=>({cookie:'',csrf:'',async call(path,method='GET',body){const r=await fetch((process.env.TEST_BASE_URL||'http://localhost:3000/api')+path,{method,headers:{cookie:this.cookie,'X-CSRF-Token':this.csrf,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const cookie=r.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];return {status:r.status,...await r.json()};},async login(username){this.csrf=(await this.call('/auth/csrf')).data.token;const r=await this.call('/auth/login','POST',{username,password:'creatorTest123'});assert.equal(r.status,200,JSON.stringify(r));this.csrf=r.data.csrfToken;}});
  const owner=client(),other=client(),admin=client(),guest=client();
  const call=async(c,path,method='GET',body,expected=200)=>{const r=await c.call(path,method,body);assert.equal(r.status,expected,JSON.stringify(r));return r.data;};
  let category;
  try{
    const hash=await bcrypt.hash('creatorTest123',10);
    for(const role of ['USER','USER','ADMIN']){const name='creator'+users.length+suffix;const [r]=await db.execute('INSERT INTO users(username,password_hash,nickname,role) VALUES (?,?,?,?)',[name,hash,name,role]);users.push(String(r.insertId));await [owner,other,admin][users.length-1].login(name);}
    await call(guest,'/studio/articles','GET',undefined,401);await call(admin,'/studio/articles','GET',undefined,403);
    category=(await call(admin,'/admin/categories','POST',{name:'创作测试'+suffix,enabled:true,sortOrder:0})).id;
    const a=await call(owner,'/studio/articles','POST',{});articles.push(a.id);const path='/studio/articles/'+a.id;
    await call(other,path,'GET',undefined,404);await call(other,path,'PATCH',{version:1},404);
    await call(owner,path+'/submit','POST',{version:1},422);
    let d=await call(owner,path);assert.equal(d.title,'');
    const content={title:'完整创作测试',summary:'这是一段用于发布审核流程的有效测试摘要。',bodyMarkdown:'## 第一个阶段\n这是一篇足够长的文章，用来测试草稿保存、提交与真实审核发布流程。',categoryId:String(category),tagIds:[],coverPath:null};
    await call(owner,path,'PATCH',{...content,version:d.version});
    await call(owner,path,'PATCH',{...content,version:1},409);
    // Saving survives a new authenticated session.
    await owner.login('creator0'+suffix);d=await call(owner,path);assert.equal(d.bodyMarkdown,content.bodyMarkdown);
    await call(owner,path+'/submit','POST',{version:d.version});d=await call(owner,path);
    await call(owner,path,'PATCH',{...content,version:d.version},409);await call(owner,path,'DELETE',{version:d.version},409);
    await call(admin,'/admin/articles/'+a.id+'/review','POST',{action:'REJECT',reason:'请补充成果',version:d.version});
    d=await call(owner,path);assert.equal(d.status,'REJECTED');assert.equal(d.history[0].reason,'请补充成果');
    await call(owner,path,'PATCH',{...content,version:d.version});d=await call(owner,path);assert.equal(d.status,'REJECTED');
    await call(owner,path+'/submit','POST',{version:d.version});d=await call(owner,path);
    const race=await Promise.all([owner.call(path+'/withdraw','POST',{version:d.version}),admin.call('/admin/articles/'+a.id+'/review','POST',{action:'APPROVE',version:d.version})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    d=await call(owner,path);if(d.status==='DRAFT'){await call(owner,path+'/submit','POST',{version:d.version});d=await call(owner,path);await call(admin,'/admin/articles/'+a.id+'/review','POST',{action:'APPROVE',version:d.version});}
    d=await call(owner,path);const first=d.firstPublishedAt;await call(guest,'/articles/'+a.id);assert.ok((await call(guest,'/home')).latest.some(x=>x.id===a.id));assert.ok((await call(owner,'/me/notifications')).items.some(n=>n.articleId===a.id&&n.type==='APPROVED'));
    await call(owner,path,'PATCH',{...content,version:d.version},409);
    await call(admin,'/admin/articles/'+a.id+'/featured','PATCH',{featured:true});await call(owner,path+'/withdraw','POST',{version:d.version});await call(guest,'/articles/'+a.id,'GET',undefined,404);
    const [[featured]]=await db.execute('SELECT is_featured FROM articles WHERE id=?',[a.id]);assert.equal(featured.is_featured,0);
    d=await call(owner,path);await call(owner,path+'/submit','POST',{version:d.version});d=await call(owner,path);await call(admin,'/admin/articles/'+a.id+'/review','POST',{action:'APPROVE',version:d.version});d=await call(owner,path);assert.equal(d.firstPublishedAt,first);
    await call(admin,'/admin/articles/'+a.id+'/offline','POST',{version:d.version,reason:'需要整改内容'});d=await call(owner,path);await call(owner,path,'PATCH',{...content,version:d.version},409);await call(owner,path+'/revise','POST',{version:d.version});d=await call(owner,path);await call(owner,path+'/submit','POST',{version:d.version});d=await call(owner,path);await call(admin,'/admin/articles/'+a.id+'/review','POST',{action:'APPROVE',version:d.version});
    const [[events]]=await db.execute('SELECT COUNT(*) count FROM publication_events WHERE article_id=?',[a.id]);assert.equal(events.count,1);
    const draft=await call(owner,'/studio/articles','POST',{});articles.push(draft.id);
    const s=await call(owner,'/studio/series','POST',{name:'成长专栏',description:'测试专栏',isPublic:true});seriesIds.push(s.id);
    await call(other,'/studio/series/'+s.id,'GET',undefined,404);
    await call(owner,'/studio/series/'+s.id+'/articles','PUT',{articles:[{id:a.id,stage:'成果'},{id:draft.id,stage:'起步'}],expectedIds:[]});
    const pub=await call(guest,'/series/'+s.id);assert.equal(pub.count,1);assert.deepEqual(pub.articles.map(x=>x.id),[a.id]);assert.equal(pub.updatedAt,pub.articles[0].updatedAt);
    await call(owner,'/studio/series/'+s.id+'/articles','PUT',{articles:[],expectedIds:[]},409);
    await call(owner,'/studio/series/'+s.id+'/articles','PUT',{articles:[{id:draft.id,stage:'起步'},{id:a.id,stage:'成果'}],expectedIds:[a.id,draft.id]});
    assert.equal((await call(owner,'/studio/series/'+s.id)).articles[0].id,draft.id);
    const s2=await call(owner,'/studio/series','POST',{name:'另一个专栏',description:'',isPublic:true});seriesIds.push(s2.id);
    await call(owner,'/studio/series/'+s2.id+'/articles','PUT',{articles:[{id:a.id}],expectedIds:[]},409);
    await call(owner,'/studio/series/'+s.id,'PATCH',{name:'成长专栏',description:'',isPublic:false});await call(guest,'/series/'+s.id,'GET',undefined,404);await call(guest,'/articles/'+a.id);
    await call(owner,'/studio/series/'+s.id,'DELETE',{});assert.equal((await call(owner,path)).status,'PUBLISHED');
    await call(owner,'/me/profile','PATCH',{nickname:'更新后的昵称',bio:'新的简介',avatarPath:null});assert.equal((await call(owner,'/auth/me')).nickname,'更新后的昵称');assert.equal((await call(guest,'/users/'+users[0]+'/profile')).bio,'新的简介');
    await call(owner,'/studio/articles/'+draft.id,'DELETE',{version:1});await call(owner,'/studio/articles/'+draft.id,'GET',undefined,404);
  }finally{
    for(const sid of seriesIds){await db.execute('DELETE FROM series_articles WHERE series_id=?',[sid]);await db.execute('DELETE FROM series WHERE id=?',[sid]);}
    for(const aid of articles){for(const table of ['notifications','review_records','publication_events','article_tags','favorites','series_articles'])await db.execute(`DELETE FROM ${table} WHERE article_id=?`,[aid]);await db.execute('DELETE FROM articles WHERE id=?',[aid]);}
    if(category)await db.execute('DELETE FROM categories WHERE id=?',[category]);
    for(const uid of users){await db.execute('DELETE FROM admin_logs WHERE actor_id=?',[uid]);await db.execute('DELETE FROM users WHERE id=?',[uid]);}
    await db.end();
  }
});
