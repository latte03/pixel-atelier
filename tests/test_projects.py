import base64,copy,io,json,tempfile,unittest,zipfile
from pathlib import Path
from PIL import Image,ImageDraw
from bridge.projects import ProjectStore,Conflict,render_action,export_character,image_data,create_from_master,save_idle_gif,create_knight

def project():
 im=Image.new('RGBA',(128,128));ImageDraw.Draw(im).rectangle([50,50,65,100],fill='#a65dcb')
 recipe={'cols':1,'rows':1,'count':1,'frameSize':128,'scale':1,'baseOffset':[0,0],'pivot':[64,112],'durations':[100],'offsets':[[0,0]],'previewScale':1}
 return {'format':'pixel-atelier-character/1','name':'test','spec':{'frameSize':128,'pivot':[64,112],'palette':['#a65dcb','#ffffff'],'frozen':True},'actions':{'idle':{'source':image_data(im),'recipe':recipe},'light':{'source':image_data(im),'recipe':copy.deepcopy(recipe)}}}
class ProjectTests(unittest.TestCase):
 def test_create_from_transparent_master_keeps_native_pixels(self):
  master=project()['actions']['idle']['source']
  p=create_from_master({'name':'  新弓箭手  ','profile':'bow','master':master})
  self.assertEqual(p['name'],'新弓箭手')
  self.assertEqual(p['master'],master)
  self.assertEqual(p['spec']['profile'],'bow')
  self.assertEqual(p['spec']['palette'],['#a65dcb'])
  self.assertTrue(p['spec']['frozen'])
  pose=p['actions']['idle']
  self.assertEqual(pose['recipe']['scale'],1)
  self.assertEqual(render_action(pose)[0].getbbox(),(104,157,120,208))
  with tempfile.TemporaryDirectory() as tmp:
   saved=ProjectStore(tmp).save(p)
   self.assertEqual(saved['revision'],1)

 def test_master_requires_visible_subject_and_transparency(self):
  for fill,message in [('white','透明背景'),((0,0,0,0),'没有可见角色')]:
   with self.subTest(fill=fill),self.assertRaisesRegex(ValueError,message):
    create_from_master({'name':'新角色','master':image_data(Image.new('RGBA',(8,8),fill))})

 def test_idle_gif_import_keeps_timing_and_project_versions(self):
  frames=[]
  for x in [4,11,17]:
   frame=Image.new('RGBA',(36,28))
   ImageDraw.Draw(frame).rectangle((x,6,x+6,19),fill='#a65dcb')
   frames.append(frame)
  encoded=io.BytesIO()
  frames[0].save(encoded,format='GIF',save_all=True,append_images=frames[1:],
                 duration=[80,120,240],loop=0,disposal=2)
  gif=base64.b64encode(encoded.getvalue()).decode()
  with tempfile.TemporaryDirectory() as tmp:
   store=ProjectStore(tmp)
   original=project()
   original['actions']={}
   p=store.save(original)
   data={'image':gif,'index':1,'expected_revision':p['revision']}
   result=save_idle_gif(p,store,data)
   stored=result['project']
   idle=stored['actions']['idle']
   self.assertEqual(result['reference_index'],1)
   self.assertEqual(idle['recipe']['durations'],[80,120,240])
   rendered=render_action(idle)
   self.assertEqual([im.getbbox()[3] for im in rendered],[112,112,112])
   self.assertEqual([rendered[i].getbbox()[0]-rendered[0].getbbox()[0] for i in range(3)],[0,7,13])
   self.assertNotIn('masterBasis',stored)
   data['expected_revision']=stored['revision']
   again=save_idle_gif(stored,store,data)
   self.assertEqual(again['project']['id'],p['id'])
   self.assertEqual(again['action'],'idle_v2')
   self.assertEqual(again['project']['actions']['idle'],idle)

 def test_bundled_knight_contains_eight_playable_actions(self):
  assets=Path(__file__).resolve().parents[1]/'examples'/'knight'
  bundled=create_knight(assets)
  self.assertEqual(list(bundled['actions']),['idle','run','dash','light','heavy','jump','hurt','knockdown'])
  count=0
  for action in bundled['actions'].values():
   frames=render_action(action)
   count+=len(frames)
   self.assertTrue(all(f.size==(224,224) for f in frames))
   self.assertTrue(all(f.getchannel('A').getextrema()==(0,255) for f in frames))
  self.assertEqual(count,80)

 def test_atomic_revision_conflict_and_history(self):
  with tempfile.TemporaryDirectory()as t:
   store=ProjectStore(t);p=store.save(project());p['name']='modified';new=store.save(p,p['id'],1)
   self.assertEqual(new['revision'],2)
   with self.assertRaises(Conflict):store.save(p,p['id'],1)
   self.assertEqual(store.get(p['id'])['name'],'modified');self.assertEqual(json.loads((Path(t)/p['id']/'history/000001.json').read_text())['name'],'test')
 def test_copy_is_independent(self):
  with tempfile.TemporaryDirectory()as t:
   store=ProjectStore(t);a=store.save(project());b=store.save(a);self.assertNotEqual(a['id'],b['id']);b['name']='copy';store.save(b,b['id'],1);self.assertEqual(store.get(a['id'])['name'],'test')
 def test_paths_and_invalid_recipe_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   with self.assertRaises(ValueError):ProjectStore(t).get('../../x')
   p=project();p['actions']['idle']['recipe']['durations']=[83]
   with self.assertRaises(ValueError):ProjectStore(t).save(p)
 def test_export_shared_palette_and_pivot(self):
  with tempfile.TemporaryDirectory()as t:
   p=project();p['actions']['light']['recipe']['events']={'strikes':[0]};out=Path(t)/'export';manifest=export_character(p,out)
   a=json.loads((out/'idle/animation.json').read_text());b=json.loads((out/'light/animation.json').read_text());self.assertEqual(a['palette'],b['palette']);self.assertEqual(a['pivot'],[64,112]);self.assertEqual(a['palette'],p['spec']['palette'])
   with zipfile.ZipFile(out/'assets.zip')as z:self.assertIn('project.json',z.namelist());self.assertIn('light/frames/00.png',z.namelist())
   self.assertEqual(a['events'],{})
   self.assertEqual(b['events'],{'strikes':[0]})
   self.assertEqual(b['event_timeline'],[{'type':'strikes','index':0,'start_ms':0}])
   self.assertEqual(manifest['actions']['light']['technical']['status'],'passed')
 def test_override_and_clipping(self):
  p=project();a=p['actions']['idle'];im=Image.new('RGBA',(128,128));ImageDraw.Draw(im).rectangle([10,10,20,20],fill='white');a['overrides']={'0':image_data(im)};self.assertEqual(render_action(a)[0].getpixel((10,10)),(255,255,255,255));a['recipe']['offsets'][0]=[-20,0]
  with self.assertRaises(ValueError):render_action(a)
 def test_mismatched_spec_blocks_export(self):
  with tempfile.TemporaryDirectory()as t:
   p=project();p['actions']['light']['recipe']['pivot']=[60,112]
   with self.assertRaisesRegex(ValueError,'锚点'):export_character(p,Path(t)/'out')
if __name__=='__main__':unittest.main()
