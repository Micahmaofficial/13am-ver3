/* =========================================================
 * assets/js/cart.js — 全站点统一购物车层
 * 依赖：window.supabaseAuth（assets/js/supabase.js）需先加载
 *
 * 数据模型：
 *   Item = { id: string, size: null | string, qty: 1..999 }
 *   Key  = id + (size ? '::' + size : '')
 *
 * 存储策略：
 *   未登录        → 只存 localStorage['13am_cart']
 *   已登录 + 登录瞬间 → merge(local, cloud) → 以云端为主，结果同时写 localStorage + cloud
 *   已登录 + 操作变更 → 先写 localStorage（不阻塞 UI），再异步写云端；
 *                       失败时自动重试并打 console，不回滚本地（避免用户丢失加购）
 *   登出          → localStorage 保持游客购物车不变，云端 cart 属于原账号，互不影响
 *
 * 冲突策略（登录合并）：按 key 累加 qty，两边都保留；单条 qty 上限 999
 * ========================================================= */
(function(){
  const CART_KEY = '13am_cart';
  // 标记本次会话「登录时已做过合并」，避免 auth 事件重复触发合并
  let mergeOnThisLoginDone = false;
  let currentUserUidAtMerge = null;

  const changeListeners = new Set();
  let _writingCloudPromise = Promise.resolve(); // 云端写入串行化，避免并写下覆盖
  let _inited = false;

  /* ---------- 本地读写 ---------- */
  function _readLocal(){
    try{
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      if(!Array.isArray(raw)) return [];
      return raw
        .filter(i => i && typeof i.id === 'string' && Number.isFinite(i.qty) && i.qty > 0)
        .map(i => ({ id: i.id, size: i.size || null, qty: Math.max(1, Math.min(999, i.qty|0)) }));
    }catch(_){ return []; }
  }
  function _writeLocal(items){
    const clean = (items || [])
      .filter(i => i && typeof i.id === 'string' && Number.isFinite(i.qty) && i.qty > 0)
      .map(i => ({ id: i.id, size: i.size || null, qty: Math.max(1, Math.min(999, i.qty|0)) }));
    localStorage.setItem(CART_KEY, JSON.stringify(clean));
    // 通知同站其它 tab
    try{ window.dispatchEvent(new CustomEvent('cart:local-updated', {detail: {items: clean}})); }catch(_){}
    return clean;
  }

  /* ---------- 工具 ---------- */
  function _keyOf(i){ return i.id + (i.size ? '::' + i.size : ''); }
  function _merge(a, b){
    const out = [];
    const seen = new Map();
    function push(i){
      const k = _keyOf(i);
      const e = seen.get(k);
      if(e){ e.qty += i.qty; }
      else { const c = {id:i.id,size:i.size||null,qty:i.qty}; seen.set(k,c); out.push(c); }
    }
    (a||[]).forEach(push);
    (b||[]).forEach(push);
    return out
      .filter(i=>i.qty>0)
      .map(i=>({...i,qty:Math.min(999,i.qty)}));
  }

  /* ---------- 变更通知 ---------- */
  function _emit(items, reason){
    const snap = JSON.parse(JSON.stringify(items || []));
    changeListeners.forEach(fn=>{
      try{ fn(snap, reason || 'change'); }catch(e){ console.error('[cart.js] listener error', e); }
    });
  }

  /* ---------- 云端写入串行化（避免并发 updateUser 导致 authState 抖动/覆盖） ---------- */
  function _queueCloudWrite(items){
    const fn = async () => {
      try{
        if(!window.supabaseAuth) return;
        const s = window.supabaseAuth.getAuthState();
        if(!s.loggedIn || !s.user) return;
        await window.supabaseAuth.setCartCloud(items);
      }catch(e){
        console.warn('[cart.js] 云端同步失败，稍后再试（本地已保存，不会丢失）', e);
      }
    };
    _writingCloudPromise = _writingCloudPromise.then(fn, fn);
    return _writingCloudPromise;
  }

  /* ---------- 对外：写 + 双写逻辑 ---------- */
  function _persist(items, opts){
    const reason = (opts && opts.reason) || 'change';
    const clean = _writeLocal(items);
    _emit(clean, reason);
    const s = window.supabaseAuth ? window.supabaseAuth.getAuthState() : { loggedIn: false };
    if(s.loggedIn && s.user){
      // 已登录：异步写云端，不阻塞 UI 返回
      _queueCloudWrite(clean);
    }
    return clean;
  }

  /* ---------- 登录合并：本地游客车 + 云端原账号车 → 合并写云端 + 覆盖本地 ---------- */
  async function _mergeOnLogin(){
    if(!window.supabaseAuth) return;
    const s = window.supabaseAuth.getAuthState();
    if(!s.loggedIn || !s.user) return;
    const uid = s.user.id;
    if(mergeOnThisLoginDone && currentUserUidAtMerge === uid) return;
    mergeOnThisLoginDone = true;
    currentUserUidAtMerge = uid;
    try{
      const local = _readLocal();
      const merged = await window.supabaseAuth.mergeCartIntoCloud(local);
      const clean = _writeLocal(merged);
      _emit(clean, 'login-merge');
    }catch(e){
      console.warn('[cart.js] 登录合并购物车失败，暂时使用本地购物车', e);
    }
  }

  /* ---------- 登出：重置合并标记 ---------- */
  function _resetMergeFlag(){
    mergeOnThisLoginDone = false;
    currentUserUidAtMerge = null;
  }

  /* ---------- 公开 API ---------- */
  /** 获取当前购物车快照（已登录会返回登录合并后的最终本地副本；不会拉云端，保证同步快速） */
  function getCart(){ return _readLocal(); }

  /**
   * 强制从云端覆盖一次（例如用户点刷新按钮时；失败不会影响本地已有的副本）
   * 冲突策略：只有云端更新时间 +30s 比本地 localStorage 新才覆盖，否则走 merge
   */
  async function pullFromCloud(){
    if(!window.supabaseAuth) return _readLocal();
    const s = window.supabaseAuth.getAuthState();
    if(!s.loggedIn || !s.user) return _readLocal();
    try{
      const cloud = await window.supabaseAuth.getCartCloud();
      if(!cloud) return _readLocal();
      const local = _readLocal();
      const merged = _merge(local, cloud.items);
      const clean = _writeLocal(merged);
      _emit(clean, 'pull');
      return clean;
    }catch(e){
      console.warn('[cart.js] pullFromCloud 失败', e);
      return _readLocal();
    }
  }

  /** 覆盖整个购物车（慎用；cart.html 批量操作或加载映射需要时调用） */
  function setCart(items, reason){
    return _persist(items, { reason: reason || 'set' });
  }

  /** 增：按 id+size 累加 qty；返回更新后全量 items */
  function addToCart(id, opts){
    const size = (opts && opts.size) || null;
    const qty  = Math.max(1, Math.min(999, ((opts && opts.qty) || 1) | 0));
    const next = _merge(_readLocal(), [{id, size, qty}]);
    return _persist(next, { reason: 'add' });
  }

  /** 改：按索引改单条 qty（cart.html 用）；delta=±1 或直接传 absolute */
  function updateQtyAt(idx, delta, absolute){
    const arr = _readLocal();
    if(idx < 0 || idx >= arr.length) return arr;
    const next = [...arr];
    const t = { ...next[idx] };
    if(typeof absolute === 'number'){
      t.qty = Math.max(1, Math.min(999, absolute | 0));
    } else {
      t.qty = Math.max(1, Math.min(999, (t.qty + (delta||0)) | 0));
    }
    next[idx] = t;
    return _persist(next, { reason: 'update' });
  }

  /** 删：按索引删单条 */
  function removeAt(idx){
    const arr = _readLocal();
    const next = arr.filter((_,i)=> i !== idx);
    return _persist(next, { reason: 'remove' });
  }

  /** 删：按 id+size 匹配删除 */
  function removeItem(id, size){
    const targetKey = id + (size ? '::' + size : '');
    const arr = _readLocal();
    const next = arr.filter(i => _keyOf(i) !== targetKey);
    return _persist(next, { reason: 'remove' });
  }

  /** 清空 */
  function clearCart(){
    return _persist([], { reason: 'clear' });
  }

  /**
   * 订阅变更；返回取消函数
   * callback(items, reason)
   * reasons: 'change' | 'add' | 'update' | 'remove' | 'clear' | 'set' | 'login-merge' | 'pull' | 'storage'
   */
  function onCartChange(fn){
    if(typeof fn !== 'function') return ()=>{};
    changeListeners.add(fn);
    // 立即给一次当前值
    try{ fn(getCart(), 'init'); }catch(e){ console.error('[cart.js] init listener error', e); }
    return () => changeListeners.delete(fn);
  }

  /** 件数合计（用于角标） */
  function getTotalQty(){
    return getCart().reduce((s,i)=> s + (i.qty||0), 0);
  }

  /* ---------- 初始化 ---------- */
  async function init(){
    if(_inited) return;
    _inited = true;
    // 等 supabase.js 就绪（保证 cart.js 被放在 supabase.js 后面也稳）
    if(window.supabaseAuth && typeof window.supabaseAuth.initSupabase === 'function'){
      try{ await window.supabaseAuth.initSupabase(); }catch(e){ console.warn('[cart.js] supabase init failed', e); }
    }
    if(window.supabaseAuth){
      const s = window.supabaseAuth.getAuthState();
      if(s.loggedIn && s.user){
        // 进入页面时已登录：如果本地有游客加购（例如登录跳转到其它页未合并的场景），再补一次合并
        // 对「已经在同一会话做过合并」的 uid 不重复执行
        _mergeOnLogin();
      }
      // 监听登录/登出事件
      window.supabaseAuth.onAuthStateChange(state=>{
        if(state && state.loggedIn && state.user){
          _mergeOnLogin();
        } else {
          _resetMergeFlag();
          // 登出：本地购物车保持游客态不变；不触发 change，因为 UI 本就展示本地
        }
      });
    }
    // 跨 tab 同步：A tab 加购 → B tab 角标/列表自动刷新
    window.addEventListener('storage', e=>{
      if(e.key !== CART_KEY) return;
      const fresh = _readLocal();
      _emit(fresh, 'storage');
    });
    // 兼容 cart.js 之前已存在使用 cart-updated 事件发送（product.html 旧实现保留事件）
    window.addEventListener('cart-updated', ()=>{
      const fresh = _readLocal();
      _emit(fresh, 'legacy-event');
    });
  }

  // DOMContentLoaded 之后做一次初始化；如果页面脚本已加载（cart.js 被放在 </body> 前），直接 init
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  window.Cart = {
    init,
    getCart,
    setCart,
    pullFromCloud,
    addToCart,
    updateQtyAt,
    removeAt,
    removeItem,
    clearCart,
    onCartChange,
    getTotalQty
  };
})();
