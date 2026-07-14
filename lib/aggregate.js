// lib/aggregate.js
// Pure aggregation/formatting helpers ported 1:1 from the design prototype's
// Component logic (design_reference/Seryn Digital.dc.html) so the UI behaves
// identically, now driven by API data instead of a static JS import.

export function fmtDateLabel(iso) {
  if (!iso) return '';
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

export function fmtDateFull(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function isoWeekInfo(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const weekNum = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: date.getUTCFullYear(), week: weekNum };
}

export function riskRank(level) { return level === 'red' ? 2 : level === 'yellow' ? 1 : 0; }
export function worstRisk(a, b) { return riskRank(a) >= riskRank(b) ? a : b; }

/**
 * A 'red' flag with zero negative sources is a stale/carry-forward watch item, not a confirmed
 * violation this period — treat it as 'yellow' so it never contradicts a 0-negative KPI card.
 */
export function effectiveRiskLevel(d) {
  if (d.riskLevel === 'red' && (!d.negative || d.negative === 0)) return 'yellow';
  return d.riskLevel;
}

export function cap(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildBuckets(days, mode) {
  if (mode === 'day') {
    return days.map(d => ({
      key: d.date,
      label: fmtDateFull(d.date),
      total: d.total, positive: d.positive, neutral: d.neutral, negative: d.negative,
      newSources: d.newSources, riskLevel: effectiveRiskLevel(d), riskNote: d.riskNote, dayCount: 1, dates: [d.date],
    }));
  }
  const map = new Map();
  for (const d of days) {
    let key, label;
    if (mode === 'week') {
      const wi = isoWeekInfo(d.date);
      key = `${wi.year}-W${String(wi.week).padStart(2, '0')}`;
      label = `Tuần ${wi.week}, ${wi.year}`;
    } else if (mode === 'month') {
      const [y, m] = d.date.split('-');
      key = `${y}-${m}`;
      label = `Tháng ${m}/${y}`;
    } else {
      const y = d.date.split('-')[0];
      key = y;
      label = `Năm ${y}`;
    }
    if (!map.has(key)) {
      map.set(key, { key, label, total: 0, positive: 0, neutral: 0, negative: 0, newSources: 0, riskLevel: 'green', riskNote: '', dayCount: 0, lastDate: d.date, firstDate: d.date, dates: [] });
    }
    const b = map.get(key);
    b.total += d.total; b.positive += d.positive; b.neutral += d.neutral; b.negative += d.negative;
    b.newSources += d.newSources;
    b.riskLevel = worstRisk(b.riskLevel, effectiveRiskLevel(d));
    b.dayCount += 1;
    b.lastDate = d.date;
    b.dates.push(d.date);
  }
  return Array.from(map.values());
}

export function sourcesForBucket(sourcesByDay, bucket, category) {
  if (!sourcesByDay) return [];
  const all = [];
  for (const date of bucket.dates) {
    const rows = sourcesByDay[date] || [];
    all.push(...rows);
  }
  if (category === 'positive') return all.filter(s => s.sentiment === 'positive');
  if (category === 'neutral') return all.filter(s => s.sentiment === 'neutral');
  if (category === 'negative') return all.filter(s => s.sentiment === 'negative');
  if (category === 'new') return all.filter(s => s.isNew);
  return all;
}

export function colorForRisk(level) {
  if (level === 'red') return 'var(--danger-500)';
  if (level === 'yellow') return 'var(--gold-600)';
  return 'var(--success-500)';
}
export function softBgForRisk(level) {
  if (level === 'red') return 'var(--danger-100)';
  if (level === 'yellow') return 'var(--gold-100)';
  return 'var(--success-100)';
}
export function borderForRisk(level) {
  if (level === 'red') return 'var(--coral-300)';
  if (level === 'yellow') return 'var(--gold-300)';
  return '#CFE6D8';
}
export function labelForRisk(level) {
  if (level === 'red') return 'CẢNH BÁO ĐỎ';
  if (level === 'yellow') return 'VÀNG — CẦN THEO DÕI';
  return 'AN TOÀN';
}
