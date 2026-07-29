// lib/recommendations.js
// "Khuyến nghị Seryn" — a rule-based advisory engine that reads the same live
// data already powering the dashboard (Seryn's own sentiment/risk numbers +
// the 14-competitor risk ranking) and turns it into a prioritized action plan
// for a senior aesthetic/medical-beauty marketing consultant to hand a
// clinic's founder.
//
// Mode-aware: the dashboard's own period switcher (Ngày/Tuần/Tháng/Năm)
// drives which bucket (`selBucket`) and comparison bucket (`prevBucket`, the
// immediately preceding period of the SAME granularity) get analyzed, so
// switching to "Tuần" produces a verdict + recommendations computed from
// week-level totals compared to the prior week, "Tháng" from month-level
// totals compared to the prior month, and "Năm" from year-level totals
// compared to the prior year — not a fixed list that ignores which period is
// selected.
//
// Rule-based rather than calling an LLM: the app has no AI API wired in (see
// package.json), so every recommendation below is a template whose wording
// is chosen up front and whose specifics (numbers, brand names, deltas vs.
// the prior period) are filled in from the actual dashboard data at
// generation time — no network call, no API key, fully deterministic.
//
// Public entry point: buildSerynRecommendations({...}) -> RecommendationSet
// (see the JSDoc typedef below). Everything else in this file is a private
// helper feeding that one function.
import { cap } from '@/lib/aggregate';

/**
 * @typedef {Object} RecoItem
 * @property {string} title
 * @property {string} detail
 * @property {string} tag       - 'Khẩn cấp' | 'Ưu tiên cao' | 'Định kỳ' | 'Chiến lược'
 * @property {string} tone      - 'danger' | 'warning' | 'brand' | 'success' | 'navy'
 * @property {string} category  - short machine tag for icons/grouping, e.g. 'crisis', 'content', 'competitor', 'compliance', 'growth'
 */

const TAG_TONE = {
  'Khẩn cấp': 'danger',
  'Ưu tiên cao': 'warning',
  'Định kỳ': 'brand',
  'Chiến lược': 'navy',
};

function item(title, detail, tag, category) {
  return { title, detail, tag, tone: TAG_TONE[tag] || 'navy', category };
}

function sumDays(days) {
  return days.reduce((acc, d) => ({
    total: acc.total + (d.total || 0),
    positive: acc.positive + (d.positive || 0),
    neutral: acc.neutral + (d.neutral || 0),
    negative: acc.negative + (d.negative || 0),
    newSources: acc.newSources + (d.newSources || 0),
  }), { total: 0, positive: 0, neutral: 0, negative: 0, newSources: 0 });
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }
function fmtSigned(n) { return n > 0 ? `+${n}` : String(n); }

// Next-period phrasing per mode, used when a recommendation points forward
// ("chuẩn bị cho ... tới").
const NEXT_PERIOD_NOUN = { day: 'ngày mai', week: 'tuần tới', month: 'tháng tới', year: 'năm tới' };
// How large a review-collection target should be by default at each
// granularity (before being scaled up further by negative-signal volume).
const REVIEW_BASELINE = { day: 3, week: 5, month: 15, year: 80 };

