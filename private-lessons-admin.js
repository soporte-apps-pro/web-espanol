import { getAdminApp } from "./firebase-sessions.js?v=20260916-short-slots-1";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import { adminUid } from "./firebase-config.js";
import { mountPrivateLessons } from "./private-lessons-ui.js?v=20260916-short-slots-1";
const app=getAdminApp();
let cleanup;
onAuthStateChanged(getAuth(app),user=>{
  cleanup?.();cleanup=undefined;
  if(user?.uid!==adminUid)return;
  const root=document.querySelector("#private-lessons-manager");
  try {cleanup=mountPrivateLessons(root,app,true);}
  catch(error){console.error(error);root.textContent="No se pudieron cargar los saldos. Actualiza la página para reintentar.";}
});
