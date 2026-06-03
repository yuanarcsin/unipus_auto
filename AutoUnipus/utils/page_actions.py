# encoding=utf-8
"""
页面操作封装：登录、导航、答题、DOM 交互。
所有 CSS 选择器从 config/selectors.json 读取。
"""

import json
import os
import random
import time

from playwright.sync_api import TimeoutError as PwTimeoutError

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
CONFIG_DIR = os.path.join(BASE_DIR, "config")


def load_selectors():
    with open(os.path.join(CONFIG_DIR, "selectors.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def load_account():
    with open(os.path.join(BASE_DIR, "account.json"), "r", encoding="utf-8") as f:
        return json.load(f)


SEL = load_selectors()


# =====================================================
# 登录（人类操作模拟）
# =====================================================
def is_on_login_page(page):
    """检测当前是否在登录页面"""
    try:
        has_user = page.locator("[name='username'], [name='phone'], [name='account'], #username, #phone").count() > 0
        has_pwd = page.locator("[name='password'], #password").count() > 0
        return has_user and has_pwd
    except Exception:
        return False


def type_human(page, selector, text):
    """模拟人类逐字输入，带随机延迟"""
    el = page.locator(selector).first
    el.click()
    page.wait_for_timeout(random.randint(200, 500))
    el.fill("")
    page.wait_for_timeout(random.randint(100, 300))
    el.press_sequentially(text, delay=random.randint(60, 180))
    page.wait_for_timeout(random.randint(200, 500))


def do_login(page, user, pwd):
    """执行登录：检测表单 → 逐字输入 → 点击提交 → 等待跳转"""
    login_cfg = SEL["login"]
    print("[登录] 检测到登录页面，模拟输入...")

    try:
        type_human(page, login_cfg["username"], user)
    except PwTimeoutError:
        print("[登录] 用户名输入框未找到")
        return False

    try:
        type_human(page, login_cfg["password"], pwd)
    except PwTimeoutError:
        print("[登录] 密码输入框未找到")
        return False

    # 勾选协议复选框
    try:
        checkboxes = page.locator('[type="checkbox"]').all()
        idx = login_cfg.get("agreement_checkbox_index", 1)
        if len(checkboxes) > idx:
            checkboxes[idx].click()
            page.wait_for_timeout(200)
    except Exception:
        pass

    # 点击登录按钮
    print("[登录] 点击登录...")
    try:
        page.locator(login_cfg["submit_btn"]).click()
    except Exception:
        try:
            page.locator("button[type='submit'], .btn-login, [class*='login'] [class*='btn']").first.click()
        except PwTimeoutError:
            pass

    # 等待跳转
    print("[登录] 等待跳转...（如有验证码请手动处理）")
    for _ in range(120):
        time.sleep(1)
        cur = page.url
        if any(kw in cur for kw in login_cfg["login_success_indicator"]):
            print("[登录] 登录成功!")
            return True
        try:
            if page.is_closed():
                return False
        except Exception:
            return False

    print("[登录] 超时")
    return False


def ensure_logged_in(page, user, pwd, target_url):
    """
    确保已登录：导航到目标页 → 自动处理 SSO 登录。
    返回 True 表示已到达课程页面。
    """
    print(f"[导航] {target_url[:80]}...")
    page.goto(target_url)
    page.wait_for_timeout(3000)

    for _attempt in range(3):
        cur = page.url

        # 已到达课程页
        if "courseware" in cur or "mycourse" in cur or "newIndex" in cur:
            print("[导航] 已到达课程页面")
            return True

        # 在登录页 → 自动登录
        if is_on_login_page(page):
            if not do_login(page, user, pwd):
                return False
            # 等待 SSO 跳转
            for __ in range(60):
                time.sleep(1)
                cur = page.url
                if "courseware" in cur or "mycourse" in cur or "newIndex" in cur:
                    print("[导航] 登录跳转成功")
                    return True
                if is_on_login_page(page) and __ > 10:
                    print("[警告] 登录后仍在登录页，可能需要手动验证")
                    input("请手动完成验证后按 Enter...")
                    return "courseware" in page.url or "mycourse" in page.url
            continue

        # 未知状态，等待
        page.wait_for_timeout(2000)

    return "courseware" in page.url or "mycourse" in page.url


# =====================================================
# 课程导航
# =====================================================
def get_exercise_list(page):
    """获取必修练习题列表"""
    course_cfg = SEL["course_page"]
    try:
        page.wait_for_selector(course_cfg["exercise_icon"], timeout=10000)
        exercises = page.locator(course_cfg["exercise_icon"]).all()
        must_do = [ex for ex in exercises if ex.locator(".iconfont").count()]
        return must_do
    except PwTimeoutError:
        return []


# =====================================================
# 题型检测
# =====================================================
def detect_question_type(page):
    """检测当前页面的题型"""
    type_detect = SEL["exercise"].get("_type_detection", {})
    for qtype, selector in type_detect.items():
        try:
            if page.locator(selector).count() > 0:
                return qtype
        except Exception:
            pass
    return "unknown"


# =====================================================
# 弹窗处理
# =====================================================
def close_dialogs(page):
    """关闭弹窗"""
    common = SEL["exercise"]["common"]
    close_sel = common.get("dialog_close", "[class*='dialog-header-pc--close']")
    try:
        el = page.locator(close_sel).first
        if el.is_visible(timeout=500):
            el.click(timeout=500)
            page.wait_for_timeout(500)
    except Exception:
        pass
    try:
        iknow = page.locator(common.get("i_know_btn", ".iKnow"))
        if iknow.is_visible(timeout=500):
            iknow.click(timeout=500)
    except Exception:
        pass


def click_next_or_submit(page):
    """点击下一页或提交按钮"""
    common = SEL["exercise"]["common"]
    for sel_key in ["next_btn", "submit_btn"]:
        selector = common.get(sel_key, "")
        if not selector:
            continue
        try:
            btns = page.locator(selector).all()
            if btns:
                btn = btns[-1]
                if btn.is_visible(timeout=500):
                    btn.click(timeout=2000)
                    page.wait_for_timeout(1000)
                    return True
        except Exception:
            pass
    return False


# =====================================================
# 题目交互
# =====================================================
def fill_banked_cloze(page, answers):
    """
    选词填空题：逐个点击 option 按钮填入单词。
    answers: [{"index": 0, "value": "commercialism"}, ...]
    """
    cfg = SEL["exercise"]["banked_cloze"]
    word_options = page.locator(cfg["word_options"])
    blank_inputs = page.locator(cfg["blank_inputs"])

    for ans in answers:
        idx = ans.get("index", 0)
        value = ans.get("value", "")
        try:
            option = word_options.filter(has_text=value).first
            option.click(timeout=2000)
            page.wait_for_timeout(300)
            blanks = blank_inputs.all()
            if idx < len(blanks):
                blanks[idx].click(timeout=2000)
                page.wait_for_timeout(300)
        except PwTimeoutError:
            print(f"  [警告] 无法填入: {value}")


def fill_text_inputs(page, answers, input_selector=None):
    """
    文本填空/翻译题：直接在 input/textarea 中填入答案。
    answers: [{"index": 0, "value": "answer text"}, ...]
    """
    if input_selector is None:
        input_selector = "input[type='text'], textarea"
    inputs = page.locator(input_selector).all()
    for ans in answers:
        idx = ans.get("index", 0)
        value = ans.get("value", "")
        if idx < len(inputs):
            try:
                inputs[idx].fill(value, timeout=2000)
                page.wait_for_timeout(200)
            except PwTimeoutError:
                print(f"  [警告] 无法填入第 {idx} 个空: {value}")


def fill_single_choice(page, answers):
    """单选题：点击对应选项的 radio/label"""
    cfg = SEL["exercise"]["single_choice"]
    template = cfg.get("radio_input", "input[value='{choice}']")
    for ans in answers:
        choice = ans.get("choice", "A")
        radio_sel = template.replace("{choice}", choice)
        try:
            radio = page.locator(radio_sel)
            if radio.is_visible(timeout=500):
                radio.click(timeout=1500)
                page.wait_for_timeout(200)
        except PwTimeoutError:
            pass
