import {notify} from './notifications.js';

export function installOperations(app, db, {ok, fail, wrap}) {
  const logged = (req,res,next) => req.user ? next() : next(fail(401,'请先登录'));
  const admin = (req,res,next) => req.user?.role === 'ADMIN' ? next() : next(fail(req.user?403:401,'需要管理员身份'));
  const id = value => { if (!/^[1-9]\d{0,18}$/.test(String(value))) throw fail(400,'编号格式错误'); return String(value); };
  const text = (value,min,max,label) => { const s=typeof value==='string'?value.trim():''; if(s.length<min||s.length>max)throw fail(422,`${label}须为${min}至${max}字`);return s; };
  const paging = req => { const p=Number(req.query.page||1),n=Number(req.query.pageSize||10);if(!Number.isInteger(p)||p<1||p>10000||!Number.isInteger(n)||n<1||n>50)throw fail(400,'分页参数错误');return {p,n}; };
  const transaction = async fn => {const c=await db.getConnection();try{await c.beginTransaction();const result=await fn(c);await c.commit();return result;}catch(e){await c.rollback();throw e;}finally{c.release();}};
  const log = (c,actor,action,target,reason='') => c.execute('INSERT INTO admin_logs(actor_id,action,target_id,reason) VALUES (?,?,?,?)',[actor,action,target,reason]);
  async function list(req,res,select,count,args=[]) { const {p,n}=paging(req);const [[r]]=await db.execute(count,args);const [items]=await db.query(`${select} LIMIT ? OFFSET ?`,[...args,n,(p-1)*n]);ok(res,{items,page:p,pageSize:n,total:Number(r.total)}); }

  app.get('/api/me/notifications/unread-count',logged,wrap(async(req,res)=>{const [[r]]=await db.execute('SELECT COUNT(*) count FROM notifications WHERE recipient_id=? AND read_at IS NULL',[req.user.id]);ok(res,{count:Number(r.count)});}));
  app.get('/api/me/notifications',logged,wrap(async(req,res)=>{
    let where='recipient_id=?',args=[req.user.id];if(req.query.unread==='1')where+=' AND read_at IS NULL';
    if(req.query.type){if(!['COMMENT','REPLY','APPROVED','REJECTED','OFFLINE'].includes(req.query.type))throw fail(400,'通知类型错误');where+=' AND type=?';args.push(req.query.type);}
    await list(req,res,`SELECT CAST(id AS CHAR) id,type,summary,CAST(article_id AS CHAR) articleId,CAST(comment_id AS CHAR) commentId,read_at readAt,created_at createdAt FROM notifications WHERE ${where} ORDER BY id DESC`,`SELECT COUNT(*) total FROM notifications WHERE ${where}`,args);
  }));
  app.patch('/api/me/notifications/:id/read',logged,wrap(async(req,res)=>{const [r]=await db.execute('UPDATE notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=? AND recipient_id=?',[id(req.params.id),req.user.id]);if(!r.affectedRows)throw fail(404,'通知不存在');ok(res,null);}));
  app.post('/api/me/notifications/read-all',logged,wrap(async(req,res)=>{await db.execute('UPDATE notifications SET read_at=NOW() WHERE recipient_id=? AND read_at IS NULL',[req.user.id]);ok(res,null);}));

  app.get('/api/admin/overview',admin,wrap(async(req,res)=>{const [[r]]=await db.query(`SELECT
    (SELECT COUNT(*) FROM users WHERE role='USER') users,
    (SELECT COUNT(*) FROM articles WHERE status='PUBLISHED' AND deleted_at IS NULL) published,
    (SELECT COUNT(*) FROM articles WHERE status='PENDING' AND deleted_at IS NULL) pending,
    (SELECT COUNT(*) FROM comments WHERE status='VISIBLE') comments`);ok(res,r);}));
  app.get('/api/admin/statistics/publications',admin,wrap(async(req,res)=>{
    // Connections use UTC; numeric offsets avoid depending on installed time-zone tables.
    const [rows]=await db.query(`WITH RECURSIVE days AS (
      SELECT DATE(CONVERT_TZ(NOW(),'+00:00','+08:00')) - INTERVAL 6 DAY day
      UNION ALL SELECT day + INTERVAL 1 DAY FROM days WHERE day < DATE(CONVERT_TZ(NOW(),'+00:00','+08:00'))
    ) SELECT DATE_FORMAT(d.day,'%Y-%m-%d') day,COUNT(e.article_id) count FROM days d
      LEFT JOIN publication_events e ON DATE(CONVERT_TZ(e.first_published_at,'+00:00','+08:00'))=d.day
      GROUP BY d.day ORDER BY d.day`);ok(res,rows);
  }));
  app.get('/api/admin/articles',admin,wrap(async(req,res)=>{let where='a.deleted_at IS NULL',args=[];
    if(req.query.status){if(!['DRAFT','PENDING','PUBLISHED','REJECTED','OFFLINE'].includes(req.query.status))throw fail(400,'文章状态错误');where+=' AND a.status=?';args.push(req.query.status);}
    if(req.query.q){where+=" AND a.title LIKE ? ESCAPE '!'";args.push('%'+String(req.query.q).slice(0,80).replace(/[!%_]/g,'!$&')+'%');}
    if(req.query.authorId){where+=' AND a.author_id=?';args.push(id(req.query.authorId));}
    await list(req,res,`SELECT CAST(a.id AS CHAR) id,a.title,a.status,a.version,a.is_featured featured,u.nickname author FROM articles a JOIN users u ON u.id=a.author_id WHERE ${where} ORDER BY a.updated_at DESC,a.id DESC`,`SELECT COUNT(*) total FROM articles a WHERE ${where}`,args);
  }));
  app.get('/api/admin/articles/:id',admin,wrap(async(req,res)=>{const [[a]]=await db.execute(`SELECT CAST(a.id AS CHAR) id,a.title,a.summary,a.body_markdown bodyMarkdown,a.status,a.version,a.is_featured featured,u.nickname author FROM articles a JOIN users u ON u.id=a.author_id WHERE a.id=? AND a.deleted_at IS NULL`,[id(req.params.id)]);if(!a)throw fail(404,'文章不存在');const [history]=await db.execute('SELECT from_status fromStatus,to_status toStatus,reason,created_at createdAt FROM review_records WHERE article_id=? ORDER BY id DESC',[req.params.id]);ok(res,{...a,history});}));
  const changeArticle = async(req,offline=false) => transaction(async c=>{
    const articleId=id(req.params.id),version=Number(req.body.version);
    if(!Number.isInteger(version)||version<1)throw fail(422,'缺少有效文章版本号');
    const [[a]]=await c.execute('SELECT author_id,status,version,first_published_at FROM articles WHERE id=? AND deleted_at IS NULL FOR UPDATE',[articleId]);
    if(!a)throw fail(404,'文章不存在');
    if(a.version!==version||a.status!==(offline?'PUBLISHED':'PENDING'))throw fail(409,'文章状态已变化，请刷新');
    if(!offline&&!['APPROVE','REJECT'].includes(req.body.action))throw fail(422,'审核操作错误');
    const status=offline?'OFFLINE':req.body.action==='APPROVE'?'PUBLISHED':'REJECTED';
    const reason=text(req.body.reason,status==='PUBLISHED'?0:2,300,'处理原因');
    await c.execute(`UPDATE articles SET status=?,version=version+1,updated_at=NOW(),is_featured=0,
      first_published_at=IF(?='PUBLISHED',COALESCE(first_published_at,NOW()),first_published_at),
      published_at=IF(?='PUBLISHED',NOW(),published_at) WHERE id=?`,[status,status,status,articleId]);
    await c.execute('INSERT INTO review_records(article_id,actor_id,from_status,to_status,reason) VALUES (?,?,?,?,?)',[articleId,req.user.id,a.status,status,reason]);
    if(status==='PUBLISHED')await c.execute('INSERT IGNORE INTO publication_events(article_id,first_published_at) SELECT id,first_published_at FROM articles WHERE id=?',[articleId]);
    await notify(c,{recipientId:a.author_id,actorId:req.user.id,type:status==='PUBLISHED'?'APPROVED':status,articleId,summary:reason||'你的文章已审核通过',eventKey:`review:${articleId}:${version+1}`});
    await log(c,req.user.id,status,articleId,reason);return {status,version:version+1};
  });
  app.post('/api/admin/articles/:id/review',admin,wrap(async(req,res)=>ok(res,await changeArticle(req))));
  app.post('/api/admin/articles/:id/offline',admin,wrap(async(req,res)=>ok(res,await changeArticle(req,true))));
  app.patch('/api/admin/articles/:id/featured',admin,wrap(async(req,res)=>{
    if(typeof req.body.featured!=='boolean')throw fail(422,'精选状态须为布尔值');
    await transaction(async c=>{
      // A shared lock serializes even concurrent attempts to feature different articles.
      await c.query("SELECT id FROM users WHERE role='ADMIN' ORDER BY id FOR UPDATE");
      const [[a]]=await c.execute('SELECT status,deleted_at FROM articles WHERE id=? FOR UPDATE',[id(req.params.id)]);if(!a||a.deleted_at)throw fail(404,'文章不存在');if(a.status!=='PUBLISHED')throw fail(409,'仅公开文章可设置精选');
      const [[r]]=await c.query('SELECT COUNT(*) count FROM articles WHERE is_featured=1 AND id<>?',[req.params.id]);if(req.body.featured&&r.count>=4)throw fail(409,'精选最多4篇，请先取消其他精选');
      await c.execute('UPDATE articles SET is_featured=? WHERE id=?',[req.body.featured,req.params.id]);await log(c,req.user.id,req.body.featured?'FEATURE':'UNFEATURE',req.params.id);
    });ok(res,null);
  }));
  app.get('/api/admin/users',admin,wrap(async(req,res)=>list(req,res,'SELECT CAST(id AS CHAR) id,username,nickname,role,status,created_at createdAt FROM users ORDER BY id DESC','SELECT COUNT(*) total FROM users')));
  app.patch('/api/admin/users/:id/status',admin,wrap(async(req,res)=>{
    if(!['ACTIVE','DISABLED'].includes(req.body.status))throw fail(422,'账号状态错误');
    const reason=text(req.body.reason,2,300,'操作原因');
    await transaction(async c=>{const [[u]]=await c.execute('SELECT role,status FROM users WHERE id=? FOR UPDATE',[id(req.params.id)]);if(!u)throw fail(404,'用户不存在');if(u.role==='ADMIN')throw fail(403,'不可禁用管理员');
      // Rotate on both disable and restore, preventing an old cookie becoming valid again.
      await c.execute('UPDATE users SET status=?,session_version=session_version+1 WHERE id=?',[req.body.status,req.params.id]);await log(c,req.user.id,req.body.status,req.params.id,reason);
    });ok(res,null);
  }));
  for(const [path,table,relation,column] of [['categories','categories','articles','category_id'],['tags','tags','article_tags','tag_id']]) {
    app.get(`/api/admin/${path}`,admin,wrap(async(req,res)=>{const [rows]=await db.query(`SELECT CAST(id AS CHAR) id,name,is_enabled enabled,sort_order sortOrder FROM ${table} ORDER BY sort_order,id`);ok(res,rows);}));
    const values=body=>{const name=text(body.name,1,50,'名称');if(typeof body.enabled!=='boolean'||!Number.isInteger(body.sortOrder)||Math.abs(body.sortOrder)>100000)throw fail(422,'启用状态或排序无效');return [name,body.enabled,body.sortOrder];};
    const unique=async fn=>{try{return await fn();}catch(e){if(e.code==='ER_DUP_ENTRY')throw fail(409,'名称已存在');throw e;}};
    app.post(`/api/admin/${path}`,admin,wrap(async(req,res)=>{const v=values(req.body);const result=await unique(()=>transaction(async c=>{const [r]=await c.execute(`INSERT INTO ${table}(name,is_enabled,sort_order) VALUES (?,?,?)`,v);await log(c,req.user.id,`CREATE_${path}`,r.insertId);return {id:String(r.insertId)};}));ok(res,result);}));
    app.patch(`/api/admin/${path}/:id`,admin,wrap(async(req,res)=>{const v=values(req.body);await unique(()=>transaction(async c=>{const [r]=await c.execute(`UPDATE ${table} SET name=?,is_enabled=?,sort_order=? WHERE id=?`,[...v,id(req.params.id)]);if(!r.affectedRows)throw fail(404,'条目不存在');await log(c,req.user.id,`UPDATE_${path}`,req.params.id);}));ok(res,null);}));
    app.delete(`/api/admin/${path}/:id`,admin,wrap(async(req,res)=>{await transaction(async c=>{const [[r]]=await c.execute(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`,[id(req.params.id)]);if(!r)throw fail(404,'条目不存在');const [[used]]=await c.execute(`SELECT COUNT(*) count FROM ${relation} WHERE ${column}=?`,[req.params.id]);if(Number(used.count))throw fail(409,'已被文章引用，请改为停用');await c.execute(`DELETE FROM ${table} WHERE id=?`,[req.params.id]);await log(c,req.user.id,`DELETE_${path}`,req.params.id);});ok(res,null);}));
  }
  app.get('/api/admin/comments',admin,wrap(async(req,res)=>{let where='1=1',args=[];if(req.query.q){where+=" AND c.content LIKE ? ESCAPE '!'";args.push('%'+String(req.query.q).slice(0,100).replace(/[!%_]/g,'!$&')+'%');}await list(req,res,`SELECT CAST(c.id AS CHAR) id,c.content,c.status,u.nickname author,CAST(c.article_id AS CHAR) articleId FROM comments c JOIN users u ON u.id=c.user_id WHERE ${where} ORDER BY c.id DESC`,`SELECT COUNT(*) total FROM comments c WHERE ${where}`,args);}));
  app.patch('/api/admin/comments/:id/status',admin,wrap(async(req,res)=>{if(req.body.status!=='HIDDEN')throw fail(422,'只允许隐藏违规评论');const reason=text(req.body.reason,2,300,'隐藏原因');await transaction(async c=>{const [r]=await c.execute("UPDATE comments SET status='HIDDEN' WHERE id=? AND status='VISIBLE'",[id(req.params.id)]);if(!r.affectedRows)throw fail(409,'评论状态已变化');await log(c,req.user.id,'HIDE_COMMENT',req.params.id,reason);});ok(res,null);}));
}
