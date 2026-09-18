const $=s=>document.querySelector(s);
const initial=()=>({category:'',place:'',date:'2026-09-09T16:30',trip:'日常・未設定',memo:'',rating:'',amount:'',expense:'食費'});
const states={a:{step:0,data:initial()},b:{step:0,data:initial()}};
const groups={a:[['category','place','date','trip'],['memo','rating'],['amount','expense']],b:[['category'],['place'],['date'],['trip'],['memo'],['rating'],['amount'],['expense']]};
const titles={a:['何を・どこで？','ひとこと残す','支出を記録'],b:['何をした？','どこで？','いつ？','どの旅？','ひとこと残す','どうだった？','いくら使った？','支出の分類']};
const labels={category:'行動',place:'場所',date:'日時',trip:'旅',memo:'メモ',rating:'評価',amount:'支出額（円）',expense:'支出の分類'};
let mode=new URLSearchParams(location.search).get('mode')==='b'?'b':'a';
function node(tag,props={}){return Object.assign(document.createElement(tag),props)}
function field(key){
 const data=states[mode].data,label=node('label');label.append(node('span',{textContent:labels[key]+(['place','memo','rating','amount'].includes(key)?'（任意）':'')}));let input;
 if(['category','trip','expense'].includes(key)){
  input=node('select');const choices={category:['選んでください','食事','移動','観光','宿泊','その他'],trip:['日常・未設定','山陰の旅','四国・九州の旅'],expense:['食費','交通費','宿泊費','買い物','その他']}[key];
  choices.forEach((v,i)=>input.add(new Option(v,key==='category'&&i===0?'':v)));
 }else if(key==='rating'){
  const row=node('div',{className:'rating'});row.setAttribute('role','group');row.setAttribute('aria-label','評価');
  for(let i=1;i<=5;i++){const b=node('button',{type:'button',textContent:String(i)});b.setAttribute('aria-label',i+'点');b.setAttribute('aria-pressed',String(data.rating===String(i)));b.onclick=()=>{data.rating=data.rating===String(i)?'':String(i);row.querySelectorAll('button').forEach((v,j)=>v.setAttribute('aria-pressed',String(data.rating===String(j+1))));};row.append(b);}label.append(row);return label;
 }else input=key==='memo'?node('textarea'):node('input',{type:key==='date'?'datetime-local':key==='amount'?'number':'text'});
 input.name=key;input.value=data[key];input.oninput=()=>{data[key]=input.value;};
 if(key==='category'||key==='date')input.required=true;
 if(key==='amount'){input.min='0';input.step='1';input.inputMode='numeric';input.placeholder='例：850';}
 if(key==='memo'){input.placeholder='食べたもの、立ち寄った場所など';input.maxLength=4000;}
 if(key==='place'){
  input.placeholder='例：道の駅 浜坂の郷';input.maxLength=200;
  const row=node('div',{className:'inline'}),locate=node('button',{type:'button',textContent:'現在地'});
  locate.onclick=()=>{data.place='現在地（サンプル地点）';input.value=data.place;locate.textContent='取得済み';};row.append(input,locate);label.append(row);
 }else label.append(input);
 return label;
}
function render(){
 const s=states[mode],keys=groups[mode][s.step];document.body.dataset.mode=mode;
 $('#form').hidden=false;$('#done').hidden=true;$('#error').textContent='';
 document.querySelectorAll('.variants button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
 $('#counter').textContent=`${s.step+1} / ${groups[mode].length}`;$('#title').textContent=titles[mode][s.step];$('#progress').style.width=((s.step+1)/groups[mode].length*100)+'%';
 $('#fields').replaceChildren();
 if(mode==='a'&&s.step===0){$('#fields').append(field('category'),field('place'));const pair=node('div',{className:'pair'});pair.append(field('date'),field('trip'));$('#fields').append(pair);}else keys.forEach(k=>$('#fields').append(field(k)));
 $('#back').disabled=s.step===0;
 $('#skip').hidden=!(mode==='a'?s.step===1:keys.some(k=>['place','memo','rating','amount'].includes(k)));
 $('#next').textContent=s.step===groups[mode].length-1?'記録する':mode==='b'&&keys[0]==='amount'&&!s.data.amount?'支出なしで記録':'次へ →';
 $('#caption').textContent=mode==='a'?'関連する項目をまとめて、3画面で完了。':'一度に1項目。入力に集中して進めます。';
 if(keys.includes('amount'))$('#fields').append(node('p',{className:'hint',textContent:'支出がなければ空欄のまま記録できます。'}));
 if(mode==='b'&&keys[0]==='amount')$('#fields input').addEventListener('input',()=>{$('#next').textContent=s.data.amount===''?'支出なしで記録':'次へ →';});
}
function save(){
 const d=states[mode].data;$('#form').hidden=true;$('#done').hidden=false;$('#counter').textContent='完了';$('#title').textContent='おつかれさまでした';$('#progress').style.width='100%';$('#result').replaceChildren();
 for(const [label,value] of [['行動・場所',[d.category,d.place].filter(Boolean).join(' · ')],['日時・旅',d.date.replace('T',' ')+' · '+d.trip],['メモ',d.memo],['評価',d.rating?d.rating+' / 5':''],['支出',d.amount===''?'なし':Number(d.amount).toLocaleString('ja-JP')+'円 · '+d.expense]])if(value)$('#result').append(node('dt',{textContent:label}),node('dd',{textContent:value}));
}
$('#form').onsubmit=e=>{e.preventDefault();if(!$('#form').reportValidity())return;const s=states[mode];if(s.step===groups[mode].length-1||(mode==='b'&&groups.b[s.step][0]==='amount'&&s.data.amount===''))save();else{s.step++;render();}};
$('#back').onclick=()=>{states[mode].step--;render();};
$('#skip').onclick=()=>{const s=states[mode];if(mode==='b'&&groups.b[s.step][0]==='amount'){s.data.amount='';save();return;}for(const key of groups[mode][s.step])s.data[key]='';s.step++;render();};
function reset(){states[mode]={step:0,data:initial()};render();}
$('#reset').onclick=reset;$('#again').onclick=reset;
document.querySelectorAll('.variants button').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;history.replaceState(null,'','?mode='+mode);render();});
render();
