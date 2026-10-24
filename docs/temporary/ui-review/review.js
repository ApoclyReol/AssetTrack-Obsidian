/* Independent UI review. All transactions, writes and failures below are simulated. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => Number(n).toFixed(2);
  const scenes = [
    ['分类与依赖', 'categories', '分类表与操作空间', 'C-05', '先看操作列；可点击属性、迁移和更多菜单。'],
    ['分类与依赖', 'category-attributes', '编辑分类属性', 'C-05', '分类属性与历史迁移拆开；修改进入分类草稿。'],
    ['分类与依赖', 'category-migrate', '迁移历史流水', 'C-05', '迁移独立处理，原分类继续保留。'],
    ['分类与依赖', 'category-delete', '转移并删除分类', 'C-05', '有引用时，在同一流程中转移流水与规则。'],
    ['分类与依赖', 'attribute-edit', '编辑属性值', 'C-06', '普通编辑与移除动作分层。'],
    ['分类与依赖', 'attribute-remove', '移除属性值', 'C-06', '允许清除，或转到同一属性名称下的其他值。'],
    ['分类与依赖', 'attribute-group', '移除属性名称', 'C-06', '清理所属值与关联，不跨属性名称转移。'],
    ['分类与依赖', 'tag-definition', '移除标签定义', 'C-06', '清除或转移标签，流水本身保留。'],
    ['流水处理', 'merge', '合并此组', 'T-02', '只展示合并后的精简结果，不展示原始逐笔明细。'],
    ['流水处理', 'bulk-product', '批量修改商品', 'T-03', '目标值与精简预览在同窗更新。'],
    ['流水处理', 'bulk-counterparty', '批量修改交易对手', 'T-03', '明确修改范围；空值清空有即时提示。'],
    ['流水处理', 'bulk-category', '批量修改分类', 'T-03', '预览原分类与目标分类。'],
    ['流水处理', 'tag-add', '添加标签', 'T-04', '复选框多选，补充标签，不替换已有标签。'],
    ['流水处理', 'tag-remove', '移除标签', 'T-04', '只移除勾选标签，其余标签保留。'],
    ['流水处理', 'operation', '操作与 AI 预览', 'T-06', '保护范围同窗切换；全部变化按需展开。'],
    ['流水处理', 'undo', '直接应用与撤回', 'T-08 / 09', '点击应用规则、删除、合并，再用撤回还原草稿。'],
    ['规则与历史', 'amount', '编辑金额条件', 'C-01', '紧凑表单，金额端点清晰。'],
    ['规则与历史', 'rewrite', '编辑重写设置', 'C-02', '三项设置，无长段解释。'],
    ['规则与历史', 'rule-create', '创建匹配规则', 'C-01', '完整表单分区，保存不会重写历史流水。'],
    ['规则与历史', 'rule-delete', '删除匹配规则', 'C-04', '轻量确认，明确历史流水保留。'],
    ['规则与历史', 'history', '历史商品处理', 'C-07', '名称、分类、规则分任务，提交后保留窗口。'],
    ['只读与数据', 'analysis', '分析相关流水', 'A-01', '保留只读 Modal。'],
    ['只读与数据', 'source', '原始账单行', 'A-01', '只读内容可点击外部直接关闭。'],
    ['只读与数据', 'import', '导入账单', 'G-01', '配置与预览同一窗口，修改后有关闭保护。'],
    ['只读与数据', 'upgrade', '升级现有账本', 'S-01', '普通确认：数据摘要与备份说明。'],
    ['只读与数据', 'legacy-clear', '清除旧属性并升级', 'S-02', '一次清晰确认，显式选择清除。'],
    ['只读与数据', 'restore', '恢复账本备份', 'G-04', '危险确认与普通升级的视觉区分。'],
    ['状态与反馈', 'hover', '问号与快速说明', 'T-01 / A-02', '悬停显示与离开隐藏均为 0.2 秒；按钮尺寸不变。'],
    ['状态与反馈', 'feedback', '提示与失败反馈', 'F-01～08', '成功短提示，错误就近保留，复杂操作留摘要。'],
    ['状态与反馈', 'discard', '未保存关闭保护', 'G-01', '修改后点外部不关，主动关闭询问放弃。']
  ];
  const baseRows = [
    {date:'2026-09-29',product:'饮用水',merchant:'杭州企鹅科技有限公司',category:'餐饮基础',amount:1.12,tags:[]},
    {date:'2026-09-16',product:'饮用水',merchant:'杭州企鹅科技有限公司',category:'餐饮基础',amount:.33,tags:[]},
    {date:'2026-09-12',product:'饮用水',merchant:'杭州企鹅科技有限公司',category:'餐饮基础',amount:.30,tags:['日常']},
    {date:'2026-09-04',product:'饮用水',merchant:'杭州企鹅科技有限公司',category:'餐饮基础',amount:.29,tags:['日常']}
  ];
  const initialCategories = [
    {name:'餐饮基础',description:'日常用餐、饮水与基础食品',type:'支出',color:'#7b60c6',attrs:['必要','日常'],count:125,rules:3},
    {name:'餐饮改善',description:'聚餐、咖啡及非必要餐饮',type:'支出',color:'#c58b62',attrs:['可控','偶尔'],count:48,rules:2},
    {name:'交通通勤',description:'通勤、公共交通和短途出行',type:'支出',color:'#4f9b90',attrs:['必要','日常'],count:36,rules:1},
    {name:'文化娱乐',description:'书籍、展览和内容订阅',type:'支出',color:'#7095c7',attrs:['可控','偶尔'],count:24,rules:2},
    {name:'工资收入',description:'固定薪酬与工作奖金',type:'收入',color:'#ba6e83',attrs:[],count:9,rules:1}
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  let reviews;
  try { reviews = JSON.parse(localStorage.getItem('assettrack-ui-review-01') || '{}'); } catch { reviews = {}; }
  const state = {scene:'categories',open:false,dirty:false,busy:false,error:false,long:false,size:'wide',values:{},menu:null,tab:'name',step:1,all:false,rows:clone(baseRows),categories:clone(initialCategories),undo:[],selectedCategory:0,dirtyDraft:false,discard:false,pending:null};
  let toastTimer, showTipTimer, hideTipTimer, operationTimer;
  const ctx = () => state.long ? '餐饮基础 · 城市生活与日常饮食采购' : (state.categories[state.selectedCategory]?.name || '餐饮基础');
  const productName = () => state.long ? '饮用水 · 平台自动售货机日常消费' : '饮用水';
  const tags = list => list.length ? list.map(v => `<span class="chip purple">${escape(v)}</span>`).join('') : '<span class="muted">—</span>';
  const opts = (values, selected = '') => values.map(v => `<option ${selected === v ? 'selected' : ''} value="${escape(v)}">${escape(v || '请选择')}</option>`).join('');
  const select = (label, key, values, selected = state.values[key] || '') => `<label class="field"><span>${label}</span><select data-field="${key}">${opts(values, selected)}</select></label>`;
  const input = (label, key, value = state.values[key] ?? '', placeholder='') => `<label class="field"><span>${label}</span><input data-field="${key}" value="${escape(value)}" placeholder="${escape(placeholder)}"></label>`;
  const checks = (key, choices, picked = []) => `<div class="check-grid">${choices.map(v => `<label class="choice-row"><input type="checkbox" data-field="${key}" value="${escape(v)}" ${picked.includes(v) ? 'checked' : ''}>${escape(v)}</label>`).join('')}</div>`;
  const radios = (key, choices, current) => choices.map(([v,label]) => `<label class="choice-row"><input type="radio" name="${key}" data-field="${key}" value="${v}" ${current === v ? 'checked' : ''}>${label}</label>`).join('');
  const metrics = entries => `<div class="metrics">${entries.map(([n,label]) => `<div class="metric"><strong>${n}</strong><span>${label}</span></div>`).join('')}</div>`;
  const table = (headers, rows, extra='') => `<div class="table-wrap ${extra}"><table class="mini-table"><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const caption = (text, badge='') => `<div class="compact-caption"><span class="muted">${escape(text)}</span>${badge ? `<span class="chip purple">${badge}</span>` : ''}</div>`;
  const targetChoices = ['', '餐饮改善', '交通通勤', '文化娱乐'];
  function nav() {
    let group = '', html = '';
    scenes.forEach(([g,id,label]) => {
      if(g !== group) { if(group) html += '</div>'; html += `<div class="nav-group"><h2>${g}</h2>`; group = g; }
      const review = reviews[id];
      html += `<button class="scene-link ${state.scene === id ? 'active' : ''}" data-scene="${id}"><span>${label}</span><span class="review-dot ${review?.status || ''}">${review?.status === 'pass' ? '✓' : review?.status === 'change' ? '•' : ''}</span></button>`;
    });
    $('#scene-nav').innerHTML = html + '</div>';
    $('#review-count').textContent = `${Object.values(reviews).filter(r => r.status).length} / ${scenes.length}`;
  }
  function persistReview() {
    try { localStorage.setItem('assettrack-ui-review-01', JSON.stringify(reviews)); } catch { /* File-origin storage may be disabled. */ }
    nav();
  }
  function reviewControls() {
    const r = reviews[state.scene] || {};
    $('#review-note').value = r.note || '';
    $('#approve-scene').classList.toggle('selected', r.status === 'pass');
    $('#revise-scene').classList.toggle('selected', r.status === 'change');
    $('#decision-state').textContent = r.status === 'pass' ? '已标记通过' : r.status === 'change' ? '待调整' : '';
  }
  function toast(text) {
    const el = $('#toast'); el.textContent = text; el.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove('visible'),2800);
  }
  function categoryTable() {
    return `<div class="section-title"><h2>分类定义</h2><span class="save-status ${state.dirtyDraft ? 'dirty' : ''}">${state.dirtyDraft ? '有未保存修改' : '已保存'}</span></div>
      <div class="table-wrap"><table class="category-table"><colgroup>${'<col>'.repeat(6)}</colgroup><thead><tr>${['名称','定义说明','收支','颜色','属性','操作'].map((h,i)=>`<th><button class="head-sort ${i===0?'sorted':''}" ${i<4?'data-action="sort"':''}>${h}${i===0?' ↑':''}</button></th>`).join('')}</tr></thead><tbody>${state.categories.map((c,i)=>`<tr><td><textarea aria-label="${escape(c.name)}名称" data-category-name="${i}" rows="${state.long?3:2}">${escape(state.long ? c.name + (i===0?' · 城市生活与日常饮食采购':'与相关日常消费') : c.name)}</textarea></td><td><textarea aria-label="${escape(c.name)}定义说明" rows="${state.long?4:2}" data-draft>${escape(state.long ? c.description+'，包含平台账单中需要进一步区分的相关项目。' : c.description)}</textarea></td><td>${c.type}</td><td class="color-cell"><input type="color" value="${c.color}" aria-label="${escape(c.name)}颜色" data-draft></td><td><div class="chips">${tags(state.long && c.attrs.length ? [...c.attrs,'长期观察项目'] : c.attrs)}</div></td><td><div class="row-actions"><button data-action="category-attributes" data-index="${i}"><span class="full-label">编辑属性</span><span class="short-label">属性</span></button><button data-action="category-migrate" data-index="${i}"><span class="full-label">迁移流水</span><span class="short-label">迁移</span></button><button class="more" aria-label="${escape(c.name)}更多操作" data-action="more" data-index="${i}">···</button>${state.menu===i?`<div class="more-menu"><button class="danger-text" data-action="category-delete" data-index="${i}">删除此分类</button></div>`:''}</div></td></tr>`).join('')}</tbody></table></div>
      <div class="category-footer"><button data-action="new-category">＋ 新增分类</button><button class="primary" data-action="save-draft">保存分类</button></div>
      <div class="layout-spec"><strong>审查参考 · 列宽分配</strong><span>常规：名称 18% / 说明 21% / 收支 7% / 颜色 5% / 属性 25% / 操作 24%</span><span>窄窗口保留按钮高度，使用“属性 / 迁移”；更窄时操作列增至 32%。</span></div>`;
  }
  function transactionTable() {
    const total = state.rows.reduce((n,r)=>n+r.amount,0);
    return `<div class="section-title"><h2>本月流水</h2><span class="chip">2026-09</span><span class="save-status ${state.dirtyDraft?'dirty':''}">${state.dirtyDraft?'有未保存修改':'已保存'}</span></div>
    <div class="transaction-summary"><div><small>净支出</small><div class="summary-value amount-out">¥${money(total)}</div></div><div><small>对账差额<span class="reconcile-help" data-tooltip="实际净支出 − 理论消费。当前差额在容差以内，显示为平账。">?</span></small><div style="margin-top:4px;font-size:17px">平账 <small>¥0.00</small></div></div></div>
    <div class="transaction-tools"><button data-action="import">导入账单</button><button data-action="apply-rules">应用规则</button><button data-action="undo-action" ${state.undo.length?'':'disabled'}>↶ 撤回${state.undo.length?` (${state.undo.length})`:''}</button><button data-action="tag-add">添加标签</button><button data-action="tag-remove">移除标签</button><button class="primary right" data-action="save-draft">保存流水</button></div>
    <div class="summary-card"><div><strong>${escape(productName())}</strong><small>${state.rows.length} 笔 · 餐饮基础</small></div><div class="row-actions"><span class="amount-out">−¥${money(total)}</span><button data-action="merge">合并此组</button></div></div>
    ${table(['日期','商品','标签','分类','金额','操作'],state.rows.map((r,i)=>[r.date,escape(r.product),`<div class="chips">${tags(r.tags)}</div>`,escape(r.category),`<span class="amount-out">${money(r.amount)}</span>`,`<button data-action="delete-row" data-index="${i}">删除</button>`]))}`;
  }
  function ruleTable() {
    return `<div class="section-title"><h2>匹配规则</h2><span class="save-status">已保存</span><button class="right" data-action="rule-create">＋ 新增规则</button></div>${table(['编号','匹配范围','金额条件','分类','重写','操作'],[['#22','饮用水','低于 2.00','餐饮基础','留空保留','<button data-action="amount">金额</button>'],['#23','杭州企鹅科技有限公司','2.00～50.00','餐饮改善','留空保留','<button data-action="rewrite">重写</button>'],['#24','内容订阅','不限金额','文化娱乐','留空保留','<button data-action="rule-delete">删除</button>']])}<div class="category-footer"><button class="primary" data-action="save-draft">保存规则</button></div>`;
  }
  function feedbackPage() {
    return `<div class="section-title"><h2>结果与状态</h2><span class="chip">2026-09</span></div><div class="status-demo">
      <div class="feedback-card"><h3>保存完成</h3><p>短提示；页面保留保存状态。</p><button data-action="feedback-success">保存流水</button></div>
      <div class="feedback-card"><h3>操作进入草稿</h3><p>短提示；未保存状态保留。</p><button data-action="feedback-draft">应用批量修改</button></div>
      <div class="feedback-card"><h3>内容加载失败</h3><div id="load-feedback" class="notice-inline error">标签未能载入<button class="text-btn" data-action="retry-load">重试</button></div></div>
      <div class="feedback-card"><h3>保存失败</h3><div id="save-feedback" class="notice-inline error">未保存，当前修改已保留<button class="text-btn" data-action="retry-save">重试</button></div></div>
      <div class="feedback-card"><h3>导入结果</h3><div class="notice-inline">已加入草稿 124 笔 · 排除 3 笔</div><button data-action="import">查看导入预览</button></div>
      <div class="feedback-card"><h3>功能尚不可用</h3><div class="disabled-help"><button disabled>应用规则</button><span class="help-dot" data-tooltip="当前有选中流水，请先取消选择。">?</span></div></div>
    </div>`;
  }
  function product() {
    const group = scenes.find(s=>s[1]===state.scene)?.[0];
    const config = group==='分类与依赖' || group==='规则与历史';
    const analysis = state.scene==='analysis';
    let body;
    if(state.scene==='feedback') body=feedbackPage();
    else if(config && (group==='分类与依赖' || state.scene==='history')) body=categoryTable();
    else if(config) body=ruleTable();
    else if(analysis) body=`<div class="section-title"><h2>月度分析</h2><span class="chip">2026-09</span></div><div class="transaction-summary"><div><small>实际支出</small><div class="summary-value">¥4,620.80</div></div><div><small>对账差额<span class="reconcile-help" data-tooltip="实际净支出 − 理论消费。差额在容差内显示为平账。">?</span></small><div class="summary-value">¥0.00</div></div></div><div class="mini-chart">${[70,120,90,140,110,130].map((h,i)=>`<div class="chart-bar" style="height:${h}px"><span>${i+4}月</span></div>`).join('')}</div>`;
    else body=transactionTable();
    $('#product').innerHTML=`<div class="product-header"><div class="product-brand"><span>◈</span> Asset Track</div><div class="product-nav"><span class="${analysis?'active':''}">分析</span><span class="${!config&&!analysis?'active':''}">记录</span><span class="${config?'active':''}">配置</span><small>个人账本 · 2026</small></div></div><div class="product-body"><div class="subnav">${(config ? ['数据健康','分类定义','分类属性','匹配规则','商品总览'] : analysis ? ['年度','月度'] : ['资产账户','流水','借款','固定资产']).map((n,i)=>`<span class="${i===1?'active':''}">${n}</span>`).join('')}</div>${body}</div>`;
  }
  function defaultValues(id) {
    return {target:'',targetText:id==='bulk-counterparty'?'杭州企鹅科技有限公司':'饮用水',includeTagged:false,includeProtected:false,tagKeys:[],name:'必要',removal:'clear',targetTag:'',amountMode:'区间',min:'2.00',max:'50.00',minInclude:true,maxInclude:false,rewriteMerchant:'',rewriteProduct:'',blank:'保留原值',merchant:'杭州企鹅科技有限公司',ruleProduct:'饮用水',ruleCategory:'餐饮基础',legacy:false,allowGroup:false,historyName:productName(),csvDate:'交易时间',csvAmount:'金额',csvProduct:'商品名称',sourceType:'支出',importMode:'追加到草稿'};
  }
  function previewHTML() {
    const v=state.values, id=state.scene;
    if(id==='merge') {
      const tagged=v.includeTagged;
      return metrics([[tagged?'4':'2','参与合并'],[tagged?'2':'1','合并结果'],[tagged?'0':'2','保留明细']])+table(['商品','分类','标签','合计'],[[escape(productName()),'餐饮基础','—','¥1.45'],...(tagged?[[escape(productName()),'餐饮基础','<span class="chip purple">日常</span>','¥0.59']]:[])]);
    }
    if(id.startsWith('bulk-')) {
      const field=id==='bulk-product'?'商品':id==='bulk-counterparty'?'交易对手':'分类';
      const before=id==='bulk-product'?['饮用水','矿泉水']:id==='bulk-counterparty'?['杭州企鹅科技','杭州企鹅科技有限公司']:['餐饮基础','餐饮改善'];
      const target=id==='bulk-category'?v.target:v.targetText;
      return `<div class="preview-header"><strong>修改预览</strong><small>共 12 笔</small></div>${table([`原${field}`,`修改为`,'笔数'],before.map((b,i)=>[escape(b),target?escape(target):'<span class="danger-text">清空</span>',i?'4':'8']))}${!target?'<div class="danger-note">目标留空，将清空这 12 笔的'+field+'。</div>':''}`;
    }
    if(id==='tag-add'||id==='tag-remove') {
      const add=id==='tag-add', names=v.tagKeys||[];
      return `<div class="preview-header"><strong>标签变化</strong><small>${names.length?'12':'0'} 笔将变更</small></div>${table(['已有标签',add?'添加后':'移除后'],[['<div class="chips">'+tags(['日常','工作'])+'</div>','<div class="chips">'+tags(add?[...new Set(['日常','工作',...names])]:['日常','工作'].filter(t=>!names.includes(t)))+'</div>'],['—','<div class="chips">'+tags(add?names:[])+'</div>']])}`;
    }
    if(id==='operation') {
      const n=v.includeProtected?12:10;
      return metrics([[n,'将修改'],[v.includeProtected?0:2,'保护保留'],[1,'需处理']])+table(['商品','当前分类','建议分类','结果'],[['饮用水','未分类','餐饮基础','<span class="chip green">将修改</span>'],['咖啡','未分类','餐饮改善','<span class="chip green">将修改</span>'],['内容订阅','文化娱乐','—','<span class="chip red">需确认</span>'],...(state.all?Array.from({length:9},(_,i)=>['日常消费 '+(i+4),'未分类',i%2?'餐饮基础':'文化娱乐','<span class="chip green">将修改</span>']):[])])+`<button class="text-btn block" data-action="toggle-all">${state.all?'收起':'查看全部 13 条结果'}</button>`;
    }
    if(id==='category-migrate') return `<div class="preview-header"><strong>迁移预览</strong><small>125 笔 · 8 个月</small></div>${table(['原分类','目标分类','处理范围'],[[escape(ctx()),escape(v.target||'请选择目标'),'全部历史流水']])}`;
    return '';
  }
  function spec() {
    const id=state.scene,v=state.values;
    const scope=caption('2026-09 · 已选 12 笔','流水草稿');
    if(id==='category-attributes'||id==='discard') return {title:'编辑分类属性',context:ctx(),size:'small',primary:'应用到分类草稿',cancel:'取消修改',hint:'分类草稿',body:`<h3>必要性</h3>${radios('necessity',[['necessary','必要'],['controllable','可控'],['unset','未设置']],v.necessity||'necessary')}<h3 class="block">消费频率</h3>${radios('frequency',[['daily','日常'],['occasional','偶尔'],['unset','未设置']],v.frequency||'daily')}`};
    if(id==='category-migrate') return {title:'迁移历史流水',context:ctx(),primary:'迁移并保存',cancel:'取消迁移',requires:'target',hint:'立即保存',body:`<div class="scope-list"><span><b>125</b> 笔流水</span><span><b>8</b> 个月份</span><span>保留原分类</span></div>${select('迁移到','target',targetChoices)}<div class="preview-box" data-preview>${previewHTML()}</div>`};
    if(id==='category-delete') return {title:'删除分类',context:ctx(),size:'small',primary:'转移并删除',cancel:'取消删除',danger:true,requires:'target',hint:'立即保存',body:`<div class="scope-list"><span><b>125</b> 笔流水</span><span><b>3</b> 条规则</span></div>${select('流水与规则一并转移到','target',targetChoices)}<div class="danger-note">删除原分类，保留流水和规则。</div>`};
    if(id==='attribute-edit') return {title:'编辑属性值',context:'必要性',size:'small',primary:'应用到属性草稿',cancel:'取消修改',hint:'属性草稿',body:input('属性值名称','name')+`<div class="block"><button class="danger-text" data-action="attribute-remove">移除此属性值</button></div>`};
    if(id==='attribute-remove') return {title:'移除属性值',context:'必要性 / 必要',size:'small',primary:v.removal==='transfer'?'转移并移除':'清除并移除',cancel:'取消移除',danger:true,hint:'属性草稿',requires:v.removal==='transfer'?'target':'',body:`${caption('关联 8 个分类')}<h3>现有分类如何处理</h3>${radios('removal',[['clear','清除“必要”属性'],['transfer','转为其他必要性属性']],v.removal)}<div data-removal-target class="block">${v.removal==='transfer'?select('转移到','target',['','可控']):''}</div>`};
    if(id==='attribute-group') return {title:'移除属性名称',context:'必要性',size:'small',primary:'清除并移除',cancel:'取消移除',danger:true,requires:'allowGroup',hint:'属性草稿',body:`<div class="scope-list"><span><b>3</b> 个属性值</span><span><b>12</b> 个分类关联</span></div><div class="soft-panel">必要 · 可控 · 不适用</div><label class="inline-option block"><input type="checkbox" data-field="allowGroup" ${v.allowGroup?'checked':''}>同时移除以上属性值及分类关联</label><div class="danger-note">分类与流水保留，其他属性不变。</div>`};
    if(id==='tag-definition') return {title:'移除标签',context:'工作',size:'small',primary:v.removal==='transfer'?'转移并移除':'清除并移除',cancel:'取消移除',danger:true,hint:'标签草稿',requires:v.removal==='transfer'?'targetTag':'',body:`${caption('关联 32 笔流水')}<h3>现有标签如何处理</h3>${radios('removal',[['clear','从流水中清除“工作”'],['transfer','转移到其他标签']],v.removal)}<div data-removal-target class="block">${v.removal==='transfer'?select('转移到','targetTag',['','日常','家庭','旅行']):''}</div>`};
    if(id==='merge') return {title:'合并此组',context:`${productName()} · 2026-09`,primary:'合并到流水草稿',cancel:'取消合并',hint:'流水草稿',body:`<div data-preview>${previewHTML()}</div><label class="inline-option block"><input type="checkbox" data-field="includeTagged" ${v.includeTagged?'checked':''}>包含有标签的流水</label><div class="danger-note">保存后替换原记录，不支持拆分。</div>`};
    if(id.startsWith('bulk-')) {const field=id==='bulk-product'?'商品':id==='bulk-counterparty'?'交易对手':'分类';return {title:'修改'+field,context:'2026-09 · 已选 12 笔',primary:'应用到流水草稿',cancel:'取消修改',hint:'流水草稿',requires:id==='bulk-category'?'target':'',body:`${id==='bulk-category'?select('目标分类','target',targetChoices):input('修改为'+field,'targetText',v.targetText,'留空以清空')}<div class="preview-box" data-preview>${previewHTML()}</div>`};}
    if(id==='tag-add'||id==='tag-remove') return {title:id==='tag-add'?'添加标签':'移除标签',context:'2026-09 · 已选 12 笔',primary:id==='tag-add'?'添加到流水草稿':'移除并更新草稿',cancel:id==='tag-add'?'取消添加':'取消移除',hint:'流水草稿',requires:'tagKeys',body:`${checks('tagKeys',['日常','工作','家庭','旅行','健康','待报销'],v.tagKeys)}<div class="preview-box" data-preview>${previewHTML()}</div>`};
    if(id==='operation') return {title:'分类建议预览',context:'2026-09 · 已选 13 笔',primary:'应用到流水草稿',cancel:'取消应用',hint:'流水草稿',size:'wide',body:`<label class="inline-option" style="margin-bottom:16px"><input type="checkbox" data-field="includeProtected" ${v.includeProtected?'checked':''}>包含 2 笔已人工修改的流水</label><div data-preview>${previewHTML()}</div>`};
    if(id==='amount') return {title:'编辑金额条件',context:'规则 #22 · 饮用水',size:'small',primary:'应用到规则草稿',cancel:'取消修改',hint:'规则草稿',body:`${select('匹配金额','amountMode',['不限金额','精确金额','低于','不超过','高于','至少','区间'])}<div class="form-grid block">${input('下限 / 金额（元）','min')}${v.amountMode==='区间'?input('上限（元）','max'):''}</div>${v.amountMode==='区间'?`<div class="form-grid block"><label class="inline-option"><input type="checkbox" data-field="minInclude" ${v.minInclude?'checked':''}>包含下限</label><label class="inline-option"><input type="checkbox" data-field="maxInclude" ${v.maxInclude?'checked':''}>包含上限</label></div>`:''}<div class="notice-inline" data-amount-preview>2.00 ≤ 金额 &lt; 50.00</div>`};
    if(id==='rewrite') return {title:'编辑重写设置',context:'规则 #22',size:'small',primary:'应用到规则草稿',cancel:'取消修改',hint:'规则草稿',body:`<div class="form-grid"><div class="full">${input('重写交易对手','rewriteMerchant',v.rewriteMerchant,'保留原交易对手')}</div><div class="full">${input('重写商品','rewriteProduct',v.rewriteProduct,'保留原商品')}</div><div class="full">${select('留空时','blank',['保留原值','清空原值'])}</div></div><div data-blank-warning></div>`};
    if(id==='rule-create') return {title:'创建匹配规则',context:'规则保存后可在流水页应用',primary:'保存规则',cancel:'取消创建',hint:'立即保存',body:`<div class="form-grid">${select('收支','sourceType',['支出','收入','代付'])}${select('目标分类','ruleCategory',['餐饮基础','餐饮改善','文化娱乐'])}${input('交易对手条件','merchant')}${input('商品条件','ruleProduct')}</div><div class="block">${select('金额条件','amountMode',['不限金额','低于 2.00','2.00～50.00','至少 100.00'],'低于 2.00')}</div><div class="block"><h3>重写信息</h3><div class="form-grid">${input('交易对手','rewriteMerchant')}${input('商品','rewriteProduct')}</div><div class="block">${select('留空时','blank',['保留原值','清空原值'])}</div></div>`};
    if(id==='rule-delete') return {title:'删除规则 #22？',context:'饮用水 · 低于 2.00',size:'small',primary:'从规则草稿移除',cancel:'保留规则',danger:true,hint:'规则草稿',body:`<div class="soft-panel">已保存的流水不受影响。</div>`};
    if(id==='history') {
      const tab=state.tab;
      const body=tab==='name'?input('修改为商品名称','historyName',v.historyName)+`<div class="preview-box">${table(['当前商品','修改为','笔数'],[[escape(productName()),escape(v.historyName),'125']])}</div>`:tab==='category'?select('目标分类','target',targetChoices)+`<div class="preview-box">${table(['当前分类','笔数'],[['餐饮基础','108'],['餐饮改善','17']])}</div>`:`<div class="form-grid">${input('商品条件','ruleProduct')}${select('目标分类','ruleCategory',['餐饮基础','餐饮改善'])}</div><div class="block">${select('金额条件','amountMode',['不限金额','低于 2.00','区间'],'不限金额')}</div>`;
      return {title:'处理历史商品',context:`${productName()} · 125 笔 · 8 个月`,primary:tab==='name'?'保存商品名称':tab==='category'?'迁移并保存':'保存规则',cancel:'关闭窗口',hint:'立即保存',requires:tab==='category'?'target':'',body:`<div class="tabs">${[['name','商品名称'],['category','历史分类'],['rule','匹配规则']].map(([k,l])=>`<button class="${tab===k?'active':''}" data-action="history-tab" data-tab="${k}">${l}</button>`).join('')}</div>${body}`};
    }
    if(id==='analysis'||id==='source') return {title:id==='source'?'原始账单行':'餐饮基础 · 相关流水',context:id==='source'?'账单.csv · 原始第 39 行':'2026-09 · 4 笔',readonly:true,size:id==='source'?'wide':'standard',cancel:'关闭明细',body:id==='source'?table(['交易时间','交易对方','商品名称','收支','金额'],[['2026-09-16 10:42:18','杭州企鹅科技有限公司','饮用水','支出','0.33']]):table(['日期','商品','交易对手','金额'],baseRows.map(r=>[r.date,escape(state.long?productName():r.product),escape(state.long?r.merchant+'城西科技园自动售货机服务中心':r.merchant),money(r.amount)]))};
    if(id==='import') return {title:'导入账单',context:'2026-09.csv · 127 行',size:'wide',primary:state.step===1?'生成预览':'导入到流水草稿',cancel:'取消导入',hint:state.step===1?'字段映射':'流水草稿',body:`<div class="stepper"><span class="${state.step===1?'current':''}"><i>1</i>字段映射</span><span class="${state.step===2?'current':''}"><i>2</i>检查与导入</span></div>${state.step===1?`<div class="form-grid">${select('日期','csvDate',['交易时间','记账日期'])}${select('金额','csvAmount',['金额','实付金额'])}${select('商品','csvProduct',['商品名称','商品说明'])}${select('收支','sourceType',['支出','收入'])}</div><div class="block">${select('导入方式','importMode',['追加到草稿','覆盖当前流水草稿'])}</div>`:`${metrics([[124,'接受'],[2,'状态排除'],[1,'无效']])}${table(['日期','商品','类型','金额'],[['2026-09-29','饮用水','支出','1.12'],['2026-09-28','公共交通','支出','2.00'],['2026-09-27','内容订阅','支出','19.90']])}<div class="notice-inline">${v.importMode==='覆盖当前流水草稿'?'将替换当前流水草稿。':'追加导入，不自动去重。'}</div>`}`};
    if(id==='upgrade'||id==='legacy-clear') return {title:id==='upgrade'?'升级现有账本':'清除旧属性并升级',context:'个人账本',size:'small',primary:'备份并升级',cancel:'稍后',requires:id==='legacy-clear'?'legacy':'',hint:'先备份',body:`${metrics([[18,'分类'],['2,486','流水']])}<div class="soft-panel">${id==='upgrade'?'保留流水、规则、属性和标签。':'保留流水、规则和分类。'}</div>${id==='legacy-clear'?`<label class="inline-option block"><input type="checkbox" data-field="legacy" ${v.legacy?'checked':''}>清除旧必要性、频率和大额属性</label>`:''}<div class="notice-inline">升级前自动创建本地保护备份。</div>`};
    if(id==='restore') return {title:'恢复此备份？',context:'asset-track-backup-2026-09-30.zip',size:'small',primary:'备份当前账本并恢复',cancel:'取消恢复',danger:true,hint:'立即保存',body:`${metrics([[18,'分类'],['2,450','流水']])}<div class="soft-panel"><span class="chip green">校验通过</span>　2026-09-30 21:08</div><div class="danger-note">将替换当前账本，恢复前保留保护备份。</div>`};
    return null;
  }
  function canSubmit(s) {
    if(!s?.requires) return true;
    const v=state.values[s.requires];return Array.isArray(v)?v.length>0:Boolean(v);
  }
  function renderModal() {
    const host=$('#modal-host');
    if(!state.open){host.innerHTML='';return;}
    const s=spec(); if(!s){host.innerHTML='';return;}
    const fieldsDisabled=state.busy&&!s.readonly;
    const body=state.busy&&s.readonly?'<div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div>':s.body;
    host.innerHTML=`<div class="modal-overlay"><section class="modal ${s.size==='small'?'small':s.size==='wide'?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><header class="modal-header"><div><h2 id="dialog-title">${s.title}</h2><div class="context-line">${escape(s.context||'')}</div></div><button class="close" data-action="close-modal" aria-label="关闭窗口" ${fieldsDisabled?'disabled':''}>×</button></header><div class="modal-body"><fieldset class="form-shell" ${fieldsDisabled?'disabled':''}>${body}</fieldset>${state.error?'<div class="error-box" role="alert">未能完成操作，当前修改已保留。请重试。</div>':''}</div><footer class="modal-footer"><span class="footer-hint">${s.hint||''}${state.dirty?' · 已修改':''}</span><button data-action="close-modal" ${fieldsDisabled?'disabled':''}>${s.cancel||'取消'}</button>${s.primary?`<button id="primary-action" class="${s.danger?'danger':'primary'}" data-action="submit" ${fieldsDisabled||!canSubmit(s)?'disabled':''}>${state.busy?'<span class="busy-icon"></span>正在处理…':s.primary}</button>`:''}</footer></section></div>`;
    if(state.discard) renderDiscard();
  }
  function renderDiscard() {
    $('.discard-layer')?.remove();
    const layer=document.createElement('div');layer.className='discard-layer';layer.innerHTML='<div class="discard-card" role="alertdialog" aria-label="放弃修改"><h3>放弃本次修改？</h3><div class="discard-actions"><button data-action="keep-editing">继续编辑</button><button class="danger" data-action="discard-confirm">放弃修改</button></div></div>';
    $('#modal-host').append(layer);
  }
  function askClose(next) {
    if(state.busy&&!spec()?.readonly){toast('正在处理，请稍候。');return;}
    if(state.open&&state.dirty&&!spec()?.readonly){state.discard=true;state.pending=next||null;renderDiscard();return;}
    state.open=false;state.dirty=false;renderModal();if(next)next();
  }
  function openScene(id, force=false) {
    if(!scenes.some(s=>s[1]===id))id='categories';
    if(!force&&state.open&&state.dirty){askClose(()=>openScene(id,true));return;}
    clearTimeout(operationTimer);hideTip();state.scene=id;state.values=defaultValues(id);state.open=!['categories','undo','hover','feedback'].includes(id);state.dirty=false;state.discard=false;state.pending=null;state.menu=null;state.tab='name';state.step=1;state.all=false;
    state.busy=$('#demo-state').value==='busy';state.error=$('#demo-state').value==='error';
    const item=scenes.find(s=>s[1]===id);$('#review-title').textContent=item[2];$('#scene-code').textContent=item[3];$('#scene-description').textContent=item[4];
    if(location.hash.slice(1)!==id)history.replaceState(null,'','#'+id);
    product();renderModal();nav();reviewControls();
    if(id==='hover')renderHoverExtra();
  }
  function renderHoverExtra(){ $('.transaction-tools').insertAdjacentHTML('beforeend','<span class="disabled-help"><button disabled>应用规则</button><span class="help-dot" data-tooltip="当前有选中流水，请先取消选择。">?</span></span>'); }
  function snapshot(label){state.undo.push({label,rows:clone(state.rows),dirty:state.dirtyDraft});if(state.undo.length>10)state.undo.shift();}
  function complete(s) {
    const id=state.scene,v=state.values;
    if(id==='merge') {
      snapshot('合并');const groups=new Map();state.rows.forEach(r=>{const k=JSON.stringify([r.category,[...r.tags].sort()]);if(r.tags.length&&!v.includeTagged)groups.set(k+Math.random(),[r]);else groups.set(k,[...(groups.get(k)||[]),r]);});
      state.rows=[...groups.values()].map(rows=>rows.length<2?rows[0]:({...rows[0],date:'2026-09-01',amount:Math.round(rows.reduce((a,r)=>a+r.amount,0)*100)/100}));state.dirtyDraft=true;
    } else if(id.startsWith('bulk-')||id==='tag-add'||id==='tag-remove') {
      snapshot('批量修改');state.rows=state.rows.map(r=>{const row=clone(r);if(id==='bulk-product')row.product=v.targetText;if(id==='bulk-counterparty')row.merchant=v.targetText;if(id==='bulk-category')row.category=v.target;if(id==='tag-add')row.tags=[...new Set([...row.tags,...v.tagKeys])];if(id==='tag-remove')row.tags=row.tags.filter(t=>!v.tagKeys.includes(t));return row;});state.dirtyDraft=true;
    } else if(id==='category-delete') {state.categories.splice(state.selectedCategory,1);state.selectedCategory=0;}
    else if(id==='category-attributes'||id==='discard'||id==='attribute-edit'||id==='attribute-remove'||id==='attribute-group'||id==='tag-definition'||id==='amount'||id==='rewrite'||id==='rule-delete')state.dirtyDraft=true;
    if(id==='history') {state.dirty=false;state.busy=false;state.error=false;renderModal();toast('已保存，本窗口可继续处理其他任务。');return;}
    state.open=false;state.dirty=false;state.busy=false;state.error=false;$('#demo-state').value='normal';product();renderModal();
    const draft=/草稿/.test(s.hint||'');toast(draft?'已更新草稿，保存后生效。':id==='category-migrate'?'已迁移 125 笔流水，原分类保留。':id==='category-delete'?'流水与规则已转移，原分类已删除。':id==='upgrade'||id==='legacy-clear'?'保护备份已创建，账本升级完成。':id==='restore'?'当前账本已备份，恢复完成。':'已保存。');
  }
  function submit() {
    const s=spec();if(!s||!canSubmit(s)||state.busy)return;
    if(state.scene==='import'&&state.step===1){state.step=2;state.dirty=true;state.error=false;renderModal();return;}
    if(state.scene==='import') {snapshot('导入');state.rows.push({date:'2026-09-28',product:'公共交通',merchant:'城市公交',category:'交通通勤',amount:2,tags:[]});state.dirtyDraft=true;}
    state.busy=true;state.error=false;renderModal();const scene=state.scene;
    operationTimer=setTimeout(()=>{if(state.scene===scene)complete(s);},850);
  }
  function updatePreview() {
    const el=$('[data-preview]');if(el)el.innerHTML=previewHTML();
    const amount=$('[data-amount-preview]');if(amount){const v=state.values;amount.textContent=v.amountMode==='不限金额'?'不限金额':v.amountMode==='区间'?`${v.min} ${v.minInclude?'≤':'<'} 金额 ${v.maxInclude?'≤':'<'} ${v.max}`:`${v.amountMode} ${v.min}`;}
    const blank=$('[data-blank-warning]');if(blank)blank.innerHTML=state.values.blank==='清空原值'?'<div class="danger-note">留空的重写字段将清空原值。</div>':'';
    const primary=$('#primary-action');if(primary)primary.disabled=state.busy||!canSubmit(spec());
    const hint=$('.modal-footer .footer-hint');if(hint)hint.textContent=(spec()?.hint||'')+(state.dirty?' · 已修改':'');
  }
  function hideTip(){clearTimeout(showTipTimer);clearTimeout(hideTipTimer);$('#tooltip').hidden=true;}
  document.addEventListener('pointerover',e=>{
    const el=e.target.closest('[data-tooltip]');if(!el)return;
    clearTimeout(hideTipTimer);clearTimeout(showTipTimer);
    showTipTimer=setTimeout(()=>{const tip=$('#tooltip'),stage=$('#stage').getBoundingClientRect(),r=el.getBoundingClientRect();tip.textContent=el.dataset.tooltip;tip.hidden=false;const w=tip.offsetWidth;tip.style.left=Math.max(12,Math.min(stage.width-w-12,r.left-stage.left-w/2+r.width/2))+'px';let top=r.bottom-stage.top+8;if(top+tip.offsetHeight>stage.height-12)top=r.top-stage.top-tip.offsetHeight-8;tip.style.top=Math.max(12,top)+'px';},200);
  });
  document.addEventListener('pointerout',e=>{const el=e.target.closest('[data-tooltip]');if(el&&!el.contains(e.relatedTarget)){clearTimeout(showTipTimer);hideTipTimer=setTimeout(()=>$('#tooltip').hidden=true,200);}});
  $('#tooltip').addEventListener('pointerenter',()=>clearTimeout(hideTipTimer));$('#tooltip').addEventListener('pointerleave',()=>{hideTipTimer=setTimeout(()=>$('#tooltip').hidden=true,200);});
  document.addEventListener('input',e=>{
    if(e.target.matches('#review-note')){reviews[state.scene]={...(reviews[state.scene]||{}),note:e.target.value};persistReview();return;}
    const key=e.target.dataset.field;if(!key)return;
    if(e.target.type==='checkbox'){if(key==='tagKeys')state.values[key]=$$('[data-field="tagKeys"]:checked').map(el=>el.value);else state.values[key]=e.target.checked;}
    else if(e.target.type==='radio'){if(e.target.checked)state.values[key]=e.target.value;}
    else state.values[key]=e.target.value;
    state.dirty=true;state.error=false;
    if(key==='removal'||key==='amountMode'&&state.scene==='amount'){renderModal();updatePreview();}else updatePreview();
  });
  document.addEventListener('change',e=>{
    if(e.target.matches('[data-category-name],[data-draft]')){state.dirtyDraft=true;const status=$('.section-title .save-status');if(status){status.classList.add('dirty');status.textContent='有未保存修改';}}
  });
  document.addEventListener('click',e=>{
    const scene=e.target.closest('[data-scene]');if(scene){openScene(scene.dataset.scene);return;}
    if(e.target.classList.contains('modal-overlay')){if(state.busy&&!spec()?.readonly)return;if(!state.dirty||spec()?.readonly)askClose();return;}
    const el=e.target.closest('[data-action]');if(!el||el.disabled)return;
    const a=el.dataset.action;
    if(a==='close-modal'){askClose();return;}
    if(a==='keep-editing'){state.discard=false;state.pending=null;$('.discard-layer')?.remove();return;}
    if(a==='discard-confirm'){const next=state.pending;state.discard=false;state.pending=null;state.dirty=false;state.open=false;renderModal();if(next)next();return;}
    if(a==='submit'){submit();return;}
    if(a==='more'){state.menu=state.menu===Number(el.dataset.index)?null:Number(el.dataset.index);product();return;}
    if(a==='history-tab'){const next=()=>{state.tab=el.dataset.tab;state.dirty=false;state.open=true;renderModal();};if(state.dirty){state.discard=true;state.pending=next;renderDiscard();}else next();return;}
    if(a==='toggle-all'){state.all=!state.all;updatePreview();return;}
    if(a==='apply-rules'){snapshot('应用规则');state.rows=state.rows.map(r=>({...r,category:'餐饮基础',product:'饮用水（规则统一）'}));state.dirtyDraft=true;product();toast('规则已应用到草稿。');return;}
    if(a==='delete-row'){snapshot('删除流水');state.rows.splice(Number(el.dataset.index),1);state.dirtyDraft=true;product();toast('已从草稿删除，可撤回。');return;}
    if(a==='undo-action'){const item=state.undo.pop();if(!item)return;state.rows=item.rows;state.dirtyDraft=item.dirty;product();toast('已撤回：'+item.label);return;}
    if(a==='save-draft'){state.undo=[];state.dirtyDraft=false;product();toast('已保存。');return;}
    if(a==='sort'){toast('此处展示列宽与操作空间，正式排序沿用当前插件。');return;}
    if(a==='new-category'){openScene('category-attributes');return;}
    if(a.startsWith('feedback-')){if(a==='feedback-draft')state.dirtyDraft=true;toast(a==='feedback-success'?'流水已保存。':'已更新草稿，保存后生效。');return;}
    if(a==='retry-load'){el.parentElement.classList.remove('error');el.parentElement.textContent='标签已载入';return;}
    if(a==='retry-save'){el.parentElement.classList.remove('error');el.parentElement.textContent='已保存';toast('流水已保存。');return;}
    if(scenes.some(s=>s[1]===a)) {if(el.dataset.index!==undefined)state.selectedCategory=Number(el.dataset.index);openScene(a);}
  });
  $('#canvas-size').addEventListener('change',e=>{state.size=e.target.value;$('#stage').dataset.size=state.size;hideTip();});
  $('#long-content').addEventListener('change',e=>{state.long=e.target.checked;product();if(state.scene==='hover')renderHoverExtra();renderModal();});
  $('#demo-state').addEventListener('change',e=>{clearTimeout(operationTimer);state.busy=e.target.value==='busy';state.error=e.target.value==='error';renderModal();if(!state.open){const old=$('.demo-page-status');old?.remove();if(state.busy||state.error)$('.product-body').insertAdjacentHTML('afterbegin',`<div class="notice-inline demo-page-status ${state.error?'error':''}">${state.busy?'正在载入…':'未能载入，请重试。'}</div>`);}});
  $('#theme-toggle').addEventListener('click',()=>document.body.classList.toggle('dark'));
  $('#reopen').addEventListener('click',()=>openScene(state.scene));
  $('#approve-scene').addEventListener('click',()=>{reviews[state.scene]={...(reviews[state.scene]||{}),status:'pass'};persistReview();reviewControls();});
  $('#revise-scene').addEventListener('click',()=>{reviews[state.scene]={...(reviews[state.scene]||{}),status:'change'};persistReview();reviewControls();});
  $('#export-review').addEventListener('click',()=>{
    const lines=['# Asset Track 界面审查意见','',...scenes.map(([,id,label,code])=>{const r=reviews[id]||{};return `- [${r.status==='pass'?'x':' '}] ${code} · ${label}：${r.status==='pass'?'通过':r.status==='change'?'需调整':'未审查'}${r.note?'\n  '+r.note:''}`;})];
    const blob=new Blob([lines.join('\n')],{type:'text/markdown;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AssetTrack-界面审查意见.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('hashchange',()=>openScene(location.hash.slice(1)));
  window.assetTrackReview = {scenes:scenes.map(s=>({id:s[1],title:s[2],code:s[3]})),getState:()=>clone(state)};
  openScene(location.hash.slice(1)||'categories',true);
})();
