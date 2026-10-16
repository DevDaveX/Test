'use strict';

const state = {
  vehicles: [],
  currentView: 'dashboard',
  vehicleStatusFilter: 'all',
  monthFilter: null,
  sortField: null,
  sortDirection: 'asc',
};

function $(sel, root) {
  return (root || document).querySelector(sel);
}

function $$(sel, root) {
  return Array.from((root || document).querySelectorAll(sel));
}

const CATEGORY_LABELS = {
  hu: 'TÜV / HU',
  sp: 'SP',
  tacho: 'Tachoprüfung',
  first_aid: 'Erste-Hilfe-Kasten',
  fire_extinguisher: 'Feuerlöscher'
};

const VIEW_TITLES = {
  dashboard: 'Fahrzeugübersicht',
  vehicles: 'Busse & Fahrzeuge',
  history: 'Prüfhistorie',
  notifications: 'Benachrichtigungen',
  settings: 'Terminal',
};

function escapeHtml(val) {
  return String(val == null ? '' : val).replace(/[&<>'"]/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch];
  });
}

function isPlaceholderDate(val) {
  if (!val) return true;
  const s = String(val).trim();
  return s.startsWith('1970-01-01') || s.startsWith('01.01.1970');
}

function isPkw(plate) {
  if (!plate) return false;
  const p = String(plate).trim().toUpperCase().replace(/\s+/g, '-');
  return p === 'HAM-KV-21';
}

function parseDateOnly(val) {
  if (!val || isPlaceholderDate(val)) return null;
  const parts = String(val).split('-').map(Number);
  if (parts.length === 3 && !isNaN(parts[0])) {
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
  }
  if (parts.length === 2 && !isNaN(parts[0])) {
    return new Date(parts[0], parts[1], 0, 12);
  }
  return null;
}

function getEffectiveDeadline(category, dateStr) {
  if (!dateStr || isPlaceholderDate(dateStr)) return null;
  const d = parseDateOnly(dateStr);
  if (!d || isNaN(d.getTime())) return null;

  if (category === 'hu' || category === 'sp') {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}

function calculateEffectiveStatus(category, dateStr, serverStatus, plate) {
  if (isPkw(plate) && (category === 'sp' || category === 'tacho')) {
    return { level: 'pkw-exempt', label: 'Entfällt (PKW)', days: null, icon: '✓' };
  }

  if (isPlaceholderDate(dateStr)) {
    return { level: 'placeholder', label: 'Unbekannt', days: null, icon: '⚠️' };
  }

  const deadline = getEffectiveDeadline(category, dateStr);
  if (!deadline) return serverStatus || { level: 'none', label: '–', days: null, icon: '•' };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
  const target = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate(), 12, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    return {
      level: 'overdue',
      days: diffDays,
      icon: '!',
      label: overdueDays === 1 ? 'Gestern überfällig' : overdueDays + ' Tage überfällig'
    };
  }

  if (diffDays === 0) {
    return { level: 'critical', days: 0, icon: '!', label: 'Heute letzter Tag!' };
  }

  if (diffDays <= 7) {
    return { level: 'critical', days: diffDays, icon: '!', label: 'In ' + diffDays + ' Tagen' };
  }

  if (diffDays <= 30) {
    return { level: 'warning', days: diffDays, icon: '!', label: 'In ' + diffDays + ' Tagen' };
  }

  return { level: 'ok', days: diffDays, icon: '✓', label: 'In Ordnung' };
}

