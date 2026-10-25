const Database = require('better-sqlite3');
const db = new Database('shuttle_db.sqlite');
try {
  const academy = db.prepare('SELECT * FROM academies LIMIT 1').get();
  console.log('Academy:', academy);
  
  if (academy) {
    const defaultPoints = [
      { name: '은마아파트 앞', latitude: academy.latitude + 0.002, longitude: academy.longitude + 0.002 },
      { name: '삼성래미안 정문', latitude: academy.latitude - 0.003, longitude: academy.longitude - 0.001 },
      { name: '현대힐스테이트 후문', latitude: academy.latitude + 0.001, longitude: academy.longitude - 0.004 },
      { name: '청담자이 상가', latitude: academy.latitude - 0.002, longitude: academy.longitude + 0.003 },
      { name: '압구정파출소 앞', latitude: academy.latitude + 0.004, longitude: academy.longitude },
    ];
    
    let added = 0;
    for (const pt of defaultPoints) {
      const exists = db.prepare('SELECT * FROM pickup_point WHERE name = ?').get(pt.name);
      if (!exists) {
        db.prepare('INSERT INTO pickup_point (name, latitude, longitude) VALUES (?, ?, ?)').run(pt.name, pt.latitude, pt.longitude);
        added++;
      }
    }
    console.log(`Added ${added} default pickup points!`);
  } else {
    console.log('No academy found, inserting default points at 37.565, 126.975');
    const defaultPoints = [
      { name: '은마아파트 앞', latitude: 37.567, longitude: 126.977 },
      { name: '삼성래미안 정문', latitude: 37.562, longitude: 126.974 },
      { name: '현대힐스테이트 후문', latitude: 37.566, longitude: 126.971 },
      { name: '청담자이 상가', latitude: 37.563, longitude: 126.978 },
      { name: '압구정파출소 앞', latitude: 37.569, longitude: 126.975 },
    ];
    
    let added = 0;
    for (const pt of defaultPoints) {
      const exists = db.prepare('SELECT * FROM pickup_point WHERE name = ?').get(pt.name);
      if (!exists) {
        db.prepare('INSERT INTO pickup_point (name, latitude, longitude) VALUES (?, ?, ?)').run(pt.name, pt.latitude, pt.longitude);
        added++;
      }
    }
    console.log(`Added ${added} default pickup points!`);
  }
} catch (e) {
  console.error(e);
}
