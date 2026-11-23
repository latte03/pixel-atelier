import base64
import importlib.util
import io
import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / 'bridge'
if str(BRIDGE) not in sys.path:
    sys.path.insert(0, str(BRIDGE))

import settings as settings_module  # noqa: E402
import clients  # noqa: E402
import rpc  # noqa: E402


def sprite_png():
    image = Image.new('RGBA', (8, 8), (0, 0, 0, 0))
    for x in range(4):
        for y in range(8):
            image.putpixel((x, y), (200, 30, 30, 255))
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    return buffer.getvalue()


class MockAPIHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.endswith('/models'):
            self._json(200, {'data': [{'id': 'img-a'}, {'id': 'img-b'}]})
        elif self.path.startswith('/files/'):
            data = self.server.transparent_png
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        else:
            self._json(404, {'error': 'not found'})

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        if self.path.endswith('/images/generations'):
            payload = json.loads(body)
            if payload.get('prompt') == 'FAIL':
                self._json(500, {'error': {'message': 'quota exceeded'}})
                return
            if not payload.get('model') or not payload.get('prompt'):
                self._json(400, {'error': 'model and prompt required'})
                return
            encoded = base64.b64encode(self.server.transparent_png).decode()
            self._json(200, {'created': 1, 'data': [{'b64_json': encoded}]})
        elif self.path.endswith('/images/edits'):
            text = body.decode('latin-1')
            ok = all(f'name="{field}"' in text for field in ('model', 'prompt', 'image'))
            if not ok:
                self._json(400, {'error': 'multipart missing fields'})
                return
            port = self.server.server_port
            self._json(200, {'created': 1, 'data': [{'url': f'http://127.0.0.1:{port}/files/generated.png'}]})
        elif self.path.endswith('/chat/completions'):
            payload = json.loads(body)
            if not payload.get('model') or not payload.get('messages'):
                self._json(400, {'error': 'model and messages required'})
                return
            self._json(200, {'choices': [{'message': {'content': 'PIXEL PROMPT'}}]})
        else:
            self._json(404, {'error': 'not found'})


class ClientTestBase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), MockAPIHandler)
        cls.server.transparent_png = sprite_png()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}/v1'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()


