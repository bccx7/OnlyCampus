import { test } from 'node:test';
import assert from 'node:assert/strict';

const base=process.env.TEST_BASE_URL || 'http://localhost:3000/api';
test('public reading and authenticated interaction against a running development server', async()=>{
  let cookie='',csrf='';
  async function call(path,method='GET',body){const response=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{'X-CSRF-Token':csrf,'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:response.status,body:await response.json()}}
  const homepage=await call('/home');assert.equal(homepage.status,200);assert.ok(homepage.body.data.latest.length);
  assert.equal((await call('/articles/4')).status,404);
  const filtered=await call('/articles?q=网页&categoryId=2&tagId=1');assert.equal(Number(filtered.body.data.total),1);
  assert.equal((await call('/articles/1/favorite','PUT')).status,403);
  csrf=(await call('/auth/csrf')).body.data.token;
  assert.equal((await call('/dev/login','POST',{username:'reader',password:'campus123'})).status,200);
  csrf=(await call('/auth/csrf')).body.data.token;
  assert.equal((await call('/articles/1/favorite','PUT')).status,200);
  assert.equal((await call('/articles/1/favorite','PUT')).status,200);
  const saved=await call('/me/favorites');assert.equal(saved.body.data.items.filter(x=>x.id==='1').length,1);
  assert.equal((await call('/articles/1/comments','POST',{content:'   '})).status,422);
  const c=await call('/articles/1/comments','POST',{content:'测试评论'});assert.equal(c.status,200);
  assert.equal((await call('/articles/2/comments','POST',{content:'跨文章回复',parentId:c.body.data.id})).status,422);
  assert.equal((await call('/comments/'+c.body.data.id,'DELETE')).status,200);
  assert.equal((await call('/articles/1/favorite','DELETE')).status,200);
  assert.equal((await call('/articles/1/favorite','DELETE')).status,200);
});
