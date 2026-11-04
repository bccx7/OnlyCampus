// Author routes share the article row lock and version with operations.js.
export function installCreator(app, db, {ok, fail, wrap}) {
  const user = (req,res,next) => req.user?.role === 'USER' ? next() : next(fail(req.user?403:401,'请使用普通用户账号登录'));
  const id = value => {if(!/^[1-9]\d{0,18}$/.test(String(value)))throw fail(400,'编号格式错误');return String(value);};
  const text = (value,min,max,label) => {const s=typeof value==='string'?value.trim():'';if(s.length<min||s.length>max)throw fail(422,`${label}须为${min}至${max}字`);return s;};
  const image = value => {if(value===null||value===undefined||value==='')return null;if(typeof value!=='string'||!/^\/uploads\/[a-zA-Z0-9_-]+\.webp$/.test(value))throw fail(422,'请选择已上传的图片');return value;};
  const paging = req => {const p=Number(req.query.page||1),n=Number(req.query.pageSize||10);if(!Number.isInteger(p)||p<1||p>10000||!Number.isInteger(n)||n<1||n>50)throw fail(400,'分页参数错误');return {p,n};};
  const tx = async fn => {const c=await db.getConnection();try{await c.beginTransaction();const out=await fn(c);await c.commit();return out;}catch(e){await c.rollback();throw e;}finally{c.release();}};
  async function article(c,req,lock=false){const [[a]]=await c.execute(`SELECT * FROM articles WHERE id=? AND author_id=? AND deleted_at IS NULL${lock?' FOR UPDATE':''}`,[id(req.params.id),req.user.id]);if(!a)throw fail(404,'文章不存在');return a;}
  function version(a,req){if(!Number.isInteger(req.body.version)||req.body.version!==a.version)throw fail(409,'文章版本已变化，请先保留内容再刷新');}
  async function series(c,req,lock=false){const [[s]]=await c.execute(`SELECT * FROM series WHERE id=? AND author_id=?${lock?' FOR UPDATE':''}`,[id(req.params.id),req.user.id]);if(!s)throw fail(404,'专栏不存在');return s;}
  const articleFields = `CAST(id AS CHAR) id,title,summary,body_markdown bodyMarkdown,CAST(category_id AS CHAR) categoryId,cover_path coverPath,status,version,created_at createdAt,submitted_at submittedAt,updated_at updatedAt,first_published_at firstPublishedAt,published_at publishedAt`;
  async function validateArticle(c,data,submit=false){
    const title=text(data.title,submit?2:0,80,'标题'),summary=text(data.summary,submit?10:0,200,'摘要');
    const bodyMarkdown=typeof data.bodyMarkdown==='string'?data.bodyMarkdown:'';
    if(bodyMarkdown.length>50000||(submit&&bodyMarkdown.trim().length<20))throw fail(422,'正文提交时至少20字，最多50000字符');
    const categoryId=data.categoryId?id(data.categoryId):null;
    if(submit&&!categoryId)throw fail(422,'请选择分类');
    if(categoryId){const [[cat]]=await c.execute('SELECT id FROM categories WHERE id=? AND is_enabled=1',[categoryId]);if(!cat)throw fail(422,'分类不可用，请重新选择');}
    if(!Array.isArray(data.tagIds)||data.tagIds.length>5)throw fail(422,'最多选择5个标签');
    const tagIds=data.tagIds.map(id);if(new Set(tagIds).size!==tagIds.length)throw fail(422,'标签重复');
    if(tagIds.length){const [tags]=await c.query('SELECT id FROM tags WHERE id IN (?) AND is_enabled=1',[tagIds]);if(tags.length!==tagIds.length)throw fail(422,'标签不可用，请重新选择');}
    return {title,summary,bodyMarkdown,categoryId,tagIds,coverPath:image(data.coverPath)};
  }
  app.get('/api/studio/overview',user,wrap(async(req,res)=>{const [rows]=await db.execute('SELECT status,COUNT(*) count FROM articles WHERE author_id=? AND deleted_at IS NULL GROUP BY status',[req.user.id]);ok(res,Object.assign({DRAFT:0,PENDING:0,PUBLISHED:0,REJECTED:0,OFFLINE:0},Object.fromEntries(rows.map(r=>[r.status,Number(r.count)]))));}));
  app.get('/api/studio/articles',user,wrap(async(req,res)=>{
    const {p,n}=paging(req),args=[req.user.id];let where='author_id=? AND deleted_at IS NULL';
    if(req.query.status){if(!['DRAFT','PENDING','PUBLISHED','REJECTED','OFFLINE'].includes(req.query.status))throw fail(400,'状态错误');where+=' AND status=?';args.push(req.query.status);}
    const [[count]]=await db.execute(`SELECT COUNT(*) total FROM articles WHERE ${where}`,args);
    const [items]=await db.query(`SELECT ${articleFields} FROM articles WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT ? OFFSET ?`,[...args,n,(p-1)*n]);ok(res,{items,page:p,pageSize:n,total:Number(count.total)});
  }));
  app.post('/api/studio/articles',user,wrap(async(req,res)=>ok(res,await tx(async c=>{
    const d=await validateArticle(c,{title:'',summary:'',bodyMarkdown:'',tagIds:[],...req.body});
    const [r]=await c.execute('INSERT INTO articles(author_id,title,summary,body_markdown,category_id,cover_path) VALUES (?,?,?,?,?,?)',[req.user.id,d.title,d.summary,d.bodyMarkdown,d.categoryId,d.coverPath]);
    for(const tag of d.tagIds)await c.execute('INSERT INTO article_tags(article_id,tag_id) VALUES (?,?)',[r.insertId,tag]);return {id:String(r.insertId),version:1,status:'DRAFT'};
  }))));
  app.get('/api/studio/articles/:id',user,wrap(async(req,res)=>{
    id(req.params.id);const [[a]]=await db.execute(`SELECT ${articleFields} FROM articles WHERE id=? AND author_id=? AND deleted_at IS NULL`,[req.params.id,req.user.id]);if(!a)throw fail(404,'文章不存在');
    const [tags]=await db.execute('SELECT CAST(tag_id AS CHAR) id FROM article_tags WHERE article_id=?',[a.id]);
    const [history]=await db.execute('SELECT from_status fromStatus,to_status toStatus,reason,created_at createdAt FROM review_records WHERE article_id=? ORDER BY id DESC',[a.id]);ok(res,{...a,tagIds:tags.map(t=>t.id),history});
  }));
  app.patch('/api/studio/articles/:id',user,wrap(async(req,res)=>ok(res,await tx(async c=>{
    const a=await article(c,req,true);version(a,req);if(!['DRAFT','REJECTED'].includes(a.status))throw fail(409,'请先撤回或整改再编辑');
    const d=await validateArticle(c,req.body);
    await c.execute('UPDATE articles SET title=?,summary=?,body_markdown=?,category_id=?,cover_path=?,version=version+1,updated_at=NOW() WHERE id=?',[d.title,d.summary,d.bodyMarkdown,d.categoryId,d.coverPath,a.id]);
    await c.execute('DELETE FROM article_tags WHERE article_id=?',[a.id]);for(const tag of d.tagIds)await c.execute('INSERT INTO article_tags(article_id,tag_id) VALUES (?,?)',[a.id,tag]);return {version:a.version+1,status:a.status};
  }))));
  async function transition(req,action){return tx(async c=>{
    const a=await article(c,req,true);version(a,req);
    const allowed={submit:['DRAFT','REJECTED'],withdraw:['PENDING','PUBLISHED'],revise:['OFFLINE'],delete:['DRAFT','REJECTED','OFFLINE']};
    if(!allowed[action].includes(a.status))throw fail(409,'当前文章状态不允许此操作');
    if(action==='submit'){const [tags]=await c.execute('SELECT CAST(tag_id AS CHAR) id FROM article_tags WHERE article_id=?',[a.id]);await validateArticle(c,{title:a.title,summary:a.summary,bodyMarkdown:a.body_markdown,categoryId:a.category_id,coverPath:a.cover_path,tagIds:tags.map(t=>t.id)},true);}
    const status=action==='submit'?'PENDING':action==='delete'?a.status:'DRAFT';
    await c.execute(`UPDATE articles SET status=?,version=version+1,updated_at=NOW(),is_featured=0${action==='submit'?',submitted_at=NOW()':''}${action==='delete'?',deleted_at=NOW()':''} WHERE id=?`,[status,a.id]);
    return {status,version:a.version+1};
  });}
  for(const action of ['submit','withdraw','revise'])app.post(`/api/studio/articles/:id/${action}`,user,wrap(async(req,res)=>ok(res,await transition(req,action))));
  app.delete('/api/studio/articles/:id',user,wrap(async(req,res)=>ok(res,await transition(req,'delete'))));

  const seriesFields='CAST(id AS CHAR) id,name,description,cover_path coverPath,is_public isPublic';
  function seriesData(d){if(typeof d.isPublic!=='boolean')throw fail(422,'请选择公开状态');return [text(d.name,2,40,'专栏名称'),text(d.description,0,300,'简介'),image(d.coverPath),d.isPublic];}
  app.get('/api/studio/series',user,wrap(async(req,res)=>{const [items]=await db.execute(`SELECT ${seriesFields} FROM series WHERE author_id=? ORDER BY id DESC`,[req.user.id]);ok(res,items.map(s=>({...s,isPublic:Boolean(s.isPublic)})));}));
  app.post('/api/studio/series',user,wrap(async(req,res)=>{const [r]=await db.execute('INSERT INTO series(name,description,cover_path,is_public,author_id) VALUES (?,?,?,?,?)',[...seriesData(req.body),req.user.id]);ok(res,{id:String(r.insertId)});}));
  app.get('/api/studio/series/:id',user,wrap(async(req,res)=>{const s=await series(db,req);const [articles]=await db.execute(`SELECT CAST(a.id AS CHAR) id,a.title,a.status,sa.stage FROM series_articles sa JOIN articles a ON a.id=sa.article_id WHERE sa.series_id=? AND a.author_id=? AND a.deleted_at IS NULL ORDER BY sa.sort_order,a.id`,[s.id,req.user.id]);ok(res,{id:String(s.id),name:s.name,description:s.description,coverPath:s.cover_path,isPublic:Boolean(s.is_public),articles});}));
  app.patch('/api/studio/series/:id',user,wrap(async(req,res)=>ok(res,await tx(async c=>{const s=await series(c,req,true);await c.execute('UPDATE series SET name=?,description=?,cover_path=?,is_public=? WHERE id=?',[...seriesData(req.body),s.id]);return null;}))));
  app.delete('/api/studio/series/:id',user,wrap(async(req,res)=>ok(res,await tx(async c=>{const s=await series(c,req,true);await c.execute('DELETE FROM series_articles WHERE series_id=?',[s.id]);await c.execute('DELETE FROM series WHERE id=?',[s.id]);return null;}))));
  app.put('/api/studio/series/:id/articles',user,wrap(async(req,res)=>ok(res,await tx(async c=>{
    const s=await series(c,req,true),items=req.body.articles;
    if(!Array.isArray(items)||items.length>50)throw fail(422,'专栏最多50篇文章');
    const ids=items.map(a=>id(a.id));if(new Set(ids).size!==ids.length)throw fail(422,'文章重复');
    for(const item of items)if(![null,'','起步','实践','成果','复盘'].includes(item.stage??null))throw fail(422,'阶段无效');
    // Lock selected article rows in stable order, serializing assignments across series.
    if(ids.length){const [rows]=await c.query('SELECT id FROM articles WHERE id IN (?) AND author_id=? AND deleted_at IS NULL ORDER BY id FOR UPDATE',[ids,req.user.id]);if(rows.length!==ids.length)throw fail(422,'只能关联本人未删除的文章');
      const [other]=await c.query('SELECT article_id FROM series_articles WHERE article_id IN (?) AND series_id<>?',[ids,s.id]);if(other.length)throw fail(409,'文章已属于其他专栏');}
    // expectedIds makes stale reorder/membership submissions fail rather than overwrite.
    if(!Array.isArray(req.body.expectedIds))throw fail(422,'缺少原始文章集合');
    const expected=req.body.expectedIds.map(id).sort();const [old]=await c.execute('SELECT CAST(sa.article_id AS CHAR) id FROM series_articles sa JOIN articles a ON a.id=sa.article_id WHERE sa.series_id=? AND a.deleted_at IS NULL',[s.id]);
    if(JSON.stringify(expected)!==JSON.stringify(old.map(a=>a.id).sort()))throw fail(409,'专栏文章集合已变化，请刷新');
    if(req.body.name!==undefined)await c.execute('UPDATE series SET name=?,description=?,cover_path=?,is_public=? WHERE id=?',[...seriesData(req.body),s.id]);
    await c.execute('DELETE FROM series_articles WHERE series_id=?',[s.id]);for(let i=0;i<items.length;i++)await c.execute('INSERT INTO series_articles(series_id,article_id,sort_order,stage) VALUES (?,?,?,?)',[s.id,ids[i],i,items[i].stage||null]);return null;
  }))));
  app.get('/api/series/:id',wrap(async(req,res)=>{
    const [[s]]=await db.execute(`SELECT CAST(s.id AS CHAR) id,s.name,s.description,s.cover_path coverPath,CAST(s.author_id AS CHAR) authorId,u.nickname author FROM series s JOIN users u ON u.id=s.author_id WHERE s.id=? AND s.is_public=1`,[id(req.params.id)]);
    if(!s)throw fail(404,'专栏不存在或不可用');const [articles]=await db.execute(`SELECT CAST(a.id AS CHAR) id,a.title,a.summary,a.cover_path coverPath,a.first_published_at firstPublishedAt,a.updated_at updatedAt,sa.stage FROM series_articles sa JOIN articles a ON a.id=sa.article_id WHERE sa.series_id=? AND a.status='PUBLISHED' AND a.deleted_at IS NULL ORDER BY sa.sort_order,a.id`,[s.id]);
    if(!articles.length)throw fail(404,'专栏不存在或不可用');ok(res,{...s,articles,count:articles.length,updatedAt:articles.reduce((latest,a)=>a.updatedAt>latest?a.updatedAt:latest,articles[0].updatedAt)});
  }));
  app.patch('/api/me/profile',user,wrap(async(req,res)=>{const nickname=text(req.body.nickname,2,30,'昵称'),bio=text(req.body.bio,0,300,'简介'),avatarPath=image(req.body.avatarPath);await db.execute('UPDATE users SET nickname=?,bio=?,avatar_path=? WHERE id=?',[nickname,bio,avatarPath,req.user.id]);ok(res,{id:String(req.user.id),nickname,bio,avatarPath,role:'USER'});}));
}
