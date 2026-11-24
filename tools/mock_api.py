"""Local OpenAI-compatible API used to exercise Pixel Atelier without external credentials."""
import argparse
import base64
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / 'examples' / 'knight' / 'idle' / 'atlas.png'
FAIL_DOWNLOADS = 0
RETURN_URL = False
GENERATION_REQUESTS = 0


class MockHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == '/files/generated.png':
            global FAIL_DOWNLOADS
            data = SAMPLE.read_bytes()
            if FAIL_DOWNLOADS > 0:
                FAIL_DOWNLOADS -= 1
                data = data[:len(data) // 2]
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(SAMPLE.read_bytes())))
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path == '/health':
            return self.send_json({'service': 'pixel-atelier-mock-api', 'ready': True})
        if self.path.rstrip('/') == '/v1/models':
            return self.send_json({'object': 'list', 'data': [
                {'id': 'mock-sprite-sheet', 'object': 'model' },
                {'id': 'mock-prompt-polish', 'object': 'model' },
            ] })
        self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        global FAIL_DOWNLOADS, RETURN_URL, GENERATION_REQUESTS
        length = int(self.headers.get('Content-Length', '0'))
        raw = self.rfile.read(length) if length else b''
        if self.path == '/control':
            payload = json.loads(raw)
            FAIL_DOWNLOADS = max(0, min(10, int(payload.get('fail_downloads', FAIL_DOWNLOADS))))
            RETURN_URL = bool(payload.get('return_url', RETURN_URL))
            return self.send_json({'fail_downloads': FAIL_DOWNLOADS, 'return_url': RETURN_URL, 'generation_requests': GENERATION_REQUESTS})
        if self.path.rstrip('/') in ('/v1/images/generations', '/v1/images/edits'):
            time.sleep(.2)
            GENERATION_REQUESTS += 1
            encoded = base64.b64encode(SAMPLE.read_bytes()).decode()
            item = {'url': f'http://127.0.0.1:{self.server.server_port}/files/generated.png'} if RETURN_URL else {'b64_json': encoded}
            return self.send_json({
                'created': int(time.time()),
                'data': [item],
                'mock': {'source': 'examples/knight/idle/atlas.png'},
            })
        if self.path.rstrip('/') == '/v1/chat/completions':
            return self.send_json({
                'choices': [{ message: { role: 'assistant', content: 'Create a clean eight-frame transparent pixel sprite sheet with consistent character proportions.' } }],
            })
        self.send_json({'error': 'Not found'}, 404)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8901)
    args = parser.parse_args()
    if not SAMPLE.is_file():
        raise SystemExit(f'Missing sample image: {SAMPLE}')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), MockHandler)
    print(f'Pixel Atelier mock API http://127.0.0.1:{args.port}/v1', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
