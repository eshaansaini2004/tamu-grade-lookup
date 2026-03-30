from playwright.sync_api import sync_playwright
from pathlib import Path
import os, time
from dotenv import load_dotenv

load_dotenv()
netid = os.environ["TAMU_NETID"]
password = os.environ["TAMU_PASSWORD"]

pw = sync_playwright().start()
ctx = pw.chromium.launch_persistent_context(
    str(Path.home() / ".tamu_profiles" / "duo_debug"),
    executable_path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless=False,
    args=["--no-first-run", "--no-default-browser-check", "--password-store=basic"],
    ignore_default_args=["--enable-automation"],
)

page = ctx.new_page()
page.goto("https://tamu.collegescheduler.com/", wait_until="domcontentloaded", timeout=20000)

page.wait_for_selector("input[type='email']", timeout=10000)
page.fill("input[type='email']", f"{netid}@tamu.edu")
page.wait_for_timeout(500)
page.click("input[type='submit'][value='Next'], button:has-text('Next')")

page.wait_for_selector("input[type='password']", timeout=10000)
page.fill("input[type='password']", password)
page.wait_for_timeout(500)
page.click("input[type='submit'][value='Sign in'], button:has-text('Sign in')")

try:
    page.wait_for_selector("input[type='submit'], button", timeout=5000)
    page.evaluate("""
        const all = [...document.querySelectorAll("input[type='submit'], button")];
        const cont = all.find(el => (el.value || el.textContent || '').trim() === 'Continue');
        if (cont) cont.click();
    """)
except:
    pass

print("Waiting for Duo to fully render...")
# Poll until the Duo frame has more than just "Secured by Duo"
for _ in range(20):
    time.sleep(2)
    for frame in page.frames:
        if "duosecurity.com" in frame.url:
            try:
                text = frame.evaluate("() => document.body.innerText")
                if len(text.strip()) > 30:
                    print(f"Duo frame loaded ({len(text)} chars)")
                    break
            except:
                pass
    else:
        continue
    break

page.screenshot(path="/tmp/duo_screen.png")
print("Screenshot saved to /tmp/duo_screen.png")

for i, frame in enumerate(page.frames):
    print(f"\n--- Frame {i}: {frame.url} ---")
    try:
        html = frame.evaluate("() => document.body.innerHTML")
        print(html[:3000])
    except Exception as e:
        print(f"  (could not read: {e})")

ctx.close()
pw.stop()
