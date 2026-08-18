const SUPABASE_URL = 'https://ypdgeimtytmldkzhkvel.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hnfCLhIxrCGO-UpTZ0dY8g_L2S5hSok';

let supabaseClient = null;
let authState = null;
const authListeners = new Set();

async function initSupabase(){
  if(supabaseClient) return supabaseClient;
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.4.0/+esm');
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  const { data: { session } } = await supabaseClient.auth.getSession();
  authState = session ? { user: session.user, loggedIn: true } : { user: null, loggedIn: false };
  supabaseClient.auth.onAuthStateChange((event, session) => {
    authState = session ? { user: session.user, loggedIn: true } : { user: null, loggedIn: false };
    authListeners.forEach(fn => fn(authState));
  });
  return supabaseClient;
}

function onAuthStateChange(fn){
  authListeners.add(fn);
  if(authState) fn(authState);
  return () => authListeners.delete(fn);
}

function getAuthState(){ return authState || { user: null, loggedIn: false }; }

async function signUp(email, password, name){
  const sb = await initSupabase();
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { name: name || email.split('@')[0] } }
  });
  if(error) throw error;
  return data;
}

async function signIn(email, password){
  const sb = await initSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return data;
}

async function signOut(){
  const sb = await initSupabase();
  const { error } = await sb.auth.signOut();
  if(error) throw error;
}

/**
 * 更新当前用户资料
 * @param {{name?:string,email?:string}} attrs - 可修改字段：name（user_metadata）、email（需邮件确认）
 */
async function updateUser(attrs){
  const sb = await initSupabase();
  const s = getAuthState();
  if(!s.loggedIn || !s.user) throw new Error('Not logged in');
  const payload = {};
  if(attrs && typeof attrs.name === 'string'){
    payload.data = { ...(s.user.user_metadata||{}), name: attrs.name };
  }
  if(attrs && typeof attrs.email === 'string' && attrs.email !== s.user.email){
    payload.email = attrs.email;
  }
  if(Object.keys(payload).length === 0) return { user: s.user };
  const { data, error } = await sb.auth.updateUser(payload);
  if(error) throw error;
  // 手动刷新本地 authState，避免要等 onAuthStateChange
  if(data?.user){
    authState = { user: data.user, loggedIn: true };
    authListeners.forEach(fn => fn(authState));
  }
  return data;
}

/**
 * 全量合并 user_metadata（除基础字段外，允许自定义字段：avatar_url、gender、region、phone 等）
 * @param {object} metadataPatch - 会合并到现有 user_metadata；值为 undefined 的字段会被删除
 */
async function updateUserMetadata(metadataPatch){
  const sb = await initSupabase();
  const s = getAuthState();
  if(!s.loggedIn || !s.user) throw new Error('Not logged in');
  const current = s.user.user_metadata || {};
  const next = { ...current };
  if(metadataPatch && typeof metadataPatch === 'object'){
    for(const k of Object.keys(metadataPatch)){
      const v = metadataPatch[k];
      if(v === undefined){
        delete next[k];
      } else {
        next[k] = v;
      }
    }
  }
  const { data, error } = await sb.auth.updateUser({ data: next });
  if(error) throw error;
  if(data?.user){
    authState = { user: data.user, loggedIn: true };
    authListeners.forEach(fn => fn(authState));
  }
  return data;
}

/* ======= 云端购物车：载体为 user_metadata.cart = { items, updated_at } ======= */

/**
 * 从云端读取购物车（只读当前 user_metadata.cart）
 * @returns {Promise<{items: Array<{id:string,size:null|string,qty:number}>, updated_at: number}|null>}
 */
async function getCartCloud(){
  const s = getAuthState();
  if(!s.loggedIn || !s.user) return null;
  const md = s.user.user_metadata || {};
  const cart = md.cart;
  if(!cart || !Array.isArray(cart.items)) return null;
  return {
    items: cart.items
      .filter(i => i && typeof i.id === 'string' && Number.isFinite(i.qty) && i.qty > 0)
      .map(i => ({ id: i.id, size: i.size || null, qty: Math.max(1, Math.min(999, i.qty|0)) })),
    updated_at: Number(cart.updated_at) || 0
  };
}

/**
 * 合并两个购物车：同 id+size 累加数量，各自排序稳定
 */
function _mergeCartItems(a, b){
  const out = [];
  const seen = new Map();
  function pushOne(i){
    const key = i.id + (i.size ? '::' + i.size : '');
    const existing = seen.get(key);
    if(existing){
      existing.qty += i.qty;
    } else {
      const c = { id: i.id, size: i.size || null, qty: i.qty };
      seen.set(key, c);
      out.push(c);
    }
  }
  (a || []).forEach(pushOne);
  (b || []).forEach(pushOne);
  return out
    .filter(i => i.qty > 0)
    .map(i => ({ ...i, qty: Math.min(999, i.qty) }));
}

/**
 * 覆盖写入云端购物车（自动带 updated_at = Date.now()）
 * @param {Array<{id:string,size:null|string,qty:number}>} items
 */
async function setCartCloud(items){
  const s = getAuthState();
  if(!s.loggedIn || !s.user) throw new Error('Not logged in');
  const sanitized = Array.isArray(items)
    ? items
        .filter(i => i && typeof i.id === 'string' && Number.isFinite(i.qty) && i.qty > 0)
        .map(i => ({ id: i.id, size: i.size || null, qty: Math.max(1, Math.min(999, i.qty|0)) }))
    : [];
  await updateUserMetadata({
    cart: { items: sanitized, updated_at: Date.now() }
  });
  return sanitized;
}

/**
 * 将本地购物车合并到云端（登录瞬间用）：
 *   云端 + 本地 取并集；同 id+size 累加数量；写回云端并返回合并后 items
 * 冲突策略：保留双方所有条目，数量相加（用户两侧各自加购都是真实意图）
 * @param {Array} localItems
 * @returns {Promise<Array>} 合并后 items
 */
async function mergeCartIntoCloud(localItems){
  const cloud = await getCartCloud();
  const merged = _mergeCartItems(cloud ? cloud.items : [], localItems);
  await setCartCloud(merged);
  return merged;
}

window.supabaseAuth = { initSupabase, onAuthStateChange, getAuthState, signUp, signIn, signOut, updateUser, updateUserMetadata, getCartCloud, setCartCloud, mergeCartIntoCloud };
