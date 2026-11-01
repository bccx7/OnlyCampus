export function safeReturnPath(value){
  if(typeof value!=='string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))return '/';
  try{
    const url=new URL(value,'https://onlycampus.local');
    if(url.origin!=='https://onlycampus.local' || ['/login','/register'].includes(url.pathname))return '/';
    if(!/^\/(?:$|articles(?:\/\d+)?\/?$|users\/\d+\/?$|me\/favorites\/?$)/.test(url.pathname))return '/';
    return url.pathname+url.search+url.hash;
  }catch{return '/'}
}
