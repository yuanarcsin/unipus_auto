# encoding=utf-8
"""
答案获取引擎 v2：通过 submit API 的 score 数组做智能穷举。
不需要解密 content API，不需要从页面 JS 提取答案。
"""

import json
import re
import time
import uuid

from . import cache as answer_cache

CONTENT_API = "https://ucontent.unipus.cn/course/api/v3/content"
SUBMIT_API = "https://ucontent.unipus.cn/course/api/v3/newExploration/submit"


def resolve_url(page):
    """从当前页面 URL 解析 course_id、groupId"""
    url = page.url if hasattr(page, "url") else str(page)
    course_match = re.findall(r"course-v2:[^/]+", url)
    course_id = course_match[0] if course_match else ""
    parts = url.split("/")
    group_id = parts[-1] if parts else ""
    for sep in "?#":
        if sep in group_id:
            group_id = group_id.split(sep)[0]
    return course_id, group_id


def resolve_course_section(url):
    """从 URL 字符串解析 course_id、groupId（兼容旧接口）"""
    course_match = re.findall(r"course-v2:[^/]+", url)
    course_id = course_match[0] if course_match else ""
    parts = url.split("/")
    group_id = parts[-1] if parts else ""
    for sep in "?#":
        if sep in group_id:
            group_id = group_id.split(sep)[0]
    return course_id, "", group_id


def get_token(page):
    """从页面获取 JWT token"""
    try:
        raw = page.evaluate("localStorage.getItem('__token')")
        if raw:
            t = json.loads(raw)
            return t.get("jwt") or t.get("token") or ""
    except Exception:
        pass
    try:
        m = page.evaluate("document.cookie.match(/jwt=([^;]+)/)")
        if m:
            return m[1]
    except Exception:
        pass
    return ""


def submit_via_fetch(page, payload):
    """通过页面 JS fetch 调用 submit API"""
    body_str = json.dumps(payload)
    token = get_token(page)
    result = page.evaluate(f"""
        async () => {{
            const resp = await fetch('{SUBMIT_API}', {{
                method: 'POST',
                headers: {{
                    'Content-Type': 'application/json',
                    'X-Annotator-Auth-Token': '{token}',
                }},
                body: {json.dumps(body_str)},
            }});
            return await resp.json();
        }}
    """)
    score = result.get("data", {}).get("state", {}).get("score", [])
    score_pct = result.get("data", {}).get("state", {}).get("score_pct", 0)
    return {"score": score, "score_pct": score_pct, "full_response": result}


def build_banked_cloze_payload(page, n_blanks, answers, course_id=None, group_id=None):
    """构建选词填空 submit payload"""
    if course_id is None or group_id is None:
        course_id, group_id = resolve_url(page)

    children = []
    for i in range(n_blanks):
        w = answers.get(i, "")
        children.append({"value": [w] if isinstance(w, str) else w, "isDone": True})

    answer_obj = {
        "value": [],
        "children": children,
        "progress": {},
        "record": {"url": ""},
    }

    ques_data = {
        "instanceId": str(uuid.uuid4().int)[:19],
        "answer": json.dumps(answer_obj),
        "context": '{"state":"submitted"}',
        "contextVersion": 1,
        "answerVersion": 1,
    }

    return {
        "quesDatas": [ques_data],
        "groupId": group_id,
        "isCompleted": [True] * n_blanks,
        "submitType": 1,
        "hideLoading": False,
        "associationGroupId": "",
        "courseId": course_id,
        "openId": "",
        "version": "default",
    }


def solve_banked_cloze(page, word_options):
    """
    选词填空智能穷举：
    1. 全部选第一个词 → 提交
    2. 检查 score → 错的换下一个词
    3. 重复直到全对
    返回: {index: "correct_word", ...}
    """
    n = len(word_options)
    print(f"  [穷举] 选词填空: {n} 个空, 候选词: {word_options[:10]}...")

    current = {i: word_options[0] for i in range(n) if word_options}
    course_id, group_id = resolve_url(page)
    max_attempts = len(word_options) + 5

    for attempt in range(max_attempts):
        payload = build_banked_cloze_payload(page, n, current, course_id, group_id)
        result = submit_via_fetch(page, payload)
        score = result.get("score", [])

        if not score:
            print(f"  [错误] submit 无 score，重试...")
            time.sleep(2)
            continue

        print(f"  尝试 {attempt + 1}: score={score}")

        all_correct = all(s > 0 for s in score)
        if all_correct:
            print(f"  [成功] 全部正确!")
            break

        changed = False
        for i in range(min(n, len(score))):
            if score[i] == 0:
                cur_word = current.get(i, "")
                try:
                    idx = word_options.index(cur_word)
                    next_idx = idx + 1
                except ValueError:
                    next_idx = 1
                if next_idx < len(word_options):
                    current[i] = word_options[next_idx]
                    changed = True
                    print(f"    空 {i}: {cur_word} -> {word_options[next_idx]}")

        if not changed:
            print(f"  [警告] 无法继续优化")
            break

        time.sleep(1.5)

    return current


def fetch_answers_from_page(page):
    """
    尝试从页面 JS 上下文提取答案（新版无此能力，保留接口兼容）。
    返回 None 表示需要走穷举路线。
    """
    return None


def get_answers(page, qtype):
    """
    统一入口：根据题型获取正确答案。
    返回 dict: {index: answer_value}
    """
    _, group_id = resolve_url(page)
    cache_key = group_id
    cached = answer_cache.get(cache_key)
    if cached:
        print(f"  [缓存命中] {cache_key}")
        return cached

    if "banked" in qtype:
        word_options_js = page.evaluate("""
            () => {
                const opts = document.querySelectorAll('.option');
                const words = [];
                opts.forEach(el => { if (el.offsetParent) words.push(el.innerText.trim()); });
                return words;
            }
        """)
        seen = set()
        word_options = []
        for w in word_options_js:
            if w not in seen:
                seen.add(w)
                word_options.append(w)

        answers = solve_banked_cloze(page, word_options)
        answer_cache.set(cache_key, answers)
        return answers

    elif "single" in qtype:
        print(f"  [提示] 单选题暂未实现穷举，请手动操作")
        return {}

    else:
        print(f"  [警告] 不支持的题型: {qtype}")
        return {}
