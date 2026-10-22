// Небольшие SVG-графики: линии (с разрывами) и столбцы, с подсказкой при наведении.
// Цвета серий берутся из CSS-переменных --s1…--s8 (см. style.css).
(function () {
  const PAD = { t: 16, r: 16, b: 40, l: 44 };
  // Рисуем в реальную ширину контейнера, чтобы подписи не уменьшались вместе с графиком.
  const widthOf = host => Math.max(280, Math.round(host.clientWidth || 760));
  const esc = U.esc;

  function tooltip(host) {
    let tip = U.$('.chart-tip', host);
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'chart-tip';
      tip.hidden = true;
      host.appendChild(tip);
    }
    return tip;
  }

  function placeTip(host, tip, evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const box = host.getBoundingClientRect();
    const x = evt.clientX - box.left, y = evt.clientY - box.top;
    tip.style.left = Math.min(box.width - tip.offsetWidth - 4, x + 12) + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 8) + 'px';
  }

  function yTicks(max) {
    const step = max <= 5 ? 1 : Math.ceil(max / 4 / Math.pow(10, Math.floor(Math.log10(max / 4)))) * Math.pow(10, Math.floor(Math.log10(max / 4)));
    const ticks = [];
    for (let v = 0; v <= max + 1e-9; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
    return ticks;
  }

  /**
   * opts: { labels, series: [{ name, color, values (null = разрыв) }], yMax?, yFormat?, height?,
   *         labelEvery?, hollowZero?, unit? }
   */
  function line(host, opts) {
    const W = widthOf(host);
    const H = opts.height || 260;
    const n = opts.labels.length;
    const all = opts.series.flatMap(s => s.values).filter(v => v != null);
    const max = opts.yMax || Math.max(1, ...all);
    const ticks = opts.yMax ? [0, 25, 50, 75, 100].filter(t => t <= opts.yMax) : yTicks(max);
    const top = ticks[ticks.length - 1];
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const x = i => PAD.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = v => PAD.t + ih - (v / top) * ih;
    const fmt = opts.yFormat || (v => U.fmtNum(v));
    const every = opts.labelEvery || Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 70))));

    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title || '')}">`;
    for (const t of ticks) {
      svg += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${PAD.l - 8}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`;
    }
    opts.labels.forEach((l, i) => {
      if (i % every === 0 || i === n - 1) svg += `<text class="axis" x="${x(i)}" y="${H - PAD.b + 18}" text-anchor="middle">${esc(l)}</text>`;
    });
    opts.series.forEach(s => {
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      svg += `<path d="${d}" class="series-line" style="stroke:${s.color}"/>`;
      s.values.forEach((v, i) => {
        if (v == null) return;
        const hollow = opts.hollowZero && v === 0;
        svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" class="dot ${hollow ? 'hollow' : ''}" style="${hollow ? 'stroke' : 'fill'}:${s.color}"/>`;
      });
    });
    svg += `<line class="crosshair" x1="0" x2="0" y1="${PAD.t}" y2="${PAD.t + ih}" visibility="hidden"/>`;
    const colW = n > 1 ? iw / (n - 1) : iw;
    opts.labels.forEach((_, i) => {
      svg += `<rect class="hit" data-i="${i}" x="${x(i) - colW / 2}" y="${PAD.t}" width="${colW}" height="${ih}"/>`;
    });
    svg += '</svg>';
    host.innerHTML = `<div class="chart-box">${svg}</div>`;
    const box = U.$('.chart-box', host);
    const tip = tooltip(box);
    const cross = U.$('.crosshair', box);
    U.$$('.hit', box).forEach(r => {
      r.addEventListener('mousemove', e => {
        const i = +r.dataset.i;
        cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
        const rows = opts.series.map(s => `<div><i style="background:${s.color}"></i>${esc(s.name)}: <b>${s.values[i] == null ? 'мало данных' : fmt(s.values[i]) + (opts.unit || '')}</b></div>`).join('');
        placeTip(box, tip, e, `<div class="tip-h">${esc(opts.tipLabels ? opts.tipLabels[i] : opts.labels[i])}</div>${rows}`);
      });
      r.addEventListener('mouseleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    });
  }

  // opts: { labels, values, color, height? }
  function bar(host, opts) {
    const W = widthOf(host);
    const H = opts.height || 240;
    const n = opts.labels.length;
    const ticks = yTicks(Math.max(1, ...opts.values));
    const top = ticks[ticks.length - 1];
    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const slot = iw / n, bw = Math.min(90, slot * 0.6);
    const y = v => PAD.t + ih - (v / top) * ih;
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(opts.title || '')}">`;
    for (const t of ticks) {
      svg += `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(t)}" y2="${y(t)}"/>
        <text class="axis" x="${PAD.l - 8}" y="${y(t) + 4}" text-anchor="end">${U.fmtNum(t)}</text>`;
    }
    opts.values.forEach((v, i) => {
      const cx = PAD.l + slot * i + slot / 2;
      const h = Math.max(0, PAD.t + ih - y(v));
      const r = Math.min(4, h);
      // Скругление только у верхнего края, основание — на оси.
      const x0 = cx - bw / 2, y0 = PAD.t + ih - h;
      svg += h > 0 ? `<path class="bar" data-i="${i}" style="fill:${opts.color}" d="M${x0},${PAD.t + ih}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + bw - r}Q${x0 + bw},${y0} ${x0 + bw},${y0 + r}V${PAD.t + ih}Z"/>` : '';
      svg += `<text class="val" x="${cx}" y="${y0 - 6}" text-anchor="middle">${U.fmtNum(v)}</text>
        <text class="axis" x="${cx}" y="${H - PAD.b + 18}" text-anchor="middle">${esc(opts.labels[i])}</text>
        <rect class="hit" data-i="${i}" x="${cx - slot / 2}" y="${PAD.t}" width="${slot}" height="${ih}"/>`;
    });
    svg += `<line class="baseline" x1="${PAD.l}" x2="${W - PAD.r}" y1="${PAD.t + ih}" y2="${PAD.t + ih}"/></svg>`;
    host.innerHTML = `<div class="chart-box">${svg}</div>`;
    const box = U.$('.chart-box', host);
    const tip = tooltip(box);
    U.$$('.hit', box).forEach(r => {
      r.addEventListener('mousemove', e => {
        const i = +r.dataset.i;
        placeTip(box, tip, e, `<div class="tip-h">${esc(opts.labels[i])}</div><div>${esc(opts.valueName || 'Значение')}: <b>${U.fmtNum(opts.values[i])}</b></div>`);
      });
      r.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }

  const color = i => `var(--s${(i % 8) + 1})`;

  window.Charts = { line, bar, color };
})();
