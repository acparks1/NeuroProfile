from __future__ import annotations

import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "index.html"
TEMPLATE = ROOT / "assets" / "NeuroProfile_Input_Template.xlsx"
EXAMPLE = ROOT / "assets" / "NeuroProfile_Example.xlsx"


def html_text() -> str:
    return HTML.read_text(encoding="utf-8")


def test_repository_layout():
    required = [
        HTML,
        TEMPLATE,
        EXAMPLE,
        ROOT / "README.md",
        ROOT / "CHANGELOG.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "SECURITY.md",
        ROOT / "NOTICE.md",
        ROOT / "LICENSE.md",
        ROOT / "examples" / "NeuroProfile_Text_Parser_Test_Tables.txt",
        ROOT / "src" / "text-parser.js",
        ROOT / "tests" / "test_text_parser.js",
        ROOT / "tests" / "browser_smoke.py",
    ]
    for path in required:
        assert path.exists() and path.stat().st_size > 0, path


def test_standalone_app_is_current_and_self_contained():
    text = html_text()
    assert "<title>NeuroProfile Web 0.16</title>" in text
    assert 'const APP_VERSION = "0.16";' in text
    assert "const VERSION='0.16';" in text
    assert 'id="patientSelect"' not in text
    assert 'id="profileAggregation" type="hidden"' in text
    assert "Weight" not in re.search(r'<thead>(.*?)</thead>', re.search(r'<table class="[^\"]*score-editor-table[^\"]*">(.*?)</table>', text, re.S).group(1), re.S).group(1)
    assert "Content-Security-Policy" in text
    assert "connect-src 'none'" in text
    assert not re.search(r'<script[^>]+src=', text, re.I)
    assert not re.search(r'<link[^>]+href=["\']https?://', text, re.I)
    assert "0.15" not in text


def test_required_public_features_present():
    text = html_text()
    for marker in (
        "Paste score table",
        "Multiple Assessments",
        "Theater Mode",
        "Copy to Clipboard",
        "Laser",
        "Clear all",
        "Grayscale",
        "Color-vision friendly",
        "Equal-weighted domain averages",
    ):
        assert marker in text


def test_workbooks_are_valid_archives_and_have_expected_schema():
    expected = "DOMAIN|TEST|T-SCORE|%ile|Z-SCORE|STANDARD|SCALED|INCLUDE|ORDER|PATIENT ID"
    for workbook in (TEMPLATE, EXAMPLE):
        with zipfile.ZipFile(workbook) as archive:
            assert archive.testzip() is None
            xml = archive.read("xl/worksheets/sheet1.xml").decode("utf-8", errors="ignore").upper()
            for header in expected.split("|"):
                assert header.upper() in xml
            assert "WEIGHT" not in xml
            for marker in ("#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A"):
                assert marker not in xml


def test_no_real_patient_data_in_public_fixtures():
    text_files = [
        ROOT / "README.md",
        ROOT / "CHANGELOG.md",
        ROOT / "CONTRIBUTING.md",
        ROOT / "SECURITY.md",
        ROOT / "examples" / "NeuroProfile_Text_Parser_Test_Tables.txt",
    ]
    forbidden = ("Adam Parks", "aparks", "medical record number", "date of birth")
    for path in text_files:
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
        for token in forbidden:
            assert token.lower() not in text, (path, token)