function formatInspectionDate(category, val) {
  if (!val || isPlaceholderDate(val)) return '–';
  const d = parseDateOnly(val);
  if (!d || isNaN(d.getTime())) return '–';

  if (category === 'hu' || category === 'sp') {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return m + '.' + d.getFullYear();
  }

  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function formatDate(val) {
  if (!val || isPlaceholderDate(val)) return '–';
  const d = parseDateOnly(val);
  if (!d || isNaN(d.getTime())) return '–';
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

function calculateTachoNextDue(day, month, year) {
  if (!day || !month || !year) return null;
  const targetYear = Number(year) + 2;

  if (Number(month) === 2 && Number(day) === 29) {
    const isTargetLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || (targetYear % 400 === 0);
    if (!isTargetLeap) {
      return { day: 28, month: 2, year: targetYear };
    }
  }

  return { day: Number(day), month: Number(month), year: targetYear };
}

const TUEV_YEAR_COLORS = {
  2024: '#e06666',
  2025: '#45818e',
  2026: '#274e13',
  2027: '#f1c232',
  2028: '#b45f06',
  2029: '#d5a6bd',
  2030: '#45818e',
  2031: '#f1c232',
  2032: '#b45f06',
};

function formatLicensePlateHTML(rawPlate, huDueDateStr, isSmall) {
  if (!rawPlate) return '–';
  const clean = String(rawPlate).trim().toUpperCase();
  const parts = clean.split('-').filter(Boolean);

  let city = parts[0] || 'HAM';
  let restText = parts.slice(1).join(' ') || '';

  let tuevMonth = 9;
  let tuevYear = 2026;
  if (huDueDateStr && !isPlaceholderDate(huDueDateStr)) {
    const d = parseDateOnly(huDueDateStr);
    if (d && !isNaN(d.getTime())) {
      tuevMonth = d.getMonth() + 1;
      tuevYear = d.getFullYear();
    }
  }

  const tuevColor = TUEV_YEAR_COLORS[tuevYear] || '#f1c232';
  const yearShort = String(tuevYear).slice(-2);
  const rotDeg = (tuevMonth % 12) * 30;

  const smClass = isSmall ? 'plate-sm' : '';

  return (
    '<span class="license-plate ' + smClass + '" aria-label="' + escapeHtml(clean) + '">' +
    '<span class="plate-blue-euro">' +
    '<svg class="plate-stars-circle" viewBox="0 0 30 30">' +
    '<circle cx="15" cy="4" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="20.5" cy="5.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="24.5" cy="9.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="26" cy="15" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="24.5" cy="20.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="20.5" cy="24.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="15" cy="26" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="9.5" cy="24.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="5.5" cy="20.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="4" cy="15" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="5.5" cy="9.5" r="1.5" fill="#FFCC00"/>' +
    '<circle cx="9.5" cy="5.5" r="1.5" fill="#FFCC00"/>' +
    '</svg>' +
    '<span class="plate-letter-d">D</span>' +
    '</span>' +
    '<span class="plate-part-city">' + escapeHtml(city) + '</span>' +
    '<span class="plate-badge-stack">' +
    '<span class="tuev-plakette" style="background-color: ' + tuevColor + ';" title="TÜV: ' + String(tuevMonth).padStart(2, '0') + '.' + tuevYear + '">' +
    '<svg class="tuev-segment" viewBox="0 0 30 30" style="transform: rotate(' + rotDeg + 'deg);">' +
    '<path d="M 12 1 L 18 1 L 16 8 L 14 8 Z" fill="#000000"/>' +
    '</svg>' +
    '<span class="tuev-plakette-inner">' + yearShort + '</span>' +
    '</span>' +
    '<span class="zulassung-siegel" title="Zulassungsbezirk Hamm">' +
    '<svg viewBox="0 0 20 20">' +
    '<path d="M 4 4 L 16 4 L 16 11 Q 16 16 10 18 Q 4 16 4 11 Z" fill="#2E7D32"/>' +
    '<path d="M 10 4 L 16 4 L 16 11 Q 16 16 10 18 Z" fill="#C62828"/>' +
    '<path d="M 6 6 Q 10 10 14 14" stroke="#FFFFFF" stroke-width="2" fill="none"/>' +
    '</svg>' +
    '</span>' +
    '</span>' +
    '<span class="plate-part-code">' + escapeHtml(restText) + '</span>' +
    '</span>'
  );
}

function normalizeVehicleData(row) {
  const plate = row.kennzeichen || row.plate || '';
  const isVehiclePkw = isPkw(plate);

  const hu_due = row.tuev_monat !== undefined ? row.tuev_monat : row.hu_due;
  let sp_due = row.sp_monat !== undefined ? row.sp_monat : row.sp_due;
  let tacho_due = row.tacho_due !== undefined ? row.tacho_due : row.tachoeichung;

  let tacho_last = row.tacho_last !== undefined ? row.tacho_last : null;
  let hu_last = row.hu_last !== undefined ? row.hu_last : null;
  let sp_last = row.sp_last !== undefined ? row.sp_last : null;

  let tacho_due_manual = row.tacho_due_manual !== undefined ? row.tacho_due_manual : 0;
  let hu_due_manual = row.hu_due_manual !== undefined ? row.hu_due_manual : 0;
  let sp_due_manual = row.sp_due_manual !== undefined ? row.sp_due_manual : 0;

  if (isVehiclePkw) {
    sp_due = null;
    tacho_due = null;
    tacho_last = null;
    sp_last = null;
    tacho_due_manual = 0;
    sp_due_manual = 0;
  }

  let nextApp = null;
  let minDeadline = null;

  const checkCats = isVehiclePkw ? ['hu'] : ['hu', 'sp', 'tacho'];

  checkCats.forEach(function (cat) {
    const val =
      cat === 'hu'
        ? hu_due
        : (cat === 'sp' ? sp_due : tacho_due);

    if (!val || isPlaceholderDate(val)) return;

    const dl = getEffectiveDeadline(cat, val);

    if (dl && (!minDeadline || dl < minDeadline)) {
      minDeadline = dl;
      nextApp = {
        category: cat,
        due: val
      };
    }
  });

  return {
    id: row.id,
    plate: plate,
    is_pkw: isVehiclePkw,

    first_registration: row.first_registration || null,

    hu_last: hu_last,
    hu_due: hu_due,
    hu_due_manual: hu_due_manual,

    sp_last: sp_last,
    sp_due: sp_due,
    sp_due_manual: sp_due_manual,

    tacho_last: tacho_last,
    tacho_due: tacho_due,
    tacho_due_manual: tacho_due_manual,

    first_aid_due: row.first_aid_due || null,
    fire_extinguisher_due: row.fire_extinguisher_due || null,

    next_appointment: nextApp,
    status: row.status || null
  };
}

async function api(url, opts) {
  opts = opts || {};

  const headers = Object.assign(
    {},
    opts.body !== undefined
      ? { 'Content-Type': 'application/json' }
      : {},
    opts.headers || {}
  );

  const resp = await fetch(
    url,
    Object.assign({}, opts, { headers: headers })
  );

  if (!resp.ok) {
    let errorMessage = 'API Fehler (' + resp.status + ')';

    try {
      const errorData = await resp.json();

      if (errorData && errorData.detail) {
        if (typeof errorData.detail === 'string') {
          errorMessage += ': ' + errorData.detail;
        } else {
          errorMessage += ': ' + JSON.stringify(errorData.detail);
        }
      }
    } catch (e) {
      try {
        const text = await resp.text();
        if (text) {
          errorMessage += ': ' + text;
        }
      } catch (ignore) {
        // Keine zusätzliche Fehlermeldung verfügbar
      }
    }

    const error = new Error(errorMessage);
    error.status = resp.status;
    throw error;
  }

  if (resp.status === 204) return null;

  return resp.json();
}

function toast(msg) {
  const c = $('#toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(function () { el.remove(); }, 3500);
}

function setView(view) {
  if (!VIEW_TITLES[view]) return;
  state.currentView = view;

  $$('.view').forEach(function (el) {
    el.classList.remove('active');
  });
  const targetView = $('#' + view + '-view');
  if (targetView) targetView.classList.add('active');

  $$('[data-view]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  const title = $('#page-title');
  if (title) title.textContent = VIEW_TITLES[view];

  if (view === 'history') loadHistory();
  window.scrollTo(0, 0);
}

function getVehicleStatusSummary(v) {
  if (v.is_pkw) {
    const huDue = v.hu_due;
    if (huDue && !isPlaceholderDate(huDue)) {
      const stat = calculateEffectiveStatus('hu', huDue, null, v.plate);
      if (stat.days !== null && stat.days < 0) {
        return { text: '⚠️ TÜV (' + formatInspectionDate('hu', huDue) + ') abgelaufen! [PKW]', type: 'overdue' };
      }
      return { text: '🚐 PKW / Werkstatt-Bulli · TÜV fällig ' + formatInspectionDate('hu', huDue), type: 'ok' };
    }
    return { text: '🚐 PKW / Werkstatt-Bulli (Keine SP/Tacho)', type: 'ok' };
  }

  const categories = ['sp', 'hu', 'tacho'];
  let worst = null;

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const due = v[cat + '_due'];
    if (!due || isPlaceholderDate(due)) continue;

    const stat = calculateEffectiveStatus(cat, due, v.status ? v.status[cat] : null, v.plate);

    if (stat.days !== null && stat.days < 0) {
      return {
        text: '⚠️ ' + (CATEGORY_LABELS[cat] || cat) + ' (' + formatInspectionDate(cat, due) + ') seit ' + Math.abs(stat.days) + ' Tagen überfällig!',
        type: 'overdue'
      };
    }
    if (stat.days !== null && stat.days <= 30) {
      if (!worst || (stat.days < worst.days)) {
        worst = {
          days: stat.days,
          text: (CATEGORY_LABELS[cat] || cat) + ' fällig am ' + formatInspectionDate(cat, due) + ' (in ' + stat.days + ' Tagen)',
          type: 'warning'
        };
      }
    }
  }

  if (worst) return worst;
  if (v.next_appointment) {
    return {
      text: 'Nächste: ' + (CATEGORY_LABELS[v.next_appointment.category] || v.next_appointment.category) + ' am ' + formatInspectionDate(v.next_appointment.category, v.next_appointment.due),
      type: 'ok'
    };
  }

  return { text: 'Alle Fristen aktuell', type: 'ok' };
}

function handleLiveSearch(query) {
  const dropdown = $('#search-dropdown');
  const clearBtn = $('#clear-search');
  if (!dropdown) return;

  const q = (query || '').trim().toUpperCase();
  if (clearBtn) clearBtn.classList.toggle('hidden', q.length === 0);

  if (!q) {
    dropdown.innerHTML = '';
    dropdown.classList.add('hidden');
    return;
  }

  const matches = state.vehicles.filter(function (v) {
    return (v.plate || '').toUpperCase().includes(q);
  });

  if (!matches.length) {
    dropdown.innerHTML = '<div class="search-no-results">Kein Fahrzeug mit <strong>"' + escapeHtml(q) + '"</strong> gefunden.</div>';
    dropdown.classList.remove('hidden');
    return;
  }

  dropdown.innerHTML = matches.map(function (v) {
    const summary = getVehicleStatusSummary(v);
    return (
      '<button class="search-item" data-open-vehicle="' + v.id + '" type="button">' +
      '<div class="search-item-head">' +
      formatLicensePlateHTML(v.plate, v.hu_due, true) +
      '<small style="color: var(--muted);">' + (v.is_pkw ? '🚐 PKW' : (v.first_registration ? 'EZ ' + formatDate(v.first_registration) : '')) + '</small>' +
      '</div>' +
      '<div class="search-item-info ' + summary.type + '">' + escapeHtml(summary.text) + '</div>' +
      '</button>'
    );
  }).join('');

  dropdown.classList.remove('hidden');
}

function renderForecast() {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const months = [0, 1, 2].map(function (offset) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return {
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' }),
      vehicles: new Set(),
      hu: 0,
      sp: 0,
      tacho: 0,
      overdue: 0
    };
  });

  const ids = ['current', 'next', 'after-next'];
  ids.forEach(function (id, idx) {
    const el = $('#forecast-' + id + '-title');
    if (el) el.textContent = months[idx].label;
  });

  state.vehicles.forEach(function (v) {
    const checks = v.is_pkw ? [{ key: 'hu_due', type: 'hu' }] : [
      { key: 'hu_due', type: 'hu' },
      { key: 'sp_due', type: 'sp' },
      { key: 'tacho_due', type: 'tacho' }
    ];

    checks.forEach(function (c) {
      const val = v[c.key];
      if (!val || isPlaceholderDate(val)) return;
      const deadline = getEffectiveDeadline(c.type, val);
      if (!deadline) return;

      if (deadline < currentMonthStart) {
        months[0].vehicles.add(v.id);
        months[0][c.type]++;
        months[0].overdue++;
        return;
      }

      months.forEach(function (m) {
        if (deadline.getFullYear() === m.year && deadline.getMonth() === m.month) {
          m.vehicles.add(v.id);
          m[c.type]++;
        }
      });
    });
  });

  ids.forEach(function (id, idx) {
    const m = months[idx];
    const cEl = $('#forecast-' + id + '-count');
    const huEl = $('#forecast-' + id + '-hu');
    const spEl = $('#forecast-' + id + '-sp');
    const tachoEl = $('#forecast-' + id + '-tacho');

    if (cEl) cEl.textContent = m.vehicles.size;
    if (huEl) huEl.textContent = m.hu;
    if (spEl) spEl.textContent = m.sp;
    if (tachoEl) tachoEl.textContent = m.tacho;
  });

  const odTag = $('#forecast-current-overdue-tag');
  const odCount = $('#forecast-current-overdue');
  const pillEl = $('#forecast-current-pill');
  if (odTag && odCount) {
    if (months[0].overdue > 0) {
      odTag.classList.remove('hidden');
      odCount.textContent = months[0].overdue;
      if (pillEl) pillEl.textContent = 'Dringend: Überfällige Fristen!';
    } else {
      odTag.classList.add('hidden');
      if (pillEl) pillEl.textContent = 'Aktueller Monat';
    }
  }
}

function renderStats() {
  const appointments = state.vehicles.flatMap(function (v) {
    const cats = v.is_pkw ? ['hu'] : ['hu', 'sp', 'tacho', 'first_aid', 'fire_extinguisher'];
    return cats
      .filter(function (cat) { return Boolean(v[cat + '_due']) && !isPlaceholderDate(v[cat + '_due']); })
      .map(function (cat) {
        return {
          status: calculateEffectiveStatus(cat, v[cat + '_due'], v.status ? v.status[cat] : null, v.plate)
        };
      });
  });

  const tot = $('#stat-total');
  const od = $('#stat-overdue');
  const d7 = $('#stat-7');
  const d30 = $('#stat-30');
  const ok = $('#stat-ok');

  if (tot) tot.textContent = state.vehicles.length;
  if (od) od.textContent = appointments.filter(function (i) { return i.status && i.status.days < 0; }).length;
  if (d7) d7.textContent = appointments.filter(function (i) { return i.status && i.status.days >= 0 && i.status.days <= 7; }).length;
  if (d30) d30.textContent = appointments.filter(function (i) { return i.status && i.status.days >= 0 && i.status.days <= 30; }).length;
  if (ok) {
    ok.textContent = state.vehicles.filter(function (v) {
      const cats = v.is_pkw ? ['hu'] : ['hu', 'sp', 'tacho', 'first_aid', 'fire_extinguisher'];
      return cats.every(function (cat) {
        if (!v[cat + '_due'] || isPlaceholderDate(v[cat + '_due'])) return true;
        const s = calculateEffectiveStatus(cat, v[cat + '_due'], v.status ? v.status[cat] : null, v.plate);
        return s.days === null || s.days > 30;
      });
    }).length;
  }
}

function statusBadge(s) {
  if (!s) return '<span class="status-badge none">OK</span>';
  if (s.level === 'pkw-exempt') {
    return '<span class="status-badge ok" style="opacity: 0.85;">Entfällt (PKW)</span>';
  }
  if (s.level === 'placeholder') {
    return '<span class="status-badge warning" style="color: #ffcc00; border-color: rgba(255, 204, 0, 0.4);">⚠️ Unbekannt</span>';
  }
  return '<span class="status-badge ' + (s.level || 'none') + '">' + escapeHtml(s.label || 'OK') + '</span>';
}

function renderVehicles() {
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  let list = state.vehicles.filter(function (v) {
    if (state.monthFilter) {
      const mf = state.monthFilter;
      const cats = v.is_pkw ? ['hu'] : ['hu', 'sp', 'tacho'];
      const match = cats.some(function (cat) {
        const val = v[cat + '_due'];
        if (!val || isPlaceholderDate(val)) return false;
        const deadline = getEffectiveDeadline(cat, val);
        if (!deadline) return false;
        if (mf.includeOverdue && deadline < currentMonthStart) return true;
        return deadline.getFullYear() === mf.year && deadline.getMonth() === mf.month;
      });
      if (!match) return false;
    }

    if (state.vehicleStatusFilter !== 'all') {
      const cats = v.is_pkw ? ['hu'] : ['hu', 'sp', 'tacho', 'first_aid', 'fire_extinguisher'];
      const stats = cats.map(function (c) {
        return (v[c + '_due'] && !isPlaceholderDate(v[c + '_due']))
          ? calculateEffectiveStatus(c, v[c + '_due'], v.status ? v.status[c] : null, v.plate)
          : null;
      }).filter(Boolean);

      if (state.vehicleStatusFilter === 'overdue') return stats.some(function (s) { return s.days !== null && s.days < 0; });
      if (state.vehicleStatusFilter === 'today') return stats.some(function (s) { return s.days === 0; });
      if (state.vehicleStatusFilter === 'ok') return stats.every(function (s) { return s.days === null || s.days > 30; });
      const maxDays = Number(state.vehicleStatusFilter);
      return stats.some(function (s) { return s.days !== null && s.days >= 0 && s.days <= maxDays; });
    }

    return true;
  });

  if (state.sortField) {
    const field = state.sortField;
    const dir = state.sortDirection === 'asc' ? 1 : -1;

    list.sort(function (a, b) {
      let valA, valB;

      if (field === 'plate') {
        valA = (a.plate || '').toUpperCase();
        valB = (b.plate || '').toUpperCase();
        return valA.localeCompare(valB) * dir;
      } else if (field === 'tacho' || field === 'hu' || field === 'sp' || field === 'first_aid' || field === 'fire_extinguisher') {
        const key = field === 'hu' ? 'hu_due' : (field === 'sp' ? 'sp_due' : (field === 'tacho' ? 'tacho_due' : field + '_due'));
        valA = parseDateOnly(a[key]) ? parseDateOnly(a[key]).getTime() : (dir > 1 ? 9999999999999 : -1);
        valB = parseDateOnly(b[key]) ? parseDateOnly(b[key]).getTime() : (dir > 1 ? 9999999999999 : -1);
        return (valA - valB) * dir;
      } else if (field === 'next') {
        const dlA = a.next_appointment && a.next_appointment.due ? getEffectiveDeadline(a.next_appointment.category, a.next_appointment.due)?.getTime() || 9999999999999 : 9999999999999;
        const dlB = b.next_appointment && b.next_appointment.due ? getEffectiveDeadline(b.next_appointment.category, b.next_appointment.due)?.getTime() || 9999999999999 : 9999999999999;
        return (dlA - dlB) * dir;
      }
      return 0;
    });
  }

  $$('.kiese-table th[data-sort]').forEach(function (th) {
    const f = th.dataset.sort;
    th.classList.remove('sort-asc', 'sort-desc');
    if (f === state.sortField) {
      th.classList.add(state.sortDirection === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });

  const empty = $('#vehicle-empty');
  if (empty) empty.classList.toggle('hidden', list.length !== 0);

  const tbody = $('#vehicle-table-body');
  if (!tbody) return;

  tbody.innerHTML = list.map(function (v) {
    const next = v.next_appointment;
    const huStat = calculateEffectiveStatus('hu', v.hu_due, v.status ? v.status.hu : null, v.plate);
    const spStat = calculateEffectiveStatus('sp', v.sp_due, v.status ? v.status.sp : null, v.plate);
    const tachoStat = calculateEffectiveStatus('tacho', v.tacho_due, v.status ? v.status.tacho : null, v.plate);

    function renderCellWithQuickRenew(cat, due, stat) {
      if (v.is_pkw && (cat === 'sp' || cat === 'tacho')) {
        return '<div class="date-cell-with-action"><span style="color: var(--muted); font-size: 11px;">Entfällt (PKW)</span></div>';
      }

      if (isPlaceholderDate(due)) {
        return (
          '<div class="date-cell-with-action">' +
          '<span class="status-badge placeholder">⚠️ Unbekannt</span>' +
          '<button class="renew-action-btn" data-quick-renew="' + v.id + ':' + cat + '" type="button" style="background: rgba(255, 204, 0, 0.2); border-color: #ffcc00; color: #fff;">✏️ Ergänzen</button>' +
          '</div>'
        );
      }

      const isUrgent = stat && stat.days !== null && stat.days <= 30;
      return (
        '<div class="date-cell-with-action">' +
        '<span style="font-weight: 600; font-size: 13px;">' + formatInspectionDate(cat, due) + '</span>' +
        (stat ? statusBadge(stat) : '') +
        (isUrgent ? '<button class="renew-action-btn ' + (stat.days < 0 ? 'urgent' : '') + '" data-quick-renew="' + v.id + ':' + cat + '" type="button" style="margin-top: 4px;">⚡ Erneuern</button>' : '') +
        '</div>'
      );
    }

    let nextLabel = '–';
    if (next && next.due && !isPlaceholderDate(next.due)) {
      const effStat = calculateEffectiveStatus(next.category, next.due, next.status, v.plate);
      nextLabel = (
        '<div class="date-cell-with-action">' +
        '<strong style="color: #dec3ff; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;">' + (CATEGORY_LABELS[next.category] || next.category) + '</strong>' +
        '<span style="font-weight: 600; font-size: 13px;">' + formatInspectionDate(next.category, next.due) + '</span>' +
        statusBadge(effStat) +
        '</div>'
      );
    } else if (v.is_pkw) {
      nextLabel = (
        '<div class="date-cell-with-action">' +
        '<strong style="color: #dec3ff; font-size: 12px; text-transform: uppercase;">TÜV / HU</strong>' +
        '<span style="font-weight: 600;">' + formatInspectionDate('hu', v.hu_due) + '</span>' +
        '</div>'
      );
    }

    return (
      '<tr>' +
      '<td>' +
      '<button class="link-btn" data-detail="' + v.id + '" type="button">' + formatLicensePlateHTML(v.plate, v.hu_due) + '</button>' +
      (v.is_pkw ? '<span class="status-badge" style="display:block; margin-top:4px; font-size:10px; background: rgba(142, 94, 194, 0.2); color: #dec3ff; border: 1px solid rgba(142,94,194,0.4);">🚐 PKW / Werkstatt-Bulli</span>' : '') +
      '</td>' +
      '<td>' + renderCellWithQuickRenew('tacho', v.tacho_due, tachoStat) + '</td>' +
      '<td>' + renderCellWithQuickRenew('hu', v.hu_due, huStat) + '</td>' +
      '<td>' + renderCellWithQuickRenew('sp', v.sp_due, spStat) + '</td>' +
      '<td>' + formatInspectionDate('first_aid', v.first_aid_due) + '</td>' +
      '<td>' + formatInspectionDate('fire_extinguisher', v.fire_extinguisher_due) + '</td>' +
      '<td>' + nextLabel + '</td>' +
      '<td style="text-align:right"><button class="action-button" data-detail="' + v.id + '" type="button" title="Fahrzeug öffnen">•••</button></td>' +
      '</tr>'
    );
  }).join('');
}

function renderUpcoming() {
  const container = $('#upcoming-list');
  if (!container) return;

  const items = state.vehicles
    .filter(function (v) { return Boolean(v.next_appointment && v.next_appointment.due && !isPlaceholderDate(v.next_appointment.due)); })
    .sort(function (a, b) {
      const dateA = getEffectiveDeadline(a.next_appointment.category, a.next_appointment.due) || new Date(0);
      const dateB = getEffectiveDeadline(b.next_appointment.category, b.next_appointment.due) || new Date(0);
      return dateA.getTime() - dateB.getTime();
    })
    .slice(0, 10);

  if (!items.length) {
    container.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--muted);">Keine Termine anstehend.</div>';
    return;
  }

  container.innerHTML = items.map(function (v) {
    const next = v.next_appointment;
    const effStatus = calculateEffectiveStatus(next.category, next.due, next.status, v.plate);
    const isOverdue = effStatus.days !== null && effStatus.days < 0;

    const cats = v.is_pkw ? [] : ['hu', 'sp', 'tacho', 'first_aid', 'fire_extinguisher'];
    const furtherAppointments = cats
      .filter(function (cat) { return cat !== next.category && v[cat + '_due'] && !isPlaceholderDate(v[cat + '_due']); })
      .map(function (cat) {
        return '<span><small>' + (CATEGORY_LABELS[cat] || cat) + '</small><strong>' + formatInspectionDate(cat, v[cat + '_due']) + '</strong></span>';
      })
      .join('');

    return (
      '<div class="upcoming-item">' +
      '<div class="upcoming-vehicle">' +
      formatLicensePlateHTML(v.plate, v.hu_due) +
      (v.is_pkw
        ? '<small style="margin-top: 4px; color: #dec3ff; font-weight: bold;">🚐 Werkstatt-Bulli (PKW)</small>'
        : '<small style="margin-top: 4px;">' + (v.first_registration ? 'EZ ' + formatDate(v.first_registration) : 'EZ nicht hinterlegt') + '</small>') +
      '</div>' +

      '<div class="upcoming-next">' +
      '<small>Nächster Termin' + (v.is_pkw ? ' (Nur TÜV)' : '') + '</small>' +
      '<div class="upcoming-next-row">' +
      '<strong>' + (CATEGORY_LABELS[next.category] || next.category) + ' · ' + formatInspectionDate(next.category, next.due) + '</strong>' +
      statusBadge(effStatus) +
      '<button class="renew-action-btn" data-quick-renew="' + v.id + ':' + next.category + '" type="button">⚡ Erneuern</button>' +
      '</div>' +
      '</div>' +

      '<div class="upcoming-further">' + furtherAppointments + '</div>' +

      '<button class="ghost-btn" data-detail="' + v.id + '" type="button" title="Details öffnen">Details ›</button>' +
      '</div>'
    );
  }).join('');
}

function renderAll() {
  renderStats();
  renderForecast();
  renderUpcoming();
  renderVehicles();
}

async function loadVehicles() {
  try {
    const rawData = await api('/api/vehicles');
    const rows = Array.isArray(rawData) ? rawData : (rawData.rows || []);
    state.vehicles = rows.map(normalizeVehicleData);
    renderAll();
  } catch (err) {
    toast('Fehler beim Laden der Fahrzeuge');
  }
}

async function loadHistory() {
  const c = $('#global-history');
  if (!c) return;
  c.innerHTML = '<p style="color: var(--muted);">Lade Historie …</p>';
  try {
    const list = await api('/api/history');
    c.innerHTML = list.length ? list.map(function (r) {
      return '<div style="padding: 12px 0; border-bottom: 1px solid var(--line-soft);">' +
        formatLicensePlateHTML(r.plate || r.kennzeichen, null, true) + ' – ' + (CATEGORY_LABELS[r.inspection_type] || r.inspection_type) + ' am ' + formatDate(r.performed_on) +
        '</div>';
    }).join('') : '<p style="color: var(--muted);">Keine Historie vorhanden.</p>';
  } catch (e) {
    c.innerHTML = '<p style="color: var(--muted);">Historie konnte nicht geladen werden.</p>';
  }
}

function fillMonthDropdowns() {
  const monthOptions = [
    { v: '01', l: '01' }, { v: '02', l: '02' }, { v: '03', l: '03' },
    { v: '04', l: '04' }, { v: '05', l: '05' }, { v: '06', l: '06' },
    { v: '07', l: '07' }, { v: '08', l: '08' }, { v: '09', l: '09' },
    { v: '10', l: '10' }, { v: '11', l: '11' }, { v: '12', l: '12' }
  ];

  $$('.month-select').forEach(function (sel) {
    if (sel.children.length === 0) {
      sel.innerHTML = monthOptions.map(function (o) {
        return '<option value="' + o.v + '">' + o.l + '</option>';
      }).join('');
    }
  });
}

function openQuickRenew(vehicleId, category) {
  const v = state.vehicles.find(function (item) { return item.id === Number(vehicleId); });
  if (!v) return;

  const form = $('#quick-renew-form');
  const body = $('#quick-renew-body');
  const plateEl = $('#quick-renew-plate');
  const titleEl = $('#quick-renew-title');
  const diag = $('#quick-renew-dialog');

  if (!form || !body || !diag) return;

  form.elements.vehicle_id.value = v.id;
  form.elements.category.value = category;
  if (plateEl) plateEl.innerHTML = formatLicensePlateHTML(v.plate, v.hu_due, true);

  const isMissingValue = isPlaceholderDate(v[category + '_due']);
  if (titleEl) {
    titleEl.textContent = isMissingValue
      ? (CATEGORY_LABELS[category] || category) + ' nachpflegen'
      : (CATEGORY_LABELS[category] || category) + ' erneuern';
  }

  const now = new Date();
  const curDay = now.getDate();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();

  if (category === 'hu' || category === 'sp') {
    const targetAdd = category === 'hu' ? 12 : 6;
    const defDate = new Date(curYear, (curMonth - 1) + targetAdd, 1);
    const defM = String(defDate.getMonth() + 1).padStart(2, '0');
    const defY = defDate.getFullYear();

    const monthOptionsHtml = [
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'
    ].map(function (m) {
      return '<option value="' + m + '" ' + (m === defM ? 'selected' : '') + '>' + m + '</option>';
    }).join('');

    body.innerHTML = (
      '<label class="field">' +
      '<span>Fälligkeitsmonat (MM.JJJJ)</span>' +
      '<div class="month-input-group">' +
      '<select id="renew-month-select" class="touch-select month-select">' + monthOptionsHtml + '</select>' +
      '<span>.</span>' +
      '<input id="renew-year-input" type="number" min="2020" max="2050" class="kiese-input year-select" value="' + defY + '">' +
      '</div>' +
      '<small class="field-hint">Gültig bis zum Monatsletzten des gewählten Monats.</small>' +
      '</label>' +
      '<div class="quick-pick-row">' +
      '<span class="quick-pick-label">Frist setzen:</span>' +
      '<button type="button" class="quick-btn" data-set-month-offset="3">+ 3 Monate</button>' +
      '<button type="button" class="quick-btn" data-set-month-offset="6">+ 6 Monate</button>' +
      '<button type="button" class="quick-btn" data-set-month-offset="12">+ 1 Jahr</button>' +
      '<button type="button" class="quick-btn" data-set-month-offset="24">+ 2 Jahre</button>' +
      '</div>'
    );
  } else if (category === 'tacho') {
    const nextDueDefault = calculateTachoNextDue(curDay, curMonth, curYear);
    const nextDueFormatted = String(nextDueDefault.day).padStart(2, '0') + '.' + String(nextDueDefault.month).padStart(2, '0') + '.' + nextDueDefault.year;

    body.innerHTML = (
      '<label class="field">' +
      '<span>Prüfung durchgeführt am (TT.MM.JJJJ)</span>' +
      '<div class="date-input-group">' +
      '<input id="renew-tacho-day" type="number" min="1" max="31" class="kiese-input day-field" value="' + curDay + '">' +
      '<span>.</span>' +
      '<input id="renew-tacho-month" type="number" min="1" max="12" class="kiese-input month-field" value="' + curMonth + '">' +
      '<span>.</span>' +
      '<input id="renew-tacho-year" type="number" min="1990" max="2050" class="kiese-input year-field" value="' + curYear + '">' +
      '</div>' +
      '<small class="field-hint">Eichung wird exakt +2 Jahre gerechnet (inkl. 29.02. Schaltjahr-Ausgleich auf 28.02.).</small>' +
      '</label>' +
      '<div class="preview-due-box">' +
      '<span>Nächste Eichung fällig bis einschließlich:</span>' +
      '<strong id="tacho-calculated-preview">' + nextDueFormatted + '</strong>' +
      '</div>'
    );
  } else {
    body.innerHTML = (
      '<label class="field">' +
      '<span>Ablaufdatum (TT.MM.JJJJ)</span>' +
      '<div class="date-input-group">' +
      '<input id="renew-generic-day" type="number" min="1" max="31" class="kiese-input day-field" value="' + curDay + '">' +
      '<span>.</span>' +
      '<input id="renew-generic-month" type="number" min="1" max="12" class="kiese-input month-field" value="' + curMonth + '">' +
      '<span>.</span>' +
      '<input id="renew-generic-year" type="number" min="2020" max="2050" class="kiese-input year-field" value="' + (curYear + 1) + '">' +
      '</div>' +
      '</label>'
    );
  }

  diag.showModal();
}

function openVehicleDetailsById(id) {
  const v = state.vehicles.find(function (item) { return item.id === Number(id); });
  if (!v) return;

  const dTitle = $('#detail-title');
  const dContent = $('#detail-content');
  if (dTitle) dTitle.innerHTML = formatLicensePlateHTML(v.plate, v.hu_due);

  function renderRenewRow(cat, due) {
    if (v.is_pkw && (cat === 'sp' || cat === 'tacho')) {
      return (
        '<div class="detail-renew-item" style="opacity: 0.6;">' +
        '<div><strong>' + (CATEGORY_LABELS[cat] || cat) + '</strong>: Entfällt (Als PKW zugelassen)</div>' +
        '</div>'
      );
    }

    if (isPlaceholderDate(due)) {
      return (
        '<div class="detail-renew-item">' +
        '<div><strong>' + (CATEGORY_LABELS[cat] || cat) + '</strong>: <span style="color: var(--warning); font-weight: bold;">⚠️ Datum unbekannt (Nachzupflegen)</span></div>' +
        '<button class="renew-action-btn" data-quick-renew="' + v.id + ':' + cat + '" type="button" style="background: rgba(255, 204, 0, 0.2); border-color: #ffcc00; color: #fff;">✏ Ergänzen</button>' +
        '</div>'
      );
    }

    const stat = due ? calculateEffectiveStatus(cat, due, v.status ? v.status[cat] : null, v.plate) : null;
    return (
      '<div class="detail-renew-item">' +
      '<div>' +
      '<strong>' + (CATEGORY_LABELS[cat] || cat) + '</strong>: ' + formatInspectionDate(cat, due) + ' ' + (stat ? statusBadge(stat) : '') +
      '</div>' +
      '<button class="renew-action-btn" data-quick-renew="' + v.id + ':' + cat + '" type="button">⚡ Erneuern</button>' +
      '</div>'
    );
  }

  if (dContent) {
    dContent.innerHTML = (
      '<div style="display:grid; gap: 14px;">' +
      (v.is_pkw
        ? '<div class="callout" style="margin: 0; background: rgba(83, 38, 125, 0.25); border-color: var(--kiese-purple-light);"><p style="color: #dec3ff; font-weight: bold;">🚐 Interner Werkstatt-Bulli (PKW-Zulassung) · Ausschließlich TÜV-pflichtig.</p></div>'
        : '<p style="color: var(--muted); margin: 0;"><b>Erstzulassung:</b> ' + (v.first_registration ? formatDate(v.first_registration) : 'Nicht hinterlegt') + '</p>') +
      '<div class="detail-renew-grid">' +
      renderRenewRow('hu', v.hu_due) +
      (!v.is_pkw ? renderRenewRow('sp', v.sp_due) : '') +
      (!v.is_pkw ? renderRenewRow('tacho', v.tacho_due) : '') +
      renderRenewRow('first_aid', v.first_aid_due) +
      renderRenewRow('fire_extinguisher', v.fire_extinguisher_due) +
      '</div>' +
      '<div class="dialog-actions" style="margin-top: 10px; border-top: 1px solid var(--line-soft);">' +
      '<button class="danger-btn" data-actions="' + v.id + '" type="button">Fahrzeug löschen</button>' +
      '</div>' +
      '</div>'
    );
  }
  const dDiag = $('#detail-dialog');
  if (dDiag) dDiag.showModal();
}

function addMonthsToAnlegenInput(category, monthsToAdd) {
  const form = $('#vehicle-form');
  if (!form) return;

  const lastM = Number(form.elements[category + '_last_m']?.value || 1);
  const lastY = Number(form.elements[category + '_last_y']?.value || new Date().getFullYear());

  let baseDate = new Date(lastY, lastM - 1, 1);
  const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthsToAdd, 1);

  const dueMSel = form.elements[category + '_due_m'];
  const dueYInp = form.elements[category + '_due_y'];

  if (dueMSel) dueMSel.value = String(targetDate.getMonth() + 1).padStart(2, '0');
  if (dueYInp) dueYInp.value = targetDate.getFullYear();
}

function bindEvents() {
  document.addEventListener('click', function (e) {
    const vBtn = e.target.closest('[data-view]');
    if (vBtn) {
      e.preventDefault();
      setView(vBtn.dataset.view);
      return;
    }

    const jBtn = e.target.closest('[data-view-jump]');
    if (jBtn) {
      e.preventDefault();
      setView(jBtn.dataset.viewJump);
      return;
    }

    const cBtn = e.target.closest('[data-create]');
    if (cBtn) {
      e.preventDefault();
      const form = $('#vehicle-form');
      if (form) form.reset();
      fillMonthDropdowns();
      const diag = $('#vehicle-dialog');
      if (diag) diag.showModal();
      return;
    }

    const thSort = e.target.closest('th[data-sort]');
    if (thSort) {
      const field = thSort.dataset.sort;
      if (state.sortField === field) {
        state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortField = field;
        state.sortDirection = 'asc';
      }
      renderVehicles();
      return;
    }

    const fCard = e.target.closest('[data-forecast-month]');
    if (fCard) {
      e.preventDefault();
      const target = fCard.dataset.forecastMonth;
      const now = new Date();
      const idx = target === 'next' ? 1 : (target === 'after-next' ? 2 : 0);
      const d = new Date(now.getFullYear(), now.getMonth() + idx, 1);
      state.monthFilter = { year: d.getFullYear(), month: d.getMonth(), includeOverdue: (idx === 0) };
      state.vehicleStatusFilter = 'all';
      setView('vehicles');
      renderVehicles();
      return;
    }

    const searchResultBtn = e.target.closest('[data-open-vehicle]');
    if (searchResultBtn) {
      e.preventDefault();
      const vId = searchResultBtn.dataset.openVehicle;
      const dropdown = $('#search-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
      openVehicleDetailsById(vId);
      return;
    }

    const dBtn = e.target.closest('[data-detail]');
    if (dBtn && !e.target.closest('[data-quick-renew]')) {
      e.preventDefault();
      openVehicleDetailsById(dBtn.dataset.detail);
      return;
    }

    const qrBtn = e.target.closest('[data-quick-renew]');
    if (qrBtn) {
      e.preventDefault();
      e.stopPropagation();
      const parts = qrBtn.dataset.quickRenew.split(':');
      openQuickRenew(parts[0], parts[1]);
      return;
    }

    const qBtn = e.target.closest('[data-add-months]');
    if (qBtn) {
      e.preventDefault();
      const val = qBtn.dataset.addMonths;
      const parts = val.split(':');
      addMonthsToAnlegenInput(parts[0], Number(parts[1]));
      return;
    }

    const offsetBtn = e.target.closest('[data-set-month-offset]');
    if (offsetBtn) {
      e.preventDefault();
      const monthsOffset = Number(offsetBtn.dataset.setMonthOffset);
      const now = new Date();
      const targetDate = new Date(now.getFullYear(), now.getMonth() + monthsOffset, 1);

      const mSelect = $('#renew-month-select');
      const yInput = $('#renew-year-input');
      if (mSelect) mSelect.value = String(targetDate.getMonth() + 1).padStart(2, '0');
      if (yInput) yInput.value = targetDate.getFullYear();
      return;
    }

    const actionsBtn = e.target.closest('[data-actions]');
    if (actionsBtn) {
      e.stopPropagation();
      const vehicleId = actionsBtn.dataset.actions;
      const vehicle = state.vehicles.find(function (item) { return item.id === Number(vehicleId); });
      if (!vehicle) return;
      const delDiag = $('#delete-dialog');
      const delForm = $('#delete-form');
      if (delDiag && delForm) {
        delForm.elements.vehicle_id.value = vehicle.id;
        const dTitle = $('#delete-title');
        if (dTitle) dTitle.innerHTML = 'Fahrzeug ' + escapeHtml(vehicle.plate) + ' löschen?';
        $('#detail-dialog')?.close();
        delDiag.showModal();
      }
      return;
    }

    if (!e.target.closest('.global-search-container')) {
      const dropdown = $('#search-dropdown');
      if (dropdown) dropdown.classList.add('hidden');
    }
  });

  const vForm = $('#vehicle-form');
  if (vForm) {
    function updateTachoDueAnlegen() {
      const d = Number(vForm.elements.tacho_last_day?.value);
      const m = Number(vForm.elements.tacho_last_month?.value);
      const y = Number(vForm.elements.tacho_last_year?.value);
      if (d && m && y) {
        const next = calculateTachoNextDue(d, m, y);
        if (next) {
          vForm.elements.tacho_due_day.value = next.day;
          vForm.elements.tacho_due_month.value = next.month;
          vForm.elements.tacho_due_year.value = next.year;
        }
      }
    }

    ['tacho_last_day', 'tacho_last_month', 'tacho_last_year'].forEach(function (fn) {
      vForm.elements[fn]?.addEventListener('input', updateTachoDueAnlegen);
    });
  }

  function updateQuickRenewTachoPreview() {
    const d = Number($('#renew-tacho-day')?.value);
    const m = Number($('#renew-tacho-month')?.value);
    const y = Number($('#renew-tacho-year')?.value);
    const previewEl = $('#tacho-calculated-preview');
    if (d && m && y && previewEl) {
      const next = calculateTachoNextDue(d, m, y);
      if (next) {
        previewEl.textContent = String(next.day).padStart(2, '0') + '.' + String(next.month).padStart(2, '0') + '.' + next.year;
      }
    }
  }

  document.addEventListener('input', function (e) {
    if (e.target && ['renew-tacho-day', 'renew-tacho-month', 'renew-tacho-year'].includes(e.target.id)) {
      updateQuickRenewTachoPreview();
    }
  });

  const qrForm = $('#quick-renew-form');
  if (qrForm) {
    qrForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      const vId = qrForm.elements.vehicle_id.value;
      const category = qrForm.elements.category.value;

      const vehicle = state.vehicles.find(function (item) {
        return item.id === Number(vId);
      });

      if (!vehicle) {
        toast('Fahrzeug nicht gefunden.');
        return;
      }

      let performedOnFormatted = null;
      let manualDueFormatted = null;

      /*
       * HU / SP
       *
       * Im Dialog wird NICHT das Prüfungsdatum eingegeben,
       * sondern der gewünschte Fälligkeitsmonat.
       *
       * Deshalb:
       * - performed_on = HEUTE
       * - next_sp_due_manual = gewünschte SP-Frist
       *
       * Bei HU berechnet das Backend die nächste HU aus dem
       * tatsächlichen Prüfdatum.
       */
      if (category === 'hu' || category === 'sp') {
        const m = Number($('#renew-month-select')?.value);
        const y = Number($('#renew-year-input')?.value);

        if (!m || !y || m < 1 || m > 12 || y < 2020 || y > 2050) {
          toast('Bitte einen gültigen Monat und ein gültiges Jahr eingeben.');
          return;
        }

        // Letzter Tag des ausgewählten Monats
        const endOfMonth = new Date(y, m, 0, 12);

        manualDueFormatted =
          y + '-' +
          String(m).padStart(2, '0') + '-' +
          String(endOfMonth.getDate()).padStart(2, '0');

        // Tatsächliches Prüfdatum = heute
        const now = new Date();

        performedOnFormatted =
          now.getFullYear() + '-' +
          String(now.getMonth() + 1).padStart(2, '0') + '-' +
          String(now.getDate()).padStart(2, '0');
      }

      /*
       * Tacho
       *
       * Hier wird tatsächlich das Prüfdatum eingegeben.
       */
      else if (category === 'tacho') {
        const d = Number($('#renew-tacho-day')?.value);
        const m = Number($('#renew-tacho-month')?.value);
        const y = Number($('#renew-tacho-year')?.value);

        if (!d || !m || !y) {
          toast('Bitte ein gültiges Prüfdatum eingeben.');
          return;
        }

        const testDate = new Date(y, m - 1, d);

        if (
          testDate.getFullYear() !== y ||
          testDate.getMonth() !== m - 1 ||
          testDate.getDate() !== d
        ) {
          toast('Das eingegebene Tacho-Prüfdatum ist ungültig.');
          return;
        }

        performedOnFormatted =
          y + '-' +
          String(m).padStart(2, '0') + '-' +
          String(d).padStart(2, '0');
      }

      /*
       * Erste-Hilfe / Feuerlöscher
       *
       * Diese beiden Kategorien laufen NICHT über /renew,
       * sondern über PUT /api/vehicles/{id}.
       */
      else {
        const d = Number($('#renew-generic-day')?.value);
        const m = Number($('#renew-generic-month')?.value);
        const y = Number($('#renew-generic-year')?.value);

        if (!d || !m || !y) {
          toast('Bitte ein gültiges Ablaufdatum eingeben.');
          return;
        }

        const expiryDate = new Date(y, m - 1, d);

        if (
          expiryDate.getFullYear() !== y ||
          expiryDate.getMonth() !== m - 1 ||
          expiryDate.getDate() !== d
        ) {
          toast('Das eingegebene Datum ist ungültig.');
          return;
        }

        performedOnFormatted =
          y + '-' +
          String(m).padStart(2, '0') + '-' +
          String(d).padStart(2, '0');
      }

      /*
       * ==========================================================
       * HU / SP / TACHO -> POST /renew
       * ==========================================================
       */
      if (['hu', 'sp', 'tacho'].includes(category)) {

        const payload = {
          action: category,
          performed_on: performedOnFormatted
        };

        /*
        * HU / SP:
        *
        * Im Dialog wird der Fälligkeitsmonat ausgewählt.
        * Dieser wird bereits oben in manualDueFormatted
        * als letzter Tag des gewählten Monats berechnet.
        *
        * Beispiel:
        *   Eingabe: 09.2027
        *   manualDueFormatted: 2027-09-30
        *
        * HU -> next_hu_due_manual
        * SP -> next_sp_due_manual
        */
        if (category === 'hu') {
          payload.next_hu_due_manual = manualDueFormatted;
        }

        if (category === 'sp') {
          payload.next_sp_due_manual = manualDueFormatted;
        }

        try {
          await api(
            '/api/vehicles/' + encodeURIComponent(vId) + '/renew',
            {
              method: 'POST',
              body: JSON.stringify(payload)
            }
          );

          const dialog = $('#quick-renew-dialog');
          if (dialog) dialog.close();

          const detailDialog = $('#detail-dialog');
          if (detailDialog) detailDialog.close();

          await loadVehicles();

          toast(
            (CATEGORY_LABELS[category] || category) +
            ' für ' +
            vehicle.plate +
            ' erfolgreich aktualisiert!'
          );

        } catch (err) {
          console.error('Fehler beim Erneuern:', err);

          toast(
            'Fehler beim Aktualisieren der Frist. ' +
            'Bitte Eingaben und Server-Log prüfen.'
          );
        }

        return;
      }

      /*
       * ==========================================================
       * ERSTE-HILFE / FEUERLÖSCHER -> PUT
       * ==========================================================
       *
       * Hier dürfen wir NICHT /renew verwenden.
       */

      const payload = {
        plate: vehicle.plate,
        first_registration: vehicle.first_registration || null,

        tacho_last: vehicle.tacho_last || '2026-01-01',
        tacho_due: isPlaceholderDate(vehicle.tacho_due)
          ? null
          : vehicle.tacho_due,

        hu_last: vehicle.hu_last || '2026-01-01',
        hu_due: isPlaceholderDate(vehicle.hu_due)
          ? null
          : vehicle.hu_due,

        sp_last: vehicle.sp_last || null,
        sp_due: isPlaceholderDate(vehicle.sp_due)
          ? null
          : vehicle.sp_due,

        first_aid_due:
          category === 'first_aid'
            ? performedOnFormatted
            : (vehicle.first_aid_due || null),

        fire_extinguisher_due:
          category === 'fire_extinguisher'
            ? performedOnFormatted
            : (vehicle.fire_extinguisher_due || null),

        tacho_due_manual: vehicle.tacho_due_manual || 0,
        hu_due_manual: vehicle.hu_due_manual || 0,
        sp_due_manual: vehicle.sp_due_manual || 0
      };

      try {
        await api(
          '/api/vehicles/' + encodeURIComponent(vId),
          {
            method: 'PUT',
            body: JSON.stringify(payload)
          }
        );

        const dialog = $('#quick-renew-dialog');
        if (dialog) dialog.close();

        const detailDialog = $('#detail-dialog');
        if (detailDialog) detailDialog.close();

        await loadVehicles();

        toast(
          (CATEGORY_LABELS[category] || category) +
          ' für ' +
          vehicle.plate +
          ' gespeichert!'
        );

      } catch (err) {
        console.error('Fehler beim Speichern:', err);
        toast('Fehler beim Speichern.');
      }
    });
  }

  const gSearch = $('#global-search');
  if (gSearch) {
    gSearch.addEventListener('input', function (e) {
      handleLiveSearch(e.target.value);
    });
    gSearch.addEventListener('focus', function (e) {
      if (e.target.value.trim().length > 0) {
        handleLiveSearch(e.target.value);
      }
    });
  }

  const clearBtn = $('#clear-search');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (gSearch) {
        gSearch.value = '';
        handleLiveSearch('');
        gSearch.focus();
      }
    });
  }

  $$('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () {
      const d = document.getElementById(b.dataset.close);
      if (d) d.close();
    });
  });

  const vStatusFilter = $('#vehicles-status-filter');
  if (vStatusFilter) {
    vStatusFilter.addEventListener('change', function (e) {
      state.vehicleStatusFilter = e.target.value;
      state.monthFilter = null;
      renderVehicles();
    });
  }

  const resetVFilter = $('#reset-vehicle-filter');
  if (resetVFilter) {
    resetVFilter.addEventListener('click', function () {
      state.vehicleStatusFilter = 'all';
      state.monthFilter = null;
      if (vStatusFilter) vStatusFilter.value = 'all';
      renderVehicles();
    });
  }

  const delForm = $('#delete-form');
  if (delForm) {
    delForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const id = delForm.elements.vehicle_id.value;
      try {
        await api('/api/vehicles/' + id, { method: 'DELETE' });
        const diag = $('#delete-dialog');
        if (diag) diag.close();
        await loadVehicles();
        toast('Fahrzeug gelöscht.');
      } catch (err) {
        toast('Fehler beim Löschen');
      }
    });
  }
}

