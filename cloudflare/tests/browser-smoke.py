"""Real Chromium DOM tests with synthetic API/location and map-renderer fixtures.
Not an iPhone keyboard or real WebGL/geolocation certification.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
import json,os,re,time
from playwright.sync_api import sync_playwright,expect
root=Path(__file__).resolve().parents[2];public=root/'cloudflare/public'
artifacts=Path(os.environ.get('TEST_ARTIFACTS',root/'test-artifacts'));artifacts.mkdir(parents=True,exist_ok=True)
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(public)));Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
# Keep browser coverage deterministic: only rendering APIs are stubbed, app components are real.
fake_gl=r'''
const markers=new Set();
class Events{constructor(){this.events={};}on(n,fn){(this.events[n]??=[]).push(fn);return this;}once(n,fn){const wrap=e=>{this.off(n,wrap);fn(e);};return this.on(n,wrap);}off(n,fn){this.events[n]=(this.events[n]||[]).filter(f=>f!==fn);return this;}fire(n,e={}){for(const fn of [...(this.events[n]||[])])fn(e);return this;}}
export class Map extends Events{constructor(o){super();this.container=document.getElementById(o.container);this.container.style.background='#e7efe8';this.center={lng:134,lat:35};this.zoom=10;this.sources={};this.layers={};this.hits=[];this.canvas=document.createElement('canvas');this.container.append(this.canvas);}getContainer(){return this.container;}getCanvas(){return this.canvas;}addControl(){}resize(){this.fire('resize');}stop(){}getZoom(){return this.zoom;}getCenter(){return this.center;}jumpTo(o){if(o.center)this.center={lng:o.center[0],lat:o.center[1]};if(o.zoom)this.zoom=o.zoom;this.fire('move');return this;}easeTo(o){return this.jumpTo(o);}flyTo(o){return this.jumpTo(o);}panBy(offset){this.center.lng+=offset[0]/20;this.center.lat-=offset[1]/20;this.fire('move');}project(p){const a=Array.isArray(p)?p:[p.lng,p.lat];return {x:this.container.clientWidth/2+(a[0]-this.center.lng)*20,y:this.container.clientHeight/2-(a[1]-this.center.lat)*20};}fitBounds(){return this;}setStyle(){this.sources={};this.layers={};this.fire('style.load');setTimeout(()=>this.fire('idle'),0);}getSource(n){return this.sources[n];}addSource(n,s){this.sources[n]={...s,setData(data){this.data=data;}};}getLayer(n){return this.layers[n];}addLayer(l){this.layers[l.id]=l;}setLayoutProperty(){}setPaintProperty(){}queryRenderedFeatures(){return this.hits;}}
export class Marker{constructor(o={}){this.node=o.element||document.createElement('div');this.node.classList.add('maplibregl-marker');this.node.style.position='absolute';}setLngLat(p){this.pos=p;this.update();return this;}update(){if(this.map){const p=this.map.project(this.pos);this.node.style.left=p.x+'px';this.node.style.top=p.y+'px';}}addTo(m){this.map=m;m.container.append(this.node);m.on('move',()=>this.update());this.update();markers.add(this);return this;}getElement(){return this.node;}remove(){this.node.remove();markers.delete(this);}}
export class Popup extends Events{constructor(o={}){super();this.node=document.createElement('div');this.node.className='maplibregl-popup '+(o.className||'');this.node.style.cssText='position:absolute;width:280px;z-index:600;';this.content=document.createElement('div');this.content.className='maplibregl-popup-content';this.node.append(this.content);}setLngLat(p){this.pos=p;return this;}setDOMContent(n){this.content.replaceChildren(n);const close=document.createElement('button');close.className='maplibregl-popup-close-button';close.textContent='×';close.onclick=()=>this.remove();this.content.append(close);return this;}addTo(m){this.map=m;this.open=true;m.container.append(this.node);const update=()=>{const p=m.project(this.pos);this.node.style.left=Math.max(10,p.x-140)+'px';this.node.style.top=Math.max(85,p.y-this.node.offsetHeight-25)+'px';};update();m.on('move',update);return this;}getElement(){return this.node;}isOpen(){return !!this.open;}remove(){if(this.open){this.open=false;this.node.remove();this.fire('close');}return this;}}
export class LngLatBounds{extend(){return this;}}
export class NavigationControl{};export class AttributionControl{};
'''
harness='''<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="map"></div><p id="message"></p><script type="module">
import {mapShell} from '/map-shell.js';import {makeOwnerMap} from '/owner-map.js';import {makeOwnerRoute} from '/owner-route.js';import {makeReplay} from '/replay.js';import {makeStory} from '/story.js';import {makeEveryone} from '/panel-everyone.js';
const people=document.createElement('div'),timeline=document.createElement('div');const shell=mapShell([{id:'everyone',label:'みんな',nodes:[people]},{id:'timeline',label:'タイムライン',nodes:[timeline]}]);const map=makeOwnerMap(),route=makeOwnerRoute(map,shell);let replay,story;
const everyone=makeEveryone(map,shell,{peopleNode:people,timelineNode:timeline,showToggle:true,onFilter:()=>replay?.finish()});
replay=makeReplay(map,shell,{tracks:()=>[route.track(),...everyone.tracks()],begin:()=>{story?.finish();shell.hide();route.setReplay(true);everyone.setReplay(true);},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
story=makeStory(map,shell,{begin:()=>{replay.finish();route.setReplay(true);everyone.setReplay(true);},end:()=>{route.setReplay(false);everyone.setReplay(false);}});
const rows=[{id:'a',latitude:35,longitude:134,occurred_at:'2026-09-20T00:00:00Z',observed_place_name:'出発地点',memo:'出発のメモ',category_name:'観光',rating:4},{id:'b',latitude:35.1,longitude:134.1,occurred_at:'2026-09-20T00:10:00Z',observed_place_name:'到着地点',memo:'到着のメモ',category_name:'観光',rating:5}];route.setUser({display_name:'テスト'});route.render(rows);route.addPin(rows[1],()=>{window.detailOpened=true;});await everyone.ready;window.testMap={map,route,replay,story,shell};
</script></body></html>'''
activity_posts=[];location_posts=[];errors=[]
categories=[{'id':f'cat-{i}','name':name,'active':True,'kind':'activity'} for i,name in enumerate(['食費','その他','移動','交通費','観光費','温泉'])]+[{'id':'expense-food','name':'食費','active':True,'kind':'expense'}]
def respond(route):
    url=route.request.url;path=url.split('/api/',1)[1]
    if path=='public/session':data={'user':{'handle':'test','display_name':'テスト'},'authenticated':True}
    elif path=='public/entries':data={'entries':[{'id':'public-one','author':'friend','author_name':'友人','date':'2026-09-20','at':None,'latitude':35.2,'longitude':134.2,'place_name':'公開の場所','category_name':'観光','memo':'公開メモ','photos':[]}]}
    elif path=='private/bootstrap':data={'user':{'handle':'test','display_name':'テスト'},'settings':{'map_visible':True,'publish_default':False},'categories':categories,'trips':[]}
    elif path=='private/activities' and route.request.method=='POST':activity_posts.append(route.request.post_data_json);data={'id':'11111111-1111-4111-8111-111111111111'}
    elif path=='private/location-capture':data={'owner':'test-owner','expires_at':int(time.time()*1000)+90000}
    elif path=='private/location-samples' and route.request.method=='POST':location_posts.append(route.request.post_data_json);data={'id':route.request.post_data_json['id'],'saved':True}
    elif path.startswith('private/location-samples'):data={'samples':[],'next_cursor':None}
    elif path.startswith('private/attachments'):data={'attachments':[]}
    else:data={}
    route.fulfill(content_type='application/json',body=json.dumps(data))
try:
  with sync_playwright() as p:
    launch={'headless':True,'args':['--no-sandbox']}
    if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):launch['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
    browser=p.chromium.launch(**launch)
    context=browser.new_context(viewport={'width':390,'height':844},geolocation={'latitude':35,'longitude':134},permissions=['geolocation'])
    context.route('**/api/**',respond);context.route('**/vendor/maplibre-gl.mjs',lambda r:r.fulfill(content_type='text/javascript',body=fake_gl))
    context.route('https://tiles.openfreemap.org/**',lambda r:r.fulfill(content_type='application/json',body='{"version":8,"sources":{},"layers":[]}'))
    context.route('**/__test-map',lambda r:r.fulfill(content_type='text/html',body=harness))
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(origin+'/admin/record/');expect(page.locator('#quick-cats button')).to_have_count(4)
    order=page.locator('#quick').evaluate("e=>['place','quick-cats','rating','photo-open','memo'].map(id=>[...e.querySelectorAll('*')].indexOf(document.getElementById(id)))")
    assert order==sorted(order),order
    page.locator('#place').fill('試験タイトル');page.locator('#place').evaluate("e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))")
    assert page.evaluate('document.activeElement.id')=='place'
    page.locator('#place').press('Enter');assert page.evaluate("document.activeElement.closest('#quick-cats')!==null")
    page.locator('#more').click();page.locator('#sheet-list button').first.click();assert page.evaluate("document.activeElement.closest('#rating')!==null")
    page.locator('#rating button').nth(3).click();assert page.evaluate('document.activeElement.id')=='photo-open'
    page.locator('#photo-skip').click();page.locator('#memo').fill('一行目');page.locator('#memo').press('Enter');page.locator('#memo').type('二行目');assert '\n' in page.locator('#memo').input_value();assert not activity_posts
    page.screenshot(path=str(artifacts/'record-form.png'),full_page=True)
    page.locator('#memo-done').click();assert page.evaluate('document.activeElement.id')=='save';assert not activity_posts
    page.locator('#amount').fill('0');page.locator('#save').click();page.wait_for_timeout(200)
    assert activity_posts[-1]['observed_place_name']=='試験タイトル';assert activity_posts[-1]['transaction']['amount_minor']==0
    page.goto(origin+'/admin/start/');expect(page.locator('#status-form')).to_have_count(0);expect(page.locator('#visible')).to_be_visible();expect(page.locator('#count')).to_be_visible()
    page.get_by_role('switch',name='自動位置記録 OFF').click();expect(page.get_by_role('switch',name='自動位置記録 ON')).to_be_visible()
    page.wait_for_function("document.querySelector('.auto-location-state').textContent.startsWith('記録中')")
    count=len(location_posts);assert count>=1
    page.get_by_role('link',name=re.compile('くわしく')).click();expect(page.get_by_role('switch',name='自動位置記録 ON')).to_be_visible();page.wait_for_timeout(300);assert len(location_posts)==count,'handoff duplicated initial sample'
    page.get_by_role('switch',name='自動位置記録 ON').click()
    page.goto(origin+'/__test-map');page.wait_for_function('window.testMap!==undefined')
    page.get_by_role('button',name=re.compile('^最新 ')).click();expect(page.locator('.tm-record-card')).to_have_count(1);expect(page.locator('.tm-record-card h2')).to_have_text('到着地点')
    assert not page.evaluate("document.querySelector('.map-stage').classList.contains('pane-open')")
    page.locator('.replay-play').click();expect(page.locator('.replay-speed')).to_be_visible();page.locator('.replay-speed input').evaluate("e=>{e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));}")
    assert page.evaluate('testMap.replay.state().speed')==2
    page.locator('.replay-play').click();page.evaluate('testMap.replay.seek(1)');expect(page.locator('.replay-date')).to_have_text('2026-09-20')
    expect(page.locator('.tm-record-card')).to_have_count(1);page.screenshot(path=str(artifacts/'map-playback-fixture.png'))
    page.locator('.maplibregl-popup-close-button').click();page.wait_for_timeout(100);expect(page.locator('.tm-record-card')).to_have_count(0)
    page.get_by_role('button',name='✕ 終了').click();assert not page.evaluate('testMap.replay.active()')
    assert not errors,errors
    browser.close()
  print('PASS: actual form DOM, IME guard, category focus, memo newline, zero payment, status removal, capture handoff, card and replay controls (map-renderer fixture).')
finally:server.shutdown()
