"""Explicitly launched converter. No startup registration or background service installation."""
import argparse,hashlib,json,os,pathlib,subprocess,sys,tempfile,time,zipfile,threading,xml.etree.ElementTree as ET
MAX_BYTES=50*1024*1024
MAX_PAGES=200
CHUNK=1024*1024

def preflight(path):
    path=pathlib.Path(path)
    if path.stat().st_size<1 or path.stat().st_size>MAX_BYTES: raise ValueError('50 MiB file limit')
    if path.suffix.lower()=='.pdf':
        if not path.read_bytes()[:1024].lstrip().startswith(b'%PDF-'): raise ValueError('Invalid PDF signature')
        return
    if path.suffix.lower()!='.pptx': raise ValueError('Only PDF and PPTX are supported')
    with zipfile.ZipFile(path) as z:
        items=z.infolist(); names=[i.filename for i in items]
        if len(items)>20000 or sum(i.file_size for i in items)>512*1024*1024: raise ValueError('Expanded archive limit')
        if '[Content_Types].xml' not in names or 'ppt/presentation.xml' not in names: raise ValueError('Invalid PPTX package')
        if any('..' in pathlib.PurePosixPath(n).parts or n.startswith(('/','\\')) for n in names): raise ValueError('Unsafe archive path')
        if any(any(s in n.lower() for s in ('vbaproject','activex/','embeddings/')) for n in names): raise ValueError('Macros, ActiveX and OLE are not supported')
        slides=[n for n in names if __import__('re').fullmatch(r'ppt/slides/slide\d+\.xml',n)]
        if not 1<=len(slides)<=MAX_PAGES: raise ValueError('200 slide limit')
        for item in items:
            if item.file_size>MAX_BYTES*2: raise ValueError('Oversized archive member')
            if item.filename.endswith('.rels'):
                root=ET.fromstring(z.read(item))
                if any(r.attrib.get('TargetMode')=='External' for r in root): raise ValueError('External linked resources must be embedded or removed before conversion')

def pdf_pages(pdf_path,out):
    import pymupdf as fitz
    doc=fitz.open(pdf_path)
    if doc.is_encrypted or not 1<=len(doc)<=MAX_PAGES: raise ValueError('Encrypted PDF or 200 page limit')
    assets=[];texts=[]
    for idx,page in enumerate(doc,1):
        one=fitz.open();one.insert_pdf(doc,from_page=idx-1,to_page=idx-1)
        dest=out/f'page-{idx:03}.pdf';one.save(dest,garbage=4,deflate=True);one.close()
        thumb=out/f'thumb-{idx:03}.png';page.get_pixmap(matrix=fitz.Matrix(.25,.25),alpha=False).save(thumb)
        assets.extend([dict(kind='page',page=idx,mime='application/pdf',file=dest.name),dict(kind='thumbnail',page=idx,mime='image/png',file=thumb.name)])
        texts.append(dict(page=idx,text=page.get_text()))
    doc.close();(out/'text.json').write_text(json.dumps(texts,ensure_ascii=False),encoding='utf-8')
    assets.append(dict(kind='text',page=0,mime='application/json',file='text.json'))
    return assets,texts

def pptx_video(path,out):
    import pythoncom,win32com.client
    pythoncom.CoInitialize();app=win32com.client.DispatchEx('PowerPoint.Application')
    prior_presentations=app.Presentations.Count;prior_security=app.AutomationSecurity;app.AutomationSecurity=3
    pres=None;warnings=['PowerPoint 변환 결과의 애니메이션·내장 영상·음성·글꼴을 확인한 뒤 검토 완료를 선택하세요.']
    try:
        pres=app.Presentations.Open(str(path.resolve()),ReadOnly=True,Untitled=False,WithWindow=False)
        if not 1<=pres.Slides.Count<=MAX_PAGES: raise ValueError('200 slide limit')
        pres.SaveCopyAs(str((out/'rendered.pdf').resolve()),32)
        videos=[]
        for idx in range(1,pres.Slides.Count+1):
            copy=out/f'working-slide-{idx:03}.pptx';pres.SaveCopyAs(str(copy.resolve()),24)
            single=app.Presentations.Open(str(copy.resolve()),ReadOnly=False,Untitled=False,WithWindow=False)
            try:
                for remove in range(single.Slides.Count,0,-1):
                    if remove!=idx: single.Slides(remove).Delete()
                slide=single.Slides(1)
                # Convert untimed click sequences into a linear presentation, preserving recorded timings.
                for effect_idx in range(1,slide.TimeLine.MainSequence.Count+1):
                    effect=slide.TimeLine.MainSequence(effect_idx)
                    if effect.Timing.TriggerType==1: effect.Timing.TriggerType=3
                if slide.TimeLine.InteractiveSequences.Count:
                    warnings.append(f'{idx}쪽: 클릭 분기 효과는 자동 재현되지 않을 수 있습니다.')
                for shape_idx in range(1,slide.Shapes.Count+1):
                    shape=slide.Shapes(shape_idx)
                    if shape.Type==16: shape.AnimationSettings.PlaySettings.PlayOnEntry=True
                video=out/f'video-{idx:03}.mp4'
                # Recorded timings/narration first, 5 seconds for untimed slides.
                single.CreateVideo(str(video.resolve()),True,5,720,24,70)
                deadline=time.monotonic()+600
                while True:
                    status=single.CreateVideoStatus
                    if status==3: break
                    if status==4: raise RuntimeError('PowerPoint video rendering failed')
                    if time.monotonic()>deadline: raise TimeoutError('Slide video exceeded 10 minutes')
                    pythoncom.PumpWaitingMessages();time.sleep(.5)
                if not video.exists() or video.stat().st_size==0: raise RuntimeError('Empty slide video')
                videos.append(dict(kind='video',page=idx,mime='video/mp4',file=video.name))
            finally: single.Close();copy.unlink(missing_ok=True)
        return out/'rendered.pdf',videos,warnings
    finally:
        if pres is not None: pres.Close()
        app.AutomationSecurity=prior_security
        if prior_presentations==0 and app.Presentations.Count==0: app.Quit()
        pythoncom.CoUninitialize()