/* =========================================================
   DRUCKLAYOUT
   ========================================================= */

let printMode = 'plate';


/*
 * Kategorien, die auf dem Ausdruck berücksichtigt werden.
 *
 * SP und Tacho entfallen beim PKW HAM-KV-21 automatisch.
 */
function getPrintCategories(vehicle) {
  if (isPkw(vehicle.plate)) {
    return [
      'hu',
      'first_aid',
      'fire_extinguisher'
    ];
  }

  return [
    'tacho',
    'hu',
    'sp',
    'first_aid',
    'fire_extinguisher'
  ];
}


/*
 * Liefert die tatsächlich relevante Frist.
 *
 * Wichtig:
 * HU/SP werden über getEffectiveDeadline()
 * auf den letzten Tag des jeweiligen Monats gesetzt.
 */
function getPrintDeadline(vehicle, category) {
  const due = vehicle[category + '_due'];

  if (!due || isPlaceholderDate(due)) {
    return null;
  }

  const deadline = getEffectiveDeadline(category, due);

  if (!deadline || isNaN(deadline.getTime())) {
    return null;
  }

  return deadline;
}


/*
 * Status einer einzelnen Prüffrist.
 */
function getPrintStatus(vehicle, category) {
  const due = vehicle[category + '_due'];

  if (
    isPkw(vehicle.plate) &&
    (category === 'sp' || category === 'tacho')
  ) {
    return {
      level: 'pkw-exempt',
      label: 'Entfällt (PKW)',
      days: null,
      icon: '✓'
    };
  }

  if (!due || isPlaceholderDate(due)) {
    return {
      level: 'placeholder',
      label: 'Unbekannt',
      days: null,
      icon: '⚠️'
    };
  }

  return calculateEffectiveStatus(
    category,
    due,
    vehicle.status ? vehicle.status[category] : null,
    vehicle.plate
  );
}


