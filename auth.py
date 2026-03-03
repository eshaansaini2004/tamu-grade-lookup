from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Callable

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv()

SCHEDULE_BUILDER_URL = "https://tamu.collegescheduler.com/"
CHROME_EXECUTABLE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TOOL_PROFILE_DIR = Path.home() / ".tamu_chrome_profile"
PROFILES_DIR = Path.home() / ".tamu_profiles"


def get_context(
    user_id: str | None = None,
    on_duo_code: Callable[[str], None] | None = None,
    headless: bool = False,
) -> tuple:
    """
    Return (playwright, context).

    user_id: profile stored at ~/.tamu_profiles/<user_id>/; None = legacy single-user profile.
    on_duo_code: called with the code Duo displays on screen so the caller can
                 forward it to the user. If None, user must approve manually in browser.
    headless: True for server/bot use.
    """
    profile_dir = PROFILES_DIR / user_id if user_id else TOOL_PROFILE_DIR
    profile_dir.mkdir(parents=True, exist_ok=True)
    pw = sync_playwright().start()
    ctx = pw.chromium.launch_persistent_context(
        str(profile_dir),
        executable_path=CHROME_EXECUTABLE,
        headless=headless,
        args=["--no-first-run", "--no-default-browser-check", "--password-store=basic"],
        ignore_default_args=["--enable-automation"],
    )

    page = ctx.new_page()
    page.goto(SCHEDULE_BUILDER_URL, wait_until="domcontentloaded", timeout=20000)

    if "collegescheduler.com" in page.url and "login" not in page.url:
        page.close()
        return pw, ctx

    _do_login(page, on_duo_code=on_duo_code)
    page.close()
    return pw, ctx


def _do_login(page, on_duo_code: Callable[[str], None] | None = None) -> None:
    netid = os.environ.get("TAMU_NETID", "")
    password = os.environ.get("TAMU_PASSWORD", "")

    # Email step
    try:
        page.wait_for_selector("input[type='email']", timeout=10000)
        page.fill("input[type='email']", f"{netid}@tamu.edu")
        page.wait_for_timeout(500)
        page.click("input[type='submit'][value='Next'], button:has-text('Next')")
    except Exception as e:
        print(f"  email step: {e}", file=sys.stderr)

    # Password step
    try:
        page.wait_for_selector("input[type='password']", timeout=10000)
        page.fill("input[type='password']", password)
        page.wait_for_timeout(500)
        page.click("input[type='submit'][value='Sign in'], button:has-text('Sign in')")
    except Exception as e:
        print(f"  password step: {e}", file=sys.stderr)

    # "Continue" redirect to Duo
    try:
        page.wait_for_selector("input[type='submit'], button", timeout=5000)
        page.evaluate("""
            const all = [...document.querySelectorAll("input[type='submit'], button")];
            const cont = all.find(el => (el.value || el.textContent || '').trim() === 'Continue');
            if (cont) cont.click();
        """)
        page.wait_for_timeout(2000)
    except Exception:
        pass

    # Scrape the verification code Duo shows on screen
    if on_duo_code:
        code = _scrape_duo_code(page)
        if code:
            print(f"  Duo code: {code}", file=sys.stderr)
            on_duo_code(code)
        else:
            print("  Could not scrape Duo code.", file=sys.stderr)
            on_duo_code(None)
    else:
        print("\nWaiting for 2FA — enter the code shown in the browser into your Duo app.\n", file=sys.stderr)

    # Poll until Duo approves and we land on collegescheduler
    def _click_trust():
        try:
            for frame in page.frames:
                btn = frame.query_selector(
                    "button:has-text('Yes, this is my device'), [data-testid='trust-browser-button']"
                )
                if btn:
                    btn.click()
                    return
            page.evaluate("""
                const yes = [...document.querySelectorAll("button")]
                    .find(el => el.textContent.includes('Yes, this is my device'));
                if (yes) yes.click();
            """)
        except Exception:
            pass

    def _click_stay():
        try:
            page.evaluate("""
                const yes = [...document.querySelectorAll("input[type='submit'], button")]
                    .find(el => (el.value || el.textContent || '').trim() === 'Yes');
                if (yes) yes.click();
            """)
        except Exception:
            pass

    deadline = time.time() + 180
    while time.time() < deadline:
        if "collegescheduler.com" in page.url:
            break
        _click_trust()
        _click_stay()
        page.wait_for_timeout(1500)

    print("Logged in. Session saved.\n", file=sys.stderr)


def _scrape_duo_code(page) -> str | None:
    """Wait for the Duo iframe to load and grab the verification code."""
    deadline = time.time() + 40
    while time.time() < deadline:
        for frame in page.frames:
            if "duosecurity.com" not in frame.url:
                continue
            try:
                # Wait for the element to appear in this frame
                frame.wait_for_selector(".verification-code", timeout=2000)
                el = frame.query_selector(".verification-code")
                if el:
                    code = el.inner_text().strip()
                    if code.isdigit():
                        return code
            except Exception:
                pass
        page.wait_for_timeout(500)
    return None


