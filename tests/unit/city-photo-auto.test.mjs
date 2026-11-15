import test from 'node:test'
import assert from 'node:assert/strict'
import {
  autoCityPhotoRequest, selectVerifiedCityCentre, nearbyPhotoSearchUrl,
  nearbyPhotoTitles, nearbyPhotoMetadataUrl, fetchNearbyCityPhotos,
  getCityCentre, readNearbyCache, saveNearbyCache, loadNearbyCityGallery,
  PHOTO_RADIUS_METRES
} from '../../src/city-photo-auto.js'

const memory = () => {
  const entries = new Map()
  return {getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value)}
}
const point = (name,lat,lon,countryCode='')=>({name,lat,lon,countryCode})
const file = (title,lat,lon)=>({ns:6,title:'File:'+title,lat,lon})
const infoPage = (title,license='CC BY 4.0')=>({
  title,
  imageinfo: [{
    mime:'image/jpeg',width:2400,height:1400,
    thumburl:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/file.jpg/1440px-file.jpg',
    user:'ImageUploader',
    extmetadata: {
      LicenseShortName:{value:license},
      Artist:{value:'<span>Example Photographer</span>'},
      LicenseUrl:{value:license==='CC BY 4.0'?'https://creativecommons.org/licenses/by/4.0/':
        'https://creativecommons.org/licenses/by-sa/4.0/'}
    }
  }]
})
const photoInfo = titles => ({
  query: {pages:Object.fromEntries(titles.map((title,index)=>[index,infoPage(title)]))}
})

test('valid manual city centres in any country, not random street names',()=>{
  const london=autoCityPhotoRequest(point('London',51.5074,-.1278,'GB'),'quick')
  const londonOntario=autoCityPhotoRequest(point('London',42.9849,-81.2453,'CA'),'search')
  assert.ok(london && londonOntario)
  assert.notEqual(london.key,londonOntario.key)
  assert.equal(london.gps,false)
  assert.equal(autoCityPhotoRequest(point('My Location',51.5,-.1),'geolocation'),null)
  assert.equal(autoCityPhotoRequest(point('ул. Пример 25',51.5,-.1),'geolocation'),null)
  assert.equal(autoCityPhotoRequest(point('London',0,0),'quick'),null)
  assert.equal(autoCityPhotoRequest(point('Madrid',Number.NaN,2),'search'),null)
})

test('Commons geosearch uses only the known city centre and bounded radius',()=>{
  const u=new URL(nearbyPhotoSearchUrl({lat:48.8566,lon:2.3522}))
  assert.equal(u.hostname,'commons.wikimedia.org')
  assert.equal(u.searchParams.get('gsnamespace'),'6')
  assert.equal(u.searchParams.get('gsprimary'),'all')
  assert.equal(u.searchParams.get('gsradius'),String(PHOTO_RADIUS_METRES))
  assert.equal(u.searchParams.get('gscoord'),'48.8566|2.3522')
  assert.equal(nearbyPhotoSearchUrl({lat:200,lon:2}),null)
})

test('exclude out-of-area images, illustrations and unsupported formats',()=>{
  const center={lat:48.8566,lon:2.3522}
  const images=[
    file('Paris Panorama.jpg',48.857,2.352),
    file('Portrait of Visitor.jpg',48.8568,2.352),
    file('Seine Square.jpeg',48.858,2.354),
    file('City map.png',48.856,2.353),
    file('Nearby Gallery.jpg',49.0,3.0),
    file('Art mural.svg',48.856,2.352),
    {title:'File:Test.jpg',ns:0,lat:48.857,lon:2.35},
    file('Seine Square.jpeg',48.858,2.354),
  ]
  assert.deepEqual(nearbyPhotoTitles(images,center),['File:Paris Panorama.jpg','File:Seine Square.jpeg'])
  assert.deepEqual(nearbyPhotoTitles(images,{lat:NaN,lon:2}),[])
  assert.equal(nearbyPhotoMetadataUrl(['File:abc.jpg']).includes('iiurlwidth=960'),true)
  assert.equal(nearbyPhotoMetadataUrl(Array.from({length:13},(_,i)=>'File:'+i+'.jpg')),null)
})

test('automatic photo discovery verifies Commons licenses and batches metadata',async()=>{
  const center={lat:51.5074,lon:-.1278}
  const entries=Array.from({length:20},(_,i)=>file('London Cityscape '+i+'.jpg',51.508+(i/100000),-.1278))
  let calls=0
  const albums=await fetchNearbyCityPhotos(center,{fetcher:async raw=>{
    calls++
    const u=new URL(raw)
    if(u.searchParams.get('list')==='geosearch')return {ok:true,json:async()=>({query:{geosearch:entries}})}
    const titles=u.searchParams.get('titles').split('|')
    assert.ok(titles.length<=12)
    const pages=Object.fromEntries(titles.map((title,i)=>[i,infoPage(title,i<2?'CC BY-SA 4.0':'CC BY 4.0')]))
    return {ok:true,json:async()=>({query:{pages}})}
  }})
  assert.ok(albums.length>=2 && albums.length<=8)
  assert.ok(albums.every(item=>item.license==='CC BY 4.0'))
  assert.ok(calls<=3)
})

