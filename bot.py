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
import sys
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

import discord
from discord import app_commands

load_dotenv()
TOKEN = os.getenv("DISCORD_TOKEN")

# Reuse all existing logic
sys.path.insert(0, os.path.dirname(__file__))
from auth import get_context
from schedule import get_all_sections, select_sections, reset_sections
from scraper import fetch_course
from models import CourseReport, SectionInfo
from lookup import parse_courses, build_report, format_report, _fmt_section

executor = ThreadPoolExecutor(max_workers=1)  # one browser at a time


def _run_lookup(courses: list[tuple[str, str]]) -> str:
    pw, ctx = get_context()
    try:
        sections_data = get_all_sections(courses, ctx)
    finally:
        ctx.close()
        pw.stop()

    reports = [
        build_report(dept, number, sections_data.get(f"{dept} {number}", []))
        for dept, number in courses
    ]
    return "".join(format_report(r) for r in reports)


def _run_select(triplets: list[tuple[str, str, str]]) -> str:
    unique_courses = [(dept, num) for dept, num, _ in triplets]
    pw, ctx = get_context()
    try:
        sections_data = get_all_sections(unique_courses, ctx)
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


def _run_reset(courses: list[tuple[str, str]]) -> str:
    pw, ctx = get_context()
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
    await interaction.response.defer(thinking=True)
    try:
        triplets = _parse_triplet_str(selections)
    except ValueError as e:
        await interaction.followup.send(f"Error: {e}")
        return

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, _run_select, triplets)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}")
        return

    await interaction.followup.send(result)


@client.tree.command(name="reset", description="Restore all sections for courses. E.g: CSCE 120 ENGL 210")
@app_commands.describe(courses="Space-separated DEPT NUM pairs: CSCE 120 ENGL 210")
async def reset(interaction: discord.Interaction, courses: str):
    await interaction.response.defer(thinking=True)
    try:
        course_list = _parse_course_str(courses)
    except ValueError as e:
        await interaction.followup.send(f"Error: {e}")
        return

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(executor, _run_reset, course_list)
    except Exception as e:
        await interaction.followup.send(f"Error: {e}")
        return

    await interaction.followup.send(result)


if __name__ == "__main__":
    client.run(TOKEN)
