import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('pixel_bridge_rpc',Path(__file__).resolve().parents[1]/'bridge/rpc.py')
rpc=importlib.util.module_from_spec(spec);spec.loader.exec_module(rpc)

class BridgeProtocolTests(unittest.TestCase):
    def client(self):
        c=rpc.CodexClient.__new__(rpc.CodexClient);c.counter=0;c.timeout=1;c.on_event=lambda e:None;return c
    def test_request_matches_rpc_id_while_observing_events(self):
        c=self.client();sent=[];seen=[];c.send=sent.append;c.observe=seen.append
        stream=iter([{'method':'turn/started','params':{}},{'id':1,'result':{'ok':True}}]);c.next=lambda timeout:next(stream)
        self.assertEqual(c.request('model/list',{}),{'ok':True});self.assertEqual(sent[0]['id'],1);self.assertEqual(len(seen),1)
    def test_rpc_error_is_never_success(self):
        c=self.client();c.send=lambda m:None;c.next=lambda timeout:{'id':1,'error':{'code':123,'message':'model unavailable'}}
        with self.assertRaisesRegex(rpc.BridgeError,'model unavailable'):c.request('thread/start',{})
    def test_client_side_tools_and_approvals_are_rejected(self):
        c=self.client();sent=[];c.send=sent.append;c.observe({'id':4,'method':'item/commandExecution/requestApproval','params':{}})
        self.assertEqual(sent[0]['error']['code'],-32601)
    def test_text_only_idle_turn_omits_image_input(self):
        c=self.client();requests=[]
        def request(method,params):
            requests.append((method,params))
            if method=='model/list':
                return {'data':[{'model':'test','isDefault':True}]}
            if method=='thread/start':
                return {'thread':{'id':'test'}}
            raise RuntimeError('sent')
        c.request=request
        with patch('pathlib.Path.mkdir'),self.assertRaisesRegex(RuntimeError,'sent'):
            c.generate(None,'Draw an idle cycle','.')
        self.assertEqual(requests[-1][1]['input'],[{'type':'text','text':'Draw an idle cycle'}])

    def test_missing_turn_completion_keeps_transparent_result(self):
        client=self.client()
        client.request=lambda method,params: {
            'model/list':{'data':[{'model':'test','isDefault':True}]},
            'thread/start':{'thread':{'id':'test'}},
        }.get(method,{})
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            first=root/'opaque.png'
            Image.new('RGBA',(8,8),(25,25,25,255)).save(first)
            second=root/'transparent.png'
            im=Image.new('RGBA',(8,8))
            im.putpixel((4,4),(25,25,25,255))
            im.save(second)
            events=iter([
                {'method':'item/completed','params':{'item':{'type':'imageGeneration','status':'completed','savedPath':str(path)}}}
                for path in (first,second)
            ])
            def receive(timeout):
                event=next(events,None)
                if event is None:raise rpc.BridgeError('Codex response timed out')
                return event
            client.next=receive
            result=client.generate(None,'Draw a sprite',root,timeout=.04)
            self.assertEqual(result['images'],[str((root/'result-1.png').resolve())])
            self.assertEqual(result['completion'],'artifact_recovered')

    def test_timeout_without_any_artifact_stays_failed(self):
        client=self.client()
        client.request=lambda method,params: {
            'model/list':{'data':[{'model':'test','isDefault':True}]},
            'thread/start':{'thread':{'id':'test'}},
        }.get(method,{})
        def receive(timeout):
            raise rpc.BridgeError('Codex response timed out')
        client.next=receive
        with tempfile.TemporaryDirectory() as tmp,self.assertRaisesRegex(rpc.BridgeError,'timed out'):
            client.generate(None,'Draw a sprite',tmp,timeout=.01)

    def test_process_exit_produces_failure(self):
        c=self.client();c.send=lambda m:None
        with self.assertRaisesRegex(rpc.BridgeError,'exited'):c.observe({'method':'bridge/processExited'})

if __name__=='__main__':unittest.main()
