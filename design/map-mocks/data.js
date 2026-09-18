export const references={
  osm:{name:'OpenStreetMap',url:'https://www.openstreetmap.org/',image:'openstreetmap.png',note:'地図の端に操作を寄せ、情報パネルを閉じて地図へ戻れる配置。'},
  google:{name:'Google Maps',url:'https://www.google.com/maps',image:'google-maps.png',note:'地図に浮く検索バー、分類チップ、細いナビゲーションレール。'},
  apple:{name:'Apple Maps',url:'https://maps.apple.com/',image:'apple-maps.png',note:'地図と操作を分離する小型コントロールと、開閉できるサイドバー。'},
  mapy:{name:'Mapy.com',url:'https://mapy.com/',image:'mapy.png',note:'右側のタブと折りたたみ可能なパネル。地図の広さを保つ構造。'},
  windy:{name:'Windy',url:'https://www.windy.com/',image:'windy.png',note:'地図全面を保ちながら、端の操作と下部の時間バーで表示を切り替える。'},
  komoot:{name:'komoot',url:'https://www.komoot.com/plan',image:'komoot.png',note:'訪問地点を順番に扱う旅程パネルと、地図上の地点に結びついた操作。'},
};
export const designs=[
 {id:1,name:'地図に集中',en:'QUIET CANVAS',ref:'osm',lead:'何も開かず、まず地図。',description:'左上の小さなメニューだけを常設。必要な機能を選ぶとサイドパネルが開きます。スマホでは下部シートになります。',shape:'minimal'},
 {id:2,name:'検索から探す',en:'SEARCH & DISCOVER',ref:'google',lead:'探す言葉から旅をたどる。',description:'検索バーに記録名やメモを入力。検索結果と地図のピンが連動します。分類チップで素早く絞り込めます。',shape:'search'},
 {id:3,name:'浮遊カード',en:'FLOATING ISLAND',ref:'apple',lead:'小さなカードが、旅の入口。',description:'左上の旅カードを開くと、地図から少し離れた浮遊パネルが展開。選択した場所を一枚のカードで見せます。',shape:'island'},
 {id:4,name:'細い操作レール',en:'COMPACT RAIL',ref:'google',lead:'機能は端に、地図は広く。',description:'PCは左の細いレール、スマホは下の細いバー。アイコンから記録・収支・入力へ直接切り替えます。',shape:'rail'},
 {id:5,name:'引き出し型',en:'SIDE DRAWER',ref:'mapy',lead:'必要なときだけ、引き出す。',description:'右端のタブから引き出しを開きます。スマホでは下端のつまみに変わり、いつでも地図に戻れます。',shape:'drawer'},
 {id:6,name:'下部ドック',en:'GROUND CONTROL',ref:'apple',lead:'操作は手元の一か所に。',description:'画面下の小さなドックに操作を集約。PCもスマホも、情報が下から立ち上がります。Apple Mapsの独立した操作群を下部に再構成。',shape:'dock'},
 {id:7,name:'時間をたどる',en:'DAYS ON THE MAP',ref:'windy',lead:'日付を送ると、地図が変わる。',description:'下部の日付バーを開いて一日ずつ記録を表示。日付バーは一行に折りたためます。収支は別パネルで確認。',shape:'timeline'},
 {id:8,name:'旅程をたどる',en:'JOURNEY STEPS',ref:'komoot',lead:'旅を、訪れた順番で。',description:'旅名を開くと訪問順のリスト。前後の地点へ送りながら詳細を確認できます。経路案内ではなく旅の記録です。',shape:'journey'},
 {id:9,name:'ピンから操作',en:'PLACE FIRST',ref:'osm',lead:'その場所に触れると、記録が開く。',description:'常設の一覧を置かず、ピンを入口にします。場所の近くに小さな操作を出し、詳細は下部の一枚カードで表示。',shape:'pin'},
 {id:10,name:'片手で操作',en:'THUMB REACH',ref:'windy',lead:'親指の届くところに。',description:'右下のボタンから扇状にメニューを展開。Windyの端に寄せる操作を、片手で選べる形へ再構成。',shape:'fan'},
];

// Fictional journal entries. Coordinates describe public landmarks, not the user's history.
export const initialRecords=[
 ['01','2026-05-16','09:20','砂丘の朝','鳥取','散歩','朝の光が砂の模様をはっきり見せてくれた。',35.5408,134.2288,0,true],
 ['02','2026-05-16','12:15','港の食堂','鳥取','食事','窓から港を見ながら昼ごはん。',35.541,134.18,1200,true],
 ['03','2026-05-16','15:40','海辺の休憩','岩美','休憩','少し遠回りして海沿いの道へ。',35.591,134.309,480,false],
 ['04','2026-05-17','08:30','浦富を歩く','岩美','散歩','風が穏やかで、水の色がよく見えた。',35.59,134.325,0,true],
 ['05','2026-05-17','12:00','浜坂で昼ごはん','浜坂','食事','気になっていたお店で日替わり定食。',35.622,134.45,1350,true],
 ['06','2026-05-17','16:10','海を眺める時間','浜坂','休憩','今日はここまで。海岸で少し休んだ。',35.63,134.444,300,false],
 ['07','2026-05-18','09:45','温泉街の朝','湯村','散歩','湯けむりを見ながら町を一周。',35.557,134.487,0,true],
 ['08','2026-05-18','13:00','山あいの喫茶店','湯村','休憩','コーヒーを飲みながら午後の予定を考える。',35.548,134.49,650,false],
 ['09','2026-05-18','17:20','海岸の夕景','香住','散歩','雲の切れ間から夕日が見えた。',35.645,134.628,0,true],
 ['10','2026-05-19','10:00','香住の町歩き','香住','散歩','小さな路地を気ままに歩く。',35.635,134.623,0,true],
 ['11','2026-05-19','12:30','旅の最後の昼食','城崎','食事','この旅でいちばんゆっくりした昼休み。',35.626,134.808,1600,true],
 ['12','2026-05-19','15:00','川沿いでひと休み','城崎','休憩','次はもう少し長く滞在したい。',35.625,134.813,520,false],
].map(([id,date,time,title,area,category,memo,lat,lng,amount,published])=>({id,date,time,title,area,category,memo,lat,lng,amount,published}));
