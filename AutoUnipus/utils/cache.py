# encoding=utf-8
"""答案缓存：qid → 答案列表的 JSON 持久化存储"""

import json
import os
import time

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "cache")
CACHE_FILE = os.path.join(CACHE_DIR, "answers.json")
CACHE_TTL = 7 * 24 * 3600  # 缓存有效期：7 天


def _ensure_cache_dir():
    os.makedirs(CACHE_DIR, exist_ok=True)


def _load_cache():
    _ensure_cache_dir()
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return {}


def _save_cache(cache):
    _ensure_cache_dir()
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)


def get(qid):
    """获取缓存的答案，过期返回 None"""
    cache = _load_cache()
    entry = cache.get(qid)
    if not entry:
        return None
    if time.time() - entry.get("ts", 0) > CACHE_TTL:
        return None
    return entry.get("answers")


def set(qid, answers):
    """存入答案缓存"""
    cache = _load_cache()
    cache[qid] = {"answers": answers, "ts": time.time()}
    _save_cache(cache)


def has(qid):
    """检查是否有有效缓存"""
    return get(qid) is not None


def invalidate(qid=None):
    """清除缓存（不传 qid 则清空全部）"""
    if qid is None:
        _ensure_cache_dir()
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            f.write("{}")
    else:
        cache = _load_cache()
        cache.pop(qid, None)
        _save_cache(cache)
