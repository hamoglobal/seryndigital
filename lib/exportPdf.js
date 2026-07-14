// lib/exportPdf.js
// Client-side PDF export for the source/channel list modals ("Xuất file
// PDF"). Dynamically imports jsPDF so it's only pulled into the bundle when
// someone actually clicks the button, not on initial page load.

export async function exportListToPdf({ title, subtitle, items, filename }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const marginX = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  let y = 50;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title || 'Danh sách nguồn', marginX, y);
  y += 20;

  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(subtitle, marginX, y);
    doc.setTextColor(0);
    y += 16;
  }

  doc.setDrawColor(220);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 18;

  if (!items || items.length === 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Không có mục nào để xuất.', marginX, y);
  }

  (items || []).forEach((item, i) => {
    const headingLines = doc.splitTextToSize(`${i + 1}. ${item.heading || '(không có tiêu đề)'}`, maxWidth);
    const lineBlocks = (item.lines || []).filter(Boolean).map(l => doc.splitTextToSize(l, maxWidth));
    const neededHeight = headingLines.length * 13 + lineBlocks.reduce((sum, b) => sum + b.length * 11, 0) + 10;

    if (y + neededHeight > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(headingLines, marginX, y);
    y += headingLines.length * 13;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100);
    lineBlocks.forEach(block => {
      doc.text(block, marginX, y);
      y += block.length * 11;
    });
    doc.setTextColor(0);
    y += 10;
  });

  doc.save(filename || 'nguon.pdf');
}