test('GPS lookup sends only city name to geocoder, then verified city centre to Commons',async()=>{
  const gps=autoCityPhotoRequest(point('Paris',48.8584,2.2945,'FR'),'geolocation')
  const result=selectVerifiedCityCentre([
    {name:'Paris',latitude:33.6,longitude:-95.5,country_code:'US'},
    {name:'Paris',latitude:48.8566,longitude:2.3522,country_code:'FR'},
    {name:'Paris',latitude:48.8566,longitude:2.3522,country_code:'US'},
  ],gps)
  assert.deepEqual(result,{lat:48.8566,lon:2.3522})
  assert.equal(selectVerifiedCityCentre([{name:'Paris',latitude:33,longitude:-95,country_code:'FR'}],gps),null)
  const calls=[]
  const fetcher=async raw=>{
    const u=new URL(raw);calls.push(u)
    return {ok:true,json:async()=>({results:[{name:'Paris',latitude:48.8566,longitude:2.3522,country_code:'FR'}]})}
  }
  const c=await getCityCentre(gps,{fetcher,lang:'en'})
  assert.deepEqual(c,result)
  assert.equal(calls.length,1)
  assert.equal(calls[0].hostname,'geocoding-api.open-meteo.com')
  assert.equal(calls[0].searchParams.get('name'),'Paris')
  assert.equal(calls[0].searchParams.has('lat'),false)
  assert.equal(calls[0].searchParams.has('lon'),false)
  assert.equal(calls[0].href.includes('48.8584'),false)
  assert.equal(calls[0].href.includes('2.2945'),false)
})

test('a single camera image is insufficient; never invent gallery variety',async()=>{
  const center={lat:40.7128,lon:-74.006}
  const found=await fetchNearbyCityPhotos(center,{fetcher:async raw=>{
    const u=new URL(raw)
    if(u.searchParams.get('list')==='geosearch')return {ok:true,json:async()=>({query:{geosearch:[
      file('New York skyline.jpg',center.lat,center.lon)
    ]}})}
    return {ok:true,json:async()=>photoInfo(u.searchParams.get('titles').split('|'))}
  }})
  assert.equal(found.length,1) // Caller must refuse fewer than 2.
})

test('per-city cache retains only HTTPS Commons images, expires after 30 days',()=>{
  const key='nearby:40.713:-74.006',storage=memory(),when=Date.now()
  const make=i=>({
    id:'File:Photo-'+i+'.jpg',
    url:'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Photo.jpg/1440px-Photo.jpg',
    filePage:'https://commons.wikimedia.org/wiki/File%3APhoto-'+i+'.jpg',
    author:'Example Photographer',license:'CC BY 4.0',licenseUrl:'https://creativecommons.org/licenses/by/4.0/'
  })
  saveNearbyCache(key,[make(1),make(2)],storage,when)
  assert.equal(readNearbyCache(key,storage,when+900000).length,2)
  assert.equal(readNearbyCache(key,storage,when+30*86_400_000),null)
  // Rejected writes must NOT wipe an earlier valid gallery.
  saveNearbyCache(key,[make(1),{...make(2),url:'https://evil.example/image.jpg'}],storage,when)
  assert.equal(readNearbyCache(key,storage,when+1).length,2)
  saveNearbyCache(key,[make(1),{...make(2),licenseUrl:'javascript:alert(1)'}],storage,when)
  assert.equal(readNearbyCache(key,storage,when+1).length,2)
  // A cache entry tampered with outside the writer must never be rendered.
  storage.setItem('meteoPulseNearbyPhotosV2:'+key,JSON.stringify({savedAt:when,photos:[
    make(1),{...make(2),url:'https://evil.example/image.jpg'}
  ]}))
  assert.equal(readNearbyCache(key,storage,when+1),null)
})

test('React StrictMode shares metadata requests; cached gallery makes none',async()=>{
  const location=autoCityPhotoRequest(point('Unique Test City',10,10,'AA'),'search')
  const storage=memory()
  let total=0,release
  const hold=new Promise(resolve=>{release=resolve})
  const files=Array.from({length:8},(_,i)=>file('Unique Test City square '+i+'.jpg',10,10+(i/10000)))
  const fetcher=async raw=>{
    total++
    await hold
    const u=new URL(raw)
    return {ok:true,json:async()=>u.searchParams.get('list')==='geosearch'
      ? {query:{geosearch:files}}
      : photoInfo(u.searchParams.get('titles').split('|'))}
  }
  const a=loadNearbyCityGallery(location,{storage,fetcher})
  const b=loadNearbyCityGallery(location,{storage,fetcher})
  assert.strictEqual(a,b)
  release()
  const [first,second]=await Promise.all([a,b])
  assert.ok(first.length>=2)
  assert.deepEqual(first,second)
  assert.equal(total,2)
  const c=await loadNearbyCityGallery(location,{storage,fetcher})
  assert.equal(total,2)
  assert.deepEqual(c,first)
})

test('GPS city namesake too far away is rejected with no Commons lookup',async()=>{
  const pos=autoCityPhotoRequest(point('Columbus',39.96,-83.0,'US'),'geolocation')
  let calls=0
  const photos=await loadNearbyCityGallery(pos,{fetcher:async raw=>{
    calls++
    const u=new URL(raw)
    if(u.hostname!=='geocoding-api.open-meteo.com')throw Error('Should not call Commons')
    return {ok:true,json:async()=>({results:[{name:'Columbus',latitude:32.46,longitude:-84.99,country_code:'US'}]})}
  }})
  assert.deepEqual(photos,[])
  assert.equal(calls,1)
})
