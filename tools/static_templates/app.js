const editorStyle = document.createElement("link");
editorStyle.rel = "stylesheet";
editorStyle.href = "editor.css";
document.head.appendChild(editorStyle);
const headerShortcut = document.getElementById("diy-open");
if (headerShortcut) headerShortcut.parentNode?.removeChild(headerShortcut);
import("./app-main.js");
window.addEventListener("load", () => import("./sim-original-config.js"));
