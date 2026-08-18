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

window.supabaseAuth = { initSupabase, onAuthStateChange, getAuthState, signUp, signIn, signOut };
