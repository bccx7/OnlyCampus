import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readingNavigation,rememberReadingOrigin} from '../frontend/src/navigation.js';

test('reading return preserves feed, search or profile origin through article navigation',()=>{
  rememberReadingOrigin({path:'/articles/1'},{path:'/',fullPath:'/?page=2'},520);
  assert.equal(readingNavigation.returnTo,'/?page=2');assert.equal(readingNavigation.returnScroll,520);
  rememberReadingOrigin({path:'/articles/2'},{path:'/articles/1',fullPath:'/articles/1'},30);
  assert.equal(readingNavigation.returnTo,'/?page=2');
  rememberReadingOrigin({path:'/articles/3'},{path:'/articles',fullPath:'/articles?q=校园'},240);
  assert.equal(readingNavigation.returnTo,'/articles?q=校园');
  rememberReadingOrigin({path:'/articles/1'},{path:'/users/2',fullPath:'/users/2?page=2'},610);
  assert.equal(readingNavigation.returnTo,'/users/2?page=2');assert.equal(readingNavigation.returnScroll,610);
});