// ---------------------------------------------------------------------------
// Verdict — "đã đi đúng hướng chưa?" — compares the selected bucket against
// the immediately preceding bucket of the same granularity (prevBucket).
// Works identically for day/week/month/year since buildBuckets() already
// aggregates to the right granularity before this ever runs.
// ---------------------------------------------------------------------------
function buildVerdict({ modeNoun, selBucket, prevBucket }) {
  const total = selBucket.total || 0;
  const posPct = pct(selBucket.positive, total);

  if (!prevBucket) {
    return {
      label: 'Chưa đủ dữ liệu để so sánh xu hướng',
      tone: 'navy',
      reasoning: `Đây là ${modeNoun} đầu tiên có dữ liệu nên chưa có ${modeNoun} trước để đối chiếu: ${total} nguồn, ${posPct}% tích cực, ${selBucket.negative} tiêu cực. Cần thêm ít nhất một ${modeNoun} nữa để đánh giá xu hướng.`,
    };
  }

  const prevTotal = prevBucket.total || 0;
  const prevPosPct = pct(prevBucket.positive, prevTotal);
  const totalDeltaPct = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : (total > 0 ? 100 : 0);
  const posPctDelta = posPct - prevPosPct;
  const negDelta = selBucket.negative - prevBucket.negative;

  const reasoningBase = `${cap(modeNoun)} này: ${total} nguồn (${fmtSigned(totalDeltaPct)}% so với ${modeNoun} trước), ${posPct}% tích cực (${modeNoun} trước ${prevPosPct}%), ${selBucket.negative} tiêu cực (${modeNoun} trước ${prevBucket.negative}).`;

  if (selBucket.riskLevel === 'red' || (negDelta > 0 && selBucket.negative >= 2)) {
    return {
      label: 'Cần điều chỉnh ngay',
      tone: 'danger',
      reasoning: `${reasoningBase} Tín hiệu tiêu cực đang tăng — đây là dấu hiệu cần xử lý gấp trước khi tiếp tục các kế hoạch mở rộng khác.`,
    };
  }
  if (posPctDelta >= 3 && negDelta <= 0) {
    return {
      label: 'Đang đi đúng hướng',
      tone: 'success',
      reasoning: `${reasoningBase} Tỷ lệ tích cực tăng trong khi tiêu cực không tăng — chiến lược hiện tại đang hiệu quả, nên duy trì và nhân rộng thay vì đổi hướng.`,
    };
  }
  if (totalDeltaPct <= -20) {
    return {
      label: 'Cần bổ sung truyền thông',
      tone: 'warning',
      reasoning: `${reasoningBase} Tổng độ phủ giảm đáng kể so với ${modeNoun} trước — cần chủ động bổ sung nội dung/PR thay vì chỉ chờ được nhắc đến tự nhiên.`,
    };
  }
  return {
    label: 'Ổn định, còn dư địa tối ưu',
    tone: 'brand',
    reasoning: `${reasoningBase} Không có biến động lớn theo hướng tốt lên hay xấu đi — phù hợp để thử nghiệm và tối ưu thêm thay vì chỉ duy trì nguyên trạng.`,
  };
}