class SettingsTests(ClientTestBase):
    def test_defaults_and_secret_masking(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = settings_module.Settings(Path(tmp) / 'config.json')
            masked = store.masked()
            self.assertEqual(masked['provider'], 'custom')
            self.assertEqual(masked['image']['base_url'], 'https://corecode.live/v1')
            self.assertFalse(masked['image']['has_key'])
            self.assertEqual(masked['image']['api_key'], '')
            store.update({'image': {'api_key': 'sk-test-0001'}})
            masked = store.masked()
            self.assertEqual(masked['image']['api_key'], '••••0001')
            self.assertTrue(masked['image']['has_key'])
            self.assertEqual(store.raw()['image']['api_key'], 'sk-test-0001')

    def test_keep_placeholder_preserves_saved_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = settings_module.Settings(Path(tmp) / 'config.json')
            store.update({'llm': {'api_key': 'sk-keep-me', 'model': 'm1'}})
            store.update({'llm': {'api_key': settings_module.KEEP, 'model': 'm2'}})
            raw = store.raw()['llm']
            self.assertEqual(raw['api_key'], 'sk-keep-me')
            self.assertEqual(raw['model'], 'm2')

    def test_unknown_keys_are_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = settings_module.Settings(Path(tmp) / 'config.json')
            store.update({'hacker': True, 'image': {'api_key': 'sk-x', 'nope': 1}})
            raw = store.raw()
            self.assertNotIn('hacker', raw)
            self.assertNotIn('nope', raw['image'])

    def test_null_patch_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = settings_module.Settings(Path(tmp) / 'config.json')
            store.update({'image': {'api_key': 'sk-test-0002'}})
            store.update({'image': {'api_key': None, 'base_url': 'http://127.0.0.1:9/v1'}})
            raw = store.raw()['image']
            self.assertEqual(raw['api_key'], 'sk-test-0002')
            self.assertEqual(raw['base_url'], 'http://127.0.0.1:9/v1')
            self.assertEqual(store.masked()['image']['api_key'], '••••0002')

    def test_masked_tolerates_poisoned_secret(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'config.json'
            path.write_text(json.dumps({'image': {'api_key': None}}))
            store = settings_module.Settings(path)
            masked = store.masked()
            self.assertEqual(masked['image']['api_key'], '')
            self.assertFalse(masked['image']['has_key'])
            store.update({'llm': {'model': 'm1'}})
            self.assertEqual(store.raw()['image']['api_key'], None)


class ImageClientTests(ClientTestBase):
    def test_requires_key_and_model(self):
        with self.assertRaisesRegex(rpc.BridgeError, 'API Key'):
            clients.ImageAPIClient(self.base, '', 'img-a')
        with self.assertRaisesRegex(rpc.BridgeError, '模型'):
            clients.ImageAPIClient(self.base, 'sk-1', '')

    def test_generate_without_reference_uses_generations(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = clients.ImageAPIClient(self.base, 'sk-1', 'img-a', size='1024x1024')
            result = client.generate('draw a knight', None, tmp)
            self.assertEqual(result['model'], 'img-a')
            self.assertEqual(result['completion'], 'api_completed')
            path = Path(result['images'][0])
            self.assertTrue(path.is_file())
            with Image.open(path) as image:
                low, high = image.convert('RGBA').getchannel('A').getextrema()
                self.assertEqual(low, 0)
                self.assertGreater(high, 0)

    def test_generate_with_reference_uses_edits(self):
        with tempfile.TemporaryDirectory() as tmp:
            reference = Path(tmp) / 'reference.png'
            reference.write_bytes(self.server.transparent_png)
            client = clients.ImageAPIClient(self.base, 'sk-1', 'img-a', size='1536x1024')
            result = client.generate('make it run', reference, tmp)
            self.assertEqual(len(result['images']), 1)
            self.assertTrue(Path(result['images'][0]).is_file())

    def test_error_response_surfaces_detail(self):
        client = clients.ImageAPIClient(self.base, 'sk-1', 'img-a')
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(rpc.BridgeError, '生图 API 返回 500'):
                client.generate('FAIL', None, tmp)


class LLMClientTests(ClientTestBase):
    def test_chat_returns_content(self):
        client = clients.LLMClient(self.base, 'sk-1', 'llm-x')
        self.assertEqual(client.chat('把这段改写成英文提示词', system='只输出提示词'), 'PIXEL PROMPT')

    def test_models_listing(self):
        self.assertEqual(clients.fetch_models(self.base, 'sk-1'), ['img-a', 'img-b'])


class PromptPolishTests(unittest.TestCase):
    """The polished prompt must carry the real sheet layout, never a hardcoded 4x2."""

    def setUp(self):
        import server  # noqa: E402  (CLI-first module; safe to import, does not serve)
        self.server = server
        self.captured = []

        class FakeLLM:
            def __init__(self, base_url, api_key, model, timeout=120):
                pass

            def chat(self, prompt, system=None, timeout=None):
                self_capture = system
                PromptPolishTests.captured.append(self_capture)
                return 'ENGLISH PROMPT'

        self._original = server.LLMClient
        server.LLMClient = FakeLLM
        PromptPolishTests.captured = self.captured

    def tearDown(self):
        self.server.LLMClient = self._original

    def cfg(self):
        return {'base_url': 'x', 'api_key': 'k', 'model': 'm', 'polish_prompt': True}

    def test_sheet_layout_comes_from_job(self):
        out = self.server.polish_prompt('画一套 4x4 的动作图', self.cfg(), lambda e: None,
                                        {'cols': 4, 'rows': 4, 'count': 16}, 'sheet')
        self.assertEqual(out, 'ENGLISH PROMPT')
        system = self.captured[-1]
        self.assertIn('4列×4行表格', system)
        self.assertIn('16', system)
        self.assertNotIn('4列×2行', system)

    def test_invalid_layout_does_not_claim_4x2(self):
        self.server.polish_prompt('p', self.cfg(), lambda e: None, None, 'sheet')
        system = self.captured[-1]
        self.assertNotIn('4列×2行', system)
        self.assertIn('不得改成其他排版', system)

    def test_pose_has_no_grid(self):
        self.server.polish_prompt('p', self.cfg(), lambda e: None, None, 'pose')
        system = self.captured[-1]
        self.assertIn('不要生成表格', system)
        self.assertNotIn('列×', system)

    def test_disabled_polish_returns_input(self):
        cfg = dict(self.cfg(), polish_prompt=False)
        self.assertEqual(self.server.polish_prompt('原始提示词', cfg, lambda e: None), '原始提示词')
        self.assertEqual(self.captured, [])

    def test_llm_failure_falls_back_to_original(self):
        def boom(**kwargs):
            raise rpc.BridgeError('模型不可用')

        class Broken:
            def __init__(self, *args, **kwargs):
                pass

            def chat(self, *args, **kwargs):
                return boom(**kwargs)

        self.server.LLMClient = Broken
        events = []
        out = self.server.polish_prompt('原始提示词', self.cfg(), events.append, {'cols': 4, 'rows': 2, 'count': 8}, 'sheet')
        self.assertEqual(out, '原始提示词')
        self.assertEqual(events[-1]['status'], 'failed')


class LayoutConstraintTests(unittest.TestCase):
    def setUp(self):
        import server
        self.fn = server.layout_constraint

    def test_sheet_with_conflict_free_counts(self):
        grid, subject = self.fn({'cols': 4, 'rows': 2, 'count': 8}, 'sheet')
        self.assertEqual(grid, '4列×2行表格（共8个关键姿势）')
        self.assertEqual(subject, '每格一名完整角色')

    def test_pose_never_mentions_grid(self):
        grid, subject = self.fn(None, 'pose')
        self.assertIn('不要生成表格', grid)
        self.assertEqual(subject, '完整角色居中')

    def test_malformed_layout_degrades_safely(self):
        grid, _ = self.fn({'cols': '4', 'rows': None, 'count': 0}, 'sheet')
        self.assertIn('不得改成其他排版', grid)
        self.assertNotIn('4列×2行', grid)


if __name__ == '__main__':
    unittest.main()
