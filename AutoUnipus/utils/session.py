# encoding=utf-8
"""会话管理：Token 获取/刷新、网络请求重试、登录态维护"""

import json
import time

import requests

MAX_RETRIES = 3
RETRY_BACKOFF = [2, 4, 8]
AUTH_HEADER = "X-Annotator-Auth-Token"


def get_token(page):
    """从页面 localStorage 提取 JWT token"""
    try:
        raw = page.evaluate("localStorage.getItem('__token')")
        if raw:
            t = json.loads(raw)
            return t.get("jwt") or t.get("token")
    except Exception:
        pass
    try:
        m = page.evaluate("document.cookie.match(/jwt=([^;]+)/)")
        if m:
            return m[1]
    except Exception:
        pass
    return None


def get_headers(page):
    """构建带认证的请求头"""
    jwt = get_token(page)
    if not jwt:
        raise RuntimeError("无法获取 JWT token")
    return {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        AUTH_HEADER: jwt,
    }


def check_login(page):
    try:
        return bool(get_token(page))
    except Exception:
        return False


def relogin(page, user, pwd):
    """重新登录"""
    from utils import page_actions as pa

    print("[Session] Token 过期，重新登录...")
    login_url = pa.SEL["domains"]["login"]
    page.goto(login_url)
    page.wait_for_timeout(2000)

    if not pa.is_on_login_page(page):
        print("[Session] 已有登录态")
        return True

    return pa.do_login(page, user, pwd)


def api_request(page, method, url, user=None, pwd=None, **kwargs):
    """带 token 刷新和重试的 API 请求包装器"""
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            headers = get_headers(page)
            if method.upper() == "GET":
                resp = requests.get(url, headers=headers, timeout=30, **kwargs)
            else:
                resp = requests.post(url, headers=headers, timeout=30, **kwargs)

            if resp.status_code in (401, 403):
                print(f"[Session] {resp.status_code}，刷新 token...")
                if user and pwd and relogin(page, user, pwd):
                    continue
                raise RuntimeError(f"Token 刷新失败: {resp.status_code}")

            if resp.status_code >= 500:
                raise requests.ConnectionError(f"服务器错误: {resp.status_code}")

            return resp

        except (requests.ConnectionError, requests.Timeout) as e:
            last_error = e
            if attempt < MAX_RETRIES:
                wait = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                print(f"[Session] 网络错误，{wait}s 后重试 ({attempt + 1}/{MAX_RETRIES})...")
                time.sleep(wait)
            else:
                raise RuntimeError(f"网络请求失败（已重试 {MAX_RETRIES} 次）: {last_error}")

    raise RuntimeError(f"请求失败: {last_error}")
