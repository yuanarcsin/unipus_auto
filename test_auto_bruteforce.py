# encoding=utf-8
"""
全自动穷举：路由劫持 + 自动提交循环。
页面认证 → 自动修改答案 → 自动提交 → 解析score → 优化 → 重试
"""

import json, os, sys, time, re
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

class BruteSolver:
    def __init__(self, page):
        self.page = page
        self.words = []
        self.n = 0
        self.answers = {}
        self.score = []
        self.done = False
        self.last_resp = None
        self.submit_count = 0

    def init_from_page(self):
        self.words = self.page.evaluate("""
            () => [...new Set([...document.querySelectorAll('.option')]
                .map(el => el.innerText.trim()).filter(w => w.length < 30))]
        """)
        self.n = self.page.evaluate("""
            () => {
                let b = document.querySelectorAll('[class*="banked-cloze-scoop"] input');
                return b.length || document.querySelectorAll('[class*="cloze"] input').length || 10;
            }
        """)
        for i in range(self.n):
            self.answers[i] = self.words[0] if self.words else "test"
        print(f"[初始化] {self.n}空, {len(self.words)}候选词")

    def build_payload(self, original_body):
        """修改原始提交 body 中的答案"""
        body = json.loads(original_body)
        qd = body.get("quesDatas", [{}])[0]
        old_ans = json.loads(qd.get("answer", "{}"))
        children = []
        for i in range(self.n):
            w = self.answers.get(i, self.words[0])
            children.append({"value": [w], "isDone": True})
        old_ans["children"] = children
        qd["answer"] = json.dumps(old_ans)
        body["quesDatas"] = [qd]
        body["isCompleted"] = [True] * self.n
        return json.dumps(body)

    def route_handler(self, route):
        req = route.request
        if not req.post_data:
            route.continue_()
            return

        new_body = self.build_payload(req.post_data)
        new_headers = dict(req.headers)
        new_headers["content-length"] = str(len(new_body.encode("utf-8")))

        resp = route.fetch(
            url=req.url,
            method=req.method,
            headers=new_headers,
            post_data=new_body,
        )
        text = resp.text()
        self.submit_count += 1
        sc = self.submit_count

        print(f"\n[提交#{sc}] 答案[:5]: {[self.answers[i] for i in range(min(5,self.n))]}...")

        try:
            data = json.loads(text)
            score = data.get("data", {}).get("state", {}).get("score", [])
            if score:
                self.score = score
                pct = data.get("data", {}).get("state", {}).get("score_pct", 0)
                print(f"[提交#{sc}] score={score}, pct={pct}")
                all_right = all(s > 0 for s in score)
                if all_right:
                    self.done = True
                    print(f">>> 全部正确! <<<")
                else:
                    # 更新错误答案
                    for i in range(min(self.n, len(score))):
                        if score[i] == 0:
                            cur = self.answers.get(i, "")
                            try:
                                idx = self.words.index(cur)
                                if idx + 1 < len(self.words):
                                    self.answers[i] = self.words[idx + 1]
                                    print(f"  空{i}: {cur} -> {self.words[idx+1]}")
                            except ValueError:
                                pass
            else:
                print(f"[提交#{sc}] 无score: {text[:300]}")
        except Exception as e:
            print(f"[提交#{sc}] 解析错误: {e}, resp: {text[:200]}")

        self.last_resp = text
        route.fulfill(response=resp)


def main():
    print("=" * 50)
    print("全自动穷举测试")
    print("=" * 50)

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
            except:
                return

        page.wait_for_timeout(3000)
        solver = BruteSolver(page)
        solver.init_from_page()

        # 设置路由拦截
        page.route("**/course/api/v3/newExploration/submit", solver.route_handler)
        print("[路由] 已设置")

        # 自动点击提交按钮（每轮穷举）
        max_rounds = min(len(solver.words), 15)
        for round_num in range(max_rounds):
            if solver.done:
                break

            # 点击提交按钮
            print(f"\n[第{round_num+1}轮] 自动点击提交...")
            try:
                submit_btn = page.locator(".question-common-course-page .btn, [class*='submit']").first
                if submit_btn.is_visible(timeout=3000):
                    submit_btn.click(timeout=5000)
                else:
                    # 尝试用 JS 点击
                    page.evaluate("""
                        () => {
                            const btns = document.querySelectorAll('.btn, [class*="submit"]');
                            for (const b of btns) {
                                if (b.offsetParent && b.innerText.includes('提交')) {
                                    b.click(); return 'clicked';
                                }
                            }
                            return 'not_found';
                        }
                    """)
            except Exception as e:
                print(f"  点击失败: {e}")

            # 等待响应
            for _ in range(15):
                time.sleep(1)
                if solver.submit_count > round_num:
                    break

            if solver.done:
                break

            # 错太多就试下一轮
            time.sleep(1)

        print(f"\n最终答案: {solver.answers}")
        print(f"完成: {solver.done}")

        with open(os.path.join(OUT, "auto_bruteforce.json"), "w", encoding="utf-8") as f:
            json.dump({"answers": solver.answers, "done": solver.done, "score": solver.score}, f, ensure_ascii=False, indent=2)

        browser.close()

if __name__ == "__main__":
    main()
