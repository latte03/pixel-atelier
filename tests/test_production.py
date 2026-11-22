import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

from bridge.production import Production, REVIEW_SECONDS, STEPS
from bridge.projects import ProjectStore, image_data


class ProductionTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.projects = ProjectStore(self.root/'projects')
        self.project = self.projects.save({
            'format':'pixel-atelier-character/1','name':'test','master':None,'actions':{},
            'spec':{'frameSize':128,'pivot':[64,112],'version':0,'palette':[],'frozen':False},
        })
        self.pid = self.project['id']
        self.jobs = {}
        self.requests = []
        self.atlas = self.root/'sheet.png'
        sheet = Image.new('RGBA',(256,128))
        draw = ImageDraw.Draw(sheet)
        for i in range(8):
            left, top = i%4*64+16+i%2, i//4*64+12
            draw.rectangle((left,top,left+30,top+38),fill='#613ab5')
        sheet.save(self.atlas)
        self.flow = Production(self.root/'production',self.projects,self.jobs,self.enqueue,
                               lambda job:self.atlas,lambda:False)

    def enqueue(self, data):
        self.requests.append(data)
        job={**data,'id':f'job-{len(self.requests)}','status':'completed',
             'finished_at':time.time()-REVIEW_SECONDS-1}
        self.jobs[job['id']]=job
        return job

    def command(self, op, **kwargs):
        return self.flow.command({'id':self.pid,'op':op,**kwargs})

    def test_managed_pauses_for_review_then_packages_every_selected_action(self):
        self.command('start',reference=image_data(Image.new('RGBA',(16,16),'#613ab5')))
        self.flow.tick()
        pending=self.flow.get(self.pid)['pending']
        self.jobs[pending]['finished_at']=time.time()
        self.flow.tick()
        self.assertEqual(self.flow.get(self.pid)['active'],'idle')
        self.assertGreater(self.flow.get(self.pid)['review_in'],0)
        self.command('pause')
        self.jobs[pending]['finished_at']-=REVIEW_SECONDS+1
        self.flow.tick()
        self.assertEqual(self.flow.get(self.pid)['active'],'idle')
        self.command('resume')
        for _ in range(16):
            self.flow.tick()
        end=self.flow.get(self.pid)
        self.assertEqual(list(end['accepted']),list(STEPS))
        self.assertFalse(end['running'])
        project=self.projects.get(self.pid)
        self.assertTrue(project['spec']['frozen'])
        self.assertTrue(all(req['reference']==project['master'] for req in self.requests[1:]))
        zip_id=end['export'].split('/')[2]
        with zipfile.ZipFile(self.root/'exports'/zip_id/'assets.zip') as z:
            for action in STEPS:
                self.assertIn(action+'/preview.gif',z.namelist())
                self.assertIn(action+'/animation.json',z.namelist())

    def test_strict_processing_failure_stays_on_same_action(self):
        self.command('start',reference=image_data(Image.new('RGBA',(16,16),'#613ab5')))
        self.flow.tick()
        original=self.atlas.read_bytes()
        Image.new('RGBA',(256,128)).save(self.atlas)
        self.flow.tick()
        failed=self.flow.get(self.pid)
        self.assertEqual(failed['active'],'idle')
        self.assertFalse(failed['running'])
        self.assertIn('第 1 格',failed['error'])
        self.atlas.write_bytes(original)
        self.command('resume')
        self.flow.tick()
        self.flow.tick()
        self.assertEqual(self.flow.get(self.pid)['active'],'run')
        self.assertEqual(len(self.flow.get(self.pid)['steps'][0]['versions']),2)


if __name__=='__main__':unittest.main()
