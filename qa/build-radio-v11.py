"""Prepare the selected CC0 public previews into the embedded V11 radio kit.
Usage: python3 qa/build-radio-v11.py /path/to/downloaded/previews
The input directory holds <Freesound ID>.mp3 and matching saved public HTML.
"""
import base64,hashlib,json,re,subprocess,sys
from pathlib import Path
import numpy as np
root=Path(__file__).resolve().parents[1]
inputs=Path(sys.argv[1])
items=[('radioReply1',422843,'ciaranm758','Reply1.wav'),('radioReply3',422847,'ciaranm758','Reply3.wav'),('radioIn',422844,'ciaranm758','RadioIn.wav'),('radioAffirmative',520308,'alean','Affirmative 2.wav'),('radioRoger',520363,'alean','Ruger that.wav'),('radioStanding',520362,'alean','Standing by 2.wav')]
entries=[];records=[];sha=lambda b:hashlib.sha256(b).hexdigest()
for key,id,author,title in items:
 source=inputs/f'{id}.mp3';page=(inputs/f'{id}.html').read_text();assert 'zero/1.0' in page
 preview=next(s for s in sorted(set(re.findall(r'https://cdn\.freesound\.org/previews/[^\s"<>]+',page))) if s.endswith('-hq.mp3'))
 raw=subprocess.check_output(['ffmpeg','-v','error','-nostdin','-i',str(source),'-af','highpass=f=260,lowpass=f=3650','-f','f32le','-ac','1','-ar','24000','pipe:1'])
 a=np.frombuffer(raw,dtype='<f4').astype(np.float64);assert np.isfinite(a).all();a-=a.mean()
 peak=float(np.abs(a).max());assert peak>.01
 # Remove silent padding while retaining the recorded radio in/out breaths.
 window=240;energy=np.array([np.sqrt(np.mean(a[i:i+window]**2)) for i in range(0,len(a),window)])
 active=np.flatnonzero(energy>max(.003,energy.max()*.035));start=max(0,int(active[0])*window-2400);stop=min(len(a),(int(active[-1])+1)*window+3600);a=a[start:stop]
 a*=.64/max(.001,float(np.abs(a).max()));fade=min(len(a)//4,240)
 a[:fade]*=np.linspace(0,1,fade);a[-fade:]*=np.linspace(1,0,fade)
 pcm=np.round(np.clip(a,-.99,.99)*32768).astype('<i2').tobytes();entries.append(key+":decode('"+base64.b64encode(pcm).decode()+"',24000)")
 records.append({'key':key,'title':title,'author':author,'source':f'https://freesound.org/people/{author}/sounds/{id}/','preview':preview,'license':'CC0 1.0','rate':24000,'frames':len(a),'trimStartSeconds':start/24000,'trimEndSeconds':stop/24000,'sourceSha256':sha(source.read_bytes()),'pcmSha256':sha(pcm),'rms':float(np.sqrt(np.mean(a*a))),'peak':float(np.abs(a).max())})
kit=root/'dist/audio/radio-kit.js';text=kit.read_text().split('// V11 recorded radio additions')[0].rstrip();kit.write_text(text+'\n\n// V11 recorded radio additions. Author and license details: ATTRIBUTION.txt.\nObject.assign(RADIO_KIT,{'+','.join(entries)+'});\n')
report={'version':11,'radio':records,'processing':'Recorded public CC0 previews, mono24kHz,260Hz high-pass,3650Hz low-pass, DC removal, silence-only edge trim, fixed .64 peak and10ms edge fades. No speech generation or pitch alteration.'}
(root/'qa/audio-v11-assets.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':'passed','newRecordings':len(records),'spokenAdditions':5,'records':[{k:v for k,v in x.items() if k in ['key','frames','rms','peak']} for x in records]},indent=2))
