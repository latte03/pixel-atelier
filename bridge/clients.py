"""OpenAI-compatible image and chat clients driven by user-supplied API keys."""
import base64
import http.client
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from PIL import Image

try:
    from .rpc import BridgeError, inspect_sprite_png
except ImportError:
    from rpc import BridgeError, inspect_sprite_png

USER_AGENT = 'pixel-atelier-bridge/0.1'


def _read_json(response, incomplete_message):
    try:
        body = response.read()
    except http.client.IncompleteRead as error:
        try:
            return json.loads(error.partial.decode('utf-8'))
        except (UnicodeDecodeError, ValueError) as partial_error:
            raise BridgeError(
                f'{incomplete_message}（已接收 {len(error.partial)} 字节，仍缺 {error.expected} 字节）'
            ) from partial_error
    return json.loads(body.decode('utf-8'))


def _http_json(url, payload=None, api_key=None, method=None, timeout=60):
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    if api_key:
        headers['Authorization'] = 'Bearer ' + api_key
    request = urllib.request.Request(url, data=data, headers=headers, method=method or ('POST' if data else 'GET'))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return _read_json(response, 'API 响应传输中断，请重试')
    except urllib.error.HTTPError as error:
        detail = ''
        try:
            detail = error.read().decode('utf-8', 'replace')[:400]
        except Exception:
            pass
        raise BridgeError(f'API 返回 {error.code}：{detail or error.reason}') from error
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise BridgeError(f'无法连接 API（{url}）：{error}') from error


def fetch_models(base_url, api_key, timeout=30):
    """List model ids from an OpenAI-compatible /models endpoint."""
    url = base_url.rstrip('/') + '/models'
    payload = _http_json(url, api_key=api_key, timeout=timeout)
    items = payload.get('data') if isinstance(payload, dict) else payload
    models = []
    for item in items or []:
        model_id = item.get('id') if isinstance(item, dict) else item
        if model_id:
            models.append(str(model_id))
    return models


def _complete_png(data):
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != 'PNG':
                return False
            image.verify()
        return True
    except Exception:
        return False


def _download(url, timeout=120):
    if url.startswith('data:'):
        return base64.b64decode(url.split(',', 1)[-1])
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise BridgeError('下载生成图片失败：图片链接格式无效')
    data = bytearray()
    last_error = None
    for _ in range(3):
        headers = {'User-Agent': USER_AGENT}
        if data:
            headers['Range'] = f'bytes={len(data)}-'
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                if data and response.status == 200:
                    data.clear()
                elif response.status == 206:
                    content_range = response.headers.get('Content-Range', '')
                    if not content_range.startswith(f'bytes {len(data)}-'):
                        raise BridgeError('下载生成图片失败：续传位置不匹配')
                data.extend(response.read())
                return bytes(data)
        except urllib.error.HTTPError as error:
            raise BridgeError(f'下载生成图片失败：API 返回 {error.code}') from error
        except (urllib.error.URLError, OSError, http.client.IncompleteRead) as error:
            if isinstance(error, http.client.IncompleteRead):
                data.extend(error.partial)
                if _complete_png(data):
                    return bytes(data)
            last_error = error
    raise BridgeError(f'下载生成图片失败：响应未完整传输（已接收 {len(data)} 字节）') from last_error


