/* ============================================================================
   LexDesk — Chart.js Theme (مربوط على هوية LexDesk الفعلية)
   يقرأ متغيّرات ستايلك (--text, --border, --surface, --font ...) فما يعتمد
   على أي ملف خارجي. حمّله قبل app.js — Chart.js محمّل قبله بالـ head.
   توصيات ui-ux-pro-max:
     • توزيع حالات القضايا → Doughnut (اعرض جدولاً بديلاً دائماً)
     • المواعيد/الاتجاه الزمني → Line
     • Deficiency Tracker / المؤشرات → Bar أفقي (القيمة ظاهرة كنص)
     • تجنّب Treemap/Sunburst (تباين ضعيف للبيانات القانونية)
   ============================================================================ */

const cssVar = (name, fallback = '') =>
  (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/* لوحة تصنيفية من ألوان هويتك الدلالية (ذهبي → أزرق → أخضر ...) */
const LEX_CATEGORICAL = ['#F5A623', '#3B82F6', '#22D3A0', '#A78BFA', '#FB923C', '#FF5572', '#60A5FA'];

/* ثيم عام يُطبّق على كل المخططات */
function applyLexChartTheme() {
  Chart.defaults.font.family = cssVar('--font', "'Tajawal', sans-serif");
  Chart.defaults.color = cssVar('--text2', '#9395A8');
  Chart.defaults.borderColor = cssVar('--border', 'rgba(255,255,255,.10)');
  Chart.defaults.plugins.legend.rtl = true;      // مفتاح المخطط يمين→يسار
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.rtl = true;     // التلميح RTL
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--surface', '#252530');
  Chart.defaults.plugins.tooltip.titleColor = cssVar('--text', '#EEEEF5');
  Chart.defaults.plugins.tooltip.bodyColor = cssVar('--text', '#EEEEF5');
  Chart.defaults.plugins.tooltip.borderColor = cssVar('--border', 'rgba(255,255,255,.10)');
  Chart.defaults.plugins.tooltip.borderWidth = 1;
}

/* 1) توزيع حالات القضايا — Doughnut */
function lexStatusDoughnut(ctx, labels, values) {
  return new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: LEX_CATEGORICAL,
        borderColor: cssVar('--surface', '#252530'),
        borderWidth: 3,
      }],
    },
    options: {
      cutout: '62%',
      plugins: { legend: { position: 'bottom' } },
      // وصولية: اعرض دائماً جدولاً بديلاً بنفس الأرقام تحت المخطط
    },
  });
}

/* 2) المواعيد/الاتجاه عبر الزمن — Line */
function lexDeadlineLine(ctx, labels, values) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'المواعيد',
        data: values,
        borderColor: cssVar('--gold', '#F5A623'),
        backgroundColor: cssVar('--gold-g', 'rgba(245,166,35,.12)'),
        fill: true, tension: 0.35,
        pointBackgroundColor: cssVar('--gold', '#F5A623'),
        pointRadius: 3, pointHoverRadius: 5,
      }],
    },
    options: {
      scales: {
        x: { reverse: true, grid: { display: false } },  // reverse للـ RTL
        y: { beginAtZero: true, grid: { color: cssVar('--border', 'rgba(255,255,255,.10)') } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

/* 3) Deficiency Tracker / المؤشرات — Bar أفقي */
function lexDeficiencyBar(ctx, labels, values) {
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: cssVar('--gold', '#F5A623'),
        borderRadius: 6, barThickness: 18,
      }],
    },
    options: {
      indexAxis: 'y',                              // أفقي — أسهل قراءة للعناوين العربية
      scales: {
        x: { beginAtZero: true, position: 'top', grid: { color: cssVar('--border', 'rgba(255,255,255,.10)') } },
        y: { grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

/* تطبيق تلقائي أول ما يتحمّل — لا تحتاج تنادي شي بـ app.js */
if (typeof Chart !== 'undefined') { applyLexChartTheme(); }

/* الاستعمال داخل app.js:
   lexStatusDoughnut(document.getElementById('c1'), ['مفتوحة','مؤجلة','منجزة'], [12, 5, 30]);
*/
