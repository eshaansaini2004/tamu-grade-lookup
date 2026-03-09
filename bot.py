"""
TAMU Grade Lookup Discord Bot
Commands:
  /lookup CSCE 120 ENGL 210
  /select CSCE 120 Beideman ENGL 210 Baca
  /reset CSCE 120 ENGL 210
"""
from __future__ import annotations

import asyncio
import os
import queue
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from dotenv import load_dotenv

import discord
from discord import app_commands

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

# Reuse all existing logic
sys.path.insert(0, os.path.dirname(__file__))
from auth import get_context, PROFILES_DIR
from schedule import select_sections, reset_sections
from howdy import get_sections_for_courses
from scraper import fetch_course
from models import CourseReport, SectionInfo
from lookup import parse_courses, build_report, format_report, _fmt_section

executor = ThreadPoolExecutor(max_workers=1)  # one browser at a time


def _has_session(user_id: str) -> bool:
    profile_dir = PROFILES_DIR / user_id
    return profile_dir.exists() and any(profile_dir.iterdir())


def _run_login(user_id: str, code_queue: queue.Queue) -> None:
    """
    Runs login in a thread. When Duo shows a code on screen, puts it in code_queue
    so the Discord handler can forward it to the user. Then blocks until Duo approves.
    """
    pw, ctx = get_context(user_id, on_duo_code=code_queue.put, headless=True)
    ctx.close()
    pw.stop()


def _run_lookup(courses: list[tuple[str, str]]) -> str:
    sections_data = get_sections_for_courses(courses)
    reports = [
        build_report(dept, number, sections_data.get(f"{dept} {number}", []))
        for dept, number in courses
    ]
    return "".join(format_report(r) for r in reports)


def _run_select(user_id: str, triplets: list[tuple[str, str, str]]) -> str:
    unique_courses = [(dept, num) for dept, num, _ in triplets]
    sections_data = get_sections_for_courses(unique_courses)
    pw, ctx = get_context(user_id)
    try:
        selections = [
            (f"{dept} {num}", instr, sections_data.get(f"{dept} {num}", []))
            for dept, num, instr in triplets
        ]
        results = select_sections(selections, ctx)
    finally:
        ctx.close()
        pw.stop()

    lines = []
    for course_key, selected in results.items():
        if selected:
            lines.append(f"**{course_key}** — {selected[0].instructor_name} ({len(selected)} sections)")
            for s in selected:
                lines.append(_fmt_section(s))
        else:
            lines.append(f"**{course_key}** — no matching instructor found")
    return "\n".join(lines) if lines else "Nothing selected."


def _run_reset(user_id: str, courses: list[tuple[str, str]]) -> str:
    pw, ctx = get_context(user_id)
    try:
        reset_sections(courses, ctx)
    finally:
        ctx.close()
        pw.stop()
    names = ", ".join(f"{d} {n}" for d, n in courses)
    return f"Reset all sections for: {names}"


class GradeBot(discord.Client):
    def __init__(self):
        intents = discord.Intents.default()
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        await self.tree.sync()
        print("Slash commands synced.")

    async def on_ready(self):
        print(f"Bot ready — logged in as {self.user}")


client = GradeBot()


def _parse_course_str(s: str) -> list[tuple[str, str]]:
    parts = s.upper().split()
    if len(parts) % 2 != 0:
        raise ValueError("Expected pairs: DEPT NUM [DEPT NUM ...]")
    return [(parts[i], parts[i + 1]) for i in range(0, len(parts), 2)]


def _parse_triplet_str(s: str) -> list[tuple[str, str, str]]:
    parts = s.split()
    if len(parts) % 3 != 0:
        raise ValueError("Expected triplets: DEPT NUM INSTRUCTOR [...]")
    return [(parts[i].upper(), parts[i + 1], parts[i + 2]) for i in range(0, len(parts), 3)]