def _save_png(raw, output):
    out = Path(output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    target = out / 'result-0.png'
    temporary = out / 'result-0.png.part'
    try:
        temporary.write_bytes(raw)
        inspect_sprite_png(temporary)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    temporary.replace(target)
    return target


def download_image(url, output):
    target = _save_png(_download(url), output)
    (Path(output).resolve() / 'download.json').unlink(missing_ok=True)
    return target


class ImageAPIClient:
    """Generates transparent sprite sheets through a custom images API."""

    def __init__(self, base_url, api_key, model, size='', response_format='', on_event=None, timeout=300):
        if not api_key:
            raise BridgeError('缺少生图 API Key，请先在「API 设置」中配置')
        if not model:
            raise BridgeError('缺少生图模型名，请先在「API 设置」中选择模型')
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.size = (size or '').strip()
        self.response_format = (response_format or '').strip()
        self.on_event = on_event or (lambda e: None)
        self.timeout = timeout

    def close(self):
        pass

    def _generations_body(self, prompt):
        body = {'model': self.model, 'prompt': prompt, 'n': 1}
        if self.size and self.size != 'auto':
            body['size'] = self.size
        if self.response_format:
            body['response_format'] = self.response_format
        return json.dumps(body).encode()

    def _edits_body(self, prompt, reference):
        boundary = '----pixelatelier' + uuid.uuid4().hex
        parts = []

        def field(name, value):
            parts.append(
                f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
            )

        field('model', self.model)
        field('prompt', prompt)
        if self.size and self.size != 'auto':
            field('size', self.size)
        image = Path(reference).read_bytes()
        parts.append(
            (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="reference.png"\r\n'
             'Content-Type: image/png\r\n\r\n').encode() + image + b'\r\n'
        )
        parts.append(f'--{boundary}--\r\n'.encode())
        return b''.join(parts), f'multipart/form-data; boundary={boundary}'

    def generate(self, prompt, reference, output, timeout=None):
        out = Path(output).resolve()
        out.mkdir(parents=True, exist_ok=True)
        self.on_event({'type': 'model', 'model': self.model})
        headers = {'Authorization': 'Bearer ' + self.api_key, 'User-Agent': USER_AGENT}
        if reference:
            url = self.base_url + '/images/edits'
            body, content_type = self._edits_body(prompt, reference)
            headers['Content-Type'] = content_type
        else:
            url = self.base_url + '/images/generations'
            body = self._generations_body(prompt)
            headers['Content-Type'] = 'application/json'
        started = time.time()
        request = urllib.request.Request(url, data=body, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=timeout or self.timeout) as response:
                payload = _read_json(
                    response,
                    '生图请求已被服务商受理，但响应传输中断；请先到服务商后台查看并下载原图，不要直接重复生成，以免重复扣费',
                )
        except urllib.error.HTTPError as error:
            detail = ''
            try:
                detail = error.read().decode('utf-8', 'replace')[:400]
            except Exception:
                pass
            raise BridgeError(f'生图 API 返回 {error.code}：{detail or error.reason}') from error
        except (urllib.error.URLError, OSError, ValueError) as error:
            raise BridgeError(f'无法连接生图 API（{url}）：{error}') from error
        items = payload.get('data') if isinstance(payload, dict) else None
        if not items:
            raise BridgeError('生图 API 未返回图片数据：' + json.dumps(payload, ensure_ascii=False)[:300])
        item = items[0] if isinstance(items[0], dict) else {}
        if item.get('b64_json'):
            target = _save_png(base64.b64decode(item['b64_json']), out)
        elif item.get('url'):
            download_record = out / 'download.json'
            download_record.write_text(json.dumps({'url': item['url']}, ensure_ascii=False))
            try:
                target = download_image(item['url'], out)
            except Exception:
                self.on_event({'type': 'download', 'status': 'failed', 'can_resume': True})
                raise
        else:
            raise BridgeError('生图 API 响应缺少图片 url/b64_json：' + json.dumps(item, ensure_ascii=False)[:300])
        self.on_event({'type': 'api', 'status': 'completed', 'elapsed': round(time.time() - started, 1)})
        return {'model': self.model, 'images': [str(target)], 'completion': 'api_completed'}


class LLMClient:
    """Minimal OpenAI-compatible chat completions client."""

    def __init__(self, base_url, api_key, model, timeout=120):
        if not api_key or not model:
            raise BridgeError('缺少文本模型 API Key 或模型名，请先在「API 设置」中配置')
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def chat(self, prompt, system=None, timeout=None):
        messages = []
        if system:
            messages.append({'role': 'system', 'content': system})
        messages.append({'role': 'user', 'content': prompt})
        payload = _http_json(
            self.base_url + '/chat/completions',
            payload={'model': self.model, 'messages': messages, 'temperature': 0.4},
            api_key=self.api_key,
            timeout=timeout or self.timeout,
        )
        try:
            content = payload['choices'][0]['message']['content']
        except (KeyError, IndexError, TypeError) as error:
            raise BridgeError('文本模型响应格式异常：' + json.dumps(payload, ensure_ascii=False)[:300]) from error
        return (content or '').strip()

    def models(self, timeout=30):
        return fetch_models(self.base_url, self.api_key, timeout=timeout)
