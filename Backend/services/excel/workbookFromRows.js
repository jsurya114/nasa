// Presents rows already read into plain arrays (see readWorkbookRows.js) with the few parts of an ExcelJS workbook that the assignment-history reader
// (assignmentHistory/assignmentWorkbook.js) uses, so that reader works unchanged on rows and does not need ExcelJS's cell objects.
//
// What it gives: workbook.worksheets[] with name, getRow(n).eachCell({ includeEmpty: false }, (cell, column) => ...),
// eachRow({ includeEmpty: false }, (row, rowNumber) => ...), and row.getCell(column).value. A missing cell has the value null, as in ExcelJS.

const hasValues = (row) => Array.isArray(row) && row.some(() => true);

const cellAt = (row, column) => ({ value: row?.[column - 1] ?? null });

const rowAt = (rows, number) => {
  const row = rows[number - 1] ?? [];
  return {
    getCell: (column) => cellAt(row, column),
    eachCell: (options, callback) => { row.forEach((value, index) => callback({ value }, index + 1)); },
  };
};

export const workbookFromRows = (sheets) => ({
  worksheets: Object.entries(sheets).map(([name, rows]) => ({
    name,
    getRow: (number) => rowAt(rows, number),
    eachRow: (options, callback) => {
      for (let index = 0; index < rows.length; index += 1) {
        if (hasValues(rows[index])) callback(rowAt(rows, index + 1), index + 1);
      }
    },
  })),
});