def _chunk(text: str, limit: int = 1900) -> list[str]:
    """Split text into Discord-safe chunks."""
    chunks, current = [], []
    for line in text.splitlines(keepends=True):
        if sum(len(l) for l in current) + len(line) > limit:
            chunks.append("".join(current))
            current = []
        current.append(line)
    if current:
        chunks.append("".join(current))
    return chunks or ["(no output)"]


@client.tree.command(name="login", description="Log in to TAMU — bot fills your creds, you enter the Duo code")
async def login(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    code_queue: queue.Queue = queue.Queue()

    await interaction.response.defer(thinking=True)
    loop = asyncio.get_event_loop()
    login_future = loop.run_in_executor(executor, _run_login, user_id, code_queue)

    # Wait for the Duo code to be scraped from the browser
    try:
        duo_code = await asyncio.wait_for(
            loop.run_in_executor(None, code_queue.get),
            timeout=60,
        )
    except asyncio.TimeoutError:
        await interaction.followup.send("Timed out waiting for Duo to load. Try `/login` again.")
        return

    if duo_code:
        await interaction.followup.send(f"Enter this code in your Duo Mobile app: **{duo_code}**")
    else:
        await interaction.followup.send("Couldn't read the Duo code — check the browser window.")

    try:
        await login_future
    except Exception as e:
        await interaction.followup.send(f"Login failed: {e}")
        return

    await interaction.followup.send("Logged in. Session saved.")


@client.tree.command(name="logout", description="Log out and delete your saved TAMU session")
async def logout(interaction: discord.Interaction):
    user_id = str(interaction.user.id)
    profile_dir = PROFILES_DIR / user_id
    if profile_dir.exists():
        shutil.rmtree(profile_dir)
        await interaction.response.send_message("Logged out. Profile deleted.")
    else:
        await interaction.response.send_message("No session found.")


@client.tree.command(name="lookup", description="Grade report for courses. E.g: CSCE 120 ENGL 210")
@app_commands.describe(courses="Space-separated DEPT NUM pairs: CSCE 120 ENGL 210")
async def lookup(interaction: discord.Interaction, courses: str):
    await interaction.response.defer(thinking=True)
    try:
        course_list = _parse_course_str(courses)
    except ValueError as e:
        await interaction.followup.send(f"Error: {e}")
        return

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, _run_lookup, course_list)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}")
        return

    chunks = _chunk(f"```\n{result}\n```")
    await interaction.followup.send(chunks[0])
    for chunk in chunks[1:]:
        await interaction.followup.send(chunk)


@client.tree.command(name="select", description="Select sections by prof. E.g: CSCE 120 Beideman ENGL 210 Baca")
@app_commands.describe(selections="Triplets: DEPT NUM INSTRUCTOR — CSCE 120 Beideman ENGL 210 Baca")
async def select(interaction: discord.Interaction, selections: str):
    user_id = str(interaction.user.id)
    if not _has_session(user_id):
        await interaction.response.send_message("No session found. Run /login first.")
        return
    await interaction.response.defer(thinking=True)
    try:
        triplets = _parse_triplet_str(selections)
    except ValueError as e:
        await interaction.followup.send(f"Error: {e}")
        return

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, _run_select, user_id, triplets)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}")
        return

    await interaction.followup.send(result)


@client.tree.command(name="reset", description="Restore all sections for courses. E.g: CSCE 120 ENGL 210")
@app_commands.describe(courses="Space-separated DEPT NUM pairs: CSCE 120 ENGL 210")
async def reset(interaction: discord.Interaction, courses: str):
    user_id = str(interaction.user.id)
    if not _has_session(user_id):
        await interaction.response.send_message("No session found. Run /login first.")
        return
    await interaction.response.defer(thinking=True)
    try:
        course_list = _parse_course_str(courses)
    except ValueError as e:
        await interaction.followup.send(f"Error: {e}")
        return

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, _run_reset, user_id, course_list)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}")
        return

    await interaction.followup.send(result)


if __name__ == "__main__":
    client.run(TOKEN)
