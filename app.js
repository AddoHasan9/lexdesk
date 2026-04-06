import {sbFetch} from './api/supabase.js';
import {setCases,store} from './core/state.js';
import {renderCases} from './ui/render.js';

async function init(){
  const data=await sbFetch('/rest/v1/cases?select=*');
  setCases(data||[]);
  renderCases(store.cases);
}
init();