/*
 * Alle Status eines Fahrzeuges.
 */
function getPrintVehicleStatuses(vehicle) {
  return getPrintCategories(vehicle).map(function (category) {
    return {
      category: category,
      status: getPrintStatus(vehicle, category)
    };
  });
}


/*
 * Gesamtstatus eines Fahrzeuges.
 *
 * Priorität:
 *
 * 0 = überfällig
 * 1 = heute / <= 7 Tage
 * 2 = <= 30 Tage
 * 3 = gültig
 * 4 = unbekannt
 */
function getPrintVehiclePriority(vehicle) {
  const statuses = getPrintVehicleStatuses(vehicle);

  let priority = 4;

  statuses.forEach(function (item) {
    const level = item.status.level;

    if (level === 'overdue') {
      priority = Math.min(priority, 0);
      return;
    }

    if (level === 'critical') {
      priority = Math.min(priority, 1);
      return;
    }

    if (level === 'warning') {
      priority = Math.min(priority, 2);
      return;
    }

    if (level === 'ok') {
      priority = Math.min(priority, 3);
      return;
    }

    if (level === 'placeholder') {
      priority = Math.min(priority, 4);
    }
  });

  return priority;
}


/*
 * Früheste tatsächliche Frist eines Fahrzeuges.
 */
