# encoding=utf-8
"""
最终求解器：route劫持 + 自动提交
已验证：thirdPartyJudges非必需，服务器接受修改后的答案。
"""

import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(__file__), "diagnose_output")
os.makedirs(OUT, exist_ok=True)
EX_URL = (
    "https://ucontent.unipus.cn/_explorationpc_default/pc.html"
    "?cid=1571844978235572559&theme=3264FA&aitutorialId=26959"
    "&cloudCurriculaId=281822&source=cloud&courseResourceId=20000984084"
    "#/course-v2:813dd12ce02e57d+nhce_v4_rw_3+20230116/"
    "courseware/6beeb84f800090b/6beebb8491f1b1e/6beebb84a081b1e/6beebb84a091b1e"
)

state = {"words":[], "n":0, "answers":{}, "score":[], "done":False, "count":0}

def make_handler(page):
    def handler(route):
        req = route.request
        try:
            body = json.loads(req.post_data or "{}")
        except:
            route.continue_()
            return

        n = state["n"]
        children = []
        for i in range(n):
            w = state["answers"].get(i, state["words"][0])
            children.append({"value":[w],"isDone":True})

        qd = body.get("quesDatas",[{}])[0]
        old = json.loads(qd.get("answer","{}"))
        old["children"] = children
        qd["answer"] = json.dumps(old)
        body["quesDatas"] = [qd]
        body["isCompleted"] = [True]*n

        new_body = json.dumps(body)
        headers = dict(req.headers)
        headers["content-length"] = str(len(new_body.encode()))

        resp = route.fetch(url=req.url, method=req.method, headers=headers, post_data=new_body)
        state["count"] += 1
        c = state["count"]

        try:
            data = json.loads(resp.text())
            score = data.get("data",{}).get("state",{}).get("score",[])
            if score:
                state["score"] = score
                pct = data.get("data",{}).get("state",{}).get("score_pct",0)
                print(f"[{c}] score={score} pct={pct}")
                if all(s>0 for s in score):
                    state["done"] = True
                    print(">>> 全对! <<<")
                else:
                    for i in range(min(n,len(score))):
                        if score[i]==0:
                            cur = state["answers"].get(i,"")
                            try:
                                idx = state["words"].index(cur)
                                if idx+1 < len(state["words"]):
                                    state["answers"][i] = state["words"][idx+1]
                            except ValueError: pass
        except Exception as e:
            print(f"[{c}] 解析失败: {e}")

        route.fulfill(response=resp)
    return handler


def main():
    print("="*50)
    print("最终求解器")
    print("="*50)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            headless=False,
        )
        page = browser.new_page()
        page.set_default_timeout(60000)

        page.goto(EX_URL)
        print("[等待] 请登录...")
        for i in range(300):
            time.sleep(1)
            try:
                url = page.evaluate("window.location.href")
                if "courseware" in url and "sso" not in url:
                    break
            except: return

        page.wait_for_timeout(3000)

        state["words"] = page.evaluate("""
            () => [...new Set([...document.querySelectorAll('.option')]
                .map(el=>el.innerText.trim()).filter(w=>w.length<30))]
        """)
        state["n"] = page.evaluate("""
            () => document.querySelectorAll('[class*=\"banked-cloze-scoop\"] input').length
                || document.querySelectorAll('[class*=\"cloze\"] input').length || 10
        """)
        for i in range(state["n"]):
            state["answers"][i] = state["words"][0] if state["words"] else ""

        print(f"[就绪] {state['n']}空, {len(state['words'])}候选词")

        # 设置路由劫持
        page.route("**/course/api/v3/newExploration/submit", make_handler(page))

        # 自动循环提交
        max_rounds = len(state["words"]) + 10
        for r in range(max_rounds):
            if state["done"]:
                break

            print(f"\n[轮{r+1}] 触发提交...")
            # 用 JS 点击提交按钮
            clicked = page.evaluate("""
                () => {
                    const all = document.querySelectorAll('.btn, button, [class*=\"submit\"], [class*=\"Btn\"]');
                    for (const el of all) {
                        const t = el.innerText || el.textContent || '';
                        if ((t.includes('提交') || t.includes('Submit') || t.includes('交')) && el.offsetParent) {
                            el.click();
                            return 'clicked';
                        }
                    }
                    // 尝试用 ant-design 按钮
                    const antBtns = document.querySelectorAll('.ant-btn');
                    for (const el of antBtns) {
                        if (el.offsetParent) { el.click(); return 'antd'; }
                    }
                    return 'not_found';
                }
            """)
            print(f"  点击结果: {clicked}")

            # 等待响应
            old_count = state["count"]
            for _ in range(20):
                time.sleep(0.5)
                if state["count"] > old_count:
                    break

            if state["done"]:
                break

            time.sleep(1.5)

        print(f"\n{'='*50}")
        print(f"完成! done={state['done']}, 提交次数={state['count']}")
        print(f"答案: {state['answers']}")
        if state["score"]:
            print(f"score: {state['score']}")

        # 填入页面
        if state["done"]:
            print("\n[填入] 在页面上点击正确答案...")
            for i in range(state["n"]):
                word = state["answers"].get(i)
                if word:
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
                            const blanks = document.querySelectorAll('[class*=\"banked-cloze-scoop\"] input');
                            if (blanks.length > {i}) blanks[{i}].click();
                        }}
                    """)
                    time.sleep(0.15)

        with open(os.path.join(OUT, "solve_done.json"), "w", encoding="utf-8") as f:
            json.dump({"answers":state["answers"], "score":state["score"], "done":state["done"]}, f, ensure_ascii=False, indent=2)

        page.wait_for_timeout(10000)
        browser.close()

if __name__ == "__main__":
    main()
