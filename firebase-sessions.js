import { getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { firebaseConfig } from "./firebase-config.js";

// Firebase persists authentication by app name as well as project/API key.
// Keep these names stable so signing out of one access never clears the other.
function sessionApp(name) {
  return getApps().find(app => app.name === name) || initializeApp(firebaseConfig, name);
}
export const getAdminApp = () => sessionApp("swe-admin");
export const getStudentApp = () => sessionApp("swe-student");
