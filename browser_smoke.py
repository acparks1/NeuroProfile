#!/usr/bin/env python3
"""End-to-end browser regression test for NeuroProfile Web 0.16."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image
from playwright.sync_api import Page, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "index.html"
CHROMIUM = Path("/usr/bin/chromium")
PREVIEWS = ROOT / "test-artifacts"


def storage_mock() -> str:
    return """
      (() => {
        const store = Object.create(null);
        const local = {
          getItem(key) { return Object.prototype.hasOwnProperty.call(store, String(key)) ? store[String(key)] : null; },
          setItem(key, value) { store[String(key)] = String(value); },
          removeItem(key) { delete store[String(key)]; },
          clear() { Object.keys(store).forEach((key) => delete store[key]); },
          key(index) { return Object.keys(store)[index] ?? null; },
          get length() { return Object.keys(store).length; },
        };
        Object.defineProperty(window, 'localStorage', { value: local, configurable: true });
      })();
    """


def set_checkbox(page: Page, selector: str, checked: bool) -> None:
    page.locator(selector).evaluate(
        "(el, checked) => { el.checked = checked; el.dispatchEvent(new Event('change', {bubbles:true})); }",
        checked,
    )


def set_value(page: Page, selector: str, value: str, event: str = "change") -> None:
    page.locator(selector).evaluate(
        "(el, args) => { el.value = args.value; el.dispatchEvent(new Event(args.event, {bubbles:true})); }",
        {"value": value, "event": event},
    )


def parse_table(page: Page, text: str, *, target: str | None = None, default_metric: str = "") -> None:
    if target:
        page.locator("#np013-parser-target").select_option(target)
    page.locator("#np013-parser-input").fill(text)
    set_value(page, "#np013-parser-default-metric", default_metric)
    page.locator("#np013-parser-parse").click()
    page.wait_for_timeout(150)


def assert_no_overlap(page: Page, selector: str) -> None:
    boxes = page.locator(selector).evaluate_all(
        "els => els.map(el => { const b = el.getBBox(); return {x:b.x,y:b.y,w:b.width,h:b.height,text:el.textContent}; })"
    )
    for index, first in enumerate(boxes):
        for second in boxes[index + 1 :]:
            overlap_x = min(first["x"] + first["w"], second["x"] + second["w"]) - max(first["x"], second["x"])
            overlap_y = min(first["y"] + first["h"], second["y"] + second["h"]) - max(first["y"], second["y"])
            assert not (overlap_x > 1 and overlap_y > 1), (first, second)


def main() -> None:
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    html = HTML.read_text(encoding="utf-8")
    launch = {"headless": True, "args": ["--no-sandbox"]}
    if CHROMIUM.exists():
        launch["executable_path"] = str(CHROMIUM)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch)
        context = browser.new_context(viewport={"width": 1600, "height": 1100}, accept_downloads=True)
        context.add_init_script(storage_mock())
        page = context.new_page()
        console_errors: list[str] = []
        page_errors: list[str] = []
        network_requests: list[str] = []
        page.on("console", lambda message: console_errors.append(f"{message.type}:{message.text}") if message.type == "error" else None)
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "request",
            lambda request: network_requests.append(request.url)
            if request.url.startswith(("http://", "https://"))
            else None,
        )

        page.set_content(html, wait_until="load", timeout=90_000)
        page.wait_for_selector("#np014-appearance-heading", timeout=30_000)
        page.evaluate(
            """() => {
              window.ClipboardItem = class ClipboardItem {
                constructor(items) { this.items = items; this.types = Object.keys(items); }
              };
              Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { write: async items => { window.__copiedItems = items; } },
              });
            }"""
        )

        # Consolidated and restrained default interface.
        assert page.title() == "NeuroProfile Web 0.16"
        assert page.locator(".brand-title").inner_text().strip().endswith("0.16")
        assert page.locator("#displayHeading").inner_text().strip() == "Layout"
        assert page.locator("#np014-appearance-heading").inner_text().strip() == "Appearance"
        assert page.locator("#exportHeading").inner_text().strip() == "Export"
        assert not page.locator("#np014-layout-content").evaluate("el => el.open")
        assert not page.locator("#np010-settings").evaluate("el => el.open")
        assert not page.locator("#np012-typography-settings").evaluate("el => el.open")
        assert not page.locator("#np011-color-settings").evaluate("el => el.open")
        assert page.locator(".profile-aggregation-field:visible").count() == 0
        assert page.locator(".final-toggle-group:visible").count() == 0
        assert page.locator("#np011-color-preset option[value='grayscale']").count() == 1
        assert page.locator("#copyFigureButton").count() == 1
        assert page.locator("#np016-copy-figure").count() == 1
        assert not page.locator("#patientSelect").count()
        assert page.locator("#showIndividuals").is_checked() == page.locator("#showTestScoreLegend").is_checked()
        assert "WEIGHT" not in page.locator(".score-editor-table thead").inner_text().upper()

        # Load the standard demonstration profile.
        page.locator("#sampleButton").click()
        page.wait_for_selector("#chartStage svg .np-title", timeout=30_000)
        page.wait_for_timeout(350)
        assert page.locator("#summaryTableBody tr").count() == 8
        assert page.locator("#auditTableBody tr").count() == 19
        assert page.locator(".score-editor-table thead th").count() == 7
        assert page.locator("#np010-axis-metric").input_value() == "percentile"
        assert page.locator("#np010-percentile-spacing").input_value() == "linear"
        assert page.locator("#np010-score-align").input_value() == "right"
        assert page.locator("#showSubtitle").is_checked() is False
        assert page.locator("#showAveragePercentile").is_checked() is False

        # Score data supports adding and deleting tests in real time.
        page.locator("#addScoreRow").click()
        page.wait_for_timeout(100)
        assert page.locator("#auditTableBody tr").count() == 20
        new_row = page.locator("#auditTableBody tr").last
        new_row.locator('[data-field="Domain"]').fill("Language")
        new_row.locator('[data-field="Measure"]').fill("Parser Regression Test")
        new_row.locator('[data-field="Entered_Score"]').fill("52")
        new_row.locator('[data-field="Entered_Score"]').dispatch_event("input")
        page.wait_for_timeout(150)
        assert new_row.locator('[data-derived="T"]').inner_text() == "52.0"
        new_row.locator('[data-delete-score]').click()
        page.wait_for_timeout(150)
        assert page.locator("#auditTableBody tr").count() == 19

        # Auto-fit hides manual width controls until explicitly disabled.
        domain_width_wrapper = page.locator("#np010-domain-width").locator("xpath=ancestor::*[contains(@class,'np010-field')][1]")
        assert domain_width_wrapper.evaluate("el => el.hidden") is True
        set_checkbox(page, "#np010-auto-domain", False)
        assert domain_width_wrapper.evaluate("el => el.hidden") is False
        set_checkbox(page, "#np010-auto-domain", True)
        assert domain_width_wrapper.evaluate("el => el.hidden") is True

        # Text reflow responds in both directions when independent font sizes change.
        long_title = "Cognitive Test Results Summary"
        set_value(page, "#titleInput", long_title, "input")
        set_value(page, "#np012-font-title", "40", "input")
        page.wait_for_timeout(500)
        large_title_lines = page.locator("#chartStage svg .np-title > tspan").count()
        assert large_title_lines >= 2
        set_value(page, "#np012-font-title", "20", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-title > tspan").count() == 0
        assert page.locator("#chartStage svg .np-title").text_content().strip() == long_title

        set_checkbox(page, "#showNotes", True)
        note = (
            "This is a moderately long figure note that should fit on one line when its font is small, "
            "but should wrap when the note font is larger."
        )
        set_value(page, "#notesInput", note, "input")
        set_value(page, "#np012-font-notes", "20", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-note").count() >= 2
        set_value(page, "#np012-font-notes", "9", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-note").count() == 1
        assert page.locator("#chartStage svg .np-note").text_content().strip() == note

        # Domain and column headings also return to one line when smaller text fits.
        set_checkbox(page, "#np010-auto-domain", False)
        set_value(page, "#np010-domain-width", "160", "input")
        set_value(page, "#np012-font-domain", "24", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-domain").nth(3).locator(":scope > tspan").count() >= 2
        set_value(page, "#np012-font-domain", "11", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-domain").nth(3).locator(":scope > tspan").count() == 0

        set_checkbox(page, "#np010-auto-score", False)
        set_value(page, "#np010-score-width", "90", "input")
        set_value(page, "#np012-font-columnHeader", "22", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-column-header").first.locator(":scope > tspan").count() >= 2
        set_value(page, "#np012-font-columnHeader", "10", "input")
        page.wait_for_timeout(500)
        assert page.locator("#chartStage svg .np-column-header").first.locator(":scope > tspan").count() == 0

        # Restore standard title, notes, columns, and typography before release screenshots and exports.
        set_value(page, "#titleInput", "Cognitive Test Results", "input")
        set_value(page, "#np012-font-title", "31", "input")
        set_value(page, "#np012-font-notes", "13", "input")
        set_value(page, "#np012-font-domain", "16.25", "input")
        set_value(page, "#np012-font-columnHeader", "15.5", "input")
        set_checkbox(page, "#np010-auto-domain", True)
        set_checkbox(page, "#np010-auto-score", True)
        set_checkbox(page, "#showNotes", False)
        page.wait_for_timeout(600)

        # The grayscale treatment is a complete palette rather than a separate output switch.
        set_value(page, "#np011-color-preset", "grayscale")
        page.wait_for_timeout(350)
        grayscale_fill = page.locator("#chartStage svg > rect").nth(1).get_attribute("fill")
        assert grayscale_fill and grayscale_fill.lower() in {"#eeeeee", "#e2e2e2", "#f7f7f7", "#d6d6d6"}
        set_value(page, "#np011-color-preset", "clinical")
        page.wait_for_timeout(350)

        # Custom legend layout remains non-overlapping.
        assert_no_overlap(page, "#chartStage svg .np-legend-panel > .np-legend-component")

        # Main application and Appearance previews.
        page.evaluate("window.scrollTo(0, 0)")
        page.screenshot(path=str(PREVIEWS / "NeuroProfile_Preview.png"), full_page=False)
        page.locator("#np012-typography-settings").evaluate("el => el.open = true")
        page.locator("#np011-color-settings").evaluate("el => el.open = true")
        page.screenshot(path=str(PREVIEWS / "NeuroProfile_Appearance.png"), full_page=False)
        page.locator("#np012-typography-settings").evaluate("el => el.open = false")
        page.locator("#np011-color-settings").evaluate("el => el.open = false")

        # Clipboard copy creates a PNG ClipboardItem through the browser API.
        page.locator("#copyFigureButton").click()
        page.wait_for_timeout(1_500)
        assert "copied as a PNG image" in page.locator("#np014-copy-status").inner_text()
        assert page.evaluate("window.__copiedItems?.length") == 1
        assert page.evaluate("window.__copiedItems?.[0]?.types?.includes('image/png')") is True

        # Export the unmarked figure.
        with page.expect_download(timeout=30_000) as download_info:
            page.locator("#downloadSvg").click()
        download_info.value.save_as(PREVIEWS / "NeuroProfile_Example_Output.svg")
        with page.expect_download(timeout=60_000) as download_info:
            page.locator("#downloadPng").click()
        download_info.value.save_as(PREVIEWS / "NeuroProfile_Example_Output.png")

        # Theater Mode opens with a collapsed unified menu and supports all markup tools.
        page.locator("#np011-theater-button").click()
        page.wait_for_selector("#np011-theater-dialog[open]", timeout=10_000)
        page.wait_for_timeout(500)
        assert page.locator("#np014-theater-menu").is_visible()
        assert page.locator("#np014-theater-menu").evaluate("el => el.open") is False
        page.locator("#np014-theater-menu > summary").click()
        assert page.locator("#np014-theater-menu").evaluate("el => el.open") is True
        assert page.locator("#np014-theater-individuals").count() == 1
        assert page.locator("#np014-theater-hover").count() == 1

        # Toggle individual markers in Theater Mode.
        page.locator("#np014-theater-individuals").check()
        page.wait_for_timeout(250)
        assert page.locator("#showIndividuals").is_checked()
        assert page.locator("#chartStage svg .np-test-score").count() > 0

        canvas = page.locator("#np014-markup-canvas")
        box = canvas.bounding_box()
        assert box and box["width"] > 500 and box["height"] > 300

        # Black, blue, and red pen strokes.
        for index, tool in enumerate(("black", "blue", "red")):
            page.locator(f".np014-tool-button[data-tool='{tool}']").click()
            start_x = box["x"] + 120 + index * 40
            start_y = box["y"] + 180 + index * 55
            page.mouse.move(start_x, start_y)
            page.mouse.down()
            page.mouse.move(start_x + 150, start_y + 25, steps=8)
            page.mouse.up()
        assert page.evaluate("window.NeuroProfileMarkupController.state().strokeCount") == 3

        # Eraser adds a non-destructive erase stroke to the redraw history.
        page.locator(".np014-tool-button[data-tool='eraser']").click()
        page.mouse.move(box["x"] + 210, box["y"] + 190)
        page.mouse.down()
        page.mouse.move(box["x"] + 240, box["y"] + 205, steps=5)
        page.mouse.up()
        assert page.evaluate("window.NeuroProfileMarkupController.state().strokeCount") == 4

        # Laser pointer is transient and visible only while selected and positioned.
        page.locator(".np014-tool-button[data-tool='laser']").click()
        page.mouse.move(box["x"] + box["width"] * 0.62, box["y"] + box["height"] * 0.45)
        page.wait_for_timeout(100)
        assert page.locator("#np014-laser-pointer").evaluate("el => el.classList.contains('is-visible')")
        page.screenshot(path=str(PREVIEWS / "NeuroProfile_Theater_Mode.png"), full_page=False)

        page.locator(".np014-theater-actions button").first.click()
        assert page.evaluate("window.NeuroProfileMarkupController.state().strokeCount") == 0
        page.locator(".np014-exit-theater").click()
        page.wait_for_timeout(250)
        assert not page.locator("body").evaluate("el => el.classList.contains('np011-theater-open')")
        assert page.evaluate("window.NeuroProfileMarkupController.state().strokeCount") == 0

        # Equal weighting is enforced at both levels. A legacy Weight column is ignored.
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#clearButton").click()
        page.wait_for_timeout(150)
        page.locator("#np013-text-parser").evaluate("el => el.open = true")
        equal_weight_text = """Domain\tTest\tT-score\tWeight
