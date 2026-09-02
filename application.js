(() => {
  'use strict';

  const VERSION = '0.16';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TOOL_COLORS = Object.freeze({ black: '#111111', blue: '#1261a0', red: '#c62828' });

  const markup = {
    tool: 'pointer', size: 4, strokes: [], activeStroke: null,
    canvas: null, context: null, laser: null, menu: null,
    pixelRatio: 1, width: 0, height: 0,
  };

  let copyStatus = null;
  let reflowScheduled = false;
  let reflowing = false;

  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function largestFigureSvg() {
    return qa('#chartStage svg, .chart-stage svg')
      .map((svg) => {
        const values = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        return { svg, area: values.length === 4 && values.every(Number.isFinite) ? values[2] * values[3] : 0 };
      })
      .sort((a, b) => b.area - a.area)[0]?.svg || null;
  }

  function createDetails(id, label, open = false) {
    const details = document.createElement('details');
    details.id = id;
    details.className = 'np014-layout-section';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = label;
    const body = document.createElement('div');
    body.className = 'np014-layout-body';
    details.append(summary, body);
    return { details, body };
  }

  function sectionNumber(card, value) {
    const number = q('.section-number', card);
    if (number) number.textContent = String(value);
  }

  function consolidateSidebar() {
    const heading = document.getElementById('displayHeading');
    const layoutCard = heading?.closest('.card');
    const exportCard = document.getElementById('exportHeading')?.closest('.card');
    if (!heading || !layoutCard || !exportCard || layoutCard.dataset.np014Ready === 'true') return;
    layoutCard.dataset.np014Ready = 'true';
    heading.textContent = 'Layout';
    sectionNumber(layoutCard, 2);

    const compat = document.createElement('div');
    compat.id = 'np014-compat-controls';
    compat.hidden = true;
    layoutCard.appendChild(compat);

    const aggregation = document.getElementById('profileAggregation');
    if (aggregation) {
      aggregation.value = 'equal-domains';
      aggregation.dispatchEvent(new Event('change', { bubbles: true }));
      compat.appendChild(aggregation);
    }
    q('.profile-aggregation-field', layoutCard)?.remove();

    const grayscale = document.getElementById('grayscale');
    if (grayscale) {
      grayscale.checked = false;
      grayscale.dispatchEvent(new Event('change', { bubbles: true }));
      compat.appendChild(grayscale);
    }
    q('.final-toggle-group', layoutCard)?.remove();
    q('.font-control', layoutCard)?.remove();

    const content = createDetails('np014-layout-content', 'Figure content', false);
    q(':scope > .section-heading', layoutCard)?.insertAdjacentElement('afterend', content.details);
    [
      q('.display-title-field', layoutCard),
      document.getElementById('showSubtitle')?.closest('.toggle-list'),
      document.getElementById('subtitleInput')?.closest('.display-copy-field, .field-group'),
      q('.display-toggle-group', layoutCard),
      document.getElementById('longitudinalDisplayControls'),
      document.getElementById('notesInput')?.closest('.display-copy-field, .field-group'),
    ].forEach((node) => { if (node) content.body.appendChild(node); });

    const axis = document.getElementById('np010-settings');
    if (axis) {
      const summary = q(':scope > summary', axis);
      if (summary) summary.textContent = 'Axis and columns';
      layoutCard.appendChild(axis);
    }

    const appearance = document.createElement('section');
    appearance.id = 'np014-appearance-card';
    appearance.className = 'card np014-appearance-card';
    appearance.setAttribute('aria-labelledby', 'np014-appearance-heading');
    appearance.innerHTML = '<div class="section-heading"><div class="heading-group"><span class="section-number" aria-hidden="true">3</span><h2 id="np014-appearance-heading">Appearance</h2></div></div>';
    layoutCard.insertAdjacentElement('afterend', appearance);

    const font = document.getElementById('np012-typography-settings');
    const colors = document.getElementById('np011-color-settings');
    const saved = document.getElementById('np012-saved-settings');
    if (font) {
      q(':scope > summary', font).textContent = 'Font';
      appearance.appendChild(font);
    }
    if (colors) {
      q(':scope > summary', colors).textContent = 'Colors';
      appearance.appendChild(colors);
    }
    if (saved) appearance.appendChild(saved);
    sectionNumber(exportCard, 4);
  }

  function copyIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
  }

  function setCopyStatus(message, type = '') {
    if (!copyStatus) return;
    copyStatus.textContent = message;
    copyStatus.classList.toggle('is-success', type === 'success');
    copyStatus.classList.toggle('is-error', type === 'error');
  }

  function exportableSvgClone(svg) {
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.removeAttribute('tabindex');
    clone.querySelectorAll('title').forEach((node) => node.remove());
    clone.querySelectorAll('[data-tooltip]').forEach((node) => node.removeAttribute('data-tooltip'));
    clone.querySelectorAll('[tabindex],[focusable]').forEach((node) => {
      node.removeAttribute('tabindex');
      node.removeAttribute('focusable');
    });
    clone.querySelectorAll('.np-tooltip-target').forEach((node) => {
      const fill = String(node.getAttribute('fill') || '').toLowerCase();
      const stroke = String(node.getAttribute('stroke') || '').toLowerCase();
      const opacity = finite(node.getAttribute('opacity'), 1);
      if ((fill === 'transparent' || fill === 'none' || opacity === 0) && (stroke === 'transparent' || stroke === 'none' || !stroke)) node.remove();
    });
    return clone;
  }

  async function svgToPngBlob(svg, scale = 2) {
    const view = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (view.length !== 4 || !view.every(Number.isFinite) || view[2] <= 0 || view[3] <= 0) throw new Error('The figure dimensions could not be determined.');
    const clone = exportableSvgClone(svg);
    clone.setAttribute('width', String(view[2]));
    clone.setAttribute('height', String(view[3]));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The browser could not render the figure image.'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(view[2] * scale));
      canvas.height = Math.max(1, Math.round(view[3] * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('The browser could not create an image surface.');
      context.fillStyle = window.NeuroProfileColorController?.colors?.().figureBackground || '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The image could not be created.')), 'image/png', 1));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function copyFigure(button) {
    const svg = largestFigureSvg();
    if (!svg) return setCopyStatus('Load a profile before copying the figure.', 'error');
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return setCopyStatus('Image clipboard access is unavailable in this browser. Use Download PNG.', 'error');
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Copying…';
    setCopyStatus('');
    try {
      const png = await svgToPngBlob(svg, 2);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setCopyStatus('Figure copied as a PNG image.', 'success');
    } catch (error) {
      setCopyStatus(error?.message || 'The figure could not be copied.', 'error');
    } finally {
      button.innerHTML = original;
      button.disabled = !largestFigureSvg();
    }
  }

  function buildCopyButton() {
    if (document.getElementById('copyFigureButton')) return;
    const card = document.getElementById('exportHeading')?.closest('.card');
    const row = q('.button-row', card);
    if (!row) return;
    const button = document.createElement('button');
    button.id = 'copyFigureButton';
    button.type = 'button';
    button.className = 'btn btn-primary';
    button.disabled = !largestFigureSvg();
    button.innerHTML = `${copyIcon()}<span>Copy to Clipboard</span>`;
    button.addEventListener('click', () => copyFigure(button));
    row.appendChild(button);
    copyStatus = document.createElement('p');
    copyStatus.id = 'np014-copy-status';
    copyStatus.className = 'np014-copy-status';
    copyStatus.setAttribute('role', 'status');
    copyStatus.setAttribute('aria-live', 'polite');
    row.insertAdjacentElement('afterend', copyStatus);
    const stage = document.getElementById('chartStage');
    if (stage) new MutationObserver(() => {
      button.disabled = !largestFigureSvg();
      if (!largestFigureSvg()) setCopyStatus('');
    }).observe(stage, { childList: true, subtree: false });
  }

  function menuIcon() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="8" cy="7" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="10" cy="17" r="1.7" fill="currentColor" stroke="none"/></svg>';
  }

  function theaterToggle(id, labelText, sourceId) {
    const label = document.createElement('label');
    label.className = 'np014-theater-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    const source = document.getElementById(sourceId);
    input.checked = Boolean(source?.checked);
    input.addEventListener('change', () => {
      if (!source) return;
      source.checked = input.checked;
      source.dispatchEvent(new Event('change', { bubbles: true }));
    });
    source?.addEventListener('change', () => { input.checked = source.checked; });
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(input, text);
    return label;
  }

  function toolButton(tool, label, color = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'np014-tool-button';
    button.dataset.tool = tool;
    button.setAttribute('aria-pressed', tool === markup.tool ? 'true' : 'false');
    button.innerHTML = color ? `<span class="np014-tool-swatch" style="--swatch:${color}" aria-hidden="true"></span><span>${label}</span>` : `<span>${label}</span>`;
    button.addEventListener('click', () => setMarkupTool(tool));
    return button;
  }

  function buildTheaterMenu() {
    const card = q('.preview-card');
    if (!card || document.getElementById('np014-theater-menu')) return;
    q('#np012-theater-controls')?.remove();

    const details = document.createElement('details');
    details.id = 'np014-theater-menu';
    details.className = 'np014-theater-menu';
    details.open = false;
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', 'Theater tools');
    summary.innerHTML = menuIcon();
    const panel = document.createElement('div');
    panel.className = 'np014-theater-panel';

    const display = document.createElement('fieldset');
    const displayLegend = document.createElement('legend');
    displayLegend.textContent = 'Figure controls';
    const toggles = document.createElement('div');
    toggles.className = 'np014-theater-toggles';
    toggles.append(theaterToggle('np014-theater-individuals', 'Test scores', 'showIndividuals'), theaterToggle('np014-theater-hover', 'Hover details', 'np012-hover-bubbles'));
    display.append(displayLegend, toggles);

    const tools = document.createElement('fieldset');
    const toolsLegend = document.createElement('legend');
    toolsLegend.textContent = 'Markup';
    const grid = document.createElement('div');
    grid.className = 'np014-tool-grid';
    grid.append(
      toolButton('pointer', 'Pointer'), toolButton('black', 'Black', TOOL_COLORS.black), toolButton('blue', 'Blue', TOOL_COLORS.blue),
      toolButton('red', 'Red', TOOL_COLORS.red), toolButton('eraser', 'Eraser'), toolButton('laser', 'Laser', '#e00016')
    );
    const size = document.createElement('label');
    size.className = 'np014-markup-size';
    size.innerHTML = '<span>Stroke size</span>';
    const input = document.createElement('input');
    input.id = 'np014-markup-size';
    input.type = 'range';
    input.min = '1'; input.max = '14'; input.step = '1'; input.value = String(markup.size);
    const output = document.createElement('output');
    output.htmlFor = input.id;
    output.textContent = `${markup.size}px`;
    input.addEventListener('input', () => {
      markup.size = clamp(finite(input.value, 4), 1, 14);
      output.textContent = `${markup.size}px`;
    });
    size.append(input, output);
    tools.append(toolsLegend, grid, size);

    const actions = document.createElement('div');
    actions.className = 'np014-theater-actions';
    const clear = document.createElement('button');
    clear.type = 'button'; clear.className = 'btn'; clear.textContent = 'Clear all'; clear.addEventListener('click', clearMarkup);
    const exit = document.createElement('button');
    exit.type = 'button'; exit.className = 'btn np014-exit-theater'; exit.textContent = 'Exit Theater Mode';
    exit.addEventListener('click', () => window.NeuroProfileTheaterController?.close?.());
    actions.append(clear, exit);
    panel.append(display, tools, actions);
    details.append(summary, panel);
    card.appendChild(details);
    markup.menu = details;
    buildMarkupOverlay(card);
  }

  function buildMarkupOverlay(card) {
    if (document.getElementById('np014-markup-canvas')) return;
    const canvas = document.createElement('canvas');
    canvas.id = 'np014-markup-canvas';
    canvas.className = 'np014-markup-canvas';
    canvas.dataset.tool = markup.tool;
    canvas.setAttribute('aria-label', 'Theater markup drawing surface');
    const laser = document.createElement('div');
    laser.id = 'np014-laser-pointer';
    laser.className = 'np014-laser-pointer';
    laser.setAttribute('aria-hidden', 'true');
    card.append(canvas, laser);
    markup.canvas = canvas;
    markup.context = canvas.getContext('2d');
    markup.laser = laser;

    canvas.addEventListener('pointerdown', beginStroke);
    canvas.addEventListener('pointermove', continueStroke);
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', (event) => {
      if (markup.tool === 'laser') hideLaser();
      if (markup.activeStroke && event.buttons === 0) endStroke(event);
    });

    const stage = document.getElementById('chartStage');
    if (stage) new MutationObserver(syncMarkupGeometry).observe(stage, { childList: true, subtree: false });
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(syncMarkupGeometry);
      observer.observe(card);
      if (stage) observer.observe(stage);
    }
    window.addEventListener('resize', syncMarkupGeometry, { passive: true });
    window.addEventListener('scroll', syncMarkupGeometry, { passive: true, capture: true });
  }

  function currentSvgRect() {
    const svg = largestFigureSvg();
    const card = q('.preview-card');
    if (!svg || !card) return null;
    const svgRect = svg.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    if (svgRect.width <= 0 || svgRect.height <= 0) return null;
    return { left: svgRect.left - cardRect.left + card.scrollLeft, top: svgRect.top - cardRect.top + card.scrollTop, width: svgRect.width, height: svgRect.height };
  }

  function syncMarkupGeometry() {
    if (!markup.canvas) return;
    const geometry = currentSvgRect();
    if (!geometry) {
      markup.canvas.style.display = 'none';
      hideLaser();
      return;
    }
    markup.canvas.style.display = '';
    markup.width = geometry.width;
    markup.height = geometry.height;
    markup.pixelRatio = Math.max(1, window.devicePixelRatio || 1);
    Object.assign(markup.canvas.style, { left: `${geometry.left}px`, top: `${geometry.top}px`, width: `${geometry.width}px`, height: `${geometry.height}px` });
    markup.canvas.width = Math.max(1, Math.round(geometry.width * markup.pixelRatio));
    markup.canvas.height = Math.max(1, Math.round(geometry.height * markup.pixelRatio));
    markup.context = markup.canvas.getContext('2d');
    redrawMarkup();
  }

  function point(event) {
    const rect = markup.canvas.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1), y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1) };
  }

  function setMarkupTool(tool) {
    markup.tool = new Set(['pointer','black','blue','red','eraser','laser']).has(tool) ? tool : 'pointer';
    if (markup.canvas) markup.canvas.dataset.tool = markup.tool;
    qa('.np014-tool-button').forEach((button) => button.setAttribute('aria-pressed', button.dataset.tool === markup.tool ? 'true' : 'false'));
    markup.activeStroke = null;
    if (markup.tool !== 'laser') hideLaser();
  }

  function beginStroke(event) {
    if (markup.tool === 'pointer') return;
    if (markup.tool === 'laser') return positionLaser(event);
    event.preventDefault();
    markup.canvas.setPointerCapture?.(event.pointerId);
    markup.activeStroke = { tool: markup.tool, color: TOOL_COLORS[markup.tool] || '#111111', size: markup.size, points: [point(event)] };
    redrawMarkup();
  }

  function continueStroke(event) {
    if (markup.tool === 'laser') return positionLaser(event);
    if (!markup.activeStroke) return;
    event.preventDefault();
    const next = point(event);
    const previous = markup.activeStroke.points.at(-1);
    const dx = next.x - previous.x, dy = next.y - previous.y;
    if (dx * dx + dy * dy < 0.000002) return;
    markup.activeStroke.points.push(next);
    redrawMarkup();
  }

  function endStroke(event) {
    if (!markup.activeStroke) return;
    event?.preventDefault?.();
    if (markup.activeStroke.points.length === 1) markup.activeStroke.points.push({ ...markup.activeStroke.points[0] });
    markup.strokes.push(markup.activeStroke);
    markup.activeStroke = null;
    redrawMarkup();
  }

  function drawStroke(context, stroke) {
    if (!stroke?.points?.length) return;
    const scale = markup.pixelRatio;
    context.save();
    context.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = stroke.color || '#111111';
    context.lineWidth = Math.max(1, stroke.size * scale);
    context.lineCap = 'round'; context.lineJoin = 'round';
    context.beginPath();
    stroke.points.forEach((p, index) => {
      const x = p.x * markup.width * scale, y = p.y * markup.height * scale;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
    context.restore();
  }

  function redrawMarkup() {
    if (!markup.context || !markup.canvas) return;
    markup.context.clearRect(0, 0, markup.canvas.width, markup.canvas.height);
    markup.strokes.forEach((stroke) => drawStroke(markup.context, stroke));
    if (markup.activeStroke) drawStroke(markup.context, markup.activeStroke);
  }

  function clearMarkup() {
    markup.strokes = [];
    markup.activeStroke = null;
    redrawMarkup();
    hideLaser();
  }

  function positionLaser(event) {
    if (!markup.laser || !markup.canvas) return;
    const card = q('.preview-card');
    const cardRect = card?.getBoundingClientRect();
    if (!card || !cardRect) return;
    markup.laser.style.left = `${event.clientX - cardRect.left + card.scrollLeft}px`;
    markup.laser.style.top = `${event.clientY - cardRect.top + card.scrollTop}px`;
    markup.laser.classList.add('is-visible');
  }

  function hideLaser() { markup.laser?.classList.remove('is-visible'); }

  function monitorTheater() {
    new MutationObserver(() => {
      const active = document.body.classList.contains('np011-theater-open');
      if (active) {
        if (markup.menu) markup.menu.open = false;
        setMarkupTool('pointer');
        requestAnimationFrame(() => {
          syncMarkupGeometry();
          q('#np014-theater-menu > summary')?.focus();
        });
      } else {
        clearMarkup();
        if (markup.menu) markup.menu.open = false;
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  function fontOf(element) {
    const computed = getComputedStyle(element);
    return { size: finite(computed.fontSize, finite(element.getAttribute('font-size'), 14)), family: computed.fontFamily || 'Arial, sans-serif', weight: computed.fontWeight || '700' };
  }

  function measure(value, font) {
    const canvas = measure.canvas || (measure.canvas = document.createElement('canvas'));
    const context = canvas.getContext('2d');
    context.font = `${font.weight} ${font.size}px ${font.family}`;
    return context.measureText(value).width;
  }

  function fullText(element) {
    if (element.dataset.np014FullText) return element.dataset.np014FullText;
    const spans = qa(':scope > tspan', element);
    const value = (spans.length ? spans.map((span) => span.textContent.trim()).join(' ') : element.textContent.trim()).replace(/\s+/g, ' ');
    element.dataset.np014FullText = value;
    return value;
  }

  function wrap(value, width, font, maxLines = 2) {
    const clean = String(value || '').trim().replace(/\s+/g, ' ');
    if (!clean || measure(clean, font) <= width) return [clean];
    const words = clean.split(' ');
    const lines = [];
    let current = '';
    while (words.length) {
      const word = words.shift();
      const candidate = current ? `${current} ${word}` : word;
      if (!current || measure(candidate, font) <= width) current = candidate;
      else {
        lines.push(current);
        current = word;
        if (lines.length >= maxLines - 1) break;
      }
    }
    if (current) lines.push([current, ...words].join(' '));
    return lines.slice(0, maxLines);
  }


  function findBands(svg) {
    const view = String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const groups = new Map();
    qa('rect', svg).map((element) => ({
      element,
      x: finite(element.getAttribute('x')),
      y: finite(element.getAttribute('y')),
      width: finite(element.getAttribute('width')),
      height: finite(element.getAttribute('height')),
    }))
      .filter((r) => r.x > view[2] * .08 && r.y > 35 && r.width > 12 && r.height > view[3] * .2 && r.height < view[3] * .9)
      .forEach((r) => {
        const key = `${Math.round(r.y)}:${Math.round(r.height)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      });
    return [...groups.values()]
      .filter((group) => group.length >= 4)
      .map((group) => group.sort((a, b) => a.x - b.x).slice(0, 4))
      .sort((a, b) => (b[3].x + b[3].width - b[0].x) - (a[3].x + a[3].width - a[0].x))[0] || [];
  }

  function reflowElement(element, maxWidth, mode = 'center', maxLines = 2) {
    if (!element || !(maxWidth > 20)) return;
    const text = fullText(element);
    const font = fontOf(element);
    const existing = qa(':scope > tspan', element);
    const existingGap = existing.length > 1 ? finite(existing[1].getAttribute('dy'), font.size * 1.12) : font.size * 1.12;
    const originalY = finite(element.getAttribute('y'));
    let reference;
    if (mode === 'bottom') {
      reference = element.dataset.np014Reference || originalY + Math.max(0, existing.length - 1) * existingGap;
    } else {
      reference = element.dataset.np014Reference || originalY + Math.max(0, existing.length - 1) * existingGap / 2;
    }
    element.dataset.np014Reference = String(reference);
    const lines = wrap(text, maxWidth, font, maxLines);
    const gap = font.size * (mode === 'title' ? 1.12 : 1.08);
    if (lines.length <= 1) {
      element.replaceChildren();
      element.textContent = lines[0] || '';
      element.setAttribute('y', String(finite(reference)));
      return;
    }
    const x = finite(element.getAttribute('x'));
    element.replaceChildren();
    const firstY = mode === 'bottom'
      ? finite(reference) - gap * (lines.length - 1)
      : finite(reference) - gap * (lines.length - 1) / 2;
    element.setAttribute('y', String(firstY));
    lines.forEach((line, index) => {
      const span = document.createElementNS(SVG_NS, 'tspan');
      span.setAttribute('x', String(x));
      span.setAttribute('dy', index === 0 ? '0' : String(gap));
      span.textContent = line;
      element.appendChild(span);
    });
  }

  function wrapParagraphs(value, width, font) {
    const paragraphs = String(value || '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    paragraphs.forEach((paragraph, index) => {
      const clean = paragraph.trim().replace(/\s+/g, ' ');
      if (clean) lines.push(...wrap(clean, width, font, Infinity));
      else if (index > 0 && index < paragraphs.length - 1) lines.push('');
    });
    return lines;
  }

  function setFigureHeight(svg, height) {
    const raw = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (raw.length !== 4 || !raw.every(Number.isFinite) || !(height > 0)) return;
    const nextHeight = Math.max(1, Math.ceil(height));
    svg.setAttribute('viewBox', `${raw[0]} ${raw[1]} ${raw[2]} ${nextHeight}`);
    if (/^\d/.test(svg.getAttribute('height') || '')) svg.setAttribute('height', String(nextHeight));

    const directRects = [...svg.children].filter((node) => node.tagName?.toLowerCase() === 'rect');
    const background = directRects.find((rect) => !rect.classList.contains('np-figure-border')
      && finite(rect.getAttribute('x')) <= raw[0]
      && finite(rect.getAttribute('y')) <= raw[1]
      && finite(rect.getAttribute('width')) >= raw[2] - 1);
    if (background) background.setAttribute('height', String(nextHeight));

    const border = q('.np-figure-border', svg);
    if (border) {
      const y = finite(border.getAttribute('y'), 1.5);
      border.setAttribute('height', String(Math.max(1, nextHeight - 2 * y)));
    }
  }

  function nonNoteContentBottom(svg) {
    let bottom = 0;
    [...svg.children].forEach((element) => {
      if (element.classList?.contains('np-note') || element.classList?.contains('np-figure-border')) return;
      if (element.tagName?.toLowerCase() === 'rect') {
        const x = finite(element.getAttribute('x'));
        const y = finite(element.getAttribute('y'));
        const width = finite(element.getAttribute('width'));
        const view = String(svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
        if (view.length === 4 && x <= view[0] && y <= view[1] && width >= view[2] - 1) return;
      }
      try {
        const box = element.getBBox();
        if (Number.isFinite(box.y + box.height)) bottom = Math.max(bottom, box.y + box.height);
      } catch { /* ignore elements without a measurable box */ }
    });
    return bottom;
  }

  function reflowNotes(svg, view) {
    const noteElements = qa(':scope > .np-note', svg);
    if (!noteElements.length) return;
    const noteText = document.getElementById('notesInput')?.value || noteElements.map((element) => element.textContent).join(' ');
    const template = noteElements[0];
    const parent = template.parentNode;
    const insertBefore = noteElements.at(-1).nextSibling;
    const x = finite(template.getAttribute('x'), 24);
    const font = fontOf(template);
    const width = Math.max(80, view[0] + view[2] - x - 24);
    const lines = wrapParagraphs(noteText, width, font);
    const baseHeight = Math.ceil(nonNoteContentBottom(svg) + 22);
    const lineHeight = Math.max(font.size * 1.42, font.size + 4);
    const firstBaseline = baseHeight + Math.max(5, font.size * .4);

    noteElements.forEach((element) => element.remove());
    let lastBottom = baseHeight;
    lines.forEach((line, index) => {
      const element = template.cloneNode(false);
      element.removeAttribute('data-np014-full-text');
      element.setAttribute('x', String(x));
      element.setAttribute('y', String(firstBaseline + index * lineHeight));
      element.textContent = line;
      parent.insertBefore(element, insertBefore);
      try {
        const box = element.getBBox();
        lastBottom = Math.max(lastBottom, box.y + box.height);
      } catch { /* use the calculated baseline below */ }
    });

    if (!lines.length) {
      setFigureHeight(svg, baseHeight);
      return;
    }
    const calculatedBottom = firstBaseline + (lines.length - 1) * lineHeight + font.size * .35;
    const bottomPadding = Math.max(18, font.size * 1.45);
    setFigureHeight(svg, Math.max(lastBottom, calculatedBottom) + bottomPadding);
  }

  function normalizeWrapping(svg = largestFigureSvg()) {
    if (!svg || reflowing) return;
    reflowing = true;
    try {
      const view = String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      if (view.length !== 4 || !view.every(Number.isFinite)) return;
      const bands = findBands(svg);
      const plotStart = bands[0]?.x;
      const plotEnd = bands.length ? bands[3].x + bands[3].width : null;

      const legend = q('.np-legend-panel', svg);
      let titleRight = view[0] + view[2] - 20;
      if (legend) {
        try { titleRight = legend.getBBox().x - 18; } catch { /* retain viewbox boundary */ }
      }
      const title = q('.np-title', svg);
      const subtitle = q('.np-subtitle', svg);
      if (title) {
        title.dataset.np014FullText = String(document.getElementById('titleInput')?.value || fullText(title)).trim();
        reflowElement(title, Math.max(150, titleRight - finite(title.getAttribute('x'))), 'title', 2);
      }
      if (subtitle) {
        subtitle.dataset.np014FullText = String(document.getElementById('subtitleInput')?.value || fullText(subtitle)).trim();
        reflowElement(subtitle, Math.max(150, titleRight - finite(subtitle.getAttribute('x'))), 'center', 2);
      }

      if (Number.isFinite(plotStart)) {
        qa('.np-domain', svg).forEach((element) => {
          reflowElement(element, Math.max(40, plotStart - finite(element.getAttribute('x')) - 12), 'center', 2);
        });
      }

      qa('.np-column-header', svg).forEach((element) => {
        const x = finite(element.getAttribute('x'));
        const anchor = element.getAttribute('text-anchor') || 'start';
        let width;
        if (anchor === 'end' && Number.isFinite(plotEnd)) width = x - plotEnd - 12;
        else if (anchor === 'middle' && Number.isFinite(plotEnd)) width = 2 * Math.min(x - plotEnd - 8, view[0] + view[2] - x - 18);
        else width = view[0] + view[2] - x - 18;
        reflowElement(element, Math.max(55, width), 'bottom', 2);
      });

      reflowNotes(svg, view);
    } finally {
      reflowing = false;
    }
  }

  function scheduleReflow() {
    if (reflowScheduled) return;
    reflowScheduled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reflowScheduled = false;
      normalizeWrapping();
      syncMarkupGeometry();
    }));
  }

  function installReflow() {
    const stage = document.getElementById('chartStage');
    if (stage) new MutationObserver(scheduleReflow).observe(stage, { childList: true, subtree: false });
    qa('#np012-typography-settings input, #np012-font-family, #np010-settings input, #np010-settings select').forEach((control) => {
      control.addEventListener('input', scheduleReflow);
      control.addEventListener('change', scheduleReflow);
    });
    scheduleReflow();
  }

  function init() {
    consolidateSidebar();
    buildCopyButton();
    buildTheaterMenu();
    monitorTheater();
    installReflow();
    document.documentElement.dataset.neuroprofileVersion = VERSION;
  }

  window.NeuroProfileMarkupController = Object.freeze({ clear: clearMarkup, setTool: setMarkupTool, state: () => ({ tool: markup.tool, size: markup.size, strokeCount: markup.strokes.length }) });
  window.NeuroProfileClipboardController = Object.freeze({ copy: () => {
    const button = document.getElementById('copyFigureButton');
    return button ? copyFigure(button) : Promise.reject(new Error('Copy control is unavailable.'));
  }});
  window.NeuroProfileTextReflowController = Object.freeze({ apply: normalizeWrapping, schedule: scheduleReflow });

  const start = () => requestAnimationFrame(init);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

// 0.16: floating non-Theater copy control is implemented in the standalone release.
