"""Persistent workbench settings: custom image / LLM API credentials and models.

The file lives under work/ (git-ignored) so keys never leave the machine.
"""
import json
import threading
from pathlib import Path

DEFAULTS = {
    'provider': 'custom',
    'image': {
        'base_url': 'https://corecode.live/v1',
        'api_key': '',
        'model': 'gpt-image-2.6-sunburst',
        'size': '1536x1024',
        'response_format': '',
        'timeout': 300,
    },
    'llm': {
        'base_url': 'https://corecode.live/v1',
        'api_key': '',
        'model': '',
        'polish_prompt': False,
    },
}
SECRET_PATHS = {('image', 'api_key'), ('llm', 'api_key')}
KEEP = '__KEEP__'


class Settings:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()
        self.data = json.loads(json.dumps(DEFAULTS))
        self.load()

    @staticmethod
    def _clone(data):
        return json.loads(json.dumps(data))

    @classmethod
    def _merge(cls, base, override):
        for key, value in (override or {}).items():
            if key not in base:
                continue
            if isinstance(base[key], dict) and isinstance(value, dict):
                cls._merge(base[key], value)
            else:
                base[key] = value
        return base

    def load(self):
        with self.lock:
            try:
                stored = json.loads(self.path.read_text())
            except (OSError, ValueError):
                stored = {}
            self.data = self._merge(self._clone(DEFAULTS), stored if isinstance(stored, dict) else {})

    def _apply(self, data, patch):
        for key, value in (patch or {}).items():
            if key not in data:
                continue
            if isinstance(data[key], dict) and isinstance(value, dict):
                self._apply(data[key], value)
            elif value is not None and value != KEEP:
                # reject null so a stray None can't poison a field (and crash masking)
                data[key] = value

    def update(self, patch):
        """Merge a patch into the stored config; KEEP placeholders preserve secrets."""
        with self.lock:
            data = self._clone(self.data)
            self._apply(data, patch or {})
            self.data = data
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.path.with_suffix('.tmp')
            temp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2))
            temp.replace(self.path)
        return self.masked()

    def raw(self):
        with self.lock:
            return self._clone(self.data)

    def masked(self):
        data = self.raw()
        for section, key in SECRET_PATHS:
            value = data[section][key]
            if not isinstance(value, str):
                value = '' if value is None else str(value)
            data[section]['has_key'] = bool(value)
            data[section][key] = ('••••' + value[-4:]) if len(value) > 4 else ('••••' if value else '')
        return data

    def image_config(self):
        cfg = self.raw()['image']
        if not cfg['api_key']:
            raise ValueError('请先在「API 设置」中填写生图 API Key')
        return cfg

    def llm_config(self):
        cfg = self.raw()['llm']
        if not cfg['api_key'] or not cfg['model']:
            raise ValueError('请先在「API 设置」中填写文本模型 API Key 与模型名')
        return cfg
