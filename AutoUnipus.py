# encoding=utf-8
"""
AutoUnipus 重构版：支持选词填空智能穷举、文本填空、翻译题、单选题。
使用持久化 Edge profile 避免反复登录。
"""

import json
import os
import re
import subprocess
import sys
import time
import traceback

from playwright.sync_api import sync_playwright, TimeoutError as PwTimeoutError

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from utils import cache as answer_cache
from utils import fetcher
from utils import page_actions as pa
from utils.session import check_login, get_token

EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
USER_DATA = os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\User Data")


def _kill_edge():
    """杀掉所有 Edge 进程"""
    subprocess.run(["taskkill", "/F", "/IM", "msedge.exe"],
                   capture_output=True)


def _clear_edge_locks():
    """清除 Edge User Data 下的 leveldb LOCK 文件"""
    count = 0
    for root, dirs, files in os.walk(USER_DATA):
        for f in files + dirs:
            if f == "LOCK" or f == "SingletonLock":
                fp = os.path.join(root, f)
                try:
                    if os.path.isfile(fp):
                        os.remove(fp)
                        count += 1
                except Exception:
                    pass
    if count:
        print(f"  [清理] 移除了 {count} 个锁文件")


def init_page(p, account):
    """启动 Edge（持久化 profile）并确保登录"""
    user = account["username"].strip()
    pwd = account["password"].strip()

    print("[浏览器] 关闭现有 Edge 窗口...")
    _kill_edge()
    time.sleep(1.5)
    _clear_edge_locks()

    print("[浏览器] 启动 Edge（使用日常 profile）...")
    try:
        context = p.chromium.launch_persistent_context(
            user_data_dir=USER_DATA,
            executable_path=EDGE_EXE,
            headless=False,
        )
    except Exception as e:
        # 回退：普通启动
        print(f"[警告] 持久化启动失败: {e}")
        print("[回退] 使用普通浏览器模式...")
        browser = p.chromium.launch(executable_path=EDGE_EXE, headless=False)
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(30000)
        if not pa.ensure_logged_in(page, user, pwd, pa.SEL["domains"]["course"]):
            print("[错误] 无法到达课程页面")
            browser.close()
            return None, None
        # 包装成统一接口
        context._browser = browser
        return context, page

    page = context.pages[0] if context.pages else context.new_page()
    page.set_default_timeout(30000)

    # 导航到课程页 → 自动处理登录
    if not pa.ensure_logged_in(page, user, pwd, pa.SEL["domains"]["course"]):
        print("[错误] 无法到达课程页面")
        context.close()
        return None, None

    return context, page


def close_context(context):
    """统一关闭浏览器"""
    browser = getattr(context, "_browser", None)
    if browser:
        browser.close()
    else:
        context.close()


def close_dialogs_wrapper(page):
    try:
        pa.close_dialogs(page)
    except Exception:
        pass


def solve_and_fill(page, automode=False):
    """检测题型 → 穷举获取答案 → 填入"""
    close_dialogs_wrapper(page)
    qtype = pa.detect_question_type(page)
    print(f"  [题型] {qtype}")

    answers = fetcher.get_answers(page, qtype)

    if not answers:
        print("  [失败] 无法获取答案")
        return False

    if "banked" in qtype:
        pa.fill_banked_cloze(page, [{"index": i, "value": v} for i, v in answers.items()])

    elif "single" in qtype:
        pa.fill_single_choice(page, [{"index": i, "choice": v} for i, v in answers.items()])

    elif "blank" in qtype or "fill" in qtype or "grammar" in qtype:
        pa.fill_text_inputs(page, [{"index": i, "value": v} for i, v in answers.items()])

    elif "translation" in qtype:
        pa.fill_text_inputs(page, [{"index": i, "value": v} for i, v in answers.items()])

    elif "rewrite" in qtype:
        pa.fill_text_inputs(page, [{"index": i, "value": v} for i, v in answers.items()])

    else:
        print(f"  [警告] 未知题型: {qtype}, 尝试文本填入")
        pa.fill_text_inputs(page, [{"index": i, "value": v} for i, v in answers.items()])

    page.wait_for_timeout(500)

    if automode:
        print("  [提交] 自动提交...")
        pa.click_next_or_submit(page)

    return True


def assist_mode(page):
    """辅助模式：手动导航到题目页，按 Enter 获取答案"""
    print("\n" + "=" * 50)
    print("辅助模式")
    print("请在浏览器中手动进入练习题页面")
    print("按 Enter 获取答案，输入 q 退出")
    print("=" * 50)

    while True:
        cmd = input("\n[Enter=获取答案, q=退出]: ").strip()
        if cmd.lower() == "q":
            break

        page.reload()
        page.wait_for_timeout(3000)
        close_dialogs_wrapper(page)
        print("[获取] 正在提取答案...")
        solve_and_fill(page, automode=False)


def auto_mode(page, account):
    """自动模式：遍历必修练习并自动提交"""
    class_urls = account.get("class_url", [])
    class_urls = [url for url in class_urls if url and "unipus" in url]

    if not class_urls:
        print("[错误] 未配置 class_url")
        return

    for class_url in class_urls:
        print(f"\n[课程] {class_url[:100]}...")
        page.goto(class_url)
        page.wait_for_timeout(3000)

        try:
            title_el = page.locator(pa.SEL["course_page"]["course_title"])
            if title_el.is_visible(timeout=3000):
                print(f"[课程] {title_el.text_content().strip().splitlines()[0]}")
        except Exception:
            pass

        exercises = pa.get_exercise_list(page)
        if not exercises:
            print("[信息] 未找到必修练习")
            continue

        print(f"[信息] {len(exercises)} 个必修练习")
        for ex in exercises:
            try:
                ex.click()
            except Exception:
                continue
            page.wait_for_timeout(2000)
            close_dialogs_wrapper(page)
            solve_and_fill(page, automode=True)

        print(f"[完成] 当前课程处理完毕")


def main():
    print("=" * 50)
    print("AutoUnipus")
    print("支持：选词填空智能穷举 / 文本填空 / 翻译题")
    print("=" * 50)

    account = pa.load_account()
    automode = account.get("Automode", False)

    try:
        with sync_playwright() as p:
            context, page = init_page(p, account)
            if not page:
                return

            if automode:
                print("[模式] 自动模式")
                auto_mode(page, account)
                print("\n处理完毕!")
                input("按 Enter 退出...")
            else:
                print("[模式] 辅助模式")
                assist_mode(page)

            close_context(context)

    except PwTimeoutError:
        print("[错误] 页面操作超时")
    except Exception as e:
        print(f"[错误] {e}")
        traceback.print_exc()
        log_path = os.path.join(os.path.dirname(__file__), "error_log.txt")
        with open(log_path, "w", encoding="utf-8") as f:
            f.write(traceback.format_exc())
        print(f"[信息] 错误日志: error_log.txt")
    finally:
        time.sleep(1)


if __name__ == "__main__":
    main()
