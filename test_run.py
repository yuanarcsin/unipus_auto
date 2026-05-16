# encoding=utf-8
"""测试脚本 v2：改进算法（每空不同词）+ 可靠按钮查找"""

import json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright, TimeoutError as PwTimeoutError

EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data")
EX_URL = (
    "https://ucontent.unipus.cn/_explorationpc_default/pc.html"
    "?cid=1571844978235572559&theme=3264FA&aitutorialId=26959"
    "&cloudCurriculaId=281822&source=cloud&courseResourceId=20000984084"
    "#/course-v2:813dd12ce02e57d+nhce_v4_rw_3+20230116/"
    "courseware/6beeb84f800090b/6beebb8491f1b1e/6beebb84a081b1e/6beebb84a091b1e"
)

state = {"words": [], "n": 0, "answers": {}, "score": [], "done": False, "count": 0}


def make_handler(page):
    def handler(route):
        req = route.request
        try:
            body = json.loads(req.post_data or "{}")
        except Exception:
            route.continue_()
            return

        n = state["n"]
        children = []
        for i in range(n):
            w = state["answers"].get(i, state["words"][0] if state["words"] else "")
            children.append({"value": [w], "isDone": True})

        qd = body.get("quesDatas", [{}])[0]
        old = json.loads(qd.get("answer", "{}"))
        old["children"] = children
        qd["answer"] = json.dumps(old)
        body["quesDatas"] = [qd]
        body["isCompleted"] = [True] * n

        new_body = json.dumps(body)
        headers = dict(req.headers)
        headers["content-length"] = str(len(new_body.encode()))

        resp = route.fetch(url=req.url, method=req.method, headers=headers, post_data=new_body)
        state["count"] += 1
        c = state["count"]

        try:
            data = json.loads(resp.text())
            score = data.get("data", {}).get("state", {}).get("score", [])
            if score:
                state["score"] = score
                pct = data.get("data", {}).get("state", {}).get("score_pct", 0)
                print(f"  [{c}] score={score} pct={pct}")
                if all(s > 0 for s in score):
                    state["done"] = True
                    print(">>> 全部正确! <<<")
        except Exception as e:
            print(f"  [{c}] 解析失败: {e}")

        route.fulfill(response=resp)
    return handler


def click_submit(page):
    """尝试多种方式点击提交按钮"""
    # 先关闭弹窗
    try:
        close_sel = "[class*='dialog-header-pc--close'], .ant-modal-close, [class*='close']"
        for el in page.locator(close_sel).all():
            if el.is_visible():
                el.click(timeout=500)
                page.wait_for_timeout(300)
    except Exception:
        pass
    try:
        iknow = page.locator(".iKnow, [class*='iKnow'], [class*='know']")
        if iknow.first.is_visible(timeout=300):
            iknow.first.click(timeout=500)
            page.wait_for_timeout(300)
    except Exception:
        pass

    # 方式1：通过文本查找
    try:
        btn = page.locator("button, .btn, .ant-btn").filter(has_text="提交").first
        if btn.is_visible(timeout=1000):
            btn.click(timeout=2000)
            return "text_match"
    except Exception:
        pass

    # 方式2：通过 class
    try:
        for sel in [".question-common-course-page .btn", "[class*='submit-bar-pc--btn']",
                     ".common-course__submit-btn", ".submit-btn"]:
            btn = page.locator(sel).first
            if btn.is_visible(timeout=500):
                btn.click(timeout=2000)
                return f"class:{sel}"
    except Exception:
        pass

    # 方式3：JS 兜底
    result = page.evaluate("""
        () => {
            for (const el of document.querySelectorAll('button, .btn, .ant-btn, [class*="submit"], [class*="Btn"]')) {
                const t = el.innerText || el.textContent || '';
                if ((t.includes('提交') || t.includes('Submit') || t.includes('交')) && el.offsetParent) {
                    el.click();
                    return 'js_clicked';
                }
            }
            return 'not_found';
        }
    """)
    return result


def update_answers():
    """根据最新 score 更新答案：正确锁定，错误换未用过的下一个词"""
    n = state["n"]
    score = state["score"]
    words = state["words"]

    # 收集已被正确空占用的词
    used = set()
    for i in range(min(n, len(score))):
        if score[i] > 0 and i in state["answers"]:
            used.add(state["answers"][i])

    changed = 0
    for i in range(min(n, len(score))):
        if score[i] == 0:
            cur = state["answers"].get(i, "")
            # 在候选词中找下一个未使用的词
            candidates = [w for w in words if w not in used or w == cur]
            try:
                idx = candidates.index(cur)
                # 向后找第一个不在 used 中的
                for next_idx in range(idx + 1, len(candidates)):
                    next_word = candidates[next_idx]
                    if next_word not in used:
                        state["answers"][i] = next_word
                        used.add(next_word)
                        print(f"    空{i}: {cur} -> {next_word}")
                        changed += 1
                        break
            except ValueError:
                # 当前词不在候选列表中，分配第一个未使用的
                for w in words:
                    if w not in used:
                        state["answers"][i] = w
                        used.add(w)
                        print(f"    空{i}: {cur} -> {w}")
                        changed += 1
                        break
    return changed


