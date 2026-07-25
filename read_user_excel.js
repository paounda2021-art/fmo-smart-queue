const XLSX = require('xlsx');
const fs = require('fs');

function inspectExcel() {
  console.log('📖 Reading fmo_personnel.xlsx...');
  const workbook = XLSX.readFile('fmo_personnel.xlsx');
  console.log('Sheet Names:', workbook.SheetNames);

  workbook.SheetNames.forEach(sheetName => {
    console.log(`\n========================================`);
    console.log(`SHEET: ${sheetName}`);
    console.log(`========================================`);
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Total rows: ${data.length}`);
    console.log('First 15 rows:');
    console.log(data.slice(0, 15));
  });
}

inspectExcel();
