// lib/recommendations.js
// "Khuyến nghị Seryn" — a rule-based advisory engine that reads the same live
// data already powering the dashboard (Seryn's own sentiment/risk numbers +
// the 14-competitor risk ranking) and turns it into a prioritized action plan,
// written the way a senior aesthetic/medical-beauty marketing consultant
// (10+ years in the ngành thẩm mỹ — sức khoẻ) would brief a clinic's founder:
// what to do TODAY, and what to plan for THIS WEEK.
//
// This is deliberately rule-based rather than calling an LLM: the app has no
// AI API wired in (see package.json), so every recommendation below is a
// template whose wording is chosen by real analysts/marketers and whose
// specifics (numbers, brand names, channel names) are filled in from the
// actual dashboard data at generation time — no network call, no API key,
// fully deterministic and free to run on every click.
//
// Public entry point: buildSerynRecommendations({...}) -> RecommendationSet
// (see the JSDoc typedef below). Everything else in this file is a private
// helper feeding that one function.

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

/** Compares the trailing 7 days against the 7 days before that, for a simple week-over-week read. */
function weekOverWeekTrend(days) {
  if (!days || days.length < 4) return null;
  const last7 = days.slice(-7);
  const prev7 = days.slice(-14, -7);
  if (prev7.length === 0) return null;
  const a = sumDays(last7);
  const b = sumDays(prev7);
  const negDelta = a.negative - b.negative;
  const posDelta = a.positive - b.positive;
  return { last7: a, prev7: b, negDelta, posDelta };
}

function fmtSigned(n) {
  return n > 0 ? `+${n}` : String(n);
}