Processing Speed\tHigh score\t70\t1
Language\tLow one\t30\t100
Language\tLow two\t30\t100
Language\tLow three\t30\t100"""
        parse_table(page, equal_weight_text)
        assert "4 included scores across 2 domains" in page.locator("#np013-parser-summary").inner_text()
        page.locator("#np013-parser-load").click()
        page.wait_for_selector("#chartStage svg", timeout=30_000)
        overall = page.locator("#summaryTableBody tr").first.inner_text()
        assert "50.0" in overall
        assert "Equal-weighted domain averages" in overall
        assert "WEIGHT" not in page.locator(".score-editor-table thead").inner_text().upper()

        # Multiple-assessment parsing remains functional.
        page.locator("#multipleAssessmentsMode").evaluate(
            "el => { el.checked = true; el.dispatchEvent(new Event('change', {bubbles:true})); }"
        )
        page.locator("#addPriorButton").click()
        page.wait_for_timeout(150)
        target_options = page.locator("#np013-parser-target option")
        assert target_options.count() == 2
        prior_id = target_options.nth(1).get_attribute("value")
        prior_text = """| Test | Scaled Score | Percentile |
|---|---:|---:|
| Digit Span | 8 | 25 |
| Boston Naming Test | 11 | 63 |
| Trail Making Test Part B | 7 | 16 |"""
        parse_table(page, prior_text, target=prior_id)
        assert "3 included scores" in page.locator("#np013-parser-summary").inner_text()
        page.locator("#np013-parser-load").click()
        page.wait_for_timeout(300)
        assert page.locator("#chartStage svg .np-assessment-legend-item").count() >= 2

        # Full clear removes all clinical data and pasted text.
        page.once("dialog", lambda dialog: dialog.accept())
        page.locator("#clearButton").click()
        page.wait_for_timeout(150)
        assert page.locator("#np013-parser-input").input_value() == ""
        assert "No profile loaded" in page.locator("#chartStage").inner_text()

        # Output files have substantive dimensions.
        with Image.open(PREVIEWS / "NeuroProfile_Example_Output.png") as image:
            assert image.width >= 1800 and image.height >= 900

        assert console_errors == [], console_errors
        assert page_errors == [], page_errors
        assert network_requests == [], network_requests
        context.close()
        browser.close()

    print(
        json.dumps(
            {
                "status": "passed",
                "version": "0.16",
                "equal_weighting": True,
                "text_reflow": {"title": True, "notes": True, "domain_labels": True, "column_headings": True},
                "clipboard_png": True,
                "theater_markup_tools": ["black", "blue", "red", "eraser", "laser"],
                "multiple_assessment_regression": True,
                "svg_export": True,
                "png_export": True,
                "console_errors": 0,
                "page_errors": 0,
                "application_network_requests": 0,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
