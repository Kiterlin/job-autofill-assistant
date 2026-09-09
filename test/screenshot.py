#!/usr/bin/env python3
"""用系统无头 Chrome 打开扩展页面并截取 README 用界面图。"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import threading
import time
from functools import partial
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / "job-autofill-assistant"
OUT = ROOT / "pictures"
DEMO_HTML = ROOT / "test/fixtures/demo-apply-form.html"
CHROME = Path.home() / ".local/bin/google-chrome"
PROFILE_ID = "id_demo_profile"


def demo_data() -> dict:
    return {
        "version": "1.0.0",
        "activeProfileId": PROFILE_ID,
        "settings": {
            "aiEnabled": True,
            "aiProvider": "deepseek",
            "aiApiKey": "",
            "aiApiUrl": "",
            "aiModel": "deepseek-chat",
            "ocrApiKey": "",
            "uiTheme": "light",
            "autoFillOnPageLoad": False,
            "highlightFilledFields": True,
        },
        "profiles": [{
            "id": PROFILE_ID,
            "name": "校招-后端开发",
            "createdAt": "2026-08-01T00:00:00.000Z",
            "updatedAt": "2026-09-09T00:00:00.000Z",
            "basicInfo": {
                "fullName": "张子涵",
                "firstName": "子涵",
                "lastName": "张",
                "phone": "13812345678",
                "email": "zihan.zhang_dev@example.com",
                "gender": "男",
                "birthDate": "2001-08-16",
                "politicalStatus": "共青团员",
                "ethnicity": "汉族",
                "hometown": "山东青岛",
                "graduationDate": "2026-06",
                "maritalStatus": "未婚",
                "currentCity": "北京市海淀区",
                "emergencyContact": "张伟",
                "emergencyPhone": "13900001111",
                "emergencyRelation": "父亲",
                "city": "北京",
                "state": "北京",
                "country": "中国",
                "location": "北京市海淀区",
                "github": "https://github.com/zihan-dev-test",
            },
            "jobIntention": {
                "expectedCity": "北京 / 上海",
                "expectedPosition": "后端开发工程师",
                "expectedSalary": "18k-25k",
                "availableDate": "2026年7月",
                "referralCode": "",
                "recruitSource": "校招官网",
                "willingToTravel": "视情况而定",
            },
            "languageSkills": {"cet4": "580分", "cet6": "562分", "ielts": "", "toefl": "", "otherLanguages": ""},
            "familyMembers": [{"id": "id_demo_family_1", "name": "张伟", "relation": "父亲", "employer": "青岛市实验中学", "position": "教师", "phone": "13900001111"}],
            "awards": [{"id": "id_demo_award_1", "name": "国家奖学金", "level": "国家级", "date": "2024-11"}],
            "education": [{"id": "id_demo_edu_1", "school": "北京航空航天大学", "college": "计算机学院", "major": "计算机科学与技术", "degree": "硕士", "degreeType": "普通全日制统招", "schoolType": "985", "startDate": "2023-09", "endDate": "2026-06", "gpa": "3.7/4.0", "rank": "前10%", "courses": "高级算法、分布式系统、自然语言处理", "description": ""}],
            "workExperience": [{"id": "id_demo_work_1", "company": "字节跳动", "department": "推荐架构", "position": "后端开发实习生", "workType": "实习", "city": "北京", "startDate": "2025-06", "endDate": "2025-09", "description": "负责推荐服务接口开发与性能优化。", "achievements": ""}],
            "projects": [{"id": "id_demo_proj_1", "name": "智能简历解析助手", "role": "负责人", "projectType": "开源项目", "techStack": "Python, FastAPI, PyTorch", "startDate": "2025-03", "endDate": "2025-08", "projectUrl": "", "description": "面向求职场景的简历结构化抽取工具。", "responsibilities": "负责服务拆分、模型接入与评测。", "achievements": ""}],
            "skills": ["Python", "FastAPI", "PyTorch", "Docker", "MySQL"],
            "certificates": [{"id": "id_demo_cert_1", "name": "软件设计师", "code": "", "issuer": "工信部", "date": "2024-05", "expiryDate": ""}],
            "introTemplates": {"default": "硕士在读，关注推荐系统与高并发服务，期待加入后端研发团队。", "custom": []},
            "hrGreeting": "您好，我是张子涵，北航计算机硕士，曾在字节跳动实习，想申请贵司后端开发校招岗位。",
        }],
        "submissions": [
            {"id": "s1", "company": "字节跳动", "position": "后端开发工程师", "url": "https://jobs.bytedance.com/", "date": "2026-09-01", "profileName": "校招-后端开发", "profileId": PROFILE_ID, "status": "面试", "notes": "一面已过，等待二面"},
            {"id": "s2", "company": "腾讯", "position": "后台开发", "url": "https://careers.tencent.com/", "date": "2026-09-02", "profileName": "校招-后端开发", "profileId": PROFILE_ID, "status": "笔试", "notes": ""},
            {"id": "s3", "company": "阿里巴巴", "position": "Java 开发工程师", "url": "https://talent.alibaba.com/", "date": "2026-09-03", "profileName": "校招-后端开发", "profileId": PROFILE_ID, "status": "在投", "notes": "走校招官网投递"},
            {"id": "s4", "company": "美团", "position": "后端开发工程师", "url": "https://zhaopin.meituan.com/", "date": "2026-08-28", "profileName": "校招-后端开发", "profileId": PROFILE_ID, "status": "Offer", "notes": "已口头 offer"},
            {"id": "s5", "company": "华为", "position": "软件开发工程师", "url": "https://career.huawei.com/", "date": "2026-08-20", "profileName": "校招-后端开发", "profileId": PROFILE_ID, "status": "挂了", "notes": ""},
        ],
        "logs": [],
    }


CHROME_MOCK = r"""
(() => {
  const data = window.__CAPYBARA_DEMO__;
  if (!data) return;
  try { localStorage.setItem('capybara-ui-theme', 'light'); } catch {}
  const store = {
    jobAutofillData: data,
    jobAutofillLogs: [],
    jobAutofillDockHidden: false,
    jobAutofillDockCollapsed: false
  };
  const active = () => data.profiles.find((p) => p.id === data.activeProfileId) || data.profiles[0];
  const reply = (action, payload) => {
    switch (action) {
      case 'getSettings': return { success: true, settings: data.settings };
      case 'updateSettings':
        Object.assign(data.settings, payload.settings || {});
        return { success: true, settings: data.settings };
      case 'getAllProfiles': return { success: true, profiles: data.profiles, activeProfileId: data.activeProfileId };
      case 'getActiveProfile': return { success: true, profile: active() };
      case 'getSubmissions': return { success: true, submissions: data.submissions };
      case 'updateProfile': return { success: true };
      case 'setActiveProfile': return { success: true };
      case 'addSubmission': return { success: true };
      case 'recordSubmission': return { success: true };
      case 'appendLogs': return { success: true };
      default: return { success: true };
    }
  };
  const storageLocal = {
    get(keys, cb) {
      let result = {};
      if (keys == null) result = { ...store };
      else if (typeof keys === 'string') result[keys] = store[keys];
      else if (Array.isArray(keys)) keys.forEach((k) => { result[k] = store[k]; });
      else if (typeof keys === 'object') {
        result = { ...keys };
        Object.keys(keys).forEach((k) => { if (k in store) result[k] = store[k]; });
      }
      const done = typeof keys === 'function' ? keys : cb;
      if (typeof done === 'function') setTimeout(() => done(result), 0);
      return Promise.resolve(result);
    },
    set(obj, cb) {
      Object.assign(store, obj || {});
      if (typeof cb === 'function') setTimeout(cb, 0);
      return Promise.resolve();
    }
  };
  window.chrome = {
    runtime: {
      lastError: undefined,
      getURL: (p) => new URL(p, location.origin + '/').href,
      sendMessage: (payload, cb) => {
        const res = reply(payload && payload.action, payload || {});
        if (typeof cb === 'function') setTimeout(() => cb(res), 0);
        return Promise.resolve(res);
      },
      onMessage: { addListener() {}, removeListener() {} }
    },
    storage: {
      local: storageLocal,
      onChanged: { addListener() {}, removeListener() {} }
    },
    tabs: {
      query: async () => [{ id: 1, url: location.href }],
      sendMessage: (id, msg, cb) => { if (typeof cb === 'function') setTimeout(() => cb({ success: true }), 0); },
      create() {}
    }
  };
})();
"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, demo_html: Path, ext_root: Path, **kwargs):
        self.demo_html = demo_html
        self.ext_root = ext_root
        super().__init__(*args, directory=str(ext_root), **kwargs)

    def do_GET(self):
        if self.path.split("?", 1)[0] in ("/demo", "/demo.html"):
            body = self.demo_html.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()

    def log_message(self, format, *args):
        return


