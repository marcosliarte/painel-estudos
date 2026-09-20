(function () {
  "use strict";

  // ————— cores/constantes —————
  var REASONS = [
    { id: "conteudo", label: "Não sabia o conteúdo", color: "#B5623C" },
    { id: "interpretacao", label: "Interpretei errado", color: "#B08828" },
    { id: "distracao", label: "Distração / bobeira", color: "#7B8A8B" },
    { id: "pegadinha", label: "Caí na pegadinha", color: "#9A5B8F" },
    { id: "tempo", label: "Faltou tempo / chutei", color: "#5E7B9E" },
  ];

  // ————— estado (cache em memória, espelha o MongoDB) —————
  var subjects = [];
  var log = {};
  var entries = [];
  var viewDate = todayKey();
  var currentTab = "estudos";
  var errReason = REASONS[0].id;
  var errFilter = "todas";
  var editingMinSubject = null; // matéria cujo campo de tempo está em edição manual (separado dos botões +/-)
  var showRevised = false;
  var subjectRankSort = "min"; // 'min' | 'days' | 'q'
  var renamingSubject = null; // matéria cujo nome está em edição inline

  // ————— estado FLASHCARDS —————
  var FC_MAX_BOX = 5;
  var flashcards = [];
  var fcFilter = "todas";
  var fcEditingId = null; // cartão cujos campos estão em edição inline
  var fcSession = null; // { queue: [...], index: 0, flipped: bool }

  // ————— estado CRONÔMETRO —————
  var timerMode = "stopwatch"; // 'stopwatch' | 'countdown' | 'pomodoro'
  var timerSubject = "";
  var timerStatus = "idle"; // 'idle' | 'running' | 'paused'
  var timerInterval = null;
  var timerLastTickAt = null; // Date.now() do último tick processado, p/ medir tempo real decorrido
  var timerElapsedSec = 0; // modo cronômetro: total decorrido
  var timerTotalCountableSec = 0; // segundos "de estudo" válidos nesta sessão (usado p/ commit de minutos)
  var timerCommittedMin = 0; // minutos já gravados no banco nesta sessão
  var timerCountdownDurationMin = 25;
  var timerCountdownRemainingSec = timerCountdownDurationMin * 60;
  var timerPomodoroFocoMin = 25;
  var timerPomodoroPausaMin = 5;
  var timerPomodoroPhase = "foco"; // 'foco' | 'pausa'
  var timerPomodoroRemainingSec = timerPomodoroFocoMin * 60;
  var timerPomodoroCycles = 0;

  // ————— tema (claro/escuro) —————
  var THEME_KEY = "painelEstudos.theme";
  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function systemPrefersDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function effectiveTheme() {
    var stored = getStoredTheme();
    return (stored === "light" || stored === "dark") ? stored : (systemPrefersDark() ? "dark" : "light");
  }
  function applyTheme() {
    var stored = getStoredTheme();
    if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);
    else document.documentElement.removeAttribute("data-theme");
    var btn = document.getElementById("btnTheme");
    if (btn) btn.textContent = effectiveTheme() === "dark" ? "☀️ Claro" : "🌙 Escuro";
  }
  function toggleTheme() {
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* localStorage indisponível, tema não persiste */ }
    applyTheme();
  }

  // ————— mapa de estudos (heatmap estilo GitHub) —————
  var HEAT_WEEKS = 53;
  var HEAT_MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  var HEAT_DOW_LABELS = ["", "seg", "", "qua", "", "sex", ""];

  // ————— util —————
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function fmtDay(key) { var p = key.split("-").map(Number); var date = new Date(p[0], p[1] - 1, p[2]); var wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][date.getDay()]; return wd + " " + pad(p[2]) + "/" + pad(p[1]); }
  function fmtDate(ts) { var d = new Date(ts); return pad(d.getDate()) + "/" + pad(d.getMonth() + 1); }
  function fmtHeatDate(date) { var wd = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][date.getDay()]; return wd + " " + pad(date.getDate()) + "/" + pad(date.getMonth() + 1); }
  function fmtHours(min) { var h = Math.floor(min / 60), m = min % 60; if (h === 0) return m + "min"; if (m === 0) return h + "h"; return h + "h" + pad(m); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function reasonMeta(id) { for (var i = 0; i < REASONS.length; i++) { if (REASONS[i].id === id) return REASONS[i]; } return REASONS[0]; }

  // ————— persistência (MongoDB local, via processo principal do Electron) —————
  async function load() {
    subjects = await window.api.subjects.list();
    if (!subjects.length) {
      await window.api.subjects.add("Matemática");
      await window.api.subjects.add("Português");
      subjects = await window.api.subjects.list();
    }
    log = await window.api.studyLog.getAll();
    entries = await window.api.mistakes.list();
    flashcards = await window.api.flashcards.list();
  }

  // ————— toast —————
  var toastTimer;
  function flash(msg) { var t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1600); }

  // ————— matérias (compartilhadas) —————
  async function addSubject(name) {
    var n = (name || "").trim();
    if (!n) return false;
    var res = await window.api.subjects.add(n);
    if (!res.ok) { flash(res.reason === "duplicate" ? "Essa matéria já existe" : "Nome inválido"); return false; }
    subjects = await window.api.subjects.list();
    renderAll();
    flash("Matéria adicionada");
    return true;
  }
  async function removeSubject(name) {
    await window.api.subjects.remove(name);
    subjects = await window.api.subjects.list();
    Object.keys(log).forEach(function (k) { delete log[k][name]; });
    entries = entries.filter(function (e) { return e.subject !== name; });
    renderAll();
    flash("Matéria removida");
  }
  function rerenderForTab() { if (currentTab === "erros") renderErros(); else if (currentTab === "flash") renderFlash(); else renderEstudos(); }
  function startRenameSubject(subject) {
    renamingSubject = subject;
    rerenderForTab();
    var input = document.querySelector("[data-renameinput]");
    if (input) { input.focus(); input.select(); }
  }
  function cancelRenameSubject() {
    renamingSubject = null;
    rerenderForTab();
  }
  async function commitRenameSubject(oldName, novo) {
    novo = (novo || "").trim();
    renamingSubject = null;
    if (!novo || novo === oldName) { rerenderForTab(); return; }
    var res = await window.api.subjects.rename(oldName, novo);
    if (!res.ok) { flash(res.reason === "duplicate" ? "Já existe uma matéria com esse nome" : "Nome inválido"); rerenderForTab(); return; }
    await load();
    renderAll();
    flash("Matéria renomeada");
  }

  // ————— backup —————
  async function exportBackup() {
    var res = await window.api.backup.export();
    if (res.ok) flash("Backup salvo ✓");
    else if (res.reason !== "canceled") flash("Não foi possível salvar o backup");
  }
  async function importBackup() {
    var res = await window.api.backup.import();
    if (res.ok) { await load(); renderAll(); flash("Dados restaurados ✓"); }
    else if (res.reason === "invalid-file") flash("Arquivo inválido");
  }

  // ————— cálculos ESTUDOS —————
  function computeStats() {
    var keys = Object.keys(log), totalMin = 0, totalQ = 0, activeDays = 0, perDay = [];
    keys.forEach(function (k) {
      var m = 0, q = 0; var day = log[k];
      Object.keys(day).forEach(function (s) { m += day[s].min || 0; q += day[s].q || 0; });
      if (m > 0 || q > 0) { activeDays++; perDay.push({ key: k, min: m, q: q }); }
      totalMin += m; totalQ += q;
    });
    perDay.sort(function (a, b) { return a.key < b.key ? 1 : -1; });
    var avg = activeDays ? Math.round(totalMin / activeDays) : 0;
    var set = {}; perDay.forEach(function (d) { set[d.key] = true; });
    var streak = 0; var d = new Date();
    for (var i = 0; i < 400; i++) {
      var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      if (set[key]) { streak++; d.setDate(d.getDate() - 1); }
      else if (i === 0) { d.setDate(d.getDate() - 1); }
      else break;
    }
    return { totalMin: totalMin, totalQ: totalQ, activeDays: activeDays, avg: avg, streak: streak, perDay: perDay.slice(0, 14) };
  }

  function dayTotals() {
    var day = log[viewDate] || {}, min = 0, q = 0;
    Object.keys(day).forEach(function (s) { min += day[s].min || 0; q += day[s].q || 0; });
    return { min: min, q: q };
  }

  // ————— "frescor" da matéria (curva do esquecimento) —————
  // Verde -> amarelo -> vermelho conforme os dias sem estudar aumentam. A curva usa
  // decaimento exponencial (1 - e^-dias/6), como a curva de esquecimento de Ebbinghaus:
  // cai rápido nos primeiros dias e depois desacelera.
  var FRESH_STOPS = [
    [46, 160, 67],   // verde: acabou de estudar
    [191, 135, 0],   // amarelo: começando a esquecer
    [229, 72, 77],   // vermelho: provavelmente esqueceu
  ];
  var FRESH_HALF_LIFE_DAYS = 6;

  function daysSinceStudied(subject) {
    var last = null;
    Object.keys(log).forEach(function (dateKey) {
      var e = log[dateKey][subject];
      if (e && ((e.min || 0) > 0 || (e.q || 0) > 0)) {
        if (last === null || dateKey > last) last = dateKey;
      }
    });
    if (last === null) return null;
    var p = last.split("-").map(Number);
    var lastDate = new Date(p[0], p[1] - 1, p[2]);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((today - lastDate) / 86400000);
  }

  function freshnessColor(days) {
    if (days === null) return "var(--ink-soft)";
    var decay = 1 - Math.exp(-days / FRESH_HALF_LIFE_DAYS);
    decay = Math.max(0, Math.min(1, decay));
    var a, b, t;
    if (decay <= 0.5) { a = FRESH_STOPS[0]; b = FRESH_STOPS[1]; t = decay / 0.5; }
    else { a = FRESH_STOPS[1]; b = FRESH_STOPS[2]; t = (decay - 0.5) / 0.5; }
    var rgb = a.map(function (c, i) { return Math.round(c + (b[i] - c) * t); });
    return "rgb(" + rgb.join(",") + ")";
  }

  function freshnessTitle(days) {
    if (days === null) return "ainda não estudada";
    if (days === 0) return "estudada hoje";
    if (days === 1) return "estudada há 1 dia";
    return "estudada há " + days + " dias";
  }

  function heatLevel(min) {
    if (min <= 0) return 0;
    if (min < 30) return 1;
    if (min < 60) return 2;
    if (min < 120) return 3;
    return 4;
  }

  function computeHeatmapDays() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today);
    start.setDate(start.getDate() - (HEAT_WEEKS - 1) * 7 - today.getDay());
    var days = []; var d = new Date(start);
    while (d <= today) {
      var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      var dayLog = log[key] || {}, min = 0;
      Object.keys(dayLog).forEach(function (s) { min += dayLog[s].min || 0; });
      days.push({ key: key, date: new Date(d), min: min });
      d.setDate(d.getDate() + 1);
    }
    return days;
  }

  function renderHeatmapDayLabels() {
    var host = document.getElementById("heatmapDayLabels"); host.innerHTML = "";
    HEAT_DOW_LABELS.forEach(function (lbl) {
      var span = document.createElement("span");
      span.textContent = lbl;
      span.style.cssText = "height:11px; font-size:9px; color:var(--ink-soft); line-height:11px;";
      host.appendChild(span);
    });
  }

  function renderHeatmap() {
    renderHeatmapDayLabels();
    var days = computeHeatmapDays();
    var grid = document.getElementById("heatmapGrid"); grid.innerHTML = "";
    var monthsHost = document.getElementById("heatmapMonths"); monthsHost.innerHTML = "";
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var studiedDays = 0, lastMonth = -1;
    days.forEach(function (d) {
      if (d.min > 0) studiedDays++;
      if (d.date.getDay() === 0) {
        var m = d.date.getMonth();
        var col = document.createElement("span");
        col.style.cssText = "width:11px; flex:0 0 auto; font-size:10px; color:var(--ink-soft);";
        if (m !== lastMonth) { col.textContent = HEAT_MONTHS[m]; col.style.overflow = "visible"; col.style.whiteSpace = "nowrap"; lastMonth = m; }
        monthsHost.appendChild(col);
      }
      var cell = document.createElement("span");
      cell.className = "heatcell";
      if (d.date > today) {
        cell.style.visibility = "hidden";
      } else {
        cell.setAttribute("data-level", heatLevel(d.min));
        cell.setAttribute("data-heatdate", d.key);
        cell.title = fmtHeatDate(d.date) + " · " + (d.min > 0 ? fmtHours(d.min) + " estudados" : "nada estudado");
      }
      grid.appendChild(cell);
    });
    document.getElementById("heatmapTotal").textContent =
      studiedDays + (studiedDays === 1 ? " dia estudado" : " dias estudados") + " nas últimas " + HEAT_WEEKS + " semanas";
    var scrollHost = document.getElementById("heatmapScroll");
    if (scrollHost) scrollHost.scrollLeft = scrollHost.scrollWidth;
  }

  async function updateEntry(subject, field, delta) {
    var result = field === "min"
      ? await window.api.studyLog.adjustMinutes(viewDate, subject, delta)
      : await window.api.studyLog.adjustQuestions(viewDate, subject, delta);
    if (!log[viewDate]) log[viewDate] = {};
    log[viewDate][subject] = { min: result.minutes, q: result.questions };
    renderEstudos();
  }
  async function setEntryQ(subject, value) {
    var result = await window.api.studyLog.setQuestions(viewDate, subject, value);
    if (!log[viewDate]) log[viewDate] = {};
    log[viewDate][subject] = { min: result.minutes, q: result.questions };
    renderMetricsAndHistory();
  }
  async function setEntryMin(subject, value) {
    var result = await window.api.studyLog.setMinutes(viewDate, subject, value);
    if (!log[viewDate]) log[viewDate] = {};
    log[viewDate][subject] = { min: result.minutes, q: result.questions };
    editingMinSubject = null;
    renderEstudos();
  }
  function startMinEdit(subject) {
    editingMinSubject = subject;
    renderEstudos();
    var input = document.querySelector("#subjRows input[data-mininput]");
    if (input) { input.focus(); input.select(); }
  }
  function cancelMinEdit() {
    editingMinSubject = null;
    renderEstudos();
  }

  // ————— render ESTUDOS —————
  function renderEstudos() {
    renderMetricsAndHistory();
    // dia
    var isToday = viewDate === todayKey();
    document.getElementById("dayTitle").textContent = isToday ? "Hoje" : fmtDay(viewDate);
    var dt = dayTotals();
    document.getElementById("daySub").textContent = fmtHours(dt.min) + " · " + dt.q + " questões";
    document.getElementById("nextDay").disabled = isToday;
    // linhas
    var host = document.getElementById("subjRows"); host.innerHTML = "";
    if (!subjects.length) {
      host.innerHTML = '<div class="muted" style="padding:22px 4px; font-size:14px; font-style:italic;">Nenhuma matéria ainda. Adicione uma abaixo.</div>';
    }
    var day = log[viewDate] || {};
    subjects.forEach(function (subj) {
      var e = day[subj] || { min: 0, q: 0 };
      var row = document.createElement("div");
      row.className = "subjrow";
      row.style.cssText = "display:grid; grid-template-columns:1fr auto auto; gap:12px; align-items:center; padding:12px 4px; border-bottom:1px solid var(--line);";
      var freshDays = daysSinceStudied(subj);
      row.innerHTML =
        '<div style="display:flex; align-items:center; gap:6px; min-width:0;">' +
        '<span class="freshdot" style="background:' + freshnessColor(freshDays) + ';" title="' + esc(subj) + ' — ' + freshnessTitle(freshDays) + '"></span>' +
        (renamingSubject === subj
          ? '<input class="inp" data-renameinput="' + esc(subj) + '" value="' + esc(subj) + '" style="max-width:220px; padding:4px 8px;" title="Enter para salvar · Esc para cancelar" />'
          : '<span style="font-size:15px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(subj) + '</span>' +
            '<button class="xbtn" data-rename-subj="' + esc(subj) + '" title="Renomear matéria">✎</button>' +
            '<button class="xbtn" data-rm-subj="' + esc(subj) + '" title="Remover matéria">✕</button>'
        ) +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:5px; width:148px; justify-content:center;">' +
        '<span class="stepbtn" data-min="' + esc(subj) + '" data-d="-15">−</span>' +
        (editingMinSubject === subj
          ? '<input class="num" data-mininput="' + esc(subj) + '" value="' + (e.min || 0) + '" inputmode="numeric" title="Enter para salvar · Esc para cancelar" />'
          : '<span class="mono" style="font-size:13px; color:' + (e.min ? "var(--ink)" : "var(--ink-soft)") + '; min-width:48px; text-align:center;">' + fmtHours(e.min) + '</span>' +
            '<button class="xbtn" data-edit-min="' + esc(subj) + '" title="Digitar valor exato de minutos">✎</button>'
        ) +
        '<span class="stepbtn" data-min="' + esc(subj) + '" data-d="15">+</span>' +
        '</div>' +
        '<div style="display:flex; align-items:center; gap:5px; width:148px; justify-content:center;">' +
        '<span class="stepbtn" data-q="' + esc(subj) + '" data-d="-5">−</span>' +
        '<input class="num" data-qinput="' + esc(subj) + '" value="' + (e.q || 0) + '" inputmode="numeric" />' +
        '<span class="stepbtn" data-q="' + esc(subj) + '" data-d="5">+</span>' +
        '</div>';
      host.appendChild(row);
    });
  }

  function renderMetricsAndHistory() {
    var s = computeStats();
    document.getElementById("streakNum").textContent = s.streak;
    document.getElementById("streakNum").style.color = s.streak > 0 ? "var(--olive)" : "var(--ink-soft)";
    document.getElementById("streakLabel").textContent = s.streak === 1 ? "dia seguido" : "dias seguidos";
    document.getElementById("mTotal").textContent = fmtHours(s.totalMin);
    document.getElementById("mAvg").textContent = fmtHours(s.avg);
    document.getElementById("mDays").textContent = s.activeDays;
    document.getElementById("mQ").textContent = s.totalQ;
    renderSubjectRanking();
    renderHeatmap();
    var dt = dayTotals();
    document.getElementById("daySub").textContent = fmtHours(dt.min) + " · " + dt.q + " questões";
    // history
    var chart = document.getElementById("historyChart"); chart.innerHTML = "";
    if (!s.perDay.length) {
      chart.innerHTML = '<div class="muted" style="font-size:14px; font-style:italic;">Seu histórico aparece aqui após o primeiro dia registrado.</div>';
      return;
    }
    var maxBar = Math.max(60); s.perDay.forEach(function (d) { if (d.min > maxBar) maxBar = d.min; });
    s.perDay.forEach(function (d) {
      var pct = Math.min(100, (d.min / maxBar) * 100);
      var row = document.createElement("div");
      row.style.cssText = "display:flex; align-items:center; gap:10px;";
      row.innerHTML =
        '<span class="muted" style="width:62px; font-size:12px; text-align:right; font-variant-numeric:tabular-nums;">' + fmtDay(d.key) + '</span>' +
        '<div style="flex:1; background:var(--track); border-radius:5px; height:22px; position:relative; overflow:hidden;">' +
        '<div style="width:' + pct + '%; height:100%; background:linear-gradient(90deg, var(--olive-soft), var(--olive)); border-radius:5px;"></div>' +
        '<span class="mono" style="position:absolute; right:8px; top:0; height:100%; display:flex; align-items:center; font-size:11.5px; color:var(--ink); font-weight:600;">' + fmtHours(d.min) + (d.q ? " · " + d.q + "q" : "") + '</span>' +
        '</div>';
      chart.appendChild(row);
    });
  }

  function computeSubjectRanking() {
    var map = {};
    subjects.forEach(function (s) { map[s] = { subject: s, min: 0, q: 0, days: 0 }; });
    Object.keys(log).forEach(function (dateKey) {
      var day = log[dateKey];
      Object.keys(day).forEach(function (s) {
        if (!map[s]) map[s] = { subject: s, min: 0, q: 0, days: 0 };
        var e = day[s];
        map[s].min += e.min || 0;
        map[s].q += e.q || 0;
        if ((e.min || 0) > 0 || (e.q || 0) > 0) map[s].days += 1;
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return b[subjectRankSort] - a[subjectRankSort]; });
    return arr;
  }

  function renderSubjectRanking() {
    document.querySelectorAll(".ranksort").forEach(function (el) {
      el.classList.toggle("on", el.getAttribute("data-sort") === subjectRankSort);
    });
    var host = document.getElementById("subjRankRows"); host.innerHTML = "";
    var arr = computeSubjectRanking();
    if (!arr.length) {
      host.innerHTML = '<div class="muted" style="padding:22px 4px; font-size:14px; font-style:italic;">Sem dados ainda. Registre estudos para ver o ranking aqui.</div>';
      return;
    }
    arr.forEach(function (d, idx) {
      var row = document.createElement("div");
      row.style.cssText = "display:grid; grid-template-columns:1fr 74px 56px 70px; gap:12px; align-items:center; padding:10px 4px; border-bottom:1px solid var(--line);";
      var freshDays = daysSinceStudied(d.subject);
      row.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; min-width:0;">' +
        '<span class="muted" style="font-size:11.5px; width:16px; text-align:right;">' + (idx + 1) + '</span>' +
        '<span class="freshdot" style="background:' + freshnessColor(freshDays) + ';" title="' + esc(d.subject) + ' — ' + freshnessTitle(freshDays) + '"></span>' +
        '<span style="font-size:14.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(d.subject) + '</span>' +
        '</div>' +
        '<span class="mono" style="text-align:center; font-size:13px;' + (subjectRankSort === "min" ? " font-weight:700; color:var(--olive);" : "") + '">' + fmtHours(d.min) + '</span>' +
        '<span class="mono" style="text-align:center; font-size:13px;' + (subjectRankSort === "days" ? " font-weight:700; color:var(--olive);" : "") + '">' + d.days + '</span>' +
        '<span class="mono" style="text-align:center; font-size:13px;' + (subjectRankSort === "q" ? " font-weight:700; color:var(--olive);" : "") + '">' + d.q + '</span>';
      host.appendChild(row);
    });
  }

  // ————— cálculos/render ERROS —————
  function computeErrStats() {
    var pending = 0, bySubj = {}, byReason = {};
    entries.forEach(function (e) {
      if (!e.revised) { pending++; bySubj[e.subject] = (bySubj[e.subject] || 0) + 1; byReason[e.reason] = (byReason[e.reason] || 0) + 1; }
    });
    var weak = null, max = -1;
    Object.keys(bySubj).forEach(function (k) { if (bySubj[k] > max) { max = bySubj[k]; weak = k; } });
    return { pending: pending, revised: entries.length - pending, weak: weak, byReason: byReason };
  }

  function renderErros() {
    var s = computeErrStats();
    document.getElementById("evPending").textContent = s.pending;
    document.getElementById("evRevised").textContent = s.revised;
    document.getElementById("evWeak").textContent = s.weak || "—";
    var badge = document.getElementById("badgeErros");
    if (s.pending > 0) { badge.textContent = s.pending; badge.classList.remove("hide"); } else { badge.classList.add("hide"); }
    var box = document.getElementById("reasonBox"); var chips = document.getElementById("reasonChips"); chips.innerHTML = "";
    if (s.pending > 0) {
      box.classList.remove("hide");
      var arr = REASONS.filter(function (r) { return s.byReason[r.id]; }).sort(function (a, b) { return s.byReason[b.id] - s.byReason[a.id]; });
      arr.forEach(function (r) {
        var span = document.createElement("span");
        span.style.cssText = "font-size:12.5px; background:var(--card); border:1px solid var(--line); border-radius:6px; padding:4px 9px;";
        span.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:2px; background:' + r.color + '; margin-right:6px;"></span>' + esc(r.label) + ': <strong>' + s.byReason[r.id] + '</strong>';
        chips.appendChild(span);
      });
    } else { box.classList.add("hide"); }

    var sel = document.getElementById("errSubject"); var prev = sel.value; sel.innerHTML = "";
    subjects.forEach(function (su) { var o = document.createElement("option"); o.value = su; o.textContent = su; sel.appendChild(o); });
    if (subjects.indexOf(prev) > -1) sel.value = prev;

    var rp = document.getElementById("reasonPicker"); rp.innerHTML = "";
    REASONS.forEach(function (r) {
      var span = document.createElement("span");
      span.className = "reason-chip"; span.setAttribute("data-reason", r.id);
      var on = errReason === r.id;
      span.style.borderColor = on ? r.color : "var(--line)";
      span.style.background = on ? r.color : "var(--card)";
      span.style.color = on ? "#fff" : "var(--ink)";
      span.textContent = r.label;
      rp.appendChild(span);
    });

    var ec = document.getElementById("errSubjChips"); ec.innerHTML = "";
    subjects.forEach(function (su) {
      var span = document.createElement("span");
      span.className = "subjchip";
      span.style.cssText = "font-size:12.5px; background:var(--card); border:1px solid var(--line); border-radius:6px; padding:4px 8px; display:inline-flex; align-items:center;";
      span.innerHTML = renamingSubject === su
        ? '<input class="inp" data-renameinput="' + esc(su) + '" value="' + esc(su) + '" style="width:130px; padding:3px 6px; font-size:12.5px;" title="Enter para salvar · Esc para cancelar" />'
        : esc(su) + '<button class="subjx" data-rename-subj="' + esc(su) + '" title="Renomear">✎</button><button class="subjx" data-rm-subj="' + esc(su) + '" title="Remover">✕</button>';
      ec.appendChild(span);
    });

    var fc = document.getElementById("filterChips"); fc.innerHTML = "";
    var all = document.createElement("span"); all.className = "ghost" + (errFilter === "todas" ? " on" : ""); all.setAttribute("data-filter", "todas"); all.textContent = "Todas"; fc.appendChild(all);
    subjects.forEach(function (su) {
      var span = document.createElement("span"); span.className = "ghost" + (errFilter === su ? " on" : ""); span.setAttribute("data-filter", su); span.textContent = su; fc.appendChild(span);
    });
    var tr = document.getElementById("toggleRevised");
    tr.className = "ghost" + (showRevised ? " on" : "");
    tr.textContent = showRevised ? "✓ mostrando revisados" : "mostrar revisados";

    var list = document.getElementById("errList"); list.innerHTML = "";
    var visible = entries.filter(function (e) {
      if (!showRevised && e.revised) return false;
      if (errFilter !== "todas" && e.subject !== errFilter) return false;
      return true;
    });
    if (!visible.length) {
      var msg = entries.length === 0
        ? "Seu caderno está vazio. Toda vez que errar uma questão, registre aqui — é assim que o erro vira aprendizado."
        : "Nada por aqui com esse filtro. Revisou tudo? Excelente.";
      list.innerHTML = '<div class="muted" style="text-align:center; padding:36px 20px; font-size:14px; font-style:italic; background:var(--card); border:1px dashed var(--line); border-radius:12px;">' + msg + '</div>';
      return;
    }
    visible.forEach(function (e) {
      var rm = reasonMeta(e.reason);
      var card = document.createElement("div");
      card.className = "card-e";
      card.style.cssText = "background:var(--card); border:1px solid " + (e.revised ? "var(--line)" : "var(--clay-soft)") + "; border-left:3px solid " + (e.revised ? "var(--line)" : rm.color) + "; border-radius:8px; padding:14px 16px; opacity:" + (e.revised ? "0.72" : "1") + ";";
      card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">' +
        '<div style="min-width:0; flex:1;">' +
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:5px;">' +
        '<span style="font-size:11.5px; font-weight:700; color:var(--olive); text-transform:uppercase; letter-spacing:.5px;">' + esc(e.subject) + '</span>' +
        '<span class="muted" style="font-size:11px;">· ' + fmtDate(e.ts) + '</span>' +
        '<span style="font-size:11px; color:#fff; background:' + rm.color + '; border-radius:5px; padding:2px 7px;">' + esc(rm.label) + '</span>' +
        '</div>' +
        '<div style="font-size:15px; font-weight:600; margin-bottom:' + (e.lesson ? "5px" : "0") + '; text-decoration:' + (e.revised ? "line-through" : "none") + ';">' + esc(e.topic) + '</div>' +
        (e.lesson ? '<div class="muted" style="font-size:13.5px; line-height:1.45;">💡 ' + esc(e.lesson) + '</div>' : '') +
        '</div>' +
        '<button class="xbtn" data-rm-err="' + e.id + '" title="Remover">✕</button>' +
        '</div>' +
        '<div style="margin-top:11px;">' +
        '<button class="revbtn' + (e.revised ? " done" : "") + '" data-rev="' + e.id + '">' + (e.revised ? "↺ marcar como pendente" : "✓ revisei este") + '</button>' +
        '</div>';
      list.appendChild(card);
    });
  }

  async function addErr() {
    var topic = document.getElementById("errTopic").value.trim();
    var subject = document.getElementById("errSubject").value;
    var lesson = document.getElementById("errLesson").value.trim();
    if (!topic) { flash("Escreva o assunto da questão"); return; }
    if (!subject) { flash("Adicione uma matéria primeiro"); return; }
    await window.api.mistakes.add({ subject: subject, topic: topic, reason: errReason, lesson: lesson });
    entries = await window.api.mistakes.list();
    document.getElementById("errTopic").value = "";
    document.getElementById("errLesson").value = "";
    renderErros(); flash("Erro registrado");
  }

  // ————— cálculos/render FLASHCARDS —————
  function computeFlashStats() {
    var now = Date.now();
    var due = 0, mastered = 0;
    flashcards.forEach(function (c) {
      if (c.nextReview <= now) due++;
      if (c.box >= FC_MAX_BOX) mastered++;
    });
    return { total: flashcards.length, due: due, mastered: mastered };
  }

  function renderFlash() {
    var s = computeFlashStats();
    document.getElementById("fcTotal").textContent = s.total;
    document.getElementById("fcDue").textContent = s.due;
    document.getElementById("fcMastered").textContent = s.mastered;
    var badge = document.getElementById("badgeFlash");
    if (s.due > 0) { badge.textContent = s.due; badge.classList.remove("hide"); } else { badge.classList.add("hide"); }

    // matéria (select do formulário de novo cartão)
    var sel = document.getElementById("fcSubject"); var prev = sel.value; sel.innerHTML = "";
    subjects.forEach(function (su) { var o = document.createElement("option"); o.value = su; o.textContent = su; sel.appendChild(o); });
    if (subjects.indexOf(prev) > -1) sel.value = prev;

    // chips de filtro
    var fc = document.getElementById("fcFilterChips"); fc.innerHTML = "";
    var all = document.createElement("span"); all.className = "ghost" + (fcFilter === "todas" ? " on" : ""); all.setAttribute("data-fcfilter", "todas"); all.textContent = "Todas"; fc.appendChild(all);
    subjects.forEach(function (su) {
      var span = document.createElement("span"); span.className = "ghost" + (fcFilter === su ? " on" : ""); span.setAttribute("data-fcfilter", su); span.textContent = su; fc.appendChild(span);
    });

    renderFlashStudyPanel();
    renderFlashList();
  }

  function renderFlashStudyPanel() {
    var idlePanel = document.getElementById("fcStudyIdle");
    var sessionPanel = document.getElementById("fcStudySession");
    if (!fcSession) {
      idlePanel.classList.remove("hide");
      sessionPanel.classList.add("hide");
      var s = computeFlashStats();
      document.getElementById("fcStudyIdleMsg").textContent = s.due > 0
        ? (s.due === 1 ? "1 cartão pronto pra revisar." : s.due + " cartões prontos pra revisar.")
        : "Nenhum cartão para revisar agora.";
      document.getElementById("fcStudyStart").disabled = s.due === 0;
      return;
    }
    idlePanel.classList.add("hide");
    sessionPanel.classList.remove("hide");
    var card = fcSession.queue[fcSession.index];
    document.getElementById("fcStudyProgress").textContent = (fcSession.index + 1) + " / " + fcSession.queue.length;
    document.getElementById("fcStudySubject").textContent = card.subject;
    document.getElementById("fcCardText").textContent = fcSession.flipped ? card.back : card.front;
    document.getElementById("fcCardHint").classList.toggle("hide", fcSession.flipped);
    document.getElementById("fcCardActions").classList.toggle("hide", !fcSession.flipped);
  }

  function renderFlashList() {
    var host = document.getElementById("fcList"); host.innerHTML = "";
    var visible = flashcards.filter(function (c) { return fcFilter === "todas" || c.subject === fcFilter; });
    if (!visible.length) {
      var msg = flashcards.length === 0
        ? "Nenhum cartão ainda. Crie o primeiro acima — pergunta de um lado, resposta do outro."
        : "Nada por aqui com esse filtro.";
      host.innerHTML = '<div class="muted" style="text-align:center; padding:36px 20px; font-size:14px; font-style:italic; background:var(--card); border:1px dashed var(--line); border-radius:12px;">' + msg + '</div>';
      return;
    }
    var now = Date.now();
    visible.forEach(function (c) {
      var due = c.nextReview <= now;
      var card = document.createElement("div");
      card.className = "card-e";
      card.style.cssText = "background:var(--card); border:1px solid " + (due ? "var(--clay-soft)" : "var(--line)") + "; border-radius:8px; padding:14px 16px;";
      if (fcEditingId === c.id) {
        card.innerHTML =
          '<div style="display:flex; flex-direction:column; gap:8px;">' +
          '<span style="font-size:11px; font-weight:700; color:var(--olive); text-transform:uppercase; letter-spacing:.5px;">' + esc(c.subject) + '</span>' +
          '<input class="inp" data-fcedit-front="' + c.id + '" value="' + esc(c.front) + '" placeholder="pergunta" />' +
          '<input class="inp" data-fcedit-back="' + c.id + '" value="' + esc(c.back) + '" placeholder="resposta" />' +
          '<div style="display:flex; gap:8px;">' +
          '<button class="addbtn" data-fc-save="' + c.id + '">Salvar</button>' +
          '<button class="ghost" data-fc-cancel="' + c.id + '">Cancelar</button>' +
          '</div></div>';
        host.appendChild(card);
        return;
      }
      var dots = "";
      for (var i = 1; i <= FC_MAX_BOX; i++) { dots += '<span class="boxdot' + (i <= c.box ? " on" : "") + '" title="caixa ' + c.box + '/' + FC_MAX_BOX + '"></span>'; }
      card.innerHTML =
        '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">' +
        '<div style="min-width:0; flex:1;">' +
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:5px;">' +
        '<span style="font-size:11px; font-weight:700; color:var(--olive); text-transform:uppercase; letter-spacing:.5px;">' + esc(c.subject) + '</span>' +
        '<span style="display:inline-flex; gap:3px; align-items:center;">' + dots + '</span>' +
        (due ? '<span style="font-size:11px; color:var(--on-accent); background:var(--clay); border-radius:5px; padding:2px 7px;">a revisar</span>' : '') +
        '</div>' +
        '<div style="font-size:15px; font-weight:600; margin-bottom:4px;">' + esc(c.front) + '</div>' +
        '<div class="muted" style="font-size:13.5px; line-height:1.45;">↳ ' + esc(c.back) + '</div>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; gap:2px;">' +
        '<button class="xbtn" data-fc-edit="' + c.id + '" title="Editar cartão">✎</button>' +
        '<button class="xbtn" data-fc-rm="' + c.id + '" title="Remover cartão">✕</button>' +
        '</div>' +
        '</div>';
      host.appendChild(card);
    });
  }

  async function addFlashcard() {
    var subject = document.getElementById("fcSubject").value;
    var front = document.getElementById("fcFront").value.trim();
    var back = document.getElementById("fcBack").value.trim();
    if (!subject) { flash("Adicione uma matéria primeiro"); return; }
    if (!front || !back) { flash("Preencha a pergunta e a resposta"); return; }
    await window.api.flashcards.add({ subject: subject, front: front, back: back });
    flashcards = await window.api.flashcards.list();
    document.getElementById("fcFront").value = "";
    document.getElementById("fcBack").value = "";
    renderFlash();
    flash("Cartão adicionado");
  }

  function startEditFlashcard(id) {
    fcEditingId = id;
    renderFlashList();
    var input = document.querySelector('[data-fcedit-front="' + id + '"]');
    if (input) { input.focus(); input.select(); }
  }

  function cancelEditFlashcard() {
    fcEditingId = null;
    renderFlashList();
  }

  async function saveEditFlashcard(id) {
    var front = document.querySelector('[data-fcedit-front="' + id + '"]').value.trim();
    var back = document.querySelector('[data-fcedit-back="' + id + '"]').value.trim();
    if (!front || !back) { flash("Preencha a pergunta e a resposta"); return; }
    await window.api.flashcards.update(id, front, back);
    flashcards = await window.api.flashcards.list();
    fcEditingId = null;
    renderFlashList();
    flash("Cartão atualizado");
  }

  async function removeFlashcard(id) {
    await window.api.flashcards.remove(id);
    flashcards = await window.api.flashcards.list();
    renderFlash();
    flash("Cartão removido");
  }

  async function startFlashSession() {
    var due = await window.api.flashcards.listDue();
    if (!due.length) { flash("Nada pra revisar agora"); return; }
    fcSession = { queue: due, index: 0, flipped: false };
    renderFlashStudyPanel();
  }

  function flipFlashcard() {
    if (!fcSession) return;
    fcSession.flipped = !fcSession.flipped;
    renderFlashStudyPanel();
  }

  async function answerFlashcard(correct) {
    if (!fcSession) return;
    var card = fcSession.queue[fcSession.index];
    await window.api.flashcards.review(card.id, correct);
    flashcards = await window.api.flashcards.list();
    if (fcSession.index + 1 < fcSession.queue.length) {
      fcSession.index++;
      fcSession.flipped = false;
      renderFlashStudyPanel();
    } else {
      fcSession = null;
      renderFlash();
      flash("Revisão concluída ✓");
    }
  }

  function stopFlashSession() {
    fcSession = null;
    renderFlash();
  }

  // ————— CRONÔMETRO —————
  function fmtClock(totalSec) {
    totalSec = Math.max(0, Math.floor(totalSec));
    var h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
    return (h > 0 ? h + ":" + pad(m) : pad(m)) + ":" + pad(s);
  }

  function notifyUser(title, body) {
    try { window.api.notify.show(title, body); } catch (e) { /* notificação é só um extra, ignora falha */ }
  }

  async function commitTimerMinutes(subject, minutes) {
    var tKey = todayKey();
    var result = await window.api.studyLog.adjustMinutes(tKey, subject, minutes);
    if (!log[tKey]) log[tKey] = {};
    log[tKey][subject] = { min: result.minutes, q: result.questions };
    renderEstudos();
  }

  function timerResetCounters() {
    timerElapsedSec = 0;
    timerTotalCountableSec = 0;
    timerCommittedMin = 0;
    timerPomodoroPhase = "foco";
    timerPomodoroCycles = 0;
    timerPomodoroRemainingSec = timerPomodoroFocoMin * 60;
    timerCountdownRemainingSec = timerCountdownDurationMin * 60;
  }

  function timerMaybeCommit() {
    var wholeMin = Math.floor(timerTotalCountableSec / 60);
    if (wholeMin > timerCommittedMin) {
      var delta = wholeMin - timerCommittedMin;
      timerCommittedMin = wholeMin;
      commitTimerMinutes(timerSubject, delta);
    }
  }

  function timerTick() {
    if (timerStatus !== "running") return;

    // usa o tempo real decorrido (não "+1 por tick"): setInterval não é confiável
    // quando a janela perde o foco/é minimizada (o Chromium pode atrasar os ticks).
    // Um teto evita contar como estudo um hiato grande (ex.: PC hibernou).
    var now = Date.now();
    var deltaSec = timerLastTickAt ? (now - timerLastTickAt) / 1000 : 1;
    timerLastTickAt = now;
    deltaSec = Math.max(0, Math.min(deltaSec, 3));

    var countable = false;
    if (timerMode === "stopwatch") {
      timerElapsedSec += deltaSec; countable = true;
    } else if (timerMode === "countdown") {
      timerCountdownRemainingSec = Math.max(0, timerCountdownRemainingSec - deltaSec);
      countable = true;
    } else if (timerMode === "pomodoro") {
      timerPomodoroRemainingSec = Math.max(0, timerPomodoroRemainingSec - deltaSec);
      countable = timerPomodoroPhase === "foco";
    }

    if (countable) timerTotalCountableSec += deltaSec;
    timerMaybeCommit();

    if (timerMode === "countdown" && timerCountdownRemainingSec <= 0) {
      clearInterval(timerInterval); timerInterval = null; timerStatus = "idle"; timerLastTickAt = null;
      notifyUser("Tempo esgotado!", timerSubject + " · sessão de " + timerCountdownDurationMin + " min concluída");
      flash("Tempo esgotado — sessão registrada ✓");
      timerResetCounters();
    } else if (timerMode === "pomodoro" && timerPomodoroRemainingSec <= 0) {
      if (timerPomodoroPhase === "foco") {
        timerPomodoroCycles++;
        timerPomodoroPhase = "pausa";
        timerPomodoroRemainingSec = timerPomodoroPausaMin * 60;
        notifyUser("Hora da pausa", "Você focou " + timerPomodoroFocoMin + " min em " + timerSubject);
        flash("Pausa · " + timerPomodoroPausaMin + " min de descanso");
      } else {
        timerPomodoroPhase = "foco";
        timerPomodoroRemainingSec = timerPomodoroFocoMin * 60;
        notifyUser("De volta ao foco", "Retomando " + timerSubject);
        flash("Foco! Vamos lá");
      }
    }

    renderTimer();
  }

  function startTimer() {
    if (!timerSubject) { flash("Escolha uma matéria primeiro"); return; }
    if (timerStatus === "idle") timerResetCounters();
    timerStatus = "running";
    timerLastTickAt = Date.now();
    if (!timerInterval) timerInterval = setInterval(timerTick, 1000);
    renderTimer();
  }

  function pauseTimer() {
    if (timerStatus !== "running") return;
    timerStatus = "paused";
    clearInterval(timerInterval); timerInterval = null;
    timerLastTickAt = null;
    renderTimer();
  }

  function finalizeTimer() {
    clearInterval(timerInterval); timerInterval = null;
    timerLastTickAt = null;
    var min = timerCommittedMin;
    timerStatus = "idle";
    timerResetCounters();
    flash(min > 0 ? "Sessão encerrada · " + fmtHours(min) + " registrados" : "Sessão encerrada");
    renderTimer();
  }

  function setTimerMode(mode) {
    if (timerStatus !== "idle") return;
    timerMode = mode;
    timerResetCounters();
    renderTimer();
  }

  function renderTimer() {
    // matéria
    var sel = document.getElementById("timerSubject");
    if (!subjects.length) {
      sel.innerHTML = '<option value="">Adicione uma matéria</option>';
      timerSubject = "";
    } else {
      var prev = subjects.indexOf(timerSubject) > -1 ? timerSubject : subjects[0];
      sel.innerHTML = "";
      subjects.forEach(function (su) { var o = document.createElement("option"); o.value = su; o.textContent = su; sel.appendChild(o); });
      sel.value = prev;
      timerSubject = prev;
    }
    sel.disabled = timerStatus !== "idle";

    // modos
    ["stopwatch", "countdown", "pomodoro"].forEach(function (m) {
      var btn = document.getElementById("timerMode_" + m);
      btn.classList.toggle("on", timerMode === m);
      btn.disabled = timerStatus !== "idle";
    });
    document.getElementById("timerConfigCountdown").classList.toggle("hide", !(timerMode === "countdown" && timerStatus === "idle"));
    document.getElementById("timerConfigPomodoro").classList.toggle("hide", !(timerMode === "pomodoro" && timerStatus === "idle"));

    // badge de fase (pomodoro)
    var badge = document.getElementById("timerPhaseBadge");
    if (timerMode === "pomodoro" && timerStatus !== "idle") {
      badge.classList.remove("hide");
      badge.textContent = timerPomodoroPhase === "foco"
        ? "Foco · ciclo " + (timerPomodoroCycles + 1)
        : "Pausa · ciclo " + timerPomodoroCycles;
      badge.style.background = timerPomodoroPhase === "foco" ? "var(--olive)" : "var(--gold)";
    } else { badge.classList.add("hide"); }

    // display
    var display;
    if (timerMode === "stopwatch") display = fmtClock(timerElapsedSec);
    else if (timerMode === "countdown") display = fmtClock(timerCountdownRemainingSec);
    else display = fmtClock(timerPomodoroRemainingSec);
    document.getElementById("timerDisplay").textContent = display;

    // subtítulo
    var sub = document.getElementById("timerSub");
    sub.textContent = timerSubject
      ? ("estudando " + timerSubject + (timerCommittedMin > 0 ? " · " + fmtHours(timerCommittedMin) + " registrados" : ""))
      : "adicione uma matéria para começar";

    // botões
    var btnStart = document.getElementById("timerStart"), btnPause = document.getElementById("timerPause"), btnFinish = document.getElementById("timerFinish");
    btnStart.classList.toggle("hide", timerStatus === "running");
    btnStart.textContent = timerStatus === "paused" ? "▶ Retomar" : "▶ Iniciar";
    btnStart.disabled = !timerSubject;
    btnPause.classList.toggle("hide", timerStatus !== "running");
    btnFinish.classList.toggle("hide", timerStatus === "idle");
  }

  function renderAll() { renderEstudos(); renderErros(); renderFlash(); renderTimer(); }

  async function clearDay() {
    var dt = dayTotals();
    if (!dt.min && !dt.q) { flash("Esse dia já está zerado"); return; }
    if (!confirm("Zerar todos os minutos e questões de " + (viewDate === todayKey() ? "hoje" : fmtDay(viewDate)) + "?")) return;
    await window.api.studyLog.clearDay(viewDate);
    delete log[viewDate];
    renderEstudos();
    flash("Dia zerado");
  }

  // ————— navegação de data —————
  function shiftDate(delta) {
    var p = viewDate.split("-").map(Number); var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + delta);
    if (d > new Date()) return;
    viewDate = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    renderEstudos();
  }

  // ————— eventos —————
  function bind() {
    document.getElementById("btnTheme").addEventListener("click", toggleTheme);
    document.getElementById("btnExport").addEventListener("click", exportBackup);
    document.getElementById("btnImport").addEventListener("click", importBackup);

    document.getElementById("tabEstudos").addEventListener("click", function () { switchTab("estudos"); });
    document.getElementById("tabErros").addEventListener("click", function () { switchTab("erros"); });
    document.getElementById("tabFlash").addEventListener("click", function () { switchTab("flash"); });

    document.getElementById("prevDay").addEventListener("click", function () { shiftDate(-1); });
    document.getElementById("nextDay").addEventListener("click", function () { shiftDate(1); });
    document.getElementById("clearDay").addEventListener("click", clearDay);

    document.getElementById("addSubjEstudos").addEventListener("click", async function () {
      var i = document.getElementById("newSubjEstudos"); if (await addSubject(i.value)) i.value = "";
    });
    document.getElementById("newSubjEstudos").addEventListener("keydown", async function (e) {
      if (e.key === "Enter") { if (await addSubject(this.value)) this.value = ""; }
    });
    document.getElementById("addSubjErros").addEventListener("click", async function () {
      var i = document.getElementById("newSubjErros"); if (await addSubject(i.value)) i.value = "";
    });
    document.getElementById("newSubjErros").addEventListener("keydown", async function (e) {
      if (e.key === "Enter") { if (await addSubject(this.value)) this.value = ""; }
    });
    document.getElementById("addSubjFlash").addEventListener("click", async function () {
      var i = document.getElementById("newSubjFlash"); if (await addSubject(i.value)) i.value = "";
    });
    document.getElementById("newSubjFlash").addEventListener("keydown", async function (e) {
      if (e.key === "Enter") { if (await addSubject(this.value)) this.value = ""; }
    });

    document.getElementById("addErr").addEventListener("click", addErr);
    document.getElementById("errTopic").addEventListener("keydown", function (e) { if (e.key === "Enter") addErr(); });
    document.getElementById("errLesson").addEventListener("keydown", function (e) { if (e.key === "Enter") addErr(); });

    document.getElementById("toggleRevised").addEventListener("click", function () { showRevised = !showRevised; renderErros(); });

    document.getElementById("fcAdd").addEventListener("click", addFlashcard);
    document.getElementById("fcFront").addEventListener("keydown", function (e) { if (e.key === "Enter") addFlashcard(); });
    document.getElementById("fcBack").addEventListener("keydown", function (e) { if (e.key === "Enter") addFlashcard(); });
    document.getElementById("fcStudyStart").addEventListener("click", startFlashSession);
    document.getElementById("fcStudyStop").addEventListener("click", stopFlashSession);
    document.getElementById("fcCard").addEventListener("click", flipFlashcard);
    document.getElementById("fcWrong").addEventListener("click", function () { answerFlashcard(false); });
    document.getElementById("fcRight").addEventListener("click", function () { answerFlashcard(true); });

    // delegação de cliques
    document.body.addEventListener("click", function (ev) {
      var t = ev.target;
      if (t.hasAttribute("data-min")) { updateEntry(t.getAttribute("data-min"), "min", parseInt(t.getAttribute("data-d"), 10)); }
      else if (t.hasAttribute("data-q")) { updateEntry(t.getAttribute("data-q"), "q", parseInt(t.getAttribute("data-d"), 10)); }
      else if (t.hasAttribute("data-rm-subj")) { removeSubject(t.getAttribute("data-rm-subj")); }
      else if (t.hasAttribute("data-rename-subj")) { startRenameSubject(t.getAttribute("data-rename-subj")); }
      else if (t.hasAttribute("data-sort")) { subjectRankSort = t.getAttribute("data-sort"); renderSubjectRanking(); }
      else if (t.hasAttribute("data-edit-min")) { startMinEdit(t.getAttribute("data-edit-min")); }
      else if (t.hasAttribute("data-reason")) { errReason = t.getAttribute("data-reason"); renderErros(); }
      else if (t.hasAttribute("data-filter")) { errFilter = t.getAttribute("data-filter"); renderErros(); }
      else if (t.hasAttribute("data-rev")) { toggleRev(t.getAttribute("data-rev")); }
      else if (t.hasAttribute("data-rm-err")) { removeErr(t.getAttribute("data-rm-err")); }
      else if (t.hasAttribute("data-heatdate")) { viewDate = t.getAttribute("data-heatdate"); renderEstudos(); }
      else if (t.hasAttribute("data-fcfilter")) { fcFilter = t.getAttribute("data-fcfilter"); renderFlash(); }
      else if (t.hasAttribute("data-fc-edit")) { startEditFlashcard(t.getAttribute("data-fc-edit")); }
      else if (t.hasAttribute("data-fc-rm")) { removeFlashcard(t.getAttribute("data-fc-rm")); }
      else if (t.hasAttribute("data-fc-save")) { saveEditFlashcard(t.getAttribute("data-fc-save")); }
      else if (t.hasAttribute("data-fc-cancel")) { cancelEditFlashcard(); }
    });

    // input de questões (digitar direto)
    document.body.addEventListener("change", function (ev) {
      var t = ev.target;
      if (t.hasAttribute("data-qinput")) { setEntryQ(t.getAttribute("data-qinput"), t.value); }
      else if (t.hasAttribute("data-mininput")) { setEntryMin(t.getAttribute("data-mininput"), t.value); }
    });

    // dispara sempre ao perder o foco (Enter sem alterar o texto não gera "change")
    document.body.addEventListener("focusout", function (ev) {
      var t = ev.target;
      if (!t.hasAttribute || !t.hasAttribute("data-renameinput")) return;
      var subj = t.getAttribute("data-renameinput");
      if (renamingSubject === subj) commitRenameSubject(subj, t.value);
    });

    // Enter salva / Esc cancela a edição manual de minutos e o renomear de matéria
    document.body.addEventListener("keydown", function (ev) {
      var t = ev.target;
      if (!t.hasAttribute) return;
      if (t.hasAttribute("data-mininput")) {
        if (ev.key === "Enter") { t.blur(); }
        else if (ev.key === "Escape") { cancelMinEdit(); }
      } else if (t.hasAttribute("data-renameinput")) {
        if (ev.key === "Enter") { commitRenameSubject(t.getAttribute("data-renameinput"), t.value); }
        else if (ev.key === "Escape") { cancelRenameSubject(); }
      }
    });

    // cronômetro
    document.getElementById("timerMode_stopwatch").addEventListener("click", function () { setTimerMode("stopwatch"); });
    document.getElementById("timerMode_countdown").addEventListener("click", function () { setTimerMode("countdown"); });
    document.getElementById("timerMode_pomodoro").addEventListener("click", function () { setTimerMode("pomodoro"); });
    document.getElementById("timerSubject").addEventListener("change", function () {
      if (timerStatus === "idle") timerSubject = this.value;
      renderTimer();
    });
    document.getElementById("timerStart").addEventListener("click", startTimer);
    document.getElementById("timerPause").addEventListener("click", pauseTimer);
    document.getElementById("timerFinish").addEventListener("click", finalizeTimer);
    document.getElementById("timerCountdownMin").addEventListener("change", function () {
      var v = Math.max(1, Math.min(300, parseInt(this.value, 10) || 25));
      timerCountdownDurationMin = v; this.value = v;
      if (timerStatus === "idle") timerCountdownRemainingSec = v * 60;
      renderTimer();
    });
    document.getElementById("timerPomodoroFoco").addEventListener("change", function () {
      var v = Math.max(1, Math.min(120, parseInt(this.value, 10) || 25));
      timerPomodoroFocoMin = v; this.value = v;
      if (timerStatus === "idle") timerPomodoroRemainingSec = v * 60;
      renderTimer();
    });
    document.getElementById("timerPomodoroPausa").addEventListener("change", function () {
      var v = Math.max(1, Math.min(60, parseInt(this.value, 10) || 5));
      timerPomodoroPausaMin = v; this.value = v;
      renderTimer();
    });
  }

  async function toggleRev(id) {
    await window.api.mistakes.toggleRevised(id);
    entries = await window.api.mistakes.list();
    renderErros();
  }
  async function removeErr(id) {
    await window.api.mistakes.remove(id);
    entries = await window.api.mistakes.list();
    renderErros(); flash("Removido");
  }

  function switchTab(tab) {
    currentTab = tab;
    document.getElementById("tabEstudos").classList.toggle("on", tab === "estudos");
    document.getElementById("tabErros").classList.toggle("on", tab === "erros");
    document.getElementById("tabFlash").classList.toggle("on", tab === "flash");
    document.getElementById("viewEstudos").classList.toggle("hide", tab !== "estudos");
    document.getElementById("viewErros").classList.toggle("hide", tab !== "erros");
    document.getElementById("viewFlash").classList.toggle("hide", tab !== "flash");
  }

  // ————— init —————
  async function init() {
    applyTheme();
    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        var stored = getStoredTheme();
        if (stored !== "light" && stored !== "dark") applyTheme();
      });
    }
    bind();
    await load();
    renderAll();
  }
  init();
})();