function getPrintEarliestDeadline(vehicle) {
  const categories = getPrintCategories(vehicle);

  let earliest = null;

  categories.forEach(function (category) {
    const deadline = getPrintDeadline(vehicle, category);

    if (!deadline) {
      return;
    }

    if (!earliest || deadline < earliest) {
      earliest = deadline;
    }
  });

  return earliest;
}


/*
 * Gibt zurück, ob das Fahrzeug mindestens eine
 * überfällige Frist besitzt.
 */
function isPrintVehicleOverdue(vehicle) {
  return getPrintVehicleStatuses(vehicle).some(function (item) {
    return (
      item.status &&
      item.status.level === 'overdue'
    );
  });
}


/*
 * Gibt zurück, ob eine Frist in einem bestimmten
 * Monat liegt.
 */
function vehicleHasDeadlineInMonth(vehicle, year, month) {
  return getPrintCategories(vehicle).some(function (category) {

    const deadline = getPrintDeadline(
      vehicle,
      category
    );

    if (!deadline) {
      return false;
    }

    return (
      deadline.getFullYear() === year &&
      deadline.getMonth() === month
    );
  });
}


/*
 * Druckliste zusammenstellen.
 */
function getPrintVehicles() {

  let vehicles = state.vehicles.slice();


  /*
   * Aktuellen Tabellenfilter berücksichtigen.
   *
   * Dadurch bleibt das Verhalten der normalen
   * Fahrzeugübersicht erhalten.
   */
  if (
    state.vehicleStatusFilter &&
    state.vehicleStatusFilter !== 'all'
  ) {

    vehicles = vehicles.filter(function (vehicle) {

      const statuses =
        getPrintVehicleStatuses(vehicle)
          .map(function (item) {
            return item.status;
          });


      if (state.vehicleStatusFilter === 'overdue') {
        return statuses.some(function (status) {
          return (
            status.days !== null &&
            status.days < 0
          );
        });
      }


      if (state.vehicleStatusFilter === 'today') {
        return statuses.some(function (status) {
          return status.days === 0;
        });
      }


      if (state.vehicleStatusFilter === '7') {
        return statuses.some(function (status) {
          return (
            status.days !== null &&
            status.days >= 0 &&
            status.days <= 7
          );
        });
      }


      if (state.vehicleStatusFilter === '30') {
        return statuses.some(function (status) {
          return (
            status.days !== null &&
            status.days >= 0 &&
            status.days <= 30
          );
        });
      }


      if (state.vehicleStatusFilter === 'ok') {
        return statuses.every(function (status) {
          return (
            status.level === 'ok' ||
            status.level === 'placeholder' ||
            status.level === 'pkw-exempt'
          );
        });
      }


      return true;
    });
  }


  /*
   * Druckmodus: aktueller Monat.
   */
  if (printMode === 'current-month') {

    const now = new Date();

    vehicles = vehicles.filter(function (vehicle) {

      return vehicleHasDeadlineInMonth(
        vehicle,
        now.getFullYear(),
        now.getMonth()
      );

    });
  }


  /*
   * Druckmodus: nächster Monat.
   */
  if (printMode === 'next-month') {

    const now = new Date();

    const nextMonth =
      new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1
      );

    vehicles = vehicles.filter(function (vehicle) {

      return vehicleHasDeadlineInMonth(
        vehicle,
        nextMonth.getFullYear(),
        nextMonth.getMonth()
      );

    });
  }


  /*
   * Druckmodus: ausschließlich überfällige Fahrzeuge.
   */
  if (printMode === 'overdue') {

    vehicles = vehicles.filter(function (vehicle) {
      return isPrintVehicleOverdue(vehicle);
    });
  }


  /*
   * SORTIERUNG
   */

  if (printMode === 'plate') {

    vehicles.sort(function (a, b) {

      return String(a.plate || '').localeCompare(
        String(b.plate || ''),
        'de',
        {
          numeric: true,
          sensitivity: 'base'
        }
      );

    });

  } else if (
    printMode === 'due' ||
    printMode === 'current-month' ||
    printMode === 'next-month'
  ) {

    vehicles.sort(function (a, b) {

      const dateA =
        getPrintEarliestDeadline(a);

      const dateB =
        getPrintEarliestDeadline(b);

      const timeA =
        dateA ? dateA.getTime() : Infinity;

      const timeB =
        dateB ? dateB.getTime() : Infinity;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      return String(a.plate || '').localeCompare(
        String(b.plate || ''),
        'de',
        {
          numeric: true,
          sensitivity: 'base'
        }
      );

    });

  } else if (printMode === 'status') {

    vehicles.sort(function (a, b) {

      const priorityA =
        getPrintVehiclePriority(a);

      const priorityB =
        getPrintVehiclePriority(b);

      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }

      const dateA =
        getPrintEarliestDeadline(a);

      const dateB =
        getPrintEarliestDeadline(b);

      const timeA =
        dateA ? dateA.getTime() : Infinity;

      const timeB =
        dateB ? dateB.getTime() : Infinity;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      return String(a.plate || '').localeCompare(
        String(b.plate || ''),
        'de',
        {
          numeric: true,
          sensitivity: 'base'
        }
      );

    });

  } else if (printMode === 'overdue') {

    vehicles.sort(function (a, b) {

      const dateA =
        getPrintEarliestDeadline(a);

      const dateB =
        getPrintEarliestDeadline(b);

      const timeA =
        dateA ? dateA.getTime() : Infinity;

      const timeB =
        dateB ? dateB.getTime() : Infinity;

      if (timeA !== timeB) {
        return timeA - timeB;
      }

      return String(a.plate || '').localeCompare(
        String(b.plate || ''),
        'de',
        {
          numeric: true,
          sensitivity: 'base'
        }
      );

    });
  }


  return vehicles;
}


