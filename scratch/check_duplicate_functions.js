const fs = require('fs');
const path = require('path');

function findDuplicateFunctions(filePath) {
  const code = fs.readFileSync(filePath, 'utf8');
  const lines = code.split('\n');
  const funcRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g;

  const funcMap = {};
  lines.forEach((line, index) => {
    let match;
    while ((match = funcRegex.exec(line)) !== null) {
      const name = match[1];
      if (!funcMap[name]) {
        funcMap[name] = [];
      }
      funcMap[name].push(index + 1);
    }
  });

  console.log(`🔍 ผลการสแกนฟังก์ชันใน ${path.basename(filePath)}:`);
  let hasDupes = false;
  for (const [name, lineNums] of Object.entries(funcMap)) {
    if (lineNums.length > 1) {
      console.log(`⚠️ พบฟังก์ชันซ้ำซ้อน: "${name}" ประกาศที่บรรทัด ${lineNums.join(', ')}`);
      hasDupes = true;
    }
  }

  if (!hasDupes) {
    console.log('✅ ไม่พบฟังก์ชันที่ประกาศซ้ำซ้อนเลยแม้แต่ฟังก์ชันเดียว!');
  }
}

findDuplicateFunctions(path.join(__dirname, '../public/js/app.js'));
findDuplicateFunctions(path.join(__dirname, '../routes/api.js'));
findDuplicateFunctions(path.join(__dirname, '../services/notification.js'));
