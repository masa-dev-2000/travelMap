import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getDatabase, ref, get, update } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

// Firebase初期化（再びOK）
const firebaseConfig = {
  apiKey: "AIzaSyBtUbgKYgFwrQmES7rmZSCN0TaAV3aPKKI",
  authDomain: "sharetravelinfolikedq.firebaseapp.com",
  databaseURL: "https://sharetravelinfolikedq-default-rtdb.firebaseio.com",
  projectId: "sharetravelinfolikedq",
  storageBucket: "sharetravelinfolikedq.firebasestorage.app",
  messagingSenderId: "460046576435",
  appId: "1:460046576435:web:456ee14f8b271cf2caac46"
};
initializeApp(firebaseConfig);
const db = getDatabase();

// 実行ログ表示
const status = document.createElement("div");
status.style.padding = "1em";
status.style.background = "#eef";
status.textContent = "変換処理中...";
document.body.appendChild(status);

// tag → memo にリネーム + amount_category を追加
async function transformLogs() {
  const logsRef = ref(db, "logs");
  const snapshot = await get(logsRef);

  if (!snapshot.exists()) {
    status.textContent = "⚠️ ログが存在しません。";
    return;
  }

  const updates = {};
  snapshot.forEach(child => {
    const key = child.key;
    const data = child.val();

    // tag がある場合は memo に移動
    if (data.tag !== undefined) {
      updates[`logs/${key}/memo`] = data.tag;
      updates[`logs/${key}/tag`] = null; // 元のtagは削除
    }

    // amount_category がなければ追加
    if (data.amount_category === undefined) {
      updates[`logs/${key}/amount_category`] = "その他"; // 初期カテゴリ
    }
  });

  if (Object.keys(updates).length === 0) {
    status.textContent = "すべてのログはすでに変換済みです！";
  } else {
    await update(ref(db), updates);
    status.textContent = `✅ ${Object.keys(updates).length} 件を変換しました！`;
  }
}

transformLogs();