// ---------------------------------------------------------------------------
// Daily action items — reacts to the single most recent ingested day, since
// these are meant to be re-checked every morning regardless of which period
// the user currently has selected in the period switcher.
// ---------------------------------------------------------------------------
function buildDailyItems({ lastDay, days, watchItems, channels, competitors }) {
  const out = [];

  // 1) Crisis response / "safe zone" maintenance — always the first, highest-signal item.
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

  // 2) Amplify today's positive coverage, if any.
  if (lastDay.positive > 0) {
    out.push(item(
      `Khuếch đại ${lastDay.positive} tin/đánh giá tích cực hôm nay`,
      'Re-share lên fanpage & Zalo OA trong ngày trong khi vẫn còn tính thời sự, gắn thẻ/cảm ơn người đăng nếu là khách hàng thật, và tận dụng đà tích cực để xin thêm 2–3 đánh giá mới từ khách vừa trải nghiệm dịch vụ (thời điểm khách hài lòng nhất để xin review 5 sao là trong vòng 24–48h sau buổi hẹn).',
      'Định kỳ', 'content',
    ));
  }

  // 3) Volume-spike or volume-flat signal, based on a 7-day baseline of newSources.
  const recent7 = days.slice(-8, -1); // the 7 days *before* lastDay, as a baseline
  const baseline = recent7.length ? sumDays(recent7).newSources / recent7.length : 0;
  if (baseline > 0 && lastDay.newSources >= baseline * 1.5 && lastDay.newSources >= 2) {
    out.push(item(
      `Tín hiệu tăng đột biến: +${lastDay.newSources} nguồn mới hôm nay`,
      `Cao hơn đáng kể so với trung bình 7 ngày gần nhất (~${baseline.toFixed(1)} nguồn/ngày). Xác định nguyên nhân (chiến dịch đang chạy, bài PR mới lên, hay bị nhắc tới trong một câu chuyện đang viral) và nhân bản cách tiếp cận đó nếu đến từ nỗ lực chủ động của phòng marketing.`,
      'Ưu tiên cao', 'growth',
    ));
  } else if (lastDay.newSources === 0) {
    out.push(item(
      'Không có nguồn mới hôm nay — chủ động "gieo" tín hiệu',
      'Một ngày không có nhắc-đến mới đồng nghĩa thương hiệu đang im lặng trên các kênh được theo dõi. Chủ động gửi 1 bài PR/thông cáo tới báo đối tác, đăng 1 bài chuyên môn (educational content) lên website/blog, hoặc mời 1 khách hàng thân thiết để lại đánh giá — đừng để thuật toán tìm kiếm và mạng xã hội "quên" thương hiệu.',
      'Định kỳ', 'content',
    ));
  }

  // 4) Same-day check-in on anything still flagged yellow/watch.
  if (watchItems && watchItems.length > 0) {
    out.push(item(
      `Rà soát ${watchItems.length} mục "cần theo dõi" cùng đội pháp lý/PR`,
      `${watchItems.slice(0, 3).map(w => `${w.type}${w.summary ? `: ${w.summary}` : ''}`).join(' · ')}${watchItems.length > 3 ? ` … và ${watchItems.length - 3} mục khác` : ''}. Xác nhận mục nào là rủi ro thực sự cần phản hồi và mục nào chỉ là carry-forward chưa cập nhật, để tránh vừa bỏ sót vừa báo động giả.`,
      'Ưu tiên cao', 'crisis',
    ));
  }

  // 5) Competitor-driven daily opportunity, if competitor data is available.
  if (competitors && competitors.brands && competitors.brands.length) {
    const highRisk = competitors.brands.filter(b => b.riskLevel === 'high');
    if (highRisk.length > 0) {
      const names = highRisk.slice(0, 3).map(b => b.brand).join(', ');
      out.push(item(
        `${highRisk.length} đối thủ đang ở mức rủi ro cao — cơ hội hút khách hàng đang hoang mang`,
        `${names}${highRisk.length > 3 ? '…' : ''} đang có tin xấu/vi phạm được ghi nhận trong báo cáo đối thủ ngày ${competitors.date || ''}. Trong ngày: chuẩn bị nội dung giáo dục an toàn thẩm mỹ (không nêu đích danh đối thủ, đúng quy định quảng cáo dịch vụ khám chữa bệnh), rà soát để đội tư vấn sẵn sàng trả lời khi khách so sánh, và cân nhắc remarketing tới nhóm đang tìm kiếm dịch vụ tương tự.`,
        'Ưu tiên cao', 'competitor',
      ));
    }
    const mostActive = competitors.brands.slice().sort((a, b) => b.newArticles - a.newArticles)[0];
    if (mostActive && mostActive.newArticles >= 3) {
      out.push(item(
        `${mostActive.brand} đang đẩy truyền thông mạnh (${mostActive.newArticles} bài mới)`,
        'Dành 15 phút xem nhanh thông điệp & kênh họ đang dùng (báo chí, KOL, hay quảng cáo trả phí) để không bị động nếu họ đang chạy một chiến dịch/ưu đãi lớn.',
        'Định kỳ', 'competitor',
      ));
    }
  }

  // 6) A channel-posting cadence reminder — always present, points at whichever channel currently leads.
  const topChannel = channels && channels.length ? channels.slice().sort((a, b) => b.count - a.count)[0] : null;
  if (topChannel) {
    out.push(item(
      `Giữ nhịp đăng bài trên ${topChannel.platform}`,
      `${topChannel.platform} hiện là kênh hiện diện nhiều nhất (${topChannel.count} trang/tài khoản ghi nhận). Đảm bảo tối thiểu 1 bài đăng chất lượng hôm nay để không tụt tương tác thuật toán — nhất quán còn quan trọng hơn số lượng.`,
      'Định kỳ', 'content',
    ));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Weekly / strategic items — reacts to the selected reporting period +
// week-over-week trend, meant for a weekly marketing/leadership review.
// ---------------------------------------------------------------------------
function buildWeeklyItems({ selBucket, rangeLabel, modeNoun, days, tagStats, competitors, positivePct }) {
  const out = [];
  const trend = weekOverWeekTrend(days);

  // 1) Trend read.
  if (trend) {
    if (trend.negDelta > 0) {
      out.push(item(
        `Tiêu cực tuần này tăng ${fmtSigned(trend.negDelta)} so với tuần trước`,
        `Tuần gần nhất: ${trend.last7.negative} tín hiệu tiêu cực (tuần trước: ${trend.prev7.negative}). Dành 30 phút đầu tuần rà soát nguyên nhân gốc (dịch vụ cụ thể? nhân sự cụ thể? một bài báo/review lan truyền?) trước khi lặp lại tuần sau — xử lý từ gốc rẻ hơn nhiều so với xử lý khủng hoảng liên tục.`,
        'Chiến lược', 'crisis',
      ));
    } else if (trend.posDelta > 0) {
      out.push(item(
        `Tích cực tuần này tăng ${fmtSigned(trend.posDelta)} so với tuần trước`,
        `Xu hướng đang đi đúng hướng. Ghi lại chiến dịch/nội dung nào đã tạo ra đà này (bài PR, KOL, chương trình ưu đãi...) và lên lịch lặp lại/mở rộng ngân sách trong tuần tới.`,
        'Chiến lược', 'growth',
      ));
    } else {
      out.push(item(
        'Chỉ số tuần này tương đối ổn định so với tuần trước',
        'Không có biến động lớn — đây là thời điểm phù hợp để thử nghiệm 1 kênh/định dạng nội dung mới (ví dụ TikTok/Reels giáo dục quy trình, livestream tư vấn) thay vì chỉ lặp lại những gì đang có.',
        'Định kỳ', 'growth',
      ));
    }
  }

  // 2) Content mix — double down on the leading source-type, flag the weakest.
  if (tagStats && tagStats.length) {
    const leader = tagStats[0];
    const weakest = tagStats.length > 1 ? tagStats[tagStats.length - 1] : null;
    out.push(item(
      `Tập trung ngân sách nội dung vào "${leader.label}" (${leader.pct}% tổng nguồn)`,
      `Đây là kênh/loại nguồn đang đóng góp nhiều nhất trong ${rangeLabel}. Ưu tiên phân bổ ngân sách content & booking báo chí/KOL tuần tới cho nhóm này, đồng thời${weakest ? ` cân nhắc thử nghiệm mở rộng "${weakest.label}" (mới ${weakest.pct}%) để không phụ thuộc vào một nguồn duy nhất.` : '.'}`,
      'Chiến lược', 'content',
    ));
  }

  // 3) Review-acquisition target, scaled to the negative volume seen this period (simple buffer heuristic).
  const reviewTarget = Math.max(5, (selBucket.negative || 0) * 3);
  out.push(item(
    `Đặt mục tiêu thu thập ${reviewTarget}+ đánh giá tích cực mới trong tuần`,
    `Tỷ lệ tích cực hiện tại ${positivePct}% trong ${rangeLabel}. Đánh giá thật từ khách hàng là "vùng đệm" bền vững nhất trước rủi ro truyền thông — giao chỉ tiêu cụ thể cho đội chăm sóc khách hàng (Google Business, Facebook, các nền tảng đặt lịch y tế) thay vì để tự phát.`,
    'Chiến lược', 'growth',
  ));

  // 4) Competitive gap capture, based on which competitors accumulated the most bad news this period.
  if (competitors && competitors.brands && competitors.brands.length) {
    const weakest = competitors.brands.slice().sort((a, b) => b.badNews - a.badNews).filter(b => b.badNews > 0).slice(0, 3);
    if (weakest.length) {
      const names = weakest.map(b => `${b.brand} (${b.badNews} tin xấu)`).join(', ');
      out.push(item(
        'Lên kế hoạch thu hút khách hàng từ các đối thủ đang suy yếu',
        `${names}. Tuần này: (1) xây 1 trang landing/nội dung so sánh dịch vụ theo hướng giáo dục (an toàn, chứng chỉ, quy trình) — không nhắc tên đối thủ để tránh vi phạm quy định quảng cáo so sánh trực tiếp, (2) cân nhắc chạy từ khoá tìm kiếm liên quan đến nhóm dịch vụ mà các thương hiệu này đang bị phản ánh, (3) brief đội tư vấn kịch bản xử lý khi khách hỏi so sánh.`,
        'Chiến lược', 'competitor',
      ));
    }
  }

  // 5) Compliance / legal audit — a standing weekly item given how heavily-regulated
  // Vietnamese aesthetic-clinic advertising is (Luật Quảng cáo, Nghị định 15/2018/NĐ-CP,
  // Thông tư Bộ Y tế về quảng cáo dịch vụ khám chữa bệnh).
  out.push(item(
    'Rà soát tuần: ngôn từ quảng cáo & tuân thủ quy định y tế',
    'Kiểm tra các bài đăng/quảng cáo mới trong tuần (của Seryn lẫn ghi nhận từ đối thủ) với các cụm từ dễ vi phạm: "cam kết 100%", "tốt nhất", "duy nhất", so sánh trực tiếp thương hiệu khác, hoặc dùng hình ảnh trước–sau chưa được đồng ý của khách hàng. Vi phạm ở đối thủ là bài học phòng ngừa; vi phạm ở Seryn cần gỡ/sửa ngay trong tuần trước khi bị nhắc nhở từ cơ quan quản lý.',
    'Chiến lược', 'compliance',
  ));

  // 6) Channel diversification / KOC calendar planning.
  out.push(item(
    'Chốt lịch KOL/KOC & nội dung cho tuần tới',
    'Duyệt trước ít nhất 3–5 nội dung (bài viết, video ngắn, livestream) cho tuần kế tiếp thay vì lên kế hoạch theo ngày — giúp phản ứng nhanh hơn khi có tin tiêu cực bất ngờ vì lịch nội dung "an toàn" đã có sẵn để lấp chỗ trống truyền thông.',
    'Định kỳ', 'content',
  ));

  return out;
}

/**
 * Builds the full recommendation set.
 * @param {Object} p
 * @param {Object} p.selBucket   - the currently-selected period bucket (from buildBuckets), used for headline KPIs.
 * @param {Object} p.lastDay     - days[days.length - 1], the most recent raw daily record.
 * @param {Array}  p.days        - full array of raw daily records (ascending by date), for trend calc.
 * @param {string} p.mode        - 'day' | 'week' | 'month' | 'year'.
 * @param {string} p.modeNoun    - Vietnamese noun for `mode` ('ngày'/'tuần'/'tháng'/'năm').
 * @param {string} p.rangeLabel  - human label for the overall date range shown in the hero.
 * @param {Array}  p.channels    - [{ platform, count }].
 * @param {Array}  p.tagStats    - [{ label, count, pct }], sorted desc by count.
 * @param {Array}  p.watchItems  - [{ type, summary }], yellow-flag items for the selected period.
 * @param {Object|null} p.competitors - { date, brands: [{ brand, badNews, newArticles, riskLevel, note }] } or null if unavailable.
 * @returns {{ generatedAt: string, periodLabel: string, headline: string, posture: {label:string, tone:string}, daily: RecoItem[], weekly: RecoItem[] }}
 */
export function buildSerynRecommendations({
  selBucket, lastDay, days, mode, modeNoun, rangeLabel, channels, tagStats, watchItems, competitors,
}) {
  const total = selBucket.total || 0;
  const positivePct = pct(selBucket.positive, total);
  const negativePct = pct(selBucket.negative, total);

  const highRiskCompetitors = competitors?.brands ? competitors.brands.filter(b => b.riskLevel === 'high') : [];
  const competitorCount = competitors?.brands ? competitors.brands.length : 0;

  let posture;
  if (selBucket.riskLevel === 'red' || negativePct >= 25) {
    posture = { label: 'Phòng thủ & xử lý khủng hoảng', tone: 'danger' };
  } else if (positivePct >= 65 && competitorCount > 0 && highRiskCompetitors.length / competitorCount >= 0.25) {
    posture = { label: 'Tấn công mở rộng thị phần', tone: 'success' };
  } else {
    posture = { label: 'Ổn định & tối ưu vận hành', tone: 'brand' };
  }

  const competitorClause = competitorCount > 0
    ? `So với ${competitorCount} thương hiệu đối thủ đang theo dõi, có ${highRiskCompetitors.length} thương hiệu ở mức rủi ro cao — ${highRiskCompetitors.length > 0 ? 'đây là khoảng trống thị trường Seryn nên chủ động khai thác.' : 'mặt bằng cạnh tranh hiện tương đối yên ắng, tập trung vào chất lượng nội dung thay vì phản ứng đối thủ.'}`
    : 'Chưa có dữ liệu đối thủ cho kỳ này để đối chiếu.';

  const headline = `Seryn Clinic đang ở trạng thái "${posture.label}" trong ${rangeLabel}: ${total} nguồn được ghi nhận, ${positivePct}% tích cực, ${selBucket.negative} tín hiệu tiêu cực/cảnh báo cần xử lý. ${competitorClause}`;

  const daily = buildDailyItems({ lastDay, days, watchItems, channels, competitors });
  const weekly = buildWeeklyItems({ selBucket, rangeLabel, modeNoun, days, tagStats, competitors, positivePct });

  return {
    generatedAt: new Date().toISOString(),
    periodLabel: rangeLabel,
    headline,
    posture,
    daily,
    weekly,
  };
}
