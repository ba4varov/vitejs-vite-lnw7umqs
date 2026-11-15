import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CITY_PHOTO_CACHE_MS, cityPhotoGalleryKey, cityDayOrdinal, selectCityPhoto,
  reviewedPhotoTitles, cityPhotoApiUrl, parseCityPhotoResponse,
  fetchCityPhotoGallery, loadCityPhotoGallery, readCityPhotoCache, saveCityPhotoCache,
} from '../../src/city-photo-core.js'

const varna = {name:'Варна',lat:43.2141,lon:27.9147,countryCode:'BG',geonameId:726050}
const sofia = {name:'Sofia',lat:42.6977,lon:23.3219,countryCode:'BG',geonameId:727011}
const photo = (name, license='CC0 1.0') => ({
  title: 'File:' + name,
  imageinfo: [{
    mime:'image/jpeg', width:4032, height:3024,
    thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/' + name.replaceAll(' ','_') + '/1440px-' + name.replaceAll(' ','_'),
    user:'Photo uploader',
    extmetadata: {LicenseShortName:{value:license},
      Artist:{value:'<a href="https://commons.wikimedia.org">Actual Author</a>'},
      LicenseUrl:{value:license.startsWith('CC BY ') ? 'https://creativecommons.org/licenses/by/4.0/' : 'https://creativecommons.org/publicdomain/zero/1.0/'}}
  }]
})
const memoryStorage=()=>{const m=new Map();return {getItem:key=>m.get(key)??null,setItem:(k,v)=>m.set(k,v)}}

test('only correctly identified city and country use a curated gallery',()=>{
  assert.equal(cityPhotoGalleryKey(varna),'bg-varna')
  assert.equal(cityPhotoGalleryKey(sofia),'bg-sofia')
  assert.equal(cityPhotoGalleryKey({...varna,name:'Varna',geonameId:undefined}),'bg-varna')
  assert.equal(cityPhotoGalleryKey({...varna,name:'Бургас',geonameId:undefined}),null)
  assert.equal(cityPhotoGalleryKey({...varna,countryCode:'US'}),null)
  assert.equal(cityPhotoGalleryKey({...varna,lat:45,lon:24}),null)
  assert.equal(cityPhotoGalleryKey({name:'Варна',lat:NaN,lon:27.9147}),null)
  assert.equal(cityPhotoGalleryKey({name:'',lat:43,lon:27}),null)
  assert.ok(reviewedPhotoTitles('bg-varna').length>=4)
  assert.ok(reviewedPhotoTitles('bg-sofia').length>=4)
  assert.deepEqual(reviewedPhotoTitles('unknown'),[])
})

test('day changes at local city midnight, not every refresh',()=>{
  const before=new Date('2026-11-15T21:55:00Z')
  const after=new Date('2026-11-15T22:05:00Z')
  assert.equal(cityDayOrdinal(before,'Europe/Sofia')+1,cityDayOrdinal(after,'Europe/Sofia'))
  assert.equal(cityDayOrdinal(before,'America/New_York'),cityDayOrdinal(after,'America/New_York'))
  assert.ok(Number.isInteger(cityDayOrdinal(before,'Invalid/Zone')))
})

test('daily rotation cycles all photos with stable index within a day',()=>{
  const gallery=['one','two','three','four']
  const day=cityDayOrdinal(new Date('2026-11-15T11:00:00Z'),'Europe/Sofia')
  const today=selectCityPhoto(gallery,'bg-varna',day)
  assert.equal(today,selectCityPhoto(gallery,'bg-varna',day))
  assert.notEqual(today,selectCityPhoto(gallery,'bg-varna',day+1))
  const cycle=Array.from({length:4},(_,i)=>selectCityPhoto(gallery,'bg-varna',day+i))
  assert.equal(new Set(cycle).size,4)
  assert.equal(selectCityPhoto([], 'bg-varna',day),null)
  assert.equal(selectCityPhoto(gallery,'bg-varna',NaN),null)
})

