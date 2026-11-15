import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {featuredCityPhotoKey, featuredCityPhotos} from '../../src/city-photo-featured.js'
import {nearbyPhotoTitles} from '../../src/city-photo-auto.js'

test('Paris and Dubai use distinct reviewed galleries, with city centre checks',()=>{
  assert.equal(featuredCityPhotoKey({name:'Париж',lat:48.8566,lon:2.3522}), 'featured:fr-paris')
  assert.equal(featuredCityPhotoKey({name:'Paris',countryCode:'FR',lat:48.8566,lon:2.3522}), 'featured:fr-paris')
  assert.equal(featuredCityPhotoKey({name:'Дубай',lat:25.2048,lon:55.2708}), 'featured:ae-dubai')
  assert.equal(featuredCityPhotoKey({name:'Dubai',countryCode:'AE',lat:25.2048,lon:55.2708}), 'featured:ae-dubai')
  assert.equal(featuredCityPhotoKey({name:'Paris',countryCode:'US',lat:48.8566,lon:2.3522}), null)
  assert.equal(featuredCityPhotoKey({name:'Paris',countryCode:'FR',lat:33.66,lon:-95.55}), null)
  assert.equal(featuredCityPhotoKey({name:'Dubai',countryCode:'AE',lat:40,lon:55}),null)
  assert.deepEqual(featuredCityPhotos('featured:fr-paris').length,3)
  assert.deepEqual(featuredCityPhotos('featured:ae-dubai').length,2)
})

test('featured thumbnails are already sized, correctly hashed, and attributed',()=>{
  for (const key of ['featured:fr-paris','featured:ae-dubai']) {
    for (const photo of featuredCityPhotos(key)){
      const file=photo.id.slice(5).replaceAll(' ','_')
      const hash=createHash('md5').update(file).digest('hex').slice(0,2)
      const url=new URL(photo.url)
      assert.equal(url.hostname,'upload.wikimedia.org')
      assert.equal(url.pathname.startsWith('/wikipedia/commons/thumb/'+hash[0]+'/'+hash+'/'),true)
      assert.match(url.pathname,/\/960px-/)
      assert.ok(photo.author.length>0)
      assert.match(photo.filePage,/^https:\/\/commons.wikimedia.org\/wiki\/File:/)
      assert.ok(['CC0 1.0','CC BY 4.0'].includes(photo.license))
      assert.ok(photo.licenseUrl.startsWith('https://creativecommons.org/'))
    }
  }
})

test('automatic search never accepts office snapshots, portraits or irrelevant cities',()=>{
  const dubai={lat:25.2048,lon:55.2708}
  const photos=[
    {ns:6,lat:25.2048,lon:55.2708,title:'File:Dubai office man at desk skyline.jpg'},
    {ns:6,lat:25.2048,lon:55.2708,title:'File:Dubai businessman portrait in office.jpg'},
    {ns:6,lat:25.2048,lon:55.2708,title:'File:Abu Dhabi skyline.jpg'},
    {ns:6,lat:25.2048,lon:55.2708,title:'File:Some random Dubai room.jpg'},
    {ns:6,lat:25.2048,lon:55.2708,title:'File:Dubai beautiful skyline.jpg'},
    {ns:6,lat:25.2048,lon:55.2708,title:'File:Dubai Creek panorama.jpg'},
  ]
  assert.deepEqual(nearbyPhotoTitles(photos,dubai,'Dubai'),[
    'File:Dubai beautiful skyline.jpg','File:Dubai Creek panorama.jpg'
  ])
  const sofia={lat:42.6977,lon:23.3219}
  const bg=[
    {ns:6,lat:42.698,lon:23.322,title:'File:Sofia panorama.jpg'},
    {ns:6,lat:42.698,lon:23.322,title:'File:office manager in Sofia.jpg'},
    {ns:6,lat:42.698,lon:23.322,title:'File:Varna skyline.jpg'}
  ]
  assert.deepEqual(nearbyPhotoTitles(bg,sofia,'София'),['File:Sofia panorama.jpg'])
  const ny={lat:40.7128,lon:-74.006}
  const skyline=[{ns:6,lat:40.713,lon:-74.005,title:'File:new-york skyline 2025.jpg'}]
  assert.deepEqual(nearbyPhotoTitles(skyline,ny,'Ню Йорк'),['File:new-york skyline 2025.jpg'])
  assert.deepEqual(nearbyPhotoTitles(skyline,ny,'New York'),['File:new-york skyline 2025.jpg'])
})
