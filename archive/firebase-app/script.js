const firebaseConfig = {
  apiKey: "AIzaSyBtUbgKYgFwrQmES7rmZSCN0TaAV3aPKKI",
  authDomain: "sharetravelinfolikedq.firebaseapp.com",
  databaseURL: "https://sharetravelinfolikedq-default-rtdb.firebaseio.com",
  projectId: "sharetravelinfolikedq"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// 明示的にズームボタン非表示 → カスタムで右下に追加
const map = L.map('map', { zoomControl: false }).setView([35.6812, 139.7671], 5);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);

window.addEventListener("load", () => {
  setTimeout(() => map.invalidateSize(), 800);
});

const CATEGORY_SETTINGS = {
  食費: { color: 'red' },
  交通費: { color: 'blue' },
  作業: { color: 'green' },
  その他: { color: 'gray' }
};

let polyline;
let markers = [];

db.ref("logs").orderByChild("timestamp").on("value", async (snapshot) => {
  const logsObj = snapshot.val();
  if (!logsObj) return;

  if (polyline) map.removeLayer(polyline);
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const logs = Object.values(logsObj).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const latest = logs[logs.length - 1];
  const { lat, lng, memo = "", amount = 0, timestamp } = latest;

  const jst = new Date(timestamp);
  const dateStr = `${jst.getFullYear()}年${jst.getMonth() + 1}月${jst.getDate()}日`;
  const timeStr = `${String(jst.getHours()).padStart(2, '0')}時${String(jst.getMinutes()).padStart(2, '0')}分`;

  let addressText = "取得中...";
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
    const data = await res.json();
    const addr = data.address;
    addressText = [addr.state, addr.city || addr.town || addr.village]
      .filter(part => part && !/日本|〒/.test(part))
      .join(" ");
  } catch (e) {
    addressText = "住所取得エラー";
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart); weekStart.setDate(todayStart.getDate() - todayStart.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let today = 0, week = 0, month = 0, total = 0;

  const latlngs = [];

  logs.forEach((log, i) => {
    const t = new Date(log.timestamp);
    const amt = Number(log.amount) || 0;
    total += amt;
    if (t >= todayStart) today += amt;
    if (t >= weekStart) week += amt;
    if (t >= monthStart) month += amt;

    const pos = [log.lat, log.lng];
    latlngs.push(pos);

    const logDate = new Date(log.timestamp);
    const logDateStr = `${logDate.getFullYear()}年${logDate.getMonth() + 1}月${logDate.getDate()}日`;
    const logTimeStr = `${String(logDate.getHours()).padStart(2, '0')}時${String(logDate.getMinutes()).padStart(2, '0')}分`;
    const logMemo = log.memo || "（メモなし）";
    const logAmount = log.amount || 0;
    const category = log.amount_category || "その他";
    const color = CATEGORY_SETTINGS[category]?.color || "gray";

    if (i === logs.length - 1) {
      const marker = L.marker(pos).addTo(map)
        .bindPopup(`<b>${logDateStr} ${logTimeStr}</b><br>メモ：${logMemo}<br>出費：¥${logAmount}`)
        .openPopup();
      markers.push(marker);
    } else {
      const node = L.circleMarker(pos, {
        radius: 4,
        fillColor: color,
        color: "#000",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.8
      })
        .bindPopup(`<b>${logDateStr} ${logTimeStr}</b><br>メモ：${logMemo}<br>出費：¥${logAmount}`)
        .addTo(map);
      markers.push(node);
    }
  });

  if (latlngs.length > 1) {
    polyline = L.polyline(latlngs, {
      color: 'blue',
      weight: 4,
      opacity: 0.6,
      dashArray: '6, 8'
    }).addTo(map);
  }

  map.setView([lat+0.1, lng], 10);
  setTimeout(() => map.invalidateSize(), 500);

  document.getElementById("status").innerHTML = `
    日付：${dateStr}<br>
    時刻：${timeStr}<br>
    住所：${addressText}<br>
    <div class="memo">メモ：${memo}</div>
    出費：¥${amount}
  `;

  document.getElementById("amountStats").innerHTML = `
    今日：¥${today}<br>
    今週：¥${week}<br>
    今月：¥${month}<br>
    合計：¥${total}<br>
    資金：¥???
  `;
});

// 凡例を左下に追加
const legend = L.control({ position: 'bottomleft' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'info legend');
  div.innerHTML = "<b>カテゴリ凡例</b><br>";
  for (const cat in CATEGORY_SETTINGS) {
    const color = CATEGORY_SETTINGS[cat].color;
    div.innerHTML += `<i style="background:${color};width:12px;height:12px;display:inline-block;margin-right:6px;"></i>${cat}<br>`;
  }
  return div;
};
legend.addTo(map);