// ---------------------------------------------------------------------------
// Day mode — a same-day action checklist (today vs. a 7-day baseline),
// meant to be re-checked every morning.
// ---------------------------------------------------------------------------
function buildDayItems({ lastDay, days, watchItems, channels, competitors }) {
  const out = [];

  if (lastDay.negative > 0 || lastDay.riskLevel === 'red') {
    out.push(item(
      `Xử lý ${lastDay.negative || 0} tín hiệu tiêu cực trong 24 giờ vàng`,
      `Ghi nhận ngày ${lastDay.date}${lastDay.riskNote ? `: ${lastDay.riskNote}` : ' có nội dung tiêu cực/cảnh báo cần xử lý.'} Quy trình khuyến nghị: (1) xác minh nguồn & mức độ lan truyền trước 10h sáng, (2) chuẩn bị phản hồi chính thức qua kênh sở hữu (website, fanpage) thay vì im lặng, (3) theo dõi bình luận liên quan mỗi 2–3 giờ, (4) KHÔNG xoá/ẩn bài viết gốc nếu đã lan truyền — dễ gây hiệu ứng Streisand, (5) báo cáo ban lãnh đạo trong ngày.`,
      'Khẩn cấp', 'crisis',
    ));
  } else {
    out.push(item(
      'Duy trì "vùng an toàn" truyền thông hôm nay',
      'Không phát hiện tin tiêu cực mới trong ngày gần nhất — đây là thời điểm tốt để chủ động đẩy nội dung xây dựng thương hiệu (case study, trước–sau, chứng chỉ chuyên môn) thay vì chỉ phòng thủ. Vẫn duy trì rà soát 1 lượt cuối ngày để không bỏ lỡ tín hiệu mới.',
      'Ưu tiên cao', 'crisis',
    ));
  }

  if (lastDay.positive > 0) {
    out.push(item(
      `Khuếch đại ${lastDay.positive} tin/đánh giá tích cực hôm nay`,
      'Re-share lên fanpage & Zalo OA trong ngày trong khi vẫn còn tính thời sự, gắn thẻ/cảm ơn người đăng nếu là khách hàng thật, và tận dụng đà tích cực để xin thêm 2–3 đánh giá mới từ khách vừa trải nghiệm dịch vụ.',
      'Định kỳ', 'content',
    ));
  }

  const recent7 = days.slice(-8, -1);
  const baseline = recent7.length ? sumDays(recent7).newSources / recent7.length : 0;
  if (baseline > 0 && lastDay.newSources >= baseline * 1.5 && lastDay.newSources >= 2) {
    out.push(item(
      `Tín hiệu tăng đột biến: +${lastDay.newSources} nguồn mới hôm nay`,
      `Cao hơn đáng kể so với trung bình 7 ngày gần nhất (~${baseline.toFixed(1)} nguồn/ngày). Xác định nguyên nhân và nhân bản cách tiếp cận đó nếu đến từ nỗ lực chủ động của phòng marketing.`,
      'Ưu tiên cao', 'growth',
    ));
  } else if (lastDay.newSources === 0) {
    out.push(item(
      'Không có nguồn mới hôm nay — chủ động "gieo" tín hiệu',
      'Chủ động gửi 1 bài PR/thông cáo tới báo đối tác, đăng 1 bài chuyên môn (educational content) lên website/blog, hoặc mời 1 khách hàng thân thiết để lại đánh giá.',
      'Định kỳ', 'content',
    ));
  }

  if (watchItems && watchItems.length > 0) {
    out.push(item(
      `Rà soát ${watchItems.length} mục "cần theo dõi" cùng đội pháp lý/PR`,
      `${watchItems.slice(0, 3).map(w => `${w.type}${w.summary ? `: ${w.summary}` : ''}`).join(' · ')}${watchItems.length > 3 ? ` … và ${watchItems.length - 3} mục khác` : ''}.`,
      'Ưu tiên cao', 'crisis',
    ));
  }

  if (competitors && competitors.brands && competitors.brands.length) {
    const highRisk = competitors.brands.filter(b => b.riskLevel === 'high');
    if (highRisk.length > 0) {
      const names = highRisk.slice(0, 3).map(b => b.brand).join(', ');
      out.push(item(
        `${highRisk.length} đối thủ đang ở mức rủi ro cao — cơ hội hút khách hàng đang hoang mang`,
        `${names}${highRisk.length > 3 ? '…' : ''} đang có tin xấu/vi phạm được ghi nhận. Chuẩn bị nội dung giáo dục an toàn thẩm mỹ (không nêu đích danh đối thủ) và brief đội tư vấn kịch bản trả lời khi khách so sánh.`,
        'Ưu tiên cao', 'competitor',
      ));
    }
  }

  const topChannel = channels && channels.length ? channels.slice().sort((a, b) => b.count - a.count)[0] : null;
  if (topChannel) {
    out.push(item(
      `Giữ nhịp đăng bài trên ${topChannel.platform}`,
      `${topChannel.platform} hiện là kênh hiện diện nhiều nhất (${topChannel.count} trang/tài khoản ghi nhận). Đảm bảo tối thiểu 1 bài đăng chất lượng hôm nay để không tụt tương tác thuật toán.`,
      'Định kỳ', 'content',
    ));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Week / month / year mode — a short, verdict-driven supplement list: what
// to ADD or CHANGE for this period given how it compares to the prior one,
// scaled to how far ahead the granularity plans (a "tuần" item is tactical;
// a "năm" item is closer to annual strategy).
// ---------------------------------------------------------------------------
function buildSupplementItems({ mode, modeNoun, selBucket, tagStats, competitors, verdict }) {
  const out = [];
  const nextPeriod = NEXT_PERIOD_NOUN[mode] || `${modeNoun} tới`;

  // 1) Verdict-driven priority action — always first, directly answers "cần bổ sung gì".
  if (verdict.tone === 'danger') {
    out.push(item(
      'Ưu tiên số 1: kiểm soát rủi ro trước khi mở rộng',
      `Tạm dừng đẩy mạnh các chiến dịch quảng bá mới cho đến khi số tín hiệu tiêu cực giảm về mức nền — dồn ngân sách & nhân sự vào xử lý khủng hoảng và chăm sóc khách hàng đang bị ảnh hưởng.`,
      'Khẩn cấp', 'crisis',
    ));
  } else if (verdict.tone === 'success') {
    out.push(item(
      `Nhân rộng công thức đang hiệu quả sang ${nextPeriod}`,
      `Ghi lại chiến dịch/nội dung nào đã tạo ra đà tăng ${modeNoun} này (bài PR, KOL, ưu đãi...) và tăng ngân sách/tần suất cho đúng công thức đó thay vì thử nghiệm dàn trải.`,
      'Chiến lược', 'growth',
    ));
  } else if (verdict.tone === 'warning') {
    out.push(item(
      `Bổ sung tần suất nội dung cho ${nextPeriod}`,
      `Độ phủ đang giảm — lên lịch xuất bản tối thiểu đều đặn hơn (bài viết, PR, mạng xã hội) cho ${nextPeriod} thay vì để phụ thuộc vào nhắc-đến tự nhiên.`,
      'Chiến lược', 'content',
    ));
  } else {
    out.push(item(
      `Thử nghiệm 1 kênh/định dạng mới cho ${nextPeriod}`,
      `Chỉ số ${modeNoun} này ổn định, không có rủi ro cấp bách — tận dụng khoảng lặng để thử nghiệm (TikTok/Reels giáo dục quy trình, livestream tư vấn...) thay vì lặp lại đúng những gì đang có.`,
      'Định kỳ', 'growth',
    ));
  }

  // 2) Content mix — double down on the leading source-type, flag the weakest.
  if (tagStats && tagStats.length) {
    const leader = tagStats[0];
    const weakest = tagStats.length > 1 ? tagStats[tagStats.length - 1] : null;
    out.push(item(
      `Tập trung ngân sách nội dung vào "${leader.label}" (${leader.pct}%)`,
      `Đây là kênh/loại nguồn đóng góp nhiều nhất trong ${modeNoun} này.${weakest ? ` Cân nhắc mở rộng thêm "${weakest.label}" (mới ${weakest.pct}%) để không phụ thuộc một nguồn duy nhất.` : ''}`,
      'Chiến lược', 'content',
    ));
  }

  // 3) Competitive gap capture, from the latest competitor snapshot.
  if (competitors && competitors.brands && competitors.brands.length) {
    const weakest = competitors.brands.slice().sort((a, b) => b.badNews - a.badNews).filter(b => b.badNews > 0).slice(0, 3);
    if (weakest.length) {
      const names = weakest.map(b => `${b.brand} (${b.badNews} tin xấu)`).join(', ');
      out.push(item(
        `Khai thác khoảng trống từ đối thủ đang suy yếu trong ${nextPeriod}`,
        `${names}. Xây nội dung so sánh theo hướng giáo dục (an toàn, chứng chỉ, quy trình) — không nhắc tên đối thủ để tránh vi phạm quy định quảng cáo so sánh trực tiếp — và cân nhắc từ khoá tìm kiếm liên quan.`,
        'Chiến lược', 'competitor',
      ));
    }
  }

  // 4) Review-acquisition target, scaled to this period's granularity + negative volume.
  const reviewTarget = Math.max(REVIEW_BASELINE[mode] || 5, (selBucket.negative || 0) * 3);
  out.push(item(
    `Đặt mục tiêu ${reviewTarget}+ đánh giá tích cực mới cho ${nextPeriod}`,
    'Đánh giá thật từ khách hàng là "vùng đệm" bền vững nhất trước rủi ro truyền thông — giao chỉ tiêu cụ thể cho đội chăm sóc khách hàng thay vì để tự phát.',
    'Chiến lược', 'growth',
  ));

  // 5) Month/year only — standing compliance + (year-only) annual strategy items.
  if (mode === 'month' || mode === 'year') {
    out.push(item(
      `Rà soát tuân thủ quảng cáo & ngân sách ${modeNoun} này`,
      'Kiểm tra các bài đăng/quảng cáo trong kỳ với các cụm từ dễ vi phạm ("cam kết 100%", "tốt nhất", so sánh trực tiếp thương hiệu khác, hình ảnh trước–sau chưa được khách đồng ý) và đối chiếu chi tiêu marketing với kết quả thực tế trước khi lập ngân sách kỳ tới.',
      'Chiến lược', 'compliance',
    ));
  }
  if (mode === 'year') {
    out.push(item(
      `Đánh giá định vị thương hiệu & lập kế hoạch cho ${nextPeriod}`,
      'Xem lại toàn bộ dịch vụ/nhóm khách hàng đóng góp nhiều nhất trong năm, so sánh thị phần với nhóm đối thủ đang theo dõi, và chốt 2–3 mục tiêu chiến lược lớn (mở rộng dịch vụ, thị trường, hoặc kênh) cho năm kế tiếp.',
      'Chiến lược', 'growth',
    ));
  }

  return out;
}

const ITEMS_SECTION_TITLE = {
  day: 'Hành động hằng ngày',
  week: 'Đề xuất bổ sung cho tuần này',
  month: 'Đề xuất bổ sung cho tháng này',
  year: 'Định hướng bổ sung cho năm nay',
};

/**
 * Builds the full recommendation set for whichever period the dashboard's
 * period switcher currently has selected.
 * @param {Object} p
 * @param {string} p.mode        - 'day' | 'week' | 'month' | 'year' — must match the dashboard's own period switcher.
 * @param {string} p.modeNoun    - Vietnamese noun for `mode` ('ngày'/'tuần'/'tháng'/'năm').
 * @param {Object} p.selBucket   - the currently-selected period bucket (from buildBuckets).
 * @param {Object|null} p.prevBucket - the immediately preceding bucket of the SAME mode (from the same buildBuckets() array), or null if selBucket is the earliest.
 * @param {Object} p.lastDay     - days[days.length - 1], the most recent raw daily record (used for day-mode items regardless of `mode`, since "today's actions" are always today).
 * @param {Array}  p.days        - full array of raw daily records (ascending by date).
 * @param {Array}  p.channels    - [{ platform, count }].
 * @param {Array}  p.tagStats    - [{ label, count, pct }], sorted desc by count, for the selected bucket.
 * @param {Array}  p.watchItems  - [{ type, summary }], yellow-flag items for the selected period.
 * @param {Object|null} p.competitors - { date, brands: [{ brand, badNews, newArticles, riskLevel, note }] } or null if unavailable.
 * @returns {{ generatedAt: string, mode: string, periodLabel: string, verdict: {label:string, tone:string, reasoning:string}, itemsSectionTitle: string, items: RecoItem[] }}
 */
export function buildSerynRecommendations({
  mode, modeNoun, selBucket, prevBucket, lastDay, days, channels, tagStats, watchItems, competitors,
}) {
  const verdict = buildVerdict({ modeNoun, selBucket, prevBucket });

  const items = mode === 'day'
    ? buildDayItems({ lastDay, days, watchItems, channels, competitors })
    : buildSupplementItems({ mode, modeNoun, selBucket, tagStats, competitors, verdict });

  return {
    generatedAt: new Date().toISOString(),
    mode,
    periodLabel: selBucket.label,
    verdict,
    itemsSectionTitle: ITEMS_SECTION_TITLE[mode] || 'Khuyến nghị',
    items,
  };
}
