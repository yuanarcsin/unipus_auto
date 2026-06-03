# encoding=utf-8
"""LLM 答题验证：Playwright 注入扫描 + DeepSeek API，独立于扩展运行"""

import json, os, subprocess, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data")
EX_URL = (
    "https://ucontent.unipus.cn/_explorationpc_default/pc.html"
    "?cid=1571844978235572559&theme=3264FA&aitutorialId=26959"
    "&cloudCurriculaId=281822&source=cloud&courseResourceId=20000984084"
    "#/course-v2:813dd12ce02e57d+nhce_v4_rw_3+20230116/"
    "courseware/6beeb84f800090b/6beebb8491f1b1e/6beebb84a081b1e/6beebb84a091b1e"
)

# ---- DeepSeek 配置 ----
DEEPSEEK_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
# 环境变量可能缺少 sk- 前缀，从注册表补充
if not DEEPSEEK_KEY.startswith("sk-"):
    try:
        import subprocess as _sp
        result = _sp.run(
            ["reg", "query", r"HKCU\Environment", "/v", "DEEPSEEK_API_KEY"],
            capture_output=True, text=True,
        )
        lines = result.stdout.strip().split("\n")
        reg_key = lines[-1].strip().split()[-1] if lines else ""
        if reg_key.startswith("sk-"):
            DEEPSEEK_KEY = reg_key
    except Exception:
        pass
DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-chat"


def call_llm(prompt):
    import requests
    resp = requests.post(
        DEEPSEEK_URL,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_KEY}"},
        json={
            "model": DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": "你是专业的英语答题助手。仔细分析题目给出正确答案。以 JSON 返回：{\"answer\": 答案, \"explanation\": \"解释\"}。只返回 JSON。"},
                {"role": "user", "content": prompt},
            ],
        },
        timeout=30,
    )
    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    content = content.strip()
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content)


def scan_banked_cloze(page):
    words = page.evaluate("""
        () => [...new Set([...document.querySelectorAll('.option')]
            .map(el => el.innerText.trim()).filter(w => w.length < 30))]
    """)
    n = page.evaluate("""
        () => document.querySelectorAll('[class*="banked-cloze-scoop"] input').length || 0
    """)
    text = page.evaluate("""
        () => {
            const el = document.querySelector('[class*="question-abs-material"]');
            return el ? el.innerText.substring(0, 2000) : '';
        }
    """)
    return {"type": "banked_cloze", "n": n, "words": words, "text": text}


def ask_banked_cloze(question_text, words, n_blanks):
    prompt = f"""完成以下选词填空题。

题目：
{question_text}

可选词语（{len(words)}个）：{', '.join(words)}

共 {n_blanks} 个空。请从可选词中选最合适的填入，每个词最多用一次。

返回 JSON：
{{"answer": ["词1", "词2", ...], "explanation": "解释"}}
只返回 JSON。"""
    return call_llm(prompt)


def fill_banked_cloze(page, answers):
    for i, word in enumerate(answers):
        word = word.strip()
        page.evaluate(f"""
            () => {{
                const opts = document.querySelectorAll('.option');
                for (const o of opts) {{
                    if (o.innerText.trim() === '{word}' && o.offsetParent) {{
                        o.click(); break;
                    }}
                }}
            }}
        """)
        time.sleep(0.2)
        page.evaluate(f"""
            () => {{
                const blanks = document.querySelectorAll('[class*="banked-cloze-scoop"] input');
                if (blanks.length > {i}) blanks[{i}].click();
            }}
        """)
        time.sleep(0.2)


def main():
    if not DEEPSEEK_KEY:
        print("=" * 50)
        print("请先获取 DeepSeek API Key:")
        print("  1. 访问 https://platform.deepseek.com")
        print("  2. 注册 → API Keys → 创建")
        print("  3. 填入脚本中的 DEEPSEEK_KEY")
        print("=" * 50)
        return

    print("=" * 50)
    print("LLM 答题测试 (DeepSeek)")
    print("=" * 50)

    subprocess.run(["taskkill", "/F", "/IM", "msedge.exe"], capture_output=True)
    time.sleep(1)
    for root, dirs, files in os.walk(USER_DATA):
        for f in files + dirs:
            if f in ("LOCK", "SingletonLock"):
                try:
                    fp = os.path.join(root, f)
                    if os.path.isfile(fp): os.remove(fp)
                except Exception: pass

    with sync_playwright() as p:
        print("[浏览器] 启动...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA, executable_path=EDGE_EXE, headless=False,
        )
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(60000)

        page.goto(EX_URL)
        page.wait_for_timeout(3000)

        print("[等待] 登录...")
        for i in range(120):
            time.sleep(1)
            try:
                url = page.evaluate("window.location.href")
                if "courseware" in url and "sso" not in url:
                    print(f"[就绪] ({i}s)")
                    break
            except Exception: pass
        else:
            print("[超时]"); context.close(); return

        page.wait_for_timeout(3000)

        info = scan_banked_cloze(page)
        print(f"[扫描] {info['type']}: {info['n']}空, {len(info['words'])}候选词")

        if info["n"] == 0:
            print("[错误] 未检测到选词填空题")
            context.close(); return

        print("[AI] 询问 DeepSeek...")
        result = ask_banked_cloze(info["text"], info["words"], info["n"])
        answers = result.get("answer", [])
        explanation = result.get("explanation", "")
        print(f"[AI] 答案: {answers}")
        print(f"[AI] 解释: {explanation}")

        print("[填入] 填入答案...")
        fill_banked_cloze(page, answers[:info["n"]])
        print("[完成] 请核对后手动提交")

        page.wait_for_timeout(15000)
        context.close()


if __name__ == "__main__":
    main()
