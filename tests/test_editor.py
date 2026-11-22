import base64,io,json,tempfile,unittest,zipfile
from pathlib import Path
from PIL import Image,ImageDraw,ImageSequence
from bridge.editor import export_animation,gif_reference_frames,decode_image

def encoded(im):
    b=io.BytesIO();im.save(b,format='PNG');return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()

def pose(x,size=64):
    im=Image.new('RGBA',(size,size));ImageDraw.Draw(im).rectangle([x,20,x+7,40],fill=(230,180,70,255));return im

class EditorExportTests(unittest.TestCase):
    def payload(self):
        return {'frames':[{'image':encoded(pose(x)),'duration_ms':d,'offset':[i,0]}for i,(x,d)in enumerate([(5,80),(20,130),(38,220)])],'pivot':[32,54],'preview_scale':2,'colors':64,'source':encoded(pose(5)),'recipe':{'scale':1,'baseOffset':[0,0]}}
    def test_roundtrip_transparency_timing_atlas_and_package(self):
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp)/'result';p=self.payload();conf=export_animation(p,root)
            self.assertEqual(conf['duration_ms'],430);self.assertEqual(conf['frames'][2]['start_ms'],210)
            self.assertEqual(conf['frames'][1]['whole_frame_offset'],[1,0]);self.assertFalse(conf['parts_assembly'])
            gif=Image.open(root/'preview.gif');self.assertEqual(gif.n_frames,3);self.assertEqual(gif.info['loop'],0)
            for i,f in enumerate(ImageSequence.Iterator(gif)):
                self.assertEqual(f.info['duration'],[80,130,220][i]);actual=f.convert('RGBA')
                expected=Image.open(root/conf['frames'][i]['file']).resize((128,128),Image.Resampling.NEAREST)
                self.assertEqual(actual.tobytes(),expected.tobytes());self.assertEqual(actual.getpixel((0,0))[3],0)
            gif.close()
            atlas=Image.open(root/'atlas.png');self.assertEqual(atlas.size,(256,64))
            for i in range(3):self.assertEqual(atlas.crop((i*64,0,(i+1)*64,64)).tobytes(),Image.open(root/conf['frames'][i]['file']).tobytes())
            with zipfile.ZipFile(root/'assets.zip')as z:
                self.assertIn('source.png',z.namelist());self.assertIn('frames/02.png',z.namelist());self.assertEqual(json.loads(z.read('animation.json'))['pivot'],[32,54])
    def test_gif_reference_preserves_frame_index_and_transparency(self):
        frames = [pose(x) for x in (5, 20, 38)]
        gif = io.BytesIO()
        frames[0].save(gif, format='GIF', save_all=True, append_images=frames[1:],
                       duration=80, disposal=2, loop=0)
        reference = gif_reference_frames(base64.b64encode(gif.getvalue()).decode())
        self.assertEqual(reference['count'], 3)
        self.assertEqual([r['index'] for r in reference['frames']], [0, 1, 2])
        for expected, sample in zip(frames, reference['frames']):
            self.assertEqual(decode_image(sample['image']).tobytes(), expected.tobytes())

    def test_rejects_mixed_frame_sizes(self):
        p=self.payload();p['frames'][1]['image']=encoded(pose(5,80))
        with tempfile.TemporaryDirectory()as t,self.assertRaisesRegex(ValueError,'尺寸必须一致'):export_animation(p,Path(t)/'out')
    def test_rejects_non_gif_timing(self):
        p=self.payload();p['frames'][0]['duration_ms']=83
        with tempfile.TemporaryDirectory()as t,self.assertRaisesRegex(ValueError,'10ms'):export_animation(p,Path(t)/'out')
    def test_rejects_blank_pose_and_invalid_pivot(self):
        for change,msg in [(lambda p:p['frames'][0].update(image=encoded(Image.new('RGBA',(64,64)))),'空白帧'),(lambda p:p.update(pivot=[64,64]),'锚点')]:
            p=self.payload();change(p)
            with tempfile.TemporaryDirectory()as t,self.assertRaisesRegex(ValueError,msg):export_animation(p,Path(t)/'out')
    def test_events_track_retimed_frames_and_export_findings(self):
        p=self.payload()
        p['recipe']['events']={'strikes':[2,0],'releases':[1]}
        p['frames'][0]['image']=encoded(pose(0))
        p['frames'][1]['image']=encoded(Image.new('RGBA',(64,64),'white'))
        p['frames'][0]['duration_ms']=110
        with tempfile.TemporaryDirectory() as t:
            conf=export_animation(p,Path(t)/'out')
        self.assertEqual(conf['events'],{'strikes':[0,2],'releases':[1]})
        self.assertEqual(conf['event_timeline'],[
            {'type':'strikes','index':0,'start_ms':0},
            {'type':'releases','index':1,'start_ms':110},
            {'type':'strikes','index':2,'start_ms':240},
        ])
        self.assertEqual(conf['technical'],{'status':'warnings','warnings':[
            {'index':0,'code':'touches_canvas_edge'},
            {'index':1,'code':'no_transparency'},
        ]})
        self.assertEqual(conf['review']['visual'],'pending')

    def test_event_indices_must_be_unique_and_in_range(self):
        for bad in ([True],[3],[-1],[1,1]):
            p=self.payload()
            p['recipe']['events']={'strikes':bad}
            with self.subTest(bad=bad),tempfile.TemporaryDirectory() as t:
                out=Path(t)/'out'
                with self.assertRaisesRegex(ValueError,'动作事件'):
                    export_animation(p,out)
                self.assertFalse(out.exists())

    def test_nonloop_animation_omits_loop_extension(self):
        p=self.payload();p['loop']=False
        with tempfile.TemporaryDirectory()as t:
            out=Path(t)/'out';export_animation(p,out)
            with Image.open(out/'preview.gif')as gif:self.assertNotIn('loop',gif.info)

if __name__=='__main__':unittest.main()
