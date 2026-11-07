/* Shared presentation layer. All mutations remain in the existing page handlers. */
(() => {
  const modules = {
    sites: ['WEBSITE OPERATIONS', '每一个网站，都有清晰的运营入口', '核对客户与域名，再管理内容、模板与发布。', 0],
    releases: ['RELEASE CENTER', '从提交发布，到确认网站上线', '构建、部署与线上版本分开核对，历史版本随时可追踪。', 2],
    builder: ['WEBSITE STUDIO', '用对话设计网站，预览后再上线', '左侧描述需求与修改，右侧检查独立草稿和历史版本。', 1],
    ai: ['CONTENT STUDIO', '让文章与配图，一起准备就绪', '填写主题与重点词，确认报价后由后台生成并登记发布。', 1],
    articles: ['ARTICLE LIBRARY', '把每一篇内容，管理得更清楚', '先维护文章，再发布网站；保存草稿不会改变线上页面。', 1],
    video: ['VIDEO STUDIO / PLANNED', '为视频创作，预留清晰的工作空间', '视频模型与生成流程尚未开放，当前不会提交任务或产生费用。', 1],
    knowledge: ['ENTERPRISE KNOWLEDGE', '企业事实，是AI创作的起点', '按客户整理经核实的企业资料与行业词，同客户地区站共享。', 2],
    media: ['MEDIA LIBRARY', '图片有归属，内容更好复用', '上传和生成的图片按网站隔离，访问地址与存储方式清晰可查。', 1],
    content: ['WEBSITE EDITOR', '保存官网资料，再预览发布', '官网字段与内容预览分区，确认草稿后再提交发布。', 0],
    external: ['MEDIA DISTRIBUTION', '选对媒体，让企业内容触达更多读者', '核对渠道限制、稿件快照和金额，提交后逐条跟踪刊发结果。', 3],
    geoquery: ['AI DATA CENTER', '把每次AI查询，变成可追踪的记录', '问题、平台、品牌命中和截图统一查看，查询与归档状态分开核对。', 2],
    analytics: ['WEBSITE ANALYTICS', '用访问数据，了解网站运营表现', '按网站与时间范围查看访问趋势、热门页面和来源，访客数为估算。', 2],
    billing: ['BALANCE & BILLING', '每一笔金额，都有清晰的去向', '余额、冻结、可用金额与任务账单分开核对，状态不明先核查。', 3],
    clients: ['CUSTOMER WORKSPACE', '客户归属清楚，协作更有边界', '按账号范围查看客户、代理商和网站关系，避免跨客户误操作。', 0],
    team: ['TEAM MANAGEMENT', '账号与归属，一次核对清楚', '员工继承所属代理商的数据范围，启用和停用保留确认步骤。', 0],
    templates: ['TEMPLATE CENTER', '合格的模板，才进入发布流程', '上传ZIP、查看校验报告、管理版本，再绑定网站检查实际效果。', 0],
    infrastructure: ['SERVER & DEPLOYMENT', '让每个站点，找到可靠的部署位置', '服务器IP、Agent在线状态、网站绑定与部署任务集中核对。', 0],
    provisioning: ['SERVER ONBOARDING', '先检查环境，再确认接入', 'SSH指纹、只读预检、确认安装和Agent回连，每一步都可核对。', 0],
    api: ['CONTENT INTEGRATION', '接口与网站权限，统一管理', '每个站点独立内容接入凭据；AI平台查询请使用AI数据中心。', 2]
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = name => window.uiIcon?.(name) || '';
  const filters = new Map();
  const tabMemory = new Map();
  let advancedMediaOpen = false;

  function externalFilters(main) {
    const container = main.querySelector('.external-filter-rows');
    if (!container) return;
    const rows = [...container.children].filter(n => n.matches('.external-filter-row'));
    if (rows.length < 5) return;
    const advanced = rows.filter((row, index) => index > 2 && !row.textContent.includes('价格排序'));
    const details = document.createElement('details'); details.className = 'module-advanced-filters';
    const summary = document.createElement('summary'); summary.textContent = '高级筛选：入口、收录、链接、发稿速度等';
    details.append(summary); advanced.forEach(row => details.append(row));
    details.open = advancedMediaOpen || advanced.some(row => [...row.querySelectorAll('button.active')].some(b => b.textContent.trim() !== '不限'));
    details.addEventListener('toggle', () => {advancedMediaOpen = details.open;});
    container.append(details);
  }

  function aiFormLayout(main) {
    const form = main.querySelector('#ai-form');
    if (!form) return;
    form.classList.add('module-form-grid');
    [...form.children].filter(n => n.matches('label')).forEach(label => {
      const input = label.nextElementSibling;
      if (!input?.matches('input,textarea,select')) return;
      const field = document.createElement('div'); field.className = 'module-form-field';
      if (['topic','keywords','imageStyle'].includes(input.name)) field.classList.add('module-field-wide');
      if (!input.id) input.id = 'module-ai-' + input.name;
      label.htmlFor = input.id;
      label.before(field); field.append(label, input);
    });
    const lengthField = form.querySelector('[name="targetLength"]')?.closest('.module-form-field');
    const styleField = form.querySelector('[name="imageStyle"]')?.closest('.module-form-field');
    if (lengthField && styleField) styleField.before(lengthField);
  }

  function tabPanels(main, view, groups, before) {
    const present = groups.filter(g => g.nodes.length);
    if (present.length < 2) return;
    const container = document.createElement('section');
    container.className = 'module-tabbed-section';
    const tabs = document.createElement('div');
    tabs.className = 'module-section-tabs';
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '管理内容切换');
    container.append(tabs);
    if (before) before.after(container); else main.append(container);
    const selected = tabMemory.get(view) || present[0].key;
    const choose = key => {
      tabMemory.set(view, key);
      present.forEach(g => {
        g.panel.hidden = g.key !== key;
        g.button.setAttribute('aria-selected', String(g.key === key));
      });
    };
    present.forEach(g => {
      const id = `module-${view}-${g.key}`;
      const button = document.createElement('button');
      button.type = 'button'; button.id = id + '-tab'; button.textContent = g.label;
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', id);
      const panel = document.createElement('div');
      panel.id = id; panel.className = `module-tab-panel ${g.className || ''}`;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
      g.nodes.forEach(node => panel.append(node));
      g.button = button; g.panel = panel;
      button.addEventListener('click', () => choose(g.key));
      tabs.append(button); container.append(panel);
    });
    choose(present.some(g => g.key === selected) ? selected : present[0].key);
  }

  function billingLayout(main, data, billing) {
    if (!billing) return;
    const panels = [...main.children].filter(n => n.matches('.panel'));
    const titled = text => panels.filter(n => n.querySelector('h2')?.textContent.startsWith(text));
    const settings = panels.filter(n => n.querySelector('#billing-prices,#billing-client,#billing-recharge'));
    const money = cents => window.money?.(cents) || (cents / 100).toFixed(2);
    const totals = billing.accounts.reduce((sum, account) => ({balance: sum.balance + Number(account.balance_cents), held: sum.held + Number(account.held_cents)}), {balance:0, held:0});
    const summary = document.createElement('div'); summary.className = 'module-balance-overview';
    summary.innerHTML = `<section class="module-balance-card"><span>${data.user.role === 'admin' ? '可见账户可用金额合计' : '所属账户可用金额合计'}</span><strong>${escape(money(totals.balance - totals.held))}</strong><div><span>账户余额<b>${escape(money(totals.balance))}</b></span><span>冻结金额<b>${escape(money(totals.held))}</b></span></div></section><section class="panel module-balance-help"><h2>金额使用说明</h2><p>可用金额 = 账户余额 − 冻结金额</p><p>已预占的任务金额单独保留，待任务结果确认后结算。</p><small>统计范围：当前账号可查看的 ${billing.accounts.length} 个账户。充值为线下收款后的内部登记。</small></section>`;
    main.querySelector('.module-hero').after(summary);
    const overview = panels.filter(p => !settings.includes(p) && (!p.querySelector('h2') || /客户本月用量|生成单价/.test(p.querySelector('h2').textContent)));
    tabPanels(main, 'billing', [
      {key:'overview',label:'账户概览',nodes:overview},
      {key:'orders',label:'任务账单',nodes:titled('最近生成账单')},
      {key:'entries',label:'资金流水',nodes:titled('资金流水')},
      {key:'settings',label:'价格、充值与预算',nodes:settings,className:'module-billing-settings'}
    ], summary);
  }

  function infrastructureLayout(main) {
    const hero = main.querySelector('.module-hero');
    const serverGroup = [...main.children].filter(n => n.matches('.two-col'));
    const panels = [...main.children].filter(n => n.matches('.panel'));
    const titled = text => panels.filter(n => n.querySelector('h2')?.textContent === text);
    // The old pilot diagnostic banner is not an operator action or task status.
    const diagnostic = main.firstElementChild;
    if (diagnostic?.matches('.note') && diagnostic.textContent.includes('正式试点架构')) diagnostic.remove();
    tabPanels(main, 'infrastructure', [
      {key:'servers',label:'服务器与绑定',nodes:serverGroup},
      {key:'deployments',label:'部署任务',nodes:titled('部署任务')},
      {key:'builds',label:'构建队列',nodes:titled('独立构建队列')},
      {key:'templates',label:'模板导入与绑定',nodes:titled('完整网站模板版本')}
    ], hero);
  }

  function paginateTables(main, view) {
    if (!['billing','infrastructure'].includes(view)) return;
    main.querySelectorAll('table').forEach(table => {
      const rows = [...(table.tBodies[0]?.rows || [])];
      if (rows.length <= 10) return;
      let page = 0;
      const pagination = document.createElement('div'); pagination.className = 'module-pagination';
      const prev = document.createElement('button'), next = document.createElement('button'), label = document.createElement('span');
      prev.type = next.type = 'button'; prev.textContent = '上一页'; next.textContent = '下一页';
      pagination.append(label, prev, next);
      (table.closest('.module-table-scroll') || table).after(pagination);
      const apply = () => {rows.forEach((row,i) => row.hidden = i < page * 10 || i >= (page + 1) * 10); label.textContent = `当前已加载 ${rows.length} 条 · 第 ${page + 1} / ${Math.ceil(rows.length / 10)} 页`; prev.disabled = page === 0; next.disabled = (page + 1) * 10 >= rows.length;};
      prev.addEventListener('click', () => {if(page > 0)page--; apply();});
      next.addEventListener('click', () => {if((page + 1) * 10 < rows.length)page++; apply();});
      apply();
    });
  }

  function wrapTables(main) {
    main.querySelectorAll('table').forEach(table => {
      if (table.closest('.module-table-scroll')) return;
      const wrap = document.createElement('div');
      wrap.className = 'module-table-scroll';
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', `${table.closest('section')?.querySelector('h2')?.textContent || '数据'}列表`);
      wrap.tabIndex = 0;
      table.before(wrap);
      wrap.append(table);
    });
  }

  function splitPanels(main, view) {
    if (!['knowledge', 'team', 'api'].includes(view)) return;
    const panels = [...main.children].filter(n => n.matches('.panel'));
    if (panels.length < 2) return;
    const layout = document.createElement('div');
    layout.className = `module-split module-split-${view}`;
    panels[0].before(layout);
    if (view === 'api') panels.forEach(n => layout.append(n));
    else {
      layout.append(panels[1], panels[0]);
      panels[0].classList.add('module-entry-panel');
    }
  }

  function filterList(main, view) {
    const settings = {
      articles: ['文章', ['全部文章', '发布内容', '草稿']],
      team: ['账号、姓名或所属代理商', ['全部账号', '正常', '已停用']],
      releases: ['版本、操作人或状态', ['全部版本', '当前上线', '历史版本', '构建失败', '部署失败']]
    }[view];
    if (!settings) return;
    const table = main.querySelector('table');
    if (!table || !table.tBodies[0]) return;
    const panel = table.closest('.panel');
    const state = filters.get(view) || {query:'', status:settings[1][0]};
    filters.set(view, state);
    const bar = document.createElement('div');
    bar.className = 'module-list-toolbar';
    bar.innerHTML = `<label class="module-list-search">${icon('file')}<input type="search" placeholder="搜索${settings[0]}" aria-label="搜索${settings[0]}" value="${escape(state.query)}"></label><div class="module-list-filters" role="group" aria-label="按状态筛选">${settings[1].map(s => `<button type="button" data-list-status="${escape(s)}" aria-pressed="${state.status === s}">${escape(s)}</button>`).join('')}</div>`;
    const anchor = panel.querySelector('.module-table-scroll') || table;
    anchor.before(bar);
    const empty = document.createElement('p');
    empty.className = 'module-filter-empty';
    empty.textContent = '没有匹配的记录，请调整搜索或筛选条件。';
    empty.hidden = true;
    anchor.after(empty);
    const apply = () => {
      let found = 0;
      [...table.tBodies[0].rows].forEach(row => {
        const text = row.textContent;
        // Empty-state rows remain visible only for the unfiltered view.
        const blank = !!row.querySelector('.empty');
        const matches = (!state.query || text.toLowerCase().includes(state.query.toLowerCase())) &&
          (state.status === settings[1][0] || text.includes(state.status));
        row.hidden = !matches || blank && (!!state.query || state.status !== settings[1][0]);
        if (!row.hidden && !blank) found++;
      });
      empty.hidden = found > 0 || !state.query && state.status === settings[1][0];
      bar.querySelectorAll('[data-list-status]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.listStatus === state.status)));
    };
    bar.querySelector('input').addEventListener('input', event => {state.query = event.target.value.trim(); apply();});
    bar.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {state.status = button.dataset.listStatus; apply();}));
    apply();
  }

  function knowledgeLayout(main) {
    const entries = main.querySelectorAll('.module-split-knowledge details');
    entries.forEach(item => item.classList.add('module-knowledge-entry'));
    const list = main.querySelector('.module-split-knowledge > .panel');
    if (!list || !entries.length) return;
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'module-knowledge-search';
    search.placeholder = '搜索知识标题、分类或重点词';
    search.setAttribute('aria-label', search.placeholder);
    list.querySelector('h2').after(search);
    search.addEventListener('input', () => entries.forEach(item => item.hidden = !item.textContent.includes(search.value.trim())));
  }

  function contentPreview(main) {
    const form = main.querySelector('#content-form');
    if (!form) return;
    form.querySelectorAll('input[name="title"],textarea[name="intro"]').forEach(input => input.addEventListener('input', () => {
      const target = form.querySelector(input.name === 'title' ? '.content-preview h3' : '.content-preview p');
      if (target) target.textContent = input.value;
      form.querySelector('.content-preview')?.classList.add('module-preview-unsaved');
      const marker = form.querySelector('.module-preview-status');
      if (marker) marker.textContent = '内容预览 · 当前输入尚未保存';
    }));
    const heading = form.querySelector('.content-preview')?.previousElementSibling;
    if (heading) {
      const marker = document.createElement('span');
      marker.className = 'module-preview-status';
      marker.textContent = '内容预览 · 发布后对外生效';
      heading.after(marker);
    }
  }

  function videoPlan(main) {
    const panel = main.querySelector('.panel');
    if (!panel) return;
    panel.classList.add('module-video-plan');
    const visual = document.createElement('div');
    visual.className = 'module-video-empty';
    visual.innerHTML = `${icon('image')}<strong>视频成片预览</strong><span>待视频模型与发布渠道接入后开放</span><div class="module-plan-steps"><span>创作需求</span><span>报价确认</span><span>生成与预览</span><span>发布记录</span></div>`;
    panel.prepend(visual);
  }

  window.renderArticleTask = function(task) {
    const box = document.querySelector('#module-ai-task');
    if (!box) return;
    const labels = {queued:'已排队，等待生成', running:'正在生成文章与配图', succeeded:'图文已保存并登记发布任务', failed:'生成失败', review:'待核查，请勿重复生成'};
    const status = task?.status;
    const state = status || 'idle';
    const waiting = box.parentElement.querySelector('.ai-empty');
    if(waiting)waiting.hidden=!!status;
    box.className = `module-ai-task task-${state}`;
    box.innerHTML = `<div class="module-task-title">${icon(status === 'succeeded' ? 'check' : status === 'review' || status === 'failed' ? 'alert' : 'spark')}<strong>${escape(labels[status] || '图文生成流程')}</strong></div><div class="module-task-steps"><span class="${status ? 'complete' : ''}">报价与预占</span><span class="${status === 'queued' ? 'current' : ['running','succeeded'].includes(status) ? 'complete' : ''}">后台排队</span><span class="${status === 'running' ? 'current' : status === 'succeeded' ? 'complete' : ''}">文字与配图</span><span class="${status === 'succeeded' ? 'complete' : ''}">登记发布</span></div><p>${escape(task?.error || (task?.jobId ? `任务：${task.jobId}` : '确认报价后开始生成。文字、图片全部完成后，自动创建网站发布任务。'))}</p><small>${status === 'succeeded' ? '接下来在“发布与版本”核对构建、Agent部署和线上访问。' : '生成中请勿重复提交。状态不明时先核对任务与金额。'}</small>`;
  };

  window.enhanceModulePage = function({view, data, selected, aiTask, billing}) {
    const main = document.querySelector('main.content');
    if (!main || view === 'dashboard' || !modules[view]) return;
    const [eyebrow, title, description, art] = modules[view];
    main.classList.add('module-content');
    main.dataset.module = view;
    const heading = main.querySelector('.heading');
    const hero = document.createElement('section');
    hero.className = `module-hero module-art-${art}`;
    hero.setAttribute('aria-label', `${heading?.querySelector('h1')?.textContent || title}功能说明`);
    const site = data.sites.find(s => s.id === selected);
    const scoped = ['clients','team','billing','infrastructure','provisioning','templates'].includes(view);
    const context = view === 'video' ? '规划功能 · 尚未开放真实生成' : scoped ? '按当前账号权限显示数据与操作' : site ? `当前网站：${site.name}${site.region ? ` · ${site.region}` : ''}` : '请先创建或选择网站';
    hero.innerHTML = `<div class="module-hero-copy"><span class="module-eyebrow">SHUGAOXING / ${eyebrow}</span><h2>${title}</h2><p>${description}</p><small>${icon(view === 'video' ? 'image' : 'check')}${escape(context)}</small></div><div class="module-hero-art" aria-hidden="true"></div>`;
    if (heading) heading.after(hero); else main.prepend(hero);

    if (view === 'sites') {
      const list = main.querySelector('.site-list-panel');
      const shortcuts = main.querySelector('.site-shortcuts');
      if (list && shortcuts) {shortcuts.classList.add('module-site-shortcuts'); list.after(shortcuts);}
      main.querySelector('.site-ui-note')?.remove();
      main.querySelectorAll('.site-card .card-body > .row strong').forEach(name => {
        const mark = document.createElement('span'); mark.className = 'module-site-icon'; mark.innerHTML = icon('globe'); name.prepend(mark);
      });
    }
    splitPanels(main, view);
    if (view === 'billing') billingLayout(main, data, billing);
    if (view === 'infrastructure') infrastructureLayout(main);
    wrapTables(main);
    paginateTables(main, view);
    filterList(main, view);
    if (view === 'knowledge') knowledgeLayout(main);
    if (view === 'content') contentPreview(main);
    if (view === 'video') videoPlan(main);
    if (view === 'external') externalFilters(main);
    if (view === 'ai') {
      aiFormLayout(main);
      const result = main.querySelector('.ai-result-panel');
      if (result) {const task = document.createElement('div'); task.id = 'module-ai-task'; result.querySelector('.row')?.after(task); window.renderArticleTask(aiTask);}
    }
    if (view === 'media') main.querySelectorAll('.media-grid > div').forEach(n => n.classList.add('module-media-card'));
    main.querySelectorAll('.empty').forEach(empty => {
      if (!empty.querySelector('svg') && !empty.closest('table')) {const visual = document.createElement('span'); visual.className = 'module-empty-icon'; visual.innerHTML = icon(view === 'media' ? 'image' : 'file'); empty.prepend(visual);}
    });
  };
})();