/*
 * Status-Badge für den Ausdruck.
 */
function printStatusMarkup(status) {

  if (!status) {
    return '';
  }

  let label =
    status.label || 'Unbekannt';


  if (
    typeof status.days === 'number'
  ) {

    if (status.level === 'overdue') {

      const days =
        Math.abs(status.days);

      label =
        days === 1
          ? '1 Tag überfällig'
          : days + ' Tage überfällig';

    } else if (status.days === 0) {

      label = 'Heute fällig';

    } else if (status.days === 1) {

      label = '1 Tag';

    } else if (status.days > 1) {

      label =
        'in ' + status.days + ' Tagen';
    }
  }


  return `
    <span class="print-status ${escapeHtml(status.level || 'placeholder')}">
      ${escapeHtml(status.icon || '')}
      ${escapeHtml(label)}
    </span>
  `;
}


/*
 * Einzelne Frist im Ausdruck.
 */
function printInspectionMarkup(vehicle, category) {

  if (
    isPkw(vehicle.plate) &&
    (category === 'sp' || category === 'tacho')
  ) {

    return `
      <span class="print-status pkw-exempt">
        ✓ Entfällt (PKW)
      </span>
    `;
  }


  const due =
    vehicle[category + '_due'];

  const last =
    vehicle[category + '_last'];


  if (
    !due ||
    isPlaceholderDate(due)
  ) {

    return `
      <span class="print-status placeholder">
        ⚠️ Unbekannt
      </span>
    `;
  }


  const status =
    getPrintStatus(
      vehicle,
      category
    );


  const formattedDue = formatInspectionDate(category, due);


  let lastMarkup = '';


  if (
    last &&
    !isPlaceholderDate(last)
  ) {

    lastMarkup = `
      <span class="print-subline">
        zuletzt ${escapeHtml(formatDate(last))}
      </span>
    `;
  }


  return `
    <span class="print-date">
      ${escapeHtml(formattedDue)}
    </span>

    ${lastMarkup}

    ${printStatusMarkup(status)}
  `;
}


