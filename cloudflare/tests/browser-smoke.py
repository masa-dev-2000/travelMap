"""Independent Chromium regression cases. Real app DOM; controlled API/GPS/map fixtures.
Worker's no-referrer header is included. This does not certify iOS, actual GPS or D1.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
import base64,json,os,re,time,unittest
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[2]
ART=Path(os.environ.get('TEST_ARTIFACTS',ROOT/'test-artifacts'))/'browser'
REAL_MAP=os.environ.get('TRAVELMAP_REAL_MAP')=='1'
if REAL_MAP:ART=ART.parent/'real-map'
ART.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
    def end_headers(self):
        self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
GPS='''window.__gpsEvents=[];window.__gpsMode='ok';
const pos=()=>({coords:{latitude:35,longitude:134,accuracy:10},timestamp:Date.now()});
const get=(ok,bad,options)=>{window.__gpsEvents.push({event:'request',options});setTimeout(()=>{
 const mode=window.__gpsMode;if(mode==='late')return;
 if(mode!=='ok'){const code={denied:1,unavailable:2,timeout:3}[mode];window.__gpsEvents.push({event:'error',code});bad({code,message:'synthetic '+mode});}
 else{window.__gpsEvents.push({event:'success'});ok(pos());}},10);};
Object.defineProperty(navigator,'geolocation',{value:{getCurrentPosition:get,watchPosition:(ok,bad,options)=>{get(ok,bad,options);return 1;},clearWatch:()=>{}}});'''
PNG=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAFElEQVR4nGPUSHFjgAEmBiSAmwMAKeoA2qTeoJgAAAAASUVORK5CYII=')
class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(ROOT/'cloudflare/public')))
        Thread(target=cls.server.serve_forever,daemon=True).start();cls.origin=f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw=sync_playwright().start();opts={'headless':True,'args':['--no-sandbox']}
        if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):opts['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
        if REAL_MAP:opts['args']+=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']
        cls.browser=cls.pw.chromium.launch(**opts)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.server.shutdown()
    def setUp(self):
        self.posts=[];self.samples=[];self.commands=[];self.errors=[];self.leases={};self.held=[];self.upload_mode='ok';self.create_mode='ok';self.owner='test-owner'
        self.ctx=self.browser.new_context(viewport={'width':390,'height':844})
        self.ctx.add_init_script(GPS);self.ctx.tracing.start(screenshots=True,snapshots=True)
        self.ctx.route('**/api/**',self.api)
        if not REAL_MAP:self.ctx.route('**/vendor/maplibre-gl.mjs',lambda r:r.fulfill(content_type='text/javascript',body=(ROOT/'cloudflare/tests/fake-map.mjs').read_text()))
        self.ctx.route('https://tiles.openfreemap.org/**',lambda r:r.fulfill(content_type='application/json',body='{"version":8,"sources":{},"layers":[]}'))
        self.page=self.ctx.new_page();self.page.on('pageerror',lambda e:self.errors.append(str(e)));self.page.set_default_timeout(8000)
    def tearDown(self):
        folder=ART/self._testMethodName;folder.mkdir(exist_ok=True)
        try:
            state=self.page.evaluate("({url:location.pathname,referrer:document.referrer,phase:document.querySelector('.auto-location-state')?.textContent,gps:window.__gpsEvents})")
            state.update(activity_posts=len(self.posts),location_posts=len(self.samples),commands=self.commands,errors=self.errors)
            (folder/'state.json').write_text(json.dumps(state,ensure_ascii=False,indent=2))
            self.page.screenshot(path=str(folder/'screen.png'))
            self.ctx.tracing.stop(path=str(folder/'trace.zip'))
        finally:self.ctx.close()
        self.assertEqual(self.errors,[])
    def api(self,route):
        path=urlparse(route.request.url).path;method=route.request.method;body=route.request.post_data_json if method=='POST' and 'json' in route.request.headers.get('content-type','') else None
        today=time.strftime('%Y-%m-%d',time.gmtime());now=int(time.time()*1000)
        user={'handle':'test','display_name':'テスト','email':'fixture@example.invalid'}
        categories=[{'id':f'cat-{i}','name':n,'active':True,'kind':'activity'} for i,n in enumerate(['食費','その他','移動','交通費','観光費','温泉'])]+[{'id':'expense','name':'食費','active':True,'kind':'expense'}]
        status=200;data={}
        if path=='/api/public/session':data={'user':user,'authenticated':True}
        elif path=='/api/public/entries':data={'entries':[{'id':'public-one','author':'friend','author_name':'友人','date':today,'at':None,'latitude':35.3,'longitude':134.3,'place_name':'公開の場所','category_name':'観光','memo':'公開メモ','photos':[]}]}
        elif path=='/api/private/bootstrap':data={'user':user,'settings':{'map_visible':True,'publish_default':False},'categories':categories,'trips':[]}
        elif path=='/api/private/activities' and method=='POST':
            self.posts.append({'body':body,'key':route.request.headers.get('idempotency-key')});data={'id':'11111111-1111-4111-8111-111111111111'}
            if self.create_mode=='lost':self.create_mode='ok';route.abort('failed');return
        elif path=='/api/private/activities':data={'activities':[{'id':'a','latitude':35,'longitude':134,'occurred_at':today+'T00:00:00Z','observed_place_name':'出発地点','memo':'出発のメモ','category_name':'観光費','category_id':'cat-4','rating':4},{'id':'b','latitude':35.1,'longitude':134.1,'occurred_at':today+'T00:10:00Z','observed_place_name':'到着地点','memo':'到着のメモ','category_name':'観光費','category_id':'cat-4','rating':5}],'next_offset':None}
        elif path=='/api/private/transactions':data={'transactions':[],'next_offset':None}
        elif path=='/api/private/summary':data={'expense_jpy':0,'income_jpy':0,'refund_jpy':0,'unconverted_count':0,'estimated_count':0}
        elif path=='/api/private/footprints':data={'visitors':[],'unread':False}
        elif path=='/api/private/location-capture':
            command=body['command'];self.commands.append(command);key=body['client_id'];lease=self.leases.get(key)
            if command=='start':self.leases[key]={**body,'expires_at':now+90000};data={'owner':self.owner,'expires_at':now+90000}
            elif command=='prepare':
                if lease:lease.update(token=body['token'],destination=body['destination'],next_at=body['next_at'],handoff_expires_at=now+15000)
                data={'owner':self.owner,'expires_at':now+15000,'next_at':body['next_at']}
            elif command=='claim':
                if not lease or lease.get('token')!=body['token'] or lease.get('handoff_expires_at',0)<now:status=409;data={'error':'期限切れ'}
                else:lease.update(capture_id=body['capture_id'],page_id=body['page_id']);data={'owner':self.owner,'expires_at':now+90000,'next_at':lease['next_at']}
            elif command=='stop':
                if lease and lease['capture_id']==body['capture_id'] and lease['page_id']==body['page_id']:self.leases.pop(key,None)
                data={'stopped':True}
            else:data={'owner':self.owner,'expires_at':now+90000}
        elif path=='/api/private/location-samples' and method=='POST':self.samples.append(body);data={'id':body['id'],'saved':True}
        elif path=='/api/private/location-samples':data={'samples':[],'next_cursor':None}
        elif path=='/api/private/attachments' and method=='POST':
            if self.upload_mode=='hold':self.held.append(route);return
            if self.upload_mode=='fail':self.upload_mode='ok';status=503;data={'error':'synthetic unavailable'}
            else:data={'id':'22222222-2222-4222-8222-222222222222'}
        elif path.startswith('/api/private/attachments'):data={'attachments':[]}
        route.fulfill(status=status,content_type='application/json',body=json.dumps(data))
    def recording(self,path='/admin/start/'):
        self.page.goto(self.origin+path);self.page.get_by_role('switch',name='自動位置記録 OFF').click()
        expect(self.page.locator('.auto-location-state')).to_contain_text('記録中');self.assertEqual(len(self.samples),1)
    def form(self):
        self.page.goto(self.origin+'/admin/record/');expect(self.page.locator('#quick-cats button')).to_have_count(4)
        self.page.locator('#place').fill('試験タイトル');self.page.locator('#quick-cats button').first.click()
    def photo(self):self.page.locator('#photo').set_input_files({'name':'fixture.png','mimeType':'image/png','buffer':PNG});expect(self.page.locator('#previews img')).to_have_count(1)
    def test_input_flow(self):
        p=self.page;self.form();p.locator('#place').focus()
        p.locator('#place').evaluate("e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true}))")
        self.assertEqual(p.evaluate('document.activeElement.id'),'place');p.locator('#place').press('Enter')
        self.assertTrue(p.evaluate("document.activeElement.closest('#quick-cats')!==null"))
        p.locator('#more').click();p.locator('#sheet-list button').first.click();self.assertTrue(p.evaluate("document.activeElement.closest('#rating')!==null"))
        p.locator('#rating button').nth(3).click();self.assertEqual(p.evaluate('document.activeElement.id'),'photo-open')
        p.locator('#photo-skip').click();p.locator('#memo').fill('一行目');p.locator('#memo').press('Enter');p.locator('#memo').type('二行目')
        self.assertIn('\n',p.locator('#memo').input_value());p.locator('#memo-done').click();self.assertEqual(len(self.posts),0)
        p.locator('#amount').fill('0');p.locator('#save').click();expect(p.locator('#place')).to_have_value('')
        self.assertEqual(self.posts[0]['body']['transaction']['amount_minor'],0)
    def test_photo_save_race_and_off_remains_available(self):
        self.recording('/admin/record/');p=self.page;p.locator('#quick-cats button').first.click();self.photo();self.upload_mode='hold'
        p.locator('#save').click();expect(p.locator('#save')).to_be_disabled();expect(p.locator('#photo-open')).to_be_disabled()
        p.evaluate("document.querySelector('#quick').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        self.assertEqual(len(self.posts),1)
        p.get_by_role('switch',name='自動位置記録 ON').click();expect(p.get_by_role('switch',name='自動位置記録 OFF')).to_be_enabled()
        self.assertTrue(self.held);self.held.pop().fulfill(content_type='application/json',body='{"id":"photo"}')
        expect(p.locator('#save')).to_be_enabled();self.assertEqual(len(self.posts),1)
    def test_unknown_response_and_attachment_retry(self):
        self.form();self.photo();self.create_mode='lost';p=self.page;p.locator('#save').click()
        expect(p.locator('#save')).to_have_text('同じ内容で再試行');self.upload_mode='fail';p.locator('#save').click()
        expect(p.locator('#save')).to_have_text('写真・公開を再試行');self.assertEqual(self.posts[0],self.posts[1]);p.locator('#save').click()
        expect(p.locator('#place')).to_have_value('');self.assertEqual(len(self.posts),2)
    def test_no_referrer_link_handoff(self):
        self.recording();p=self.page;expect(p.locator('#status-form')).to_have_count(0)
        p.get_by_role('link',name=re.compile('くわしく')).click();expect(p.locator('.auto-location-state')).to_contain_text('記録中')
        self.assertEqual(p.evaluate('document.referrer'),'');self.assertEqual(len(self.samples),1);self.assertIn('claim',self.commands)
        p.get_by_role('switch',name='自動位置記録 ON').click();expect(p.get_by_role('switch',name='自動位置記録 OFF')).to_be_visible()
    def test_actual_map_record_button_handoff(self):
        self.recording('/');p=self.page;p.get_by_role('button',name='記録する',exact=True).click()
        expect(p.locator('.auto-location-state')).to_contain_text('記録中');self.assertTrue(p.url.endswith('/admin/start/'))
        self.assertEqual(p.evaluate('document.referrer'),'');self.assertEqual(len(self.samples),1);self.assertIn('prepare',self.commands)
    def test_back_restore_does_not_restart(self):
        self.recording();p=self.page;p.get_by_role('link',name=re.compile('くわしく')).click();expect(p.locator('.auto-location-state')).to_contain_text('記録中')
        p.go_back();expect(p.get_by_role('switch',name='自動位置記録 OFF')).to_be_visible();self.assertEqual(len(self.samples),1)
        p.get_by_role('link',name=re.compile('くわしく')).click();self.assertTrue(p.url.endswith('/admin/record/'))
    def test_gps_errors_are_observable(self):
        for mode in ['denied','unavailable','timeout']:
            self.page.goto(self.origin+'/admin/start/');self.page.evaluate('m=>window.__gpsMode=m',mode)
            self.page.get_by_role('switch',name='自動位置記録 OFF').click()
            expect(self.page.locator('.auto-location-state')).to_contain_text('許可' if mode=='denied' else '取得できません')
        self.assertEqual(len(self.samples),0)
    def test_map_card_and_seek_while_playing(self):
        p=self.page;p.goto(self.origin+'/');expect(p.locator('.auto-location')).to_be_visible()
        p.wait_for_function('!window.__tmMap.isStyleLoaded || window.__tmMap.isStyleLoaded()');p.get_by_role('button',name=re.compile('^最新 ')).click();expect(p.locator('.tm-record-card h2')).to_have_text('到着地点')
        self.assertFalse(p.evaluate("document.querySelector('.map-stage').classList.contains('pane-open')"))
        p.locator('.replay-play').click();expect(p.locator('.replay-speed')).to_be_visible()
        p.locator('.replay-speed input').evaluate("e=>{e.value='2';e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertEqual(p.evaluate('__tm.replay.state().speed'),2)
        p.locator('.replay-progress').evaluate("e=>{e.value='0.8';e.dispatchEvent(new Event('input',{bubbles:true}));}")
        self.assertAlmostEqual(p.evaluate('__tm.replay.state().progress'),.8,places=4);self.assertFalse(p.evaluate('__tm.replay.state().playing'))
        p.locator('.replay-progress').evaluate("e=>{e.value='1';e.dispatchEvent(new Event('input',{bubbles:true}));}")
        expect(p.locator('.replay-date')).to_have_text(time.strftime('%Y-%m-%d',time.gmtime()))
        p.locator('.maplibregl-popup-close-button').click();expect(p.locator('.tm-record-card')).to_have_count(0)
        p.get_by_role('button',name='✕ 終了').click();self.assertFalse(p.evaluate('__tm.replay.active()'))
if __name__=='__main__':unittest.main(verbosity=2)
