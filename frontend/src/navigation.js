export const readingNavigation={returnTo:'/',returnScroll:0,restoreScroll:null};
export function rememberReadingOrigin(to,from,scroll=0){
  if(to.path.startsWith('/articles/') && from.path && !['/login','/register'].includes(from.path) && !from.path.startsWith('/articles/')){
    readingNavigation.returnTo=from.fullPath||'/';readingNavigation.returnScroll=scroll;
  }
}