/*
 * Nächster Termin.
 */
function printNextAppointmentMarkup(vehicle) {

  const category =
    getPrintCategories(vehicle)
      .filter(function (cat) {
        return Boolean(
          getPrintDeadline(vehicle, cat)
        );
      })
      .sort(function (a, b) {

        return (
          getPrintDeadline(vehicle, a).getTime() -
          getPrintDeadline(vehicle, b).getTime()
        );

      })[0];


  if (!category) {

    return `
      <div class="print-next">
        <div class="print-next-title">
          Nächster Termin
        </div>

        <div class="print-next-main">
          Keine Angabe
        </div>
      </div>
    `;
  }


  const due =
    vehicle[category + '_due'];

  const status =
    getPrintStatus(
      vehicle,
      category
    );


  return `
    <div class="print-next">

      <div class="print-next-title">
        ${escapeHtml(
          CATEGORY_LABELS[category] || category
        )}
      </div>

      <div class="print-next-date">
        ${escapeHtml(
          formatInspectionDate(
            category,
            due
          )
        )}
      </div>

      ${printStatusMarkup(status)}

    </div>
  `;
}


/*
 * Zusätzliche EH / FL Fristen.
 */
function printExtraDeadlineMarkup(
  vehicle,
  category,
  abbreviation
) {

  const due =
    vehicle[category + '_due'];


  if (
    !due ||
    isPlaceholderDate(due)
  ) {

    return `
      <div class="print-extra-deadline">
        <strong>${abbreviation}</strong>
        <span class="print-extra-unknown">
          Unbekannt
        </span>
      </div>
    `;
  }


  const status =
    getPrintStatus(
      vehicle,
      category
    );


  return `
    <div class="print-extra-deadline">

      <strong>${abbreviation}</strong>

      <span>
        ${escapeHtml(
          formatDate(due)
        )}

        ${printStatusMarkup(status)}
      </span>

    </div>
  `;
}


/*
 * Haupt-Drucklayout.
 */
