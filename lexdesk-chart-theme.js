/* ============================================================================
   LexDesk — Chart.js Theme (يقرأ التوكنات من lexdesk-design-tokens.css)
   استعمله بعد تحميل Chart.js وقبل إنشاء أي مخطط.
   توصيات ui-ux-pro-max:
     • توزيع حالات القضايا → Doughnut (بديل جدول دائماً)
     • المواعيد/الاتجاه الزمني → Line (Chart.js أصلاً، تباين AA)
     • Deficiency Tracker / المؤشرات → Bar أفقي مع القيمة كنص (تباين AAA)
     • تجنّب Treemap/Sunburst — تباين ضعيف (C) وغير مناسب للبيانات القانونية
   ============================================================================ */

const cssVar = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* لوحة تصنيفية مشتقّة من الهوية (navy → gold) — متمايزة وقابلة للتمييز */
const LEX_CATEGORICAL = ['#0A1C40', '#274C86', '#F5A623', '#0E8A5F', '#2563EB', '#8B5CF6', '#DC2626'];

/* ثيم عام يُطبّق على كل المخططات */
function applyLexChartTheme() {
  Chart.defaults.font.family = "'Tajawal', 'Cairo', sans-serif";
  Chart.defaults.color = cssVar('--color-fg-muted');
  Chart.defaults.borderColor = cssVar('--color-border');
  Chart.defaults.plugins.legend.rtl = true;      // مفتاح المخطط يمين→يسار
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.tooltip.rtl = true;     // التلميح RTL
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--color-surface');
  Chart.defaults.plugins.tooltip.titleColor = cssVar('--color-fg');
  Chart.defaults.plugins.tooltip.bodyColor = cssVar('--color-fg');
  Chart.defaults.plugins.tooltip.borderColor = cssVar('--color-border');
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
        borderColor: cssVar('--color-surface'),
        borderWidth: 3,
      }],
    },
    options: {
      cutout: '62%',
      plugins: { legend: { position: 'bottom' } },
      // ملاحظة وصولية: اعرض دائماً جدولاً بديلاً بنفس الأرقام تحت المخطط
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
        borderColor: cssVar('--color-primary'),
        backgroundColor: 'rgba(10, 28, 64, 0.10)',
        fill: true, tension: 0.35,
        pointBackgroundColor: cssVar('--color-accent'),
        pointRadius: 3, pointHoverRadius: 5,
      }],
    },
    options: {
      scales: {
        x: { reverse: true, grid: { display: false } },  // reverse للـ RTL
        y: { beginAtZero: true, grid: { color: cssVar('--color-border') } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

/* 3) Deficiency Tracker / المؤشرات — Bar أفقي (القيمة تبقى ظاهرة كنص) */
function lexDeficiencyBar(ctx, labels, values) {
  return new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: cssVar('--color-accent'),
        borderRadius: 6, barThickness: 18,
      }],
    },
    options: {
      indexAxis: 'y',                              // أفقي — أسهل قراءة للعناوين العربية
      scales: {
        x: { beginAtZero: true, position: 'top', grid: { color: cssVar('--color-border') } },
        y: { grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

/* الاستعمال:
   applyLexChartTheme();
   lexStatusDoughnut(document.getElementById('c1'), ['مفتوحة','مؤجلة','منجزة'], [12, 5, 30]);
*/