def start_server():
    factory = partial(Handler, demo_html=DEMO_HTML, ext_root=EXT)
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), factory)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}"


def hide_scrollbars(page):
    page.add_style_tag(content="html,body{scrollbar-width:none}::-webkit-scrollbar{display:none!important}")


def shot(page, name, **kwargs):
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / name
    page.screenshot(path=str(dest), type="png", **kwargs)
    print(f"wrote {dest} {dest.stat().st_size}")


def main():
    if not CHROME.exists():
        raise SystemExit(f"找不到 Chrome: {CHROME}")
    server, origin = start_server()
    chrome_libs = str(Path.home() / "opt/chrome-libs")
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = chrome_libs + ((":" + env["LD_LIBRARY_PATH"]) if env.get("LD_LIBRARY_PATH") else "")
    payload = json.dumps(demo_data(), ensure_ascii=False)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=str(CHROME),
            headless=True,
            env=env,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
        )
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2,
            locale="zh-CN",
            color_scheme="light",
        )
        context.add_init_script(f"window.__CAPYBARA_DEMO__ = {payload};")
        context.add_init_script(CHROME_MOCK)

        try:
            options = context.new_page()
            options.goto(origin + "/options/options.html#section-basic", wait_until="domcontentloaded", timeout=30000)
            options.wait_for_selector("#fullName", timeout=15000)
            options.wait_for_function("() => document.getElementById('fullName')?.value === '张子涵'", timeout=15000)
            options.evaluate(
                """() => {
                  document.getElementById('sidebarDrawer')?.classList.add('is-open');
                  document.getElementById('section-basic')?.scrollIntoView({ block: 'start' });
                }"""
            )
            time.sleep(0.45)
            hide_scrollbars(options)
            shot(options, "options-profile.png")

            options.goto(origin + "/options/options.html#kanban", wait_until="domcontentloaded", timeout=30000)
            options.wait_for_selector("#statTotal", timeout=15000)
            options.wait_for_function("() => document.getElementById('statTotal')?.textContent !== '0'", timeout=15000)
            time.sleep(0.45)
            hide_scrollbars(options)
            shot(options, "options-kanban.png")

            popup = context.new_page()
            popup.set_viewport_size({"width": 350, "height": 620})
            popup.goto(origin + "/popup/popup.html", wait_until="domcontentloaded", timeout=30000)
            popup.wait_for_selector("#fillBtn", timeout=15000)
            popup.wait_for_function("() => (document.getElementById('currentProfile')?.textContent || '').includes('校招')", timeout=15000)
            time.sleep(0.35)
            hide_scrollbars(popup)
            shot(popup, "popup.png", full_page=True)

            demo = context.new_page()
            demo.set_viewport_size({"width": 1440, "height": 900})
            demo.goto(origin + "/demo", wait_until="domcontentloaded", timeout=30000)
            demo.add_style_tag(path=str(EXT / "styles/content.css"))
            demo.add_script_tag(path=str(EXT / "scripts/app-log.js"))
            demo.add_script_tag(path=str(EXT / "scripts/content.js"))
            demo.wait_for_selector("#job-autofill-btn-fill", timeout=15000)
            demo.evaluate(
                """() => {
                  const dock = document.getElementById('job-autofill-dock');
                  if (dock) {
                    dock.style.left = '24px';
                    dock.style.top = '18px';
                    dock.style.right = 'auto';
                    dock.style.bottom = 'auto';
                  }
                }"""
            )
            demo.click("#job-autofill-btn-fill")
            demo.wait_for_function("() => document.querySelector('input[name=\"fullName\"]')?.value === '张子涵'", timeout=15000)
            time.sleep(0.7)
            hide_scrollbars(demo)
            shot(demo, "fill-demo.png")
        finally:
            context.close()
            browser.close()
    server.shutdown()


if __name__ == "__main__":
    main()