test('API request is one bounded photo-metadata fetch with a contact identifier',async()=>{
  let calls=0
  const titles=reviewedPhotoTitles('bg-varna')
  const response={query:{pages:Object.fromEntries(titles.map((name,i)=>[i, photo(name.slice(5))]))}}
  const gallery=await fetchCityPhotoGallery('bg-varna',{
    fetcher:async(url,options)=>{
      calls++
      const u=new URL(url)
      assert.equal(u.hostname,'commons.wikimedia.org')
      assert.equal(u.searchParams.get('iiurlwidth'),'1440')
      assert.equal(u.searchParams.get('titles'),titles.join('|'))
      assert.match(options.headers['Api-User-Agent'],/MeteoPulse/)
      return {ok:true,json:async()=>response}
    }
  })
  assert.equal(calls,1)
  assert.equal(gallery.length,titles.length)
  assert.equal(gallery[0].author,'Actual Author')
  assert.equal(gallery[0].license,'CC0 1.0')
  assert.ok(cityPhotoApiUrl('bg-sofia'))
  assert.equal(cityPhotoApiUrl('unknown'),null)
})

test('reject unknown licenses, non-image media, tiny images, foreign hosts and missing authors',()=>{
  const titles=['File:one.jpg','File:two.jpg','File:three.jpg','File:four.jpg']
  const valid=photo('one.jpg','CC BY 4.0')
  const shareAlike=photo('two.jpg','CC BY-SA 4.0')
  const foreign=photo('three.jpg')
  foreign.imageinfo[0].thumburl='https://evil.example/picture.jpg'
  const tiny=photo('four.jpg')
  tiny.imageinfo[0].width=800
  const pages={a:valid,b:shareAlike,c:foreign,d:tiny}
  const result=parseCityPhotoResponse({query:{pages}},titles)
  assert.equal(result.length,1)
  assert.equal(result[0].license,'CC BY 4.0')
  assert.match(result[0].filePage,/commons\.wikimedia\.org/)
  assert.match(result[0].licenseUrl,/creativecommons\.org/)
})

test('cache is per-city, expires and rejects unsafe links',()=>{
  const storage=memoryStorage(), day=Date.now()
  const photos=['a','b','c'].map((name)=>({
    id:'File:'+name,url:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/'+name+'.jpg',
    filePage:'https://commons.wikimedia.org/wiki/File%3A'+name,
    author:'Photographer',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'
  }))
  saveCityPhotoCache('bg-varna',photos,storage,day)
  assert.deepEqual(readCityPhotoCache('bg-varna',storage,day+15*60*1000),photos)
  assert.equal(readCityPhotoCache('bg-sofia',storage,day+15*60*1000),null)
  assert.equal(readCityPhotoCache('bg-varna',storage,day+CITY_PHOTO_CACHE_MS),null)
  const hostile=photos.map(x=>({...x,licenseUrl:'javascript:alert(1)'}))
  saveCityPhotoCache('bg-varna',hostile,storage,day)
  assert.equal(readCityPhotoCache('bg-varna',storage,day+1000),null)
})

test('React StrictMode and simultaneous viewers coalesce to one Commons request',async()=>{
  const titles=reviewedPhotoTitles('bg-sofia')
  const payload={query:{pages:Object.fromEntries(titles.map((title,i)=>[i,photo(title.slice(5))]))}}
  const storage=memoryStorage()
  let calls=0
  let release
  const deferred=new Promise(resolve=>{release=resolve})
  const fetcher=async()=>{
    calls++
    await deferred
    return {ok:true,json:async()=>payload}
  }
  const first=loadCityPhotoGallery('bg-sofia',{storage,fetcher})
  const second=loadCityPhotoGallery('bg-sofia',{storage,fetcher})
  assert.equal(calls,1)
  release()
  const [one,two]=await Promise.all([first,second])
  assert.equal(one.length,4)
  assert.deepEqual(one,two)
  const third=await loadCityPhotoGallery('bg-sofia',{storage,fetcher})
  assert.deepEqual(third,one)
  assert.equal(calls,1)
})
