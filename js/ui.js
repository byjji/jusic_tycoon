// DOM UI: 종목 검색/선택, 기간 선택, 미니 차트, 계기판 HUD, 오버레이, 결과 화면
export class UI {
  constructor({ tickers, periods, onChange, onStart, onRetry, onBack }) {
    this.tickers = tickers;
    this.periods = periods;
    this.onChange = onChange;
    this.tickerId = tickers[0].id;
    this.periodKey = periods[0].key;

    this.$ = id => document.getElementById(id);
    this._danger = false;
    this._rush = false;

    // 종목 칩
    const chips = this.$('chips');
    for (const t of tickers) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = t.name;
      b.dataset.id = t.id;
      b.addEventListener('click', () => this.select(t.id));
      chips.appendChild(b);
    }

    // 기간 버튼
    const periodsEl = this.$('periods');
    for (const p of periods) {
      const b = document.createElement('button');
      b.className = 'period';
      b.dataset.key = p.key;
      b.innerHTML = `<div class="p-name">${p.name}</div><div class="p-desc">${p.desc}</div>`;
      b.addEventListener('click', () => this.selectPeriod(p.key));
      periodsEl.appendChild(b);
    }

    // 검색
    const search = this.$('search');
    const suggest = this.$('suggest');
    const renderSuggest = q => {
      const list = this.tickers.filter(t =>
        !q || t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q));
      suggest.innerHTML = '';
      for (const t of list) {
        const li = document.createElement('li');
        li.innerHTML = `${t.name}<small>${t.code}</small>`;
        li.addEventListener('mousedown', e => { e.preventDefault(); this.select(t.id); suggest.classList.add('hidden'); });
        suggest.appendChild(li);
      }
      suggest.classList.toggle('hidden', list.length === 0);
      return list;
    };
    search.addEventListener('input', () => renderSuggest(search.value.trim().toLowerCase()));
    search.addEventListener('focus', () => { search.select(); renderSuggest(''); });
    search.addEventListener('blur', () => setTimeout(() => suggest.classList.add('hidden'), 120));
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const list = renderSuggest(search.value.trim().toLowerCase());
        if (list.length > 0) this.select(list[0].id);
        suggest.classList.add('hidden');
        search.blur();
      }
    });

    this.$('start').addEventListener('click', onStart);
    this.$('retry').addEventListener('click', onRetry);
    this.$('back').addEventListener('click', onBack);

    this._refreshActive();
    search.value = tickers[0].name;
  }

  select(id) {
    this.tickerId = id;
    this.$('search').value = this.tickers.find(t => t.id === id).name;
    this._refreshActive();
    this.onChange();
  }

  selectPeriod(key) {
    this.periodKey = key;
    this._refreshActive();
    this.onChange();
  }

  _refreshActive() {
    for (const b of this.$('chips').children) b.classList.toggle('active', b.dataset.id === this.tickerId);
    for (const b of this.$('periods').children) b.classList.toggle('active', b.dataset.key === this.periodKey);
  }

  // 메뉴의 미니 차트 미리보기
  drawChart(prices) {
    const cv = this.$('preview');
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height, pad = 10;
    c.clearRect(0, 0, W, H);
    let min = Infinity, max = -Infinity;
    for (const p of prices) { min = Math.min(min, p); max = Math.max(max, p); }
    const span = (max - min) || 1;
    const X = i => pad + (W - 2 * pad) * (i / (prices.length - 1));
    const Y = p => H - pad - (H - 2 * pad) * ((p - min) / span);
    const up = prices[prices.length - 1] >= prices[0];
    const color = up ? '#fa5252' : '#4c8dff'; // 국내 관례: 상승 빨강 / 하락 파랑

    c.beginPath();
    c.moveTo(X(0), H - pad);
    for (let i = 0; i < prices.length; i++) c.lineTo(X(i), Y(prices[i]));
    c.lineTo(X(prices.length - 1), H - pad);
    c.closePath();
    c.fillStyle = up ? 'rgba(250,82,82,.12)' : 'rgba(76,141,255,.12)';
    c.fill();

    c.beginPath();
    for (let i = 0; i < prices.length; i++) i === 0 ? c.moveTo(X(i), Y(prices[i])) : c.lineTo(X(i), Y(prices[i]));
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.lineJoin = 'round';
    c.stroke();

    c.beginPath();
    c.arc(X(prices.length - 1), Y(prices[prices.length - 1]), 4, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
  }

  showMenu() { this.$('menu').classList.remove('hidden'); }
  hideMenu() { this.$('menu').classList.add('hidden'); }
  showHUD() { this.$('hud').classList.remove('hidden'); }
  hideHUD() { this.$('hud').classList.add('hidden'); }
  hideResult() { this.$('result').classList.add('hidden'); }

  setHUD({ price, pct, up, kmh, name, date, period, progress }) {
    this.$('hud-price').textContent = price;
    const pctEl = this.$('hud-pct');
    pctEl.textContent = pct;
    pctEl.className = 'g-sub ' + (up ? 'up' : 'down');
    this.$('hud-speed').textContent = kmh;
    this.$('hud-name').textContent = name;
    this.$('hud-date').textContent = date;
    this.$('hud-period').textContent = period;
    this.$('hud-progress').style.width = (progress * 100).toFixed(1) + '%';
  }

  setSpeed(kmh) { this.$('hud-speed').textContent = kmh; }

  // 급락: 빨간 비네트 + 스피드라인 + 계기판 경고
  setDanger(on) {
    this._danger = on;
    this.$('vignette').classList.toggle('on', on);
    this.$('hud').classList.toggle('danger', on);
    this._applyRush();
  }

  // 내리막/급락 몰입감: 화면 주변부 블러 (중앙은 선명하게 유지)
  setBlur(i) {
    const q = Math.round(i * 20) / 20; // 스타일 변경 횟수 절감용 양자화
    if (q === this._blurQ) return;
    this._blurQ = q;
    const el = this.$('blur');
    if (q < 0.08) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    const px = (q * 8).toFixed(1);
    el.style.backdropFilter = `blur(${px}px)`;
    el.style.webkitBackdropFilter = `blur(${px}px)`;
    const inner = Math.round(40 - q * 22);
    const mask = `radial-gradient(circle at center, transparent ${inner}%, black ${inner + 32}%)`;
    el.style.webkitMaskImage = mask;
    el.style.maskImage = mask;
  }

  // 급등: 스피드라인
  setRush(on) {
    this._rush = on;
    this._applyRush();
  }

  _applyRush() {
    this.$('speedlines').classList.toggle('on', this._danger || this._rush);
  }

  flash(color) {
    const el = this.$('flash');
    el.style.background = color;
    el.classList.remove('on');
    void el.offsetWidth; // 애니메이션 재시작
    el.classList.add('on');
  }

  showResult({ emoji, title, desc, stats }) {
    this.$('res-emoji').textContent = emoji;
    this.$('res-title').textContent = title;
    this.$('res-desc').textContent = desc;
    const grid = this.$('res-stats');
    grid.innerHTML = '';
    for (const [k, v] of stats) {
      const d = document.createElement('div');
      d.className = 'stat';
      d.innerHTML = `<span class="k">${k}</span><span class="v">${v}</span>`;
      grid.appendChild(d);
    }
    this.$('result').classList.remove('hidden');
  }
}