def convert(path,out):
    path=pathlib.Path(path);out=pathlib.Path(out);out.mkdir(parents=True,exist_ok=True);preflight(path)
    videos=[];warnings=[];pdf=path
    if path.suffix.lower()=='.pptx': pdf,videos,warnings=pptx_video(path,out)
    assets,texts=pdf_pages(pdf,out)
    result=dict(pages=len(texts),searchable=any(t['text'].strip() for t in texts),warnings=warnings,assets=assets+videos)
    for a in result['assets']:
        f=out/a['file'];a.update(bytes=f.stat().st_size,sha256=hashlib.sha256(f.read_bytes()).hexdigest())
    (out/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result

class Remote:
    def __init__(self,url,token):
        import requests
        if not url.startswith('https://'): raise ValueError('HTTPS converter endpoint required')
        self.url=url.rstrip('/');self.http=requests.Session();self.http.headers.update(Authorization='Bearer '+token)
    def rpc(self,action,p=None):
        r=self.http.post(self.url+'/api/worker/rpc',json=dict(action=action,p=p or {}),timeout=60);r.raise_for_status();return r.json()
    def process(self,task,work):
        book=task['book'];lease=dict(book_id=book['id'],lease_id=task['job']['lease_id']);stop=threading.Event()
        def heartbeat():
            while not stop.wait(45):
                try:self.rpc('heartbeat',lease)
                except Exception:stop.set()
        thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
        try:
            source=work/('source.'+book['format'])
            with source.open('wb') as dest:
                size=0;step=8*1024*1024
                for offset in range(0,book['source_bytes'],step):
                    end=min(book['source_bytes']-1,offset+step-1)
                    with self.http.get(self.url+'/api/worker/source',params=lease,headers={'Range':f'bytes={offset}-{end}'},stream=True,timeout=120) as r:
                        r.raise_for_status()
                        if r.status_code!=206 or r.headers.get('Content-Range')!=f'bytes {offset}-{end}/{book["source_bytes"]}':raise ValueError('Invalid source range response')
                        for part in r.iter_content(CHUNK):
                            size+=len(part)
                            if size>MAX_BYTES:raise ValueError('Downloaded source exceeds limit')
                            dest.write(part)
            if source.stat().st_size!=book['source_bytes']: raise ValueError('Source size mismatch')
            out=work/'result'
            # A separate process makes the overall conversion deadline enforceable.
            subprocess.run([sys.executable,__file__,'convert',str(source),'--out',str(out)],check=True,timeout=7200)
            result=json.loads((out/'manifest.json').read_text(encoding='utf-8'))
            for asset in result['assets']:
                if stop.is_set(): raise RuntimeError('Worker lease heartbeat failed')
                self.rpc('heartbeat',lease)
                ticket=self.rpc('asset_create',{**lease,**{k:asset[k] for k in ('kind','page','mime','bytes')}})
                if ticket['complete']:continue
                with (out/asset['file']).open('rb') as data:
                    idx=0
                    while part:=data.read(CHUNK):
                        r=self.http.put(self.url+'/api/worker/upload',params={**lease,'asset_id':ticket['id'],'idx':idx},data=part,timeout=120)
                        r.raise_for_status();idx+=1
                self.rpc('asset_complete',{**lease,'asset_id':ticket['id']})
            self.rpc('finish',{**lease,**{k:result[k] for k in ('pages','searchable','warnings')}})
        except Exception as exc:
            # Only sanitized type is sent back; no URL, bearer token, or source content in logs.
            try:self.rpc('fail',{**lease,'error':'Conversion failed: '+type(exc).__name__})
            except Exception:pass
            print('Conversion failed:',type(exc).__name__,flush=True)
        finally:stop.set();thread.join(timeout=1)

def main():
    p=argparse.ArgumentParser(description='PMOffice ebook converter: runs only while explicitly started')
    p.add_argument('mode',choices=['convert','run']);p.add_argument('source',nargs='?');p.add_argument('--out');p.add_argument('--work',default=str(pathlib.Path(__file__).parent/'work'));p.add_argument('--once',action='store_true');args=p.parse_args()
    if args.mode=='convert':
        if not args.source or not args.out:p.error('convert requires source and --out')
        result=convert(args.source,args.out);print(json.dumps(dict(pages=result['pages'],assets=len(result['assets'])),ensure_ascii=False));return
    url=os.environ.get('EBOOK_API_URL','');token=os.environ.get('EBOOK_CONVERTER_TOKEN','')
    if not url or not token:p.error('Set EBOOK_API_URL and EBOOK_CONVERTER_TOKEN in this process environment')
    remote=Remote(url,token);work=pathlib.Path(args.work).resolve();work.mkdir(parents=True,exist_ok=True)
    print('PMOffice converter running. Ctrl+C to stop. No startup registration.',flush=True)
    while True:
        try:
            task=remote.rpc('claim')
            if task:
                with tempfile.TemporaryDirectory(prefix='job-',dir=work) as folder:remote.process(task,pathlib.Path(folder))
        except KeyboardInterrupt:break
        except Exception as exc:print('Connection paused:',type(exc).__name__,flush=True)
        if args.once:break
        time.sleep(15)
if __name__=='__main__':main()