function renderPrintLayout() {

  const container =
    document.getElementById('print-layout');

  if (!container) {
    return;
  }


  const vehicles =
    getPrintVehicles();


  const now =
    new Date();


  const printDate =
    now.toLocaleDateString(
      'de-DE',
      {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }
    );


  const printTime =
    now.toLocaleTimeString(
      'de-DE',
      {
        hour: '2-digit',
        minute: '2-digit'
      }
    );


  let modeTitle =
    'Fahrzeugübersicht';


  if (printMode === 'plate') {
    modeTitle =
      'Nach Kennzeichen sortiert';
  }

  if (printMode === 'due') {
    modeTitle =
      'Nach Ablaufdaten sortiert';
  }

  if (printMode === 'status') {
    modeTitle =
      'Nach Status / Dringlichkeit sortiert';
  }

  if (printMode === 'current-month') {
    modeTitle =
      'Diesen Monat fällige Fahrzeuge';
  }

  if (printMode === 'next-month') {
    modeTitle =
      'Nächsten Monat fällige Fahrzeuge';
  }

  if (printMode === 'overdue') {
    modeTitle =
      'Aktuell überfällige Fahrzeuge';
  }


  /*
   * Gesamtstatistik.
   */
  let overdueCount = 0;
  let criticalCount = 0;
  let warningCount = 0;
  let okCount = 0;


  vehicles.forEach(function (vehicle) {

    const priority =
      getPrintVehiclePriority(vehicle);


    if (priority === 0) {
      overdueCount++;
    } else if (priority === 1) {
      criticalCount++;
    } else if (priority === 2) {
      warningCount++;
    } else {
      okCount++;
    }

  });


  /*
   * Tabellenzeilen.
   */
  const rows =
    vehicles.map(function (vehicle) {

      const plate =
        escapeHtml(
          vehicle.plate || '—'
        );


      const ezMarkup =
        vehicle.first_registration &&
        !isPlaceholderDate(
          vehicle.first_registration
        )
          ? `
            <span class="print-subline">
              EZ ${escapeHtml(
                formatDate(
                  vehicle.first_registration
                )
              )}
            </span>
          `
          : '';


      return `
        <tr>

          <td>
            <span class="print-plate">
              ${plate}
            </span>

            ${ezMarkup}
          </td>


          <td>
            ${printInspectionMarkup(
              vehicle,
              'tacho'
            )}
          </td>


          <td>
            ${printInspectionMarkup(
              vehicle,
              'hu'
            )}
          </td>


          <td>
            ${printInspectionMarkup(
              vehicle,
              'sp'
            )}
          </td>


          <td>
            ${printNextAppointmentMarkup(
              vehicle
            )}
          </td>


          <td>

            ${printExtraDeadlineMarkup(
              vehicle,
              'first_aid',
              'EH'
            )}

            ${printExtraDeadlineMarkup(
              vehicle,
              'fire_extinguisher',
              'FL'
            )}

          </td>

        </tr>
      `;

    }).join('');


  const modeDescription =
    vehicles.length === 0
      ? 'Keine Fahrzeuge für diese Auswahl gefunden.'
      : vehicles.length +
        (
          vehicles.length === 1
            ? ' Fahrzeug enthalten.'
            : ' Fahrzeuge enthalten.'
        );


  container.innerHTML = `

    <div class="print-header">

      <div class="print-logo-wrap">

        <img
          class="print-logo"
          src="/static/kiese-logo.png"
          alt="Kiese Reise-Service"
        >

      </div>


      <div class="print-header-right">

        <div class="print-company">
          Kiese Reise-Service
        </div>

        <h1 class="print-header-title">
          Fahrzeugverwaltung
        </h1>

        <div class="print-header-subtitle">
          Fahrzeugübersicht · Prüf- und Fristenstatus
          <br>
          ${escapeHtml(modeTitle)}
        </div>

      </div>

    </div>


    <div class="print-meta">

      <div class="print-meta-item">

        <span class="print-meta-label">
          Ausdruck
        </span>

        <span class="print-meta-value">
          ${escapeHtml(printDate)}
        </span>

        <span class="print-subline">
          ${escapeHtml(printTime)} Uhr
        </span>

      </div>


      <div class="print-meta-item">

        <span class="print-meta-label">
          Fahrzeuge
        </span>

        <span class="print-meta-value">
          ${vehicles.length}
        </span>

      </div>


      <div class="print-meta-item print-meta-overdue">

        <span class="print-meta-label">
          Überfällig
        </span>

        <span class="print-meta-value">
          ${overdueCount}
        </span>

      </div>


      <div class="print-meta-item">

        <span class="print-meta-label">
          Status
        </span>

        <span class="print-meta-value">
          ${criticalCount + warningCount}
          fällig
        </span>

      </div>

    </div>


    <section class="print-section">

      <div class="print-section-heading">

        <div>

          <span class="print-section-eyebrow">
            Prüfkataster
          </span>

          <h2 class="print-section-title">
            ${escapeHtml(modeTitle)}
          </h2>

        </div>

        <span class="print-section-count">
          ${vehicles.length} Fahrzeuge
        </span>

      </div>


      <table class="print-table">

        <thead>

          <tr>

            <th>Kennzeichen</th>

            <th>Tacho</th>

            <th>HU</th>

            <th>SP</th>

            <th>Nächster Termin</th>

            <th>Weitere Fristen</th>

          </tr>

        </thead>


        <tbody>

          ${
            rows ||
            `
              <tr>

                <td
                  colspan="6"
                  class="print-empty"
                >
                  Keine Fahrzeuge für diese Auswahl gefunden.
                </td>

              </tr>
            `
          }

        </tbody>

      </table>

    </section>


    <section class="print-legend">

      <div class="print-legend-title">
        Legende
      </div>


      <div class="print-legend-grid">

        <div class="print-legend-item">

          <span class="print-legend-abbr">
            HU
          </span>

          <span>
            <strong>Hauptuntersuchung</strong>
            <br>
            TÜV / HU-Prüfung
          </span>

        </div>


        <div class="print-legend-item">

          <span class="print-legend-abbr">
            SP
          </span>

          <span>
            <strong>Sicherheitsprüfung</strong>
            <br>
            Sicherheitsprüfung
          </span>

        </div>


        <div class="print-legend-item">

          <span class="print-legend-abbr">
            T
          </span>

          <span>
            <strong>Tachoprüfung</strong>
            <br>
            Prüfung nach § 57b StVZO
          </span>

        </div>


        <div class="print-legend-item">

          <span class="print-legend-abbr">
            EH
          </span>

          <span>
            <strong>Erste-Hilfe-Kasten</strong>
            <br>
            Ablaufdatum Verbandkasten
          </span>

        </div>


        <div class="print-legend-item">

          <span class="print-legend-abbr">
            FL
          </span>

          <span>
            <strong>Feuerlöscher</strong>
            <br>
            Prüf- bzw. Ablaufdatum
          </span>

        </div>


        <div class="print-legend-item">

          <span class="print-legend-abbr">
            PKW
          </span>

          <span>
            <strong>PKW-Ausnahme</strong>
            <br>
            SP und Tacho entfallen
          </span>

        </div>

      </div>


      <div class="print-status-legend">

        <div class="print-legend-status-item">

          <span class="print-legend-dot overdue"></span>

          <span>
            <strong>Überfällig</strong>
          </span>

        </div>


        <div class="print-legend-status-item">

          <span class="print-legend-dot critical"></span>

          <span>
            Heute / ≤ 7 Tage
          </span>

        </div>


        <div class="print-legend-status-item">

          <span class="print-legend-dot warning"></span>

          <span>
            ≤ 30 Tage
          </span>

        </div>


        <div class="print-legend-status-item">

          <span class="print-legend-dot ok"></span>

          <span>
            Gültig
          </span>

        </div>


        <div class="print-legend-status-item">

          <span class="print-legend-dot placeholder"></span>

          <span>
            Unbekannt
          </span>

        </div>

      </div>


      <div class="print-legend-note">

        <strong>Hinweis:</strong>
        Bei HU und SP wird der angegebene Prüfmonat
        als Frist bis zum letzten Tag dieses Monats gewertet.
        „Entfällt (PKW)“ betrifft in dieser Anwendung
        den Werkstatt-Bulli HAM-KV-21.

      </div>

    </section>


    <footer class="print-footer">

      <div>

        <strong>Kiese Reise-Service GmbH</strong>
        <br>

        Betriebshof Hamm · Fahrzeugverwaltung

      </div>


      <div class="print-footer-right">

        ${escapeHtml(modeDescription)}
        <br>

        Ausdruck:
        ${escapeHtml(printDate)}
        ${escapeHtml(printTime)} Uhr

      </div>

    </footer>

  `;
}


/*
 * Druck starten.
 */
function startPrint(mode) {

  printMode =
    mode || 'plate';


  renderPrintLayout();


  setTimeout(function () {

    window.print();

  }, 120);
}


/*
 * Druckdialog öffnen.
 */
function openPrintOptions() {

  const dialog =
    document.getElementById(
      'print-options-dialog'
    );


  if (!dialog) {
    return;
  }


  if (
    typeof dialog.showModal === 'function'
  ) {

    dialog.showModal();

  } else {

    dialog.setAttribute(
      'open',
      ''
    );

  }
}


/*
 * Druckdialog schließen.
 */
function closePrintOptions() {

  const dialog =
    document.getElementById(
      'print-options-dialog'
    );


  if (!dialog) {
    return;
  }


  if (
    typeof dialog.close === 'function'
  ) {

    dialog.close();

  } else {

    dialog.removeAttribute(
      'open'
    );

  }
}


/* =========================================================
   DRUCK-EVENTS
   ========================================================= */

document.addEventListener(
  'click',
  function (event) {

    const printButton =
      event.target.closest(
        '#print-vehicles-btn'
      );


    if (printButton) {

      event.preventDefault();

      openPrintOptions();

      return;
    }


    const overdueButton =
      event.target.closest(
        '#print-overdue-btn'
      );


    if (overdueButton) {

      event.preventDefault();

      closePrintOptions();

      /*
       * Direkt nur überfällige Fahrzeuge drucken.
       */
      startPrint('overdue');

      return;
    }


    const printOption =
      event.target.closest(
        '[data-print-mode]'
      );


    if (printOption) {

      event.preventDefault();

      const mode =
        printOption.dataset.printMode;


      closePrintOptions();

      startPrint(mode);

      return;
    }

  }
);


/*
 * Wenn der Browser über Strg+P / Systemdruck
 * druckt, Standard = Kennzeichen.
 */
window.addEventListener(
  'beforeprint',
  function () {

    renderPrintLayout();

  }
);


window.addEventListener(
  'afterprint',
  function () {

    const container =
      document.getElementById(
        'print-layout'
      );


    if (container) {
      container.innerHTML = '';
    }


    printMode =
      'plate';

  }
);

async function init() {
  initKioskControls();
  bindEvents();
  fillMonthDropdowns();

  const today = $('#today');
  if (today) {
    today.textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  }

  setView('dashboard');
  await loadVehicles();
}

init();

/* Touch-Kiosk: reguläre Klicks funktionieren mit Finger, Maus und Tastatur.
 * Kein touchstart+click-Doppelhandler, keine blockierten Zoom-Gesten.
 */
function initKioskControls() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('main-sidebar');
  const fullscreen = document.getElementById('fullscreen-toggle');
  const compact = window.matchMedia('(max-width: 1180px)');
  function setCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.inert = collapsed;
    sidebar.setAttribute('aria-hidden', String(collapsed));
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.textContent = collapsed ? '☰ Menü einblenden' : '☰ Menü ausblenden';
  }
  let saved = null;
  try { saved = localStorage.getItem('kiese-sidebar-collapsed'); } catch (_) {}
  setCollapsed(saved === null ? compact.matches : saved === 'true');
  toggle.addEventListener('click', function () {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    setCollapsed(collapsed);
    try { localStorage.setItem('kiese-sidebar-collapsed', String(collapsed)); } catch (_) {}
  });
  document.addEventListener('click', function (event) {
    if (compact.matches && event.target.closest('.sidebar [data-view], .sidebar [data-view-jump], .sidebar [data-create]')) {
      setCollapsed(true);
      // Fokus nicht auf einem nun unsichtbaren Navigationselement belassen.
      if (!document.querySelector('dialog[open]')) toggle.focus({preventScroll: true});
    }
  });
  function updateFullscreen() {
    const active = Boolean(document.fullscreenElement);
    fullscreen.textContent = active ? '⛶ Vollbild verlassen' : '⛶ Vollbild';
    fullscreen.setAttribute('aria-label', fullscreen.textContent);
    fullscreen.setAttribute('aria-pressed', String(active));
  }
  fullscreen.hidden = !document.fullscreenEnabled;
  fullscreen.addEventListener('click', async function () {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { toast('Vollbild ist im Browser gesperrt. Bitte den Chromium-Kioskmodus verwenden.'); }
  });
  document.addEventListener('fullscreenchange', updateFullscreen);
  updateFullscreen();
  document.querySelectorAll('input[type="number"]').forEach(function (input) {
    input.inputMode = Number(input.min) < 0 ? 'decimal' : 'numeric';
  });
  // VisualViewport berücksichtigt die Bildschirmtastatur in Chromium.
  function updateViewport() {
    document.documentElement.style.setProperty('--kiosk-visible-height',
      Math.round(window.visualViewport ? window.visualViewport.height : window.innerHeight) + 'px');
  }
  updateViewport();
  window.addEventListener('resize', updateViewport);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', updateViewport);
  document.addEventListener('focusin', function (event) {
    if (!event.target.matches('input, textarea, select')) return;
    const input = event.target;
    window.setTimeout(function () {
      if (document.activeElement === input) input.scrollIntoView({block: 'nearest', inline: 'nearest'});
    }, 350);
  });
}
