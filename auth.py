from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, BrowserContext

load_dotenv()

SCHEDULE_BUILDER_URL = "https://tamu.collegescheduler.com/"
CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TOOL_PROFILE_DIR = Path.home() / ".tamu_chrome_profile"


def get_context() -> tuple:
    """
    Return (playwright, context).
    Uses a persistent profile so session survives across runs.
    First run: auto-fills creds, waits for 2FA.
    After that: already logged in.
    """
    TOOL_PROFILE_DIR.mkdir(exist_ok=True)
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        str(TOOL_PROFILE_DIR),
        executable_path=CHROME_EXECUTABLE,
        headless=False,
        args=["--no-first-run", "--no-default-browser-check", "--password-store=basic"],
        ignore_default_args=["--enable-automation"],  # looks less bot-like
    )

    page = ctx.new_page()
    page.goto(SCHEDULE_BUILDER_URL, wait_until="domcontentloaded", timeout=20000)

    # Already logged in
    if "collegescheduler.com" in page.url and "login" not in page.url:
        page.close()
        return pw, ctx

    _do_login(page)
    page.close()
    return pw, ctx


def _do_login(page) -> None:
    netid = os.environ.get("TAMU_NETID", "")
    password = os.environ.get("TAMU_PASSWORD", "")

    # Fill email step
    try:
        page.wait_for_selector("input[type='email']", timeout=10000)
        page.fill("input[type='email']", f"{netid}@tamu.edu")
        page.wait_for_timeout(500)
        page.click("input[type='submit'][value='Next'], button:has-text('Next')")
    except Exception as e:
        print(f"  email step: {e}", file=sys.stderr)

    # Fill password step
    try:
        page.wait_for_selector("input[type='password']", timeout=10000)
        page.fill("input[type='password']", password)
        page.wait_for_timeout(500)
        page.click("input[type='submit'][value='Sign in'], button:has-text('Sign in')")
    except Exception as e:
        print(f"  password step: {e}", file=sys.stderr)

    # Click "Continue" on the Duo verification redirect page if it appears
    try:
        page.wait_for_selector("input[type='submit'], button", timeout=5000)
        page.evaluate("""
            const inputs = [...document.querySelectorAll("input[type='submit']")];
            const buttons = [...document.querySelectorAll("button")];
            const all = [...inputs, ...buttons];
            const cont = all.find(el => (el.value || el.textContent || '').trim() === 'Continue');
            if (cont) cont.click();
        """)
        page.wait_for_timeout(1000)
    except Exception:
        pass

    print("\nWaiting for 2FA — complete it in the browser window.\n", file=sys.stderr)

    # After Duo 2FA, there may be a "Is this your device?" prompt — click Yes
    def _click_trust_device():
        try:
            # Could be in an iframe
            for frame in page.frames:
                btn = frame.query_selector("button:has-text('Yes, this is my device'), [data-testid='trust-browser-button']")
                if btn:
                    btn.click()
                    return
            # Or on the main page
            page.evaluate("""
                const all = [...document.querySelectorAll("button")];
                const yes = all.find(el => el.textContent.includes('Yes, this is my device'));
                if (yes) yes.click();
            """)
        except Exception:
            pass

    def _click_stay_signed_in():
        try:
            page.evaluate("""
                const all = [...document.querySelectorAll("input[type='submit'], button")];
                const yes = all.find(el => (el.value || el.textContent || '').trim() === 'Yes');
                if (yes) yes.click();
            """)
        except Exception:
            pass

    # Poll for any post-2FA prompts while waiting for final redirect
    import time
    deadline = time.time() + 180
    while time.time() < deadline:
        if "collegescheduler.com" in page.url:
            break
        _click_trust_device()
        _click_stay_signed_in()
        page.wait_for_timeout(1500)

    print("Logged in. Session saved.\n", file=sys.stderr)