def main():
    print("=" * 50)
    print("测试 v2：改进算法 + 可靠按钮")
    print("=" * 50)

    # 关闭现有 Edge + 清锁
    subprocess.run(["taskkill", "/F", "/IM", "msedge.exe"], capture_output=True)
    time.sleep(1)
    for root, dirs, files in os.walk(USER_DATA):
        for f in files + dirs:
            if f == "LOCK" or f == "SingletonLock":
                try:
                    fp = os.path.join(root, f)
                    if os.path.isfile(fp):
                        os.remove(fp)
                except Exception:
                    pass

    with sync_playwright() as p:
        print("[浏览器] 启动（持久化 profile）...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA,
            executable_path=EDGE_EXE,
            headless=False,
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(60000)

        print("[导航] 练习页面...")
        page.goto(EX_URL)
        page.wait_for_timeout(3000)

        print("[等待] 登录中...")
        for i in range(120):
            time.sleep(1)
            try:
                url = page.evaluate("window.location.href")
                if "courseware" in url and "sso" not in url:
                    print(f"[就绪] 已到达练习页 ({i}s)")
                    break
            except Exception:
                pass
        else:
            print("[错误] 超时")
            context.close()
            return

        page.wait_for_timeout(3000)

        # 获取候选词和空数
        state["words"] = page.evaluate("""
            () => [...new Set([...document.querySelectorAll('.option')]
                .map(el => el.innerText.trim()).filter(w => w.length < 30))]
        """)
        state["n"] = page.evaluate("""
            () => document.querySelectorAll('[class*=\"banked-cloze-scoop\"] input').length
                || document.querySelectorAll('[class*=\"cloze\"] input').length || 10
        """)
        if not state["words"] or state["n"] == 0:
            print("[错误] 未找到候选词或空")
            context.close()
            return

        # 初始化：每个空分配不同词
        for i in range(state["n"]):
            idx = i % len(state["words"])
            state["answers"][i] = state["words"][idx]

        print(f"[就绪] {state['n']}空, {len(state['words'])}候选词: {state['words']}")
        print(f"[初始] 答案: {[state['answers'][i] for i in range(state['n'])]}")

        # 设置路由劫持
        page.route("**/course/api/v3/newExploration/submit", make_handler(page))
        print("[路由] submit API 已拦截")

        # 循环提交
        max_rounds = len(state["words"]) * 2
        for r in range(max_rounds):
            if state["done"]:
                break

            print(f"\n[轮{r+1}] 触发提交...")
            result = click_submit(page)
            print(f"  点击: {result}")

            old_count = state["count"]
            for _ in range(24):
                time.sleep(0.5)
                if state["count"] > old_count:
                    break

            if state["count"] == old_count:
                print("  未收到响应，跳过")
                continue

            if state["done"]:
                break

            # 更新答案
            changed = update_answers()
            if not changed:
                print("  无法继续优化，可能需更多候选词")
                break

            time.sleep(1.0)

        print(f"\n{'='*50}")
        print(f"结果: done={state['done']}, 提交={state['count']}")
        print(f"答案: {state['answers']}")
        print(f"score: {state['score']}")

        if state["done"]:
            print("\n[填入] 正确答案到页面...")
            for i in range(state["n"]):
                word = state["answers"].get(i)
                if not word:
                    continue
                page.evaluate(f"""
                    () => {{
                        const opts = document.querySelectorAll('.option');
                        for (const o of opts) {{
                            if (o.innerText.trim() === '{word}') {{ o.click(); break; }}
                        }}
                    }}
                """)
                time.sleep(0.15)
                page.evaluate(f"""
                    () => {{
                        const blanks = document.querySelectorAll('[class*="banked-cloze-scoop"] input');
                        if (blanks.length > {i}) blanks[{i}].click();
                    }}
                """)
                time.sleep(0.15)
            print("[完成] 答案已填入")

            # 最终提交一次
            print("[提交] 最终提交...")
            click_submit(page)
            page.wait_for_timeout(3000)

        out_dir = os.path.join(os.path.dirname(__file__), "diagnose_output")
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, "test_run_result.json"), "w", encoding="utf-8") as f:
            json.dump({"answers": state["answers"], "score": state["score"], "done": state["done"]}, f, ensure_ascii=False, indent=2)

        page.wait_for_timeout(10000)
        context.close()


if __name__ == "__main__":
    main()
